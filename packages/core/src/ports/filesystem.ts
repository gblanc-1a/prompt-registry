/**
 * FileSystem port — IO abstraction for all file-system operations.
 *
 * Defines the contract that every feature layer uses for filesystem
 * access. Concrete adapters live in `infra/`; tests supply in-memory
 * doubles. This keeps all feature code free of direct `node:fs` imports.
 *
 * Context-only IO: The CLI `Context` wires a production adapter;
 * commands never call `fs/promises` directly.
 * @module ports/filesystem
 */

/**
 * Minimal filesystem surface covering every read/write pattern in the
 * codebase. Eight operations are sufficient for all feature needs.
 */
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readJson<T = unknown>(path: string): Promise<T>;
  writeJson(path: string, value: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<string[]>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
}
