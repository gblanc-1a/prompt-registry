/**
 * Domain layer — the one logical bundle key.
 *
 * `{sourceId}/{manifestId}`, version-independent and source-qualified,
 * **always, in every file and at every scope** (design 5.13). An earlier
 * draft allowed omitting the source half at user scope when the lockfile
 * had a single source; that is withdrawn, because the key would change
 * shape the moment a second source was added — a silent rekey of the one
 * identifier reconcile, removal and drift all join on.
 *
 * Both halves are therefore required to be slash-free: the separator is
 * the only structure the key has, so a slash in either half would make
 * `parseLogicalBundleKey` ambiguous.
 * @module domain/bundle/logical-key
 */
import {
  VERSION_SUFFIX_REGEX,
} from './identity-matcher';

const SEPARATOR = '/';

/** Thrown when a key's halves cannot form an unambiguous key. */
export class InvalidLogicalBundleKeyError extends Error {
  public readonly code = 'BUNDLE.INVALID_LOGICAL_KEY';

  /**
   * Create an InvalidLogicalBundleKeyError.
   * @param field - Which half was rejected.
   * @param value - The offending value.
   */
  public constructor(field: 'sourceId' | 'manifestId', value: string) {
    super(
      `${field} ${JSON.stringify(value)} cannot form a logical bundle key: `
      + 'it must be non-empty and must not contain "/"'
    );
    this.name = 'InvalidLogicalBundleKeyError';
  }
}

/** The two halves of a logical bundle key. */
export interface LogicalBundleKeyParts {
  sourceId: string;
  manifestId: string;
}

/**
 * Build the logical bundle key.
 * @param input - Source id and manifest id.
 * @returns `{sourceId}/{manifestId}`.
 * @throws {InvalidLogicalBundleKeyError} When either half is empty or contains `/`.
 */
export const logicalBundleKey = (input: LogicalBundleKeyParts): string => {
  for (const field of ['sourceId', 'manifestId'] as const) {
    const value = input[field];
    if (value.length === 0 || value.includes(SEPARATOR)) {
      throw new InvalidLogicalBundleKeyError(field, value);
    }
  }
  return `${input.sourceId}${SEPARATOR}${input.manifestId}`;
};

/**
 * Split a logical bundle key back into its halves.
 * @param key - A key previously produced by {@link logicalBundleKey}.
 * @returns The halves, or null when `key` is not exactly two segments.
 */
export const parseLogicalBundleKey = (key: string): LogicalBundleKeyParts | null => {
  const segments = key.split(SEPARATOR);
  if (segments.length !== 2 || segments[0].length === 0 || segments[1].length === 0) {
    return null;
  }
  return { sourceId: segments[0], manifestId: segments[1] };
};

/**
 * Map a legacy bundle id onto the logical key.
 *
 * The extension's runtime GitHub ids are namespaced *and* version-bearing
 * while the CLI stores a bare `manifest.id`; both must reach one key, so
 * the version suffix is stripped and nothing else is reinterpreted.
 * @param legacyId - Bundle id as recorded by either layer.
 * @param sourceId - Source id to qualify the key with.
 * @returns The logical bundle key.
 * @throws {InvalidLogicalBundleKeyError} When either half is unusable.
 */
export const logicalKeyFromLegacyId = (legacyId: string, sourceId: string): string =>
  logicalBundleKey({
    sourceId,
    manifestId: legacyId.replace(VERSION_SUFFIX_REGEX, '')
  });
