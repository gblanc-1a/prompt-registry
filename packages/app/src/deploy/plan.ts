/**
 * Read-only deployment analysis: no writes through any port.
 * @module deploy/plan
 */
import {
  createHash,
} from 'node:crypto';
import * as posix from 'node:path/posix';
import {
  assertResolutionSourceCompatibility,
  assertResolutionVersion,
  assertSourceKey,
  logicalBundleKey,
  sourceKey as portableSourceKey,
  RegistryError,
  sameSourceIdentity,
  sourceContentDigest,
} from '@ai-primitives-hub/core';
import {
  readLockfileV3Pair,
} from '../stores/lockfile-v3';
import type {
  LockfileV3Pair,
} from '../stores/lockfile-v3';
import {
  prepareDeployFiles,
} from './inventory';
import {
  assertSafeDestinations,
} from './safety';
import type {
  DeployPlan,
  DeployPorts,
  DeployRequest,
} from './types';

/**
 * Refuse an unrecordable source before effects, including migration.
 * @param source Source descriptor.
 */
export function assertReplayableSource(source: DeployRequest['source']): void {
  assertSourceKey(source.sourceKey, source.descriptor);
  if (portableSourceKey(source.descriptor.identity, source.descriptor.type) !== source.sourceKey) {
    throw new RegistryError({
      code: 'BUNDLE.SOURCE_KEY_MISMATCH',
      message: 'Deploy request source key does not match its portable descriptor.'
    });
  }
}

/**
 * Refuse binding/provenance changes that would orphan or redirect existing intent.
 * @param request Deployment request.
 * @param pair State already read through the version gate.
 */
export function assertDeploymentState(request: DeployRequest, pair: LockfileV3Pair): void {
  const target = Object.hasOwn(pair.local.targets, request.targetName) ? pair.local.targets[request.targetName] : undefined;
  if (target !== undefined && target.baseDir !== request.placement.baseRoot) {
    throw new RegistryError({
      code: 'BUNDLE.TARGET_REBOUND',
      message: `Target "${request.targetName}" was installed at "${target.baseDir}", not "${request.placement.baseRoot}"; uninstall first or restore the target path.`
    });
  }
  const { source, bundle } = request;
  const key = logicalBundleKey({ sourceKey: source.sourceKey, logicalBundleId: bundle.bundleId });
  const previous = Object.hasOwn(pair.desired.sources, source.sourceKey) ? pair.desired.sources[source.sourceKey] : undefined;
  if (previous !== undefined && !sameSourceIdentity(previous, source.descriptor)
    && Object.entries(pair.desired.bundles).some(([otherKey, entry]) => otherKey !== key && entry.sourceKey === source.sourceKey)) {
    throw new RegistryError({
      code: 'BUNDLE.SOURCE_CONFLICT',
      message: `Portable source key "${source.sourceKey}" conflicts with an existing source descriptor.`
    });
  }
}

/**
 * Preserve payload and archive-checksum refusals before any effect, including migration.
 * @param request Deployment request.
 */
