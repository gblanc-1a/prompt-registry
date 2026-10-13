/**
 * Offline migration from v2 and branch-era v3 lockfiles to the strict portable v3 pair.
 * Filesystem effects follow the local-first ordering in design §8.4; identity decisions
 * and retained evidence are prepared before the first write.
 * @module stores/migrate-lockfile-v3
 */

import {
  assertResolutionVersion,
  assertSourceKey,
  classifyLegacyIdentity,
  classifyLockfileVersion,
  isCredentialFreeHttpUrl,
  legacyIdentityRetentionKey,
  parseLogicalBundleKey,
  planIdentityMappings,
  sourceKey as portableSourceKey,
  UnsupportedLockfileVersionError,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
  LegacyDesiredIntent,
  LegacyIdentityEvidence,
  LegacyIdentityInput,
  LegacyMaterializationEvidence,
  PortableSourceDescriptor,
  RepositoryCommitMode,
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  Lockfile,
} from './json-lockfile-store';
import {
  emptyDesiredLockfileV3,
  emptyLocalLockfileV3,
  LockfileGenerationMismatchError,
  readLockfileV3Pair,
  writeV3File,
} from './lockfile-v3';
import type {
  DesiredLockfileV3,
  LocalLockfileV3,
  LockfileFsWithRename,
  LockfileV3BundleRecord,
  LockfileV3DesiredEntry,
  LockfileV3Pair,
  LockfileV3TargetRecord,
} from './lockfile-v3';

/** Reserved target-record key for materializations with no provable binding (§8.3). */
export const UNMANAGED_TARGET_KEY = 'unmanaged';

/** Migration report showing what was migrated and what was marked unmanaged. */
export interface MigrationReport {
  migrated: string[];
  unmanaged: { key: string; reason: string }[];
}

/** Paths to the lockfiles for migration. */
export interface MigrationSources {
  desiredFile: string;
  localFile: string;
  readonly legacyFiles: readonly string[];
}

/** Optional verified metadata supplied by the current explicit operation. */
export type VerifiedLegacyIdentityEvidence = Pick<
  LegacyIdentityInput,
  'legacyKey' | 'proven' | 'knownResolution'
> & {
  version?: string;
  sourceId?: string;
};

/** Inputs shared by preview and migration. */
export interface LockfileMigrationOptions {
  generatedBy: string;
  now: string;
  triggeredByKey?: string;
  identityEvidence?: readonly VerifiedLegacyIdentityEvidence[];
}

type JsonObject = Record<string, unknown>;

interface DesiredLegacyRow {
  legacyKey: string;
  entry: JsonObject;
  sourceId?: string;
  sourceDescriptor?: JsonObject;
  sourceDocument: JsonObject;
}

interface LocalLegacyRow {
  legacyKey: string;
  entry: JsonObject;
  sourceId?: string;
  sourceDescriptor?: JsonObject;
  targetName: string;
  target: JsonObject;
  sourceDocument: JsonObject;
}

interface MigrationSnapshot {
  desired: JsonObject | null;
  local: JsonObject | null;
  legacyDesired: DesiredLegacyRow[];
  legacyLocal: LocalLegacyRow[];
  legacyFiles: string[];
  migrationRequired: boolean;
}

interface IdentityPlanRow {
  input: LegacyIdentityInput;
  desiredRows: DesiredLegacyRow[];
  localRows: LocalLegacyRow[];
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const getObject = (value: unknown): JsonObject | undefined =>
  isObject(value) ? value : undefined;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : (left > right ? 1 : 0);

const sortedObject = <T>(value: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => compareText(a, b)));

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => compareText(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item));
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
};

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const normalizeSha256 = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (/^[a-f0-9]{64}$/.test(value)) {
    return value;
  }
  return /^sha256:([a-f0-9]{64})$/i.exec(value)?.[1]?.toLowerCase();
};

const onlyKeys = (value: JsonObject, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isPortableRelativeSelector = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && !value.startsWith('/')
  && !/^[a-zA-Z]:/.test(value)
  && !value.includes('\\')
  && !value.includes('\0')
  && !value.includes('://')
  && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

const isBundleResolution = (value: unknown): value is BundleResolution => {
  const resolution = getObject(value);
  if (!resolution) {
    return false;
  }
  if (resolution.kind === 'live') {
    return typeof resolution.selector === 'string';
  }
  if (resolution.kind === 'unpinned') {
    return typeof resolution.reason === 'string';
  }
  if (resolution.kind !== 'pinned' || typeof resolution.version !== 'string') {
    return false;
  }
  switch (resolution.provider) {
    case 'github-release': {
      return typeof resolution.releaseId === 'string'
        && typeof resolution.assetId === 'string'
        && isSha256(resolution.archiveSha256);
    }
    case 'github-tree': {
      return typeof resolution.commitSha === 'string'
        && typeof resolution.bundlePath === 'string'
        && isSha256(resolution.sourceContentSha256);
    }
    case 'azure-devops-tree': {
      return typeof resolution.commitId === 'string'
        && typeof resolution.collectionPath === 'string'
        && isSha256(resolution.sourceContentSha256);
    }
    case 'artifactory-object': {
      return typeof resolution.manifestPath === 'string'
        && typeof resolution.manifestSize === 'number'
        && isSha256(resolution.manifestSha256)
        && typeof resolution.archivePath === 'string'
        && typeof resolution.archiveSize === 'number'
        && isSha256(resolution.archiveSha256);
    }
    case 'local-snapshot': {
      return typeof resolution.bundleSelector === 'string'
        && isSha256(resolution.sourceContentSha256);
    }
    default: {
      return false;
    }
  }
};

const isStrictBundleResolution = (value: unknown): value is BundleResolution => {
  const resolution = getObject(value);
  if (!resolution || !isBundleResolution(value)) {
    return false;
  }
  if (resolution.kind === 'live') {
    return onlyKeys(resolution, ['kind', 'selector'])
      && isPortableRelativeSelector(resolution.selector);
  }
  if (resolution.kind === 'unpinned') {
    if (!onlyKeys(resolution, ['kind', 'reason', 'evidence'])) {
      return false;
    }
    const evidence = getObject(resolution.evidence);
    if (!evidence) {
      return resolution.evidence === undefined;
    }
    if (!onlyKeys(evidence, ['knownPins', 'knownDigests', 'manifestVersion', 'externalInputLimitations'])) {
      return false;
    }
    const knownPins = getObject(evidence.knownPins);
    if (evidence.knownPins !== undefined
      && (!knownPins || Object.entries(knownPins).some(([name, pin]) =>
        /(token|password|secret|credential|authorization|api[_-]?key)/i.test(name)
        || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)
        || typeof pin !== 'string'
        || !isSafeHistoricalValue(pin)))) {
      return false;
    }
    const knownDigests = getObject(evidence.knownDigests);
    if (evidence.knownDigests !== undefined
      && (!knownDigests
        || !onlyKeys(knownDigests, ['archiveSha256', 'sourceContentSha256', 'manifestSha256'])
        || Object.values(knownDigests).some((digest) => !isSha256(digest)))) {
      return false;
    }
    if (evidence.manifestVersion !== undefined && typeof evidence.manifestVersion !== 'string') {
      return false;
    }
    return evidence.externalInputLimitations === undefined
      || (Array.isArray(evidence.externalInputLimitations)
        && evidence.externalInputLimitations.length > 0
        && evidence.externalInputLimitations.every((item) => typeof item === 'string'));
  }

  switch (resolution.provider) {
    case 'github-release': {
      return onlyKeys(resolution, ['kind', 'provider', 'version', 'releaseId', 'assetId', 'archiveSha256', 'tag'])
        && /^[1-9]\d*$/.test(resolution.releaseId as string)
        && /^[1-9]\d*$/.test(resolution.assetId as string)
        && (resolution.tag === undefined
          || (typeof resolution.tag === 'string' && isSafeHistoricalValue(resolution.tag)))
        && isSha256(resolution.archiveSha256);
    }
    case 'github-tree':
    case 'azure-devops-tree': {
      const isGithubTree = resolution.provider === 'github-tree';
      const commit = isGithubTree ? resolution.commitSha : resolution.commitId;
      const selector = isGithubTree ? resolution.bundlePath : resolution.collectionPath;
      const commitKey = isGithubTree ? 'commitSha' : 'commitId';
      const selectorKey = isGithubTree ? 'bundlePath' : 'collectionPath';
      if (
        !onlyKeys(resolution, ['kind', 'provider', 'version', commitKey, selectorKey, 'sourceContentSha256', 'externalInputs'])
        || typeof commit !== 'string'
        || !/^[a-f0-9]{40}$/.test(commit)
        || !isPortableRelativeSelector(selector)
        || !isSha256(resolution.sourceContentSha256)
      ) {
        return false;
      }
      return resolution.externalInputs === undefined
        || (Array.isArray(resolution.externalInputs)
          && resolution.externalInputs.every((inputValue) => {
            const input = getObject(inputValue);
            return input !== undefined
              && onlyKeys(input, ['identity', 'sourceContentSha256'])
              && typeof input.identity === 'string'
              && input.identity.length > 0
              && isSafeHistoricalValue(input.identity)
              && isSha256(input.sourceContentSha256);
          }));
    }
    case 'artifactory-object': {
      return onlyKeys(resolution, [
        'kind', 'provider', 'version', 'manifestPath', 'manifestSize', 'manifestSha256',
        'archivePath', 'archiveSize', 'archiveSha256'
      ])
      && isPortableRelativeSelector(resolution.manifestPath)
      && Number.isSafeInteger(resolution.manifestSize)
      && (resolution.manifestSize as number) >= 0
      && isSha256(resolution.manifestSha256)
      && isPortableRelativeSelector(resolution.archivePath)
      && Number.isSafeInteger(resolution.archiveSize)
      && (resolution.archiveSize as number) >= 0
      && isSha256(resolution.archiveSha256);
    }
    case 'local-snapshot': {
      return onlyKeys(resolution, ['kind', 'provider', 'version', 'bundleSelector', 'sourceContentSha256'])
        && isPortableRelativeSelector(resolution.bundleSelector)
        && isSha256(resolution.sourceContentSha256);
    }
    default: {
      return false;
    }
  }
};

