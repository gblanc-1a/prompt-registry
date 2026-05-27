/**
 * Domain Layer — Hub types.
 *
 * `HubSourceSpec` is the parsed-config representation of a hub source —
 * a GitHub repo plus type-specific metadata (collections path, plugins
 * path, raw config bag for forward-compat). It is consumed across
 * multiple feature-layer modules (`hub-harvester`, `github-bundle-provider`,
 * `plugin-bundle-provider`, `extra-source`, `cli`) so it satisfies the
 * "≥2 consumers" rule from `lib/src/domain/README.md`.
 *
 * The companion parsing helpers (`parseHubConfig`, `normalizeRepoFromUrl`,
 * `parseExtraSource`) stay in `lib/src/primitive-index/hub/` for now.
 * They depend on `js-yaml` and on URL/string parsing that is feature-IO
 * code, not a shared shape; promoting them would force `domain/` to grow
 * a runtime dependency graph for the first time. They will move only if
 * a second feature-layer consumer needs them.
 *
 * The shape mirrors what the codebase actually uses.
 * @module domain/hub
 */

/**
 * Plugin item kinds understood by the awesome-copilot plugin format.
 * Closed set; mirrors PR #245 of the upstream repo.
 *
 * Note: this is a **subset** of `domain/primitive/PrimitiveKind`
 * (which also includes `mcp-server`). Plugins describe primitives by
 * file path; `mcp-server` is described separately under the manifest's
 * `mcp` / `mcpServers` keys, not as a `PluginItem`.
 */
export type PluginItemKind = 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';

/**
 * A resolved plugin item in the harvester's canonical shape. The
 * companion `derivePluginItems(manifest)` helper in
 * `lib/src/primitive-index/hub/plugin-manifest.ts` produces these from
 * the various input formats the upstream plugin schema permits.
 */
export interface PluginItem {
  kind: PluginItemKind;
  /** Path relative to the plugin root (may start with `./`). */
  path: string;
  /**
   * Optional description of the plugin item.
   */
  description?: string;
}

/**
 * Superset of the awesome-copilot `plugin.json` on-disk schema.
 *
 * Permissive by design: any unknown keys (`[key: string]: unknown`)
 * are preserved so feature-layer parsers can read forward-compat
 * fields without forcing a schema bump here.
 *
 * Read-only — the harvester never produces these, only consumes them.
 */
export interface PluginManifest {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  keywords?: string[];
  itemCount?: number;
  path?: string;
  /** Our format: explicit items with `kind`/`path`. */
  items?: unknown[];
  /** Upstream format: agent path refs. */
  agents?: unknown[];
  /** Upstream format: skill path refs. */
  skills?: unknown[];
  /** MCP server configs (see `mcp.schema.json`). */
  mcp?: { items?: Record<string, unknown> };
  mcpServers?: Record<string, unknown>;
  featured?: boolean;
  external?: boolean;
  repository?: string;
  homepage?: string;
  license?: string;
  /** Anything else we don't care about on the read path. */
  [key: string]: unknown;
}

/**
 * A parsed-and-normalised hub source. Produced by `parseHubConfig`
 * (in the feature layer) and consumed by the harvester pipeline.
 */
export interface HubSourceSpec {
  /** Stable identifier; defaults to `${owner}-${repo}` when omitted in config. */
  id: string;
  /** Human-readable name; defaults to the config `id` or the repo segment. */
  name: string;
  /** Source type tag; only the three listed types are wired today. */
  type: 'github' | 'awesome-copilot' | 'awesome-copilot-plugin';
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
   * Forward-compat: arbitrary `config.*` keys preserved verbatim so
   * downstream experiments can consume new fields without forcing a
   * schema bump here.
   */
  rawConfig?: Record<string, unknown>;
}
