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
  assertResolutionVersion,
  assertSourceKey,
  classifyLockfileVersion,
  parseLogicalBundleKey,
  sourceKey as portableSourceKey,
  RegistryError,
  UnsupportedLockfileVersionError,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
  InstallationScope,
  LegacyDesiredIntent,
  LegacyIdentityEvidence,
  PortableSourceDescriptor,
  RepositoryCommitMode,
  RetainedSourceType,
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  LockfileFs,
  LockfileHubEntry,
  LockfileProfileEntry,
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

/** Fields shared by managed and retained unmanaged materializations. */
interface MaterializationFields {
  /** Semantic version. */
  version: string;
  /** ISO timestamp when installed. */
  installedAt: string;
  /** Repository commit mode (absent at user scope). */
  commitMode?: RepositoryCommitMode;
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
  /** Identity retained for an incomplete or unresolved migration. */
  legacy?: LegacyIdentityEvidence;
}

/** A materialization whose portable identity and resolution are known. */
export type ManagedMaterialization = MaterializationFields & {
  sourceKey: string;
  resolution: BundleResolution;
};

/** A retained record whose portable identity may be incomplete. */
export type UnmanagedMaterialization = MaterializationFields & {
  state: 'unmanaged';
  unmanagedReason: string;
} & (
  | { sourceKey: string; resolution: BundleResolution }
  | { sourceKey?: never; resolution?: never; legacy: LegacyIdentityEvidence }
);

/** Bundle materialization record in the local file. */
export type LockfileV3BundleRecord = ManagedMaterialization | UnmanagedMaterialization;

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
  /** Portable source identity key. */
  sourceKey: string;
  /** Exact, unpinned, or deliberately live artifact resolution. */
  resolution: BundleResolution;
}

/** Desired state file (byte-comparable). */
export interface DesiredLockfileV3 {
  /** JSON schema reference. */
  $schema: string;
  /** Schema version. */
  version: string;
  /** Map of bundle IDs to desired state. */
  bundles: Record<string, LockfileV3DesiredEntry>;
  /** Map of portable source keys to their descriptors. */
  sources: Record<string, PortableSourceDescriptor>;
  /** Legacy intent that could not be proven portable during migration. */
  unresolved?: LegacyDesiredIntent[];
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

type JsonObject = Record<string, unknown>;

const invalidV3Shape = (file: string, detail: string): never => {
  throw new RegistryError({
    code: 'CONFIG.INVALID_LOCKFILE_V3',
    message: `${file} is not a valid amended v3 lockfile: ${detail}`,
    hint: 'Migrate legacy lockfile shapes before writing or reading them as v3.'
  });
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireObject = (value: unknown, label: string, file: string): JsonObject => {
  if (!isJsonObject(value)) {
    return invalidV3Shape(file, `${label} must be an object.`);
  }
  return value;
};

const requireString = (value: unknown, label: string, file: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidV3Shape(file, `${label} must be a non-empty string.`);
  }
  return value;
};

const requireOnlyKeys = (
  value: JsonObject,
  allowed: readonly string[],
  label: string,
  file: string
): void => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    invalidV3Shape(file, `${label} contains unsupported field ${JSON.stringify(unknown)}.`);
  }
};

const requireExactKeys = (
  value: JsonObject,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  file: string
): void => {
  requireOnlyKeys(value, allowed, label, file);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    invalidV3Shape(file, `${label} is missing required field ${JSON.stringify(missing)}.`);
  }
};

const requireNonEmptyStringArray = (value: unknown, label: string, file: string): void => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    invalidV3Shape(file, `${label} must be an array of non-empty strings.`);
  }
};

const requireSha256 = (value: unknown, label: string, file: string): void => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    invalidV3Shape(file, `${label} must be a lowercase SHA-256 digest.`);
  }
};

const isRelativePosixPath = (value: string): boolean => (
  value.length > 0
  && !value.startsWith('/')
  && !/^[a-zA-Z]:/.test(value)
  && !value.includes('\\')
  && !value.includes('\0')
  && !value.includes('://')
  && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
);

