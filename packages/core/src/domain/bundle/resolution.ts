/**
 * Portable bundle selection and immutable artifact-resolution contracts.
 * @module domain/bundle/resolution
 */
import type {
  ExtractedFiles,
} from '../../ports/bundle-extractor';
import {
  RegistryError,
} from '../registry-error';
import type {
  LocalSourceLocation,
  PortableSourceDescriptor,
} from '../source/portable-identity';
import {
  assertPortableSourceDescriptor,
  isSafeDiagnosticValue,
} from '../source/portable-identity';

interface GithubReleasePin {
  kind: 'pinned';
  provider: 'github-release';
  version: string;
  releaseId: string;
  assetId: string;
  archiveSha256: string;
  tag?: string;
}

interface GithubTreePin {
  kind: 'pinned';
  provider: 'github-tree';
  version: string;
  commitSha: string;
  bundlePath: string;
  sourceContentSha256: string;
  externalInputs?: readonly ExternalInputPin[];
}

interface AzureDevOpsTreePin {
  kind: 'pinned';
  provider: 'azure-devops-tree';
  version: string;
  commitId: string;
  collectionPath: string;
  sourceContentSha256: string;
  externalInputs?: readonly ExternalInputPin[];
}

interface ArtifactoryObjectPin {
  kind: 'pinned';
  provider: 'artifactory-object';
  version: string;
  manifestPath: string;
  manifestSize: number;
  manifestSha256: string;
  archivePath: string;
  archiveSize: number;
  archiveSha256: string;
}

interface LocalSnapshotPin {
  kind: 'pinned';
  provider: 'local-snapshot';
  version: string;
  bundleSelector: string;
  sourceContentSha256: string;
}

/** A selected input outside the pinned provider tree. */
export interface ExternalInputPin {
  identity: string;
  sourceContentSha256: string;
}

/** A verified, adapter-specific artifact pin. */
export type PinnedBundleResolution =
  | GithubReleasePin
  | GithubTreePin
  | AzureDevOpsTreePin
  | ArtifactoryObjectPin
  | LocalSnapshotPin;

/** Historical pins that are known but insufficient to claim reproducibility. */
export interface UnpinnedResolutionEvidence {
  knownPins?: Readonly<Record<string, string>>;
  knownDigests?: {
    archiveSha256?: string;
    sourceContentSha256?: string;
    manifestSha256?: string;
  };
  manifestVersion?: string;
  externalInputLimitations?: readonly string[];
}

export interface UnpinnedBundleResolution {
  kind: 'unpinned';
  reason: string;
  evidence?: UnpinnedResolutionEvidence;
}

/** Explicitly mutable local-skills selection. */
export interface LiveBundleResolution {
  kind: 'live';
  selector: string;
}

/** A verified pin, retained historical evidence, or deliberate live source. */
export type BundleResolution =
  | PinnedBundleResolution
  | UnpinnedBundleResolution
  | LiveBundleResolution;

/** Bundle files and verified metadata returned by a portable source adapter. */
export interface PortableBundlePayload {
  source: PortableSourceDescriptor;
  logicalBundleId: string;
  manifestId: string;
  version: string;
  resolution: BundleResolution;
  files: ExtractedFiles;
  /** Original source inventory used for tree/local content-pin verification. */
  sourceFiles?: ExtractedFiles;
  /** Original archive bytes for archive-backed deploy checksum preflight. */
  bytes?: Uint8Array;
}

/** Portable request plus machine-local binding information for bundle resolution. */
export interface PortableBundleSelection {
  bundleId: string;
  /** Exact direct-child bundle directory selected by a local acquisition. */
  bundleSelector?: string;
  version?: string;
  expectedSource?: PortableSourceDescriptor;
  resolution?: BundleResolution;
  localLocation?: LocalSourceLocation;
}

const invalidResolution = (detail: string): RegistryError => new RegistryError({
  code: 'BUNDLE.INVALID_RESOLUTION',
  message: `Bundle resolution is invalid: ${detail}`,
  hint: 'Use a complete provider pin, valid unpinned evidence, or an explicitly supported live selector.'
});

type ResolutionRecord = Record<string, unknown>;

const resolutionRecord = (value: unknown, label: string): ResolutionRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidResolution(`${label} must be an object.`);
  }
  return value as ResolutionRecord;
};

const resolutionKeys = (
  record: ResolutionRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string
): void => {
  const unexpected = Object.keys(record).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw invalidResolution(`${label} contains unsupported field ${JSON.stringify(unexpected)}.`);
  }
  const missing = required.find((key) => !Object.hasOwn(record, key));
  if (missing !== undefined) {
    throw invalidResolution(`${label} is missing required field ${JSON.stringify(missing)}.`);
  }
};

