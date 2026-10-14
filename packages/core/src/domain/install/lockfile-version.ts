/**
 * Domain layer — lockfile schema version policy.
 *
 * The §5.12 gate of the unified-bundle-lifecycle design: a lockfile's
 * `version` is classified before anything reads its structures, so a
 * reader that predates a schema major fails loudly instead of casting
 * an unknown shape (`JSON.parse(raw) as Lockfile`) and a writer never
 * re-stamps a version it did not understand.
 *
 * Pure policy: no IO, no filenames of its own. Callers supply the path
 * only so the message can name it.
 * @module domain/install/lockfile-version
 */

/** Schema majors this build knows how to read. */
export const KNOWN_LOCKFILE_MAJORS: readonly number[] = [2, 3];

/** Outcome of inspecting a lockfile's `version` field. */
export type LockfileVersionVerdict =
  | { kind: 'readable'; major: number }
  | { kind: 'unknown-major'; major: number }
  | { kind: 'malformed'; raw: unknown };

const SEMVER_SHAPE = /^(\d+)\.\d+\.\d+$/;

/**
 * Classify a lockfile's declared schema version.
 * @param raw - The `version` field exactly as parsed from JSON.
 * @returns A verdict; never throws.
 */
export const classifyLockfileVersion = (raw: unknown): LockfileVersionVerdict => {
  if (typeof raw !== 'string') {
    return { kind: 'malformed', raw };
  }
  const match = SEMVER_SHAPE.exec(raw);
  if (match === null) {
    return { kind: 'malformed', raw };
  }
  const major = Number(match[1]);
  return KNOWN_LOCKFILE_MAJORS.includes(major)
    ? { kind: 'readable', major }
    : { kind: 'unknown-major', major };
};

/**
 * Build the actionable message for a lockfile this build cannot read.
 * @param file - Absolute lockfile path, named so the user can find it.
 * @param verdict - A non-`readable` verdict from {@link classifyLockfileVersion}.
 * @returns A single-sentence message naming the file and the remedy.
 */
export const lockfileVersionErrorMessage = (
  file: string,
  verdict: LockfileVersionVerdict
): string => {
  if (verdict.kind === 'malformed') {
    return `${file} has no readable schema version (found ${JSON.stringify(verdict.raw)}). `
      + 'Expected a "<major>.<minor>.<patch>" string.';
  }
  return `${file} was written by a newer version of AI Primitives Hub `
    + `(lockfile schema ${verdict.major}.x). `
    + 'Upgrade AI Primitives Hub, or disable unifiedDeploy and retry.';
};

/** Thrown when a lockfile's schema version is not readable by this build. */
export class UnsupportedLockfileVersionError extends Error {
  public readonly code = 'LOCKFILE.UNSUPPORTED_VERSION';

  /**
   * Create an UnsupportedLockfileVersionError.
   * @param file - Absolute lockfile path.
   * @param verdict - The verdict that rejected it.
   */
  public constructor(
    public readonly file: string,
    public readonly verdict: LockfileVersionVerdict
  ) {
    super(lockfileVersionErrorMessage(file, verdict));
    this.name = 'UnsupportedLockfileVersionError';
  }
}
