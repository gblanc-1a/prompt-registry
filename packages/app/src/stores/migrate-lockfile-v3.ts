/**
 * One-way migration from v2 lockfile state to the v3 pair.
 *
 * Scope-agnostic: the caller passes the destination pair and the legacy file
 * list, so user scope rewrites one same-named file in place and repository
 * scope (slice 3) deletes two differently named ones, without a scope branch.
 *
 * Desired state is carried and rekeyed by logical bundle key.
 * Materializations whose destination cannot be proven are retained as
 * unmanaged with a reason rather than rebaselined or deleted (design §8.3),
 * and the bundle whose own install triggered the migration is left for the
 * deploy to record fresh. Follows design §8.4's order, setting the completion
 * marker only after the legacy files are gone, and unions legacy records in
 * until it is set so an interruption resumes.
 * @module stores/migrate-lockfile-v3
 */

import {
  classifyLockfileVersion,
  logicalKeyFromLegacyId,
  UnsupportedLockfileVersionError,
} from '@ai-primitives-hub/core';
import type {
  Lockfile,
  LockfileFsWithRename,
} from './json-lockfile-store';
import {
  emptyDesiredLockfileV3,
  emptyLocalLockfileV3,
  readLockfileV3Pair,
  writeLockfileV3Pair,
  writeV3File,
} from './lockfile-v3';
import type {
  LocalLockfileV3,
  LockfileV3BundleRecord,
  LockfileV3DesiredEntry,
  LockfileV3Pair,
  LockfileV3TargetRecord,
} from './lockfile-v3';

/**
 * Reserved target-record key for materializations with no provable binding (§8.3).
 * Not a configured target; given a distinct record to mark it.
 */
export const UNMANAGED_TARGET_KEY = 'unmanaged';

/** Migration report showing what was migrated and what was marked unmanaged. */
export interface MigrationReport {
  /** Bundle keys successfully migrated. */
  migrated: string[];
  /** Bundle keys marked unmanaged with reasons. */
  unmanaged: { key: string; reason: string }[];
}

/** Paths to the lockfiles for migration. */
export interface MigrationSources {
  /** Desired state file (byte-comparable). */
  desiredFile: string;
  /** Local materialization file (with generated metadata). */
  localFile: string;
  /** Legacy files to delete after migration. */
  readonly legacyFiles: readonly string[];
}

/**
 * Convert a v2 lockfile to the v3 pair.
 *
 * Pure function: no filesystem access, deterministic desired output when
 * `now` differs (design §8.1). All materializations go to the reserved
 * `unmanaged` target record except the bundle whose install triggered this
 * migration (`triggeredByKey`), which is omitted entirely so the deploy can
 * record it fresh.
 * @param v2 - The v2 lockfile to convert.
 * @param options - Generation metadata.
 * @param options.generatedBy - Tool identifier.
 * @param options.now - ISO timestamp for the local file.
 * @param options.triggeredByKey - Bundle key being installed; omit its materialization.
 * @returns The v3 pair and a migration report.
 */
