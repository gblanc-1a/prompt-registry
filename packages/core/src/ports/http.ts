/**
 * HTTP port — network abstraction for the install pipeline and GitHub
 * client.
 *
 * Defines `HttpClient` and `TokenProvider` as stable port interfaces.
 * Concrete adapters (`NodeHttpClient`, env-based token resolver) live
 * in `infra/`. The install pipeline and resolvers depend only on these
 * interfaces, never on `node:http` or any HTTP library directly.
 * @module ports/http
 */

/**
 * A single HTTP response surfaced by `HttpClient`.
 */
export interface HttpResponse {
  /** Status code as returned by the upstream after redirect handling. */
  statusCode: number;
  /** Raw response body bytes. */
  body: Uint8Array;
  /** Final URL after redirect chain (matches statusCode). */
  finalUrl: string;
  /** Lower-cased response headers. */
  headers: Record<string, string>;
}

/**
 * Request options accepted by `HttpClient.fetch`.
 */
export interface HttpRequest {
  /** Absolute URL. */
  url: string;
  /** HTTP method; defaults to 'GET'. */
  method?: 'GET' | 'HEAD';
  /** Request headers (case-insensitive). */
  headers?: Record<string, string>;
  /** Maximum redirect chain length; defaults to 5. */
  maxRedirects?: number;
}

/**
 * The minimal HTTP surface the install pipeline needs.
 */
export interface HttpClient {
  fetch(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Supplies an auth token (or null) for a given host.
 */
export interface TokenProvider {
  /**
   * Resolve a token for a host (e.g. 'github.com', 'api.github.com').
   * @param host Lower-case hostname.
   * @returns Token string or null when no auth is available.
   */
  getToken(host: string): Promise<string | null>;
}
