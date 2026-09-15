## Developer Code Scan Results

### Scan Coverage
- **Snapshot boundary**: `./` only; full repository rescan completed against the supplied source fingerprint `git:e7aa9cc53af65dc73f1cf974baec0dbcc583d56a`. The checkout currently resolves `HEAD` to `a5355d83389ac430a59f19062aecabe3da0a07f6`, so conclusions below are sourced from the files read rather than assuming the supplied fingerprint remains current.
- **Repository inventory**: 1,380 non-Git files scanned by top-level directory: `packages/` (539), `apps/` (452), `.aidlc/` (152), `.github/` (78), `docs/` (62), `lib/` (34), `aidlc/` (33), `website/` (10), `github-actions/` (6), and root configuration/documentation files.
- **Analyzed deeply**:
  - `AGENTS.md`, `README.md`, `package.json`, `pnpm-workspace.yaml`, `eslint.shared.mjs`, `renovate.json`
  - `docs/contributor-guide/architecture/library-centric-architecture/clean-architecture.md`
  - `docs/contributor-guide/architecture/installation-flow.md`
  - `docs/contributor-guide/architecture/update-system.md`
  - `docs/contributor-guide/architecture/adr/0001-ports-and-adapters-for-cli-and-extension.md`
  - `packages/core/src/domain/collection/manifest-validator.ts`
  - `packages/core/src/domain/install/layout.ts`
  - `packages/core/src/ports/{app-storage,bundle-extractor,target-writer}.ts`
  - `packages/infra/src/{extractors/zip-bundle-extractor,storage/xdg-app-storage,writers/{default-layouts,repo-scope-writer}}.*`
  - `packages/app/src/install/{install-bundle,pipeline,target-write}.ts`
  - `packages/app/src/writers/file-tree-writer.ts`
  - `packages/cli/src/{commands/install,framework/production-context}.ts`
  - `apps/vscode-extension/src/{extension,services/{bundle-installer,registry-manager,user-scope-service,repository-scope-service,migration-registry},storage/vscode-app-storage}.ts`
  - focused shared, CLI, extension, ZIP, XDG, and migration tests listed under **Test Coverage**
  - `.github/workflows/{vscode-extension-secure-ci,packages-release}.yml`
- **Skimmed only**:
  - Remaining source files under `packages/{core,infra,app,cli}/`, `apps/vscode-extension/src/`, and `apps/vscode-extension/test/` through file inventories and targeted-symbol results. Counts: core 87, infra 217, app 127, CLI 104, extension source 114, extension tests 253.
  - `lib/`, `github-actions/validate-collections/`, `website/`, remaining documentation, extension webview assets, scaffolding templates, and AI-DLC framework files outside the active intent record.

### Packages Found
- `@ai-primitives-hub/core` - TypeScript domain package - pure bundle, collection, target, manifest, and port contracts.
- `@ai-primitives-hub/infra` - TypeScript infrastructure package - Node filesystem, HTTP/GitHub, source, ZIP, storage, writer, and layout adapters.
- `@ai-primitives-hub/app` - TypeScript application package - installation/uninstallation pipelines, registry/profile orchestration, search, transformations, and public SDK surface.
- `@ai-primitives-hub/cli` - TypeScript Clipanion delivery adapter - command parsing, terminal rendering, production composition, and CLI-specific configuration.
- `prompt-registry` - TypeScript VS Code extension - commands, services, storage, UI, activation, migrations, and compatibility delivery logic.
- `@prompt-registry/collection-scripts` - TypeScript/JavaScript legacy collection build, validation, manifest-generation, and publish scripts; root README labels it legacy/deprecated in place.
- `prompt-registry-docs` - Docusaurus/React documentation site.
- `github-actions/validate-collections` - reusable GitHub Action package for collection validation.

