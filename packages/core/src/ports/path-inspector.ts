/**
 * PathInspector port — the two filesystem questions path safety needs and the
 * `FileSystem` port cannot answer: what a path really resolves to, and whether a
 * path is itself a symbolic link.
 *
 * Kept as its own narrow port rather than added to `FileSystem`, so existing
 * `FileSystem` implementors (including the VS Code extension's) keep compiling
 * while the safety-sensitive lifecycle gets what it needs. Concrete adapters
 * live in `infra`; tests supply a fake.
 * @module ports/path-inspector
 */

/**
 * Answers real-path and symbolic-link questions about a path.
 */
export interface PathInspector {
  /**
   * The fully resolved real path, following every symbolic link.
   * @param path Absolute path to resolve.
   * @returns The real path, or `null` when the path does not exist.
   */
  realPath(path: string): Promise<string | null>;

  /**
   * Whether the path itself is a symbolic link. Does not follow it.
   * @param path Absolute path to inspect.
   * @returns True only when the path exists and is a symbolic link.
   */
  isSymbolicLink(path: string): Promise<boolean>;
}
