# Unify the bundle lifecycle across CLI and extension

- **Date:** 2026-10-09
- **Status:** Approved design, not yet planned
- **Scope:** install / uninstall / update for all scopes, bundle fetching, MCP server installation, and a one-shot migration of existing extension installs

## 1. Problem

The bundle lifecycle has two independent implementations: one in `packages/cli`, one in
`apps/vscode-extension`. They disagree on where files go, what records an install, how a
bundle is fetched, and whether MCP servers are installed at all. The result is duplicated
bugs, duplicated maintenance, and divergent user-visible behavior.

### 1.1 Observed divergences

**Placement.** Three placement code paths are reached in production, with a fourth
layout-driven writer shared between two of them:

1. `FileTreeTargetWriter.write()` — prefix-routed, keeps bundle filenames. Reached by the
   CLI for **all user-scope installs** and for **repository-scope installs on every target
   except `vscode`, `vscode-insiders` and `copilot-cli`**.
2. `RepositoryScopeWriter` (`packages/infra`) — hardcodes `.github` and a private
   type→subdirectory map. Reached by the CLI **only** for those three Copilot-family
   targets at repository scope (`install.ts:581`, and the matching factories in
   `update.ts` / `uninstall.ts`).
3. Extension `UserScopeService` — symlink-or-copy into `~/.copilot/<route>/`, with
   manifest-driven routing and `{id}.{ext}` renaming done in the service itself.
4. Extension `RepositoryScopeService` — manifest-driven routing and renaming, then
   delegates actual placement to **`FileTreeTargetWriter.writeManifestItems()`**
   (`repository-scope-service.ts:296` for skills, `:344` for ordinary items).

So the manifest-driven writer in `app` is **already a shared production path** for
extension repository placement. The unification extends its reach; it does not wire up
something dormant.

**The real placement divergence is prefix-vs-manifest routing, and it is CLI-side.**
Fixture `apps/vscode-extension/test/fixtures/local-library/web-dev-bundle` declares
`file: prompts/typescript-standards.instructions.md` with `type: instructions`. The CLI's
prefix routing places it under `prompts/`; manifest routing places it under
`instructions/`. The extension is correct. Note this divergence is **internal to the CLI
too**: its Copilot repository writer routes by manifest type while its user-scope writer
routes by prefix, so the same bundle lands differently at the two scopes.

**Naming diverges independently of routing.** The CLI preserves the bundle filename
(`source.instructions.md`); the extension writes the normalized manifest id plus the
Copilot suffix. Old CLI file records therefore cannot be repaired by calling the new
naming function — a point that constrains migration (§8.3).

**`RepositoryScopeWriter`'s hardcoded `.github` is not a cross-target placement bug.**
Non-Copilot repository targets never reach it. Its cost is a duplicated, non-layout-driven
implementation for the three targets that do.

**User-scope artifact.** The extension's generic path extracts a bundle into a cache and
creates **symlinks** into `~/.copilot/<route>/`, falling back to copies when content is
transformed, under WSL, or when `symlink` fails, and **skipping pre-existing regular
files** as possibly user-owned. The CLI writes real files. The reported symptom — "the
extension installs into the hidden VS Code folder, the CLI installs properly to
`~/.copilot/agents`" — is this. Three branches deviate from the generic path and must be
classified individually before any blanket replacement: workspace-scope installs cache
under `context.storageUri` rather than global storage (`bundle-installer.ts:367`); skills
sources write straight to a scope-specific skills directory; and `local-skills` installs
**symlink a live source directory** rather than an extracted cache
(`install-registry-bundle.ts:170` → `bundle-installer.ts:1002`).

**State.** The extension records user- and workspace-scope installs as **JSON files**
through `AppStorage` (`registry-storage.ts:453`), not `globalState` — which holds
preferences and migration flags. The CLI records them in the XDG user lockfile. Neither
layer sees the other's installs.

**Fetching.** Two parallel stacks, both in `infra`:

| | CLI | Extension |
|---|---|---|
| Port | `BundleResolver` + `BundleDownloader` | `SourceAdapter` |
| Implementation | `infra/resolvers/` + `infra/downloaders/` (1159 lines) | `infra/adapters/` (4125 lines) |
| Source types | github, awesome-copilot, skills, local-skills, local-awesome-copilot, local | those **plus** azure-devops, apm, local-apm |

`createSourceAdapter` has zero CLI callers, while
`packages/core/src/ports/source-adapter.ts` states its adapters exist so they "can be
implemented once and shared by both the CLI and, eventually, the extension" — the reverse
of reality. The CLI cannot install from Azure DevOps or APM sources at all.

**MCP.** MCP server installation is extension-only: `McpServerManager` (801 lines) +
`McpConfigService` (472 lines). `packages/cli/src/commands/{install,uninstall,update}.ts`
contain **zero** `mcp` references. A bundle declaring `mcpServers` installed via the CLI
silently gets none. Meanwhile `resolveMcpLayoutConfig` — the layout-driven, per-scope MCP
file resolver in `app` — is **already reached** from the extension, via
`McpConfigLocator` (`mcp-config-locator.ts:66`), as are `core`'s `resolveMcpConfigPath`
and `resolvePathTokens` (`:191`). The MCP gap is therefore not an unwired resolver; it is
that the CLI's registered install/update/uninstall writers perform **no MCP mutation at
all**.

**Rules the CLI is missing.** `LockfileManager.detectModifiedFiles()` plus
`LocalModificationWarningService` warn before an update clobbers local edits; the CLI
writes per-file checksums on install and never compares them, silently overwriting.
`ScopeConflictResolver` enforces "a bundle lives at one scope only"; the CLI does not.

**The same lockfile fields mean different things to each writer.** Not merely different
state locations — the shared `LockfileFileEntry` shape is interpreted two ways:

| Field | Extension (`collectRepositoryFileEntries`) | CLI (`checksumFiles`) |
|---|---|---|
| `path` | `path.relative(workspaceRoot, targetPath)` → **on-disk, repo-relative** | the extracted-files map key → **bundle-relative** |
| `checksum` | `calculateFileChecksum(targetPath)` → **on-disk, post-transform** | `sha256(archiveBytes)` → **source bytes** |

A single repository can contain both, since the extension and CLI can each install into
it, and `generatedBy` records only the last writer. The extension's
`LockfileSourceEntry` also omits `collectionsPath` entirely, which app's includes.

**`sourceId` is portable for hub sources and not for manual ones.** Hub-loaded sources get
`generateHubSourceId` → `{type}-{sha256(type:normalizedUrl:branch:collectionsPath)[0:12]}`,
documented as "Portable: Not tied to user's hub configuration". Manually added sources
(`source-commands.ts:533`) get `generateSanitizedId(name)`, derived from the user-typed
display name — so a teammate replaying the lockfile has a different id, and the id carries
no `{type}-` prefix for `install.ts:1538`'s type sniffing to read.

### 1.2 Defects found during design, fixed by this work

- **`workspace` scope has the same *destination* as `user` scope, but not the same
  behavior throughout.** `ScopeServiceFactory` maps both to `UserScopeService` and
  `resolveLayoutFromLayers` routes every non-`repository` scope through the `user` layout
  branch, so generic primitive placement is identical. It is **not** identical elsewhere:
  the bundle cache resolves to `context.storageUri` for workspace
  (`bundle-installer.ts:367`), workspace skills go to the workspace's own
  `.copilot/skills`, and MCP maps workspace onto the **repository** config scope
  (`mcp-config-service.ts:121`). Retiring `workspace` is therefore a deliberate semantic
  move for those branches, not the removal of a pure duplicate.
- **Multi-target lockfile collision.** `lockfilePathForTarget`
  (`packages/cli/src/framework/target.ts:101`) returns the same single user lockfile for
  every user-scope target, and entries are keyed `bundles[bundleId]`. Installing one
  bundle to a `my-vscode` target and then a `my-kiro` target overwrites the first's file
  list, orphaning its files on uninstall. The same collision exists at repository scope
  (`.github` vs `.kiro` under one repo lockfile). The extension never hits it because it
  has exactly one host.
