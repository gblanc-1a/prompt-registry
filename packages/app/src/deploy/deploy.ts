/**
 * Place validated physical files, then record local before desired state.
 * Failure cleanup removes only paths created by this call; overwritten bytes
 * are never restored. Identical retries converge through satisfied files.
 * @module deploy/deploy
 */
import {
  createHash,
} from 'node:crypto';
import * as path from 'node:path';
import * as posix from 'node:path/posix';
import {
  decodeUtf8Strict,
  logicalBundleKey,
  nameShapeForKind,
  RegistryError,
  verifyWrittenBytes,
} from '@ai-primitives-hub/core';
import {
  upsertDesiredBundle,
  upsertDesiredSource,
  upsertMaterialization,
  writeLockfileV3Pair,
  writeV3File,
} from '../stores/lockfile-v3';
import type {
  LockfileV3FileEntry,
  LockfileV3Paths,
} from '../stores/lockfile-v3';
import {
  migrateLockfileIfNeeded,
  planLockfileMigration,
} from '../stores/migrate-lockfile-v3';
import type {
  MigrationReport,
} from '../stores/migrate-lockfile-v3';
import {
  prepareDeployFiles,
} from './inventory';
import {
  LifecycleError,
} from './lifecycle-error';
import {
  otherOwnedPaths,
} from './ownership';
import {
  assertDeploymentState,
  assertDeployPayload,
  assertReplayableSource,
  planDeploy,
} from './plan';
import {
  assertSafeDestinations,
  resolveRecordedPath,
  unsafeDestination,
} from './safety';
import {
  runStateStage,
  trackStateEffects,
} from './state-effects';
import type {
  DeployPorts,
  DeployRequest,
} from './types';