const validateDateTime = (value: unknown, label: string, file: string): void => {
  const text = requireString(value, label, file);
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTime.test(text) || Number.isNaN(Date.parse(text))) {
    invalidV3Shape(file, `${label} must be an ISO date-time.`);
  }
};

const RETAINED_SOURCE_TYPES = new Set<RetainedSourceType>([
  'github', 'local', 'awesome-copilot', 'local-awesome-copilot', 'skills',
  'local-skills', 'azure-devops', 'artifactory'
]);
const SOURCE_DESCRIPTOR_KEYS = ['type', 'identity', 'locator', 'config'] as const;
const SOURCE_CONFIG_KEYS = [
  'ref', 'collectionsPath', 'skillsPath', 'indexFile', 'authMode', 'credentialRef'
] as const;

const validateSourceConfig = (value: unknown, file: string): void => {
  if (value === undefined) {
    return;
  }
  const config = requireObject(value, 'source config', file);
  requireOnlyKeys(config, SOURCE_CONFIG_KEYS, 'source config', file);
  for (const key of ['ref', 'collectionsPath', 'skillsPath', 'indexFile', 'credentialRef']) {
    if (config[key] !== undefined) {
      const text = requireString(config[key], `source config.${key}`, file);
      if (key !== 'ref' && key !== 'credentialRef' && !isRelativePosixPath(text)) {
        invalidV3Shape(file, `source config.${key} must be a portable relative path.`);
      }
    }
  }
  if (config.authMode !== undefined && config.authMode !== 'anonymous' && config.authMode !== 'bearer') {
    invalidV3Shape(file, 'source config.authMode must be "anonymous" or "bearer".');
  }
};

const identityKeysFor = (
  type: RetainedSourceType,
  kind: string
): readonly string[] | null => {
  switch (kind) {
    case 'github-releases': {
      return ['kind', 'origin', 'repositoryId'];
    }
    case 'github-tree': {
      return [
        'kind', 'origin', 'repositoryId', 'ref',
        ...(type === 'skills' ? ['skillsPath'] : ['collectionsPath'])
      ];
    }
    case 'azure-devops-tree': {
      return ['kind', 'namespace', 'repositoryId', 'ref', 'collectionsPath'];
    }
    case 'artifactory-index': {
      return ['kind', 'root', 'indexFile'];
    }
    case 'workspace-local': {
      return [
        'kind', 'root',
        ...(type === 'local-skills' ? ['skillsPath'] : []),
        ...(type === 'local-awesome-copilot' ? ['collectionsPath'] : [])
      ];
    }
    case 'external-local': {
      return [
        'kind', 'bindingName',
        ...(type === 'local-skills' ? ['skillsPath'] : []),
        ...(type === 'local-awesome-copilot' ? ['collectionsPath'] : [])
      ];
    }
    default: {
      return null;
    }
  }
};

