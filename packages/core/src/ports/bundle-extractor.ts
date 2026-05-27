/**
 * BundleExtractor port — decodes zip bytes into a path→bytes map.
 * Concrete adapters live in `src/install/`. Tests inject `DictBundleExtractor`.
 * @module ports/bundle-extractor
 */

/**
 * Extracted bundle files: relative path → raw bytes.
 */
export type ExtractedFiles = ReadonlyMap<string, Uint8Array>;

/**
 * Decodes bundle (zip) bytes into a file map.
 */
export interface BundleExtractor {
  /**
   * Extract the bundle zip into a path → bytes map.
   * @param bytes Raw bundle bytes from the downloader.
   * @returns Map of relative paths to file contents.
   */
  extract(bytes: Uint8Array): Promise<ExtractedFiles>;
}