### Build System
- **Type**: pnpm workspace monorepo, Node.js `>=24` and pnpm `>=11` at the root. TypeScript compilation is package-local; the extension uses webpack for production bundling.
- **Config Files**: root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `eslint.shared.mjs`; per-package `package.json` and `tsconfig*.json`; extension `webpack.config.js`; `.github/workflows/*.yml`; `renovate.json`.
- **Build Dependencies**:
  - CLI and VS Code extension depend on `@ai-primitives-hub/app`, `core`, and `infra`.
  - `app` imports `core` and `infra`; `infra` imports `core`; `core` has no internal package dependency.
  - `lib` is consumed by the CLI and extension for collection tooling.
  - Root commands expose `compile`, `test:unit`, and `package:vsix`; each shared package provides `build`, `lint:fix`, Vitest `test`, and coverage scripts.

### APIs Discovered
- **CLI command API** - `packages/cli/src/commands/install.ts` - `ai-primitives-hub install` supports local (`--from`), remote (`<bundle>` plus source), declarative lockfile (`--lockfile`), interactive, `--target`, `--scope`, `--commit-mode`, `--dry-run`, and allowlisted-target modes. No HTTP server/API endpoints were found in the scanned install path.
- **VS Code command API** - `apps/vscode-extension/package.json` and `apps/vscode-extension/src/extension.ts` - contributed commands include `promptRegistry.installBundle`, update, uninstall, scope-move, and lockfile-cleanup actions.
- **Internal installation API** - `packages/app/src/install/install-bundle.ts` and `pipeline.ts` - `installBundle()` configures one resolve -> download -> extract -> validate -> write pipeline using injected `BundleResolver`, `BundleDownloader`, `BundleExtractor`, and target-writer factory ports.
- **Extension registry API** - `apps/vscode-extension/src/services/registry-manager.ts` - `RegistryManager.installBundle()` delegates registry orchestration to app-level `installRegistryBundle`, but supplies extension-local callbacks including `BundleInstaller.installFromBuffer()` and `RegistryStorage.recordInstallation()`.

### Frameworks & Libraries
- TypeScript `^5.9.3` - implementation and type checking across the monorepo.
- pnpm `11.25.0` - workspace package manager with strict engine enforcement.
- VS Code Extension API `^1.105.0` and webpack `^5.108.4` - extension host delivery and bundling.
- Clipanion `4.0.0-rc.4` - CLI framework, intentionally exact-pinned.
- Vitest `^4.1.10` - shared-package tests; Mocha `^11.7.6` plus Sinon/Nock/fast-check/c8 - extension unit, property, integration, and coverage testing.
- `adm-zip` `^0.6.0` - ZIP extraction in both the shared infra adapter and legacy extension installer.
- `js-yaml` `^4.3.1` - manifest/layout parsing; root workspace overrides enforce `^4.1.1`.
- Docusaurus `^3.10.2` and React `^19.0.0` - documentation site.
- Elasticsearch client `^9.x`, AJV `^8.20.0`, Archiver `^7.0.1` - indexing, validation, and bundle creation infrastructure.

### Test Coverage
- **Test Directories**: `packages/{core,infra,app,cli}/test/`; `apps/vscode-extension/test/{services,commands,storage,migrations,e2e,suite,helpers,ui,utils}/`; `lib/test/`; `website/src/` uses Vitest through its package script.
- **Test Frameworks**: Vitest for all shared packages; extension Mocha TDD style with Sinon, Nock, fast-check property tests, c8 coverage, mocked VS Code APIs, and a real VS Code integration suite.
- **Focused installation coverage**:
  - `packages/app/test/install/pipeline.test.ts` verifies every pipeline phase, typed failures, writer selection, governed archive filtering, legacy archive compatibility, and no writer invocation after invalid governed validation.
  - `packages/infra/test/extractors/zip-bundle-extractor.test.ts` verifies ZIP round trips, invalid archives, directory filtering, and traversal rejection.
  - `packages/infra/test/storage/xdg-app-storage.test.ts` verifies XDG config/cache/data separation and persistent state.
  - `packages/cli/test/commands/install.test.ts` verifies local and remote installation, target/scope selection, target allowlist rejection before writes/locks, lockfile replay, governed metadata exclusion, and repository writer routing.
  - `apps/vscode-extension/test/services/bundle-installer.bundleStorageLocation.test.ts` explicitly asserts extension-global cache placement for user and repository scopes and absence of an old workspace `.prompt-registry` cache.
  - `apps/vscode-extension/test/services/{bundle-installer,user-scope-service,repository-scope-service}.test.ts` cover service contracts, manifest-path skills, host-specific layouts, sync/unsync, and repository routing.
  - `apps/vscode-extension/test/migrations/source-id-normalization-migration.test.ts` covers completed-state skipping, source/cache/installation-record migration, and repeat-run idempotence.
