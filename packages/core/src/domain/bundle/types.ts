/**
 * Domain Layer — Bundle types.
 *
 * Core bundle data shapes used across all features (indexing, validation,
 * publishing, install). Feature layers depend on these types; these types
 * have no feature-layer dependencies.
 * @module domain/bundle
 */

/**
 * Bundle reference identifying a specific bundle.
 */
export interface BundleRef {
  sourceId: string;
  sourceType: string;
  bundleId: string;
  bundleVersion: string;
  installed: boolean;
}

/**
 * Bundle manifest metadata.
 */
export interface BundleManifest {
  id: string;
  version: string;
  name?: string;
  description?: string;
  tags?: string[];
  author?: string;
  items?: {
    path: string;
    kind: string;
    title?: string;
    description?: string;
    tags?: string[];
  }[];
  mcp?: {
    items?: Record<string, {
      type?: string;
      command?: string;
      args?: string[];
      url?: string;
      description?: string;
    }>;
  };
  [key: string]: unknown;
}

/**
 * Harvested file from a bundle.
 */
export interface HarvestedFile {
  /** Path relative to the bundle root. */
  path: string;
  /** UTF-8 body content. */
  content: string;
}

/**
 * Adapter-agnostic provider. Anything that can enumerate bundles and read
 * their files can feed harvesters: VS Code adapters, a local folder scan,
 * a remote repo walker, etc.
 */
export interface BundleProvider {
  listBundles(): AsyncIterable<BundleRef>;
  readManifest(ref: BundleRef): Promise<BundleManifest>;
  readFile(ref: BundleRef, relPath: string): Promise<string>;
}

/**
 * Bundle metadata types.
 *
 * Defines bundle metadata and installation record types for the library.
 * These types mirror the extension's InstalledBundle and related structures
 * to ensure iso-functional behavior between library and extension.
 */

/**
 * Bundle metadata extracted from a bundle's deployment-manifest.yml.
 */
export interface BundleMetadata {
  /** Bundle identifier (sanitized). */
  id: string;
  /** Semantic version. */
  version: string;
  /** Human-readable name. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Tags for categorization. */
  tags?: string[];
}

/**
 * Installation record for a bundle.
 * Mirrors the extension's InstalledBundle structure.
 */
export interface InstallationRecord {
  /** Bundle identifier. */
  bundleId: string;
  /** Semantic version. */
  bundleVersion: string;
  /** Source identifier (e.g., "owner/repo" for GitHub). */
  sourceId: string;
  /** Target name the bundle is installed into. */
  target: string;
  /** ISO 8601 timestamp of installation. */
  installedAt: string;
  /** SHA-256 of the bundle bytes (when downloaded). */
  sha256?: string;
  /** List of installed files with their checksums. */
  files: InstalledFile[];
  /** Commit mode for repository-scope installations. */
  commitMode?: 'commit' | 'local-only';
}

/**
 * File entry in an installation record.
 */
export interface InstalledFile {
  /** Relative path from the target root. */
  path: string;
  /** SHA-256 checksum of the file contents. */
  checksum: string;
}