const isSafeHistoricalValue = (value: string): boolean => {
  if (
    value.length === 0
    || value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || /^file:/i.test(value)
    || /(token|password|secret|credential|authorization|api[_-]?key)\s*=/i.test(value)
  ) {
    return false;
  }
  return !/^https?:\/\//i.test(value) || isCredentialFreeHttpUrl(value);
};

const historicalUnpinnedResolution = (
  raw: JsonObject,
  version: string
): BundleResolution => {
  const knownPins: Record<string, string> = {};
  const knownDigests: Record<string, string> = {};
  const evidence = getObject(raw.evidence);
  const knownPinEvidence = getObject(evidence?.knownPins);
  if (knownPinEvidence) {
    for (const [name, pin] of Object.entries(knownPinEvidence)) {
      if (
        !/(token|password|secret|credential|authorization|api[_-]?key)/i.test(name)
        && /^[A-Za-z][A-Za-z0-9._-]*$/.test(name)
        && typeof pin === 'string'
        && isSafeHistoricalValue(pin)
      ) {
        knownPins[name] = pin;
      }
    }
  }
  const preservePin = (name: string, value: unknown): void => {
    if (typeof value === 'string' && isSafeHistoricalValue(value)) {
      knownPins[name] = value;
    }
  };
  if (typeof raw.provider === 'string') {
    preservePin('provider', raw.provider);
  }
  for (const name of [
    'releaseId', 'assetId', 'tag', 'commitSha', 'commitId', 'bundlePath',
    'collectionPath', 'manifestPath', 'archivePath', 'bundleSelector'
  ]) {
    preservePin(name, raw[name]);
  }
  for (const [name, value] of Object.entries(getObject(evidence?.knownDigests) ?? {})) {
    const digestName = ['archiveSha', 'archiveSha256', 'checksum'].includes(name)
      ? 'archiveSha256'
      : name;
    if (
      ['archiveSha256', 'sourceContentSha256', 'manifestSha256'].includes(digestName)
      && normalizeSha256(value) !== undefined
    ) {
      knownDigests[digestName] = normalizeSha256(value) as string;
    }
  }
  for (const [name, target] of [
    ['archiveSha256', 'archiveSha256'],
    ['archiveSha', 'archiveSha256'],
    ['checksum', 'archiveSha256'],
    ['sourceContentSha256', 'sourceContentSha256'],
    ['manifestSha256', 'manifestSha256']
  ]) {
    const digest = normalizeSha256(raw[name]);
    if (digest !== undefined) {
      knownDigests[target] = digest;
    }
  }
  const manifestVersion = getString(raw.version) ?? getString(evidence?.manifestVersion);
  if (manifestVersion !== undefined) {
    if (manifestVersion === version) {
      preservePin('manifestVersion', manifestVersion);
    } else {
      preservePin('historicalManifestVersion', manifestVersion);
    }
  }
  const limitations = Array.isArray(evidence?.externalInputLimitations)
    ? evidence.externalInputLimitations.filter((item): item is string =>
      typeof item === 'string' && isSafeHistoricalValue(item))
    : [];
  const unpinnedEvidence = {
    ...(Object.keys(knownPins).length === 0 ? {} : { knownPins: knownPins }),
    ...(Object.keys(knownDigests).length === 0 ? {} : { knownDigests: knownDigests }),
    ...(limitations.length === 0 ? {} : { externalInputLimitations: [...new Set(limitations)].toSorted() })
  };
  return {
    kind: 'unpinned',
    reason: 'Historical artifact pin metadata is incomplete.',
    ...(Object.keys(unpinnedEvidence).length === 0 ? {} : { evidence: unpinnedEvidence })
  };
};

const historicalOuterDigestCandidates = (
  entry: JsonObject
): { name: string; source: string; value: unknown; pinName: string }[] => [
  {
    name: 'archiveSha256',
    source: 'Outer',
    value: entry.archiveSha256,
    pinName: 'legacyArchiveSha256'
  },
  {
    name: 'archiveSha256',
    source: entry.archiveSha256 === undefined || entry.archiveSha256 === null
      ? 'Outer'
      : 'OuterLegacyArchive',
    value: entry.archiveSha,
    pinName: 'legacyArchiveSha'
  },
  {
    name: 'archiveSha256',
    source: 'OuterChecksum',
    value: entry.checksum,
    pinName: 'legacyChecksum'
  },
  {
    name: 'sourceContentSha256',
    source: 'Outer',
    value: entry.sourceContentSha256,
    pinName: 'legacySourceContentSha256'
  },
  {
    name: 'manifestSha256',
    source: 'Outer',
    value: entry.manifestSha256,
    pinName: 'legacyManifestSha256'
  }
];