- **Coverage Config**: present. Shared packages use Vitest V8 coverage. The extension uses c8/nyc configuration covering `src/**/*.ts` and excludes generated, test, declaration, coverage, and distribution paths.

### Code Quality Indicators
- **Linting**: ESLint 9 with shared type-aware configuration in `eslint.shared.mjs`; packages expose `lint:fix`. The extension has its own ESLint configuration and Prettier formatting script.
- **CI/CD**: `.github/workflows/vscode-extension-secure-ci.yml` builds, lints, runs shared-package and extension tests across Linux/macOS/Windows, runs VS Code integration tests for stable and Insiders, packages the VSIX, scans with Trivy/CodeQL, generates SBOM/license reports, and applies hardened-runner configuration. `.github/workflows/packages-release.yml` validates, builds, tests, artifacts, tags, and provenance-publishes shared packages.
- **Documentation**: root README, package READMEs, audience-specific docs, architecture ADRs, installation-flow documentation, and user/author guides are present. `docs/contributor-guide/architecture/installation-flow.md` still documents the historical extension-storage/copy-sync design and needs reconciliation when the migration changes it.
- **Security/compliance evidence**: `ZipBundleExtractor` rejects absolute and escaping archive paths; governed manifests validate canonical paths, complete archive inventory, byte size, and SHA-256 values before a writer is constructed; `FileTreeTargetWriter` performs binary-safe writes and read-back integrity verification. CI also has filesystem vulnerability scanning, CodeQL SARIF upload, SBOM generation, and license reporting.

### Installation Architecture Findings

#### Shared CLI path

1. `packages/cli/src/commands/install.ts` resolves a target, creates a writer factory, resolves/downloads/extracts a bundle, calls `validateManifest()`, calculates `getInstallableBundleFiles()`, writes through `writeTargetSafely()`, then records checksummed written bundle paths in the selected lockfile.
2. For a user-scoped `vscode`, `vscode-insiders`, or `copilot-cli` target, the shared layout data in `packages/infra/src/writers/default-layouts.json` sets `baseDir` to `${HOME}/.copilot`. Repository scope has a separate `.github` layout; other targets, including Kiro, use their declared target root.
3. `packages/app/src/install/pipeline.ts` provides the equivalent composable path: resolve, download, extract, validate, filter governed releases to declared installable files, preflight, write, and report structured events. `TargetWriteRejectedError` prevents accepting partial target content.
4. `packages/core/src/domain/collection/manifest-validator.ts` rejects a missing root `deployment-manifest.yml`; a governed `formatVersion: 1` archive must declare every archive entry, canonical paths, item identity/kind, installable versus metadata roles, and matching size/hash data. Legacy manifests retain compatibility behavior.
5. `packages/infra/src/extractors/zip-bundle-extractor.ts` normalizes ZIP paths into an in-memory byte map and rejects traversal paths. `packages/app/src/writers/file-tree-writer.ts` maps bundle prefixes through target layouts and writes raw binary content without UTF-8 corruption.

#### Extension path and duplication

