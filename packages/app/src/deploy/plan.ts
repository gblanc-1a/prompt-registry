/**
 * Read-only deployment analysis: no writes through any port.
 * @module deploy/plan
 */
import {
  createHash,
} from 'node:crypto';
import * as posix from 'node:path/posix';
import {
  logicalBundleKey,
  RegistryError,
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
  if (typeof source.url !== 'string' || source.url.trim().length === 0) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: `Deploy request source "${source.sourceId}" has no url, so its descriptor cannot be recorded in the lockfile`
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
  const key = logicalBundleKey({ sourceId: source.sourceId, manifestId: bundle.bundleId });
  const previous = Object.hasOwn(pair.desired.sources, source.sourceId) ? pair.desired.sources[source.sourceId] : undefined;
  if (previous !== undefined && (previous.type !== source.type || previous.url !== source.url)
    && Object.entries(pair.desired.bundles).some(([otherKey, entry]) => otherKey !== key && entry.sourceId === source.sourceId)) {
    throw new RegistryError({
      code: 'BUNDLE.SOURCE_CONFLICT',
      message: `Two different sources produced the same sourceId "${source.sourceId}"; uninstall the other bundle or pick a distinct source path before replacing its descriptor.`
    });
  }
}

/**
 * Preserve payload and archive-checksum refusals before any effect, including migration.
 * @param request Deployment request.
 */
export function assertDeployPayload(request: DeployRequest): void {
  const { files, bytes, expectedArchiveSha } = request;
  if ((files === undefined) === (bytes === undefined)) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: 'Deploy request must specify exactly one of bytes or files'
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
  const bundleKey = logicalBundleKey({ sourceId: source.sourceId, manifestId: bundle.bundleId });
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
