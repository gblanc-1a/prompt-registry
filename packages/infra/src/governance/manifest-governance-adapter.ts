/**
 * ManifestGovernanceAdapter — the `ManifestGovernancePort` implementation.
 *
 * It composes work that already exists rather than re-deciding it:
 *
 *   1. archive admission and extraction (`ZipBundleExtractor`, NFR1.6, NFR1.7);
 *   2. governed manifest validation (`core`'s `validateManifest`, which proves
 *      exactly one root `deployment-manifest.yml`, a `files[]` inventory that
 *      exactly covers the archive with matching sizes and digests, canonical
 *      archive-relative paths, and canonical primitive kinds — BR1.1, BR1.2,
 *      BR1.4);
 *   3. the optional per-item `contentHash` assertion (BR1.3, NFR1.2);
 *   4. projection into the lifecycle's governed vocabulary (BR1.5).
 *
 * Every refusal is returned as a `validation-error` **outcome**, never thrown,
 * and no target write can have happened: this adapter touches no destination.
 * @module governance/manifest-governance-adapter
 */
import {
  createHash,
} from 'node:crypto';
import type {
  BundleSource,
  ExtractedFiles,
  GovernedManifestResult,
  ManifestGovernancePort,
  ValidatedManifest,
} from '@ai-primitives-hub/core';
import {
  isReleaseDeploymentManifest,
  ManifestValidationError,
  projectGovernedManifest,
  validateManifest,
} from '@ai-primitives-hub/core';
import {
  ArchiveAdmissionError,
  ZipBundleExtractor,
} from '../extractors/zip-bundle-extractor';

/** Narrow view of the archive reader this adapter needs. */
export interface GovernanceArchiveReader {
  extract(bytes: Uint8Array): Promise<ExtractedFiles>;
}

/**
 * Options accepted by {@link ManifestGovernanceAdapter}.
 */
export interface ManifestGovernanceAdapterOptions {
  /**
   * Archive reader factory. Defaults to a `ZipBundleExtractor` carrying the
   * per-request tightening-only limits, so limit overrides stay per-bundle.
   */
  readonly readerFactory?: (source: Extract<BundleSource, { kind: 'archive' }>) => GovernanceArchiveReader;
}

/**
 * Validates bundles and projects their governed inventory.
 */
export class ManifestGovernanceAdapter implements ManifestGovernancePort {
  private readonly readerFactory: (
    source: Extract<BundleSource, { kind: 'archive' }>
  ) => GovernanceArchiveReader;

  /**
   * Create a ManifestGovernanceAdapter.
   * @param opts Optional archive-reader factory override (tests inject a fake).
   */
  public constructor(opts: ManifestGovernanceAdapterOptions = {}) {
    this.readerFactory = opts.readerFactory
      ?? ((source) => new ZipBundleExtractor(
        source.limits === undefined ? {} : { limits: source.limits }
      ));
  }

  /**
   * Validate the bundle and project its governed inventory.
   * @param source Archive bytes, or already-extracted archive contents.
   * @returns The governed projection, or a `validation-error` outcome.
   */
  public async validate(source: BundleSource): Promise<GovernedManifestResult> {
    let files: ExtractedFiles;
    if (source.kind === 'archive') {
      try {
        files = await this.readerFactory(source).extract(source.bytes);
      } catch (error) {
        return rejected(describeArchiveFailure(error));
      }
    } else {
      files = source.files;
    }

    let manifest: ValidatedManifest;
    try {
      manifest = validateManifest(files, {
        ...(source.expectedBundleId === undefined ? {} : { expectedId: source.expectedBundleId }),
        ...(source.expectedVersion === undefined ? {} : { expectedVersion: source.expectedVersion })
      });
    } catch (error) {
      if (error instanceof ManifestValidationError) {
        return rejected(error.message);
      }
      throw error;
    }

    if (!isReleaseDeploymentManifest(manifest)) {
      return rejected(
        'deployment-manifest.yml does not declare the governed manifest format, '
        + 'so it carries no items[] inventory to install from'
      );
    }

    const hashFailure = firstItemHashMismatch(manifest.items, files);
    if (hashFailure !== null) {
      return rejected(hashFailure);
    }

    return {
      kind: 'governed',
      bundle: projectGovernedManifest(manifest),
      files
    };
  }
}

/**
 * Verify every declared per-item content hash against the archive bytes.
 *
 * The hash is optional (BR1.3): an item without one stays governed, because
 * membership, path, and kind still come from `items[]` and the write is verified
 * by target read-back. A hash that *is* declared must match exactly (NFR1.2).
 * @param items - Governed manifest items.
 * @param files - Archive contents.
 * @returns A detail string for the first mismatch, or `null` when all match.
 */
function firstItemHashMismatch(
  items: readonly { id: string; path: string; contentHash?: string }[],
  files: ExtractedFiles
): string | null {
  for (const item of items) {
    if (item.contentHash === undefined) {
      continue;
    }
    const bytes = files.get(item.path);
    if (bytes === undefined) {
      return `deployment-manifest.yml items[] references missing archive file "${item.path}"`;
    }
    if (sha256(bytes) !== item.contentHash) {
      return `deployment-manifest.yml items[] contentHash does not match archive content `
        + `for "${item.path}"`;
    }
  }
  return null;
}

/**
 * Describe an archive-stage failure for a `validation-error` detail.
 * @param error - The thrown archive failure.
 * @returns Human-readable detail naming the refusal.
 */
function describeArchiveFailure(error: unknown): string {
  if (error instanceof ArchiveAdmissionError) {
    return `archive refused (${error.reason}): ${error.message}`;
  }
  return `archive could not be read: ${(error as Error).message}`;
}

/**
 * Build a `validation-error` result.
 * @param detail - Why the bundle was refused.
 * @returns The refusal, shaped so the lifecycle can return its outcome unchanged.
 */
function rejected(detail: string): GovernedManifestResult {
  return { kind: 'validation-error', outcome: { kind: 'validation-error', detail } };
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
