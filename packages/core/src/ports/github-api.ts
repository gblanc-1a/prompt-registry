/**
 * GitHubApi port — interface for GitHub REST API interactions.
 *
 * Defines the contract that the harvester, install resolvers, and any
 * other caller uses to interact with GitHub. Concrete adapters
 * (GitHubClient) live in `src/github/`. Tests inject stubs.
 *
 * This port covers the three access patterns in use today:
 *   - JSON GETs (repository contents, tree, releases, …)
 *   - Text GETs (raw content, collection files)
 *   - Conditional GETs with ETag (quota-saving cache validation)
 *
 * Rate-limit telemetry is advisory; callers may read it but must not
 * branch on it for correctness.
 * @module ports/github-api
 */

/**
 * Rate-limit telemetry emitted by every GitHub response.
 */
export interface RateLimitTelemetry {
  limit: number | undefined;
  remaining: number | undefined;
  used: number | undefined;
  resetAt: Date | undefined;
}

/**
 * Successful conditional-GET result.
 */
export interface EtaggedOk<T> {
  status: 'ok';
  value: T;
  etag: string | undefined;
}

/**
 * 304 Not-Modified result from a conditional GET.
 */
export interface EtaggedNotModified {
  status: 'notModified';
}

/**
 * Result of a conditional GET.
 */
export type EtaggedResult<T> = EtaggedOk<T> | EtaggedNotModified;

/**
 * Minimal GitHub REST API surface. `GitHubClient` from `src/github/`
 * implements this interface structurally; test doubles need only
 * implement the methods they exercise.
 */
export interface GitHubApi {
  /**
   * GET returning parsed JSON. Throws on non-2xx after retries.
   * @param pathOrUrl Relative API path or absolute URL.
   * @param extraHeaders Optional additional headers.
   */
  getJson<T>(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<T>;

  /**
   * GET returning raw text body.
   * @param pathOrUrl Path or URL.
   * @param extraHeaders Optional additional headers.
   */
  getText(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<string>;

  /**
   * GET with `If-None-Match` conditional cache validation.
   * @param pathOrUrl Path or URL.
   * @param etag Optional previous ETag value.
   */
  getJsonWithEtag<T>(pathOrUrl: string, etag?: string): Promise<EtaggedResult<T>>;

  /** Latest rate-limit headers seen from GitHub (advisory). */
  readonly lastRateLimit: RateLimitTelemetry;
}
