/**
 * Index store port — persistence interface for the primitive index.
 *
 * Defines the contract for storing and loading the primitive index.
 * Concrete implementations live in `infra/stores/`.
 * @module ports/index-store
 */

export interface IndexData {
  /** Schema version for forward compatibility. */
  schemaVersion: string;
  /** ISO-8601 timestamp of when the index was generated. */
  generatedAt: string;
  /** The primitive index data. */
  data: unknown;
}

export interface IndexStore {
  /**
   * Load the primitive index from storage.
   * @param path - Absolute path to the index file.
   * @returns Parsed index data.
   */
  load(path: string): Promise<IndexData>;

  /**
   * Save the primitive index to storage.
   * @param path - Absolute path to the index file.
   * @param data - Index data to save.
   */
  save(path: string, data: IndexData): Promise<void>;

  /**
   * Check if an index exists at the given path.
   * @param path - Absolute path to check.
   * @returns True if the index file exists.
   */
  exists(path: string): Promise<boolean>;
}
