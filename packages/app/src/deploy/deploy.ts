/**
 * Deployment execution — place files, then record state.
 *
 * `deployBundle` is the write half of the pipeline: plan → deploy. The
 * planner provides read-only analysis; this module performs the actual
 * filesystem mutations and state writes. **The record-before-MCP order
 * is load-bearing** (§6.7, §9.2): a crash between them must leave a
 * tracked entry with no server, never a live server with no owner.
 * @module deploy/deploy
 */
import {
  createHash,
} from 'node:crypto';
import * as path from 'node:path';
import * as posix from 'node:path/posix';
import type {
  Target,
} from '@ai-primitives-hub/core';
import {
  decodeUtf8Strict,
  logicalBundleKey,
  nameShapeForKind,
  RegistryError,
  verifyWrittenBytes,
} from '@ai-primitives-hub/core';
import {
  upsertDesiredBundle,
  upsertMaterialization,
  writeLockfileV3Pair,
} from '../stores/lockfile-v3';
import type {
  LockfileV3FileEntry,
  LockfileV3Paths,
} from '../stores/lockfile-v3';
import {
  migrateLockfileIfNeeded,
} from '../stores/migrate-lockfile-v3';
import type {
  MigrationReport,
} from '../stores/migrate-lockfile-v3';
import {
  planDeploy,
} from './plan';
import type {
  DeployPorts,
  DeployRequest,
} from './types';