const resolutionText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidResolution(`${label} must be a non-empty string.`);
  }
  return value;
};

const resolutionSha256 = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw invalidResolution(`${label} must be a lowercase SHA-256 digest.`);
  }
};

const portableRelativePath = (value: string): boolean => (
  value.length > 0
  && !value.startsWith('/')
  && !/^[a-zA-Z]:/.test(value)
  && !value.includes('\\')
  && !value.includes('\0')
  && !value.includes('://')
  && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
);

const resolutionPath = (value: unknown, label: string): void => {
  const text = resolutionText(value, label);
  if (!portableRelativePath(text)) {
    throw invalidResolution(`${label} must be a canonical relative POSIX path.`);
  }
};

const requireResolutionShaField = (record: ResolutionRecord, field: string): void =>
  resolutionSha256(record[field], field);

/**
 * Validate every persisted resolution field, including provider coordinates and evidence.
 * @param value
 */
export const assertBundleResolution: (value: unknown) => asserts value is BundleResolution = (value) => {
  const resolution = resolutionRecord(value, 'resolution');
  const kind = resolutionText(resolution.kind, 'kind');
  if (kind === 'live') {
    resolutionKeys(resolution, ['kind', 'selector'], ['kind', 'selector'], 'live resolution');
    resolutionPath(resolution.selector, 'live resolution.selector');
    return;
  }
  if (kind === 'unpinned') {
    resolutionKeys(resolution, ['kind', 'reason', 'evidence'], ['kind', 'reason'], 'unpinned resolution');
    resolutionText(resolution.reason, 'unpinned resolution.reason');
    if (resolution.evidence !== undefined) {
      const evidence = resolutionRecord(resolution.evidence, 'unpinned evidence');
      resolutionKeys(
        evidence,
        ['knownPins', 'knownDigests', 'manifestVersion', 'externalInputLimitations'],
        [],
        'unpinned evidence'
      );
      if (evidence.knownPins !== undefined) {
        const knownPins = resolutionRecord(evidence.knownPins, 'unpinned knownPins');
        for (const [name, pin] of Object.entries(knownPins)) {
          if (/(token|password|secret|credential|authorization|api[_-]?key)/i.test(name)) {
            throw invalidResolution(`unpinned evidence cannot contain secret field ${JSON.stringify(name)}.`);
          }
          resolutionText(name, 'unpinned known pin name');
          const pinValue = resolutionText(pin, `unpinned known pin ${name}`);
          if (!isSafeDiagnosticValue(pinValue)) {
            throw invalidResolution(
              `unpinned evidence known pin ${JSON.stringify(name)} contains credential material or an unsafe URL.`
            );
          }
        }
      }
      if (evidence.knownDigests !== undefined) {
        const digests = resolutionRecord(evidence.knownDigests, 'unpinned knownDigests');
        resolutionKeys(digests, ['archiveSha256', 'sourceContentSha256', 'manifestSha256'], [], 'unpinned knownDigests');
        for (const [name, digest] of Object.entries(digests)) {
          resolutionSha256(digest, `unpinned known digest ${name}`);
        }
      }
      if (evidence.manifestVersion !== undefined) {
        resolutionText(evidence.manifestVersion, 'unpinned evidence.manifestVersion');
      }
      if (evidence.externalInputLimitations !== undefined
        && (!Array.isArray(evidence.externalInputLimitations)
          || evidence.externalInputLimitations.length === 0
          || evidence.externalInputLimitations.some((item) =>
            typeof item !== 'string' || item.trim() === ''))) {
        throw invalidResolution('unpinned evidence.externalInputLimitations must be an array of non-empty strings.');
      }
    }
    return;
  }
  if (kind !== 'pinned') {
    throw invalidResolution(`unknown kind ${JSON.stringify(kind)}.`);
  }

  const provider = resolutionText(resolution.provider, 'pinned resolution.provider');
  const common = ['kind', 'provider', 'version'];
  resolutionText(resolution.version, 'pinned resolution.version');
  let allowed: readonly string[];
  let required: readonly string[];
  switch (provider) {
    case 'github-release': {
      allowed = [...common, 'releaseId', 'assetId', 'archiveSha256', 'tag'];
      required = [...common, 'releaseId', 'assetId', 'archiveSha256'];
      break;
    }
    case 'github-tree': {
      allowed = [...common, 'commitSha', 'bundlePath', 'sourceContentSha256', 'externalInputs'];
      required = [...common, 'commitSha', 'bundlePath', 'sourceContentSha256'];
      break;
    }
    case 'azure-devops-tree': {
      allowed = [...common, 'commitId', 'collectionPath', 'sourceContentSha256', 'externalInputs'];
      required = [...common, 'commitId', 'collectionPath', 'sourceContentSha256'];
      break;
    }
    case 'artifactory-object': {
      allowed = [
        ...common, 'manifestPath', 'manifestSize', 'manifestSha256', 'archivePath', 'archiveSize', 'archiveSha256'
      ];
      required = [
        ...common, 'manifestPath', 'manifestSize', 'manifestSha256', 'archivePath', 'archiveSize', 'archiveSha256'
      ];
      break;
    }
    case 'local-snapshot': {
      allowed = [...common, 'bundleSelector', 'sourceContentSha256'];
      required = [...common, 'bundleSelector', 'sourceContentSha256'];
      break;
    }
    default: {
      throw invalidResolution(`unknown pinned provider ${JSON.stringify(provider)}.`);
    }
  }
  resolutionKeys(resolution, allowed, required, `${provider} resolution`);

  switch (provider) {
    case 'github-release': {
      for (const field of ['releaseId', 'assetId']) {
        if (typeof resolution[field] !== 'string' || !/^[1-9]\d*$/.test(resolution[field])) {
          throw invalidResolution(`pinned resolution.${field} must be a positive decimal GitHub provider ID.`);
        }
      }
      requireResolutionShaField(resolution, 'archiveSha256');
      if (resolution.tag !== undefined) {
        resolutionText(resolution.tag, 'pinned resolution.tag');
      }
      break;
    }
    case 'github-tree':
    case 'azure-devops-tree': {
      const commitField = provider === 'github-tree' ? 'commitSha' : 'commitId';
      if (typeof resolution[commitField] !== 'string' || !/^[a-f0-9]{40}$/.test(resolution[commitField])) {
        throw invalidResolution(`pinned resolution.${commitField} must be a 40-character lowercase commit ID.`);
      }
      resolutionPath(resolution[provider === 'github-tree' ? 'bundlePath' : 'collectionPath'], 'pinned selector');
      requireResolutionShaField(resolution, 'sourceContentSha256');
      if (resolution.externalInputs !== undefined) {
        if (!Array.isArray(resolution.externalInputs)) {
          throw invalidResolution('pinned resolution.externalInputs must be an array.');
        }
        for (const item of resolution.externalInputs) {
          const external = resolutionRecord(item, 'external input pin');
          resolutionKeys(external, ['identity', 'sourceContentSha256'], ['identity', 'sourceContentSha256'], 'external input pin');
          resolutionText(external.identity, 'external input pin identity');
          requireResolutionShaField(external, 'sourceContentSha256');
        }
      }
      break;
    }
    case 'artifactory-object': {
      resolutionPath(resolution.manifestPath, 'pinned resolution.manifestPath');
      resolutionPath(resolution.archivePath, 'pinned resolution.archivePath');
      for (const field of ['manifestSize', 'archiveSize']) {
        if (!Number.isSafeInteger(resolution[field]) || (resolution[field] as number) < 0) {
          throw invalidResolution(`pinned resolution.${field} must be a non-negative integer.`);
        }
      }
      requireResolutionShaField(resolution, 'manifestSha256');
      requireResolutionShaField(resolution, 'archiveSha256');
      break;
    }
    case 'local-snapshot': {
      resolutionPath(resolution.bundleSelector, 'pinned resolution.bundleSelector');
      requireResolutionShaField(resolution, 'sourceContentSha256');
      break;
    }
  }
};

