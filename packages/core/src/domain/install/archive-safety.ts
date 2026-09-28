/**
 * Domain layer — archive admission limits and entry-type policy (U1).
 *
 * A governed bundle is read from an archive before anything is written to a
 * target, so the archive reader is the first place a hostile or malformed
 * bundle can do damage: an entry count that exhausts memory, a decompression
 * bomb, or an entry type the installer has no business materialising.
 *
 * The limits are **fixed defaults that configuration may only tighten**
 * (NFR1.6). A supplied override that is absent, non-finite, non-positive, or
 * less* restrictive than the default is a validation error before extraction,
 * not a silently-accepted relaxation — otherwise configuration could disable the
 * control it is meant to sharpen.
 *
 * Pure domain: no IO, no framework imports. `infra`'s archive adapter enforces
 * these decisions; this module makes them.
 * @module domain/install/archive-safety
 */

/** One mebibyte, spelled out so the limits below read as their stated units. */
const MIB = 1024 * 1024;

/**
 * Resolved archive admission limits. Every value is a positive, finite number.
 */
export interface ResolvedArchiveSafetyLimits {
  /** Maximum number of archive entries, directories included. */
  readonly maxEntries: number;
  /** Maximum total uncompressed bytes across every entry. */
  readonly maxTotalUncompressedBytes: number;
  /** Maximum uncompressed bytes for any single entry. */
  readonly maxEntryUncompressedBytes: number;
  /**
   * Maximum uncompressed-to-compressed ratio for a regular file.
   * Directories are excluded from ratio evaluation.
   */
  readonly maxCompressionRatio: number;
}

/**
 * Caller-supplied overrides. Each key may only *lower* the matching default.
 */
export type ArchiveSafetyLimits = Partial<ResolvedArchiveSafetyLimits>;

/**
 * The fixed defaults every archive is admitted against.
 */
export const DEFAULT_ARCHIVE_SAFETY_LIMITS: ResolvedArchiveSafetyLimits = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 256 * MIB,
  maxEntryUncompressedBytes: 64 * MIB,
  maxCompressionRatio: 100
};

/**
 * Outcome of resolving caller overrides against the fixed defaults.
 */
export type ArchiveSafetyLimitsResolution =
  | { readonly kind: 'ok'; readonly limits: ResolvedArchiveSafetyLimits }
  | { readonly kind: 'validation-error'; readonly detail: string };

const LIMIT_KEYS: readonly (keyof ResolvedArchiveSafetyLimits)[] = [
  'maxEntries',
  'maxTotalUncompressedBytes',
  'maxEntryUncompressedBytes',
  'maxCompressionRatio'
];

/**
 * Resolve archive admission limits, accepting tightening overrides only.
 *
 * Omitting the overrides object entirely is the normal case and yields the
 * defaults. A key that is *present* must carry a finite, positive value no
 * greater than its default.
 * @param overrides - Optional tightening-only overrides from application configuration.
 * @returns The resolved limits, or a validation error naming the offending key.
 */
export function resolveArchiveSafetyLimits(
  overrides?: ArchiveSafetyLimits
): ArchiveSafetyLimitsResolution {
  if (overrides === undefined) {
    return { kind: 'ok', limits: DEFAULT_ARCHIVE_SAFETY_LIMITS };
  }
  const resolved: Record<string, number> = { ...DEFAULT_ARCHIVE_SAFETY_LIMITS };
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(overrides, key)) {
      continue;
    }
    const value = overrides[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return {
        kind: 'validation-error',
        detail: `archive safety limit "${key}" must be a finite number`
      };
    }
    if (value <= 0) {
      return {
        kind: 'validation-error',
        detail: `archive safety limit "${key}" must be greater than zero`
      };
    }
    if (value > DEFAULT_ARCHIVE_SAFETY_LIMITS[key]) {
      return {
        kind: 'validation-error',
        detail: `archive safety limit "${key}" may only be tightened; `
          + `${value} is less restrictive than the default `
          + `${DEFAULT_ARCHIVE_SAFETY_LIMITS[key]}`
      };
    }
    resolved[key] = value;
  }
  return { kind: 'ok', limits: resolved as unknown as ResolvedArchiveSafetyLimits };
}

/**
 * What one archive entry claims about itself, as the reader sees it before
 * materialising any content.
 */
export interface ArchiveEntryClaim {
  readonly entryName: string;
  readonly isDirectory: boolean;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  /**
   * Unix file mode from the entry's external attributes, when the archive
   * carries one. `0` (or absent) means the archive was produced without unix
   * attributes and the entry is treated as a regular file.
   */
  readonly unixMode?: number;
}