export const convertV2ToPair = (
  v2: Lockfile,
  options: { generatedBy: string; now: string; triggeredByKey?: string }
): { pair: LockfileV3Pair; report: MigrationReport } => {
  const desired = emptyDesiredLockfileV3();
  const local = emptyLocalLockfileV3(options.generatedBy, options.now);
  const report: MigrationReport = { migrated: [], unmanaged: [] };

  // Carry hubs and profiles verbatim into the desired half (shallow-copy to avoid aliasing).
  if (v2.hubs) {
    desired.hubs = { ...v2.hubs };
  }
  if (v2.profiles) {
    desired.profiles = { ...v2.profiles };
  }

  // Carry sources into the desired half (shallow-copy to avoid aliasing).
  desired.sources = { ...v2.sources };

  // Prepare the unmanaged target record (not a configured target).
  const unmanagedTarget: LockfileV3TargetRecord = {
    baseDir: '',
    bundles: {}
  };

  // Convert each bundle.
  for (const [legacyId, entry] of Object.entries(v2.bundles)) {
    const logicalKey = logicalKeyFromLegacyId(legacyId, entry.sourceId);

    // Desired entry: version, sourceId, archiveSha (drop sourceType and installedAt).
    const desiredEntry: LockfileV3DesiredEntry = {
      version: entry.version,
      sourceId: entry.sourceId
    };
    if (entry.checksum) {
      desiredEntry.archiveSha = entry.checksum;
    }
    desired.bundles[logicalKey] = desiredEntry;

    // If this is the triggering bundle, omit its materialization.
    if (logicalKey === options.triggeredByKey) {
      report.migrated.push(logicalKey);
      continue;
    }

    // Determine the unmanaged reason.
    const reason = v2.sources[entry.sourceId]
      ? 'destination could not be proven from bundle-relative path'
      : 'unrecoverable source descriptor';

    // Materialization record: mark as unmanaged.
    const bundleRecord: LockfileV3BundleRecord = {
      version: entry.version,
      sourceId: entry.sourceId,
      installedAt: entry.installedAt,
      state: 'unmanaged',
      unmanagedReason: reason,
      files: entry.files.map((f) => ({
        path: f.path,
        checksum: f.checksum
      }))
    };

    // Carry commitMode when present (§8.3).
    if (entry.commitMode) {
      bundleRecord.commitMode = entry.commitMode;
    }

    unmanagedTarget.bundles[logicalKey] = bundleRecord;
    report.unmanaged.push({ key: logicalKey, reason });
  }

  // Only add the unmanaged target if there are bundles in it.
  if (Object.keys(unmanagedTarget.bundles).length > 0) {
    local.targets[UNMANAGED_TARGET_KEY] = unmanagedTarget;
  }

  return { pair: { desired, local }, report };
};

/**
 * Migrate the lockfile from v2 to v3 if needed.
 *
 * Follows design §8.4's order: write local without marker, write desired,
 * delete legacy files, write local with marker. Every step is idempotent
 * and resumes an interrupted migration by unioning the existing-new local
 * file with any legacy-derived records until the marker is set.
 * @param sources - Paths to the lockfiles.
 * @param fs - Filesystem adapter with rename for atomic writes.
 * @param options - Generation metadata.
 * @param options.generatedBy - Tool identifier.
 * @param options.now - ISO timestamp.
 * @param options.triggeredByKey - Bundle key being installed; omit its materialization.
 * @returns The v3 pair and migration report (null if no migration occurred).
 * @throws {UnsupportedLockfileVersionError} On unreadable version.
 * @throws {Error} On write failure or missing fs.remove.
 */