- **Drift detection is broken for CLI-written lockfiles, and incomplete generally.**
  `LockfileFileEntry.checksum`'s documentation — "SHA256 of the extracted archive bytes for
  this path (not the optionally transformed on-disk result). User-modification checks
  compare this against the current file; transformed files will therefore look modified
  until an `installedChecksum` field is added (issue #357 Stage 2)" — describes the CLI's
  behavior only. `detectModifiedFiles` compares the on-disk hash against `entry.checksum`,
  which is **correct** for extension-written entries and wrong for CLI-written ones. Two
  further gaps: `detectModifiedFiles` reads only the main lockfile, so `local-only`
  entries are never checked, and `RegistryManager`'s modification check returns early for
  non-repository scope (`registry-manager.ts:595`), so user-scope edits are never
  protected at all. A CLI-written entry can also mismatch on *path* before checksum
  comparison is even reached.
- **`checkAndOfferMissingSources` offers a remedy it does not implement.** It compares
  lockfile source ids against locally configured ids, prompts "Would you like to add
  them?", and on confirmation does nothing: "Actual addition would be handled by
  RegistryManager/HubManager. For now, just log the intent."
- **Type inferred from an id.** `install.ts:1538` decides a source is awesome-copilot via
  `entry.sourceId.startsWith('awesome-copilot-')`, misclassifying any name-derived id as
  plain `github` and sending it down the wrong fetch path.
- **Kind vocabulary gap.** `KIND_TO_ROUTE_KEY` is keyed on the 5-value `CopilotFileType`,
  so `writeManifestItems` silently `skipped.push()`es any other kind. Against the 19
  canonical `PRIMITIVE_KINDS` that leaves 12 unreachable through it — 11 placeable kinds
  plus the non-placed `mcp-server`. Since this writer is already the extension's
  repository placement path (§1.1), that gap is live today, not hypothetical. Note also
  that `kindRoutes` keys are **source-path prefixes**, not canonical kind names, and that
  `getTargetFileName` accepts Copilot *aliases* (`instructions`, `chatmode`) rather than
  canonical kinds and does not normalize the id itself.
- **Binary-unsafe local sources.** `LocalAdapter`, `LocalAwesomeCopilotAdapter` and
  `LocalSkillsAdapter` each document the same flaw in their own headers: they build a ZIP
  with `archiver` reading each file as text, so binary bundle assets are corrupted and
  content hashes diverge from raw-byte hashes.
- **Deprecated MCP destinations.** `vscode` and `vscode-insiders` write to
  `${vscodeUserDir}/mcp.json` and `.vscode/mcp.json`, both of which VS Code documents as
  deprecated.
- **`McpConfigLocator` always resolves the default VS Code profile**, so a user-scope MCP
  install made under a non-default profile writes a file that profile never reads
  (documented as a KNOWN LIMITATION; upstream VS Code issues closed as not planned).
- **Dead code.** `UserScopeService.detectActiveProfile` (80 lines) and
  `getActiveProfileName` (32 lines) are defined and never called.

## 2. Goals and non-goals

### Goals

- One code path decides where a bundle file lands and what records it, for every scope and
  every host.
- The same bundle installed by the CLI or the extension produces byte-identical on-disk
  results and is visible to both.
- `UserScopeService` and `RepositoryScopeService` are deleted.
- Existing extension installs transfer to the unified layout without the user having to
  act, and without a surprise diff in a shared repository.
- The lockfile schema supports a future `install --lockfile --target <t>` per-harness
  workflow **without a further breaking change**.
- The committed lockfile is portable: a teammate can replay it on a different harness,
  on a different machine, without having configured the same sources by the same names.
- Opening a repository never dirties the working tree.

### Delivery constraints

This is a large refactor, so incremental delivery is a **requirement**, not a scheduling
preference — it constrains the design.

The priority is **end-to-end testability from the first PR**, accepting larger PRs to get
it. An additive-only sequence (new module, then new port, then new reader, each with no
caller change) would keep PRs small but leave nothing exercisable end to end until the
cutover PR, which is the wrong trade: the assumptions in this spec most need testing against
real installs, early.

**One feature flag, dual-surfaced.** `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` for the CLI
(following `isGitHubAppAuthEnabled` / `GITHUB_PUBLIC_AUTH_MODE` in `infra`) and
`promptregistry.unifiedDeploy` for the extension (following the existing
`promptregistry.*` settings). Default **off**.

Rules:

- **Every PR is a vertical slice**: a complete resolve → place → record path for some
  narrowing of (producer × scope × target), runnable and E2E-testable on merge with the
  flag on.
- **Flag off keeps `main` releasable.** The legacy path is untouched and remains the
  default, so no PR needs a later one to be correct.
- **Every PR adds a flag-on E2E test** for the slice it delivers, run in CI alongside the
  flag-off suite. The golden placement matrix (§10) grows one column per slice.
- **Readers before the flag flips, not before the writer merges.** The v2-compatible reader
  must ship before `unifiedDeploy` defaults on — that is the real constraint, and a flag
  satisfies it without serializing PRs.
- **One producer per cutover PR** (§3.7), so a regression is attributable.
- **Deletions are separate PRs**, after the flag defaults on, each gated on an entry-point
  test proving no callers remain.
- No line-count target. Slices are sized by "smallest thing that is E2E-testable", which is
  typically 600–1200 lines including tests.

**Accepted cost, deliberately:** both paths coexist for the duration of the cutover, which
means double maintenance and a doubled test matrix for the flagged surfaces. That is the
price of testing real behavior early instead of at the end, and the flag plus the deletion
PRs bound how long it lasts.

### Non-goals

- Unifying the source **configuration** models (CLI `targets.yml` + hub config vs the
  extension's registry sources UI). Both already produce `RegistrySource`, so they
  converge for free at the adapter boundary; the models themselves stay.
- Unifying hub/profile management (`hub-manager` is 858 lines in the extension against
  584 in `app`). Separate concern, separate change.
- Collapsing `InstallPipeline` and the registry use-cases into a single orchestrator.
- Making `install --lockfile --target` a first-class per-harness workflow. The schema and
  most of the behavior will support it; promoting it is a follow-up.
- Re-keying `kindRoutes` by canonical kind (see §4.7). It is a schema change across 22
  definitions plus the user and project override files, for no behavior gain.

### Decisions taken

| Decision | Choice |
|---|---|
| Scopes in play | all three |
| Source of truth for installs | shared lockfile |
| User-scope artifact | real file copies, not symlinks |
| `workspace` scope | retired; `user` and `repository` remain |
| Existing `workspace` records | migrate to **user** scope (their files are in `~/.copilot/`) |
| Migration trigger | **user scope** eager at activation; **repository scope** lazy on first write |
| MCP | folded into the shared lifecycle |
| Bundle fetching | unified on `SourceAdapter`, auth injected per layer |
| `apm` / `local-apm` | retired |
| Unknown source type | warn and skip, rest of the hub loads |
| MCP destinations | portable only |
| Lockfile split | by **role** (desired vs materialized), not by commit mode |
| Committed per-file checksums | none — verification by re-derivation |
| Developer autonomy | `excludes` list plus local version pin; local wins |
| Lockfile filename | renamed to `ai-primitives-hub.lock.json`; ADR-0004 amended |
| Legacy committed lockfile | deleted during the lazy migration, in the same diff |
| Safety nets | no backup, no rollback, one info notification |

## 3. Architecture

The shared core spans **resolve → download → deploy**. Only token providers and UI differ
per delivery layer.

```
            CLI                                   Extension
   targets.yml / hub config               registry sources UI / storage
            │                                        │
            └──────────► RegistrySource ◄────────────┘
                              │
                 app: createSourceAdapter(source, deps)
                 deps.fallbackTokenProviders:
                   CLI → defaultTokenProvider, GhCliTokenProvider, GhAppTokenProvider
                   Ext → VsCodeSessionTokenProvider (+ the same CLI chain)
                              │
                 infra adapters (7 types; apm, local-apm retired)
                   resolveBundle(spec)  → one bundle, no catalog walk
                   readBundleFiles(b)   → ExtractedFiles, local sources skip zip
                   downloadBundle(b)    → Buffer (remote)
                              │
                       app/deploy
                   extract → validate → place → MCP → git-exclude → record
```

### 3.1 New module: `packages/app/src/deploy/`

```ts
planDeploy(req: DeployRequest, ports: DeployPorts): Promise<DeployPlan>   // read-only
deployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult>
undeployBundle(req: UndeployRequest, ports: DeployPorts): Promise<UndeployResult>
redeployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult>
```

```ts
interface DeployRequest {
  bytes?: Uint8Array;              // remote sources
  files?: ExtractedFiles;          // local sources and `--from <dir>`; exactly one of the two
  bundleId: string;
  version: string;
  sourceId: string;
  sourceType: string;
  scope: 'user' | 'repository';
  targetName: string;              // key of the local materialization record
  targetType: TargetType;
  workspaceRoot?: string;          // required when scope === 'repository'
  commitMode?: 'commit' | 'local-only';
  allowedKinds?: readonly PrimitiveKind[];
  force?: boolean;                 // overwrite drifted files
}

interface UndeployRequest {
  bundleId: string;
  scope: 'user' | 'repository';
  targetName: string;
  workspaceRoot?: string;          // required when scope === 'repository'
}

interface DeployPlan {
  destinations: { kind: PrimitiveKind; from: string; to: string }[];
  skipped: { from: string; reason: string }[];
  drifted: string[];               // on-disk bytes ≠ installedChecksum
  missing: string[];               // tracked but absent
  conflict?: { bundleId: string; scope: 'user' | 'repository' };
  mcp: { configPath?: string; servers: string[]; skipped: { name: string; reason: string }[] };
}
```

`DeployPorts` = `{ fs, env, layoutLoader, lockfileStore, mcpConfigStore, gitExclude, onEvent? }`.

`planDeploy` touches no files. Both layers call it before deploying: the extension to
drive its warning dialog, the CLI to drive `--dry-run` and to refuse clobbering edits.

### 3.2 Port additions

Both optional, with defaults in `base-source-adapter.ts`, so no adapter is forced to
change.

| Method | Default | Implemented directly by | Why |
|---|---|---|---|
| `resolveBundle?(spec)` | filter over `fetchBundles()` | `GitHubAdapter` | Keeps `install owner/repo:foo@1.2.3` at one API call |
| `readBundleFiles?(bundle)` | unzip `downloadBundle()` | `LocalAdapter`, `LocalSkillsAdapter`, `LocalAwesomeCopilotAdapter` | Removes the zip round-trip and the text-mode `archiver` read those three document as binary-unsafe |

`resolveBundle` dissolves the justification recorded in
`infra/src/resolvers/resolver-registry.ts` — "Overlap with
`RepositoryAdapterFactory`/`adapters/*` source-type dispatch is intentional and stays
(list-all-bundles vs resolve-one-spec are different consumer needs)". One port serves both
needs. An ADR records the overrule rather than silently contradicting the module doc.

### 3.3 What each delivery layer keeps

Source and auth resolution, progress and notification UI, scheduling, and the decision of
what to do when `planDeploy` reports drift or a conflict. Nothing else.

### 3.4 Removed

| Item | Lines |
|---|---|
| `infra/resolvers/` + `infra/downloaders/` incl. `SourceDispatcher` | 1159 |
| `ApmAdapter`, `LocalApmAdapter` | 1093 |
| `ApmRuntimeManager`, `ApmCliWrapper` | 864 |
| `UserScopeService` | 820 |
| `RepositoryScopeService` | 1036 |
| `scope-service.ts`, `scope-service-factory.ts` | 131 |
| `RepositoryScopeWriter` + `RepositoryScopeWriterAdapter` | 696 |
| `McpConfigLocator` | — |
| `FileTreeTargetWriter.write()` prefix routing + `pickRoute` | — |
| ~60% of `BundleInstaller` | ~700 |
| CLI inline write/record blocks in `install.ts`/`update.ts`/`uninstall.ts` | — |
| `ProcessRunner`/`NodeProcessRunner` wiring (sole consumer was `ApmAdapter`) | — |
| `VSCODE_USER_DIR_TOKEN` and its tests (zero users after §6) | — |

### 3.5 Relocated

- `McpServerManager` + `McpConfigService` (1273 lines, **zero** `vscode.` references) →
  `app/deploy/mcp`, file IO behind an infra store.
- Lockfile rules out of `LockfileManager` → `app` as pure functions over a `Lockfile`:
  `validate()`, `checkFilesMissing()`, `updateCommitMode()`, `detectModifiedFiles()`,
  `getInstalledBundles()`, `remapSourceId()`. `ensureLocalLockfileExcluded()` → the
  git-exclude port. `LockfileManager` keeps `getInstance`, `onLockfileUpdated` and
  delegation: ~1151 → ~250 lines.
- `RepositoryScopeService.collectFilesUsedByOtherBundles` → `app`, widened (see §6.5).

### 3.6 Kept

- `--from <dir>` stays a CLI flag that bypasses source resolution: `readLocalBundle` feeds
  `ExtractedFiles` straight into `deploy`. It is a different concept from the `local`
  **source type** and both survive. CLI `local` means "this directory *is* one built
  bundle"; `LocalAdapter` means "this directory *is a source* containing many bundles".
  The `local` source type has no CLI resolver today — `SourceDispatcher` has no `local`
  case and imperative install falls back to GitHub — so unifying on `SourceAdapter` adds
  that capability rather than preserving it.

### 3.7 Cutover inventory — every reached lifecycle producer

`InstallPipeline` is **not** the CLI's driver. `new InstallPipeline` is constructed in
exactly two places: `bundle-installer.ts:841` (the **extension**) and `app`'s generic
`installBundle`, which has no callers at all. The CLI's registered `InstallCommand`
resolves, downloads, extracts, validates, writes and records **inline**, in three separate
branches. So "keep `InstallPipeline` as the CLI's driver" was backwards, and a cutover
scoped to `install.ts`/`update.ts`/`uninstall.ts` write blocks would miss most producers.

| Layer | Producer | Note |
|---|---|---|
| CLI | `install.ts:853` local, `:952` lockfile replay, `:1029` remote | three independent write+record branches |
| CLI | `update.ts:502`, `uninstall.ts:228` | own writer-factory selection each |
| CLI | `profile.ts:409` activation/deactivation, `:482` direct write/record loop | not in the original deletion table |
| CLI | `apply.ts` | not in the original deletion table |
| Extension | `BundleInstaller.installFromBuffer` (`:674`, pipeline at `:841`) | MCP and scope sync happen **outside** the pipeline |
| Extension | `BundleInstaller.uninstall`, `update` (`:967` — uninstalls old before new succeeds) | |
| Extension | local-skill symlink installer (`:1002`) | links a live source directory |
| Extension | scope and commit-mode commands (`bundle-scope-commands.ts`) | reach `ScopeConflictResolver` and `updateCommitMode` |
| Extension | `UpdateScheduler:186` → auto-update | can reach real install writes at startup (§8.1) |
| Extension | `RegistryManager.getAdapter:390` → `infra-adapter-factory:70` → `createSourceAdapter` | the fetch path to preserve |

Consumers that read the state being replaced, and therefore need rewiring in the same
slice as the producer they depend on: `LockfileManager`'s watchers and paired readers
(`:188`) and `getInstalledBundles` (`:1008`), `PromptLoader`'s direct cached-manifest and
file reads (`:57`), `RegistryStorage`'s installation JSONs (`:453`), the marketplace and
tree UI, and `profile.ts`'s record loop.

`installRegistryBundle` / `uninstallInstalledBundle` keep their ports shape, and their
`installFromBuffer` / `removeInstallation` implementations do become thin calls into
`deploy`. But `updateRegistryBundle` delegates through a **different** update port and
`:59` picks the *first* installation matching a bundle id — it carries no target
discriminator, so it is not sufficient once one bundle has materializations for several
targets. That port changes shape; it is not a one-line swap.

Approximate totals: ~6500 lines deleted (the §3.4 table alone sums to ~6500 before the
unsized entries), ~2000 relocated, 2 new port methods, 1 new `app` module. These counts
measure removal, not coverage: one missed registered producer matters more than several
thousand deleted lines.

## 4. Placement and naming

### 4.1 Routing

Manifest-driven, always. `item.type` — falling back to detection from path and tags —
selects the kind; the resolved layout maps kind → output directory. Source-path-prefix
routing is deleted.

### 4.2 Vocabulary

Route on `PrimitiveKind`; `CopilotFileType` leaves the placement path. This is mandatory,
not cleanup: with a `CopilotFileType`-keyed route map, `writeManifestItems` hits
`outPrefix === undefined` and silently skips `hooks/` and `plugins/` (present in 20 of 22
layout scope definitions), `powers/` (8), `knowledge/`, `playbooks/`, `.kiro/steering/`,
`.kiro/specs/` (4 each), plus `.claude/commands/`, `.claude/output-styles/`,
`.cursor/rules/`, `.opencode/tools/`. Cutting over as-is would regress against
`RepositoryScopeWriter`, which handles `hook` and `plugin` today.

### 4.3 Building the kind→directory map

No new hardcoded table. `kindRoutes` keys are source-path prefixes; invert them through
the existing `routeToKind()` (which composes `normalizePrimitiveKind` and
`ROUTE_PREFIX_KINDS`) to derive `Map<PrimitiveKind, outputDir>` from the resolved layout.

The inversion was verified unambiguous across all 11 targets: wherever a kind reaches a
layout via two keys, both carry the same output value — cursor's `.cursor/agents/` and
`agents/` both yield `agents/`; opencode's `.opencode/hooks/` and `hooks/` both yield
`hooks/`. A guard test asserts this for every target × scope; the resolver throws on a
genuine conflict rather than picking one.

This produces correct host-aware placement for free: on `kiro`, kind `prompt` routes to
`steering/`; on `claude-code`, to `commands/`.

### 4.4 Naming

| Shape | Kinds | On-disk name |
|---|---|---|
| Copilot-suffixed file | `prompt`, `instruction`, `chat-mode`, `agent` | `{normalizedId}.{suffix}.md` via `getTargetFileName` |
| Directory | `skill`, `plugin`, `power` | `{normalizedId}/`, relative paths preserved, byte-for-byte |
| Plain file | `hook`, `command`, `rule`, `output-style`, `tool`, `knowledge`, `playbook`, `steering`, `spec` | source basename preserved |
| Not placed | `mcp-server` | handled by §6 |

Renaming is a no-op for well-formed bundles: `create-component` declaring
`prompts/create-component.prompt.md` yields the same name. It only matters when `id` and
filename stem disagree.

### 4.5 Repository scope

The layout's `repository` branch already supplies `baseDir` for non-Copilot targets, and
the CLI already routes them through `FileTreeTargetWriter` — a runtime probe across all 11
target types at both scopes confirms `.kiro/steering/`, `.cursor/rules/`,
`.claude/commands/`, `.opencode/commands/`, `.devin/prompts/` and `.windsurf/rules/`.
Retiring `RepositoryScopeWriter` therefore **does not relocate those targets**; it removes
a duplicated, non-layout-driven implementation for `vscode`, `vscode-insiders` and
`copilot-cli`, and brings them onto manifest routing with the shared naming rule. The
user-visible change is confined to those three targets plus the CLI's prefix-routed
user-scope installs.

`target.allowedKinds` filtering is preserved, now comparing canonical kinds directly
instead of round-tripping through `copilotTypeToPrimitiveKind`.

### 4.6 Placement inputs must be explicit before it can be called pure

§5.9's verification-by-re-derivation depends on placement being a pure function. It is a
function of more than (manifest, targetType, scope): it also depends on the **resolved
layout layers** (the extension uses built-in resolution, the CLI loads hierarchical user
and project overrides), `target.path` / `rootPath`, the environment used for `${...}`
expansion including WSL home resolution, `allowedKinds`, and the active transformer.
`DeployRequest` must carry all of them, otherwise re-derivation silently diverges from what
was written. Two consequences:

- Transform decisions are not purely manifest-driven today — some inspect the **source
  path prefix** (for example Kiro agents). Manifest-driven routing must supply equivalent
  semantic context, or byte parity is lost for those targets.
- Governed release manifests express items as canonical `items[]` with `kind`, while
  legacy manifests use `prompts[]` with `type` plus filename detection. Both formats are
  reached, so the placement input is "manifest item in either format", not `item.type`.

### 4.7 Implementation prerequisites in the writer

- `routeToKind` and `ROUTE_PREFIX_KINDS` are **private** to `file-tree-writer.ts:571`.
  Inverting layouts requires exporting and generalizing them deliberately.
- `getTargetFileName` accepts Copilot **aliases** (`instructions`, `chatmode`) and does not
  normalize the id. Routing on canonical `PrimitiveKind` needs a canonical→alias mapping
  plus explicit id normalization at the call site, which is what
  `RepositoryScopeService` does today outside the writer.
- `writeTargetSafely` (`install/target-write.ts:36`) **rejects any skipped content** before
  writing, or rolls back and throws after writing. It is not a warn-and-succeed helper, so
  the "unsupported kind → warn and skip" policy cannot run through it unchanged. Either
  unsupported kinds are filtered before the safety check, or that check needs a separate
  contract. Distinguish three cases explicitly: kind unsupported *by this target*, kind
  invalid in the manifest, and item excluded by governed inventory filtering.
- Layout inversion is safe for the enumerated built-ins; **arbitrary user overrides are
  not covered by that check**. Ambiguity must raise a diagnostic, not resolve by
  first-entry-wins.

### 4.8 Symlink safety is a port gap, not a one-line guard

Today's user-scope destinations may be symlinks into a cache, and the shared writer
resolves to the same paths. `fs.writeFile` follows a symlink, so writing through one would
mutate the cache rather than replace the link. Two problems with the obvious fix:

1. A per-file `lstat`/`unlink` guard is **insufficient**. A `local-skills` install symlinks
   a *live source directory*; a child path under it `lstat`s as an ordinary file, so a
   write below that directory mutates the user's real source. The guard must detect a
   symlinked **parent**, not just a symlinked destination.
2. `core`'s `FileSystem` port has **no `lstat`, no link identity, and no symlink flag on
   `stat`**. Shared `app` code therefore cannot implement this guard through the current
   port at all. A port capability must be added — making the real count three port
   additions, not two.

Until that capability exists, no slice may replace user-scope symlinks.

## 5. State

### 5.1 Two files, split by role — not by commit mode

| File | Git | Contents |
|---|---|---|
| `ai-primitives-hub.lock.json` | **committed** | desired state only: `bundles`, `sources`, `hubs`, `profiles` |
| `ai-primitives-hub.local.lock.json` | **git-excluded** | local desired overrides (`bundles`, `excludes`) + **all** materialization (`targets`) |
| `prompt-registry.lock.json`, `prompt-registry.local.lock.json` | legacy | read-only until lazy migration (§8), then deleted |

User scope keeps one XDG file, `ai-primitives-hub.lock.json`, carrying both roles — it is
machine-local by nature, so the split buys nothing there. Repository scope therefore
converges on the filename convention `resolveUserConfigPaths()` already uses.

The alternative considered and rejected was a three-file model splitting by commit mode,
keeping materialized records in the committed file keyed by `{targetType}:{scope}`. It
preserves committed per-file checksums, but leaves cross-user merge hazards (path
separators, `installedAt` churn, shared-destination refcounts across users) permanently
live. Role-splitting deletes that entire class of problem instead of defending against it.

### 5.2 Committed file — desired state

```ts
{
  $schema, version: "3.0.0", generatedAt, generatedBy,
  bundles: { "<bundleId>": { version, sourceId, checksum? } },
  sources: { "<deterministicSourceId>": { type, url, branch?, collectionsPath? } },
  hubs?, profiles?
}
```

`installedAt` and `sourceType` leave the bundle entry: the first is per-machine churn, the
second is already `sources[sourceId].type`. `checksum` (bundle archive SHA) stays —
content-addressed, so it never churns, and it lets replay verify a download. **There is no
`installs` section, ever.** The whole file is small, hand-editable, and is exactly what
`install --lockfile --target <t>` consumes.

### 5.3 Local file — overrides plus materialization

```ts
{
  version: "3.0.0",
  bundles?:  { "<bundleId>": { version, sourceId } },   // personal additions and version pins
  excludes?: string[],                                   // committed bundles to skip
  targets: {
    "<targetName>": {
      targetType, scope, baseDir, commitMode,
      bundles: { "<bundleId>": {
        version, installedAt,
        files: [{ path, checksum, installedChecksum }],
        mcpConfigPath?, mcpServers?
      } }
    }
  }
}
```

`targetName` is safe as a key here precisely because this file is never shared. In a
committed file it would not be: two developers installing for the same host under locally
chosen target names would commit two records describing the same files, breaking the §6.6
refcount — each record would believe it owned them.

### 5.4 Effective desired state

`effective = (committed.bundles − local.excludes) ⊕ local.bundles`, where `local.bundles`
overrides version. Pure function, deterministic.

### 5.5 `commitMode` loses its second job

It now means only "add the written files to `.git/info/exclude`". It no longer decides
where anything is recorded. "Dev A commits the `.github/` files; dev B uses kiro and does
not want to commit" and "dev B does want to commit" become the same code path with a
different boolean.

### 5.6 Reconcile

`reconcile(target)` installs `effective − materialized` and undeploys
`materialized − effective`. The first half is what `install --lockfile` already does; the
second half is new, and it is what makes removal propagate: A drops a bundle from committed
desired state, B pulls, and B's files are cleaned on next reconcile.

**The comparison is not pure bundle-id set subtraction** — the same id at a different
version must redeploy. It is kept deliberately narrow: reconcile compares
**`(bundleId, version, targetType)`**, and a mismatch means redeploy. Layout, transformer
and `allowedKinds` changes are *not* tracked; a user who changes a layout override re-runs
install explicitly. Redeploy removes old-only paths without disturbing paths still claimed
by another target (§6.6).

**Reconcile on workspace open is read-only** — it reports and offers, never acts. Acting
would write, and writing would trigger the lazy repository migration (§9), producing
exactly the unexpected diff that migration ordering exists to avoid. This matches what
`RepositoryActivationService` already does: detect and offer.

### 5.7 Path semantics

`path` is the **on-disk** path, POSIX-normalized, relative to the record's root: the
workspace root for repository scope, the resolved `baseDir` for user scope. Removal
iterates `targets[].bundles[].files[].path` joined to that root; nothing is recomputed.

This matters because the two writers disagree today. The extension stores on-disk
repo-relative paths (`collectRepositoryFileEntries` →
`path.relative(workspaceRoot, targetPath)`); the CLI stores bundle-relative paths
(`checksumFiles` → the extracted-files map key) and recomputes the destination at removal
time via `pickRoute`. Manifest-driven renaming (§4) makes recomputation impossible, so
recording the written path is the only correct option. The extension's existing behavior
is the one being adopted.

### 5.8 Two checksums, because today's single field means two different things

- `installedChecksum` — hash of the bytes **actually written** (post-transform). Drift
  detection compares against this.
- `checksum` — hash of the **source** bytes from the archive. Retained for provenance; not
  load-bearing.

The split is required because `LockfileFileEntry.checksum` currently means opposite things
depending on the writer: the extension stores `calculateFileChecksum(targetPath)` — the
on-disk, post-transform file — while the CLI stores `sha256(archiveBytes)`. The field's own
documentation ("SHA256 of the extracted archive bytes… transformed files will therefore
look modified until an `installedChecksum` field is added") describes **only the CLI**.
Consequently `detectModifiedFiles`, which compares the on-disk hash against
`entry.checksum`, is **correct today for extension-written lockfiles** and broken only for
CLI-written ones. Since a repository can contain both, the ambiguity cannot be resolved by
inspection and the field must be split rather than reinterpreted.

### 5.9 Verification by re-derivation, not stored checksums

Placement is a pure function of (bundle manifest, targetType, scope) after §4, so
`doctor`/`status` recomputes expected destinations from desired state and compares against
disk. No committed checksums are needed. This also catches a stale lockfile, which stored
committed checksums would have confirmed as healthy.

### 5.10 Source identity — three prerequisites

`sourceId` portability is currently split in two. Hub-loaded sources get
`generateHubSourceId` → `{type}-{sha256(type:normalizedUrl:branch:collectionsPath)[0:12]}`,
documented as "Portable: Not tied to user's hub configuration". Manually added sources
(`source-commands.ts:533`) get `generateSanitizedId(name)` — derived from the user-typed
**display name**, so non-portable, and carrying no `{type}-` prefix. Three fixes:

- **P1** `source-commands.ts:533` uses `generateSourceId(type, url, config)`; the display
  name stays in `name`, where it belongs. Ids become portable by construction.
- **P2** Sources resolve by **identity** `(type, normalizedUrl, branch, collectionsPath)`
  rather than by id, and `checkAndOfferMissingSources`' stub handler is implemented so the
  dialog actually adds what it offers.

  **P2 cannot universally recover legacy extension rows, and the spec must not promise it.**
  The extension writes `url: bundle.downloadUrl || bundle.manifestUrl`
  (`bundle-installer.ts:209`) — a **release-asset or manifest URL**, not the configured
  repository origin — and records no `branch` or `collectionsPath`. The CLI, by contrast,
  stores the repository URL. So for GitHub rows written by the extension, normalization and
  deterministic ids cannot reconstruct origin, branch or collections configuration that was
  never recorded. Required policy: write full canonical source descriptors for **new**
  entries; recover legacy descriptors **only where unambiguous**; otherwise retain the row,
  mark it unmanaged, and report the missing origin metadata. Local-directory sources stay
  machine- and path-dependent regardless of id determinism.
- **P3** Delete the type sniffing at `install.ts:1538`
  (`entry.sourceId.startsWith('awesome-copilot-')`), which silently misclassifies a
  name-derived id as plain `github`. Read the required `src.type` from `lock.sources`.

Deterministic ids are written only when something else is already being written (§9); P2
makes a read-time rewrite unnecessary.

A prior instance of this same bug already exists in the codebase:
`sourceId-normalization-v2` was needed because v1 lowercased only the host, so
differently-cased URLs produced different ids. It deliberately does not rewrite lockfiles
and relies on dual-read. P2 generalizes that approach instead of adding a third id format.

### 5.11 Rules, surfaced identically by both layers

| Rule | Moved from | `planDeploy` field | Extension | CLI |
|---|---|---|---|---|
| Local modification | `detectModifiedFiles()` | `drifted` | existing warning dialog | refuse unless `--force` (**new**) |
| Missing files | `checkFilesMissing()` | `missing` | repair prompt | report in `status` |
| Scope conflict | `ScopeConflictResolver` | `conflict` | existing migrate-with-rollback UX | refuse with hint (**new**) |
| Personal opt-out | — | excluded from `effective` | silently skipped | silently skipped |

## 6. MCP

### 6.1 Destinations — portable only

Per VS Code's MCP documentation, `$COPILOT_HOME/mcp-config.json` (falling back to
`~/.copilot/mcp-config.json`) and project-root `.mcp.json` are the portable destinations,
both keyed `mcpServers` and read natively by Agent Host. The user-profile `mcp.json` and
`.vscode/mcp.json` are listed as deprecated, with the guidance "Prefer the portable
destinations for new servers".

| target / scope | from | to |
|---|---|---|
| vscode user | `${vscodeUserDir}/mcp.json`, `servers` | `${COPILOT_HOME}/mcp-config.json`, `mcpServers` |
| vscode repository | `${workspaceRoot}/.vscode/mcp.json`, `servers` | `${workspaceRoot}/.mcp.json`, `mcpServers` |
| vscode-insiders user | as vscode | as vscode |
| vscode-insiders repository | as vscode | as vscode |

`${COPILOT_HOME}` resolves from env with a `${HOME}/.copilot` fallback. `expandPath`
already substitutes `${[A-Z0-9_]+}` from env, so this is a resolver detail, not a schema
change. `resolvePathTokens` throws `UnresolvedPathTokenError` on an unsupplied token, so a
host that cannot answer fails loudly rather than writing to `/mcp.json`.

Across the 11 targets there are **21** MCP scope entries, not 22 — windsurf has no
repository config. Four of them use the `servers` key (`vscode` and `vscode-insiders` × two
scopes) and seventeen already use `mcpServers`, so this change makes the fleet uniform.
`serversKey` stays in the layout schema — data-driven and free, and it preserves room for a
future `servers`-keyed target. **`supportsInputs` is removed**; it is `true` on those same
four entries, and custom overlays are an additional compatibility surface to validate.

**The deprecation premise is external and unverified.** Repository code establishes only
which paths this project currently writes. That `.vscode/mcp.json` and the user-profile
`mcp.json` are deprecated, that the portable files are Agent Host-native, and that
profile-scoped reads behave as described all come from product documentation, not from code.
§13 records them as cited, versioned compatibility decisions.

Two consequences, both simplifying: no profile-scoped MCP path remains, so
`McpConfigLocator` is deleted outright rather than reduced, its documented default-profile
limitation becomes moot, and `detectActiveProfile`/`getActiveProfileName` are deleted as
the dead code they already are. `${vscodeUserDir}` drops to zero users and retires from
`core`.

### 6.2 Inputs: skipping is a deliberate behavior change

**Today the extension writes the server and warns** when inputs are unsupported. Skipping
it instead is a deliberate reduction in behavior, not preservation, and it rests on an
**external, unverified** premise — that Agent Host will not forward input-requiring servers
and that the portable format has no `inputs` section. Repository code cannot establish
either; both come from product documentation. §13 records them as versioned compatibility
decisions.

`collectInputReferences` alone is **not sufficient** to implement the skip: it returns an
**aggregate** set of references across the whole config, not a per-server verdict, and it
omits the supported `envFile` mechanism (`core/src/domain/mcp/inputs.ts:59`). A per-server
predicate must be written, and unmanaged user-authored inputs must be preserved rather than
pruned.

`mergeInputs`, `autoDeriveMissingInputs` and `removeOrphanedInputs` are reached today and
some of their logic already lives in `app`/`core`. They are removed only once the per-server
predicate and the preserve-unmanaged-inputs rule are in place.

### 6.3 Relocation is more than extracting IO

`McpServerManager` (801 lines) and `McpConfigService` (472) contain no literal `vscode.`
references, but that is lexical, not architectural: they depend on the VS Code-backed
logger, the host detector, and `McpConfigLocator` (`mcp-server-manager.ts:14`). Relocation
must explicitly substitute logger and event sinks, target/host detection, context and root
and env supply, JSONC formatting, and exclusion handling. Deleting `McpConfigLocator`
removes a class, not its responsibilities — scope layout selection, token supply,
legacy-path lookup for migration, directory creation and diagnostics all still need owners
in the new module.

Layout and token resolution reuse `resolveMcpLayoutConfig` and `core`'s
`resolveMcpConfigPath` / `resolvePathTokens` — all three already production-reachable via
the locator, so this changes the caller rather than wiring something dormant.

**`${COPILOT_HOME}` is not resolved today.** The locator's token map does not contain it;
`resolvePathTokens` throws on an unsupplied token and `expandPath` would substitute an
empty string. The new module must supply a non-empty value explicitly, with the
`${HOME}/.copilot` fallback computed by the caller, and must define behavior for empty,
relative and `~`-prefixed overrides. Note `resolvePathTokens`' loud failure is unrelated to
server-level `${env:...}` expansion, which substitutes missing values with `''`.

**Durable server assets are missing from `DeployRequest`.** `${bundlePath}/servers/start.js`,
`envFile`, command arguments, URLs and headers are expanded against the legacy install
root. Copying only manifest-recognized primitives does not necessarily retain those
auxiliary files. The request must name a **durable runtime asset root** and keep it alive
for as long as MCP entries reference it, with user and repository semantics defined
separately from config-path token resolution.

### 6.4 Scope vocabulary

`'user' | 'workspace'` → `'user' | 'repository'`, matching `McpConfigScope`. Note the
existing mapping sends workspace to the **repository** config scope
(`mcp-config-service.ts:121`), unlike primitive placement which sends it to user — so this
rename is a semantic decision, not a relabel, and it interacts with the workspace
retirement (§1.2).

The install/uninstall pairs cannot collapse without resolving real differences: the user
path uses the bundle root, deduplicates, and attempts re-enablement, while the repository
path uses the workspace root, handles excludes, and does not deduplicate. Collapsing them
means choosing one behavior per difference, explicitly.

The no-fallback rule stays: windsurf has no repository MCP file, and inheriting the user
entry would make a repository install write into `$HOME`.

### 6.5 Tracking sidecar: ownership transfer, not deletion

Folding `managedServers` into `targets[t].bundles[b].mcpServers` (§5.3) plus
`mcpConfigPath` is the right direction, and dropping `originalConfig` is safe in the narrow
sense that current deduplication does not read it. But the sidecar **cannot be deleted per
bundle**: its filename is fixed per config directory
(`mcp-config-locator.ts:198`), so it carries cleanup ownership for **every** bundle sharing
that directory. Deleting it after transferring one bundle orphans the others.

Two further behavior facts constrain the replacement:

- Duplicate detection computes identities from the **live config**, considers disabled
  state and iteration order, and includes **unmanaged** entries
  (`mcp-config-service.ts:290`). Iterating materialization records alone loses unmanaged
  participants and live edits, so the current config must still be read.
- The stored identity is lossy — `computeServerIdentity` joins args with `|` and ignores
  env/`envFile`, so `['a|b']` and `['a','b']` collide, and remote identity ignores headers
  and transport. Persisting that key would freeze false duplicates into the new state
  contract. Either compute identities live, or fix the identity function before persisting
  it.

### 6.6 Shared destinations: refcount is necessary, not sufficient

`.mcp.json` is already shared by `copilot-cli` and `claude-code`; adding `vscode` and
`vscode-insiders` makes four target types. Kiro and Devin host pairs already share paths
too, so this is an existing condition the design widens rather than creates.

`collectFilesUsedByOtherBundles` moves to `app` and widens to targets and MCP entries, but
it is a **deletion-membership guard**: it prevents premature removal. It does not resolve
two owners needing *different bytes or different config* at the same path, partial updates,
or concurrent mutation. Those need a conflict verdict surfaced by `planDeploy` and
serialized state writes (§8.4), not a counter.

### 6.7 Minimum MCP migration contract

- Read old configs and **every** relevant sidecar before new layout lookup hides them.
- Keep repository MCP changes lazy, including legacy workspace-scope MCP.
- Distinguish managed owners from unrelated manual entries.
- Preserve live edits, explicit disabled state, automatic-disable provenance, unrelated
  inputs, and top-level JSONC state.
- Detect same-name/different-content collisions at the destination.
- Transfer **every** owner in the sidecar in one pass on first touch, then delete it. No
  per-bundle incremental transfer — a partially transferred sidecar is the dangerous state,
  so the simplest safe rule is all-or-nothing per config directory.
- Retain cleanup ownership for APM, missing-cache and unmanaged records.
- Write the MCP config before its materialization record, so an interruption leaves a
  tracked-but-unwritten entry rather than an untracked server.
- On malformed or partial JSONC, stop and report; do not rewrite a file that cannot be
  parsed.
- Record actual applied effects after a non-fatal partial failure.
- Do not treat an old sidecar claim as proof a write succeeded: the `skipOnConflict` option
  populates tracking before a successful merge. The registered installer passes it `false`,
  so this is a public-API defect rather than the normal path, but migration reads sidecars
  written by any caller.

## 7. Retiring APM

`SourceType` in `packages/core/src/domain/source/types.ts` shrinks from 9 to 7. Removed:
`ApmAdapter` (650), `LocalApmAdapter` (443), `ApmRuntimeManager` (580), `ApmCliWrapper`
(284). The extension carries an **independent** source union, and the UI source-creation
flow, factory and exports need coordinated changes.

`ProcessRunner`'s only *execution* consumer is `ApmAdapter`, but the registered CLI
`hub.ts:675` also constructs and passes `NodeProcessRunner`, so that wiring must be updated
rather than assumed gone. The separate `ProcessExecutor` port
(`core/src/ports/process-executor.ts:14`) stays — non-APM authentication, WSL, `gh` and
proxy execution still use process execution.

Retiring the adapters does **not** automatically retire APM authoring support: the APM
validation command and its schema tooling are independently registered. Whether authoring
support remains is a separate, explicit decision.

**Graceful degradation is not free.** Warn-and-skip is **not** current behavior: source sync
isolates per-source failures, but `createSourceAdapter` throws on an unknown type and deep
hub validation reports errors. More importantly, **wire-format enum validation can reject
the whole config before any skip logic runs** — `schemas/hub-config.schema.json:77` and
`packages/core/src/public/schemas/lockfile.schema.json:101` both enumerate source types. So
removing enum members requires a deliberate retired/unknown-value policy in the schemas and
at the load boundary, or existing configs fail to load entirely. Lockfile replay of an
unsupported type currently returns `null` with verbose-only messaging, so "unmanaged with
one warning" must be implemented, not assumed.

Thirteen files under `docs/` reference apm, including `docs/user-guide/sources.md` and
`docs/author-guide/creating-a-hub.md`. (An earlier count of ten in this spec was wrong — a
truncated search.)

## 8. Migration

### 8.1 Triggers — eager for user scope, lazy for repository scope

| State | Trigger | VCS impact |
|---|---|---|
| User scope (`globalStorage` records, cache, symlinks, XDG lockfile) | **Eager**, at activation via `runMigrations()` | none — machine-local |
| Repository scope (`prompt-registry.lock.json` + `.local.lock.json`) | **Lazy** — first install / uninstall / update in that repository | one intentional diff, attached to an action the user initiated |

Lazy repository migration exists so that merely opening a repository in VS Code never
produces a dangling working-tree change. Rules that follow:

- **No write-on-read for repository scope.** Opening a workspace reads legacy files in
  place and changes nothing — including the P1/P2 id rewrite, which happens only when
  something else is already being written.
- **Reconcile on open is read-only** (§5.6), and read-only reconcile alone is not enough:
  `UpdateScheduler:186` reaches `autoUpdateBundles` when
  `promptregistry.updateCheck.autoUpdate` is on (it defaults to `false`), so a scheduled
  write can occur without any user action. The rule is a **call-site** one rather than a
  flag threaded through the write path: repository migration is invoked **only from the
  install, uninstall and update command handlers**. Reconcile, the update scheduler and
  source sync operate through the legacy reader and never migrate. Auto-update also cannot
  reach repository records today because storage listing excludes them; the call-site rule
  means that staying true is not load-bearing.
- **`--dry-run` never migrates**, and must perform no writes through *any* port, including
  cache synthesis, store initialization and auth setup.
- The repository pair migrates **together, atomically**, on that first write: the new
  committed file is written, the legacy committed file is deleted, and the legacy local
  file is folded into the new local file. The developer commits one coherent diff alongside
  whatever they were already doing.
- A repository nobody installs into stays on legacy indefinitely and keeps working through
  the v2 reader. The exposure window for a mixed-version team therefore only opens when
  someone deliberately acts.
- Concurrent migration on two branches produces identical committed content, since desired
  state is deterministic. The only conflict is the add/delete pair.

**Accepted cost:** the v2 **reader** for the committed repository file stays alive
indefinitely, tagged `@migration-cleanup(lockfile-v3)`. That is the price of not dirtying
working trees.

### 8.2 User-scope migration

Install records are **JSON files** under `AppStorage` (`registry-storage.ts:453`), not
`globalState` — which holds preferences and migration flags and is not install truth.

Each record is classified before anything is written, because the generic path is only one
of four:

| Record kind | Cache / source location | Migration |
|---|---|---|
| Generic user install | `globalStorage/bundles/<bundleId>` | redeploy from cache, replace links with copies |
| Generic workspace install | `context.storageUri/bundles/<bundleId>` (`bundle-installer.ts:367`) | redeploy; scope folds to user (a semantic move, §13) |
| Direct skill install | written straight to a scope-specific skills dir; may have **no** extracted cache manifest | adopt in place; do not redeploy from a cache that does not exist |
| `local-skills` install | **symlink to a live source directory** (`bundle-installer.ts:1002`) | adopt the link; **never** copy over or write beneath it (§4.8) |

Then, per classified record: redeploy or adopt, write the materialization record to the
local side of the XDG lockfile, and remove the JSON install record. Workspace **skills**
live in the workspace's own `.copilot/skills`, so folding workspace to user is a deliberate
relocation for those and must be reported, not performed silently.

A record whose cache or source is missing is **retained and marked unmanaged** with the
bundle name — never dropped. Idempotent: completion is a per-record marker written last,
plus the `MigrationRegistry` flag; a materialization record alone does not prove the legacy
record was removed (§8.4). One info notification plus a logged summary.

§4.8's link-safety rule is a prerequisite: this step cannot ship before the `FileSystem`
link-identity capability exists.

### 8.3 Legacy records: provenance must be proven, not assumed

Most real lockfiles are extension-written, so extension semantics are the default
assumption — but that is an **external, unverified** premise about relative adoption, and
it must not be used to justify a lossy default. Every rule below therefore preserves
ambiguous records instead of converting them into success-shaped "migrated" rows.

**Where the record lives must be established first.** User- and workspace-scope installs
are JSON files under `AppStorage` (`registry-storage.ts:453`), not `globalState`. The
bundle cache is global storage for user scope but `context.storageUri` for workspace scope
(`bundle-installer.ts:367`), and direct-skill and `local-skills` installs may have no
extracted cache manifest at all.

**Path provenance: evidence, not proof — and one rule when it runs out.** Testing
`join(repoRoot, entry.path)` is a useful signal, but a CLI-written *bundle-relative* path
can independently exist in a repository that has its own `prompts/` directory, so existence
does not prove the entry was extension-written. And when the path is absent, the new
manifest-driven placement function will **not** reproduce the old CLI destination — old
rules were prefix-routed and kept the bundle filename; new rules are kind-routed and rename
to the normalized id.

No legacy-destination locator is built for this. Given the CLI's negligible adoption,
reimplementing its old prefix+filename rules to recover orphans is not worth the code. The
single rule is: **if the destination is not proven, leave the files alone, retain the record
marked unmanaged, and log it with the bundle name.** That one rule covers every ambiguous
case — unknown provenance, missing file, unrecoverable source descriptor — instead of a
taxonomy of them.

**Manifests are not guaranteed available.** Lazy migration does *not* imply the manifest is
in hand: an uninstall needs only records, a fresh team clone has no cache, a committed
desired-state-only lockfile carries no install items, and other bundles in the same file
are not being fetched. Migration must work from records alone where that is all it has.

**Checksums: preserve known baselines; never silently rebaseline.** The legacy value's
meaning depends on the writer (§5.8), so it cannot be interpreted blindly — but it also
must not be discarded wholesale. Rehashing current bytes destroys the one piece of evidence
that a file was locally modified, and does so for **extension** entries too, which is the
opposite of the intent. Rules:

- Bundle whose install/update triggered migration: compute `checksum` and
  `installedChecksum` fresh.
- Entry whose destination is **proven** and whose provenance is **extension**: carry the
  stored hash forward as `installedChecksum` unchanged. Pre-existing drift stays visible.
- Entry whose provenance is **CLI**: the stored hash is a source-byte hash and cannot serve
  as an on-disk baseline. Record `installedChecksum` from disk, flagged as adopted at
  migration so a later drift report does not imply the file is pristine.
- Anything ambiguous: the unmanaged rule above. Do not rebaseline.

**Target assignment is load-bearing, not cosmetic.** Because materialization is keyed by
target name and reconcile compares per target, a synthetic `legacy-<prefix>` name would be
invisible to named-target workflows. Path prefixes narrow a host *family* (`.kiro/` → kiro,
`.cursor/` → cursor, `.claude/` → claude-code, `.opencode/` → opencode) but `.github/` is
shared by three target types, and user overrides can move roots. Rule: bind to a configured
target when exactly one matches the resolved destination root; otherwise record the
materialization as **unmanaged with explicit paths**, which still supports cleanup and
refcounting but is excluded from reconcile until the user binds it.

**Carried over unchanged:** `version`, `sourceId`, `sourceType`, `installedAt`.
`commitMode` cannot simply become a target-level field: a single target can today hold both
committed and `local-only` bundles, so the mode is recorded **per materialized bundle**,
with the target-level value as a default only.

The CLI's XDG user lockfile already uses the new filename, so it needs only the shape
migration — with bundle-relative paths resolved through the same locator rules.

### 8.4 Atomicity, resume and mixed-version clients

A repository migration writes two new files and deletes two legacy ones. That is **not one
filesystem transaction**, so every intermediate state must be legal and resumable:

- New files written, legacy not yet deleted → legacy is ignored when the new committed file
  exists, so a resumed run simply completes the deletion.
- Materialization written but legacy records not removed → distinct from "done"; the
  `MigrationRegistry` flag and the record state can diverge, so completion is determined by
  a per-repository marker written **last**, not by the presence of a materialization record.
- Never delete legacy truth before the replacement is durably written.

**Concurrent mutation is an accepted risk, not an engineered one.** `writeAtomic` prevents
torn JSON but not a lost read-modify-write when the CLI and extension mutate the same
lockfile at the same moment. No lock or journal is introduced: simultaneous use of both
tools on one repository is rare, and the failure mode is a lost state entry that the next
operation re-derives, not corruption. Recorded in §13. The one ordering that still matters
is that an MCP config write precedes its materialization record, so a crash between them
leaves a tracked-but-unwritten entry rather than an untracked server.

**Mixed-version clients need a stated write policy.** The rename stops an un-upgraded
client from acting on a file it misreads, but it does not make a mixed-version repository
safe on its own: an old client can still recreate legacy state and will not see new
installs. Policy: an upgraded client that finds *both* generations treats the new one as
authoritative and does not resurrect the legacy file; a repository that has been migrated
is expected to have its team upgrade, and the migration notification says so.

### 8.5 MCP and APM

MCP entries move out of the legacy destinations into the portable files keyed `mcpServers`.
This is **not** a simple entry move — see §6.7 for the required ownership-transfer contract,
including the fact that the tracking sidecar has a fixed filename shared by **every** bundle
in a config directory, so it cannot be deleted after transferring one bundle.

Repository MCP changes stay **lazy**, including legacy workspace-scope MCP, which currently
maps onto the *repository* config scope (`mcp-config-service.ts:121`) — so eager
workspace-to-user migration of primitives must not drag repository MCP state with it.

APM-sourced records are retained on disk and marked unmanaged: skip eager redeploy, stop
retrying their source, and decide MCP cleanup ownership explicitly rather than leaving
their servers orphaned.

Current MCP config writes **create backups by default**. Removing that is a deliberate
safety-net reduction, not a neutral simplification, and is called out in §13.

## 9. Error handling

### 9.1 Error identity must satisfy two existing contracts, not resemble them

A shape that merely mirrors `InstallPipelineError` preserves neither mapping: the extension
checks `instanceof InstallPipelineError` (`bundle-installer.ts:894`), and CLI rendering
recognizes `RegistryError` and calls `toJSON()` on structured failure
(`cli/src/framework/error.ts:57`). `DeployError` must therefore either implement both
contracts or be translated at each delivery boundary. Translation at the boundary is the
cleaner choice and is what this design adopts.

### 9.2 Rollback does not restore overwritten bytes

`FileTreeTargetWriter.rollback` (`file-tree-writer.ts:300`) **deletes written paths**; it
does not restore prior content, and the repository writer has the same limitation. So a
failure after overwriting an existing installation currently destroys the previous files.
Three further gaps:

- The manifest writer can fail **before returning**, so the written-path list the caller
  would roll back with does not exist yet. Mid-skill partial directory writes are the
  common case.
- MCP config edits, `.git/info/exclude` edits and both state files are **outside** that
  rollback entirely. Deleting a shared MCP config path to "undo" would discard other
  owners' and the user's own entries.
- The extension is not transactional today either: lockfile recording failure is caught and
  treated as non-fatal (`bundle-installer.ts:207`), and update **uninstalls the old bundle
  before the new one succeeds** (`:967`).

**Therefore the design must not claim rollback.** Rather than build staging and
prior-byte snapshots — which would be exactly the "big safety net" this work is meant to
avoid — it relies on **idempotent redeploy**:

- A deploy is safe to re-run. A failure mid-way leaves a partially updated installation, and
  running the same operation again converges it. This is the accepted failure mode.
- Overwrites happen **last**, after resolve, extract, validate and placement planning have
  all succeeded, so the common failure causes never reach the point of touching existing
  files.
- MCP and `.git/info/exclude` edits are read-modify-write merges that preserve unrelated
  entries — not for rollback's sake, but because clobbering a shared file is wrong anyway.
- On failure, report **what was actually applied**. A partial MCP write is a real state, not
  an error to swallow, and that report is what makes the re-run intelligible.
- `writeTargetSafely` keeps its current reject-or-throw semantics; unsupported-kind
  filtering happens before it (§4.7).

**Accepted risk, recorded in §13:** a failure after the overwrite step can leave an
installation whose files are mixed between two versions until the operation is re-run.
Nothing restores the previous bytes. This is a deliberate trade for a far smaller
implementation, and it matches what both layers already do — the extension's update
uninstalls the old bundle before the new one succeeds (`bundle-installer.ts:967`).

Order is place → MCP → record, which is a **change** from the extension's current order
(cache write → MCP → scope sync → record) and is called out as such in §13.

## 10. Testing

Vitest in `packages/`, Mocha in the extension. A focused failing test comes first for each
slice.

Every slice runs **two** suites: the existing behavior with `unifiedDeploy` off, proving no
regression on the legacy path, and the slice's own E2E coverage with it on. The golden
placement matrix gains one column per slice, so by slice 6 it is the CLI-vs-extension parity
assertion rather than a CLI-only check.

| Test | Purpose |
|---|---|
| **Golden placement matrix** — one fixture bundle × 11 targets × 2 scopes → expected path set | Highest-value test in the plan; locks every placement decision in §4 and §6 |
| Layout inversion guard, every target × scope | No kind maps to two different output directories; future layout edits fail loudly |
| CLI vs extension byte-identical | Drive `deploy` through both wirings, assert identical tree and both lockfiles. The actual success criterion |
| Committed file carries no local identifiers | No `targetName`, `baseDir`, `installedAt` or `files` appears in `ai-primitives-hub.lock.json` |
| Effective desired state | `(committed − excludes) ⊕ local` across all four combinations |
| Legacy extension lockfile migration | Production-shaped `prompt-registry.lock.json` with on-disk `path` + on-disk `checksum` → `installedChecksum` **equals the stored hash**, so a pre-existing local modification is still reported after migration |
| Legacy CLI lockfile migration | Bundle-relative `path` + archive `checksum` → path re-derived, `installedChecksum` recomputed from disk |
| **Mixed legacy lockfile** | One file with both writers' entries → each resolved independently by existence probe |
| Lazy migration ordering | Opening a workspace writes nothing; first install migrates and deletes the legacy committed file |
| Reconcile removal | Bundle dropped from committed desired state → files cleaned on next reconcile, nothing removed on open |
| Portable replay | Lockfile written with a name-derived `sourceId` replays on a machine where that source is configured under a different name (P2) |
| No type inference from id | **Misleading** id: `src.type: 'github'` with id `awesome-copilot-xyz` must fetch through the **github** path. The naive case (`src.type: 'awesome-copilot'`, id `team-prompts`) already passes today and proves nothing |
| Drift on transformed content | The issue #357 Stage 2 case `installedChecksum` fixes, for CLI-written entries |
| Symlink replacement | Pre-place a symlink, deploy, assert the cache is untouched and the destination is a regular file |
| Shared-destination refcount | Two targets → one `.mcp.json`; uninstall one, the other's servers survive |
| Binary assets through local sources | `readBundleFiles` preserves bytes where the `archiver` text path corrupted them |
| `resolveBundle` call count | `install owner/repo:foo@1.2.3` does not walk the release catalog |
| User-scope migration | Fixture `AppStorage` install JSONs + cache + symlinks → real files, materialization records, symlinks gone, JSON records removed; second run is a no-op. One case per record kind in §8.2 |
| Unknown source type | `apm` in a hub config → warn, skip, rest of the hub loads; **and** in a lockfile → replay reports unmanaged retention, not a silent `null`; **and** schema enum validation does not reject the whole config |

Additional cases the audit identified as missing, grouped by what they protect:

**Entry-point reachability** — every registered CLI producer from §3.7 (`install` local /
replay / remote, `update`, `uninstall`, `profile` activate/deactivate, `apply`) and every
extension entry (command, marketplace, profile, scope and commit-mode commands,
auto-update scheduler). A test per producer asserting it reaches shared deployment.

**Placement breadth** — deliberate path/type mismatches and id/filename mismatches, not
just happy-path files; governed `items[]` inventory filtering alongside legacy `prompts[]`;
every canonical kind; skill subtrees with binary assets; hooks, plugins, powers;
unsupported-kind diagnostics distinguishing the three cases in §4.7; ambiguous **custom
layout** inversion raising a diagnostic; custom target roots and layout overrides;
transformers that inspect source prefixes (Kiro agents); WSL home resolution;
`allowedKinds`.

**Safety** — a `local-skills` install whose parent is a **directory symlink**: assert the
original source bytes are untouched (§4.8). Failure injected at each step (mid-skill write,
MCP config write, state write, exclude write, legacy deletion), asserting that applied
effects are reported **and that re-running the same operation converges** — the idempotent
redeploy contract, not restoration. Concurrent CLI/extension lockfile mutation asserts no
corrupt JSON, not no lost entry. Restart after every migration interruption point.

**Migration provenance** — a mixed legacy lockfile where a CLI bundle-relative path *also*
exists in the repository (existence proves nothing); uninstall-triggered migration with no
cache or manifest available; an edited extension file retaining its stored drift baseline;
a CLI entry recording an adopted baseline; an unrecoverable source descriptor retained and
reported rather than guessed; workspace skills and cache-missing user migration; mixed
commit/local-only bundles under one target.

**Reconcile** — same bundle id with changed version, source, layout, target root or
`allowedKinds`: assert that a **version** change redeploys and that layout/transformer/
`allowedKinds` changes deliberately do **not** (§5.6); a fresh clone with
committed artifacts and no materialization; pin removal; scope move.

**No-write guarantees** — activation with auto-update enabled asserts no repository
migration or write; `--dry-run` asserts no writes through **every** port including cache
synthesis, store initialization and auth setup; mixed old/new client writes after the
rename.

## 11. Sequencing — vertical slices

Reordered from a horizontal, additive-only sequence (which deferred all end-to-end testing
to a late cutover) into vertical slices, per §2's delivery constraints. Each row is one PR,
E2E-testable on merge with `unifiedDeploy` on, inert with it off.

| # | Slice | What becomes testable E2E |
|---|---|---|
| 1 | `app/deploy` + `PrimitiveKind` routing + lockfile `3.0.0` read/write + **CLI user-scope install for `vscode`** | `install X --target my-vscode` writes real files into `~/.copilot/{prompts,instructions,agents}` by manifest type, records desired + materialized state; `uninstall` removes exactly those paths |
| 2 | Widen to **all 11 targets, user scope** | The golden placement matrix at user scope: kiro→`steering/`, claude-code→`commands/`, cursor→`rules/`, including the prefix-vs-manifest fix |
| 3 | **CLI repository scope**, incl. git-exclude and commit modes; retires `RepositoryScopeWriter` for the three Copilot targets | Repository installs at both commit modes, for all targets, through one writer |
| 4 | **CLI update, profile activate/deactivate, apply** onto the shared path | The producers §3.7 found outside the original deletion table; reconcile's removal half |
| 5 | **Extension user scope** + `FileSystem` link-identity (§4.8) + §8.2 record classification | Real copies replacing symlinks in VS Code; a `local-skills` live source directory proven untouched |
| 6 | **Extension repository scope** | Extension and CLI producing byte-identical repository output — the headline success criterion |
| 7 | **MCP into shared deploy**, portable destinations | **CLI installs MCP servers for the first time**; extension writes `mcp-config.json`/`.mcp.json` |
| 8 | **Download unification on `SourceAdapter`** + `resolveBundle` / `readBundleFiles` | CLI installs from `azure-devops` and `local` sources; binary assets survive local sources |
| 9 | **Source identity P1–P3** | A lockfile written by one user replays for another whose source is named differently |
| 10 | **Migrations**: eager user, lazy repository, lockfile rename | Upgrade paths from real extension-written and CLI-written lockfiles |
| 11 | **Flip `unifiedDeploy` to default on** | Nothing new; the v2 reader and every slice above must be in place first |
| 12+ | **Deletions**, one area per PR | `UserScopeService`, `RepositoryScopeService`, `RepositoryScopeWriter`, `infra/resolvers`, `infra/downloaders`, APM, prefix routing — each gated on an entry-point test showing no callers |

Slice 1 is the one that matters most: it puts a complete, inspectable install on disk, so
every assumption in §4 and §5 gets tested against reality before the remaining eleven slices
are built on them.

Two things sit outside the slice sequence because they gate it:

- **Step 0 — primitives.** Export and generalize `routeToKind`, add canonical→alias naming,
  and add the `FileSystem` link-identity capability. Small, additive, no behavior change;
  slice 1 needs the first two and slice 5 needs the third.
- **Schema enum policy** (§7) must land before any APM member is removed, or existing
  configs fail wire-format validation.

**Behavior changes ship with their slice, not separately.** P1–P3 (slice 9), scope-conflict
enforcement (slice 3), and the MCP input-skip policy (slice 7) are each a behavior change
with its own tests, inside the slice that delivers them — not deferred to a "no behavior
change" step, which the previous ordering wrongly claimed to have.

## 12. Documentation, schemas, and ADRs

**Update:** `apps/vscode-extension/src/services/AGENTS.md` (its Key Services table names
the deleted services), `apps/vscode-extension/AGENTS.md`, `packages/AGENTS.md` (its
dual-naming rule cites the lockfile filename), the root `AGENTS.md`,
`docs/contributor-guide/architecture/installation-flow.md`, `adapters.md`,
`mcp-integration.md`, `update-system.md`, `authentication.md`, `core-flows.md`,
`validation.md`, `library-centric-architecture/{codemap,component,system-context}.md`,
`docs/contributor-guide/testing/{golden-path,test-plan}.md`, `docs/user-guide/sources.md`,
`docs/author-guide/creating-a-hub.md`.

**Schemas.** The git-tracked source of truth is
`packages/core/src/public/schemas/lockfile.schema.json`; `schemas/lockfile.schema.json` and
`apps/vscode-extension/schemas/lockfile.schema.json` are generated copies and must be
regenerated, not hand-edited. The lockfile schema is rewritten for `3.0.0`, including its
description and deprecated-`commitMode` note, which name the old filenames. The source-type
enums in `schemas/hub-config.schema.json` and the lockfile schema need the retired-value
policy from §7 before APM members are removed. `apm.schema.json` is removed only if
authoring support is also retired (§7).

**New or amended ADRs:**

- Unify source fetching on `SourceAdapter`, overruling `resolver-registry.ts`'s
  "overlap is intentional and stays".
- Retire the `apm` and `local-apm` source types, with the schema enum policy.
- Adopt portable MCP destinations, citing the product documentation and version that
  establishes the deprecation and input-forwarding behavior.
- Lockfile `3.0.0`: split by role — committed desired state, local materialization.
- Retire the `workspace` installation scope, recording the cache, skills and MCP-scope
  semantics that change with it.
- **Amend ADR-0004.** Its decision to keep `prompt-registry.lock.json` rested on "no forced
  migration for existing extension users or already-committed repository lockfiles". The
  role split voids that premise independently of any rename: the committed file's meaning
  changes either way. Given an unavoidable semantic break, a distinct filename means an
  un-upgraded client finds no file and stays inert rather than acting on a file it cannot
  interpret. **The earlier justification for this was wrong and is withdrawn:**
  `checkFilesMissing` (`lockfile-manager.ts:574`) returns `false` when `files` is
  absent or empty, so an old client would *not* report everything missing or offer repair.
  The real risks are narrower and still sufficient — an old client would treat a `3.0.0`
  file as containing bundles with no tracked files, could resurrect legacy state on write,
  and would not see installs recorded in the new local file. ADR-0004's second premise,
  that both tools read and write the same file, is preserved, and the rename converges
  repository scope on the filename `resolveUserConfigPaths()` already uses. ADR-0004 itself
  anticipated this: "until the lockfile is naturally retired far in the future, if ever."

## 13. Deliberate behavior changes and external premises

Each item below is a change in behavior, not a refactor. Implementation must not present
any of them as preservation.

| Change | From | To |
|---|---|---|
| User-scope artifact | symlink-or-copy, pre-existing regular files skipped | real copies |
| CLI user-scope routing | prefix-routed, bundle filename kept | manifest-routed, normalized id + suffix |
| Copilot repository placement | `RepositoryScopeWriter`, bundle filename kept | layout + manifest routing, normalized id |
| `workspace` scope | distinct cache, workspace skills dir, repository MCP scope | retired; folded into user |
| Scope conflict | reached only from explicit scope-move commands | enforced on every install |
| Drift protection | repository scope only, main lockfile only | all scopes, both files |
| MCP destinations | user-profile `mcp.json`, `.vscode/mcp.json` | portable `mcp-config.json`, `.mcp.json` |
| Input-requiring MCP servers | written, with a warning | skipped, with a warning |
| MCP config backups | created by default on write | not created by migration |
| Deployment order | cache write → MCP → scope sync → record | place → MCP → record |
| APM sources | installable | retired; records retained as unmanaged |
| Unknown source type | factory throws; schema enum may reject the config | warn and skip |

**External premises, to be cited and versioned rather than asserted:** that the VS Code
user-profile `mcp.json` and `.vscode/mcp.json` are deprecated; that
`$COPILOT_HOME/mcp-config.json` and `.mcp.json` are the portable, Agent-Host-native
destinations; that Agent Host does not forward servers requiring `${input:...}`; that a
non-default VS Code profile does not read the default-profile MCP file and that the
upstream issues are closed as not planned; and that the extension has materially more
adoption than the CLI. The last one shaped §8.3's default assumption, so it is explicitly
marked unverified there and is not used to justify any lossy default.

### Accepted risks

An executable-code audit of an earlier draft recommended staging snapshots, trigger
provenance plumbing, a full install signature, a legacy-destination locator, state locking
and an ambiguity taxonomy. Its **factual** corrections are all incorporated. Its
**prescriptions** were deliberately pruned back: this project's stated constraint is to
simplify and avoid big safety nets, and each item below is a risk accepted in exchange for
a materially smaller implementation.

| Accepted risk | Mitigation instead of machinery |
|---|---|
| A failure after the overwrite step leaves files mixed between two versions; previous bytes are not restored | Idempotent redeploy; overwrites happen last; applied effects are reported (§9.2). Matches today's behavior, where update uninstalls before the new install succeeds |
| A scheduled auto-update write could migrate a repository | Migration is invoked only from the three command handlers — a call-site rule, not a threaded flag (§8.1) |
| A layout-override or transformer change does not trigger reconcile | Reconcile compares `(bundleId, version, targetType)` only; a user changing an override re-runs install (§5.6) |
| Orphaned files from old CLI-written entries are not recovered | Unproven destinations are left alone and reported unmanaged; no old-rules locator is built (§8.3) |
| Simultaneous CLI and extension writes can lose a state entry | Atomic writes prevent corruption; the next operation re-derives (§8.4) |
| MCP config backups are no longer created by migration | Read-modify-write merges preserve unrelated entries; nothing is wholesale replaced (§6.7) |
| Legacy and unified paths coexist behind `unifiedDeploy` for the whole cutover — double maintenance, doubled test matrix | Bounded by the flag-flip and deletion PRs (§11 slices 11–12); accepted in exchange for E2E testing from slice 1 (§2) |

**Acceptance criteria, not established facts:** byte parity between layers, lockfile
portability across machines, transaction safety, and migration idempotence. Current tests
confirm today's behavior; they do not validate these.
