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
  /** Original archive bytes for archive-backed deploy checksum preflight. */
  bytes?: Uint8Array;
}

/** Portable request plus machine-local binding information for bundle resolution. */
export interface PortableBundleSelection {
  bundleId: string;
  version?: string;
  expectedSource?: PortableSourceDescriptor;
  resolution?: BundleResolution;
  localLocation?: LocalSourceLocation;
}

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
  const recordedVersion = resolution.kind === 'pinned'
    ? resolution.version
    : (resolution.kind === 'unpinned'
      ? resolution.evidence?.manifestVersion
      : undefined);
  if (recordedVersion !== undefined && recordedVersion !== version) {
    throw resolutionVersionError(version, recordedVersion);
  }
};
