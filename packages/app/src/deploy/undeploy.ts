/**
 * Bundle undeployment — remove recorded files and drop state.
 *
 * `undeployBundle` is the removal half of the lifecycle. **The governing
 * rule is that removal iterates the recorded paths and recomputes nothing**
 * (§5.7): manifest-driven renaming makes recomputation impossible, because
 * the destination a file *would* get today may differ from where it actually
 * went. The record is the only truth about what to delete.
 * @module deploy/undeploy
 */
import * as posix from 'node:path/posix';
import {
  removeDesiredBundle,
  removeMaterialization,
  writeLockfileV3Pair,
} from '../stores/lockfile-v3';
import {
  migrateLockfileIfNeeded,
} from '../stores/migrate-lockfile-v3';
import type {
  MigrationReport,
} from '../stores/migrate-lockfile-v3';
import type {
  DeployPorts,
  UndeployRequest,
} from './types';

/** Undeployment result. */
export interface UndeployResult {
  /** Bundle key that was undeployed. */
  key: string;
  /** Paths that were removed. */
  removed: string[];
  /** Paths that were skipped (already absent or unmanaged). */
  skipped: string[];
  /** Path to the lockfile. */
  lockfile: string;
  /** Migration report (null if no migration occurred). */
  migration: MigrationReport | null;
}

/**
 * Undeploy a bundle: remove recorded files and drop state.
 *
 * Pipeline: migrate → lookup → remove-files → record-removal.
 * Migration runs first (no triggeredByKey) because uninstall is a permitted
 * migration trigger (FR-16), and a flag-on uninstall must be able to find
 * records a v2 install left behind.
 *
 * **Removal iterates recorded paths only, no recomputation** (§5.7): the
 * record's `files[].path` joined to its `baseDir` is the only source of
 * truth for what to delete. An unmanaged record removes nothing but still
 * drops the record (§8.3 retains it for cleanup and refcounting; the user
 * asked to uninstall, so the record goes while the files stay).
 *
 * **Desired state is per-machine, not per-target**: `removeDesiredBundle`
 * runs only when no other target still materializes the same logical key.
 * Dropping desired state while another target holds files would orphan that
 * target's record.
 * @param req - Undeployment request.
 * @param ports - Deployment ports (fs, env, lockfileStore, etc.).
 * @returns Undeployment result.
 */
export async function undeployBundle(
  req: UndeployRequest,
  ports: DeployPorts
): Promise<UndeployResult> {
  const { key, targetName } = req;

  // 1. Migrate lockfile if needed (before any lookup, so we can find v2 records).
  //    No triggeredByKey: no bundle is being deployed, so nothing gets fresh paths.
  const generatedBy = ports.generatedBy ?? 'ai-primitives-hub';
  const now = ports.now ?? new Date().toISOString();
  const { pair, report: migration } = await migrateLockfileIfNeeded(
    ports.lockfileStore,
    ports.fs,
    { generatedBy, now }
  );

  // 2. Look up the target and bundle record. Absent → return empty result without writing.
  const targetRecord = pair.local.targets[targetName];
  if (targetRecord === undefined) {
    return {
      key,
      removed: [],
      skipped: [],
      lockfile: ports.lockfileStore.localFile,
      migration
    };
  }

  const bundleRecord = targetRecord.bundles[key];
  if (bundleRecord === undefined) {
    return {
      key,
      removed: [],
      skipped: [],
      lockfile: ports.lockfileStore.localFile,
      migration
    };
  }

  const removed: string[] = [];
  const skipped: string[] = [];

  // 3. If unmanaged, remove nothing but report every recorded path as skipped.
  //    Still drop the record: §8.3 retains it for cleanup and refcounting,
  //    but the user asked to uninstall, so the record goes while files stay.
  if (bundleRecord.state === 'unmanaged') {
    for (const fileEntry of bundleRecord.files) {
      const absolutePath = posix.join(targetRecord.baseDir, fileEntry.path);
      skipped.push(absolutePath);
    }
  } else {
    // 4. Otherwise, remove each recorded file. Absent → skipped.
    for (const fileEntry of bundleRecord.files) {
      const absolutePath = posix.join(targetRecord.baseDir, fileEntry.path);
      const exists = await ports.fs.exists(absolutePath);
      if (exists) {
        await ports.fs.remove(absolutePath);
        removed.push(absolutePath);
      } else {
        skipped.push(absolutePath);
      }
    }
  }

  // 5. Remove materialization, then remove desired bundle only if no other target
  //    still materializes the key. Desired state is per-machine, not per-target.
  const localUpdated = removeMaterialization(pair.local, targetName, key);

  // Check if any other target still has this bundle.
  const otherTargetHasBundle = Object.values(localUpdated.targets).some(
    (target) => target.bundles[key] !== undefined
  );

  let desiredUpdated = pair.desired;
  if (!otherTargetHasBundle) {
    desiredUpdated = removeDesiredBundle(pair.desired, key);
  }

  // 6. Write the pair.
  await writeLockfileV3Pair(
    ports.lockfileStore,
    { desired: desiredUpdated, local: localUpdated },
    ports.fs
  );

  return {
    key,
    removed,
    skipped,
    lockfile: ports.lockfileStore.localFile,
    migration
  };
}
