/**
 * Evidence retained when legacy source and bundle identities cannot be proven.
 * @module domain/install/portable-identity-migration
 */
import {
  createHash,
} from 'node:crypto';
import {
  logicalBundleKey,
} from '../bundle/logical-key';
import type {
  BundleResolution,
} from '../bundle/resolution';
import {
  assertResolutionSourceCompatibility,
  assertResolutionVersion,
} from '../bundle/resolution';
import type {
  PortableSourceDescriptor,
} from '../source/portable-identity';
import {
  assertSourceKey,
  isCredentialFreeHttpUrl,
  isSafeDiagnosticValue,
  sourceKey,
} from '../source/portable-identity';
import type {
  TargetType,
} from './target';

/** Non-secret legacy descriptor fragments kept for migration diagnostics. */
export interface LegacySourceDescriptorEvidence {
  type?: string;
  locator?: string;
  selectors?: Readonly<Record<string, string>>;
}

/** Shared desired-state evidence for a legacy row that cannot be converted. */
export interface LegacyDesiredIntent {
  originalKey: string;
  sourceRef?: string;
  descriptor?: LegacySourceDescriptorEvidence;
  version: string;
  knownResolution?: BundleResolution;
  reason: string;
}

/** Machine-local evidence for a legacy materialization. */
export interface LegacyIdentityEvidence {
  originalKey: string;
  sourceRef?: string;
  descriptor?: LegacyDesiredIntent['descriptor'];
  version: string;
  knownResolution?: BundleResolution;
  /** Local retention evidence only; never serialize into shared desired state. */
  originalLocalRoot?: string;
  portableDescriptor?: PortableSourceDescriptor;
}

/** One legacy materialization projection used only to compare identity aliases. */
export interface LegacyMaterializationEvidence {
  targetName: string;
  targetType?: TargetType;
  baseDir: string;
  files: readonly {
    path: string;
    checksum?: string;
    installedChecksum?: string;
  }[];
  mcp?: {
    configPath: string;
    servers: readonly string[];
  };
}

/** Inputs available to the offline identity classifier. */
export interface LegacyIdentityInput {
  legacyKey: string;
  sourceId?: string;
  descriptor?: Readonly<Record<string, unknown>>;
  originalLocalRoot?: string;
  version: string;
  knownResolution?: BundleResolution;
  proven?: {
    source: PortableSourceDescriptor;
    logicalBundleId: string;
  };
  materializations?: readonly LegacyMaterializationEvidence[];
}

/** Result of classifying one historical identity without performing I/O. */
export type LegacyIdentityDecision =
  | {
    kind: 'mapped';
    key: string;
    source: PortableSourceDescriptor;
    resolution: BundleResolution;
  }
  | {
    kind: 'unresolved';
    desired: LegacyDesiredIntent;
    evidence: LegacyIdentityEvidence;
  };

const SECRET_FIELD = /(token|password|passwd|secret|signature|credential|authorization|auth|api[_-]?key)/i;
const LOCAL_TYPES = new Set(['local', 'local-awesome-copilot', 'local-skills']);
const LEGACY_SELECTOR_FIELDS = new Set([
  'branch',
  'ref',
  'tag',
  'collectionsPath',
  'skillsPath',
  'indexFile'
]);

const isAbsoluteOrMachinePath = (value: string): boolean =>
  value.startsWith('/')
  || /^[a-zA-Z]:/.test(value)
  || value.includes('\\')
  || /^file:/i.test(value);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : (left > right ? 1 : 0);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const safeSourceRef = (value: string | undefined): string | undefined => {
  if (
    value === undefined
    || value.length === 0
    || isAbsoluteOrMachinePath(value)
    || !isSafeDiagnosticValue(value)
  ) {
    return undefined;
  }
  return value;
};

const safeDescriptor = (
  descriptor: Readonly<Record<string, unknown>> | undefined
): LegacySourceDescriptorEvidence | undefined => {
  if (descriptor === undefined) {
    return undefined;
  }
  const result: LegacySourceDescriptorEvidence = {};
  const type = descriptor.type;
  if (typeof type === 'string' && /^[a-z][a-z0-9-]*$/i.test(type)) {
    result.type = type;
  }

  const locatorCandidate = descriptor.locator ?? descriptor.url;
  if (
    typeof locatorCandidate === 'string'
    && !isAbsoluteOrMachinePath(locatorCandidate)
    && isSafeDiagnosticValue(locatorCandidate)
  ) {
    if (/^https?:\/\//i.test(locatorCandidate)) {
      if (isCredentialFreeHttpUrl(locatorCandidate)) {
        result.locator = locatorCandidate;
      }
    } else if (locatorCandidate === '.' || /^[a-zA-Z0-9._/-]+$/.test(locatorCandidate)) {
      result.locator = locatorCandidate;
    }
  }

  const selectors: Record<string, string> = {};
  for (const [key, value] of Object.entries(descriptor)) {
    if (
      !LEGACY_SELECTOR_FIELDS.has(key)
      || SECRET_FIELD.test(key)
      || typeof value !== 'string'
      || value.length === 0
      || isAbsoluteOrMachinePath(value)
      || !isSafeDiagnosticValue(value)
    ) {
      continue;
    }
    selectors[key] = value;
  }
  if (Object.keys(selectors).length > 0) {
    result.selectors = Object.fromEntries(
      Object.entries(selectors).toSorted(([left], [right]) => compareText(left, right))
    );
  }
  return Object.keys(result).length === 0 ? undefined : result;
};

