/**
 * Read-only resolution of what a user typed to the logical bundle key an
 * uninstall should target.
 *
 * `undeployBundle` takes a full logical key, but users type a bare bundle id.
 * Resolving one to the other needs the lockfile pair, and a v2 store has to
 * be migrated before it has v3 records to look at. Migration commits writes
 * (and deletes legacy files), so resolution previews it in memory
 * (`readLockfilePair`) instead: a lookup that finds nothing, or finds
 * an ambiguity, leaves every lockfile byte-identical, including a v2 store.
 * Existing v3 halves are read as they stand, so a local-only or desired-only
 * pair resolves too.
 * @module deploy/resolve-undeploy-key
 */
import {
  parseLogicalBundleKey,
} from '@ai-primitives-hub/core';
import type {
  LegacyIdentityEvidence,
} from '@ai-primitives-hub/core';
import type {
  LockfileV3BundleRecord,
  LockfileV3Pair,
} from '../stores/lockfile-v3';
import {
  hasUnresolvedMaterializationOwner,
} from '../stores/lockfile-v3';
import {
  readLockfilePair,
} from '../stores/migrate-lockfile-v3';
import type {
  DeployPorts,
} from './types';

/** Ports the resolver reads through; it never writes. */
export type ResolveUndeployPorts = Pick<DeployPorts, 'fs' | 'lockfileStore'>;

/** A bundle the target materializes. */
export interface TargetBundle {
  key: string;
  /** Version recorded in the materialization record. */
  version: string;
  record: LockfileV3BundleRecord;
}

/** Outcome of resolving a typed bundle id. */
export type UndeployKeyResolution =
  | ({ kind: 'match' } & TargetBundle)
  | { kind: 'unmanaged'; key: string; version: string; targetName?: string }
  | { kind: 'intent'; key: string; version: string; evidence: LegacyIdentityEvidence }
  | {
    /**
     * Desired state names the key but no target materializes it — a prior uninstall's
     * desired write failed after its local write succeeded (§8.4). `undeployBundle`
     * repairs it.
     */
    kind: 'orphan';
    key: string;
    /** Version recorded in the desired entry. */
    version: string;
  }
  | { kind: 'ambiguous'; keys: string[] }
  | { kind: 'none' };

const previewPair = async (ports: ResolveUndeployPorts): Promise<LockfileV3Pair> => {
  const { pair } = await readLockfilePair(ports.lockfileStore, ports.fs, {
    generatedBy: 'ai-primitives-hub',
    now: new Date().toISOString()
  });
  return pair;
};

const targetBundles = (pair: LockfileV3Pair, targetName: string): Record<string, LockfileV3BundleRecord> =>
  Object.hasOwn(pair.local.targets, targetName) ? pair.local.targets[targetName].bundles : {};

const isMaterialized = (pair: LockfileV3Pair, key: string): boolean =>
  Object.values(pair.local.targets).some((target) => Object.hasOwn(target.bundles, key));

const matchesBareId = (key: string, typed: string): boolean => {
  const parts = parseLogicalBundleKey(key);
  return parts !== null && !typed.includes('/') && parts.logicalBundleId === typed;
};

/**
 * Resolve a typed bundle id to the logical key to uninstall from a target.
 *
 * Exact keys win before aliases; otherwise active keys, retained original keys, and
 * desired-only unresolved intent are considered together. Version suffixes are never
 * guessed. Keys recorded under other targets never match. Own-property lookups only,
 * so `constructor`, `toString` and `__proto__` are never matches.
 * @param input - The target and what the user typed.
 * @param input.targetName - Target the uninstall is scoped to.
 * @param input.typed - A full `sourceId/bundleId` key or a bare bundle id.
 * @param ports - Filesystem and lockfile paths; read only.
 * @returns The single match or orphan, every key when ambiguous, or none.
 */