export const migrateLockfileIfNeeded = async (
  sources: MigrationSources,
  fs: LockfileFsWithRename,
  options: { generatedBy: string; now: string; triggeredByKey?: string }
): Promise<{ pair: LockfileV3Pair; report: MigrationReport | null }> => {
  // Step 1: Read the raw v2 source — legacyFiles[0] if any exists, else desiredFile.
  let v2Source: string | null = null;
  for (const legacyFile of sources.legacyFiles) {
    if (await fs.exists(legacyFile)) {
      v2Source = legacyFile;
      break;
    }
  }
  if (!v2Source && (await fs.exists(sources.desiredFile))) {
    v2Source = sources.desiredFile;
  }

  // Absent → return an empty pair, report: null, no write.
  if (!v2Source) {
    return {
      pair: {
        desired: emptyDesiredLockfileV3(),
        local: emptyLocalLockfileV3(options.generatedBy, options.now)
      },
      report: null
    };
  }

  // Read and classify the version.
  const rawContent = await fs.readFile(v2Source);
  const parsed = JSON.parse(rawContent) as { version?: unknown };
  const verdict = classifyLockfileVersion(parsed.version);

  if (verdict.kind !== 'readable') {
    throw new UnsupportedLockfileVersionError(v2Source, verdict);
  }

  // Major 3 → read the pair through readLockfileV3Pair and return it with report: null.
  if (verdict.major === 3) {
    const { pair } = await readLockfileV3Pair(
      { desiredFile: sources.desiredFile, localFile: sources.localFile },
      fs,
      { generatedBy: options.generatedBy, now: options.now }
    );
    return { pair, report: null };
  }

  // Major 2 → continue with migration.
  const v2 = parsed as Lockfile;

  // Step 2: Convert and union with any existing v3 local file's targets.
  const { pair: convertedPair, report } = convertV2ToPair(v2, options);

  // Read the existing v3 local file if it exists (for resume).
  let existingLocal: LocalLockfileV3 | null = null;
  if (await fs.exists(sources.localFile)) {
    try {
      const existingContent = await fs.readFile(sources.localFile);
      const existingParsed = JSON.parse(existingContent) as { version?: unknown };
      const existingVerdict = classifyLockfileVersion(existingParsed.version);
      if (existingVerdict.kind === 'readable' && existingVerdict.major === 3) {
        existingLocal = existingParsed as LocalLockfileV3;
      }
    } catch {
      // Ignore errors reading the existing local file.
    }
  }

  // Union: existing-new wins per bundle key (§8.4).
  if (existingLocal && !existingLocal.migration?.lockfileV3) {
    // Migration is incomplete, so union the targets.
    // Collect all bundle keys from existing-new, then add legacy-derived records
    // for keys not already present (per bundle key, not per (target, bundle) pair).
    const existingKeys = new Set<string>();
    for (const targetRecord of Object.values(existingLocal.targets)) {
      for (const bundleKey of Object.keys(targetRecord.bundles)) {
        existingKeys.add(bundleKey);
      }
    }

    // Merge existing-new targets into the converted pair, preserving their records.
    for (const [targetName, targetRecord] of Object.entries(existingLocal.targets)) {
      if (convertedPair.local.targets[targetName]) {
        // Merge bundles: existing-new wins.
        for (const [bundleKey, bundleRecord] of Object.entries(targetRecord.bundles)) {
          convertedPair.local.targets[targetName].bundles[bundleKey] = bundleRecord;
        }
      } else {
        convertedPair.local.targets[targetName] = targetRecord;
      }
    }

    // Remove legacy-derived records for keys that exist in existing-new.
    for (const [targetName, targetRecord] of Object.entries(convertedPair.local.targets)) {
      for (const bundleKey of Object.keys(targetRecord.bundles)) {
        if (existingKeys.has(bundleKey) && targetName === UNMANAGED_TARGET_KEY) {
          delete targetRecord.bundles[bundleKey];
        }
      }
      // Clean up empty unmanaged target.
      if (targetName === UNMANAGED_TARGET_KEY && Object.keys(targetRecord.bundles).length === 0) {
        delete convertedPair.local.targets[UNMANAGED_TARGET_KEY];
      }
    }
  }

  // Step 3: Write local without marker, then desired.
  await writeLockfileV3Pair(
    { desiredFile: sources.desiredFile, localFile: sources.localFile },
    convertedPair,
    fs
  );

  // Step 4: Delete each legacyFiles entry, tolerating absence.
  if (sources.legacyFiles.length > 0 && !fs.remove) {
    throw new Error(
      'fs.remove is required when legacyFiles is non-empty, but the adapter does not provide it'
    );
  }
  for (const legacyFile of sources.legacyFiles) {
    if (await fs.exists(legacyFile)) {
      await fs.remove!(legacyFile);
    }
  }

  // Step 5: Write local again with the marker (only local, not desired).
  convertedPair.local.migration = { lockfileV3: 'complete' };
  await writeV3File(sources.localFile, convertedPair.local, fs);

  return { pair: convertedPair, report };
};