const evidenceFromInput = (
  input: LegacyIdentityInput,
  reason: string,
  portableDescriptor?: PortableSourceDescriptor
): { desired: LegacyDesiredIntent; evidence: LegacyIdentityEvidence } => {
  const descriptor = safeDescriptor(input.descriptor);
  const sourceRef = safeSourceRef(input.sourceId);
  const desired: LegacyDesiredIntent = {
    originalKey: input.legacyKey,
    version: input.version,
    reason
  };
  const evidence: LegacyIdentityEvidence = {
    originalKey: input.legacyKey,
    version: input.version
  };
  if (sourceRef !== undefined) {
    desired.sourceRef = sourceRef;
    evidence.sourceRef = sourceRef;
  }
  if (descriptor !== undefined) {
    desired.descriptor = descriptor;
    evidence.descriptor = descriptor;
  }
  if (input.knownResolution !== undefined) {
    desired.knownResolution = input.knownResolution;
    evidence.knownResolution = input.knownResolution;
  }
  if (input.originalLocalRoot !== undefined) {
    evidence.originalLocalRoot = input.originalLocalRoot;
  }
  if (portableDescriptor !== undefined) {
    evidence.portableDescriptor = portableDescriptor;
  }
  return { desired, evidence };
};

const unresolved = (
  input: LegacyIdentityInput,
  reason: string,
  portableDescriptor?: PortableSourceDescriptor
): LegacyIdentityDecision => ({
  kind: 'unresolved',
  ...evidenceFromInput(input, reason, portableDescriptor)
});

/**
 * Build deterministic local retention key material for an unresolved identity.
 * The reason and a temporary portable mapping are intentionally excluded.
 * @param evidence - Local legacy identity evidence.
 * @param materialization
 */
export const legacyIdentityRetentionKey = (
  evidence: LegacyIdentityEvidence,
  materialization?: LegacyMaterializationEvidence
): string => {
  const identityEvidence = {
    originalKey: evidence.originalKey,
    sourceRef: evidence.sourceRef,
    descriptor: evidence.descriptor,
    version: evidence.version,
    knownResolution: evidence.knownResolution,
    originalLocalRoot: evidence.originalLocalRoot,
    ...(materialization === undefined
      ? {}
      : {
        materialization: {
          targetName: materialization.targetName,
          targetType: materialization.targetType,
          baseDir: materialization.baseDir,
          files: materialization.files
            .map((file) => ({
              path: file.path,
              checksum: file.checksum,
              installedChecksum: file.installedChecksum
            }))
            .toSorted((left, right) =>
              compareText(left.path, right.path)
              || compareText(left.checksum ?? '', right.checksum ?? '')
              || compareText(left.installedChecksum ?? '', right.installedChecksum ?? '')
            ),
          ...(materialization.mcp === undefined
            ? {}
            : {
              mcp: {
                configPath: materialization.mcp.configPath,
                servers: [...materialization.mcp.servers].toSorted(compareText)
              }
            })
        }
      })
  };
  const digest = createHash('sha256').update(stableJson(identityEvidence), 'utf8').digest('hex');
  return `unresolved/${digest}`;
};

/**
 * Classify one historical identity using only supplied proof and retained evidence.
 * No legacy key parsing, URL conversion, provider lookup, or version-suffix inference
 * is used to establish a portable identity.
 * @param input - Legacy identity and optional independently verified mapping.
 */
export const classifyLegacyIdentity = (input: LegacyIdentityInput): LegacyIdentityDecision => {
  if (input.proven === undefined) {
    return unresolved(input, 'Portable source and manifest identity were not verified.');
  }

  const { source, logicalBundleId } = input.proven;
  try {
    const key = sourceKey(source.identity, source.type);
    assertSourceKey(key, source);
    const bundleKey = logicalBundleKey({ sourceKey: key, logicalBundleId });
    const resolution = input.knownResolution ?? {
      kind: 'unpinned' as const,
      reason: 'Historical artifact resolution is incomplete.'
    };
    assertResolutionVersion(resolution, input.version);
    assertResolutionSourceCompatibility(source, resolution);
    return { kind: 'mapped', key: bundleKey, source, resolution };
  } catch {
    return unresolved(
      input,
      'Supplied portable identity or resolution evidence did not validate.',
      source
    );
  }
};

