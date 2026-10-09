/**
 * Lockfile schema 3.0.0 — the role-split pair, scope-agnostic.
 *
 * Desired state (`bundles`, `sources`, `hubs`, `profiles`) and
 * materialization (`targets`) live in two files. **This module does not
 * know which scope it is serving**: the caller passes `LockfileV3Paths`
 * and everything else — shapes, ordering, atomicity, record helpers —
 * is identical at user and repository scope. That is a requester
 * decision amending design §5.1, and it is why slice 3 adds a caller
 * rather than a second store.
 *
 * `generatedAt`/`generatedBy` are in the local file only, so the
 * desired file is byte-comparable: two developers migrating the same
 * state produce the same content (§8.1), and §10's parity assertion
 * needs no normalization step.
 *
 * Write order is local-then-desired and the pair is not one filesystem
 * transaction (§8.4). Every intermediate state is legal and the reader
 * reports which halves it found, so a caller can resume rather than
 * assume. The existence flags distinguish "never written" from "both
 * written", but not "written by an earlier run" — only the local file's
 * `generatedAt` provides recency, and the desired file has no
 * counterpart by design.
 * @module stores/lockfile-v3
 */
import {
  randomUUID,
} from 'node:crypto';
import * as path from 'node:path';
import {
  classifyLockfileVersion,
  UnsupportedLockfileVersionError,
} from '@ai-primitives-hub/core';
import type {
  InstallationScope,
  RepositoryCommitMode,
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  LockfileFs,
  LockfileHubEntry,
  LockfileProfileEntry,
  LockfileSourceEntry,
} from './json-lockfile-store';

export const LOCKFILE_V3_VERSION = '3.0.0';

const LOCKFILE_V3_SCHEMA_URL =
  'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json';

/** Paths to the v3 lockfile pair. */
export interface LockfileV3Paths {
  /** Desired state file (byte-comparable). */
  desiredFile: string;
  /** Local materialization file (with generated metadata). */
  localFile: string;
}

/** File entry in a v3 bundle record. */
export interface LockfileV3FileEntry {
  /** Relative path from baseDir. */
  path: string;
  /** SHA256 of the archive's extracted bytes. */
  checksum?: string;
  /** SHA256 of the actually-installed bytes (post-transform). */
  installedChecksum?: string;
  /** True when this file was adopted from unmanaged state at migration. */
  adoptedAtMigration?: true;
}

/** Bundle materialization record in the local file. */
export interface LockfileV3BundleRecord {
  /** Semantic version. */
  version: string;
  /** Source ID. */
  sourceId: string;
  /** ISO timestamp when installed. */
  installedAt: string;
  /** Repository commit mode (absent at user scope). */
  commitMode?: RepositoryCommitMode;
  /** State marker for unmanaged bundles. */
  state?: 'unmanaged';
  /** Human-readable reason when state is unmanaged. */
  unmanagedReason?: string;
  /** True when the bundle's directory is a symlink. */
  linked?: true;
  /** List of installed files. */
  files: LockfileV3FileEntry[];
  /** Path to the MCP config file, if this bundle installed one. */
  mcpConfigPath?: string;
  /** MCP server names contributed by this bundle. */
  mcpServers?: string[];
  /** True when all expected files are present and unmodified. */
  complete?: true;
}

/** Target materialization record in the local file. */
export interface LockfileV3TargetRecord {
  /** Target type (vscode, cursor, etc.). Optional for the unmanaged reserved key. */
  targetType?: TargetType;
  /** Installation scope. Optional for the unmanaged reserved key. */
  scope?: InstallationScope;
  /** Base directory for file paths. */
  baseDir: string;
  /** Repository commit mode (absent at user scope). */
  commitMode?: RepositoryCommitMode;
  /** Map of bundle IDs to their materialization. */
  bundles: Record<string, LockfileV3BundleRecord>;
}

/** Desired bundle entry (byte-comparable). */
export interface LockfileV3DesiredEntry {
  /** Semantic version. */
  version: string;
  /** Source ID. */
  sourceId: string;
  /** Optional archive SHA for pinning. */
  archiveSha?: string;
}