export const resolveUndeployKey = async (
  input: { targetName: string; typed: string },
  ports: ResolveUndeployPorts
): Promise<UndeployKeyResolution> => {
  const { targetName, typed } = input;
  const pair = await previewPair(ports);
  const records = targetBundles(pair, targetName);
  const unmanagedRecords = targetBundles(pair, 'unmanaged');
  const unmanagedKeys = Object.keys(unmanagedRecords).filter((key) =>
    !Object.entries(pair.local.targets).some(([name, target]) => name !== 'unmanaged' && Object.hasOwn(target.bundles, key)));

  if (Object.hasOwn(records, typed)) {
    const record = records[typed];
    if (targetName === 'unmanaged') {
      return {
        kind: 'unmanaged',
        key: typed,
        version: record.version,
        ...(targetName === 'unmanaged' ? {} : { targetName })
      };
    }
    return { kind: 'match', key: typed, version: record.version, record };
  }
  if (unmanagedKeys.includes(typed)) {
    return { kind: 'unmanaged', key: typed, version: unmanagedRecords[typed].version };
  }
  const desiredKeys = Object.keys(pair.desired.bundles);
  const orphanKeys = desiredKeys.filter((key) => !isMaterialized(pair, key));
  if (orphanKeys.includes(typed)) {
    return { kind: 'orphan', key: typed, version: pair.desired.bundles[typed].version };
  }

  const candidates: UndeployKeyResolution[] = [];
  const addCandidate = (candidate: UndeployKeyResolution): void => {
    const duplicate = candidates.some((existing) => {
      if (existing.kind !== candidate.kind || !('key' in existing) || !('key' in candidate)
        || existing.key !== candidate.key || existing.version !== candidate.version) {
        return false;
      }
      if (existing.kind === 'intent' && candidate.kind === 'intent') {
        return JSON.stringify(existing.evidence) === JSON.stringify(candidate.evidence);
      }
      return existing.kind !== 'unmanaged' || candidate.kind !== 'unmanaged'
        || existing.targetName === candidate.targetName;
    });
    if (!duplicate) {
      candidates.push(candidate);
    }
  };

  const matchKeys = Object.keys(records).filter((key) => matchesBareId(key, typed));
  for (const key of matchKeys) {
    const record = records[key];
    if (targetName === 'unmanaged') {
      addCandidate({
        kind: 'unmanaged',
        key,
        version: record.version,
        ...(targetName === 'unmanaged' ? {} : { targetName })
      });
    } else {
      addCandidate({ kind: 'match', key, version: record.version, record });
    }
  }

  const orphanMatches = orphanKeys.filter((key) => matchesBareId(key, typed));
  for (const key of orphanMatches) {
    addCandidate({ kind: 'orphan', key, version: pair.desired.bundles[key].version });
  }

  for (const [key, record] of Object.entries(records)) {
    if ('state' in record && record.state === 'unmanaged' && record.legacy?.originalKey === typed) {
      addCandidate({
        kind: 'unmanaged',
        key,
        version: record.version,
        ...(targetName === 'unmanaged' ? {} : { targetName })
      });
    }
  }
  for (const key of unmanagedKeys) {
    const record = unmanagedRecords[key];
    if ('state' in record && record.state === 'unmanaged' && record.legacy?.originalKey === typed) {
      addCandidate({ kind: 'unmanaged', key, version: record.version });
    }
  }

  if (matchKeys.length === 0 && orphanMatches.length === 0) {
    for (const key of unmanagedKeys.filter((candidate) => matchesBareId(candidate, typed))) {
      addCandidate({ kind: 'unmanaged', key, version: unmanagedRecords[key].version });
    }
  }

  for (const intent of pair.desired.unresolved ?? []) {
    if (intent.originalKey !== typed || hasUnresolvedMaterializationOwner(pair.local, intent)) {
      continue;
    }
    const { reason: _, ...evidence } = intent;
    addCandidate({ kind: 'intent', key: intent.originalKey, version: intent.version, evidence });
  }

  if (candidates.length === 0) {
    return { kind: 'none' };
  }
  if (candidates.length > 1) {
    return {
      kind: 'ambiguous',
      keys: [...new Set(candidates.flatMap((candidate) => (
        'key' in candidate ? [candidate.key] : []
      )))].toSorted()
    };
  }
  return candidates[0];
};

/** What a bulk uninstall of a target sees. */
export interface TargetBundleListing {
  /** The target's materialized bundles, in recorded order. */
  bundles: TargetBundle[];
  /**
   * Desired keys that no target (this one or any other) materializes. An interrupted
   * uninstall's orphan looks exactly like intent not yet materialized, so a bulk
   * uninstall reports these rather than dropping them.
   */
  desiredOnly: string[];
}

/**
 * List what a target materializes, for a bulk uninstall, plus the desired-only keys. Reads
 * like {@link resolveUndeployKey}: v2 stores are previewed, never migrated.
 * @param targetName - Target to list.
 * @param ports - Filesystem and lockfile paths; read only.
 * @returns The target's bundles in recorded order and the desired-only keys; empty when none.
 */
export const listTargetBundles = async (
  targetName: string,
  ports: ResolveUndeployPorts
): Promise<TargetBundleListing> => {
  const pair = await previewPair(ports);
  const records = targetBundles(pair, targetName);
  return {
    bundles: Object.entries(records).map(([key, record]) => ({ key, version: record.version, record })),
    desiredOnly: Object.keys(pair.desired.bundles).filter((key) => !isMaterialized(pair, key))
  };
};