const resolutionVersionError = (version: string, recordedVersion: string): RegistryError => new RegistryError({
  code: 'BUNDLE.RESOLUTION_VERSION_MISMATCH',
  message: `Requested version "${version}" does not match verified manifest version "${recordedVersion}".`,
  hint: 'Resolve the exact requested bundle version and do not substitute a different artifact.'
});

const resolutionMatchesSource = (
  source: PortableSourceDescriptor,
  resolution: BundleResolution
): boolean => {
  if (resolution.kind === 'unpinned') {
    return true;
  }
  if (resolution.kind === 'live') {
    return source.type === 'local-skills'
      && (source.identity.kind === 'workspace-local' || source.identity.kind === 'external-local');
  }
  switch (resolution.provider) {
    case 'github-release': {
      return source.type === 'github' && source.identity.kind === 'github-releases';
    }
    case 'github-tree': {
      return (source.type === 'skills' || source.type === 'awesome-copilot')
        && source.identity.kind === 'github-tree';
    }
    case 'azure-devops-tree': {
      return source.type === 'azure-devops' && source.identity.kind === 'azure-devops-tree';
    }
    case 'artifactory-object': {
      return source.type === 'artifactory' && source.identity.kind === 'artifactory-index';
    }
    case 'local-snapshot': {
      return (source.type === 'local' || source.type === 'local-awesome-copilot' || source.type === 'local-skills')
        && (source.identity.kind === 'workspace-local' || source.identity.kind === 'external-local');
    }
  }
  return false;
};

