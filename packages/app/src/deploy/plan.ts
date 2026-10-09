/**
 * Deployment planner — read-only analysis of what a deploy would do.
 *
 * `planDeploy` performs **no writes through any port** — that is what
 * makes it usable for `--dry-run` (design §3.1, §10).
 * @module deploy/plan
 */
import {
  createHash,
} from 'node:crypto';
import * as posix from 'node:path/posix';
import type {
  ExtractedFiles,
} from '@ai-primitives-hub/core';
import {
  getInstallableBundleFiles,
  logicalBundleKey,
  nameShapeForKind,
  normalizeManifestItems,
  RegistryError,
  resolveDestinations,
  validateManifest,
} from '@ai-primitives-hub/core';
import {
  readLockfileV3Pair,
} from '../stores/lockfile-v3';
import type {
  DeployPlan,
  DeployPorts,
  DeployRequest,
} from './types';

/**
 * Plan a deployment without performing any writes.
 *
 * Analyzes what a deploy would do: destinations, skipped items, drift,
 * missing files, untracked collisions, and already-satisfied destinations.
 * **Performs no writes through any port**, making it usable for --dry-run.
 * @param request - Deployment request.
 * @param ports - Read-only ports (fs, env, lockfileStore).
 * @returns The deployment plan.
 * @throws {RegistryError} BUNDLE.INVALID_DEPLOY_REQUEST when neither bytes nor files is given.
 * @throws {RegistryError} BUNDLE.ARCHIVE_MISMATCH when expectedArchiveSha is present and doesn't match.
 */
export async function planDeploy(
  request: DeployRequest,
  ports: DeployPorts
): Promise<DeployPlan> {
  const { files, bytes, expectedArchiveSha, bundle, source, placement } = request;

  // Compute bundle key once for both lockfile lookup and return value.
  const bundleKey = logicalBundleKey({ sourceId: source.sourceId, manifestId: bundle.bundleId });

  // 1. Validate exactly one of bytes/files.
  if ((files === undefined) === (bytes === undefined)) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: 'Deploy request must specify exactly one of bytes or files'
    });
  }

  // 2. Verify expectedArchiveSha before any deployment effect, if present.
  if (expectedArchiveSha !== undefined) {
    if (bytes === undefined) {
      // Controller ruling 2: refuse when expectedArchiveSha is present but bytes is absent.
      throw new RegistryError({
        code: 'BUNDLE.ARCHIVE_MISMATCH',
        message: 'Cannot verify archive checksum: expectedArchiveSha given but bytes not provided'
      });
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const actualSha = `sha256:${hash}`;
    if (actualSha !== expectedArchiveSha) {
      throw new RegistryError({
        code: 'BUNDLE.ARCHIVE_MISMATCH',
        message: `Archive checksum mismatch: expected ${expectedArchiveSha}, got ${actualSha}`
      });
    }
  }

  // 3. Extract or use provided files, validate manifest, narrow to installable.
  let extractedFiles: ExtractedFiles;
  if (files === undefined) {
    // In a real implementation, we would extract from bytes here.
    // For this slice, the test only passes files.
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: 'Archive extraction not yet implemented in slice 1'
    });
  } else {
    extractedFiles = files;
  }

  // Full validation runs on every plan: sha256 + byte size + complete
  // inventory coverage. No skipIntegrityCheck option exists, and adding
  // one is a core contract change outside this task.
  const manifest = validateManifest(extractedFiles, {});
  const installableFiles = getInstallableBundleFiles(extractedFiles, manifest);

  // 4. Normalize manifest items and resolve destinations.
  const { items, rejected } = normalizeManifestItems(manifest);
  const {
    destinations,
    skipped,
    duplicates,
    unknownLayoutKeys
  } = resolveDestinations(items, {
    baseRoot: placement.baseRoot,
    kindRoutes: placement.resolvedLayout.kindRoutes,
    allowedKinds: placement.allowedKinds
  });

  // 5. Read the lockfile pair to get materialization records.
  // Note: readLockfileV3Pair throws UnsupportedLockfileVersionError on an
  // un-migrated v2 local file, so planDeploy refuses rather than planning
  // when migration has not run.
  const { pair } = await readLockfileV3Pair(
    ports.lockfileStore,
    ports.fs,
    { generatedBy: 'planDeploy', now: new Date().toISOString() }
  );
  const local = pair.local;

  // Index tracked files by absolute path.
  const trackedFiles = new Map<string, { checksum: string }>();
  const targetRecord = local.targets[request.targetName];
  if (targetRecord) {
    const bundleRecord = targetRecord.bundles[bundleKey];
    if (bundleRecord) {
      for (const file of bundleRecord.files) {
        if (file.installedChecksum) {
          const absolutePath = posix.join(targetRecord.baseDir, file.path);
          trackedFiles.set(absolutePath, { checksum: file.installedChecksum });
        }
      }
    }
  }

  // 6. Classify each destination and find drift/missing.
  const satisfied: string[] = [];
  const collisions: { to: string; reason: 'untracked-existing' }[] = [];
  const drifted: string[] = [];
  const missing: string[] = [];

  for (const dest of destinations) {
    const { to, from, kind } = dest;
    const exists = await ports.fs.exists(to);
    const tracked = trackedFiles.get(to);
    const isDirectory = nameShapeForKind(kind) === 'directory';

    if (tracked) {
      // Tracked destination.
      if (exists) {
        if (!isDirectory) {
          // Check for drift: compare on-disk hash to installedChecksum.
          const content = await ports.fs.readFileBytes(to);
          const hash = createHash('sha256').update(content).digest('hex');
          if (hash !== tracked.checksum) {
            drifted.push(to);
          }
          // Otherwise, the file is tracked and matches — will be overwritten.
        }
        // Directory kinds: existence check only; per-file drift is Task 10.
      } else {
        // Tracked but missing.
        missing.push(to);
      }
    } else {
      // Untracked destination.
      if (exists) {
        if (isDirectory) {
          // Directory kinds: present + untracked → collision.
          collisions.push({ to, reason: 'untracked-existing' });
        } else {
          // File kinds: check if byte-identical.
          const content = await ports.fs.readFileBytes(to);
          const fileContent = installableFiles.get(from);
          if (fileContent && arraysEqual(content, fileContent)) {
            // Satisfied: already on disk with identical bytes.
            satisfied.push(to);
          } else {
            // Collision: untracked and different.
            collisions.push({ to, reason: 'untracked-existing' });
          }
        }
      }
      // Otherwise, the destination is untracked and absent — will be written.
    }
  }

  // Check for tracked files not in the destination set.
  const destinationPaths = new Set(destinations.map((d) => d.to));
  for (const [path] of trackedFiles) {
    if (!destinationPaths.has(path)) {
      const exists = await ports.fs.exists(path);
      if (!exists) {
        missing.push(path);
      }
    }
  }

  // 7. Return the plan.
  return {
    bundleKey,
    destinations,
    satisfied,
    collisions,
    drifted,
    missing,
    skipped: [...rejected, ...skipped].map((s) => ({
      from: s.sourcePath,
      reason: s.reason
    })),
    duplicates,
    unknownLayoutKeys,
    mcp: {
      servers: [],
      skipped: []
    }
  };
}

/**
 * Compare two Uint8Arrays for byte equality.
 * @param a - First array.
 * @param b - Second array.
 * @returns True if arrays are byte-identical.
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (const [i, element] of a.entries()) {
    if (element !== b[i]) {
      return false;
    }
  }
  return true;
}
