/**
 * BundleSpec parser.
 *
 * Three accepted shapes for `prompt-registry install <spec>`:
 *
 *   bundleId                                       (1)
 *   sourceId:bundleId                              (2)
 *   sourceId:bundleId@version                      (3)
 *
 * sourceId follows GitHub's `owner/repo` format with optional
 *   subpath, e.g., `owner/repo` or `owner/repo/subdir`. We accept any
 *   string up to the first colon; further validation lives in the
 *   resolver.
 * bundleId is `[a-z0-9][a-z0-9-]*` (kebab-case); rejected otherwise.
 * version is parsed verbatim; semver validation lives in the
 *   resolver too. The literal `latest` is admitted.
 *
 * Pure function; no IO; safe to import from anywhere.
 */
import type {
  BundleSpec,
} from '../domain/install';

const BUNDLE_ID_RX = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Error thrown when a bundle spec cannot be parsed.
 */
export class BundleSpecParseError extends Error {
  /**
   * Create a BundleSpecParseError.
   * @param message Error message.
   * @param raw Raw input string that failed to parse.
   */
  public constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'BundleSpecParseError';
  }
}

/**
 * Parse a raw install positional into a BundleSpec.
 * @param raw - Raw string typed by the user.
 * @returns Parsed BundleSpec.
 * @throws {BundleSpecParseError} On unparseable input.
 */
export const parseBundleSpec = (raw: string): BundleSpec => {
  if (typeof raw !== 'string') {
    throw new BundleSpecParseError('bundle spec must be a string', String(raw));
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new BundleSpecParseError('bundle spec is empty', raw);
  }

  // Split off the `@version` suffix first; it's the rightmost
  // delimiter. We reject empty versions and stray '@' runs.
  let head = trimmed;
  let bundleVersion: string | undefined;
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx !== -1) {
    head = trimmed.slice(0, atIdx);
    bundleVersion = trimmed.slice(atIdx + 1);
    if (head.length === 0 || bundleVersion.length === 0) {
      throw new BundleSpecParseError('malformed @version suffix', raw);
    }
  }

  // Split off the `sourceId:` prefix. The first colon is the
  // delimiter; sourceId may itself contain '/' but never ':'.
  let sourceId: string | undefined;
  let bundleId = head;
  const colonIdx = head.indexOf(':');
  if (colonIdx !== -1) {
    sourceId = head.slice(0, colonIdx);
    bundleId = head.slice(colonIdx + 1);
    if (sourceId.length === 0 || bundleId.length === 0) {
      throw new BundleSpecParseError('malformed sourceId:bundleId pair', raw);
    }
    if (sourceId.includes(':')) {
      throw new BundleSpecParseError('sourceId may not contain ":"', raw);
    }
  }

  if (!BUNDLE_ID_RX.test(bundleId)) {
    throw new BundleSpecParseError(
      `bundleId "${bundleId}" must match /^[a-z0-9][a-z0-9-]*$/`,
      raw
    );
  }

  return {
    ...(sourceId === undefined ? {} : { sourceId }),
    bundleId,
    ...(bundleVersion === undefined ? {} : { bundleVersion })
  };
};