/** Observable deployment outcome. */
export interface DeployResult {
  key: string;
  written: string[];
  skipped: { from: string; reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered' }[];
  collisions: { to: string; reason: 'untracked-existing' }[];
  satisfied: string[];
  /** Old inventory paths preserved with their ownership because retirement was unsafe. */
  retained: string[];
  /** Unmodified old inventory files removed after state committed. */
  retired: string[];
  duplicates: { to: string; ids: string[] }[];
  lockfiles: LockfileV3Paths;
  migration: MigrationReport | null;
}

/**
 * Deploy with per-file collision and drift protection. Records include only
 * successfully placed or satisfied files, never an entire directory's siblings.
 * @param req Deployment request.
 * @param ports Filesystem, state and transformation boundaries.
 * @returns Deployment outcome.
 */
export async function deployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult> {
  const { bundle, source, placement, force, commitMode } = req;
  assertReplayableSource(source);
  assertDeployPayload(req);
  const key = logicalBundleKey({ sourceId: source.sourceId, manifestId: bundle.bundleId });
  const now = ports.now ?? new Date().toISOString();
  const inventory = prepareDeployFiles(req, ports);
  const destinations = [...inventory.destinations.map((entry) => entry.to), ...inventory.files.map((entry) => entry.to)];
  await assertSafeDestinations(ports.fs, placement.baseRoot, destinations);
  const migrationOptions = { generatedBy: ports.generatedBy ?? 'ai-primitives-hub', now, triggeredByKey: key };
  const preflight = await planLockfileMigration(ports.lockfileStore, ports.fs, migrationOptions);
  assertDeploymentState(req, preflight.pair);
  const state = trackStateEffects(ports.fs, ports.lockfileStore);
  const { pair, report: migration } = await runStateStage('deploy', 'migrate', state, () =>
    migrateLockfileIfNeeded(ports.lockfileStore, state.fs, migrationOptions));
  const plan = await planDeploy(req, ports);
  if (plan.drifted.length > 0 && force !== true) {
    throw new RegistryError({
      code: 'BUNDLE.DEPLOY_DRIFT',
      message: `Cannot deploy: ${plan.drifted.length} file(s) have been locally modified: ${plan.drifted.join(', ')}`
    });
  }
  await assertSafeDestinations(ports.fs, placement.baseRoot, destinations);
  const written: string[] = [];
  const created: string[] = [];
  const retained: string[] = [];
  const retired: string[] = [];
  const satisfied = plan.satisfied;
  const collisions = force === true ? [] : plan.collisions;
  const accepted = inventory.files.filter((file) => !collisions.some((entry) => entry.to === file.to));
  const result = (): DeployResult => ({
    key, written, skipped: plan.skipped, collisions, satisfied, retained, retired, duplicates: plan.duplicates,
    lockfiles: ports.lockfileStore, migration
  });
  if (accepted.length === 0) {
    return result();
  }
  let stage = 'place';
  let effectsBegan = false;
  try {
    for (const file of accepted) {
      if (satisfied.includes(file.to)) {
        continue;
      }
      const existedBefore = await ports.fs.exists(file.to);
      ports.onEvent?.({ kind: 'place', path: file.to });
      await assertSafeDestinations(ports.fs, placement.baseRoot, [file.to]);
      effectsBegan = true;
      await ports.fs.mkdir(path.dirname(file.to), { recursive: true });
      if (!existedBefore) {
        created.push(file.to);
      }
      const text = nameShapeForKind(file.kind) === 'directory' ? null : decodeUtf8Strict(file.installedBytes);
      await (text === null ? ports.fs.writeFileBytes(file.to, file.installedBytes) : ports.fs.writeFile(file.to, text));
      written.push(file.to);
      await verifyWrittenBytes(ports.fs, file.to, file.installedBytes);
    }
    stage = 'record';
    const previousDesired = Object.hasOwn(pair.desired.bundles, key) ? pair.desired.bundles[key] : undefined;
    const desiredWithBundle = upsertDesiredBundle(pair.desired, key, {
      version: bundle.version,
      sourceId: source.sourceId,
      ...(previousDesired?.version === bundle.version && previousDesired.archiveSha !== undefined
        ? { archiveSha: previousDesired.archiveSha }
        : {})
    });
    const desiredUpdated = upsertDesiredSource(desiredWithBundle, source.sourceId, {
      type: source.type,
      url: source.url,
      ...(source.branch === undefined ? {} : { branch: source.branch }),
      ...(source.collectionsPath === undefined ? {} : { collectionsPath: source.collectionsPath })
    });
    const fileRecords: LockfileV3FileEntry[] = [];
    for (const file of accepted) {
      const bytes = await ports.fs.readFileBytes(file.to);
      fileRecords.push({
        path: posix.relative(placement.baseRoot, file.to),
        checksum: createHash('sha256').update(file.sourceBytes).digest('hex'),
        installedChecksum: createHash('sha256').update(bytes).digest('hex')
      });
    }
    const oldTarget = Object.hasOwn(pair.local.targets, req.targetName) ? pair.local.targets[req.targetName] : undefined;
    const oldRecord = oldTarget !== undefined && Object.hasOwn(oldTarget.bundles, key) ? oldTarget.bundles[key] : undefined;
    const currentPaths = new Set(fileRecords.map((file) => file.path));
    const oldOnly = (oldRecord?.files ?? []).filter((file) => !currentPaths.has(file.path));
    // Retain ownership until retirement succeeds. A failed removal or final local write
    // leaves recoverable records rather than silently forgetting files.
    fileRecords.push(...oldOnly);
    const localUpdated = upsertMaterialization(pair.local, {
      targetName: req.targetName,
      targetType: placement.targetType,
      scope: placement.scope,
      baseDir: placement.baseRoot,
      ...(commitMode === undefined ? {} : { commitMode })
    }, key, {
      version: bundle.version,
      sourceId: source.sourceId,
      installedAt: now,
      ...(commitMode === undefined ? {} : { commitMode }),
      files: fileRecords
    });
    stage = 'state-write';
    ports.onEvent?.({ kind: 'state-write' });
    effectsBegan = true;
    await writeLockfileV3Pair(ports.lockfileStore, { desired: desiredUpdated, local: localUpdated }, state.fs);
    if (oldOnly.length > 0) {
      stage = 'retire';
      const shared = otherOwnedPaths(pair.local, req.targetName, key);
      const dropped = new Set<string>();
      for (const old of oldOnly) {
        const resolved = resolveRecordedPath(placement.baseRoot, old.path);
        if (!resolved.safe) {
          retained.push(resolved.reportPath);
          continue;
        }
        const destination = resolved.absolutePath;
        if (shared.has(destination) || await unsafeDestination(ports.fs, placement.baseRoot, destination) !== undefined) {
          retained.push(destination);
          continue;
        }
        if (!await ports.fs.exists(destination)) {
          dropped.add(old.path);
          continue;
        }
        const bytes = await ports.fs.readFileBytes(destination);
        if (createHash('sha256').update(bytes).digest('hex') !== old.installedChecksum) {
          retained.push(destination);
          continue;
        }
        await ports.fs.remove(destination);
        retired.push(destination);
        dropped.add(old.path);
      }
      if (dropped.size > 0) {
        stage = 'state-write';
        const record = localUpdated.targets[req.targetName].bundles[key];
        const finalLocal = upsertMaterialization(localUpdated, {
          targetName: req.targetName, targetType: placement.targetType, scope: placement.scope, baseDir: placement.baseRoot
        }, key, { ...record, files: record.files.filter((file) => !dropped.has(file.path)) });
        await writeV3File(ports.lockfileStore.localFile, finalLocal, state.fs);
      }
    }
    // MCP and git-exclude join here in later slices, after the record.
    return result();
  } catch (cause) {
    if (!effectsBegan && !state.started) {
      throw cause;
    }
    const cleanedUp: string[] = [];
    const cleanupFailures: { path: string; message: string }[] = [];
    const confirmedCreated = created.filter((filePath) => written.includes(filePath));
    for (const filePath of created) {
      try {
        if (await ports.fs.exists(filePath)) {
          if (!confirmedCreated.includes(filePath)) {
            confirmedCreated.push(filePath);
          }
          await ports.fs.remove(filePath);
          cleanedUp.push(filePath);
        }
      } catch (cleanupCause) {
        cleanupFailures.push({
          path: filePath,
          message: cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause)
        });
      }
    }
    throw new LifecycleError('deploy', cause, {
      stage,
      written: [...written, ...state.written],
      created: [...confirmedCreated, ...state.created],
      cleanedUp: [...cleanedUp, ...state.cleanedUp],
      cleanupFailures: [...cleanupFailures, ...state.cleanupFailures],
      removed: [...retired, ...state.removed]
    });
  }
}

/**
 * Explicit forced redeployment.
 * @param req Deployment request.
 * @param ports Deployment boundaries.
 * @returns Deployment outcome.
 */
export async function redeployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult> {
  return deployBundle({ ...req, force: true }, ports);
}