1. Extension command/UI callers reach `RegistryManager.installBundle()` in `apps/vscode-extension/src/services/registry-manager.ts`. The app-level registry use case delegates the actual buffer install back to `BundleInstaller.installFromBuffer()`.
2. `apps/vscode-extension/src/services/bundle-installer.ts` constructs a local `InstallPipeline` bridge with a no-op resolver/downloader around the already-downloaded buffer. Its writer does not select the shared target writer: it writes the pipeline's supplied files into `context.globalStorageUri/bundles/<bundleId>` (or directly to the skills destination for the skills special case).
3. The extension then calls `UserScopeService` or `RepositoryScopeService` to perform a second filesystem phase. `UserScopeService.syncBundle()` reopens the cached manifest and processes only `manifest.prompts`; it creates symlinks or copies into the resolved target layout. `RepositoryScopeService` similarly reopens `manifest.prompts`, while delegating individual item placement to `FileTreeTargetWriter.writeManifestItems()`.
4. The app/core governed manifest contract makes `items[]` canonical and `prompts[]` optional. Therefore, a valid governed archive that exposes only canonical `items[]` can pass the shared validation yet produce no extension sync entries, because both extension scope services condition their target sync on `manifest.prompts`. This is a concrete compatibility gap to test before moving extension callers fully onto the shared path.
5. The extension recognizes a ZIP without `deployment-manifest.yml` and synthesizes a legacy fallback manifest in `BundleInstaller.installFromBuffer()`. The shared CLI rejects the same absence with `BUNDLE.MANIFEST_MISSING`. This behavioral divergence is directly relevant to the reported CLI failure and must be intentionally resolved rather than hidden by a new fallback.
6. `apps/vscode-extension/src/storage/vscode-app-storage.ts` intentionally retains `context.globalStorageUri` as the extension's bookkeeping root under ADR-0005. This is distinct from target output. The shared `AppStorage` abstraction and `XdgAppStorage` are the registry/bookkeeping boundary; `${HOME}/.copilot` and `${HOME}/.kiro` remain data-driven target roots, not registry roots.

#### Migration seams and constraints

1. Extension activation calls `runMigrations()` after registry initialization. `MigrationRegistry` stores named `pending`/`completed`/`skipped` records in `context.globalState`; `runMigration()` executes a callback and then marks it completed.
2. The existing source-ID migration moves/rewrites config, source-cache, and installation-record state and has explicit idempotence tests. It demonstrates the activation seam and test convention, but its completion record alone cannot represent per-bundle transfer progress, interrupted writes, duplicate outcomes, or rollback/retry status.
3. Existing extension installations are represented by both global-storage bundle cache data and registry installation records. A transparent move to `${HOME}/.copilot` must reconcile both; moving only copied prompt files would leave uninstall/update/record lookup semantics ambiguous.
4. Automatic deletion of extension-local cache data must remain disabled. Enable it only after the completion state, interruption recovery, byte/content duplicate comparison, ownership identification, and tests are specified. A failed or interrupted migration must leave the legacy source usable and repeatable rather than marking the whole migration completed.
5. Migration filesystem work needs the same security properties as installation: path containment under the approved legacy and target roots, symlink-aware handling, byte-preserving transfer/verification, atomic or journaled state transitions, and non-destructive conflict behavior for existing user files.

### Recommended Architecture Direction for Planning

- Keep `core` responsible for pure manifest/file inventory rules and port contracts. Keep `infra` responsible for ZIP, filesystem, XDG `AppStorage`, layouts, and concrete `TargetWriter` implementations. Keep `app` responsible for composing the install/migration use cases. CLI and VS Code extension should be delivery/composition layers only.
- Make the manifest-driven shared install pipeline the one target-write authority for both callers. The extension should adapt its downloaded buffer, VS Code notifications/events, and storage implementation at the boundary instead of caching then re-parsing and syncing through its own install policy.
- Retain `VsCodeAppStorage` only for extension registry/bookkeeping compatibility during the migration. Do not redirect that bookkeeping root to `~/.copilot`; the target layout already specifies `~/.copilot` for Copilot user-scope content.
- Preserve legacy manifest compatibility only where a defined adapter/normalizer can produce an explicit, validated install plan. The planner must decide whether manifest-less archives remain supported, are rejected uniformly, or require a separately versioned migration path; current CLI and extension behaviors differ.
- Prefer reviewable sequencing: first close shared pipeline/extension contract gaps and add parity fixtures; then switch extension composition to the shared path while retaining readable legacy data; then introduce a resumable non-destructive migration with explicit duplicate outcomes; only in a later, evidence-backed change consider cleanup/removal of obsolete cache paths and compatibility code.