const historicalResolutionFromEntry = (
  resolution: JsonObject,
  entry: JsonObject,
  version: string
): BundleResolution => {
  const mergedResolution = { ...resolution };
  const resolutionEvidence = getObject(resolution.evidence);
  const embeddedDigests = getObject(resolutionEvidence?.knownDigests);
  const mergedEvidence = resolutionEvidence === undefined ? undefined : { ...resolutionEvidence };
  const mergedEmbeddedDigests = embeddedDigests === undefined ? undefined : { ...embeddedDigests };
  const conflicts: Record<string, string> = {};
  const outerDigests = historicalOuterDigestCandidates(entry);
  const digestSources = [
    {
      name: 'archiveSha256',
      embedded: [
        ['Embedded', resolution.archiveSha256],
        ['EmbeddedLegacyArchive', resolution.archiveSha],
        ['EmbeddedChecksum', resolution.checksum],
        ['Evidence', embeddedDigests?.archiveSha256],
        ['EvidenceLegacyArchive', embeddedDigests?.archiveSha],
        ['EvidenceChecksum', embeddedDigests?.checksum]
      ],
      outer: outerDigests.filter(({ name }) => name === 'archiveSha256')
    },
    {
      name: 'sourceContentSha256',
      embedded: [
        ['Embedded', resolution.sourceContentSha256],
        ['Evidence', embeddedDigests?.sourceContentSha256]
      ],
      outer: outerDigests.filter(({ name }) => name === 'sourceContentSha256')
    },
    {
      name: 'manifestSha256',
      embedded: [
        ['Embedded', resolution.manifestSha256],
        ['Evidence', embeddedDigests?.manifestSha256]
      ],
      outer: outerDigests.filter(({ name }) => name === 'manifestSha256')
    }
  ] as const;

  for (const digestSource of digestSources) {
    const candidates = [
      ...digestSource.embedded.flatMap(([source, value]) => {
        const digest = normalizeSha256(value);
        return digest === undefined ? [] : [{ source, digest }];
      }),
      ...digestSource.outer.flatMap(({ source, value }) => {
        const digest = normalizeSha256(value);
        return digest === undefined ? [] : [{ source, digest }];
      })
    ];
    const uniqueDigests = [...new Set(candidates.map(({ digest }) => digest))];
    if (uniqueDigests.length > 1) {
      for (const candidate of candidates) {
        conflicts[`conflicting${digestSource.name[0].toUpperCase()}${digestSource.name.slice(1)}${candidate.source}`]
          = candidate.digest;
      }
      delete mergedResolution[digestSource.name];
      if (digestSource.name === 'archiveSha256') {
        delete mergedResolution.archiveSha;
        delete mergedResolution.checksum;
      }
      if (mergedEmbeddedDigests !== undefined) {
        delete mergedEmbeddedDigests[digestSource.name];
        if (digestSource.name === 'archiveSha256') {
          delete mergedEmbeddedDigests.archiveSha;
          delete mergedEmbeddedDigests.checksum;
        }
      }
      continue;
    }
    if (uniqueDigests.length === 1) {
      mergedResolution[digestSource.name] = uniqueDigests[0];
      if (digestSource.name === 'archiveSha256') {
        delete mergedResolution.archiveSha;
        delete mergedResolution.checksum;
      }
    }
  }

  if (mergedEvidence !== undefined && mergedEmbeddedDigests !== undefined) {
    mergedEvidence.knownDigests = mergedEmbeddedDigests;
    mergedResolution.evidence = mergedEvidence;
  }
  const converted = historicalUnpinnedResolution(mergedResolution, version);
  if (converted.kind !== 'unpinned') {
    return converted;
  }

  const knownPins: Record<string, string> = {};
  const preserveHistoricalPin = (name: string, value: string): void => {
    let key = name;
    let suffix = 1;
    while (
      (converted.evidence?.knownPins?.[key] !== undefined
        && converted.evidence.knownPins[key] !== value)
      || (knownPins[key] !== undefined && knownPins[key] !== value)
    ) {
      key = `${name}_${suffix}`;
      suffix += 1;
    }
    knownPins[key] = value;
  };
  for (const candidate of outerDigests) {
    if (
      typeof candidate.value === 'string'
      && normalizeSha256(candidate.value) === undefined
      && isSafeHistoricalValue(candidate.value)
    ) {
      preserveHistoricalPin(candidate.pinName, candidate.value);
    }
  }
  for (const [name, value] of Object.entries(conflicts)) {
    preserveHistoricalPin(name, value);
  }
  if (Object.keys(knownPins).length === 0) {
    return converted;
  }
  return {
    ...converted,
    evidence: {
      ...converted.evidence,
      knownPins: {
        ...converted.evidence?.knownPins,
        ...knownPins
      }
    }
  };
};

const getKnownResolution = (entry: JsonObject, version: string): BundleResolution | undefined => {
  const raw = entry.resolution;
  const resolution = getObject(raw);
  if (resolution && isStrictBundleResolution(raw)) {
    if (resolution.kind === 'unpinned') {
      return historicalResolutionFromEntry(resolution, entry, version);
    }
    try {
      assertResolutionVersion(raw, version);
      if (historicalOuterDigestCandidates(entry).some(({ name, value }) => {
        const normalized = normalizeSha256(value);
        return normalized !== undefined && normalized !== resolution[name];
      })) {
        return historicalResolutionFromEntry(resolution, entry, version);
      }
      return raw;
    } catch {
      return historicalResolutionFromEntry(resolution, entry, version);
    }
  }
  if (resolution) {
    return historicalResolutionFromEntry(resolution, entry, version);
  }
  if (historicalOuterDigestCandidates(entry).some(({ value }) =>
    typeof value === 'string' && isSafeHistoricalValue(value))) {
    return historicalResolutionFromEntry({}, entry, version);
  }
  return undefined;
};

