/**
 * FileSystem port — IO abstraction for all file-system operations.
 *
 * The contract every feature layer uses for filesystem access — mirrors
 * the operations `src/services/*` already perform via `fs/promises`
 * today (read/write text and JSON, existence checks, directory
 * creation/listing, removal). Concrete adapters live in
 * `@ai-primitives-hub/infra` (Phase 3); tests supply hand-written
 * in-memory doubles. Keeps `core`/`app` free of direct `node:fs` imports.
 * @module ports/filesystem
 */

/**
 * Subset of `fs.Stats` that source adapters/install pipeline code actually
 * uses (file size for bundle sizing, mtime for `lastUpdated`, directory
 * detection). Extended here, rather than in a later commit, because the
 * first concrete adapter (`infra`'s `LocalAdapter`, Phase 3a) needs it
 * immediately.
 */
export interface FileStat {
  isDirectory: boolean;
  isFile: boolean;
  /** Bytes for files; platform-dependent for directories (callers should not rely on it). */
  size: number;
  /** Last-modified time, epoch milliseconds. */
  mtimeMs: number;
}

/**
 * `FileStat` plus link identity. Produced only by `lstat`, which does
 * **not** follow symlinks — `stat` does, so it can never answer "is this
 * path itself a link?".
 *
 * Required, not optional: shared `app` code needs it to refuse writing
 * through a symlink into a cache or into a user's live source directory,
 * and that guard is unimplementable without it (design 3.2, 4.8).
 */
export interface LinkStat extends FileStat {
  isSymbolicLink: boolean;
}

/**
 * A directory entry as returned by `readDirEntries` — name plus type, so
 * callers don't need a follow-up `stat` just to tell files from
 * directories while scanning.
 */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  /**
   * Read raw bytes. Required for binary assets (images, archives,
   * office documents): the string-based `readFile` decodes UTF-8
   * lossily and corrupts any non-UTF-8 payload (issue #357).
   */
  readFileBytes(path: string): Promise<Uint8Array>;
  /**
   * Write raw bytes verbatim. Counterpart of `readFileBytes`; writers
   * must use this for any payload that is not known to be UTF-8 text.
   */
  writeFileBytes(path: string, bytes: Uint8Array): Promise<void>;
  readJson<T = unknown>(path: string): Promise<T>;
  writeJson(path: string, value: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<string[]>;
  /** Like `readDir`, but with type information — avoids a stat-per-entry scan. */
  readDirEntries(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  /**
   * Stat a path without following a final symlink.
   *
   * Note the limit this does not remove: a child path under a
   * symlinked *directory* lstats as an ordinary file, so a caller
   * guarding writes must walk the ancestors it is about to write
   * under, not just the destination (design 4.8).
   * @param path - Path to stat.
   */
  lstat(path: string): Promise<LinkStat>;
  /**
   * Rename (move) a file atomically from one path to another.
   * @param from - Source path.
   * @param to - Destination path.
   */
  rename(from: string, to: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
}