### Technical Debt Signals
- The extension installer and both extension scope services retain a cache-then-sync installation policy alongside the shared app pipeline. The duplicated manifest parsing, target routing, rollback, checksum, symlink, and MCP paths are the principal migration risk.
- `BundleInstaller.installFromBuffer()` synthesizes a manifest when one is absent, whereas `validateManifest()` deliberately makes a root manifest mandatory. The inconsistent source of truth can mask invalid bundle structure in one delivery path.
- The extension’s focused `bundle-installer.test.ts` includes several interface/existence assertions rather than observable installation behavior, including tests described as validation while only asserting that local object literals are truthy. Migration acceptance tests should exercise real public commands/services and filesystem outcomes.
- `UserScopeService.unsyncBundle()` reconstructs its cache path from `context.globalStorageUri/bundles/<id>` instead of the installation record’s `installPath`, which becomes a direct compatibility concern once legacy cache copies are no longer the canonical installed source.
- `eslint.shared.mjs` deliberately downgrades several `@typescript-eslint/no-unsafe-*` rules and `require-await` to warnings, recorded as TODOs. Do not broaden that exception surface while extracting the installation flow.
- Current documentation describes a historical macOS Copilot prompts location and extension-local bundle storage; default layouts and user sync now resolve generic Copilot primitives to `${HOME}/.copilot`. Documentation and migration communication need a deliberate update after behavior is finalized.

## Handoff Summary
- **Intent-relevant finding**: The CLI is already substantially manifest-driven through the shared `core` -> `infra` -> `app` installation stack, with user-scoped VS Code/Copilot layout targeting `${HOME}/.copilot`. The VS Code extension still uses a distinct cache-then-sync path: `BundleInstaller.installFromBuffer()` stores files below `context.globalStorageUri/bundles/<id>`, then `UserScopeService`/`RepositoryScopeService` reparse the cache manifest and sync only `manifest.prompts`. The concrete divergence is evidenced by `packages/cli/src/commands/install.ts`, `packages/app/src/install/pipeline.ts`, `packages/core/src/domain/collection/manifest-validator.ts`, `apps/vscode-extension/src/services/bundle-installer.ts`, and `apps/vscode-extension/src/services/user-scope-service.ts`.
- **Intent-relevant finding**: The shared governed manifest schema treats `items[]` as canonical and `prompts[]` as optional, but the extension sync services only consume `prompts[]`. A caller-parity fixture containing a valid governed `items[]`-only archive is a necessary first regression test; without it, a direct extension switchover can turn a successful validation into an empty target installation.
- **Architecture trade-off**: A strangler migration through `app` preserves a working extension and makes each PR independently reviewable, consistent with ADR-0001. It costs temporary adapters and compatibility tests, but a big-bang move would combine target-layout, cache-state, manifest, repository-scope, MCP, and uninstall behavior changes into one hard-to-revert release.
- **Security/compliance implications**: Preserve the existing ZIP traversal checks, governed manifest inventory/hash validation, binary-safe write/read-back verification, local-file ownership protection, and CI security gates. The migration must never overwrite or delete a user-owned target file merely because its path matches an old bundle; compare content/identity first and record a non-destructive conflict result.
- **Risks / follow-up**: Define and test migration completion state, per-bundle/item progress, interruption recovery, retry behavior, duplicate equivalence and conflict rules, registry-record reconciliation, update/uninstall behavior after transfer, and cleanup eligibility before removing legacy cache material. Keep automatic legacy cleanup disabled until those rules have passed focused shared-package and extension tests. Update the installation-flow and user documentation only after the supported manifest-less-archive policy and migration behavior are approved.
- **Uncertainty**: This scan did not execute the test suites and did not inspect a real user global-storage directory. The exact on-disk legacy record combinations, symlink states, and user-created conflicts must be confirmed through fixtures and controlled migration tests before implementation.