/**
 * Why an archive was refused admission.
 */
export interface ArchiveAdmissionRejection {
  readonly reason:
    | 'too-many-entries'
    | 'total-size-exceeded'
    | 'entry-size-exceeded'
    | 'compression-ratio-exceeded'
    | 'unsupported-entry-type';
  readonly detail: string;
}

/**
 * Size of the unix mode's file-type field. The file-type bits are selected with
 * integer arithmetic rather than a bitwise mask: a mode is a small positive
 * integer here, and the repository's lint rules forbid bitwise operators.
 */
const FILE_TYPE_UNIT = 0x10_00;
/** Unix mode file-type bits for a regular file. */
const S_IFREG = 0x80_00;
/** Unix mode file-type bits for a directory. */
const S_IFDIR = 0x40_00;
/** Unix mode file-type bits for a symbolic link. */
const S_IFLNK = 0xA0_00;

/**
 * The file-type bits of a unix file mode.
 *
 * ZIP entries produced without unix attributes carry mode `0`; callers read that
 * as "no claim made" and treat the entry as a regular file.
 * @param mode - Unix file mode, 16-bit.
 * @returns The mode's file-type field, or `0` when the archive carries none.
 */
export function unixFileType(mode: number): number {
  if (!Number.isFinite(mode) || mode <= 0) {
    return 0;
  }
  return Math.trunc(mode / FILE_TYPE_UNIT) * FILE_TYPE_UNIT;
}

/**
 * Whether an entry is an admissible type: a regular file, or a directory where
 * the role allows one.
 *
 * Symbolic links, device nodes, sockets, and FIFOs are refused outright
 * (NFR1.7): a link's target is decided outside the archive, so admitting one
 * would let a bundle redirect a governed write after validation.
 * @param claim - The entry as the reader sees it.
 * @returns True when the entry type may be admitted.
 */
export function isAdmissibleEntryType(claim: ArchiveEntryClaim): boolean {
  const fileType = unixFileType(claim.unixMode ?? 0);
  if (fileType === 0) {
    return true;
  }
  if (claim.isDirectory) {
    return fileType === S_IFDIR;
  }
  if (fileType === S_IFLNK) {
    return false;
  }
  return fileType === S_IFREG;
}

/**
 * Admit or refuse a whole archive against the resolved limits.
 *
 * Evaluated over the entry claims alone, before any entry is materialised for a
 * target write. Boundary values are admitted; one byte or one entry over is not.
 * @param claims - Every entry the archive declares.
 * @param limits - Resolved limits from {@link resolveArchiveSafetyLimits}.
 * @returns `null` when the archive is admissible, otherwise the first rejection.
 */
export function refuseArchiveAdmission(
  claims: readonly ArchiveEntryClaim[],
  limits: ResolvedArchiveSafetyLimits
): ArchiveAdmissionRejection | null {
  if (claims.length > limits.maxEntries) {
    return {
      reason: 'too-many-entries',
      detail: `archive declares ${claims.length} entries, above the limit of ${limits.maxEntries}`
    };
  }
  let total = 0;
  for (const claim of claims) {
    if (!isAdmissibleEntryType(claim)) {
      return {
        reason: 'unsupported-entry-type',
        detail: `archive entry "${claim.entryName}" is not a regular file or directory`
      };
    }
    if (claim.isDirectory) {
      continue;
    }
    if (claim.uncompressedSize > limits.maxEntryUncompressedBytes) {
      return {
        reason: 'entry-size-exceeded',
        detail: `archive entry "${claim.entryName}" is ${claim.uncompressedSize} bytes, `
          + `above the per-entry limit of ${limits.maxEntryUncompressedBytes}`
      };
    }
    total += claim.uncompressedSize;
    if (total > limits.maxTotalUncompressedBytes) {
      return {
        reason: 'total-size-exceeded',
        detail: `archive uncompressed size exceeds the limit of `
          + `${limits.maxTotalUncompressedBytes} bytes`
      };
    }
    if (claim.compressedSize > 0
      && claim.uncompressedSize / claim.compressedSize > limits.maxCompressionRatio) {
      return {
        reason: 'compression-ratio-exceeded',
        detail: `archive entry "${claim.entryName}" has a compression ratio above `
          + `${limits.maxCompressionRatio}:1`
      };
    }
  }
  return null;
}