const validateSourceDescriptor = (
  value: unknown,
  key: string,
  file: string
): PortableSourceDescriptor => {
  const source = requireObject(value, `source descriptor ${key}`, file);
  requireExactKeys(source, SOURCE_DESCRIPTOR_KEYS, ['type', 'identity', 'locator'], `source descriptor ${key}`, file);
  const type = requireString(source.type, `source descriptor ${key}.type`, file);
  if (!RETAINED_SOURCE_TYPES.has(type as RetainedSourceType)) {
    invalidV3Shape(file, `source descriptor ${key} uses unsupported adapter type ${JSON.stringify(type)}.`);
  }
  const typedType = type as RetainedSourceType;
  const identity = requireObject(source.identity, `source descriptor ${key}.identity`, file);
  const kind = requireString(identity.kind, `source descriptor ${key}.identity.kind`, file);
  const allowedIdentityKeys = identityKeysFor(typedType, kind);
  if (allowedIdentityKeys === null) {
    return invalidV3Shape(file, `source descriptor ${key} uses unknown identity kind ${JSON.stringify(kind)}.`);
  }
  requireOnlyKeys(identity, allowedIdentityKeys, `source descriptor ${key}.identity`, file);
  const descriptor = source as unknown as PortableSourceDescriptor;
  requireString(descriptor.locator, `source descriptor ${key}.locator`, file);
  validateSourceConfig(source.config, file);
  try {
    assertSourceKey(key, descriptor);
  } catch (error) {
    invalidV3Shape(file, `source descriptor ${key} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return descriptor;
};

const validateSafeLegacyDescriptor = (value: unknown, file: string): void => {
  if (value === undefined) {
    return;
  }
  const descriptor = requireObject(value, 'legacy descriptor evidence', file);
  requireExactKeys(
    descriptor,
    ['type', 'locator', 'selectors'],
    [],
    'legacy descriptor evidence',
    file
  );
  if (descriptor.type !== undefined) {
    requireString(descriptor.type, 'legacy descriptor evidence.type', file);
  }
  if (descriptor.locator !== undefined) {
    const locator = requireString(descriptor.locator, 'legacy descriptor evidence.locator', file);
    if (locator.startsWith('/') || /^[a-zA-Z]:/.test(locator) || locator.includes('\\')) {
      invalidV3Shape(file, 'shared legacy descriptor evidence cannot contain an absolute local root.');
    }
    if (/^https?:\/\//i.test(locator)) {
      let parsed: URL;
      try {
        parsed = new URL(locator);
      } catch {
        return invalidV3Shape(file, 'legacy descriptor evidence.locator must be a credential-free URL.');
      }
      if (parsed.username !== '' || parsed.password !== ''
        || [...parsed.searchParams.keys()].some((key) => /(token|password|secret|credential|auth|api[_-]?key)/i.test(key))) {
        invalidV3Shape(file, 'legacy descriptor evidence.locator cannot contain credentials or secret query parameters.');
      }
    } else if (!isRelativePosixPath(locator)) {
      invalidV3Shape(file, 'legacy descriptor evidence.locator must be portable and relative.');
    }
  }
  if (descriptor.selectors !== undefined) {
    const selectors = requireObject(descriptor.selectors, 'legacy descriptor evidence.selectors', file);
    for (const [key, selector] of Object.entries(selectors)) {
      if (/(token|password|secret|credential|authorization|api[_-]?key)/i.test(key)) {
        invalidV3Shape(file, `legacy descriptor evidence cannot contain secret field ${JSON.stringify(key)}.`);
      }
      const selectorText = requireString(selector, `legacy descriptor evidence.selectors.${key}`, file);
      if (selectorText.startsWith('/') || /^[a-zA-Z]:/.test(selectorText) || selectorText.includes('\\')) {
        invalidV3Shape(file, 'shared legacy descriptor evidence cannot contain an absolute local root.');
      }
    }
  }
};

const validateLegacyDesiredIntent = (value: unknown, file: string): void => {
  const evidence = requireObject(value, 'unresolved desired intent', file);
  requireExactKeys(
    evidence,
    ['originalKey', 'sourceRef', 'descriptor', 'version', 'knownResolution', 'reason'],
    ['originalKey', 'version', 'reason'],
    'unresolved desired intent',
    file
  );
  requireString(evidence.originalKey, 'unresolved originalKey', file);
  requireString(evidence.version, 'unresolved version', file);
  requireString(evidence.reason, 'unresolved reason', file);
  if (evidence.sourceRef !== undefined) {
    requireString(evidence.sourceRef, 'unresolved sourceRef', file);
  }
  validateSafeLegacyDescriptor(evidence.descriptor, file);
  if (evidence.knownResolution !== undefined) {
    validateResolution(evidence.knownResolution, file);
    assertResolutionVersion(evidence.knownResolution as BundleResolution, evidence.version as string);
  }
};

const validateLegacyIdentityEvidence = (value: unknown, file: string): void => {
  const evidence = requireObject(value, 'legacy identity evidence', file);
  requireExactKeys(
    evidence,
    ['originalKey', 'sourceRef', 'descriptor', 'version', 'knownResolution', 'originalLocalRoot', 'portableDescriptor'],
    ['originalKey', 'version'],
    'legacy identity evidence',
    file
  );
  requireString(evidence.originalKey, 'legacy originalKey', file);
  requireString(evidence.version, 'legacy version', file);
  if (evidence.sourceRef !== undefined) {
    requireString(evidence.sourceRef, 'legacy sourceRef', file);
  }
  if (evidence.originalLocalRoot !== undefined) {
    requireString(evidence.originalLocalRoot, 'legacy originalLocalRoot', file);
  }
  validateSafeLegacyDescriptor(evidence.descriptor, file);
  if (evidence.knownResolution !== undefined) {
    validateResolution(evidence.knownResolution, file);
    assertResolutionVersion(evidence.knownResolution as BundleResolution, evidence.version as string);
  }
  if (evidence.portableDescriptor !== undefined) {
    const descriptor = evidence.portableDescriptor as PortableSourceDescriptor;
    validateSourceDescriptor(descriptor, portableSourceKey(descriptor.identity, descriptor.type), file);
  }
};

const validateResolution = (value: unknown, file: string): BundleResolution => {
  const resolution = requireObject(value, 'bundle resolution', file);
  const kind = requireString(resolution.kind, 'bundle resolution.kind', file);
  if (kind === 'live') {
    requireExactKeys(resolution, ['kind', 'selector'], ['kind', 'selector'], 'live resolution', file);
    const selector = requireString(resolution.selector, 'live resolution.selector', file);
    if (!isRelativePosixPath(selector)) {
      invalidV3Shape(file, 'live resolution.selector must be a portable relative path.');
    }
    return resolution as unknown as BundleResolution;
  }
  if (kind === 'unpinned') {
    requireExactKeys(resolution, ['kind', 'reason', 'evidence'], ['kind', 'reason'], 'unpinned resolution', file);
    requireString(resolution.reason, 'unpinned resolution.reason', file);
    if (resolution.evidence !== undefined) {
      const evidence = requireObject(resolution.evidence, 'unpinned evidence', file);
      requireOnlyKeys(
        evidence,
        ['knownPins', 'knownDigests', 'manifestVersion', 'externalInputLimitations'],
        'unpinned evidence',
        file
      );
      if (evidence.knownPins !== undefined) {
        const knownPins = requireObject(evidence.knownPins, 'unpinned knownPins', file);
        for (const [name, pin] of Object.entries(knownPins)) {
          if (/(token|password|secret|credential|authorization|api[_-]?key)/i.test(name)) {
            invalidV3Shape(file, `unpinned evidence cannot contain secret field ${JSON.stringify(name)}.`);
          }
          requireString(name, 'unpinned known pin name', file);
          requireString(pin, `unpinned known pin ${name}`, file);
        }
      }
      if (evidence.knownDigests !== undefined) {
        const knownDigests = requireObject(evidence.knownDigests, 'unpinned knownDigests', file);
        requireOnlyKeys(knownDigests, ['archiveSha256', 'sourceContentSha256', 'manifestSha256'], 'unpinned knownDigests', file);
        for (const [name, digest] of Object.entries(knownDigests)) {
          requireSha256(digest, `unpinned known digest ${name}`, file);
        }
      }
      if (evidence.manifestVersion !== undefined) {
        requireString(evidence.manifestVersion, 'unpinned evidence.manifestVersion', file);
      }
      if (evidence.externalInputLimitations !== undefined) {
        requireNonEmptyStringArray(evidence.externalInputLimitations, 'unpinned evidence.externalInputLimitations', file);
      }
    }
    return resolution as unknown as BundleResolution;
  }
  if (kind !== 'pinned') {
    invalidV3Shape(file, `bundle resolution uses unknown kind ${JSON.stringify(kind)}.`);
  }

  const provider = requireString(resolution.provider, 'pinned resolution.provider', file);
  const common = ['kind', 'provider', 'version'];
  requireString(resolution.version, 'pinned resolution.version', file);
  let allowed: readonly string[] = [];
  let required: readonly string[] = [];
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
      allowed = [...common, 'manifestPath', 'manifestSize', 'manifestSha256', 'archivePath', 'archiveSize', 'archiveSha256'];
      required = [...common, 'manifestPath', 'manifestSize', 'manifestSha256', 'archivePath', 'archiveSize', 'archiveSha256'];
      break;
    }
    case 'local-snapshot': {
      allowed = [...common, 'bundleSelector', 'sourceContentSha256'];
      required = [...common, 'bundleSelector', 'sourceContentSha256'];
      break;
    }
    default: {
      invalidV3Shape(file, `pinned resolution uses unknown provider ${JSON.stringify(provider)}.`);
    }
  }
  requireExactKeys(resolution, allowed, required, `${provider} resolution`, file);
  switch (provider) {
    case 'github-release': {
      for (const field of ['releaseId', 'assetId']) {
        if (typeof resolution[field] !== 'string' || !/^[1-9]\d*$/.test(resolution[field])) {
          invalidV3Shape(file, `pinned resolution.${field} must be a positive decimal GitHub provider ID.`);
        }
      }
      requireSha256(resolution.archiveSha256, 'pinned resolution.archiveSha256', file);
      if (resolution.tag !== undefined) {
        requireString(resolution.tag, 'pinned resolution.tag', file);
      }

      break;
    }
    case 'github-tree':
    case 'azure-devops-tree': {
      const commitField = provider === 'github-tree' ? 'commitSha' : 'commitId';
      if (typeof resolution[commitField] !== 'string' || !/^[a-f0-9]{40}$/.test(resolution[commitField])) {
        invalidV3Shape(file, `pinned resolution.${commitField} must be a 40-character lowercase commit ID.`);
      }
      const selectorField = provider === 'github-tree' ? 'bundlePath' : 'collectionPath';
      const selector = requireString(resolution[selectorField], `pinned resolution.${selectorField}`, file);
      if (!isRelativePosixPath(selector)) {
        invalidV3Shape(file, `pinned resolution.${selectorField} must be a portable relative path.`);
      }
      requireSha256(resolution.sourceContentSha256, 'pinned resolution.sourceContentSha256', file);
      if (resolution.externalInputs !== undefined) {
        if (!Array.isArray(resolution.externalInputs)) {
          invalidV3Shape(file, 'pinned resolution.externalInputs must be an array.');
        }
        for (const input of resolution.externalInputs as unknown[]) {
          const external = requireObject(input, 'external input pin', file);
          requireExactKeys(external, ['identity', 'sourceContentSha256'], ['identity', 'sourceContentSha256'], 'external input pin', file);
          requireString(external.identity, 'external input pin identity', file);
          requireSha256(external.sourceContentSha256, 'external input pin sourceContentSha256', file);
        }
      }

      break;
    }
    case 'artifactory-object': {
      for (const field of ['manifestPath', 'archivePath']) {
        const selector = requireString(resolution[field], `pinned resolution.${field}`, file);
        if (!isRelativePosixPath(selector)) {
          invalidV3Shape(file, `pinned resolution.${field} must be a portable relative path.`);
        }
      }
      for (const field of ['manifestSize', 'archiveSize']) {
        if (!Number.isSafeInteger(resolution[field]) || (resolution[field] as number) < 0) {
          invalidV3Shape(file, `pinned resolution.${field} must be a non-negative integer.`);
        }
      }
      requireSha256(resolution.manifestSha256, 'pinned resolution.manifestSha256', file);
      requireSha256(resolution.archiveSha256, 'pinned resolution.archiveSha256', file);

      break;
    }
    default: {
      const selector = requireString(resolution.bundleSelector, 'pinned resolution.bundleSelector', file);
      if (!isRelativePosixPath(selector)) {
        invalidV3Shape(file, 'pinned resolution.bundleSelector must be a portable relative path.');
      }
      requireSha256(resolution.sourceContentSha256, 'pinned resolution.sourceContentSha256', file);
    }
  }
  return resolution as unknown as BundleResolution;
};

const validateFileEntries = (
  value: unknown,
  label: string,
  file: string,
  requireInstalledChecksum: boolean
): void => {
  if (!Array.isArray(value)) {
    invalidV3Shape(file, `${label} must be an array.`);
  }
  for (const item of value as unknown[]) {
    const entry = requireObject(item, `${label} item`, file);
    requireExactKeys(
      entry,
      ['path', 'checksum', 'installedChecksum', 'adoptedAtMigration'],
      ['path'],
      `${label} item`,
      file
    );
    const relativePath = requireString(entry.path, `${label}.path`, file);
    if (!isRelativePosixPath(relativePath)) {
      invalidV3Shape(file, `${label}.path must be a canonical relative POSIX path.`);
    }
    for (const field of ['checksum', 'installedChecksum']) {
      if (entry[field] !== undefined
        && (typeof entry[field] !== 'string' || !/^(?:[a-z0-9]+:)?[a-f0-9]{64}$/.test(entry[field]))) {
        invalidV3Shape(file, `${label}.${field} must be a SHA-256 checksum.`);
      }
    }
    if (entry.adoptedAtMigration !== undefined && entry.adoptedAtMigration !== true) {
      invalidV3Shape(file, `${label}.adoptedAtMigration may only be true.`);
    }
    if (requireInstalledChecksum && entry.installedChecksum === undefined) {
      invalidV3Shape(file, `${label}.installedChecksum is required for a managed non-live materialization.`);
    }
  }
};

const validateMaterialization = (value: unknown, key: string, file: string): LockfileV3BundleRecord => {
  const record = requireObject(value, `materialization ${key}`, file);
  const hasState = Object.hasOwn(record, 'state');
  const commonKeys = [
    'version', 'sourceKey', 'resolution', 'installedAt', 'commitMode', 'linked', 'files',
    'mcpConfigPath', 'mcpServers', 'complete', 'legacy'
  ];
  const allowed = hasState
    ? [...commonKeys, 'state', 'unmanagedReason']
    : [...commonKeys];
  const required = hasState
    ? ['version', 'installedAt', 'files', 'state', 'unmanagedReason']
    : ['version', 'sourceKey', 'resolution', 'installedAt', 'files'];
  requireExactKeys(record, allowed, required, `materialization ${key}`, file);
  requireString(record.version, `materialization ${key}.version`, file);
  validateDateTime(record.installedAt, `materialization ${key}.installedAt`, file);
  if (record.commitMode !== undefined && record.commitMode !== 'commit' && record.commitMode !== 'local-only') {
    invalidV3Shape(file, `materialization ${key}.commitMode is unsupported.`);
  }
  if (record.linked !== undefined && record.linked !== true) {
    invalidV3Shape(file, `materialization ${key}.linked may only be true.`);
  }
  if (record.complete !== undefined && record.complete !== true) {
    invalidV3Shape(file, `materialization ${key}.complete may only be true.`);
  }
  if (record.mcpConfigPath !== undefined) {
    requireString(record.mcpConfigPath, `materialization ${key}.mcpConfigPath`, file);
  }
  if (record.mcpServers !== undefined) {
    requireNonEmptyStringArray(record.mcpServers, `materialization ${key}.mcpServers`, file);
  }
  const activeKey = parseLogicalBundleKey(key);
  const unresolvedKey = /^unresolved\/[a-f0-9]{64}$/.test(key);
  if (record.legacy !== undefined) {
    validateLegacyIdentityEvidence(record.legacy, file);
  }
  if (record.sourceKey !== undefined) {
    const sourceKey = requireString(record.sourceKey, `materialization ${key}.sourceKey`, file);
    if (!/^src-[a-f0-9]{64}$/.test(sourceKey)) {
      invalidV3Shape(file, `materialization ${key}.sourceKey must be a portable source key.`);
    }
    if (activeKey === null || activeKey.sourceKey !== sourceKey) {
      invalidV3Shape(file, `materialization ${key} does not match its sourceKey.`);
    }
  }
  if (record.resolution !== undefined) {
    const resolution = validateResolution(record.resolution, file);
    assertResolutionVersion(resolution, record.version as string);
  }
  if (hasState) {
    if (record.state !== 'unmanaged') {
      invalidV3Shape(file, `materialization ${key}.state must be "unmanaged".`);
    }
    requireString(record.unmanagedReason, `materialization ${key}.unmanagedReason`, file);
    if ((record.sourceKey === undefined) !== (record.resolution === undefined)) {
      invalidV3Shape(file, `unmanaged materialization ${key} must retain both sourceKey and resolution or omit both.`);
    }
    if (record.sourceKey === undefined && !unresolvedKey) {
      invalidV3Shape(file, `unmanaged materialization ${key} without portable identity must use its reserved unresolved key.`);
    }
    if (unresolvedKey && (record.legacy === undefined || record.sourceKey !== undefined || record.resolution !== undefined)) {
      invalidV3Shape(file, `unresolved materialization ${key} must retain only legacy identity evidence.`);
    }
  } else {
    if (unresolvedKey || activeKey === null) {
      invalidV3Shape(file, `managed materialization ${key} must use an active portable logical bundle key.`);
    }
    const resolution = record.resolution as BundleResolution;
    assertResolutionVersion(resolution, record.version as string);
  }
  validateFileEntries(record.files, `materialization ${key}.files`, file, !hasState && record.linked !== true);
  return record as unknown as LockfileV3BundleRecord;
};

const validateDesiredState = (value: unknown, file: string): DesiredLockfileV3 => {
  const desired = requireObject(value, 'desired state', file);
  requireExactKeys(
    desired,
    ['$schema', 'version', 'bundles', 'sources', 'unresolved', 'hubs', 'profiles'],
    ['$schema', 'version', 'bundles', 'sources'],
    'desired state',
    file
  );
  if (desired.$schema !== LOCKFILE_V3_SCHEMA_URL) {
    invalidV3Shape(file, '$schema must identify the amended v3 schema.');
  }
  const sources = requireObject(desired.sources, 'desired sources', file);
  for (const [key, source] of Object.entries(sources)) {
    validateSourceDescriptor(source, key, file);
  }
  const bundles = requireObject(desired.bundles, 'desired bundles', file);
  for (const [key, entryValue] of Object.entries(bundles)) {
    const parts = parseLogicalBundleKey(key);
    if (parts === null) {
      return invalidV3Shape(file, `desired bundle key ${JSON.stringify(key)} is not an active portable logical key.`);
    }
    const entry = requireObject(entryValue, `desired bundle ${key}`, file);
    requireExactKeys(entry, ['version', 'sourceKey', 'resolution'], ['version', 'sourceKey', 'resolution'], `desired bundle ${key}`, file);
    requireString(entry.version, `desired bundle ${key}.version`, file);
    const sourceKey = requireString(entry.sourceKey, `desired bundle ${key}.sourceKey`, file);
    if (parts.sourceKey !== sourceKey || !Object.hasOwn(sources, sourceKey)) {
      invalidV3Shape(file, `desired bundle ${key} does not match a configured portable source.`);
    }
    const resolution = validateResolution(entry.resolution, file);
    assertResolutionVersion(resolution, entry.version as string);
  }
  if (desired.unresolved !== undefined) {
    if (!Array.isArray(desired.unresolved)) {
      invalidV3Shape(file, 'desired unresolved must be an array.');
    }
    (desired.unresolved as unknown[]).forEach((intent) => validateLegacyDesiredIntent(intent, file));
  }
  for (const field of ['hubs', 'profiles']) {
    if (desired[field] !== undefined) {
      requireObject(desired[field], `desired ${field}`, file);
    }
  }
  return desired as unknown as DesiredLockfileV3;
};

const validateLocalState = (value: unknown, file: string): LocalLockfileV3 => {
  const local = requireObject(value, 'local state', file);
  requireExactKeys(
    local,
    ['version', 'generatedAt', 'generatedBy', 'migration', 'targets'],
    ['version', 'generatedAt', 'generatedBy', 'targets'],
    'local state',
    file
  );
  validateDateTime(local.generatedAt, 'local generatedAt', file);
  requireString(local.generatedBy, 'local generatedBy', file);
  if (local.migration !== undefined) {
    const migration = requireObject(local.migration, 'local migration', file);
    requireExactKeys(migration, ['lockfileV3'], ['lockfileV3'], 'local migration', file);
    if (migration.lockfileV3 !== 'complete') {
      invalidV3Shape(file, 'local migration.lockfileV3 must be "complete".');
    }
  }
  const targets = requireObject(local.targets, 'local targets', file);
  for (const [name, targetValue] of Object.entries(targets)) {
    const target = requireObject(targetValue, `target ${name}`, file);
    requireExactKeys(
      target,
      ['targetType', 'scope', 'baseDir', 'commitMode', 'bundles'],
      ['baseDir', 'bundles'],
      `target ${name}`,
      file
    );
    if (typeof target.baseDir !== 'string') {
      invalidV3Shape(file, `target ${name}.baseDir must be a string.`);
    }
    if (target.targetType !== undefined && ![
      'vscode', 'vscode-insiders', 'copilot-cli', 'kiro', 'kiro-cli', 'windsurf',
      'claude-code', 'cursor', 'opencode', 'devin', 'devin-cli'
    ].includes(target.targetType as string)) {
      invalidV3Shape(file, `target ${name}.targetType is unsupported.`);
    }
    if (target.scope !== undefined && !['user', 'workspace', 'repository'].includes(target.scope as string)) {
      invalidV3Shape(file, `target ${name}.scope is unsupported.`);
    }
    if (target.commitMode !== undefined && target.commitMode !== 'commit' && target.commitMode !== 'local-only') {
      invalidV3Shape(file, `target ${name}.commitMode is unsupported.`);
    }
    const bundles = requireObject(target.bundles, `target ${name}.bundles`, file);
    for (const [key, record] of Object.entries(bundles)) {
      validateMaterialization(record, key, file);
    }
  }
  return local as unknown as LocalLockfileV3;
};

const readV3File = async <T>(
  file: string,
  fs: LockfileFs,
  fallback: () => T,
  validate: (value: unknown, file: string) => T
): Promise<{ value: T; existed: boolean }> => {
  if (!(await fs.exists(file))) {
    return { value: validate(fallback(), file), existed: false };
  }
  const parsed = JSON.parse(await fs.readFile(file)) as unknown;
  assertV3Version(file, isJsonObject(parsed) ? parsed.version : undefined);
  return { value: validate(parsed, file), existed: true };
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
    paths.desiredFile, fs, emptyDesiredLockfileV3, validateDesiredState
  );
  const local = await readV3File<LocalLockfileV3>(
    paths.localFile,
    fs,
    () => emptyLocalLockfileV3(defaults.generatedBy, defaults.now),
    validateLocalState
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
  payload: DesiredLockfileV3 | LocalLockfileV3,
  fs: LockfileFsWithRename
): Promise<void> => {
  assertV3Version(file, payload.version);
  if ('targets' in payload) {
    validateLocalState(payload, file);
  } else if ('bundles' in payload) {
    validateDesiredState(payload, file);
  } else {
    invalidV3Shape(file, 'payload must be either desired state or local materialization state.');
  }
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
  validateLocalState(pair.local, paths.localFile);
  validateDesiredState(pair.desired, paths.desiredFile);
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
 * Upsert a portable source descriptor under its matching key. Configuration
 * such as Artifactory `indexFile`, `authMode`, and `credentialRef` is retained
 * as descriptor configuration and is excluded from source identity.
 * @param lock - Desired lockfile.
 * @param key - Portable source key.
 * @param entry - Portable source descriptor.
 * @returns New lockfile with the source added or updated.
 */
export const upsertDesiredSource = (
  lock: DesiredLockfileV3,
  key: string,
  entry: PortableSourceDescriptor
): DesiredLockfileV3 => {
  validateSourceDescriptor(entry, key, '<in-memory desired lockfile>');
  const existing = lock.sources[key];
  const config =
    existing?.type === entry.type
      ? { ...existing.config, ...entry.config }
      : entry.config;
  const updatedEntry = {
    ...entry,
    ...(config === undefined ? {} : { config })
  };

  return {
    ...lock,
    sources: {
      ...lock.sources,
      [key]: updatedEntry
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
  const existing = Object.hasOwn(lock.targets, binding.targetName) ? lock.targets[binding.targetName] : undefined;
  if (existing !== undefined && existing.baseDir !== binding.baseDir) {
    throw new RegistryError({
      code: 'BUNDLE.TARGET_REBOUND',
      message: `Target "${binding.targetName}" is bound to "${existing.baseDir}"; uninstall first or restore the target path before deploying at "${binding.baseDir}".`
    });
  }
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
  const target = Object.hasOwn(lock.targets, targetName) ? lock.targets[targetName] : undefined;
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
