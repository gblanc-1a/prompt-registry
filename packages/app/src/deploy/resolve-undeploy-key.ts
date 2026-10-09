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
  InvalidLogicalBundleKeyError,
  logicalKeyFromLegacyId,
  parseLogicalBundleKey,
} from '@ai-primitives-hub/core';
import type {
  LockfileV3BundleRecord,
  LockfileV3Pair,
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
  if (parts === null || typed.includes('/')) {
    return false;
  }
  try {
    return logicalKeyFromLegacyId(typed, parts.sourceId) === key;
  } catch (cause) {
    if (cause instanceof InvalidLogicalBundleKeyError) {
      return false;
    }
    throw cause;
  }
};

/**
 * Resolve a typed bundle id to the logical key to uninstall from a target.
 *
 * Order: an exact full key recorded under the target; an exact full key that is an
 * orphaned desired entry; then a bare-id scan (legacy version suffix stripped) over
 * the target's records and the orphaned desired entries together. Keys recorded under
 * other targets never match. Own-property lookups only, so `constructor`, `toString`
 * and `__proto__` are never matches.
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

  if (Object.hasOwn(records, typed)) {
    return { kind: 'match', key: typed, version: records[typed].version, record: records[typed] };
  }
  const desiredKeys = Object.keys(pair.desired.bundles);
  const orphanKeys = desiredKeys.filter((key) => !isMaterialized(pair, key));
  if (orphanKeys.includes(typed)) {
    return { kind: 'orphan', key: typed, version: pair.desired.bundles[typed].version };
  }

  const matchKeys = Object.keys(records).filter((key) => matchesBareId(key, typed));
  const orphanMatches = orphanKeys.filter((key) => matchesBareId(key, typed));
  const keys = [...matchKeys, ...orphanMatches];
  if (keys.length === 0) {
    return { kind: 'none' };
  }
  if (keys.length > 1) {
    return { kind: 'ambiguous', keys };
  }
  const [only] = keys;
  return matchKeys.length === 1
    ? { kind: 'match', key: only, version: records[only].version, record: records[only] }
    : { kind: 'orphan', key: only, version: pair.desired.bundles[only].version };
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
