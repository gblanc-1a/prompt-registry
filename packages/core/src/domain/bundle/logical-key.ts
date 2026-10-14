/**
 * Domain layer — the one logical bundle key.
 *
 * `{sourceKey}/{logicalBundleId}`, version-independent and source-qualified,
 * **always, in every file and at every scope** (design 5.13). An earlier
 * draft allowed omitting the source half at user scope when the lockfile
 * had a single source; that is withdrawn, because the key would change
 * shape the moment a second source was added — a silent rekey of the one
 * identifier reconcile, removal and drift all join on.
 *
 * The source half is a portable `src-` key; both halves are slash-free.
 * Legacy source-id keys are handled only by the explicitly named legacy
 * helpers below and are never accepted by the active parser.
 * @module domain/bundle/logical-key
 */
import {
  RegistryError,
} from '../registry-error';
import {
  VERSION_SUFFIX_REGEX,
} from './identity-matcher';

const SEPARATOR = '/';
const PORTABLE_SOURCE_KEY = /^src-[a-f0-9]{64}$/;

/** Thrown when a key's halves cannot form an unambiguous key. */
export class InvalidLogicalBundleKeyError extends RegistryError {
  /**
   * Create an InvalidLogicalBundleKeyError.
   * @param field - Which half was rejected.
   * @param value - The offending value.
   */
  public constructor(field: 'sourceKey' | 'logicalBundleId' | 'sourceId' | 'manifestId', value: string) {
    super({
      code: 'BUNDLE.INVALID_LOGICAL_KEY',
      message: `${field} ${JSON.stringify(value)} cannot form a logical bundle key: `
        + (field === 'sourceKey'
          ? 'it must be a portable src- key with 64 lowercase hexadecimal characters'
          : 'it must be non-empty and must not contain "/"')
    });
    this.name = 'InvalidLogicalBundleKeyError';
  }
}

/** The two halves of a logical bundle key. */
export interface LogicalBundleKeyParts {
  sourceKey: string;
  logicalBundleId: string;
}

/** The two halves of a legacy logical bundle key. */
export interface LegacyLogicalBundleKeyParts {
  sourceId: string;
  manifestId: string;
}

/**
 * Build the logical bundle key.
 * @param input - Portable source key and logical bundle id.
 * @returns `{sourceKey}/{logicalBundleId}`.
 * @throws {InvalidLogicalBundleKeyError} When either half is invalid.
 */
export const logicalBundleKey = (input: LogicalBundleKeyParts): string => {
  for (const field of ['sourceKey', 'logicalBundleId'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || value.length === 0 || value.includes(SEPARATOR)
      || (field === 'sourceKey' && !PORTABLE_SOURCE_KEY.test(value))) {
      throw new InvalidLogicalBundleKeyError(field, value);
    }
  }
  return `${input.sourceKey}${SEPARATOR}${input.logicalBundleId}`;
};

/**
 * Split a logical bundle key back into its halves.
 * @param key - A key previously produced by {@link logicalBundleKey}.
 * @returns The portable halves, or null when `key` is not an active portable key.
 */
export const parseLogicalBundleKey = (key: string): LogicalBundleKeyParts | null => {
  if (key.startsWith('unresolved/')) {
    return null;
  }
  const segments = key.split(SEPARATOR);
  if (segments.length !== 2 || !PORTABLE_SOURCE_KEY.test(segments[0]) || segments[1].length === 0) {
    return null;
  }
  return { sourceKey: segments[0], logicalBundleId: segments[1] };
};

/**
 * Decode a historical source-id-qualified key without making it active.
 * @param key - A legacy `{sourceId}/{manifestId}` key.
 * @returns Legacy parts, or null when it is not exactly two non-empty segments.
 */
export const parseLegacyLogicalBundleKey = (key: string): LegacyLogicalBundleKeyParts | null => {
  const segments = key.split(SEPARATOR);
  if (segments.length !== 2 || segments[0].length === 0 || segments[1].length === 0) {
    return null;
  }
  return { sourceId: segments[0], manifestId: segments[1] };
};

/**
 * Construct a historical source-id-qualified key.
 *
 * Kept separate from {@link logicalBundleKey}; it must not create active v3 keys.
 * @param input
 */
export const legacyLogicalBundleKey = (input: LegacyLogicalBundleKeyParts): string => {
  for (const field of ['sourceId', 'manifestId'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || value.length === 0 || value.includes(SEPARATOR)) {
      throw new InvalidLogicalBundleKeyError(field, value);
    }
  }
  return `${input.sourceId}${SEPARATOR}${input.manifestId}`;
};

/**
 * Map a legacy bundle id onto a legacy logical key.
 *
 * The extension's runtime GitHub ids are namespaced *and* version-bearing
 * while the CLI stores a bare `manifest.id`; both must reach one key, so
 * the version suffix is stripped and nothing else is reinterpreted.
 * @param legacyId - Bundle id as recorded by either layer.
 * @param sourceId - Source id to qualify the key with.
 * @returns The legacy logical bundle key.
 * @throws {InvalidLogicalBundleKeyError} When either half is unusable.
 */
export const logicalKeyFromLegacyId = (legacyId: string, sourceId: string): string =>
  legacyLogicalBundleKey({
    sourceId,
    manifestId: legacyId.replace(VERSION_SUFFIX_REGEX, '')
  });