/** Desired state file (byte-comparable). */
export interface DesiredLockfileV3 {
  /** JSON schema reference. */
  $schema: string;
  /** Schema version. */
  version: string;
  /** Map of bundle IDs to desired state. */
  bundles: Record<string, LockfileV3DesiredEntry>;
  /** Map of source IDs to their configuration. */
  sources: Record<string, LockfileSourceEntry>;
  /** Optional map of hub IDs to their configuration. */
  hubs?: Record<string, LockfileHubEntry>;
  /** Optional map of profile IDs to their configuration. */
  profiles?: Record<string, LockfileProfileEntry>;
}

/** Local materialization file (with generated metadata). */
export interface LocalLockfileV3 {
  /** Schema version. */
  version: string;
  /** ISO timestamp when generated. */
  generatedAt: string;
  /** Tool that generated this file. */
  generatedBy: string;
  /** Migration status markers. */
  migration?: {
    /** v3 migration completion marker. */
    lockfileV3?: 'complete';
  };
  /** Map of target names to their materialization. */
  targets: Record<string, LockfileV3TargetRecord>;
}

/** The v3 lockfile pair. */
export interface LockfileV3Pair {
  /** Desired state. */
  desired: DesiredLockfileV3;
  /** Local materialization. */
  local: LocalLockfileV3;
}

/** Widened LockfileFs with optional rename for atomic writes. */
export type LockfileFsWithRename = LockfileFs & {
  rename?(from: string, to: string): Promise<void>;
};

/** Target binding for upsert/remove operations. */
export interface TargetBinding {
  targetName: string;
  targetType: TargetType;
  scope: InstallationScope;
  baseDir: string;
  commitMode?: RepositoryCommitMode;
}

/** Thrown when a readable lockfile belongs to a different schema generation than the caller expected. */
export class LockfileGenerationMismatchError extends Error {
  public readonly code = 'LOCKFILE.GENERATION_MISMATCH';

  /**
   * Construct a generation mismatch error.
   * @param file - Absolute lockfile path.
   * @param found - Major version found on disk.
   * @param expected - Major version the caller required.
   */
  public constructor(
    public readonly file: string,
    public readonly found: number,
    public readonly expected: number
  ) {
    super(
      `${file} is lockfile schema ${found}.x, but schema ${expected}.x was required here. `
      + 'Migrate it first (this is a wiring defect, not a user error).'
    );
    this.name = 'LockfileGenerationMismatchError';
  }
}

/**
 * Assert that a version is v3, throwing the appropriate error if not.
 * @param file - Absolute lockfile path.
 * @param version - Version to validate.
 * @throws {UnsupportedLockfileVersionError} On unreadable version.
 * @throws {LockfileGenerationMismatchError} On wrong major version.
 */