/**
 * Enforce that a selected resolution can be produced by its portable source family.
 * @param source
 * @param resolution
 */
export const assertResolutionSourceCompatibility = (
  source: PortableSourceDescriptor,
  resolution: BundleResolution
): void => {
  assertPortableSourceDescriptor(source);
  assertBundleResolution(resolution);
  if (!resolutionMatchesSource(source, resolution)) {
    throw new RegistryError({
      code: 'BUNDLE.RESOLUTION_SOURCE_MISMATCH',
      message: `Resolution ${resolution.kind === 'pinned' ? resolution.provider : resolution.kind} is incompatible with source type "${source.type}" and identity "${source.identity.kind}".`,
      hint: 'Use a provider resolution supported by the source family; live resolutions are only supported by local-skills.'
    });
  }
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const resolutionIdentity = (resolution: BundleResolution): Record<string, unknown> | null => {
  switch (resolution.kind) {
    case 'pinned': {
      switch (resolution.provider) {
        case 'github-release': {
          return {
            kind: resolution.kind,
            provider: resolution.provider,
            version: resolution.version,
            releaseId: resolution.releaseId,
            assetId: resolution.assetId,
            archiveSha256: resolution.archiveSha256
          };
        }
        case 'github-tree':
        case 'azure-devops-tree': {
          return {
            kind: resolution.kind,
            provider: resolution.provider,
            version: resolution.version,
            commit: resolution.provider === 'github-tree' ? resolution.commitSha : resolution.commitId,
            selector: resolution.provider === 'github-tree' ? resolution.bundlePath : resolution.collectionPath,
            sourceContentSha256: resolution.sourceContentSha256,
            externalInputs: resolution.externalInputs
              ?.toSorted((left, right) => left.identity < right.identity ? -1 : (left.identity > right.identity ? 1 : 0))
          };
        }
        case 'artifactory-object': {
          return {
            kind: resolution.kind,
            provider: resolution.provider,
            version: resolution.version,
            manifestPath: resolution.manifestPath,
            manifestSize: resolution.manifestSize,
            manifestSha256: resolution.manifestSha256,
            archivePath: resolution.archivePath,
            archiveSize: resolution.archiveSize,
            archiveSha256: resolution.archiveSha256
          };
        }
        case 'local-snapshot': {
          return {
            kind: resolution.kind,
            provider: resolution.provider,
            version: resolution.version,
            bundleSelector: resolution.bundleSelector,
            sourceContentSha256: resolution.sourceContentSha256
          };
        }
      }
      return null;
    }
    case 'unpinned': {
      const evidence = resolution.evidence;
      if (evidence === undefined
        || (evidence.knownPins === undefined
          && evidence.knownDigests === undefined
          && evidence.manifestVersion === undefined
          && evidence.externalInputLimitations === undefined)) {
        return null;
      }
      return {
        kind: resolution.kind,
        knownPins: evidence.knownPins,
        knownDigests: evidence.knownDigests,
        manifestVersion: evidence.manifestVersion,
        externalInputLimitations: evidence.externalInputLimitations === undefined
          ? undefined
          : evidence.externalInputLimitations.toSorted()
      };
    }
    case 'live': {
      return { kind: resolution.kind, selector: resolution.selector };
    }
  }
};

/**
 * Compare artifact coordinates and content digests, excluding display-only metadata.
 * @param a
 * @param b
 */
export const sameArtifactResolution = (a: BundleResolution, b: BundleResolution): boolean => {
  const left = resolutionIdentity(a);
  const right = resolutionIdentity(b);
  return left !== null && right !== null && stableJson(left) === stableJson(right);
};

/**
 * Ensure requested manifest version agrees with recorded evidence.
 * Historical unpinned records without version evidence remain unpinned.
 * @param resolution
 * @param version
 */
export const assertResolutionVersion = (resolution: BundleResolution, version: string): void => {
  assertBundleResolution(resolution);
  resolutionText(version, 'manifest version');
  const recordedVersion = resolution.kind === 'pinned'
    ? resolution.version
    : (resolution.kind === 'unpinned'
      ? resolution.evidence?.manifestVersion
      : undefined);
  if (recordedVersion !== undefined && recordedVersion !== version) {
    throw resolutionVersionError(version, recordedVersion);
  }
};