const materializationsConflict = (
  inputs: readonly LegacyIdentityInput[]
): boolean => {
  const byTarget = new Map<string, LegacyMaterializationEvidence[]>();
  const byBaseDir = new Map<string, LegacyMaterializationEvidence[]>();
  const materializations = new Map<string, LegacyMaterializationEvidence>();
  for (const input of inputs) {
    for (const materialization of input.materializations ?? []) {
      materializations.set(stableJson(materialization), materialization);
    }
  }
  for (const materialization of materializations.values()) {
    const sameName = byTarget.get(materialization.targetName) ?? [];
    if (sameName.some((previous) =>
      previous.targetType !== materialization.targetType
      || previous.baseDir !== materialization.baseDir
    )) {
      return true;
    }
    sameName.push(materialization);
    byTarget.set(materialization.targetName, sameName);

    const sameBase = byBaseDir.get(materialization.baseDir) ?? [];
    if (sameBase.some((previous) =>
      previous.targetName !== materialization.targetName
      || (previous.targetType !== undefined
        && materialization.targetType !== undefined
        && previous.targetType !== materialization.targetType)
    )) {
      return true;
    }
    sameBase.push(materialization);
    byBaseDir.set(materialization.baseDir, sameBase);
  }

  for (const records of byTarget.values()) {
    const baselines = new Map<string, { checksum?: string; installedChecksum?: string }>();
    for (const record of records) {
      for (const file of record.files) {
        const previous = baselines.get(file.path);
        if (
          previous !== undefined
          && ((previous.checksum !== undefined && file.checksum !== undefined
            && previous.checksum !== file.checksum)
          || (previous.installedChecksum !== undefined && file.installedChecksum !== undefined
            && previous.installedChecksum !== file.installedChecksum))
        ) {
          return true;
        }
        baselines.set(file.path, {
          checksum: previous?.checksum ?? file.checksum,
          installedChecksum: previous?.installedChecksum ?? file.installedChecksum
        });
      }
    }
    const mcpRecords = records.flatMap((record) => record.mcp === undefined ? [] : [record.mcp]);
    for (let index = 0; index < mcpRecords.length; index += 1) {
      for (const other of mcpRecords.slice(index + 1)) {
        if (mcpRecords[index].configPath !== other.configPath) {
          return true;
        }
        const servers = new Set(mcpRecords[index].servers);
        if (other.servers.some((server) => servers.has(server))) {
          return true;
        }
      }
    }
  }
  return false;
};

const duplicateInputs = (inputs: readonly LegacyIdentityInput[]): LegacyIdentityInput[] => {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const signature = stableJson(input);
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
};

/**
 * Classify a batch and retain every candidate when aliases conflict.
 * @param inputs - Legacy rows in any traversal order.
 */
export const planIdentityMappings = (
  inputs: readonly LegacyIdentityInput[]
): readonly LegacyIdentityDecision[] => {
  const uniqueInputs = duplicateInputs(inputs);
  const decisions = uniqueInputs.map((input) => ({
    input,
    decision: classifyLegacyIdentity(input)
  }));
  const groups = new Map<string, typeof decisions>();
  for (const item of decisions) {
    if (item.decision.kind !== 'mapped') {
      continue;
    }
    const group = groups.get(item.decision.key) ?? [];
    group.push(item);
    groups.set(item.decision.key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2 && !materializationsConflict(group.map(({ input }) => input))) {
      continue;
    }
    const versions = new Set(group.map(({ input }) => input.version));
    const resolutions = new Set(group.map(({ decision }) =>
      decision.kind === 'mapped' ? stableJson(decision.resolution) : ''
    ));
    const sources = new Set(group.map(({ decision }) =>
      decision.kind === 'mapped' ? stableJson(decision.source) : ''
    ));
    const localRoots = new Set(group
      .filter(({ decision }) => decision.kind === 'mapped' && LOCAL_TYPES.has(decision.source.type))
      .map(({ input }) => input.originalLocalRoot)
      .filter((root): root is string => root !== undefined));
    if (
      versions.size > 1
      || resolutions.size > 1
      || sources.size > 1
      || localRoots.size > 1
      || materializationsConflict(group.map(({ input }) => input))
    ) {
      for (const item of group) {
        const source = item.decision.kind === 'mapped' ? item.decision.source : undefined;
        item.decision = unresolved(
          item.input,
          'Conflicting legacy records map to the same portable identity.',
          source
        );
      }
    }
  }

  return decisions
    .map(({ decision }) => decision)
    .toSorted((left, right) => {
      const leftKey = left.kind === 'mapped' ? left.key : left.evidence.originalKey;
      const rightKey = right.kind === 'mapped' ? right.key : right.evidence.originalKey;
      return compareText(leftKey, rightKey) || compareText(stableJson(left), stableJson(right));
    });
};