export function assertDeployPayload(request: DeployRequest): void {
  const { files, bytes, expectedArchiveSha } = request;
  assertResolutionSourceCompatibility(request.source.descriptor, request.resolution);
  assertResolutionVersion(request.resolution, request.bundle.version);
  if (request.resolution.kind === 'live') {
    throw new RegistryError({
      code: 'BUNDLE.UNSUPPORTED_LIVE_DEPLOYMENT',
      message: 'Live local-skills deployment is not supported by copy-only targets; no files or lockfile state were changed.'
    });
  }
  const archiveSha = request.resolution.kind === 'pinned'
    ? (request.resolution.provider === 'github-release' || request.resolution.provider === 'artifactory-object'
      ? request.resolution.archiveSha256
      : undefined)
    : (request.resolution.kind === 'unpinned'
      ? request.resolution.evidence?.knownDigests?.archiveSha256
      : undefined);
  const expectedArchive = archiveSha === undefined ? undefined : `sha256:${archiveSha}`;
  if (expectedArchive !== undefined && (bytes === undefined || expectedArchiveSha !== expectedArchive)) {
    throw new RegistryError({
      code: 'BUNDLE.ARCHIVE_MISMATCH',
      message: 'Archive-backed resolution requires the original bytes and its exact expectedArchiveSha before deployment.'
    });
  }
  if (expectedArchiveSha !== undefined) {
    if (bytes === undefined) {
      throw new RegistryError({
        code: 'BUNDLE.ARCHIVE_MISMATCH',
        message: 'Cannot verify archive checksum: expectedArchiveSha given but bytes not provided'
      });
    }
    const actualSha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actualSha !== expectedArchiveSha) {
      throw new RegistryError({
        code: 'BUNDLE.ARCHIVE_MISMATCH',
        message: `Archive checksum mismatch: expected ${expectedArchiveSha}, got ${actualSha}`
      });
    }
  }
  if (files === undefined) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: 'Deploy request must include extracted files for deployment'
    });
  }
  const contentSha = request.resolution.kind === 'pinned'
    ? (request.resolution.provider === 'github-tree' || request.resolution.provider === 'azure-devops-tree'
      || request.resolution.provider === 'local-snapshot'
      ? request.resolution.sourceContentSha256
      : undefined)
    : (request.resolution.kind === 'unpinned'
      ? request.resolution.evidence?.knownDigests?.sourceContentSha256
      : undefined);
  if (contentSha !== undefined && sourceContentDigest(request.sourceFiles ?? files) !== contentSha) {
    throw new RegistryError({
      code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
      message: 'Resolved source files do not match the recorded source-content SHA-256 digest.'
    });
  }
  const manifestSha = request.resolution.kind === 'pinned' && request.resolution.provider === 'artifactory-object'
    ? request.resolution.manifestSha256
    : (request.resolution.kind === 'unpinned'
      ? request.resolution.evidence?.knownDigests?.manifestSha256
      : undefined);
  if (manifestSha !== undefined) {
    const manifest = files.get('deployment-manifest.yml');
    if (manifest === undefined || createHash('sha256').update(manifest).digest('hex') !== manifestSha) {
      throw new RegistryError({
        code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
        message: 'Resolved deployment manifest does not match its recorded raw-byte SHA-256 digest.'
      });
    }
  }
}

/**
 * Plan using the same validated physical inventory as execution. Byte-identical
 * destinations are satisfied even against an older baseline; other edits remain drift.
 * @param request Deployment request.
 * @param ports Read-only boundaries.
 * @returns Deployment plan.
 */
export async function planDeploy(request: DeployRequest, ports: DeployPorts): Promise<DeployPlan> {
  const { bundle, source } = request;
  assertReplayableSource(source);
  assertDeployPayload(request);
  const bundleKey = logicalBundleKey({ sourceKey: source.sourceKey, logicalBundleId: bundle.bundleId });
  const inventory = prepareDeployFiles(request, ports);
  await assertSafeDestinations(ports.fs, request.placement.baseRoot,
    [...inventory.destinations.map((entry) => entry.to), ...inventory.files.map((entry) => entry.to)]);
  const { pair } = await readLockfileV3Pair(ports.lockfileStore, ports.fs, {
    generatedBy: 'planDeploy', now: ports.now ?? new Date().toISOString()
  });
  assertDeploymentState(request, pair);
  const tracked = new Map<string, string>();
  const target = Object.hasOwn(pair.local.targets, request.targetName)
    ? pair.local.targets[request.targetName]
    : undefined;
  const record = target !== undefined && Object.hasOwn(target.bundles, bundleKey)
    ? target.bundles[bundleKey]
    : undefined;
  for (const entry of record?.files ?? []) {
    if (entry.installedChecksum !== undefined && target !== undefined) {
      tracked.set(posix.join(target.baseDir, entry.path), entry.installedChecksum);
    }
  }
  const satisfied: string[] = [];
  const collisions: DeployPlan['collisions'] = [];
  const drifted: string[] = [];
  const missing = new Set<string>();
  for (const file of inventory.files) {
    const baseline = tracked.get(file.to);
    if (!await ports.fs.exists(file.to)) {
      if (baseline !== undefined) {
        missing.add(file.to);
      }
      continue;
    }
    const content = await ports.fs.readFileBytes(file.to);
    const actual = createHash('sha256').update(content).digest('hex');
    const expected = createHash('sha256').update(file.installedBytes).digest('hex');
    if (actual === expected) {
      satisfied.push(file.to);
    } else if (baseline === undefined) {
      collisions.push({ to: file.to, reason: 'untracked-existing' });
    } else if (actual !== baseline) {
      drifted.push(file.to);
    }
  }
  for (const absolutePath of tracked.keys()) {
    if (!await ports.fs.exists(absolutePath)) {
      missing.add(absolutePath);
    }
  }
  return {
    bundleKey,
    destinations: inventory.destinations,
    satisfied, collisions, drifted, missing: [...missing],
    skipped: inventory.skipped,
    duplicates: inventory.duplicates,
    unknownLayoutKeys: inventory.unknownLayoutKeys,
    mcp: { servers: [], skipped: [] }
  };
}