const assertV3Version = (file: string, version: unknown): void => {
  const verdict = classifyLockfileVersion(version);
  if (verdict.kind !== 'readable') {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  if (verdict.major !== 3) {
    throw new LockfileGenerationMismatchError(file, verdict.major, 3);
  }
};

/**
 * Create an empty desired lockfile.
 * @returns Empty DesiredLockfileV3.
 */
export const emptyDesiredLockfileV3 = (): DesiredLockfileV3 => ({
  $schema: LOCKFILE_V3_SCHEMA_URL,
  version: LOCKFILE_V3_VERSION,
  bundles: {},
  sources: {}
});

/**
 * Create an empty local lockfile.
 * @param generatedBy - Tool identifier.
 * @param now - ISO timestamp.
 * @returns Empty LocalLockfileV3.
 */
export const emptyLocalLockfileV3 = (generatedBy: string, now: string): LocalLockfileV3 => ({
  version: LOCKFILE_V3_VERSION,
  generatedAt: now,
  generatedBy,
  targets: {}
});

const readV3File = async <T>(
  file: string,
  fs: LockfileFs,
  fallback: () => T
): Promise<{ value: T; existed: boolean }> => {
  if (!(await fs.exists(file))) {
    return { value: fallback(), existed: false };
  }
  const parsed = JSON.parse(await fs.readFile(file)) as { version?: unknown; bundles?: unknown; sources?: unknown; targets?: unknown };
  assertV3Version(file, parsed.version);
  // Provide shape defaults for hand-edited files.
  // Apply defaults only for fields that should exist on this file type.
  const value = { ...parsed } as T;
  if ('bundles' in (fallback() as object)) {
    (value as { bundles?: unknown }).bundles = parsed.bundles ?? {};
  }
  if ('sources' in (fallback() as object)) {
    (value as { sources?: unknown }).sources = parsed.sources ?? {};
  }
  if ('targets' in (fallback() as object)) {
    (value as { targets?: unknown }).targets = parsed.targets ?? {};
  }
  return { value, existed: true };
};

/**
 * Read the v3 lockfile pair from disk.
 * @param paths - Paths to the pair.
 * @param fs - Filesystem adapter.
 * @param defaults - Default values for empty files.
 * @param defaults.generatedBy
 * @param defaults.now
 * @returns The pair and existence flags.
 * @throws {UnsupportedLockfileVersionError} On unreadable version.
 * @throws {LockfileGenerationMismatchError} On wrong major version.
 */
export const readLockfileV3Pair = async (
  paths: LockfileV3Paths,
  fs: LockfileFs,
  defaults: { generatedBy: string; now: string }
): Promise<{ pair: LockfileV3Pair; desiredExists: boolean; localExists: boolean }> => {
  const desired = await readV3File<DesiredLockfileV3>(
    paths.desiredFile, fs, emptyDesiredLockfileV3
  );
  const local = await readV3File<LocalLockfileV3>(
    paths.localFile, fs, () => emptyLocalLockfileV3(defaults.generatedBy, defaults.now)
  );
  return {
    pair: { desired: desired.value, local: local.value },
    desiredExists: desired.existed,
    localExists: local.existed
  };
};

/**
 * Write a single v3 lockfile (local or desired) atomically.
 * @param file - Absolute path to the file.
 * @param payload - The lockfile content to write.
 * @param payload.version
 * @param fs - Filesystem adapter with optional rename.
 * @throws {UnsupportedLockfileVersionError} On invalid version.
 */
export const writeV3File = async (
  file: string,
  payload: { version: string },
  fs: LockfileFsWithRename
): Promise<void> => {
  assertV3Version(file, payload.version);
  if (fs.mkdir !== undefined) {
    await fs.mkdir(path.dirname(file), { recursive: true });
  }
  const contents = JSON.stringify(payload, null, 2) + '\n';
  if (fs.rename === undefined) {
    await fs.writeFile(file, contents);
    return;
  }
  // Unique per write: two processes must not race on one fixed temp path.
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents);
    await fs.rename(temp, file);
  } catch (cause) {
    if (fs.remove !== undefined) {
      try {
        await fs.remove(temp);
      } catch {
        // Cleanup is best effort; preserve the rename failure.
      }
    }
    throw cause;
  }
};

/**
 * Write the v3 lockfile pair to disk.
 * @param paths - Paths to the pair.
 * @param pair - The pair to write.
 * @param fs - Filesystem adapter with optional rename.
 * @throws {UnsupportedLockfileVersionError} On invalid version.
 */
export const writeLockfileV3Pair = async (
  paths: LockfileV3Paths,
  pair: LockfileV3Pair,
  fs: LockfileFsWithRename
): Promise<void> => {
  // Validate both halves before writing either, so a bad desired payload
  // cannot leave a written local file behind.
  assertV3Version(paths.localFile, pair.local.version);
  assertV3Version(paths.desiredFile, pair.desired.version);
  // Local first (§8.4 step 1), then desired (step 2).
  await writeV3File(paths.localFile, pair.local, fs);
  await writeV3File(paths.desiredFile, pair.desired, fs);
};

/**
 * Upsert a desired bundle entry.
 * @param lock - Desired lockfile.
 * @param bundleId - Bundle ID.
 * @param entry - Desired entry.
 * @returns New lockfile with the entry added.
 */