/** Deployment result. */
export interface DeployResult {
  /** Bundle key that was deployed. */
  key: string;
  /** Paths that were written. */
  written: string[];
  /** Items that were skipped. */
  skipped: { from: string; reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered' }[];
  /** Untracked collisions (existing files we would overwrite). */
  collisions: { to: string; reason: 'untracked-existing' }[];
  /** Paths that were already satisfied (byte-identical). */
  satisfied: string[];
  /** Destinations claimed by more than one id. */
  duplicates: { to: string; ids: string[] }[];
  /** Paths to the lockfiles. */
  lockfiles: LockfileV3Paths;
  /** Migration report (null if no migration occurred). */
  migration: MigrationReport | null;
}

/**
 * Deploy a bundle: place files, then record state.
 *
 * Pipeline: migrate → plan → check drift → place → record → MCP → git-exclude.
 * Migration runs before plan because plan reads the lockfile, and the pair reader
 * throws on an un-migrated v2 local file. MCP and git-exclude are no-ops in slice 1,
 * but the call order is established now so slice 7 inserts rather than reorders.
 * **Records before any MCP effect** (§6.7, §9.2): a crash between them must leave a
 * tracked entry with no server, never a live server with no owner.
 *
 * On failure mid-write, removes only the files this call created and reports what was
 * applied. **Does not rollback overwritten bytes** (§9.2) — re-running the same command
 * converges because the planner reports byte-identical untracked files as `satisfied` (§9.3).
 * @param req - Deployment request.
 * @param ports - Deployment ports (fs, env, lockfileStore, etc.).
 * @returns Deployment result.
 * @throws {RegistryError} BUNDLE.DEPLOY_DRIFT when tracked files have drifted and force is not set.
 */
export async function deployBundle(
  req: DeployRequest,
  ports: DeployPorts
): Promise<DeployResult> {
  const { bundle, source, placement, force, commitMode } = req;
  const key = logicalBundleKey({ sourceId: source.sourceId, manifestId: bundle.bundleId });

  // 1. Migrate lockfile if needed (before any write, so files are never a v2/v3 hybrid).
  //    This must happen before planDeploy since plan reads the lockfile.
  const generatedBy = ports.generatedBy ?? 'ai-primitives-hub';
  const now = ports.now ?? new Date().toISOString();
  const { pair, report: migration } = await migrateLockfileIfNeeded(
    ports.lockfileStore,
    ports.fs,
    { generatedBy, now, triggeredByKey: key }
  );

  // 2. Plan the deployment.
  const plan = await planDeploy(req, ports);

  // 3. Check for drift. Refuse unless force is set.
  if (plan.drifted.length > 0 && force !== true) {
    throw new RegistryError({
      code: 'BUNDLE.DEPLOY_DRIFT',
      message: `Cannot deploy: ${plan.drifted.length} file(s) have been locally modified: ${plan.drifted.join(', ')}`
    });
  }

  // 4. Place files. Track what we write and what we create separately.
  // `written` is the reported outcome; `created` is what gets cleaned up on failure.
  const written: string[] = [];
  const created: string[] = [];
  const satisfied: string[] = [];
  const collisions: { to: string; reason: 'untracked-existing' }[] = [];

  // Collect destinations to write (not in satisfied, and not in collisions unless force).
  const toWrite = plan.destinations.filter((dest) => {
    const alreadySatisfied = plan.satisfied.includes(dest.to);
    if (alreadySatisfied) {
      satisfied.push(dest.to);
      return false;
    }
    const hasCollision = plan.collisions.some((c) => c.to === dest.to);
    if (hasCollision && !force) {
      collisions.push({ to: dest.to, reason: 'untracked-existing' });
      return false;
    }
    return true;
  });

  // Invariant: req.files is defined because planDeploy already threw if both files and bytes were absent.
  const files = req.files!;

  try {
    for (const dest of toWrite) {
      const shape = nameShapeForKind(dest.kind);

      // Directory kind (skill, plugin, power): copy entire subtree preserving relative paths.
      // File kind: write single file with optional transformation.
      await (shape === 'directory'
        ? writeDirectoryKind(req, dest, ports, plan, written, created)
        : writeFileKind(req, dest, ports, plan, written, created));
    }

    // 5. Record state: upsert desired bundle, upsert materialization, write pair.
    // Skip recording when all destinations were skipped (empty files array would orphan
    // a re-deploy's existing record).
    const allDestinations = [...toWrite.map((d) => d.to), ...satisfied];

    if (allDestinations.length === 0) {
      // All destinations skipped: return early without writing state.
      return {
        key,
        written,
        skipped: plan.skipped,
        collisions,
        satisfied,
        duplicates: plan.duplicates,
        lockfiles: ports.lockfileStore,
        migration
      };
    }

    const desiredUpdated = upsertDesiredBundle(pair.desired, key, {
      version: bundle.version,
      sourceId: source.sourceId,
      // archiveSha only when bytes came from an immutable remote artifact.
      // (unreachable in slice 1: planner throws when only bytes is given)
      ...(req.bytes !== undefined && !isLocalSourceType(source.type) ? computeArchiveSha(req.bytes) : {})
    });

    // Build materialization record from ALL destinations (not just written),
    // so a retry whose destinations are all satisfied still records state (§9.3).
    const fileRecords: LockfileV3FileEntry[] = [];

    for (const dest of plan.destinations) {
      if (!allDestinations.includes(dest.to)) {
        continue;
      }

      const shape = nameShapeForKind(dest.kind);

      if (shape === 'directory') {
        // Directory kind: record all files in the subtree, not just the primary file.
        const sourcePrefix = posix.dirname(dest.from) + '/';
        for (const [bundlePath, bytes] of files) {
          if (!bundlePath.startsWith(sourcePrefix)) {
            continue;
          }
          const tail = bundlePath.slice(sourcePrefix.length);
          const outPath = posix.join(dest.to, tail);
          const relativePath = posix.relative(placement.baseRoot, outPath);

          // checksum: SHA256 of the archive's extracted bytes.
          const checksum = createHash('sha256').update(bytes).digest('hex');

          // installedChecksum: SHA256 of actually-installed bytes (post-transform).
          // Directory kinds copy byte-for-byte, so installedChecksum equals checksum.
          const installedChecksum = checksum;

          fileRecords.push({
            path: relativePath,
            checksum,
            installedChecksum
          });
        }
      } else {
        // File kind: record the single file.
        const relativePath = posix.relative(placement.baseRoot, dest.to);
        const sourceBytes = files.get(dest.from);
        if (sourceBytes === undefined) {
          continue;
        }

        // checksum: SHA256 of the archive's extracted bytes.
        const checksum = createHash('sha256').update(sourceBytes).digest('hex');

        // installedChecksum: SHA256 of the actually-installed bytes (post-transform).
        const writtenBytes = await ports.fs.readFileBytes(dest.to);
        const installedChecksum = createHash('sha256').update(writtenBytes).digest('hex');

        fileRecords.push({
          path: relativePath,
          checksum,
          installedChecksum
        });
      }
    }

    const localUpdated = upsertMaterialization(
      pair.local,
      {
        targetName: req.targetName,
        targetType: placement.targetType,
        scope: placement.scope,
        baseDir: placement.baseRoot,
        ...(commitMode === undefined ? {} : { commitMode })
      },
      key,
      {
        version: bundle.version,
        sourceId: source.sourceId,
        installedAt: now,
        ...(commitMode === undefined ? {} : { commitMode }),
        files: fileRecords
      }
    );

    // Emit state-write event before writing the pair.
    ports.onEvent?.({ kind: 'state-write' });

    await writeLockfileV3Pair(
      ports.lockfileStore,
      { desired: desiredUpdated, local: localUpdated },
      ports.fs
    );

    // 6. MCP: no-op in slice 1 (slice 7 will insert here).
    // The record has been written before this point (§6.7, §9.2).

    // 7. git-exclude: no-op at user scope (slice 5).

    return {
      key,
      written,
      skipped: plan.skipped,
      collisions,
      satisfied,
      duplicates: plan.duplicates,
      lockfiles: ports.lockfileStore,
      migration
    };
  } catch (cause) {
    // On failure, remove only the files this call created (not overwritten bytes, §9.2).
    for (const filePath of created) {
      try {
        await ports.fs.remove(filePath);
      } catch {
        // Rollback is best effort; preserve the original failure.
      }
    }
    throw cause;
  }
}

/**
 * Redeploy a bundle with force semantics applied to drift.
 *
 * Equivalent to `deployBundle({ ...req, force: true }, ports)`.
 * @param req - Deployment request.
 * @param ports - Deployment ports.
 * @returns Deployment result.
 */
export async function redeployBundle(
  req: DeployRequest,
  ports: DeployPorts
): Promise<DeployResult> {
  return deployBundle({ ...req, force: true }, ports);
}

/**
 * Write a single file-kind destination.
 * @param req - Deployment request.
 * @param dest - Destination to write.
 * @param dest.from
 * @param dest.to
 * @param dest.kind
 * @param ports - Deployment ports.
 * @param plan - Deployment plan (for tracking what existed before).
 * @param written - Accumulator for written paths (reported outcome).
 * @param created - Accumulator for created paths (cleanup target).
 */
async function writeFileKind(
  req: DeployRequest,
  dest: { from: string; to: string; kind: string },
  ports: DeployPorts,
  plan: ReturnType<typeof planDeploy> extends Promise<infer T> ? T : never,
  written: string[],
  created: string[]
): Promise<void> {
  const bytes = req.files!.get(dest.from);
  if (bytes === undefined) {
    return;
  }

  // Determine if this file is being created (vs overwritten).
  // A file is created if it's not in satisfied, collisions, drifted, or missing.
  const existedBefore =
    plan.satisfied.includes(dest.to)
    || plan.collisions.some((c) => c.to === dest.to)
    || plan.drifted.includes(dest.to)
    || plan.missing.includes(dest.to);

  // Emit place event before write.
  ports.onEvent?.({ kind: 'place', path: dest.to });

  await ports.fs.mkdir(path.dirname(dest.to), { recursive: true });

  // Decode as UTF-8 strictly; if that fails, treat as binary.
  const text = decodeUtf8Strict(bytes);
  if (text === null) {
    // Binary payload: write verbatim, never transform.
    await ports.fs.writeFileBytes(dest.to, bytes);
    await verifyWrittenBytes(ports.fs, dest.to, bytes);
  } else {
    // Text payload: apply transformer with fail-safe, then write.
    let content = text;
    if (ports.transformer !== undefined) {
      try {
        const target: Target = {
          name: req.targetName,
          type: req.placement.targetType,
          scope: req.placement.scope
        };
        const result = ports.transformer.transform({
          target,
          filePath: dest.from,
          content
        });
        content = result.content;
      } catch {
        // Transformation failure: write the untransformed text (fail-safe).
      }
    }
    await ports.fs.writeFile(dest.to, content);
    await verifyWrittenBytes(ports.fs, dest.to, new TextEncoder().encode(content));
  }

  written.push(dest.to);
  if (!existedBefore) {
    created.push(dest.to);
  }
}

/**
 * Write a directory-kind destination (skill, plugin, power).
 *
 * Copies every bundle file under the item's source prefix into the destination
 * directory, preserving each file's relative path, byte-for-byte with no
 * transformation (§4.4, controller ruling 4).
 * @param req - Deployment request.
 * @param dest - Destination to write.
 * @param dest.from
 * @param dest.to
 * @param dest.kind
 * @param ports - Deployment ports.
 * @param plan - Deployment plan (for tracking what existed before).
 * @param written - Accumulator for written paths (reported outcome).
 * @param created - Accumulator for created paths (cleanup target).
 */
async function writeDirectoryKind(
  req: DeployRequest,
  dest: { from: string; to: string; kind: string },
  ports: DeployPorts,
  plan: ReturnType<typeof planDeploy> extends Promise<infer T> ? T : never,
  written: string[],
  created: string[]
): Promise<void> {
  // The destination 'to' is the directory itself.
  // The source 'from' is the primary file (e.g., skills/my-skill/SKILL.md).
  // We need to write all files under the source prefix (skills/my-skill/).
  const sourcePrefix = posix.dirname(dest.from) + '/';

  for (const [bundlePath, bytes] of req.files!) {
    if (!bundlePath.startsWith(sourcePrefix)) {
      continue;
    }
    const tail = bundlePath.slice(sourcePrefix.length);
    const outPath = posix.join(dest.to, tail);

    // For directory kinds, determine per-file whether it existed before.
    // Check if this specific file path existed (not just the directory).
    const existedBefore = await ports.fs.exists(outPath);

    // Emit place event before write.
    ports.onEvent?.({ kind: 'place', path: outPath });

    await ports.fs.mkdir(path.dirname(outPath), { recursive: true });

    // Directory kinds carry arbitrary assets — copy byte-for-byte, never transform.
    await ports.fs.writeFileBytes(outPath, bytes);
    await verifyWrittenBytes(ports.fs, outPath, bytes);

    written.push(outPath);
    if (!existedBefore) {
      created.push(outPath);
    }
  }
}

/**
 * Check if a source type is a local family (local adapters synthesize
 * archives non-deterministically, so archiveSha is omitted).
 * @param type - Source type.
 * @returns True if the source is local.
 */
function isLocalSourceType(type: string): boolean {
  return type === 'local' || type.startsWith('local-');
}

/**
 * Compute archive SHA256 from bytes.
 * @param bytes - Archive bytes.
 * @returns Object with archiveSha field.
 */
function computeArchiveSha(bytes: Uint8Array): { archiveSha: string } {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { archiveSha: `sha256:${hash}` };
}
