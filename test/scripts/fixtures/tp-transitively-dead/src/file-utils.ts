/**
 * Models: FileUtils where all methods are dead. exists() and getStats()
 * are called only by isDirectory() and ensureDirectory(), which themselves
 * have zero external callers. The entire chain is transitively dead.
 */
export class FileUtils {
  /**
   * Zero external callers — calls exists() and getStats() internally.
   */
  public static isDirectory(p: string): boolean {
    if (!FileUtils.exists(p)) return false;
    const stats = FileUtils.getStats(p);
    return stats !== null;
  }

  /**
   * Zero external callers — calls exists() internally.
   */
  public static ensureDirectory(p: string): void {
    if (!FileUtils.exists(p)) {
      // create directory
    }
  }

  /**
   * Self-call-only — called by isDirectory() and ensureDirectory().
   * Since BOTH callers are also dead, this is transitively dead.
   */
  public static exists(p: string): boolean {
    return true;
  }

  /**
   * Self-call-only — called by isDirectory().
   * Since isDirectory() is dead, this is transitively dead.
   */
  public static getStats(p: string): object | null {
    return {};
  }

  /**
   * Live method — called from consumer.ts.
   */
  public static readJson(p: string): object {
    return {};
  }
}
