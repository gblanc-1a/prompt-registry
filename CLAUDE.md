# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Prompt Registry — a marketplace for discovering, installing, and managing GitHub Copilot prompt libraries (bundles/collections) from multiple sources (GitHub, Local, Awesome Copilot, APM). It ships as both a **VS Code extension** (`apps/vscode-extension`) and a **CLI** (`packages/cli`, binary `prompt-registry`).

## Monorepo layout

pnpm workspace (`pnpm@11.5.0`, Node ≥18). Members: `packages/*`, `apps/*`, `lib`, `github-actions/*`.

```
packages/core   @prompt-registry/core    Domain types + port interfaces. Depends on nothing.
packages/infra  @prompt-registry/infra   Adapters implementing ports (GitHub, HTTP, fs, ZIP, search, stores, writers). Depends on core.
packages/app    @prompt-registry/app     Use-case orchestration (install/uninstall pipelines, registry, transform). Depends on core + infra.
packages/cli    @prompt-registry/cli     Clipanion CLI. Depends on app + core + infra.
packages/sdk    @prompt-registry/sdk     High-level API for integrations. Depends on core + infra.
apps/vscode-extension                     VS Code extension (webpack-bundled, Mocha tests).
lib             @prompt-registry/collection-scripts  Legacy collection scripts — deprecated, being migrated out.
```

Internal deps use `workspace:*`. Each package extends `tsconfig.base.json`; root `tsconfig.json` is a solution file referencing all packages.

## Architecture (Clean / Ports & Adapters)

Dependencies point **inward** toward `core`. This is the load-bearing rule of the repo:

- **`core`** defines domain types (`Bundle`, `Collection`, `Primitive`, `Target`, `Source`, `Profile`, `Hub`) and **ports** (interfaces) in `src/ports/` — e.g. `IBundleDownloader`, `IFilesystem`, `IHttpClient`, `IGitHubApi`, `ITargetWriter`, `IResourceTransformer`. Business rules (validation, parsing) live here. No imports of infra/app.
- **`infra`** provides concrete adapters for those ports (e.g. `NodeHttpClient`, `GitHubClient`, target writers in `src/writers/`, source resolvers in `src/resolvers/`). Swappable without touching domain logic.
- **`app`** wires ports + adapters into use cases. Install/uninstall flow lives in `src/install/` (`pipeline.ts`, `install-bundle.ts`, `layout-resolver.ts`). Resource transformation in `src/transform/` (`transformer-registry.ts` + `transformers/`, e.g. `kiro-transformer`).
- **`cli` / `sdk`** are thin delivery adapters over `app`.

When adding a capability that touches the outside world: define/extend a **port** in `core`, implement the **adapter** in `infra`, orchestrate in `app`, expose in `cli`/`sdk`. Never import infra from core.

**Targets & transformers** (library-centric model): a `Target` (tagged union by `TargetType` — `vscode`, `vscode-insiders`, `copilot-cli`, `kiro`, `windsurf`, `claude-code`) describes where primitives get installed. Target writers (`infra/writers`) materialize files; transformers (`app/transform/transformers`) adapt primitive content per target. Adding a target type means touching `core` (type), a writer (`infra`), and possibly a transformer (`app`).

## Build / test / lint

Run from the repo root (recursive across all packages):

```bash
pnpm install
pnpm build        # pnpm -r run build
pnpm test         # pnpm -r run test
pnpm lint         # pnpm -r run lint
pnpm lint:fix
```

**Per-package** (preferred while iterating — much faster):

```bash
pnpm --filter=@prompt-registry/core run build
pnpm --filter=@prompt-registry/cli  run test          # vitest
pnpm --filter=@prompt-registry/infra run test:watch
pnpm --filter=@prompt-registry/app  run test:coverage
```

`packages/*` use **Vitest** (`vitest run`). `core` and `infra` builds also copy assets via Node (`copy-schemas` / `copy-templates`) — don't replace those `node -e fs.cpSync` steps with shell `cp` (Windows compatibility was a deliberate fix).

## VS Code extension

The extension is **not** Vitest — it uses **Mocha (TDD style)** with a two-tier layout, and is webpack-bundled.

```bash
pnpm extension:compile        # pnpm --filter=prompt-registry run compile  (webpack prod build)
pnpm extension:watch
pnpm extension:package        # builds the .vsix (package:full)
```

Run extension tests from `apps/vscode-extension/` (these scripts are npm, not pnpm-filtered):

```bash
LOG_LEVEL=ERROR npm run test:unit          # Node, vscode mocked via test/mocha.setup.js
npm run test:integration                   # real VS Code (Electron host)
npm test                                   # both
npm run test:one -- test/services/foo.test.ts   # single file (auto-compiles)
```

Tests compile to `test-dist/` first. `test/suite/**` = real-VS-Code integration; everything else = mocked unit/e2e. See `test/AGENTS.md` for test-writing patterns.

## CLI

Clipanion-based. Each command is a class in `packages/cli/src/commands/` (static `paths`, `Command.Usage`, `Option.*`, `execute()`). Commands are registered in `packages/cli/src/main.ts` (`commandClasses` / `commands` arrays) — **a new command file must be imported and added there to be reachable.** Shared helpers (context, output formatting, `RegistryError`, parsers) come from `src/framework/`. Use `getCommandContext(this)`, `formatOutput(...)`, and `failWith(...)` rather than writing to stdout directly; honor the `-o/--output` format (`text`/`json`/`yaml`/`ndjson`).

## Conventions

- **Conventional Commits** (`feat:`, `fix(scope):`, etc.).
- TypeScript strict, no `any`. ESLint is flat-config: root `eslint.config.mjs` + per-package configs extending `eslint.shared.mjs`.
- JSON Schemas for manifests/configs live in `schemas/` (collection, hub-config, apm, lockfile, default-hubs-config); `core` also ships schemas under `src/public/schemas`.

## Docs

- `docs/contributor-guide/architecture.md`, `core-flows.md`, `testing.md`, `coding-standards.md`
- `docs/library-centric-architecture/` — clean-architecture, codemap, container/component diagrams, CLI user flows (current direction of the codebase)
