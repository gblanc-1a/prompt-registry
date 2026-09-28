/**
 * ManifestGovernancePort — validates a bundle archive and returns the governed
 * inventory the shared installation lifecycle routes from.
 *
 * This is the only door into U1's lifecycle: nothing reaches routing, the
 * registry, or a target write without passing through it. The port returns a
 * **value** for a refused bundle (`validation-error`) rather than throwing, so a
 * delivery adapter maps the refusal to its own presentation (BR1.1–BR1.5).
 *
 * Concrete adapters live in `infra`.
 * @module ports/manifest-governance
 */
import type {
  ArchiveSafetyLimits,
} from '../domain/install/archive-safety';
import type {
  GovernedBundle,
} from '../domain/install/governed-manifest';
import type {
  LifecycleOutcome,
} from '../domain/install/lifecycle-outcome';
import type {
  ExtractedFiles,
} from './bundle-extractor';

/**
 * The bundle a caller wants governed.
 *
 * `archive` is the normal path (the adapter reads and admits the archive
 * itself). `extracted` exists for a caller that already holds the archive
 * contents — a legacy migration source, or a pipeline that extracted upstream —
 * and skips only the archive-admission checks, never the manifest governance.
 */
export type BundleSource =
  | {
    readonly kind: 'archive';
    readonly bytes: Uint8Array;
    readonly expectedBundleId?: string;
    readonly expectedVersion?: string;
    /** Tightening-only overrides; an invalid override is a validation error. */
    readonly limits?: ArchiveSafetyLimits;
  }
  | {
    readonly kind: 'extracted';
    readonly files: ExtractedFiles;
    readonly expectedBundleId?: string;
    readonly expectedVersion?: string;
  };

/**
 * Outcome of governing one bundle source.
 */
export type GovernedManifestResult =
  | {
    readonly kind: 'governed';
    readonly bundle: GovernedBundle;
    /** The archive contents the governed inventory describes. */
    readonly files: ExtractedFiles;
  }
  | {
    readonly kind: 'validation-error';
    /** A `validation-error` outcome the lifecycle can return unchanged. */
    readonly outcome: LifecycleOutcome;
  };

/**
 * Validates a bundle and returns its governed inventory.
 */
export interface ManifestGovernancePort {
  /**
   * Validate the bundle and project its governed inventory.
   *
   * Refuses before any filesystem mutation when the archive is inadmissible,
   * the root manifest is missing or duplicated, the inventory does not exactly
   * cover the archive, a path is not canonical and contained, or a declared
   * content hash does not match the archive bytes.
   * @param source Archive bytes, or already-extracted archive contents.
   * @returns The governed projection, or a `validation-error` outcome.
   */
  validate(source: BundleSource): Promise<GovernedManifestResult>;
}
