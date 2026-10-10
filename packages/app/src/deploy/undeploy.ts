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
import {
  LifecycleError,
} from './lifecycle-error';
import {
  otherOwnedPaths,
} from './ownership';
import {
  resolveRecordedPath,
  unsafeDestination,
} from './safety';
import {
  runStateStage,
  trackStateEffects,
} from './state-effects';
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
  /** Paths that were skipped (already absent, unmanaged, or unsafe to resolve). */
  skipped: string[];
  /** Physical destinations still held by another target/bundle record. */
  shared?: string[];
  /** Path to the lockfile. */
  lockfile: string;
  /** Migration report (null if no migration occurred). */
  migration: MigrationReport | null;
  /** Reason the record was unmanaged, when `state === 'unmanaged'`. */
  unmanagedReason?: string;
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
 *
 * **Retry convergence (§8.4)**: the pair write is local-then-desired, not one
 * transaction. If a prior attempt's desired write failed after its local
 * write succeeded, the record is already gone but desired still names the
 * key with no target materializing it — this call detects that orphan and
 * writes the pair again to drop it, rather than taking the early-return path
 * meant for a key that was never installed. When neither the record nor an
 * orphaned desired entry exists, nothing is written at all: an uninstall of
 * an unrecorded key must not create lockfile files in a fresh store.
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
  const state = trackStateEffects(ports.fs, ports.lockfileStore);
  const { pair, report: migration } = await runStateStage('undeploy', 'migrate', state, () => migrateLockfileIfNeeded(
    ports.lockfileStore,
    state.fs,
    { generatedBy, now }
  ));

  // 2. Look up the target and bundle record (own properties only: a target or key named
  //    like an inherited property must not resolve to something on the prototype).
  const targetRecord = Object.hasOwn(pair.local.targets, targetName) ? pair.local.targets[targetName] : undefined;
  const bundleRecord = targetRecord !== undefined && Object.hasOwn(targetRecord.bundles, key)
    ? targetRecord.bundles[key]
    : undefined;

  if (bundleRecord === undefined || targetRecord === undefined) {
    // No materialization record for this target/key. Either it was never
    // installed, or a prior attempt's local write dropped it but its desired
    // write failed (§8.4) — distinguish by checking for that orphan.
    const hasOrphanedDesiredEntry = Object.hasOwn(pair.desired.bundles, key)
      && !Object.values(pair.local.targets).some((target) => Object.hasOwn(target.bundles, key));

    if (hasOrphanedDesiredEntry) {
      // Converge: drop the orphaned desired entry and write the pair again.
      const desiredWithoutOrphan = removeDesiredBundle(pair.desired, key);
      await runStateStage('undeploy', 'state-write', state, () => writeLockfileV3Pair(
        ports.lockfileStore,
        { desired: desiredWithoutOrphan, local: pair.local },
        state.fs
      ));
      return {
        key,
        removed: [],
        skipped: [],
        lockfile: ports.lockfileStore.localFile,
        migration
      };
    }

    // Truly unrecorded key: write nothing (a fresh store must not get
    // lockfile files created for an uninstall of a key it never knew).
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
  const shared: string[] = [];
  const otherPaths = otherOwnedPaths(pair.local, targetName, key);
  let stage = 'remove';
  let effectsBegan = false;

  try {
  // 3. If unmanaged, remove nothing but report every recorded path as skipped.
  //    Still drop the record: §8.3 retains it for cleanup and refcounting,
  //    but the user asked to uninstall, so the record goes while files stay.
    if (bundleRecord.state === 'unmanaged') {
      for (const fileEntry of bundleRecord.files) {
        if (typeof targetRecord.baseDir !== 'string') {
          skipped.push(fileEntry.path);
          continue;
        }
        const resolved = resolveRecordedPath(targetRecord.baseDir, fileEntry.path);
        skipped.push(resolved.safe ? resolved.absolutePath : resolved.reportPath);
      }
    } else {
    // 4. Otherwise, remove each recorded file. Absent, or unsafe to resolve
    //    against baseDir → skipped (never removed).
      for (const fileEntry of bundleRecord.files) {
        const resolved = resolveRecordedPath(targetRecord.baseDir, fileEntry.path);
        if (!resolved.safe) {
          skipped.push(resolved.reportPath);
          continue;
        }
        if (otherPaths.has(resolved.absolutePath)) {
          shared.push(resolved.absolutePath);
          skipped.push(resolved.absolutePath);
          continue;
        }
        if (await unsafeDestination(ports.fs, targetRecord.baseDir, resolved.absolutePath) !== undefined) {
          skipped.push(resolved.absolutePath);
          continue;
        }
        const exists = await ports.fs.exists(resolved.absolutePath);
        if (exists) {
          effectsBegan = true;
          await ports.fs.remove(resolved.absolutePath);
          removed.push(resolved.absolutePath);
        } else {
          skipped.push(resolved.absolutePath);
        }
      }
    }

    // 5. Remove materialization, then remove desired bundle only if no other target
    //    still materializes the key. Desired state is per-machine, not per-target.
    const localUpdated = removeMaterialization(pair.local, targetName, key);

    // Check if any other target still has this bundle.
    const otherTargetHasBundle = Object.values(localUpdated.targets).some(
      (target) => Object.hasOwn(target.bundles, key)
    );

    let desiredUpdated = pair.desired;
    if (!otherTargetHasBundle) {
      desiredUpdated = removeDesiredBundle(pair.desired, key);
    }

    // 6. Write the pair.
    stage = 'state-write';
    effectsBegan = true;
    await writeLockfileV3Pair(
      ports.lockfileStore,
      { desired: desiredUpdated, local: localUpdated },
      state.fs
    );

    return {
      key,
      removed,
      skipped,
      shared,
      lockfile: ports.lockfileStore.localFile,
      migration,
      ...(bundleRecord.state === 'unmanaged' ? { unmanagedReason: bundleRecord.unmanagedReason } : {})
    };
  } catch (cause) {
    if (!effectsBegan && !state.started) {
      throw cause;
    }
    throw new LifecycleError('undeploy', cause, {
      stage,
      removed: [...removed, ...state.removed],
      written: state.written,
      created: state.created,
      cleanedUp: state.cleanedUp,
      cleanupFailures: state.cleanupFailures
    });
  }
}
