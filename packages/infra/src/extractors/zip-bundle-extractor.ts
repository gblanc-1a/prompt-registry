/**
 * ZipBundleExtractor — BundleExtractor implementation that decodes a
 * zip archive, held entirely in memory, into a path -> bytes map.
 *
 * Uses `adm-zip`, the same library `BundleInstaller.extractBundle()`
 * already uses in production in the VS Code extension (disk-to-disk
 * there; bytes-to-map here) — chosen over a hand-rolled reader for a
 * production-critical path that must robustly handle whatever a real
 * GitHub release/adapter-built zip contains, not just the narrow
 * subset `writers/zip-writer.ts` itself produces.
 *
 * `adm-zip` is an eager parser, so admission is decided from the central
 * directory's entry claims **before** any entry's data is materialised
 * (NFR1.6, NFR1.7): entry count, total and per-entry uncompressed size,
 * regular-file compression ratio, and entry type. The limits are fixed
 * defaults that configuration may only tighten; the decision itself lives in
 * `core`'s `domain/install/archive-safety`.
 * @module extractors/zip-bundle-extractor
 */
import type {
  ArchiveEntryClaim,
  ArchiveSafetyLimits,
  BundleExtractor,
  ExtractedFiles,
} from '@ai-primitives-hub/core';
import {
  refuseArchiveAdmission,
  resolveArchiveSafetyLimits,
} from '@ai-primitives-hub/core';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- matches the extension's own import style for this CJS-only package
import AdmZip = require('adm-zip');

/**
 * Thrown when an archive is refused admission before extraction.
 *
 * Distinct from a generic extraction failure so a caller (the manifest
 * governance adapter) can map it to a `validation-error` outcome rather than a
 * retryable one.
 */
export class ArchiveAdmissionError extends Error {
  /** Stable error code for programmatic handling. */
  public readonly code = 'BUNDLE.ARCHIVE_REJECTED';

  public constructor(
    /** Which admission control refused the archive. */
    public readonly reason: string,
    detail: string
  ) {
    super(detail);
    this.name = 'ArchiveAdmissionError';
  }
}

/**
 * Options accepted by {@link ZipBundleExtractor}.
 */
export interface ZipBundleExtractorOptions {
  /**
   * Tightening-only admission limits from application configuration. Absent,
   * non-finite, non-positive, or less-restrictive values are rejected before
   * extraction.
   */
  readonly limits?: ArchiveSafetyLimits;
}

/**
 * Decodes bundle zip bytes into a file map, entirely in memory.
 */
export class ZipBundleExtractor implements BundleExtractor {
  private readonly limits: ArchiveSafetyLimits | undefined;

  /**
   * Create a ZipBundleExtractor.
   * @param opts Optional tightening-only admission limits.
   */
  public constructor(opts: ZipBundleExtractorOptions = {}) {
    this.limits = opts.limits;
  }

  /**
   * Extract the bundle zip into a path -> bytes map.
   * @param bytes Raw bundle bytes (zip).
   * @returns Map of relative paths to file contents.
   * @throws {ArchiveAdmissionError} When the archive or a limit override is inadmissible.
   * @throws {Error} When the archive cannot be parsed or carries an unsafe path.
   */
  public async extract(bytes: Uint8Array): Promise<ExtractedFiles> {
    const resolution = resolveArchiveSafetyLimits(this.limits);
    if (resolution.kind === 'validation-error') {
      throw new ArchiveAdmissionError('invalid-limit-override', resolution.detail);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(Buffer.from(bytes));
    } catch (error) {
      throw new Error(`Failed to extract bundle: ${(error as Error).message}`);
    }

    const entries = zip.getEntries();
    const rejection = refuseArchiveAdmission(
      entries.map((entry) => toEntryClaim(entry)),
      resolution.limits
    );
    if (rejection !== null) {
      throw new ArchiveAdmissionError(rejection.reason, rejection.detail);
    }

    const files = new Map<string, Uint8Array>();
    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }
      const path = normalizeZipPath(entry.entryName);
      if (path === undefined) {
        throw new Error(`Unsafe ZIP path: ${entry.entryName}`);
      }
      files.set(path, entry.getData());
    }
    return files;
  }
}

/**
 * Project one `adm-zip` entry onto the domain's admission claim.
 * @param entry - Entry from the archive's central directory.
 * @returns The claim the admission rules are evaluated against.
 */
function toEntryClaim(entry: AdmZip.IZipEntry): ArchiveEntryClaim {
  const externalAttributes = Number(entry.header.attr ?? 0);
  return {
    entryName: entry.entryName,
    isDirectory: entry.isDirectory,
    uncompressedSize: Number(entry.header.size ?? 0),
    compressedSize: Number(entry.header.compressedSize ?? 0),
    unixMode: unixModeFromExternalAttributes(externalAttributes)
  };
}

function normalizeZipPath(entryName: string): string | undefined {
  const path = entryName.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : undefined;
}

/** Unsigned 32-bit range, for normalising a signed external-attributes value. */
const UINT32_RANGE = 4_294_967_296;
/** Unsigned 16-bit range: the unix mode occupies the attributes' high half. */
const UINT16_RANGE = 65_536;

/**
 * Read the unix file mode out of a ZIP entry's external attributes.
 *
 * The mode lives in the high 16 bits. Arithmetic rather than shifts, because the
 * repository's lint rules forbid bitwise operators and the field can arrive as a
 * negative signed 32-bit integer.
 * @param externalAttributes - The entry's external attributes field.
 * @returns The unix mode, or `0` when the archive carries no unix attributes.
 */
function unixModeFromExternalAttributes(externalAttributes: number): number {
  if (!Number.isFinite(externalAttributes) || externalAttributes === 0) {
    return 0;
  }
  const unsigned = externalAttributes < 0
    ? externalAttributes + UINT32_RANGE
    : externalAttributes;
  return Math.trunc(unsigned / UINT16_RANGE) % UINT16_RANGE;
}
