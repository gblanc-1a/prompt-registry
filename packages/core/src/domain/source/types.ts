/**
 * Source type definitions.
 * @module domain/source/types
 *
 * Unified source types for hub and registry configurations.
 * HubSourceSpec is used for hub configuration parsing.
 * RegistrySource is imported from domain/registry/registry-source.ts.
 */

/**
 * Source type discriminant for hub sources.
 */
export type HubSourceType = 'github' | 'awesome-copilot' | 'awesome-copilot-plugin';

/**
 * A parsed-and-normalised hub source.
 * Produced by parseHubConfig and consumed by the harvester pipeline.
 * @deprecated Use HubSourceSpec from domain/hub/types.ts directly.
 * This re-export is for backward compatibility during migration.
 */
export type HubSourceSpec = {
  /** Stable identifier; defaults to `${owner}-${repo}` when omitted in config. */
  id: string;
  /** Human-readable name; defaults to the config `id` or the repo segment. */
  name: string;
  /** Source type tag. */
  type: HubSourceType;
  /** Original config URL string (used for diagnostics / display). */
  url: string;
  /** GitHub owner segment derived from `url`. */
  owner: string;
  /** GitHub repo segment derived from `url`. */
  repo: string;
  /** Branch (defaults to `main`). */
  branch: string;
  /** For `awesome-copilot` sources: subdir containing collection bundles. */
  collectionsPath?: string;
  /**
   * For `awesome-copilot-plugin` sources: subdir containing plugin
   * roots (each plugin is `<pluginsPath>/<id>/.github/plugin/plugin.json`).
   * Defaults to "plugins" per upstream PR #245 convention.
   */
  pluginsPath?: string;
  /**
   * Forward-compat: arbitrary `config.*` keys preserved verbatim.
   */
  rawConfig?: Record<string, unknown>;
};
