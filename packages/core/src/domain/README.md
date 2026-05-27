# `lib/src/domain/` — domain layer

Domain layer invariant: *"`bundle`, `primitive`, `hub` types live in
`lib/src/domain/`. Feature layers (indexing/search, validation,
publishing, install, runtime translation) depend on domain — never the
reverse."*

## What belongs here

- **Pure data shapes** describing bundles, primitives, and hubs as
  consumed across feature boundaries.
- **Type-only modules** wherever possible. The single allowed runtime
  export today is `PRIMITIVE_KINDS` (the closed set of primitive kinds);
  the iter-2 shape test pins this.

## What does **not** belong here

- **Feature-specific search/index types** — `SearchQuery`,
  `SearchResult`, `IndexEntry`, `MatchExplanation`, `Shortlist`,
  `EmbeddingProvider` stay in `primitive-index/types.ts`.
- **Hub/network parsing utilities** — `parseHubConfig`,
  `extractPluginMcpServers`, etc., stay with their feature layer until
  a second consumer materializes (YAGNI).
- **IO** — anything that reads/writes files or speaks HTTP. Domain is
  about shapes; IO belongs to feature layers, mediated by the
  `Context` abstraction.

## Cut-line audit

| Type | Location | Reason |
|---|---|---|
| `BundleRef` | `domain/bundle/` | Anchors every harvested primitive; consumed by core, search, install. |
| `BundleManifest` | `domain/bundle/` | Bundle's self-description; needed by harvester and validator. |
| `HarvestedFile` | `domain/bundle/` | Minimal payload shared between harvester and primitive-extraction. |
| `BundleProvider` | `domain/bundle/` | The provider abstraction is the seam between hub-fetch and harvest. |
| `Primitive` | `domain/primitive/` | The output of harvesting; consumed by index, search, install, translate. |
| `PrimitiveKind` / `PRIMITIVE_KINDS` | `domain/primitive/` | Closed set; runtime export. |
| `HubSourceSpec` | `domain/hub/` (iter 5) | Parsed-config shape: 9 fields including `id`, `name`, `type`, `url`, `owner`, `repo`, `branch`, `collectionsPath?`, `pluginsPath?`, `rawConfig?`. Consumed by `hub-harvester`, `github-bundle-provider`, `plugin-bundle-provider`, `extra-source`, and `cli`. The companion parser `parseHubConfig` and the URL helper `normalizeRepoFromUrl` stay in `primitive-index/hub/hub-config.ts` (feature-layer IO). The original module re-exports the type for back-compat. |
| `PluginItemKind` / `PluginItem` / `PluginManifest` | `domain/hub/` (iter 6) | The real awesome-copilot plugin-format types: closed-set kind enum, item shape, permissive on-disk manifest superset. Consumed by `plugin-manifest.ts` (parser + helpers), `plugin-bundle-provider.ts`, `plugin-tree-enumerator.ts`. The companion parsers (`parsePluginManifest`, `derivePluginItems`, `resolvePluginItemEntryPath`, `extractPluginMcpServers`) stay in `primitive-index/hub/plugin-manifest.ts` — they are read-only feature-layer behavior, not shapes. |
| `EmbeddingProvider`, `SearchQuery`, `SearchResult`, `MatchExplanation`, `SearchHit`, `Shortlist`, `IndexStats`, `RefreshReport`, `BuildOptions`, `RefreshOptions` | `primitive-index/types.ts` | Search-engine feature types; not shared across feature boundaries. |

## Adding a new domain type

1. Identify ≥2 feature consumers (or one feature + a public-API consumer).
2. Add the type to `bundle/types.ts`, `primitive/types.ts`, or a new
   subfolder.
3. Re-export from `domain/index.ts`.
4. Update `lib/test/domain/domain-shape.test.ts` to pin the new shape.
5. Update this README's audit table.

If the type has only one consumer, **don't promote it**. Domain is
where shared shapes live; speculative promotion creates the kind of
aspirational dead code that had to be cleaned up.

## Enforcement

The custom ESLint rule `local-domain/no-feature-imports-in-domain`
(see `lib/eslint-rules/no-feature-imports-in-domain.js`) fails any
file under `lib/src/domain/**` that imports from a feature-layer
directory. This is the mechanical enforcement for invariant #1; the
shape test in `lib/test/domain/` is the regression net for the
public surface.