const readVersion = (
  file: string,
  raw: JsonObject
): { major: number; version: string } => {
  const verdict = classifyLockfileVersion(raw.version);
  if (verdict.kind !== 'readable') {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  return { major: verdict.major, version: raw.version as string };
};

const hasLegacyDesiredShape = (raw: JsonObject): boolean => {
  if (!isObject(raw.bundles)) {
    return false;
  }
  return Object.entries(raw.bundles).some(([key, value]) => {
    const entry = getObject(value);
    return entry !== undefined
      && ((parseLogicalBundleKey(key) === null && !key.startsWith('unresolved/'))
        || 'sourceId' in entry
        || 'sourceType' in entry
        || 'archiveSha' in entry);
  });
};

const hasLegacyLocalShape = (raw: JsonObject): boolean => {
  if (!isObject(raw.targets)) {
    return raw.version === '2.0.0' && isObject(raw.bundles);
  }
  return Object.values(raw.targets).some((targetValue) => {
    const target = getObject(targetValue);
    if (!target || !isObject(target.bundles)) {
      return false;
    }
    return Object.entries(target.bundles).some(([key, recordValue]) => {
      const record = getObject(recordValue);
      return record !== undefined
        && (('sourceId' in record)
          || (parseLogicalBundleKey(key) === null && !key.startsWith('unresolved/'))
          || (!('sourceKey' in record) && !key.startsWith('unresolved/')));
    });
  });
};

const hasAmendedDesiredShape = (raw: JsonObject | null): boolean =>
  raw !== null
  && raw.version === '3.0.0'
  && isObject(raw.bundles)
  && Object.entries(raw.bundles).every(([key, entryValue]) => {
    const entry = getObject(entryValue);
    const parts = parseLogicalBundleKey(key);
    return entry !== undefined
      && parts !== null
      && entry.sourceKey === parts.sourceKey
      && typeof entry.version === 'string'
      && entry.resolution !== undefined
      && !('sourceId' in entry);
  });

const hasAmendedLocalShape = (raw: JsonObject | null): boolean =>
  raw !== null
  && raw.version === '3.0.0'
  && isObject(raw.targets)
  && Object.values(raw.targets).every((targetValue) => {
    const target = getObject(targetValue);
    return target !== undefined
      && isObject(target.bundles)
      && Object.entries(target.bundles).every(([key, recordValue]) => {
        const record = getObject(recordValue);
        if (!record) {
          return false;
        }
        const parts = parseLogicalBundleKey(key);
        if (
          parts !== null
          && record.sourceKey === parts.sourceKey
          && record.resolution !== undefined
          && !('sourceId' in record)
        ) {
          return true;
        }
        return /^unresolved\/[a-f0-9]{64}$/.test(key)
          && record.state === 'unmanaged'
          && record.sourceKey === undefined
          && record.resolution === undefined
          && isObject(record.legacy);
      });
  });

const sourceIdFor = (key: string, entry: JsonObject): string | undefined => {
  const recorded = getString(entry.sourceId);
  if (recorded !== undefined) {
    return recorded;
  }
  const slash = key.indexOf('/');
  return slash > 0 ? key.slice(0, slash) : undefined;
};

const descriptorFor = (sourceDocument: JsonObject, sourceId: string | undefined): JsonObject | undefined =>
  sourceId === undefined ? undefined : getObject(getObject(sourceDocument.sources)?.[sourceId]);

const localRootFor = (descriptor: JsonObject | undefined): string | undefined => {
  if (!descriptor || !['local', 'local-skills', 'local-awesome-copilot'].includes(String(descriptor.type))) {
    return undefined;
  }
  return getString(descriptor.url) ?? getString(descriptor.locator) ?? getString(descriptor.root);
};

const materializationEvidence = (row: LocalLegacyRow): LegacyMaterializationEvidence => {
  const files = Array.isArray(row.entry.files)
    ? row.entry.files.flatMap((fileValue) => {
      const file = getObject(fileValue);
      if (!file || typeof file.path !== 'string') {
        return [];
      }
      const evidence: LegacyMaterializationEvidence['files'][number] = { path: file.path };
      if (typeof file.checksum === 'string') {
        (evidence as { checksum?: string }).checksum = file.checksum;
      }
      if (typeof file.installedChecksum === 'string') {
        (evidence as { installedChecksum?: string }).installedChecksum = file.installedChecksum;
      }
      return [evidence];
    })
    : [];
  const configPath = getString(row.entry.mcpConfigPath)
    ?? getString(getObject(row.entry.mcp)?.configPath);
  const servers = Array.isArray(row.entry.mcpServers)
    ? row.entry.mcpServers.filter((item): item is string => typeof item === 'string')
    : (Array.isArray(getObject(row.entry.mcp)?.servers)
      ? (getObject(row.entry.mcp)?.servers as unknown[]).filter((item): item is string => typeof item === 'string')
      : []);
  return {
    targetName: row.targetName,
    targetType: getString(row.target.targetType) as TargetType | undefined,
    baseDir: getString(row.target.baseDir) ?? '',
    files,
    ...(configPath === undefined ? {} : { mcp: { configPath, servers } })
  };
};

const collectSnapshot = async (
  sources: MigrationSources,
  fs: Pick<LockfileFsWithRename, 'exists' | 'readFile'>
): Promise<MigrationSnapshot> => {
  const paths = [...sources.legacyFiles, sources.desiredFile, sources.localFile]
    .filter((path, index, all) => all.indexOf(path) === index);
  const documents = new Map<string, JsonObject>();
  let migrationRequired = false;
  for (const file of paths) {
    if (!(await fs.exists(file))) {
      continue;
    }
    const parsed = JSON.parse(await fs.readFile(file)) as unknown;
    if (!isObject(parsed)) {
      throw new Error(`${file} must contain a JSON object.`);
    }
    const { major } = readVersion(file, parsed);
    if (file === sources.localFile && major === 2) {
      throw new LockfileGenerationMismatchError(file, major, 3);
    }
    if (major === 2) {
      migrationRequired = true;
    } else if (major === 3 && (hasLegacyDesiredShape(parsed) || hasLegacyLocalShape(parsed))) {
      migrationRequired = true;
    }
    documents.set(file, parsed);
  }

  const desiredCandidates = [...sources.legacyFiles, sources.desiredFile]
    .map((path) => ({ path, raw: documents.get(path) }))
    .filter((item): item is { path: string; raw: JsonObject } => {
      if (item.raw === undefined) {
        return false;
      }
      if (item.raw.version === '2.0.0') {
        return isObject(item.raw.bundles);
      }
      return !isObject(item.raw.targets) && isObject(item.raw.bundles);
    });
  const desiredSource = desiredCandidates.find(({ path, raw }) =>
    path === sources.desiredFile && raw.version === '3.0.0'
  )
  ?? desiredCandidates.find(({ raw }) => raw.version === '2.0.0' || hasLegacyDesiredShape(raw))
  ?? desiredCandidates.find(({ path }) => path === sources.desiredFile);
  const desired = desiredSource?.raw ?? null;

  const localCandidates = [...sources.legacyFiles, sources.localFile]
    .map((path) => ({ path, raw: documents.get(path) }))
    .filter((item): item is { path: string; raw: JsonObject } => item.raw !== undefined);
  const localSource = localCandidates.find(({ path }) => path === sources.localFile)
    ?? localCandidates
      .filter(({ path }) => path !== desiredSource?.path)
      .find(({ raw }) => isObject(raw.targets) || raw.version === '2.0.0');
  const local = localSource?.raw ?? null;
  const completedAmendedPair = getObject(local?.migration)?.lockfileV3 === 'complete'
    && hasAmendedDesiredShape(desired)
    && hasAmendedLocalShape(local);

  const legacyDesired: DesiredLegacyRow[] = [];
  const isLegacyDesiredSource = ({ raw }: { raw: JsonObject }): boolean =>
    raw.version === '2.0.0' || hasLegacyDesiredShape(raw);
  const legacyDesiredSources = new Map<string, (typeof desiredCandidates)[number]>();
  if (!completedAmendedPair) {
    if (desiredSource && isLegacyDesiredSource(desiredSource)) {
      legacyDesiredSources.set(desiredSource.path, desiredSource);
    }
    if (desiredSource?.path === sources.desiredFile) {
      const priorDesiredSource = desiredCandidates.find(({ path, raw }) =>
        path !== sources.desiredFile
        && (raw.version === '2.0.0' || hasLegacyDesiredShape(raw))
      );
      if (priorDesiredSource) {
        legacyDesiredSources.set(priorDesiredSource.path, priorDesiredSource);
      }
    }
  }
  for (const { raw: sourceDocument } of legacyDesiredSources.values()) {
    if (!isObject(sourceDocument.bundles)) {
      continue;
    }
    for (const [legacyKey, value] of Object.entries(sourceDocument.bundles)) {
      const entry = getObject(value);
      if (!entry) {
        continue;
      }
      const sourceId = sourceIdFor(legacyKey, entry);
      legacyDesired.push({
        legacyKey,
        entry,
        sourceId,
        sourceDescriptor: descriptorFor(sourceDocument, sourceId),
        sourceDocument
      });
    }
  }
  if (legacyDesired.length > 0) {
    migrationRequired = true;
  }

  const legacyLocal: LocalLegacyRow[] = [];
  const localSources = completedAmendedPair
    ? []
    : localCandidates.filter(({ raw }) => raw.version === '2.0.0' || hasLegacyLocalShape(raw));
  if (
    !completedAmendedPair
    && desired?.version === '2.0.0'
    && !localSources.some(({ path }) => path === desiredSource?.path)
  ) {
    localSources.push({ path: desiredSource?.path ?? sources.desiredFile, raw: desired });
  }
  for (const { raw } of localSources) {
    const sourceDocument = desiredSource?.raw ?? raw;
    if (isObject(raw.targets)) {
      for (const [targetName, targetValue] of Object.entries(raw.targets)) {
        const target = getObject(targetValue);
        if (!target || !isObject(target.bundles)) {
          continue;
        }
        for (const [legacyKey, recordValue] of Object.entries(target.bundles)) {
          const entry = getObject(recordValue);
          if (!entry || (parseLogicalBundleKey(legacyKey) !== null && !('sourceId' in entry))) {
            continue;
          }
          const sourceId = sourceIdFor(legacyKey, entry)
            ?? legacyDesired.find((row) => row.legacyKey === legacyKey)?.sourceId;
          const desiredEvidence = legacyDesired.find((row) => row.legacyKey === legacyKey);
          legacyLocal.push({
            legacyKey,
            entry,
            sourceId,
            sourceDescriptor: descriptorFor(sourceDocument, sourceId) ?? desiredEvidence?.sourceDescriptor,
            targetName,
            target,
            sourceDocument
          });
        }
      }
    } else if (isObject(raw.bundles)) {
      const target: JsonObject = { baseDir: '', bundles: {} };
      for (const [legacyKey, recordValue] of Object.entries(raw.bundles)) {
        const entry = getObject(recordValue);
        if (!entry) {
          continue;
        }
        const sourceId = sourceIdFor(legacyKey, entry)
          ?? legacyDesired.find((row) => row.legacyKey === legacyKey)?.sourceId;
        const desiredEvidence = legacyDesired.find((row) => row.legacyKey === legacyKey);
        legacyLocal.push({
          legacyKey,
          entry,
          sourceId,
          sourceDescriptor: descriptorFor(sourceDocument, sourceId) ?? desiredEvidence?.sourceDescriptor,
          targetName: UNMANAGED_TARGET_KEY,
          target,
          sourceDocument
        });
      }
    }
  }
  if (legacyLocal.length > 0) {
    migrationRequired = true;
  }

  const activeLocal = local !== null && isObject(local.targets)
    ? Object.values(local.targets).some((targetValue) => {
      const target = getObject(targetValue);
      return target !== undefined
        && isObject(target.bundles)
        && Object.entries(target.bundles).some(([key, recordValue]) => {
          const record = getObject(recordValue);
          return record !== undefined
            && parseLogicalBundleKey(key) !== null
            && 'sourceKey' in record
            && 'resolution' in record
            && isObject(record.legacy)
            && 'portableDescriptor' in record.legacy;
        });
    })
    : false;
  if (activeLocal) {
    migrationRequired = true;
  }

  if (completedAmendedPair && sources.legacyFiles.some((path) => documents.has(path))) {
    migrationRequired = true;
  }

  const marker = getObject(local?.migration)?.lockfileV3;
  const hasRetainedEvidence = (desired && Array.isArray(desired.unresolved) && desired.unresolved.length > 0)
    || (local && isObject(local.targets) && Object.values(local.targets).some((targetValue) => {
      const target = getObject(targetValue);
      return target !== undefined && isObject(target.bundles)
        && Object.values(target.bundles).some((recordValue) => {
          const record = getObject(recordValue);
          return record !== undefined && isObject(record.legacy);
        });
    }));
  if (marker !== 'complete' && hasRetainedEvidence) {
    migrationRequired = true;
  }

  return {
    desired,
    local,
    legacyDesired,
    legacyLocal,
    legacyFiles: [...sources.legacyFiles].filter((path) => documents.has(path)),
    migrationRequired
  };
};

const resolutionForInput = (entry: JsonObject, version: string): BundleResolution | undefined =>
  getKnownResolution(entry, version);

const makeIdentityRows = (
  snapshot: MigrationSnapshot,
  options: LockfileMigrationOptions
): IdentityPlanRow[] => {
  const rows: IdentityPlanRow[] = [];
  const supplied = new Map<string, VerifiedLegacyIdentityEvidence>();
  if (snapshot.local && isObject(snapshot.local.targets)) {
    for (const targetValue of Object.values(snapshot.local.targets)) {
      const target = getObject(targetValue);
      if (!target || !isObject(target.bundles)) {
        continue;
      }
      for (const [key, recordValue] of Object.entries(target.bundles)) {
        const record = getObject(recordValue);
        const legacy = getObject(record?.legacy);
        const parts = parseLogicalBundleKey(key);
        const portableDescriptor = getObject(legacy?.portableDescriptor) as PortableSourceDescriptor | undefined;
        const legacyKey = getString(legacy?.originalKey);
        const version = getString(legacy?.version) ?? getString(record?.version);
        if (!record || !legacy || !parts || !portableDescriptor || !legacyKey || !version) {
          continue;
        }
        try {
          const recordSourceKey = getString(record.sourceKey);
          if (recordSourceKey !== parts.sourceKey) {
            continue;
          }
          assertSourceKey(recordSourceKey, portableDescriptor);
          supplied.set(
            `${legacyKey}\u0000${version}\u0000${getString(legacy.sourceRef) ?? ''}`,
            {
              legacyKey,
              version,
              sourceId: getString(legacy.sourceRef),
              proven: { source: portableDescriptor, logicalBundleId: parts.logicalBundleId },
              knownResolution: getKnownResolution({ resolution: legacy.knownResolution }, version)
                ?? getKnownResolution({ resolution: record.resolution }, version)
            }
          );
        } catch {
          continue;
        }
      }
    }
  }
  for (const proof of options.identityEvidence ?? []) {
    const key = `${proof.legacyKey}\u0000${proof.version ?? ''}\u0000${proof.sourceId ?? ''}`;
    supplied.set(key, proof);
  }
  const add = (
    legacyKey: string,
    entry: JsonObject,
    sourceId: string | undefined,
    descriptor: JsonObject | undefined,
    desiredRow?: DesiredLegacyRow,
    localRow?: LocalLegacyRow
  ): void => {
    const version = getString(entry.version) ?? getString(desiredRow?.entry.version) ?? '';
    const suppliedEvidence = supplied.get(`${legacyKey}\u0000${version}\u0000${sourceId ?? ''}`)
      ?? supplied.get(`${legacyKey}\u0000\u0000`);
    const storedResolution = resolutionForInput(entry, version);
    const desiredResolution = desiredRow === undefined || desiredRow.entry === entry
      ? undefined
      : resolutionForInput(desiredRow.entry, version);
    const knownResolution = storedResolution
      ?? desiredResolution
      ?? suppliedEvidence?.knownResolution;
    const root = localRootFor(descriptor);
    const input: LegacyIdentityInput = {
      legacyKey,
      version,
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(descriptor === undefined ? {} : { descriptor }),
      ...(root === undefined ? {} : { originalLocalRoot: root }),
      ...(knownResolution === undefined ? {} : { knownResolution }),
      ...(suppliedEvidence?.proven === undefined ? {} : { proven: suppliedEvidence.proven }),
      ...(localRow === undefined ? {} : { materializations: [materializationEvidence(localRow)] })
    };
    const row: IdentityPlanRow = { input, desiredRows: [], localRows: [] };
    if (desiredRow !== undefined && localRow === undefined) {
      row.desiredRows.push(desiredRow);
    }
    if (localRow !== undefined) {
      row.localRows.push(localRow);
    }
    rows.push(row);
  };

  for (const desiredRow of snapshot.legacyDesired) {
    add(
      desiredRow.legacyKey,
      desiredRow.entry,
      desiredRow.sourceId,
      desiredRow.sourceDescriptor,
      desiredRow
    );
  }
  for (const localRow of snapshot.legacyLocal) {
    add(
      localRow.legacyKey,
      localRow.entry,
      localRow.sourceId,
      localRow.sourceDescriptor,
      snapshot.legacyDesired.find((row) => row.legacyKey === localRow.legacyKey),
      localRow
    );
  }
  return rows;
};

const materializationRecord = (
  row: LocalLegacyRow,
  input: LegacyIdentityInput,
  decision: ReturnType<typeof classifyLegacyIdentity>,
  unresolvedReason?: string
): LockfileV3BundleRecord => {
  const files = Array.isArray(row.entry.files)
    ? row.entry.files.flatMap((fileValue) => {
      const file = getObject(fileValue);
      if (!file || typeof file.path !== 'string') {
        return [];
      }
      const projected: Record<string, unknown> = { path: file.path };
      for (const field of ['checksum', 'installedChecksum', 'adoptedAtMigration'] as const) {
        if (field === 'adoptedAtMigration') {
          if (file[field] === true) {
            projected[field] = true;
          }
        } else {
          const checksum = file[field];
          if (typeof checksum === 'string' && /^(?:[a-z0-9]+:)?[a-f0-9]{64}$/.test(checksum)) {
            projected[field] = checksum;
          }
        }
      }
      return [projected];
    })
    : [];
  const installedAt = getString(row.entry.installedAt);
  if (installedAt === undefined) {
    throw new Error(`Legacy materialization ${row.legacyKey} has no installedAt evidence.`);
  }
  const record: Record<string, unknown> = {
    version: input.version,
    installedAt,
    files
  };
  const commitMode = getString(row.entry.commitMode) as RepositoryCommitMode | undefined
    ?? getString(row.target.commitMode) as RepositoryCommitMode | undefined;
  if (commitMode === 'commit' || commitMode === 'local-only') {
    record.commitMode = commitMode;
  }
  if (row.entry.linked === true) {
    record.linked = true;
  }
  if (row.entry.complete === true) {
    record.complete = true;
  }
  const mcpConfigPath = getString(row.entry.mcpConfigPath)
    ?? getString(getObject(row.entry.mcp)?.configPath);
  const mcpServers = Array.isArray(row.entry.mcpServers)
    ? row.entry.mcpServers.filter((item): item is string => typeof item === 'string')
    : (Array.isArray(getObject(row.entry.mcp)?.servers)
      ? (getObject(row.entry.mcp)?.servers as unknown[]).filter((item): item is string => typeof item === 'string')
      : undefined);
  if (mcpConfigPath !== undefined) {
    record.mcpConfigPath = mcpConfigPath;
  }
  if (mcpServers !== undefined) {
    record.mcpServers = [...new Set(mcpServers)].toSorted();
  }

  const targetType = getString(row.target.targetType);
  const targetHasBinding = row.targetName !== UNMANAGED_TARGET_KEY
    && targetType !== undefined
    && getString(row.target.scope) !== undefined
    && getString(row.target.baseDir) !== undefined;
  const live = decision.kind === 'mapped' && decision.resolution.kind === 'live' && row.entry.linked === true;
  const hasInstalledBaselines = files.every((file) => typeof file.installedChecksum === 'string');
  const managed = decision.kind === 'mapped' && targetHasBinding && (live || hasInstalledBaselines);
  const legacyDecision = classifyLegacyIdentity({
    ...input,
    proven: undefined
  });
  if (legacyDecision.kind !== 'unresolved') {
    throw new Error('Legacy evidence projection unexpectedly produced a mapped identity.');
  }
  const legacyEvidence: LegacyIdentityEvidence = decision.kind === 'mapped'
    ? {
      ...legacyDecision.evidence,
      portableDescriptor: decision.source
    }
    : decision.evidence;

  if (decision.kind === 'mapped') {
    record.sourceKey = decision.source.type
      ? portableSourceKey(decision.source.identity, decision.source.type)
      : '';
    record.resolution = decision.resolution;
    if (managed) {
      record.legacy = legacyEvidence;
    } else {
      record.state = 'unmanaged';
      record.unmanagedReason = unresolvedReason
        ?? (targetHasBinding
          ? 'Installed-file baseline was not fully verified during offline migration.'
          : 'Legacy destination binding could not be proven during offline migration.');
    }
  } else {
    record.state = 'unmanaged';
    record.unmanagedReason = unresolvedReason ?? decision.desired.reason;
  }
  if (!managed) {
    record.legacy = legacyEvidence;
  }

  return record as unknown as LockfileV3BundleRecord;
};

const targetFromLegacyRow = (row: LocalLegacyRow): LockfileV3TargetRecord => {
  const target: LockfileV3TargetRecord = {
    baseDir: getString(row.target.baseDir) ?? '',
    bundles: {}
  };
  const targetType = getString(row.target.targetType);
  if (targetType !== undefined) {
    target.targetType = targetType as TargetType;
  }
  const scope = getString(row.target.scope);
  if (scope === 'user' || scope === 'workspace' || scope === 'repository') {
    target.scope = scope;
  }
  const commitMode = getString(row.target.commitMode);
  if (commitMode === 'commit' || commitMode === 'local-only') {
    target.commitMode = commitMode;
  }
  return target;
};

const isAlreadyUnresolved = (key: string, entry: JsonObject): boolean =>
  /^unresolved\/[a-f0-9]{64}$/.test(key)
  && entry.state === 'unmanaged'
  && entry.sourceKey === undefined
  && entry.resolution === undefined
  && isObject(entry.legacy);

const copyCurrentDesired = (raw: JsonObject | null): DesiredLockfileV3 => {
  if (!raw || !isObject(raw.bundles)) {
    return emptyDesiredLockfileV3();
  }
  const desired = emptyDesiredLockfileV3();
  if (raw.version === '3.0.0') {
    desired.bundles = Object.fromEntries(Object.entries(raw.bundles).filter(([key, value]) => {
      const entry = getObject(value);
      return parseLogicalBundleKey(key) !== null
        && entry !== undefined
        && getString(entry.sourceKey) !== undefined
        && entry.resolution !== undefined;
    })) as Record<string, LockfileV3DesiredEntry>;
  }
  if (raw.version === '3.0.0' && isObject(raw.sources)) {
    desired.sources = Object.fromEntries(Object.entries(raw.sources).filter(([key, value]) => {
      const descriptor = getObject(value) as PortableSourceDescriptor | undefined;
      if (!descriptor || !/^src-[a-f0-9]{64}$/.test(key)) {
        return false;
      }
      try {
        assertSourceKey(key, descriptor);
        return true;
      } catch {
        return false;
      }
    })) as Record<string, PortableSourceDescriptor>;
  }
  if (raw.version === '3.0.0' && Array.isArray(raw.unresolved)) {
    desired.unresolved = [...raw.unresolved] as LegacyDesiredIntent[];
  }
  if (isObject(raw.hubs)) {
    desired.hubs = { ...raw.hubs } as DesiredLockfileV3['hubs'];
  }
  if (isObject(raw.profiles)) {
    desired.profiles = { ...raw.profiles } as DesiredLockfileV3['profiles'];
  }
  return desired;
};

const copyCurrentLocal = (
  raw: JsonObject | null,
  options: LockfileMigrationOptions
): LocalLockfileV3 => {
  if (!raw || raw.version !== '3.0.0' || !isObject(raw.targets)) {
    return emptyLocalLockfileV3(options.generatedBy, options.now);
  }
  const targets: LocalLockfileV3['targets'] = {};
  for (const [targetName, targetValue] of Object.entries(raw.targets)) {
    const target = getObject(targetValue);
    if (!target || !isObject(target.bundles)) {
      continue;
    }
    const bundles = Object.fromEntries(Object.entries(target.bundles).filter(([key, recordValue]) => {
      const record = getObject(recordValue);
      return record !== undefined && (
        (parseLogicalBundleKey(key) !== null
          && getString(record.sourceKey) !== undefined
          && record.resolution !== undefined)
        || isAlreadyUnresolved(key, record)
      );
    })) as LockfileV3TargetRecord['bundles'];
    if (Object.keys(bundles).length === 0) {
      continue;
    }
    targets[targetName] = {
      ...(getString(target.targetType) === undefined ? {} : { targetType: target.targetType as TargetType }),
      ...(getString(target.scope) === undefined ? {} : { scope: target.scope as 'user' | 'workspace' | 'repository' }),
      baseDir: getString(target.baseDir) ?? '',
      ...(target.commitMode === 'commit' || target.commitMode === 'local-only'
        ? { commitMode: target.commitMode }
        : {}),
      bundles
    };
  }
  return {
    version: '3.0.0',
    generatedAt: getString(raw.generatedAt) ?? options.now,
    generatedBy: getString(raw.generatedBy) ?? options.generatedBy,
    ...(getObject(raw.migration)?.lockfileV3 === 'complete'
      ? { migration: { lockfileV3: 'complete' as const } }
      : {}),
    targets
  };
};

const ensureTarget = (
  local: LocalLockfileV3,
  targetName: string,
  source: LocalLegacyRow
): LockfileV3TargetRecord => {
  const current = local.targets[targetName];
  if (current !== undefined) {
    return current;
  }
  const target = targetFromLegacyRow(source);
  local.targets[targetName] = target;
  return target;
};

const mergeMaterialization = (
  target: LockfileV3TargetRecord,
  key: string,
  incoming: LockfileV3BundleRecord
): void => {
  const existing = target.bundles[key];
  if (existing === undefined) {
    target.bundles[key] = incoming;
    return;
  }
  const mergedFiles = [...existing.files];
  for (const file of incoming.files) {
    const old = mergedFiles.find((candidate) => candidate.path === file.path);
    if (old === undefined) {
      mergedFiles.push(file);
    } else {
      old.checksum ??= file.checksum;
      old.installedChecksum ??= file.installedChecksum;
      if (file.adoptedAtMigration === true) {
        old.adoptedAtMigration = true;
      }
    }
  }
  const combinedServers = [...new Set([...(existing.mcpServers ?? []), ...(incoming.mcpServers ?? [])])].toSorted();
  existing.files = mergedFiles;
  if (combinedServers.length > 0) {
    existing.mcpServers = combinedServers;
  }
  existing.mcpConfigPath ??= incoming.mcpConfigPath;
  existing.legacy ??= incoming.legacy;
};

const decisionForInput = (
  input: LegacyIdentityInput,
  decisions: readonly ReturnType<typeof classifyLegacyIdentity>[]
): ReturnType<typeof classifyLegacyIdentity> => {
  if (input.proven !== undefined) {
    const key = `${portableSourceKey(input.proven.source.identity, input.proven.source.type)}/${input.proven.logicalBundleId}`;
    const mapped = decisions.find((decision) => decision.kind === 'mapped' && decision.key === key);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  const expected = classifyLegacyIdentity({ ...input, proven: undefined });
  if (expected.kind !== 'unresolved') {
    return expected;
  }
  const unresolved = decisions.find((decision) =>
    decision.kind === 'unresolved'
    && decision.evidence.originalKey === input.legacyKey
    && decision.evidence.version === input.version
    && decision.evidence.sourceRef === expected.evidence.sourceRef
    && stableJson(decision.evidence.descriptor) === stableJson(expected.evidence.descriptor)
    && stableJson(decision.evidence.knownResolution) === stableJson(input.knownResolution)
    && decision.evidence.originalLocalRoot === input.originalLocalRoot
  );
  return unresolved ?? classifyLegacyIdentity(input);
};

const retainDecision = (
  input: LegacyIdentityInput,
  reason: string,
  source?: PortableSourceDescriptor
): ReturnType<typeof classifyLegacyIdentity> => {
  const decision = classifyLegacyIdentity({ ...input, proven: undefined });
  if (decision.kind === 'unresolved') {
    decision.desired.reason = reason;
    if (source !== undefined) {
      decision.evidence.portableDescriptor = source;
    }
  }
  return decision;
};

const conflictsWithExistingMaterialization = (
  input: LegacyIdentityInput,
  decision: Extract<ReturnType<typeof classifyLegacyIdentity>, { kind: 'mapped' }>,
  rows: readonly LocalLegacyRow[],
  local: LocalLockfileV3
): boolean => rows.some((row) => {
  const existing = local.targets[row.targetName]?.bundles[decision.key];
  if (existing === undefined) {
    return false;
  }
  if (
    existing.version !== input.version
    || existing.sourceKey !== portableSourceKey(decision.source.identity, decision.source.type)
    || stableJson(existing.resolution) !== stableJson(decision.resolution)
  ) {
    return true;
  }
  const incomingMcpConfigPath = getString(row.entry.mcpConfigPath)
    ?? getString(getObject(row.entry.mcp)?.configPath);
  if (
    incomingMcpConfigPath !== undefined
    && existing.mcpConfigPath !== undefined
    && incomingMcpConfigPath !== existing.mcpConfigPath
  ) {
    return true;
  }
  const existingFiles = new Map(existing.files.map((file) => [file.path, file]));
  return (row.entry.files as unknown[] | undefined)?.some((fileValue) => {
    const file = getObject(fileValue);
    if (!file || typeof file.path !== 'string') {
      return false;
    }
    const previous = existingFiles.get(file.path);
    return previous !== undefined
      && ((typeof file.checksum === 'string'
        && previous.checksum !== undefined
        && file.checksum !== previous.checksum)
      || (typeof file.installedChecksum === 'string'
        && previous.installedChecksum !== undefined
        && file.installedChecksum !== previous.installedChecksum));
  }) ?? false;
});

const buildPair = (
  snapshot: MigrationSnapshot,
  options: LockfileMigrationOptions
): { pair: LockfileV3Pair; report: MigrationReport } => {
  const desired = copyCurrentDesired(snapshot.desired);
  const local = copyCurrentLocal(snapshot.local, options);
  delete local.migration;
  const report: MigrationReport = { migrated: [], unmanaged: [] };
  const identityRows = makeIdentityRows(snapshot, options);
  const decisions = planIdentityMappings(identityRows.map(({ input }) => input));

  for (const row of identityRows) {
    let decision = decisionForInput(row.input, decisions);
    if (decision.kind === 'mapped' && conflictsWithExistingMaterialization(row.input, decision, row.localRows, local)) {
      decision = retainDecision(
        row.input,
        'Legacy materialization conflicts with an already-migrated ownership record.',
        decision.source
      );
    }
    if (decision.kind === 'mapped') {
      const sourceKey = portableSourceKey(decision.source.identity, decision.source.type);
      if (row.desiredRows.length > 0) {
        const migratedEntry: LockfileV3DesiredEntry = {
          version: row.input.version,
          sourceKey,
          resolution: canonicalValue(decision.resolution) as BundleResolution
        };
        const activeEntry = desired.bundles[decision.key];
        const existingSource = desired.sources[sourceKey];
        if (
          (existingSource !== undefined && stableJson(existingSource) !== stableJson(decision.source))
          || (activeEntry !== undefined && stableJson(activeEntry) !== stableJson(migratedEntry))
        ) {
          decision = retainDecision(
            row.input,
            'Legacy intent conflicts with an already-migrated portable entry.',
            decision.source
          );
        } else {
          desired.sources[sourceKey] ??= canonicalValue(decision.source) as PortableSourceDescriptor;
          if (activeEntry === undefined) {
            desired.bundles[decision.key] = migratedEntry;
          }
        }
      }
      if (decision.kind === 'mapped') {
        report.migrated.push(decision.key);
      }
    }

    if (decision.kind === 'unresolved') {
      if (row.desiredRows.length > 0) {
        (desired.unresolved ??= []).push(decision.desired);
      }
      for (const localRow of row.localRows) {
        const key = legacyIdentityRetentionKey(
          decision.evidence,
          materializationEvidence(localRow)
        );
        const targetName = localRow.targetName === UNMANAGED_TARGET_KEY
          ? UNMANAGED_TARGET_KEY
          : localRow.targetName;
        const target = ensureTarget(local, targetName, localRow);
        const record = materializationRecord(
          localRow,
          row.input,
          decision,
          decision.desired.reason
        );
        mergeMaterialization(target, key, record);
        report.unmanaged.push({ key, reason: decision.desired.reason });
      }
    } else {
      for (const localRow of row.localRows) {
        const key = decision.key;
        if (options.triggeredByKey === key) {
          report.migrated.push(key);
          continue;
        }
        const targetName = localRow.targetName === UNMANAGED_TARGET_KEY
          ? UNMANAGED_TARGET_KEY
          : localRow.targetName;
        const target = ensureTarget(local, targetName, localRow);
        const record = materializationRecord(localRow, row.input, decision);
        mergeMaterialization(target, key, record);
        if ('state' in record && record.state === 'unmanaged') {
          report.unmanaged.push({
            key,
            reason: ('unmanagedReason' in record ? record.unmanagedReason : undefined)
              ?? 'Legacy materialization remains unmanaged.'
          });
        }
      }
    }
  }

  desired.bundles = sortedObject(desired.bundles);
  desired.sources = sortedObject(desired.sources);
  for (const [key, entry] of Object.entries(desired.bundles)) {
    desired.bundles[key] = canonicalValue(entry) as LockfileV3DesiredEntry;
  }
  for (const [key, source] of Object.entries(desired.sources)) {
    desired.sources[key] = canonicalValue(source) as PortableSourceDescriptor;
  }
  if (desired.hubs !== undefined) {
    desired.hubs = canonicalValue(sortedObject(desired.hubs)) as DesiredLockfileV3['hubs'];
  }
  if (desired.profiles !== undefined) {
    desired.profiles = canonicalValue(sortedObject(desired.profiles)) as DesiredLockfileV3['profiles'];
  }
  if (desired.unresolved !== undefined) {
    const unique = new Map(desired.unresolved.map((intent) => [stableJson(intent), intent]));
    desired.unresolved = [...unique.values()].toSorted((left, right) =>
      compareText(left.originalKey, right.originalKey)
      || compareText(left.version, right.version)
      || compareText(stableJson(left), stableJson(right))
    );
    desired.unresolved = desired.unresolved.map((intent) => canonicalValue(intent) as LegacyDesiredIntent);
    if (desired.unresolved.length === 0) {
      delete desired.unresolved;
    }
  }
  for (const target of Object.values(local.targets)) {
    target.bundles = sortedObject(target.bundles);
  }
  local.targets = sortedObject(local.targets);
  report.migrated = [...new Set(report.migrated)].toSorted();
  report.unmanaged = [...new Map(report.unmanaged.map((item) => [stableJson(item), item])).values()]
    .toSorted((a, b) => compareText(a.key, b.key) || compareText(a.reason, b.reason));
  return { pair: { desired, local }, report };
};

const removeTemporaryMappings = (local: LocalLockfileV3): void => {
  for (const target of Object.values(local.targets)) {
    for (const record of Object.values(target.bundles)) {
      if (
        record.sourceKey === undefined
        || record.resolution === undefined
        || record.legacy?.portableDescriptor === undefined
      ) {
        continue;
      }
      if ('state' in record && record.state === 'unmanaged') {
        delete record.legacy.portableDescriptor;
      } else {
        delete record.legacy;
      }
    }
  }
};

/**
 * Convert one v2 lockfile to the amended strict v3 pair.
 * @param v2 - Legacy lockfile.
 * @param options - Generation and optional verified identity evidence.
 */
export const convertV2ToPair = (
  v2: Lockfile,
  options: LockfileMigrationOptions
): { pair: LockfileV3Pair; report: MigrationReport } => {
  const snapshot: MigrationSnapshot = {
    desired: v2 as unknown as JsonObject,
    local: null,
    legacyDesired: Object.entries(v2.bundles).map(([legacyKey, value]) => ({
      legacyKey,
      entry: value as unknown as JsonObject,
      sourceId: value.sourceId,
      sourceDescriptor: v2.sources[value.sourceId] as unknown as JsonObject,
      sourceDocument: v2 as unknown as JsonObject
    })),
    legacyLocal: Object.entries(v2.bundles).map(([legacyKey, value]) => ({
      legacyKey,
      entry: value as unknown as JsonObject,
      sourceId: value.sourceId,
      sourceDescriptor: v2.sources[value.sourceId] as unknown as JsonObject,
      targetName: UNMANAGED_TARGET_KEY,
      target: { baseDir: '', bundles: {} },
      sourceDocument: v2 as unknown as JsonObject
    })),
    legacyFiles: [],
    migrationRequired: true
  };
  return buildPair(snapshot, options);
};

/**
 * Find the first legacy file, or the new desired path when no legacy file exists.
 * @param sources - Paths to the lockfiles.
 * @param fs - Filesystem existence probe.
 */
export const findLockfileSource = async (
  sources: MigrationSources,
  fs: Pick<LockfileFsWithRename, 'exists'>
): Promise<string | null> => {
  for (const legacyFile of sources.legacyFiles) {
    if (await fs.exists(legacyFile)) {
      return legacyFile;
    }
  }
  return await fs.exists(sources.desiredFile) ? sources.desiredFile : null;
};

/**
 * Read the pair as it stands, previewing any legacy conversion without writing.
 * @param sources
 * @param fs
 * @param options
 */
export const readLockfilePair = async (
  sources: MigrationSources,
  fs: LockfileFsWithRename,
  options: LockfileMigrationOptions
): Promise<{ pair: LockfileV3Pair; report: MigrationReport | null }> => {
  const plan = await planLockfileMigration(sources, fs, options);
  return { pair: plan.pair, report: plan.report };
};

/**
 * Compute the post-migration pair in memory. Does not write, delete, or resolve sources.
 * @param sources
 * @param fs
 * @param options
 */
export const planLockfileMigration = async (
  sources: MigrationSources,
  fs: LockfileFsWithRename,
  options: LockfileMigrationOptions
): Promise<{ pair: LockfileV3Pair; report: MigrationReport | null; pendingWrite: boolean }> => {
  const snapshot = await collectSnapshot(sources, fs);
  if (!snapshot.migrationRequired) {
    if (snapshot.desired !== null || snapshot.local !== null) {
      const { pair: currentPair } = await readLockfileV3Pair(sources, fs, options);
      return { pair: currentPair, report: null, pendingWrite: false };
    }
    return {
      pair: {
        desired: emptyDesiredLockfileV3(),
        local: emptyLocalLockfileV3(options.generatedBy, options.now)
      },
      report: null,
      pendingWrite: false
    };
  }
  const { pair, report } = buildPair(snapshot, options);
  return { pair, report, pendingWrite: true };
};

/**
 * Migrate legacy state in the §8.4 order, retaining temporary identity mappings until both
 * pair halves have been written. Restarts reconstruct mappings from local evidence only.
 * @param sources
 * @param fs
 * @param options
 */
export const migrateLockfileIfNeeded = async (
  sources: MigrationSources,
  fs: LockfileFsWithRename,
  options: LockfileMigrationOptions
): Promise<{ pair: LockfileV3Pair; report: MigrationReport | null }> => {
  const plan = await planLockfileMigration(sources, fs, options);
  if (!plan.pendingWrite) {
    return { pair: plan.pair, report: plan.report };
  }
  if (sources.legacyFiles.length > 0 && !fs.remove) {
    throw new Error('fs.remove is required when legacyFiles is non-empty, but the adapter does not provide it');
  }

  const pair = plan.pair;
  await writeV3File(sources.localFile, pair.local, fs);
  await writeV3File(sources.desiredFile, pair.desired, fs);
  for (const file of sources.legacyFiles) {
    if (await fs.exists(file)) {
      await fs.remove!(file);
    }
  }

  removeTemporaryMappings(pair.local);
  pair.local.migration = { lockfileV3: 'complete' };
  await writeV3File(sources.localFile, pair.local, fs);
  return { pair, report: plan.report };
};
