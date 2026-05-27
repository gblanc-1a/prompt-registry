/**
 * Installable + BundleSpec types.
 *
 * `BundleSpec` is the parsed form of an install positional argument:
 *   prompt-registry install foo                    → bundleId only
 *   prompt-registry install owner/repo:foo         → source-scoped
 *   prompt-registry install owner/repo:foo@1.2.3   → fully qualified
 *
 * `Installable` is the resolved form: a BundleRef plus the optional
 * runtime fields the install pipeline needs (download URL, integrity
 * digest, manifest pre-fetched). The pipeline produces it in the
 * resolve stage and consumes it in the download/extract/write stages.
 */
import type {
  BundleRef,
} from '../bundle';

/**
 * Parsed `install <spec>` positional.
 */
export interface BundleSpec {
  /** Source identifier (e.g., `owner/repo`); undefined when omitted. */
  sourceId?: string;
  /** Bundle id within the source (always required). */
  bundleId: string;
  /** Semver-ish version; `latest` or undefined when omitted. */
  bundleVersion?: string;
}

/**
 * Resolved + ready-to-download bundle.
 */
export interface Installable {
  ref: BundleRef;
  /** Direct-download URL (zip). Empty string when `inlineBytes` carries the bundle. */
  downloadUrl: string;
  /**
   * Optional pre-built bundle bytes. When set, the downloader skips
   * the network call and uses these bytes directly. Used by source
   * types that synthesize bundles (awesome-copilot, skills) rather
   * than serving pre-packaged zips.
   */
  inlineBytes?: Uint8Array;
  /** Optional integrity hash (e.g., `sha256-base64`). */
  integrity?: string;
  /** Optional pre-fetched manifest. */
  manifest?: Record<string, unknown>;
}
