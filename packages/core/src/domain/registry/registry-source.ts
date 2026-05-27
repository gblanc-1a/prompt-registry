/**
 * Registry Source (lib variant).
 *
 * Mirrors the extension's `RegistrySource` shape additively; named
 * `RegistrySource` (not `Source`) to avoid conflict with possible
 * future `domain/install/Source` symbols and to read clearly in
 * call-sites.
 * @module domain/registry/registry-source
 */

/**
 * Source type discriminant. The lib supports `github` + `local`
 * today. The other types are accepted by the schema for
 * forward-compat but no resolver impl exists for them currently.
 */
export type RegistrySourceType =
  | 'github'
  | 'local'
  | 'awesome-copilot'
  | 'local-awesome-copilot'
  | 'apm'
  | 'local-apm'
  | 'skills'
  | 'local-skills';

/**
 * A registry source — a place that bundles can come from. Sources
 * may be hub-owned (`hubId` set) or detached (`hubId` set to the
 * synthetic `default-local` hub).
 */
export interface RegistrySource {
  /** Stable, deterministic identifier. Format: `<type>-<12-hex>`. */
  id: string;
  /** Human-readable label. */
  name: string;
  type: RegistrySourceType;
  /** GitHub `owner/repo`, absolute path, or URL — depends on type. */
  url: string;
  /** Whether this source is enabled (skipped when false). */
  enabled: boolean;
  /** Higher = wins on ties; advisory only. */
  priority: number;
  /** Whether the upstream needs auth. */
  private?: boolean;
  /** Optional inline token (extension-set; lib reads via TokenProvider). */
  token?: string;
  /** Free-form metadata block (icons, descriptions, …). */
  metadata?: Record<string, unknown>;
  /**
   * Type-specific config. For `github`: `{ branch?, collectionsPath? }`.
   * Forward-compat: any keys preserved verbatim.
   */
  config?: Record<string, unknown>;
  /**
   * The hub that introduced this source. `default-local` for
   * detached sources.
   */
  hubId: string;
}

/**
 * Type guard for `RegistrySource`. Pure; no IO.
 * @param x Candidate value.
 * @returns true iff `x` is structurally a RegistrySource.
 */
export const isRegistrySource = (x: unknown): x is RegistrySource => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.id === 'string' && obj.id.length > 0
    && typeof obj.name === 'string'
    && typeof obj.type === 'string'
    && typeof obj.url === 'string'
    && typeof obj.enabled === 'boolean'
    && typeof obj.priority === 'number'
    && typeof obj.hubId === 'string' && obj.hubId.length > 0
  );
};