export const upsertDesiredBundle = (
  lock: DesiredLockfileV3,
  bundleId: string,
  entry: LockfileV3DesiredEntry
): DesiredLockfileV3 => ({
  ...lock,
  bundles: {
    ...lock.bundles,
    [bundleId]: entry
  }
});

/**
 * Upsert a desired source descriptor, so a recorded bundle's `sourceId` is
 * replayable. The four fields this helper owns (`type`, `url`, `branch`,
 * `collectionsPath`) are replaced wholesale: an omitted `branch` or
 * `collectionsPath` is removed, never retained, because a stale one would
 * replay the wrong branch or collection against the new `url`. Any other field
 * already on the entry (e.g. `indexFile`, `credentialRef`) is preserved.
 * @param lock - Desired lockfile.
 * @param sourceId - Source ID.
 * @param entry - Source descriptor; `undefined` optional fields are not written.
 * @returns New lockfile with the source added or updated.
 */
export const upsertDesiredSource = (
  lock: DesiredLockfileV3,
  sourceId: string,
  entry: LockfileSourceEntry
): DesiredLockfileV3 => {
  const {
    type: _type, url: _url, branch: _branch, collectionsPath: _collectionsPath, ...unowned
  } = lock.sources[sourceId] ?? {};
  return {
    ...lock,
    sources: {
      ...lock.sources,
      [sourceId]: {
        ...unowned,
        type: entry.type,
        url: entry.url,
        ...(entry.branch === undefined ? {} : { branch: entry.branch }),
        ...(entry.collectionsPath === undefined ? {} : { collectionsPath: entry.collectionsPath })
      }
    }
  };
};

/**
 * Remove a desired bundle entry.
 * @param lock - Desired lockfile.
 * @param bundleId - Bundle ID to remove.
 * @returns New lockfile with the entry removed.
 */
export const removeDesiredBundle = (
  lock: DesiredLockfileV3,
  bundleId: string
): DesiredLockfileV3 => {
  const { [bundleId]: _, ...remaining } = lock.bundles;
  return { ...lock, bundles: remaining };
};

/**
 * Upsert a bundle materialization in a target.
 * @param lock - Local lockfile.
 * @param binding - Target binding.
 * @param bundleId - Bundle ID.
 * @param record - Bundle record.
 * @returns New lockfile with the materialization added.
 */
export const upsertMaterialization = (
  lock: LocalLockfileV3,
  binding: TargetBinding,
  bundleId: string,
  record: LockfileV3BundleRecord
): LocalLockfileV3 => {
  const existing = lock.targets[binding.targetName];
  const targetRecord: LockfileV3TargetRecord = existing
    ? { ...existing, bundles: { ...existing.bundles, [bundleId]: record } }
    : {
      targetType: binding.targetType,
      scope: binding.scope,
      baseDir: binding.baseDir,
      ...(binding.commitMode === undefined ? {} : { commitMode: binding.commitMode }),
      bundles: { [bundleId]: record }
    };
  return {
    ...lock,
    targets: {
      ...lock.targets,
      [binding.targetName]: targetRecord
    }
  };
};

/**
 * Remove a bundle materialization from a target.
 * @param lock - Local lockfile.
 * @param targetName - Target name.
 * @param bundleId - Bundle ID to remove.
 * @returns New lockfile with the materialization removed.
 */
export const removeMaterialization = (
  lock: LocalLockfileV3,
  targetName: string,
  bundleId: string
): LocalLockfileV3 => {
  const target = lock.targets[targetName];
  if (target === undefined) {
    return lock;
  }
  const { [bundleId]: _, ...remainingBundles } = target.bundles;
  if (Object.keys(remainingBundles).length === 0) {
    // Prune the empty target.
    const { [targetName]: __, ...remainingTargets } = lock.targets;
    return { ...lock, targets: remainingTargets };
  }
  return {
    ...lock,
    targets: {
      ...lock.targets,
      [targetName]: { ...target, bundles: remainingBundles }
    }
  };
};
