# Unify the bundle lifecycle across CLI and extension

- **Date:** 2026-10-09
- **Status:** Revised after an independent executable-code review; awaiting approval
- **Scope:** install / uninstall / update for all scopes, bundle fetching, MCP server installation, and a one-shot migration of existing extension installs
- **Review provenance:** an independent review audited this design against
  [the requester-stated requirements](./2026-10-09-unify-bundle-lifecycle-requirements.md).
  Its factual corrections are incorporated inline. Its open decisions were put to the
  requester and are recorded in §14, which also lists the three places their answers
  **amend** a previously stated requirement. A third pass then checked this document against
  itself and against the requirements list; it changed no decision and added no machinery —
  its corrections are summarized at the head of §13's accepted risks.

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
(`source.instructions.md`); the extension writes the manifest id plus the Copilot suffix.
Old CLI file records therefore cannot be repaired by calling the new naming function — a
point that constrains migration (§8.3).

**And the extension does not normalize ids uniformly.** `RepositoryScopeService` calls
`normalizePromptId` first (`repository-scope-service.ts:253`), then
`getTargetFileName(fileName, fileType)` (`:755`). `UserScopeService` passes the raw
manifest id straight through (`user-scope-service.ts:393`), as does
`BundleInstaller` (`:272`). So "the extension normalizes ids" describes repository scope
only; the shared writer must normalize explicitly at the call site (§4.7).

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

`createSourceAdapter` has no CLI **lifecycle** callers. It is not unreached from the CLI,
though: registered `hub validate --check-sources` (`hub.ts:582`) constructs the factory
dependencies and reaches it through app deep validation
(`validate-hub-config-file.ts:363`). So that wiring site must be updated alongside the
adapters, and the earlier "zero CLI callers" claim was wrong. Meanwhile
`packages/core/src/ports/source-adapter.ts` states its adapters exist so they "can be
implemented once and shared by both the CLI and, eventually, the extension" — the reverse
of reality for the install path. The CLI cannot install from Azure DevOps or APM sources at
all.

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
  so `writeManifestItems` silently `skipped.push()`es any other kind. Against the **17**
  canonical `PRIMITIVE_KINDS` that leaves 12 unreachable through it — 11 placeable kinds
  plus the non-placed `mcp-server`. (An earlier count of 19 here was wrong; the const has
  17 entries.) Since this writer is already the extension's
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

- **The slice unit is a bounded supported lifecycle capability**, not a single producer: a
  narrowing of (producer set × scope × target) for which install, update **and** uninstall
  all work with the flag on. Slice 4 deliberately carries several CLI commands because they
  share one writer-factory contract and are not independently testable; slice 1 carries
  uninstall for the same reason. An earlier "one producer per PR" rule contradicted the
  slice table and is withdrawn.
- **Every PR is a vertical slice** — with two explicit exemptions, both in §11: Step 0 and
  the schema enum policy are additive, behavior-neutral prerequisites with no flag-on
  surface of their own.
- **Each slice ships the readers it breaks.** A slice that changes installation truth or
  placement carries the dependent-reader changes for *its* surface in the same PR
  (`PromptLoader`, marketplace file opening, update discovery, profile and storage
  readers). Postponing all readers to the migration slice would leave intermediate slices
  with a flag-on install the UI cannot see.
- **Each slice ships the migration for the state it writes.** The same argument, applied to
  the state side, and it is binding rather than tidy: FR-16 permits repository migration on
  install, update **and** uninstall, so a flag-on install that writes `3.0.0` state for a
  surface *is* a permitted trigger and must migrate that surface's legacy state in the same
  PR. Migration is therefore **not a late slice** — it is distributed across slices 1, 3 and
  5, each carrying the part its own writer makes authoritative (§11). A slice that wrote new
  state while the legacy file still owned records for the same surface would leave two
  disagreeing truths and a flag-on uninstall unable to find what it had to remove.
- **A slice that moves a producer onto shared `deploy` before a capability joins shared
  `deploy` keeps the legacy step wired for that capability**, so the flag-on path never loses
  behavior the flag-off path has. Concretely: MCP joins shared deploy at slice 7, so the
  extension's existing `McpServerManager` step — which already runs *outside* the install
  pipeline (§3.7) — stays wired in slices 5 and 6 and is removed by slice 7. The CLI needs no
  such bridge, since it installs no MCP servers today (§1.1).
- **Flag off keeps `main` releasable**, and flag-off code never reads or writes flag-on
  state: see §5.12, which is a prerequisite for slice 1 rather than a late concern.
- **Every PR adds a flag-on E2E test** for the slice it delivers, driven through the
  registered command/extension entry point with external boundaries mocked and real local
  files, run in CI alongside the flag-off suite. The golden placement matrix (§10) grows
  one column per slice.
- **Readers before the flag flips, not before the writer merges.** The v2-compatible reader
  must ship before `unifiedDeploy` defaults on — that is the real constraint, and a flag
  satisfies it without serializing PRs.
- **Bypass is not deletion.** A slice may make a legacy writer unreachable with the flag on;
  the slice table's "retires" means exactly that. Removing the code is a separate, later PR
  after the flag defaults on, each gated on an entry-point test proving no callers remain.
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
| User-scope artifact | real file copies, not symlinks — with one named exception, `local-skills` (§4.8, §14) |
| `workspace` scope | retired; `user` and `repository` remain |
| Workspace → repository selection | first folder in the `.code-workspace` file that is a git repository; refuse with a hint if none is (§4.9) |
| Existing `workspace` records | by artifact location: generic installs under `~/.copilot/` fold to **user** scope; repository-local artifacts (workspace skills, legacy workspace MCP) stay put and are handled lazily (§8.2) |
| Migration trigger | **user scope** eager at activation; **repository scope** lazy on first install, update **or uninstall** (§14) |
| MCP | folded into the shared lifecycle |
| Legacy non-default-profile MCP configs | not migrated; reported with their path (§6.1) |
| Bundle fetching | unified on `SourceAdapter`, auth injected per layer |
| `apm` / `local-apm` | retired, **including authoring support**, in an independent PR (§7) |
| Unknown source type | warn and skip, rest of the hub loads |
| MCP destinations | portable only — for the four VS Code entries that are not portable today; the other seventeen are already `mcpServers` (§6.1) |
| Lockfile split | by **role**: one committed file of desired state, one git-excluded file of materialization |
| Desired state | the committed file is the **only** desired state. No local overrides, no `excludes` list. Personal divergence is an uncommitted edit to that file; git is the mechanism (§5.4, §14) |
| Committed per-file checksums | none — verification by re-derivation, bounded by what is available offline (§5.9) |
| Removal propagation | only on explicit action: `install --lockfile` / reconcile in the CLI, a prompt in the extension (§5.6) |
| Untracked destination collision | skip and report; `--force` overwrites (§4.10) |
| Lockfile filename | renamed to `ai-primitives-hub.lock.json`; ADR-0004 amended. NFR-9 raised the rename as a **question** conditional on whether it helps or complicates migration, not as a mandate — §12 gives the migration-specific reason it helps, and that reason is what justifies the decision |
| Legacy committed lockfile | deleted during the lazy migration, in the same diff |
| Flag-off vs `3.0.0` state | every read checks the schema version; an unknown major fails loudly instead of being cast (§5.12) |
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
                   extract → validate → place → record → MCP → git-exclude
```

The **record → MCP** order in that last stage is load-bearing, not incidental: a crash
between them must leave a tracked entry with no server, never a live server with no owner
(§6.7, §9.2). Any diagram or implementation that records last is wrong.

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
  expectedArchiveSha?: string;     // compared before any write; see §5.2 for when it exists
  bundle: LogicalBundleRef;        // { bundleId, version } — §5.13
  source: ResolvedSource;          // { sourceId, type, url, branch?, collectionsPath? }
  placement: PlacementContext;     // below — everything placement actually depends on
  targetName: string;              // key of the local materialization record
  commitMode?: 'commit' | 'local-only';
  runtimeAssetRoot: string;        // durable root for MCP auxiliaries; §6.3
  force?: boolean;                 // overwrite drifted files and untracked collisions
}

// Placement is not a function of (manifest, targetType, scope) alone — §4.6.
// Planning and writing share one instance of this; nothing re-reads mutable config.
interface PlacementContext {
  scope: 'user' | 'repository';
  targetType: TargetType;
  resolvedLayout: ResolvedLayout;  // after built-in + user + project override layering
  baseRoot: string;                // target.path / rootPath / workspace root, resolved
  env: Readonly<Record<string, string>>;  // ${...} expansion, incl. WSL home resolution
  allowedKinds?: readonly PrimitiveKind[];
  transformer?: TransformerId;
}

interface UndeployRequest {
  bundle: LogicalBundleRef;
  scope: 'user' | 'repository';
  targetName: string;
  workspaceRoot?: string;          // required when scope === 'repository'
}

interface DeployPlan {
  destinations: { kind: PrimitiveKind; from: string; to: string }[];
  skipped: { from: string; reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered' }[];
  drifted: string[];               // on-disk bytes ≠ installedChecksum
  missing: string[];               // tracked but absent
  collisions: { to: string; reason: 'untracked-existing' }[];   // §4.10
  satisfied: string[];             // untracked but byte-identical to what we would write — §9.3
  conflict?: {
    kind: 'scope' | 'shared-destination';
    bundleId: string;
    scope: 'user' | 'repository';
    at?: string;                   // the contended path or MCP config path
    owner?: { targetName: string; bundleId: string };  // who holds it
  };
  mcp: { configPath?: string; servers: string[]; skipped: { name: string; reason: string }[] };
}
```

`DeployPorts` =
`{ fs, env, appStorage, layoutLoader, lockfileStore, mcpConfigStore, gitExclude, onEvent? }`.
`appStorage` is explicit per ADR-0005: on-disk roots resolve through the injected port, never
through `vscode.ExtensionContext.globalStorageUri`. `fs` must expose link identity before
slice 5 (§4.8).

`planDeploy` touches no files **and performs no writes through any port** — no cache
synthesis, no store initialization, no auth setup. That is what makes it usable for
`--dry-run`. Both layers call it before deploying: the extension to drive its warning
dialog, the CLI to drive `--dry-run`, to refuse clobbering edits, and to report collisions.

A single `conflict` with only `{bundleId, scope}` could signal a generic refusal but could
not describe the shared-destination collisions §6.6 promises to detect, so it carries the
contended path and the conflicting owner — and nothing more.

### 3.2 Port additions

Two on `SourceAdapter`, both optional with defaults in `base-source-adapter.ts` so no
adapter is forced to change — plus a **third on `FileSystem`** that is not optional (§4.8).

| Port | Method | Default | Implemented directly by | Why |
|---|---|---|---|---|
| `SourceAdapter` | `resolveBundle?(spec)` | filter over `fetchBundles()` | `GitHubAdapter` | Keeps `install owner/repo:foo@1.2.3` at one API call |
| `SourceAdapter` | `readBundleFiles?(bundle)` | unzip `downloadBundle()` | `LocalAdapter`, `LocalSkillsAdapter`, `LocalAwesomeCopilotAdapter` | Removes the zip round-trip and the text-mode `archiver` read those three document as binary-unsafe |
| `FileSystem` | link identity (`lstat`, or a symlink flag on `stat`) | none — new capability | the infra filesystem adapter | Without it, shared `app` code cannot detect a symlinked **parent** and the §4.8 guard is unimplementable |

`resolveBundle` dissolves the justification recorded in
`infra/src/resolvers/resolver-registry.ts` — "Overlap with
`RepositoryAdapterFactory`/`adapters/*` source-type dispatch is intentional and stays
(list-all-bundles vs resolve-one-spec are different consumer needs)". One port serves both
needs. An ADR records the overrule rather than silently contradicting the module doc.

**The one-call property is conditional, and the acceptance case must say so.** A release tag
and asset that are exactly addressable support a direct lookup. Existing version-bearing
ids, `latest` requests, aliases, manifest-derived asset names and nonstandard tags can still
need the catalog fallback. `resolveBundle` does not guarantee a single request for every
supported spec, and the §10 test is scoped to the directly addressable case.

**Explicit pins must fail closed.** The two stacks disagree today: app resolution warns and
**returns latest** when the requested version is absent
(`resolve-installation-bundle.ts:178`), while the CLI's GitHub resolver returns `null`
(`github-resolver.ts:184`). Unifying on adapters without deciding this would turn a committed
pin into silently different installed bytes — which defeats the portable-replay goal. Rule:
an explicit version, and every lockfile replay, requires an **exact** logical-id and version
match; `latest` is selected only when it is requested or the version is omitted. The resolved
identity and version are then carried into deployment, not re-resolved.

### 3.3 What each delivery layer keeps

Source and auth resolution, progress and notification UI, scheduling, and the decision of
what to do when `planDeploy` reports drift, a collision or a conflict. Nothing else.

**FR-6's seam is authentication, and only authentication.** Resolution and byte acquisition
are shared — that is the point. Progress reporting, notification UI and scheduling sit
*outside* the download seam rather than inside it, so a per-layer difference there is not
evidence that the seam leaks. The converse also matters: per-layer differences in state
roots or transform behavior are **not** authentication differences and must not be smuggled
through this boundary.

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
| `ProcessRunner`/`NodeProcessRunner` wiring (sole *execution* consumer was `ApmAdapter`; registered `hub.ts:675` also constructs and passes it, so both sites go together) | — |
| APM authoring: the validation command and `apm.schema.json` tooling — **independent PR** (§7) | — |
| `VSCODE_USER_DIR_TOKEN` and its tests (zero users after §6) | — |

### 3.5 Relocated

- `McpServerManager` + `McpConfigService` (1273 lines, **zero** `vscode.` references) →
  `app/deploy/mcp`, file IO behind an infra store.
- Lockfile rules out of `LockfileManager`, **split by layer rather than all moved to `app`**
  (RC-1: `app` orchestrates, it does not hold business rules):
  - **`core`** — the domain policies: kind normalization, the logical bundle key and its
    collision rule (§5.13), desired-state semantics (§5.4), drift semantics (§5.8), source
    identity (§5.10), and ownership/unmanaged rules (§5.3). These are pure and depend on
    nothing.
  - **`app`** — the use cases that compose those policies with ports:
    `checkFilesMissing()`, `detectModifiedFiles()` and `validate()` are **not** pure over a
    `Lockfile` — they need filesystem and root context, and `validate()` needs a supplied
    schema — so they are app use-cases calling core policy, not "pure functions" as an
    earlier draft of this spec claimed. Also `getInstalledBundles()`, `remapSourceId()`, and
    `updateCommitMode()`, which no longer moves bundle truth between files (§5.5) and
    reduces to a mode change plus a git-exclude recompute.
  - `ensureLocalLockfileExcluded()` → the git-exclude port. `LockfileManager` keeps
    `getInstance`, `onLockfileUpdated` and delegation: ~1151 → ~250 lines.
- `RepositoryScopeService.collectFilesUsedByOtherBundles` → `app`, widened (see §6.5).

### 3.6 Kept

- `--from <dir>` stays a CLI flag that bypasses source resolution: `readLocalBundle` feeds
  `ExtractedFiles` straight into `deploy`. It is a different concept from the `local`
  **source type** and both survive. CLI `local` means "this directory *is* one built
  bundle"; `LocalAdapter` means "this directory *is a source* containing many bundles".
  **`local` is overloaded in the CLI today, not absent, and an earlier version of this spec
  got that wrong.** There is no *resolver* — `ResolverRegistry` returns `null` for `local`,
  commented "Local sources have no resolver - they use readLocalBundle directly"
  (`resolver-registry.ts:131`) — but **lockfile replay handles it**, reading `source.url` as a
  built bundle directory through `readLocalBundle` (`install.ts:1527`). What is genuinely
  missing is the *catalog* reading `LocalAdapter` provides.

  So unifying on `SourceAdapter` **adds catalog support while preserving two existing
  behaviors**: `--from <dir>` and `type: local` replay both keep interpreting their path as
  one built bundle directory. Silently swapping the dispatcher for a catalog adapter would
  change the meaning of every committed `local` replay URL. This is also the explicit answer
  FR-8 asked for.

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
| Extension | `RegistryManager.syncSource:1098` → `autoUpdateInstalledBundles:408` | **startup source sync auto-updates installed bundles** for `awesome-copilot` and `local-awesome-copilot` sources, independently of `promptregistry.updateCheck.autoUpdate`. Not a scheduler path |
| Extension | `refreshLocalSkillInstallations:352` | rewrites recorded installation metadata (hash/version) for local-skill installs during sync |
| Extension | `remapSourceId` via `registry-manager.ts:909` | rewrites `sourceId` on existing lockfile records |
| CLI | `hub validate --check-sources` (`hub.ts:582`) | not a lifecycle producer, but the only CLI caller of `createSourceAdapter` and a `NodeProcessRunner` construction site; must be updated with the adapters |

**The startup writers are the reason the migration rule is a call-site rule.** Restricting
migration to the three command handlers only works if every *other* state writer is
enumerated and left on the legacy reader. The three `RegistryManager` rows above are
exactly the writers an earlier draft of this spec missed.

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

Totals: the **sized** §3.4 rows sum to 6,499 lines, and the per-file counts quoted in this
spec (resolvers/downloaders 1,159; APM adapters 1,093) are reproducible. Everything else —
the unsized rows, the ~2,000 relocated, the "~60% of `BundleInstaller`" — is an **estimate,
not an established fact**. Also: 3 port additions, not 2 (§4.8), and 1 new `app` module.
These counts measure removal, not coverage: one missed registered producer matters more
than several thousand deleted lines.

## 4. Placement and naming

### 4.1 Routing

Manifest-driven, always. Source-path-prefix routing is deleted.

The shared contract is a **normalized placement item**, not `item.type`. Both manifest
formats are reached in production — governed release manifests express `items[]` with
canonical `kind` and `path`, legacy manifests express `prompts[]` with `type` and `file`
plus filename detection, and the extension repository service iterates the legacy shape.
So the first step is normalization into `{ kind: PrimitiveKind, sourcePath, id }`, with kind
resolved from the canonical field when present, otherwise detected from path and tags.
Making legacy `type` the shared contract would bake one of the two formats into the new
writer. The resolved layout then maps kind → output directory.

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

**The Copilot suffix rule is not target-aware, and that needs validating rather than
asserting.** Writing `.prompt.md` and `.agent.md` on every host may be a perfectly good
portable convention, but whether Kiro and Claude Code *discover* those files, and what
command name they display for them, is a host behavior this repository cannot establish.
Treated as an external premise (§13): validated manually per host before the flag flips, not
claimed as native behavior.

### 4.5 Repository scope

The layout's `repository` branch already supplies `baseDir` for non-Copilot targets, and
the CLI already routes them through `FileTreeTargetWriter` — a runtime probe across all 11
target types at both scopes confirms `.kiro/steering/`, `.cursor/rules/`,
`.claude/commands/`, `.opencode/commands/`, `.devin/prompts/` and `.windsurf/rules/`.
Retiring `RepositoryScopeWriter` removes a duplicated, non-layout-driven implementation for
`vscode`, `vscode-insiders` and `copilot-cli` and brings them onto manifest routing with
the shared naming rule.

**But the user-visible change is not confined to those three targets, and an earlier
version of this section wrongly claimed it was.** `FileTreeTargetWriter.write()` is
**prefix-routed** (§1.1), so every non-Copilot repository target is prefix-routed today
too. Their *base* directory is unchanged by this work; their **subdirectory** is not. The
`local-library/web-dev-bundle` fixture — `file: prompts/typescript-standards.instructions.md`
with `type: instructions` — moves from `.opencode/commands/` to `.opencode/rules/` under
manifest routing. Unchanged base directories do not imply unchanged destinations.

Therefore: **every** target × scope cell with a path-prefix / manifest-kind mismatch is a
behavior change, belongs in the §13 table, and gets a golden-matrix column (§10) — not just
the three Copilot targets and the CLI's user-scope installs.

`target.allowedKinds` filtering is preserved, now comparing canonical kinds directly
instead of round-tripping through `copilotTypeToPrimitiveKind`.

### 4.6 Placement inputs must be explicit before it can be called pure

§5.9's verification-by-re-derivation depends on placement being a pure function. It is a
function of more than (manifest, targetType, scope): it also depends on the **resolved
layout layers** (the extension uses built-in resolution, the CLI loads hierarchical user
and project overrides), `target.path` / `rootPath`, the environment used for `${...}`
expansion including WSL home resolution, `allowedKinds`, and the active transformer.

This is why §3.1 defines `PlacementContext` as one explicit object that planning and
writing **share**: an implicit read of current mutable configuration at verification time is
not the same thing as reproducing the original placement input. §5.9 is corrected
accordingly — it no longer claims purity from three inputs. What is deliberately *not*
done is persisting a configuration fingerprint, because reconcile intentionally does not
track configuration changes (§5.6).

Two consequences:

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
  plus explicit id normalization at the call site. Only `RepositoryScopeService` does that
  today (`normalizePromptId` at `:253`); `UserScopeService:393` and `BundleInstaller:272`
  pass the raw manifest id. The shared writer normalizes once, for every caller — which
  makes normalized user-scope filenames a **behavior change** (§13), not preservation.
- `writeTargetSafely` (`install/target-write.ts:36`) **rejects any skipped content** before
  writing, or rolls back and throws after writing. It is not a warn-and-succeed helper, so
  the "unsupported kind → warn and skip" policy cannot run through it unchanged. Either
  unsupported kinds are filtered before the safety check, or that check needs a separate
  contract. Distinguish three cases explicitly: kind unsupported *by this target*, kind
  invalid in the manifest, and item excluded by governed inventory filtering.
- Layout inversion is safe for the enumerated built-ins; **arbitrary user overrides are
  not covered by that check**, and there are *two* failure shapes, not one. Ambiguity — a
  kind reachable through two keys with different output values — must raise a diagnostic
  rather than resolve by first-entry-wins. But a custom key can simply be **unrecognized**:
  `kindRoutes` allows arbitrary string keys while `routeToKind` recognizes a finite
  vocabulary of aliases and prefixes, so an unknown key yields no kind at all without any
  ambiguity existing. Rule: require recognized kind-bearing keys or an explicit mapping, and
  **report unknown custom keys** instead of silently dropping their items.

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

**`local-skills` keeps its live link — a named exception to real-copy placement.** FR-21
chose real file copies, and that is what every bundle install does. A `local-skills`
install is different in kind: it links a directory the user owns and edits, so the link
*is* the feature — edit the source, see it live. Copying would silently break that loop for
a case FR-3 never complained about. So the rule is scoped: **bundle** materializations are
real copies; a `local-skills` install remains a link, is migrated by adoption (§8.2), and
is recorded as such. The link-identity capability above is what makes the exception safe
rather than accidental, because it is what stops any later write from reaching through the
link into the user's source tree.

### 4.9 Repository scope needs one root, chosen deterministically

FR-22 makes workspace behave like repository scope, targeting the main repository of the
workspace file, and FR-23 retires the `workspace` label. A multi-root `.code-workspace`
therefore needs a rule for which root "repository scope" means:

**The first folder listed in the workspace file that is a git repository.** If no listed
folder is a git repository, repository-scope install refuses with a hint naming the folders
it checked — it does not guess, and it does not fall back to user scope.

Deterministic, needs no new setting, and matches the order every other tool reads
`.code-workspace` folders in. Single-root workspaces are the degenerate case of the same
rule. This is distinct from the migration of **old** `workspace`-scope records, which is
decided by where their files actually are, not by this rule (§8.2).

### 4.10 A pre-existing untracked file is not drift

Real copies raise a case the drift check cannot answer: a destination file that exists but
has no materialization record, so no `installedChecksum` to compare against. A hand-written
`~/.copilot/prompts/foo.prompt.md` is the ordinary example. Today's extension placement
skips pre-existing regular files as possibly user-owned; `force` in this design otherwise
speaks only to *tracked* drift.

Rule: an untracked existing destination is reported in `DeployPlan.collisions`, **skipped**,
and the install succeeds for everything else with a "skipped N pre-existing files" summary.
`--force` overwrites. Refusing the whole install was rejected: one stale leftover file
would block an unrelated bundle.

Two cases that look similar and are not:

- **Tracked drift** — a record exists and the bytes moved. Warning dialog in the extension,
  refuse-unless-`--force` in the CLI (§5.11).
- **Already satisfied** — untracked, but byte-identical to what we are about to write. This
  is the retry-after-a-failed-state-write case; it is a no-op, not a collision (§9.3).

## 5. State

### 5.1 Two files, split by role — not by commit mode

| File | Git | Contents |
|---|---|---|
| `ai-primitives-hub.lock.json` | **committed** | desired state, and the *only* desired state: `bundles`, `sources`, `hubs`, `profiles` |
| `ai-primitives-hub.local.lock.json` | **git-excluded** | materialization only: `targets` |
| `prompt-registry.lock.json`, `prompt-registry.local.lock.json` | legacy | read-only until lazy migration (§8), then deleted |

The role split is clean: **what the team wants** is committed, **what this machine did** is
not. No *content* key appears in both files — `bundles`, `sources`, `hubs` and `profiles`
exist only in the committed file, `targets` only in the local one. Both carry `version`,
because both are versioned wire formats subject to the §5.12 gate.

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
  $schema, version: "3.0.0",
  bundles: { "<logicalBundleKey>": { version, sourceId, archiveSha? } },
  sources: { "<deterministicSourceId>": { type, url, branch?, collectionsPath? } },
  hubs?, profiles?
}
```

`installedAt` and `sourceType` leave the bundle entry: the first is per-machine churn, the
second is already `sources[sourceId].type`. **There is no `installs` section, ever.** The
whole file is small, hand-editable, and is exactly what `install --lockfile --target <t>`
consumes.

**`generatedAt` and `generatedBy` are gone too, and that is load-bearing.** §8.1 promises
that two developers migrating the same repository on two branches produce the same committed
content. Wall-clock and tool-name metadata would break that for no benefit — and the
existing writers do generate them (`json-lockfile-store.ts:160`, `:246`). Removing them
makes the file genuinely byte-comparable, which is also what lets §10's CLI-vs-extension
parity test assert equality without defining a normalization step. Both fields stay in the
local file, where churn is invisible.

**`archiveSha` is optional provenance, renamed from `checksum` to stop it reading as a
verification contract.** It is only trustworthy for sources with immutable release bytes.
Local adapters synthesize ZIPs through `archiver`, which supplies the current date when no
timestamp is given and enumerates without a defined order, so the *same* logical payload can
hash differently on two machines; same-version mutable local content can change outright.
Rule: record it when the bytes came from an immutable remote artifact, omit it otherwise,
and when `DeployRequest.expectedArchiveSha` is present compare it **before any deployment
effect**. Never treat its absence as a failure.

### 5.3 Local file — materialization only

```ts
{
  version: "3.0.0", generatedAt, generatedBy,
  migration?: { lockfileV3?: 'complete' },        // per-repository completion marker, §8.4
  targets: {
    "<targetName>": {
      targetType, scope, baseDir,
      commitMode,                                  // default for this target
      bundles: { "<logicalBundleKey>": {
        version,
        sourceId,                                  // resolved source actually deployed, §5.6
        installedAt,
        commitMode?,                               // per-bundle override of the target default
        state?: 'unmanaged',                       // §8.3; absent means managed
        unmanagedReason?: string,                  // shown to the user, never parsed
        linked?: true,                             // local-skills live link, §4.8
        files: [{ path, checksum?, installedChecksum?, adoptedAtMigration?: true }],
        mcpConfigPath?, mcpServers?,
        complete?: true                            // per-record migration marker, §8.4
      } }
    }
  }
}
```

`targetName` is safe as a key here precisely because this file is never shared. In a
committed file it would not be: two developers installing for the same host under locally
chosen target names would commit two records describing the same files, breaking the §6.6
refcount — each record would believe it owned them. Note the converse limit: unique target
*names* do not make destination *ownership* unique, because two differently named targets can
resolve to one physical root. That is what §6.6's membership guard and §3.1's
`shared-destination` conflict exist for.

Five of these fields exist only because migration needs somewhere to put what it cannot
convert, and §8 would otherwise be promising retention with no shape to retain it in:

- **`state: 'unmanaged'` + `unmanagedReason`.** §8.3's single fallback rule — unproven
  destination, missing cache, retired APM source, unrecoverable source descriptor, unbindable
  target — retains the record instead of deleting files it cannot vouch for. An unmanaged
  record still supports cleanup and refcounting, and is excluded from reconcile until the
  user binds it. One flag and a human-readable reason; deliberately **not** a taxonomy of
  ambiguity kinds.
- **`commitMode` per bundle.** A single target can today hold both committed and
  `local-only` bundles, so a target-level-only field would lose that on migration. The
  target value is a default.
- **`adoptedAtMigration`** marks an `installedChecksum` taken from disk rather than from a
  deployment, so a later clean drift report does not imply the file was ever verified
  pristine (§8.3).
- **`complete`** per record and `migration.lockfileV3` per repository are what make
  migration resumable without a journal (§8.4).
- **`linked`** records the §4.8 exception, so nothing later "repairs" the link into a copy.

`installedChecksum` is optional for exactly one reason: a `linked: true` record writes no
bytes of its own, so there is nothing to baseline. Its `files` entries carry `path` only, and
drift detection skips them — the user owns that tree and editing it is the feature. For every
other record `installedChecksum` is required, and a managed record missing it is a migration
defect, not a permitted shape.

### 5.4 Desired state has one source, and git is the override mechanism

Desired state is **the committed file as it exists in the working tree** — including
uncommitted edits. There is no second desired state to merge, so there is no merge rule.

A developer who wants something different from the team edits that file (through the CLI or
the extension, like any other operation) and then decides what to do with the resulting
diff: **commit it** to propagate the change, or **leave/revert it** to keep the divergence
local. Uninstalling a bundle the team committed is a one-line deletion the developer simply
does not commit. Pinning a different version is a one-field edit they do not commit.

This supersedes the earlier `excludes`-list-plus-local-pin model (FR-28, §14). What it buys:
no `excludes`, no `local.bundles`, no local `sources` map, no precedence rules, no
"which file does this operation mutate" ambiguity — the questions disappear instead of
being answered. Operation semantics reduce to one table:

| Operation | Committed desired state | Local materialization |
|---|---|---|
| Install a bundle not yet desired | add `bundles` entry + its `sources` descriptor | add a record for the chosen target |
| Install an already-desired bundle for another target | unchanged | add a record for that target |
| Update to a new version | `version` changes | record rewritten at the new version |
| Uninstall while another target **on this machine** still holds it | unchanged | remove that target's record only |
| Uninstall the last materialization on this machine | entry removed | record removed |
| Pin a different version | `version` edited | redeploy at the pinned version |
| Switch a bundle to a different source | `sourceId` edited (+ descriptor) | redeploy; `sourceId` on the record follows (§5.6) |
| Change `commitMode` | **unchanged** | `commitMode` changes, `.git/info/exclude` recomputed |
| Move a bundle between scopes | entry **removed** when the bundle leaves repository scope, **added** when it enters | old record removed, new one added |
| Activate / deactivate a profile | the batch of installs and uninstalls it implies | likewise |

Three things that table makes explicit. First, "last materialization" is computed from **this
machine's** local file, which knows nothing about a teammate's targets — that is precisely
why the resulting committed diff is the developer's to commit or revert, and why nothing
silently decides for the team. Second, `commitMode` cannot leak a personal version or source
into shared desired state, because it does not touch that file at all.

Third, **desired state carries no target and no scope, and that is the design rather than an
omission.** A repository's committed file means "these bundles, at this repository" — which
target they are materialized into is FR-10/FR-11's whole point (dev A commits `.github`, dev B
uses kiro, one bundle list) and FR-15's whole point (`install --lockfile --target <t>` picks
the harness at install time, instead of committing files for every harness). So
`reconcile(target)` takes the target as its **argument**, not from the file, which is where
§5.6's `targetType` comparison component comes from.

The one consequence that needs stating: because the repository's committed file means "desired
*at this repository*", a bundle moved to user scope must **leave** it, and a bundle moved in
must be added. Leaving the entry in place would make the move unstable — the materialization
for the repository target is gone, so the next reconcile would see the bundle as desired and
not materialized, and offer to reinstall it at the scope the user just moved it out of. Scope
moves therefore touch both files, and they are the only operation in the table that edits
desired state without the user asking for an install or an uninstall.

**Honest cost.** Personal divergence lives as an uncommitted modification to a tracked file.
It is fragile: `git checkout`, a merge, a rebase, or an IDE "discard changes" silently
restores the team's version, and the files follow on the next reconcile. It is also visible
in every `git status` and review diff. A durable `excludes` list would have been invisible
and survived all of that. This is the trade the requester chose, in exchange for deleting a
whole override layer (NFR-1). Recorded in §13.

At user scope there is no git and no sharing, so the single XDG file is simply the truth and
this section reduces to "uninstall removes the entry".

### 5.5 `commitMode` loses its second job

It now means only "add the written files to `.git/info/exclude`". It no longer decides
where anything is recorded. "Dev A commits the `.github/` files; dev B uses kiro and does
not want to commit" and "dev B does want to commit" become the same code path with a
different boolean.

**`local-only` covers untracked generated artifacts, and nothing more.** This is the limit
of the mechanism and the promise must be scoped to it: `.git/info/exclude` keeps *newly
generated untracked* files out of `git status`, which is exactly FR-10's case. It does
**not** hide modifications to files that are already tracked, it does not survive a forced
`git add`, and it does not help when two targets write to the same tracked destination. So
when a `local-only` deployment would modify a tracked or shared path, the plan reports it and
the operation warns rather than implying the change is invisible. No index-hiding mechanism
(`skip-worktree`, `assume-unchanged`) is introduced — those break in ways that are worse than
the problem.

### 5.6 Reconcile

`reconcile(target)` installs `desired − materialized` and undeploys
`materialized − desired`. The first half is what `install --lockfile` already does; the
second half is new, and it is what makes removal propagate: A drops a bundle from committed
desired state and commits, B pulls, and B's files are cleaned the next time B reconciles.

**The comparison is not pure bundle-id set subtraction** — the same id at a different
version, or from a different source, must redeploy. Reconcile compares
**`(logicalBundleKey, version, sourceId, targetType)`**, and a mismatch means redeploy.

`sourceId` is in the tuple because source selection is part of desired bundle identity and is
already represented in the schema. Without it: desired state says `b@1.0.0` from source A,
someone edits it to source B's *different* `b@1.0.0`, the tuple is unchanged, and reconcile
leaves source A's bytes installed forever. That is a wrong-content bug, not a missed
optimization — which is what distinguishes it from the next paragraph.

Layout, transformer and `allowedKinds` changes are deliberately **not** tracked; a user who
changes a layout override re-runs install explicitly. No deployment signature or
configuration fingerprint is persisted. Redeploy removes old-only paths without disturbing
paths still claimed by another target (§6.6).

**Reconcile never acts without an explicit instruction.** That is the rule for both halves,
installs and removals alike:

- **CLI** — only an explicit command reconciles: `install --lockfile`, or `reconcile`. No
  other command reconciles as a side effect.
- **Extension** — a prompt. On open, if the committed desired state and the local
  materialization disagree, the user is told what differs ("3 bundles in the lockfile are not
  installed", "2 installed bundles are no longer in the lockfile — remove their files?") and
  nothing happens until they say yes. Declining is remembered for the session, not persisted.

So reconcile on workspace open is **read-only**. Acting would write, and writing would
trigger the lazy repository migration (§8.1), producing exactly the unexpected diff that
migration ordering exists to avoid. This matches what `RepositoryActivationService` already
does: detect and offer. It is also what makes §5.4's git-based divergence workable — a
developer whose uncommitted deletion was wiped by a merge is *offered* the reinstall, not
given it.

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
- `checksum` — hash of the **source** bytes from the archive, per file. Retained for
  provenance; not load-bearing, and optional for the same reason `archiveSha` is (§5.2).
  Distinct from the bundle-level `archiveSha`, which hashes the whole artifact.

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

No committed per-file checksums (FR-27). Verification instead re-derives — but placement is
a pure function of `PlacementContext`, not of three inputs (§4.6), and re-deriving what
*should* be on disk also needs the versioned bundle manifest, which desired state alone does
not contain. So verification has two tiers and says which one it ran:

| Tier | Needs | Checks |
|---|---|---|
| **Local state** — always | nothing beyond the two lockfiles and disk | every recorded path exists; every file matches its `installedChecksum`; no record is orphaned |
| **Full** — when the versioned manifest is available from cache | cache hit | re-derive the expected destination set from the manifest + `PlacementContext` and compare against the recorded paths; catches a stale lockfile, which stored committed checksums would have confirmed as healthy |

When the manifest is not cached, `doctor`/`status` run the local-state tier and **report that
content-versus-manifest verification is unavailable offline**. They do not fetch — these
commands are not network- or auth-dependent today and this design does not make them so —
and they do not silently skip, because a clean report that verified nothing is worse than an
honest one.

This is new behavior requiring its own delivery, not an acceptance statement about existing
code: `runStatus` (`status.ts:124`) reads lockfile entries without checking installed files,
and `runDoctorChecks` (`doctor.ts:186`) runs environment and configuration checks only.

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
| Scope conflict | `ScopeConflictResolver` | `conflict.kind = 'scope'` | existing scope-move UX, retained | refuse with hint (**new**) |
| Shared destination held by another owner | — | `conflict.kind = 'shared-destination'` | report path + owner, refuse | same (**new**, §6.6) |
| Untracked pre-existing destination | extension's skip-regular-files branch | `collisions` | skip, summarize | skip, summarize; `--force` overwrites (§4.10) |
| Already satisfied (untracked, byte-identical) | — | `satisfied` | no-op | no-op (§9.3) |

**The retained scope-move UX is not a counter-example to §9.2's no-rollback rule.** Moving a
bundle between scopes removes it at one scope and installs it at the other, and if the second
step fails it attempts a best-effort reinstall at the original scope. That is a *reinstall
from the source*, not a restoration of overwritten bytes — the two are different guarantees
and the implementation must not describe one as the other.

### 5.12 The flag must isolate persistent state, and today's readers do not

`unifiedDeploy` keeps `main` releasable only if flag-off code can never misread or
clobber flag-on state. Slice 1 writes `3.0.0` to the **same** XDG filename the legacy path
reads, and the current readers and writers make that unsafe:

- `readLockfile` is `JSON.parse(raw) as Lockfile` (`json-lockfile-store.ts:198`) — an
  unchecked cast with no version check at all.
- every upsert stamps `LOCKFILE_SCHEMA_VERSION = '2.0.0'`
  (`json-lockfile-store.ts:49`, used at `:162`, `:252`, `:268`, `:287`, `:318`), so a
  flag-off write **downgrades the stamp on a v3 file** while leaving v3 structures in place.
- `lockfile.schema.json:28` enumerates `"2.0.0"` as the only allowed version, so `3.0.0`
  fails wire-format validation before any of this is reached.
- the extension's `LockfileManager` declares its own `LOCKFILE_SCHEMA_VERSION = '2.0.0'`
  (`lockfile-manager.ts:56`), and `read()` (`:619`) merely parses — only the separate
  `validate()` (`:632`) applies the schema. So "the schema rejects it" is not a claim that
  can be made about the ordinary read path.

**Prerequisite, in Step 0, before any v3 write:** every read checks the schema version
first. A known major is parsed; an unknown major **fails loudly** with an actionable
message ("this lockfile was written by a newer version of AI Primitives Hub; upgrade or
disable `unifiedDeploy`") and no write proceeds. The schema enum gains `3.0.0`, and no
writer re-stamps a version it did not understand.

A separate temporary filename for flagged state was rejected: it would need its own
migration later, i.e. a second rename. Making slice 1 ship a **dual-format writer** — one
that keeps reading and writing v2 alongside v3 — was rejected as well; the version gate is a
few lines and buys the same safety.

What slice 1 does ship is the **one-way** XDG shape migration (§8.3, §11): a v2 user lockfile
is read, converted and rewritten as v3 on the first flag-on write, and from then on the gate
is what protects it from a flag-off writer. Converting forward once is not the same as
maintaining two formats, and the distinction is what keeps slice 1 small while still letting
a flag-on uninstall find records a v2 install left behind.

### 5.13 One logical bundle key

`bundles["<bundleId>"]` with a separate `version` field does not by itself unify the two
layers' identities, and the schema cannot be settled without deciding this:

- extension GitHub runtime ids are namespaced **and version-bearing**
  (`github-adapter.ts:214`), with build-time and runtime helpers deliberately producing
  different formats (`core/src/domain/bundle/id.ts:13`);
- CLI resolver references use the *requested* id, while CLI recording keys on
  `manifest.id` (`install.ts:1125`).

So a version-bearing id would put the version in the key *and* the field, and a
manifest id would silently collide across sources. Required before v3 migration:

- **`logicalBundleKey`** is version-independent and source-qualified: `{sourceId}/{manifestId}`,
  **always, in every file and at every scope**. An earlier version of this spec allowed the
  source part to be omitted at user scope when the lockfile had a single source, for
  readability of hand-edited files. That is withdrawn: the key would then change shape the
  moment a second source is added, so every existing key in that file would need rewriting —
  a silent rekey of the one identifier §5.6, §5.13 and removal all join on, and exactly the
  kind of later break NFR-4 forbids. Readability is not worth a mutable key.
- A **collision policy**: two sources offering the same manifest id are two distinct keys,
  which is what makes §5.6's source-aware comparison expressible.
- **Legacy alias handling**: migration maps an old version-bearing or bare id to the new key
  and records nothing else; the alias is not retained.

The same key is used for desired intent, materialization, update selection, removal and
scope conflicts. This is foundational identity — not the deployment signature §5.6 declines
to build. Without it, FR-15's lockfile-driven per-target install would require a second
schema break, which NFR-4 forbids.

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

**What FR-26 does and does not claim.** It is a decision about the destinations *this
project writes for the VS Code family* — the four `servers`-keyed entries. It is not a claim
that every one of the 11 hosts reads a portable file: the other seventeen entries are
already `mcpServers`-keyed and are target-specific by design, and they are unchanged by this
work. "Portable only" means "stop writing the two destinations VS Code deprecated", nothing
wider.

Two consequences: no profile-scoped MCP path remains for **new** writes, so
`McpConfigLocator` is deleted outright rather than reduced, and
`detectActiveProfile`/`getActiveProfileName` are deleted as the dead code they already are.
`${vscodeUserDir}` drops to zero users and retires from `core`.

**But the default-profile limitation does not become "moot", and an earlier version of this
section wrongly said so.** A new common destination cannot recover data the old locator never
looked at: servers installed under a **non-default** VS Code profile live in files the
locator never resolved, so migration cannot discover them. Policy (§14): migration reads the
default-profile config and the sidecars it can find; non-default-profile entries are **not
migrated**, are reported with their path and the bundle name, and the user re-installs the
bundle if they want them portable. Enumerating profile directories was rejected — it adds
profile discovery plus a per-profile conflict policy, which is the machinery the locator's
own KNOWN LIMITATION exists to avoid. Leaving them silently was rejected as the lossy
default FR-18 warns against.

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
  contract. **Decision: identities are computed live from the config on every operation and
  never persisted.** `mcpServers` in the materialization record holds server *names*, which
  is what cleanup needs. Note what this does and does not buy: it keeps the lossiness out of
  the persisted contract, but a false duplicate verdict is still possible at decision time.
  That is an accepted risk (§13); fixing `computeServerIdentity` is a separate change with
  its own behavior implications.

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
- Preserve live edits, **serialized** `disabled` values, automatic-disable provenance,
  unrelated inputs, and top-level JSONC state. The promise stops at what is in the file:
  VS Code also keeps UI enable/disable state separately, and the migration does not read it,
  so a server disabled through the UI rather than through config can come back enabled.
  Reported, not silently carried.
- Detect same-name/different-content collisions at the destination.
- Transfer **every** owner in the sidecar in one pass on first touch, then delete it. No
  per-bundle incremental transfer — a partially transferred sidecar is the dangerous state,
  so the simplest safe rule is all-or-nothing per config directory.
- Retain cleanup ownership for APM, missing-cache and unmanaged records.
- **Write the materialization record *before* the MCP config.** An earlier version of this
  spec had this backwards and justified it with a reversed failure description. Starting from
  neither, config-first means a crash leaves the **server live in a shared config with
  nothing tracking it** — the one state that cannot converge, because the next run either
  duplicates it or never cleans it, and the old sidecar may already be gone. Record-first
  leaves a tracked-but-unwritten entry, which the next run re-applies, since the config
  merge is idempotent on server name. Neither order is a cross-file transaction and this
  design does not claim one; record-first is simply the order whose failure state is
  recoverable.
- On malformed or partial JSONC, stop and report; do not rewrite a file that cannot be
  parsed. This is a **changed** parser/writer path, not a relocation: today a malformed file
  becomes a warning plus partial state, and the current writer preserves structured top-level
  values while serializing comments and formatting away. The boundary this design promises is
  therefore "top-level structured values preserved, comments and formatting not" — and the
  hard stop needs new code at the parse boundary.
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
validation command and its schema tooling are independently registered. **Decision (§14):
authoring support is retired too — the validation command and `apm.schema.json` go — but in
an entirely independent PR**, outside the slice sequence in §11. It shares no code with the
lifecycle work, so coupling them would only widen the blast radius of both.

**Graceful degradation is not free.** Warn-and-skip is **not** current behavior: source sync
isolates per-source failures, but `createSourceAdapter` throws on an unknown type and deep
hub validation reports errors. More importantly, **wire-format enum validation can reject
the whole config before any skip logic runs**: `schemas/hub-config.schema.json:77` enumerates
the nine source types and `packages/core/src/public/schemas/lockfile.schema.json:101`
enumerates `sourceType`. So removing enum members requires a deliberate retired/unknown-value
policy in the schemas and at the load boundary, or existing configs fail to load entirely.

**Where that rejection actually happens matters, and the claim must be narrowed to it.**
Ajv runs in the **explicit** validation paths — runtime hub validation, and the extension's
`LockfileManager.validate()` (`lockfile-manager.ts:632`). Ordinary `read()` (`:619`) merely
parses shared JSON and catches errors; it applies no schema. So the enums do **not** reject
at every loader, and the policy must be written for both situations: explicit validation
needs the retired-value rule so a hub config still loads, and the read paths need the
warn-and-skip behavior because nothing there would have rejected the value in the first
place. Lockfile replay of an unsupported type currently returns `null` with verbose-only
messaging, so "unmanaged with one warning" must be implemented, not assumed.

Thirteen files under `docs/` reference apm, including `docs/user-guide/sources.md` and
`docs/author-guide/creating-a-hub.md`. (An earlier count of ten in this spec was wrong — a
truncated search.)

## 8. Migration

### 8.1 Triggers — eager for user scope, lazy for repository scope

| State | Trigger | VCS impact |
|---|---|---|
| User scope (`globalStorage` records, cache, symlinks, XDG lockfile) | **Eager**, at activation via `runMigrations()` | none — machine-local |
| Repository scope (`prompt-registry.lock.json` + `.local.lock.json`) | **Lazy** — first install, update **or uninstall** in that repository | one intentional diff, attached to an action the user initiated |

**Uninstall is a permitted trigger, and that amends FR-16** (§14). FR-16 as stated allows
only install and update. Its purpose is that *merely opening* a repository must not dirty
the working tree — and an uninstall is a user-initiated action that has to write the lockfile
anyway, so migrating in the same step produces one coherent diff rather than two. The
alternative, keeping uninstall on the legacy reader and writer until some later install
migrates the repository, would keep the legacy write path alive and double the uninstall test
matrix for no user-visible benefit. The requester approved the amendment explicitly.

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
- The repository pair migrates **as one unit** on that first write — not as one filesystem
  transaction, which is impossible across four file operations. The legacy local file is
  folded into the new local file, the new committed file is written, and both legacy files
  are deleted, in the fixed order of §8.4 with a completion marker written last. The
  developer commits one coherent diff alongside whatever they were already doing.
- A repository nobody installs into stays on legacy indefinitely and keeps working through
  the v2 reader. The exposure window for a mixed-version team therefore only opens when
  someone deliberately acts.
- Concurrent migration on two branches produces identical committed content, since desired
  state is deterministic **and the committed file carries no volatile metadata** — this is
  why §5.2 drops `generatedAt` and `generatedBy`. With those fields present the claim would
  have been false, since the existing writers stamp wall-clock time
  (`json-lockfile-store.ts:160`, `:246`). The only conflict is the add/delete pair.

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
| Direct skill install | written straight to a scope-specific skills dir; may have **no** extracted cache manifest | adopt in place; do not redeploy from a cache that does not exist. A **workspace** skills dir is repository-local, so it is not touched at activation |
| `local-skills` install | **symlink to a live source directory** (`bundle-installer.ts:1002`) | adopt the link and record `linked: true`; **never** copy over or write beneath it (§4.8's named FR-21 exception) |

**Each record's own persisted path is used — never the current activation's.** Install
records are stored globally, but a workspace-scope record's cache resolves against *that
workspace's* storage URI. Activation in workspace X would therefore pick the wrong cache for
a record created in workspace Y. Current records carry `installPath`; migration reads it per
record, and a record whose cache is inaccessible from the current session is **retained and
marked unmanaged** rather than redeployed from the wrong place. No cache-discovery mechanism
is added. Tested by activating from a different workspace than the one that created the
record.

**Old-record migration is decided by where the artifacts actually are, not by the new scope
rule.** The two questions are separate and an earlier draft blurred them:

- A record whose files are in `~/.copilot/` (the generic user and workspace path) folds to
  **user** scope. That is a compatibility decision about old records, and it is unrelated to
  §4.9's selection rule for *new* repository installs.
- A record whose artifacts are **repository-local** — workspace skills in the workspace's own
  `.copilot/skills`, and legacy workspace-scope MCP, which maps onto the *repository* config
  scope (`mcp-config-service.ts:121`) — is **not** moved at activation. Moving files inside a
  repository during activation is exactly the dangling diff FR-16 forbids. Those stay where
  they are, are recorded against the repository, and are handled by the lazy path (§8.5).
  Repo-local skills are never silently made global.

Then, per classified record: redeploy or adopt, write the materialization record to the
local side of the XDG lockfile, and remove the JSON install record. Workspace **skills**
therefore keep their location, and the fact that their scope label changed is reported, not
acted on.

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

**Carried over unchanged:** `version`, `sourceId`, `installedAt`. **Not** `sourceType` — it
no longer lives on the bundle entry (§5.2) but on `sources[sourceId].type`, so migration
must *synthesize a source descriptor* from the legacy row. Where the legacy row cannot
supply one — the extension's release-asset URLs, no `branch`, no `collectionsPath` (§5.10) —
the descriptor records what is known, and the bundle row falls to the unmanaged rule rather
than inventing an origin.

`commitMode` cannot simply become a target-level field: a single target can today hold both
committed and `local-only` bundles, so the mode is recorded **per materialized bundle**
(`commitMode?` in §5.3), with the target-level value as a default only.

The CLI's XDG user lockfile already uses the new filename, so it needs only the shape
migration. Its paths are **bundle-relative**, and the same rule applies there as everywhere
else: no old-rules locator is built, so a path that cannot be proven on disk is retained
unmanaged. The exception is the bundle whose own install or update triggered the migration —
that one is being deployed now, so its paths and both checksums are written fresh.

### 8.4 Atomicity, resume and mixed-version clients

A repository migration writes two new files and deletes two legacy ones. That is **not one
filesystem transaction**, so the order is fixed and every intermediate state is legal:

1. Write the new **local** file (materialization), without the completion marker.
2. Write the new **committed** file (desired state).
3. Delete the legacy local file.
4. Delete the legacy committed file.
5. Write `migration.lockfileV3: 'complete'` into the new local file.

**The marker — not the presence of the new committed file — is what makes legacy state
non-authoritative.** An earlier version of this spec had that wrong, and it was unsafe:
interrupted between 1 and 2, or crashed before 1 completed, the legacy *local* file can be
the only record of what is materialized, and "the new committed file exists, so ignore
legacy and simply complete the deletion" would discard it. The reading rule until the marker
is set: desired state comes from the new committed file if it exists, materialization comes
from the new local file **unioned with** the legacy local file, new winning per key. After
the marker, legacy is ignored entirely and any legacy file still present is deleted.

Resume is then trivial and needs no journal: re-run the steps in order. Steps 1 and 2 are
idempotent rewrites, 3 and 4 tolerate an already-absent file.

The user-scope XDG migration has the same hazard in a different form — it changes schema
under the **same filename** — which is why §5.12's version gate is a prerequisite rather
than a nicety, and why per-record `complete` markers (§5.3) exist alongside the global
`MigrationRegistry` flag. That flag is a single global name; it cannot stand in for
per-record or per-repository completion.

**Concurrent mutation is an accepted risk, not an engineered one.** No lock and no journal
is introduced: simultaneous use of both tools on one repository is rare. But the honest
statement of the risk is **not** "the next operation re-derives it":

- What can be lost is a materialization record — its path list, its checksums, its MCP
  cleanup ownership, an unmanaged marker. None of that is inferable from committed desired
  state, which by design contains no local identifiers at all.
- The consequence is orphaned files or a bundle that reinstalls over itself, and it may
  require manual repair. §13 records it in those terms.

**Atomic write is also an implementation requirement, not an inherited one.** §10 asserts
"no corrupt JSON" under concurrent CLI/extension writes, and today neither writer delivers
that: app's `writeLockfile` (`json-lockfile-store.ts:207`) is a plain `writeFile` with no
temp file, and the extension's `writeAtomicToPath` (`lockfile-manager.ts:462`) uses a
**fixed** `targetPath + '.tmp'` guarded by an instance-local mutex — which two processes do
not share, so they would race on the same temp path. So: temp-file-plus-rename in the shared
store, with a **unique** temp name per write. That is an atomic-write detail, not a state
locking framework.

MCP ordering: the materialization record is written **before** the MCP config, for the
reason given in §6.7 — the reverse leaves a live untracked server, which is the one state
that cannot converge.

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

Servers living in a **non-default VS Code profile** are out of reach of the migration and
are reported rather than moved (§6.1). The report names the profile path and the bundle, so
the remedy — reinstall the bundle — is actionable.

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

Order is **place → record → MCP**, which is a change from the extension's current order
(cache write → MCP → scope sync → record) and is called out as such in §13. The record sits
before the MCP config write for the §6.7 reason: a crash between them must leave a tracked
entry with no server, never a live server with no owner.

### 9.3 What "idempotent redeploy" actually guarantees

Idempotence of *placement* does not prove convergence of the *lifecycle*, because the drift
and collision checks run before placement and can refuse. The gap is concrete: a deploy
writes files, the state write fails, the user re-runs the same command. The destinations now
exist with no record and no `installedChecksum`, which §4.10 would classify as an untracked
collision and skip — so the retry would never converge.

The rule that closes it: **an untracked destination whose current bytes are byte-identical to
what this operation would write is already satisfied.** It is reported in
`DeployPlan.satisfied`, treated as a no-op, and the state record is written. An exact retry
after a state-write failure therefore converges with no `--force` and no prompt.

Where it stops, stated rather than papered over:

- Bytes that **differ** are a genuine untracked collision — a half-written file, a different
  version, or a file that was never ours. Without a record there is no way to tell these
  apart, so the plan reports the path and refuses it unless `--force` is passed.
- Paths created but never recorded, followed by a *different* request, are unknown to that
  request and are left alone. They surface as collisions the next time a deploy touches them
  and as orphans in `doctor` (§5.9). Nothing hunts for them.

This is the whole retry contract. No staging directory, no prior-byte snapshot, no journal —
and §10 tests it by injecting a failure at each step and re-running the identical operation.

## 10. Testing

Vitest in `packages/`, Mocha in the extension. A focused failing test comes first for each
slice.

Every slice runs **two** suites: the existing behavior with `unifiedDeploy` off, proving no
regression on the legacy path, and the slice's own E2E coverage with it on. The golden
placement matrix gains one column per slice, so by slice 6 it is the CLI-vs-extension parity
assertion rather than a CLI-only check.

| Test | Purpose |
|---|---|
| **Golden placement matrix** — fixture bundles × 11 targets × 2 scopes → expected path set | Highest-value test in the plan; locks every placement decision in §4 and §6. The existing fixture covers prompts and instructions only, so richer fixtures are a prerequisite: every canonical kind, a directory kind with binary assets, and a deliberate path-prefix/manifest-kind mismatch — which is what makes the §4.5 non-Copilot repository changes visible |
| Layout inversion guard, every target × scope | No kind maps to two different output directories; future layout edits fail loudly |
| CLI vs extension byte-identical | Drive `deploy` through both wirings, assert identical tree and both lockfiles. The actual success criterion |
| Committed file carries no local identifiers | No `targetName`, `baseDir`, `installedAt`, `files`, `generatedAt` or `generatedBy` appears in `ai-primitives-hub.lock.json` — the last two matter for the parity and determinism assertions |
| Desired state is the committed file | Uninstall deletes the entry; reverting the file and reconciling **offers** the reinstall rather than performing it; a version edited and not committed deploys the edited version (§5.4) |
| Legacy extension lockfile migration | Production-shaped `prompt-registry.lock.json` with on-disk `path` + on-disk `checksum` → `installedChecksum` **equals the stored hash**, so a pre-existing local modification is still reported after migration |
| Legacy CLI lockfile migration | Bundle-relative `path` + archive `checksum` → retained **unmanaged**, files untouched, reported with the bundle name. No old-destination reconstruction (§8.3). Only the bundle whose install triggered the migration gets fresh paths and checksums |
| **Mixed legacy lockfile** | One file with both writers' entries → proven-extension rows preserve their stored baseline; CLI and ambiguous rows go unmanaged. Includes the trap case: a CLI bundle-relative path that *also* exists in the repository must **not** be treated as proven |
| Schema version gate | Flag-on install writes `3.0.0`; flag-off `status`, `update` and `uninstall` against that same state fail loudly with an actionable message and **write nothing** — no `2.0.0` re-stamp (§5.12) |
| Untracked collision and retry | A hand-written destination file is skipped and summarized, `--force` overwrites; and a failure injected at the state write, then the identical command re-run, converges with no flag because the bytes match (§9.3) |
| Repository root selection | Multi-root `.code-workspace`: the first git-repository folder wins; none a repository → refuse with the checked folders named (§4.9) |
| Verification tiers | `doctor` with no cached manifest runs the local-state tier and **says** content verification is unavailable; with the cache it re-derives and catches a stale lockfile (§5.9) |
| Non-default MCP profile | A server configured under a non-default VS Code profile is reported with its path, not migrated and not silently dropped (§6.1) |
| Logical bundle key | A version-bearing extension id and a bare CLI `manifest.id` for the same bundle resolve to one key; two sources offering the same manifest id stay two keys; and a single-source user lockfile still writes the **source-qualified** key, so adding a second source rekeys nothing (§5.13) |
| Lazy migration ordering | Opening a workspace writes nothing; first install migrates and deletes the legacy committed file |
| Reconcile removal | Bundle dropped from committed desired state → files cleaned on next reconcile, nothing removed on open |
| Portable replay | Lockfile written with a name-derived `sourceId` replays on a machine where that source is configured under a different name (P2) |
| No type inference from id | **Misleading** id: `src.type: 'github'` with id `awesome-copilot-xyz` must fetch through the **github** path. The naive case (`src.type: 'awesome-copilot'`, id `team-prompts`) already passes today and proves nothing |
| Drift on transformed content | The issue #357 Stage 2 case `installedChecksum` fixes, for CLI-written entries |
| Symlink replacement | Pre-place a symlink, deploy, assert the cache is untouched and the destination is a regular file |
| Shared-destination refcount | Two targets → one `.mcp.json`; uninstall one, the other's servers survive |
| Binary assets through local sources | `readBundleFiles` preserves bytes where the `archiver` text path corrupted them |
| `resolveBundle` call count | `install owner/repo:foo@1.2.3` against an **exactly addressable** tag and asset does not walk the release catalog; aliases, `latest` and nonstandard tags still fall back correctly (§3.2) |
| Pinned version fails closed | A lockfile pin whose version is absent from the source **fails**; it must never install latest. Covers both of today's divergent behaviors (§3.2) |
| User-scope migration | Fixture `AppStorage` install JSONs + cache + symlinks → real files, materialization records, symlinks gone, JSON records removed; second run is a no-op. One case per record kind in §8.2 |
| Unknown source type | `apm` in a hub config → warn, skip, rest of the hub loads; **and** in a lockfile → replay reports unmanaged retention, not a silent `null`; **and** schema enum validation does not reject the whole config |

Additional cases the audit identified as missing, grouped by what they protect:

**Entry-point reachability** — every registered CLI producer from §3.7 (`install` local /
replay / remote, `update`, `uninstall`, `profile` activate/deactivate, `apply`) and every
extension entry (command, marketplace, profile, scope and commit-mode commands,
auto-update scheduler, **and startup source sync**). Three rules for these:

- **Drive the production registry / extension registration**, with external boundaries
  mocked and real local files and state. Asserting that "both wirings call `deploy`" proves
  neither registered reachability nor reader compatibility — and a test that fakes every IO
  stage proves nothing about an end-to-end path.
- **Assert the observable outcome**, not the call: placement on disk, recorded state, UI and
  reader visibility, and uninstall residue.
- **A supported flag-on cell must fail, not skip.** Several legacy extension E2E tests skip
  when installation is unavailable or expected files are absent. For an explicitly supported
  cell that is a failure condition.
- **No capability regresses inside the flag-on window.** A flag-on extension install in
  slices 5 and 6 must still install the bundle's MCP servers through the retained legacy step,
  asserted against the config file rather than against a call — this is what proves §2's
  bridge rule holds until slice 7 removes it.

Plus one replacement-specific case: the target-less updater picks the *first* installation
matching a bundle id (`:59`), so its replacement needs a test where the **unwanted** target
is first and several materializations exist — a single-record test would pass either way.

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
`allowedKinds`: assert that a **version** change and a **source** change each redeploy
(the latter including the same version from a different source, which is the case a
version-only tuple would miss), and that layout/transformer/`allowedKinds` changes
deliberately do **not** (§5.6); a fresh clone with committed artifacts and no
materialization — adoption versus repair, with locally edited files preserved; pin removal;
**scope move, asserting the committed entry leaves the repository file so a following
reconcile does not re-offer the bundle at the scope it was just moved out of** (§5.4);
uninstall from one target while another target still holds the bundle; two differently named
targets resolving to one physical root.

**No-write guarantees** — activation with auto-update enabled asserts no repository
migration or write; startup **source sync** asserts the same independently of the update
scheduler; mixed old/new client writes after the rename. For `--dry-run`, assert no writes
through **every** port — including cache synthesis, store initialization and auth setup — by
injecting ports that reject mutations, not by checking that the final output file is absent.
Two branches currently escape and must be covered, as a fix rather than a regression test:
`performLockfileInstall` (`install.ts:952`) is reached without any `dryRun` check, while the
local and remote branches do check it (`:866`, `:1097`); and `update.ts` calls
`syncActiveHub` at `:248`, before its `if (this.dryRun)` return at `:258`.

## 11. Sequencing — vertical slices

Reordered from a horizontal, additive-only sequence (which deferred all end-to-end testing
to a late cutover) into vertical slices, per §2's delivery constraints. Each row is one PR,
E2E-testable on merge with `unifiedDeploy` on, inert with it off.

| # | Slice | What becomes testable E2E |
|---|---|---|
| 1 | `app/deploy` + `PrimitiveKind` routing + lockfile `3.0.0` read/write **behind the §5.12 version gate** + **CLI user-scope install and uninstall for `vscode`** + **the XDG user lockfile's v2→v3 shape migration** (§8.3's last paragraph) | `install X --target my-vscode` writes real files into `~/.copilot/{prompts,instructions,agents}` by manifest type, records desired + materialized state; `uninstall` removes exactly those paths; an existing v2 XDG lockfile is migrated in place on that first write; and flag-off commands against that state refuse loudly instead of corrupting it |
| 2 | Widen to **all 11 targets, user scope** | The golden placement matrix at user scope: kiro→`steering/`, claude-code→`commands/`, cursor→`rules/`, including the prefix-vs-manifest fix |
| 3 | **CLI repository scope**, incl. git-exclude, commit modes and §4.9 root selection; **bypasses** `RepositoryScopeWriter` for the three Copilot targets; **plus the lazy repository lockfile pair migration** — the rename, the §8.3 provenance rules and the §8.4 write/delete ordering | Repository installs at both commit modes, for all targets, through one writer; and upgrade paths from real extension-written and CLI-written committed lockfiles, including every interruption point. The migration cannot be later: this slice's flag-on install **is** an FR-16 trigger, and without it the legacy committed file would still own records a flag-on uninstall must find |
| 4 | **CLI update, profile activate/deactivate, apply** onto the shared path | The producers §3.7 found outside the original deletion table; reconcile's removal half |
| 5 | **Extension user scope** + `FileSystem` link-identity (§4.8) + §8.2 eager user-record classification and adoption + **the readers that depend on user-scope install truth** (`PromptLoader`'s cached-manifest and file reads, `RegistryStorage` consumers, marketplace and tree UI); the legacy `McpServerManager` step **stays wired** (§2) | Real copies replacing symlinks in VS Code; a `local-skills` live source directory proven untouched; the UI showing what was just installed; and MCP servers still installed on the flag-on path |
| 6 | **Extension repository scope** + its dependent readers (`LockfileManager` watchers and paired readers, update discovery, profiles); reuses slice 3's repository migration, so no new migration work; MCP still on the legacy step | Extension and CLI producing byte-identical repository output — the headline success criterion |
| 7 | **MCP into shared deploy**, portable destinations; **removes the legacy `McpServerManager` bridge** from slices 5–6 | **CLI installs MCP servers for the first time**; extension writes `mcp-config.json`/`.mcp.json`; and §8.5's MCP migration, which is the part of the lockfile migration that could not land in slice 3 because the destinations did not exist yet |
| 8 | **Download unification on `SourceAdapter`** + `resolveBundle` / `readBundleFiles` | CLI installs from `azure-devops` and `local` sources; binary assets survive local sources |
| 9 | **Source identity P1–P3** | A lockfile written by one user replays for another whose source is named differently |
| 10 | **Flip `unifiedDeploy` to default on** | Nothing new; the v2 reader and every slice above must be in place first |
| 11+ | **Deletions**, one area per PR | `UserScopeService`, `RepositoryScopeService`, `RepositoryScopeWriter`, `infra/resolvers`, `infra/downloaders`, APM adapters and runtime, prefix routing — each gated on an entry-point test showing no callers |
| — | **APM authoring retirement** (§7) — the validate command and `apm.schema.json` | Entirely independent PR, outside this sequence; shares no code with the lifecycle work |

**There is deliberately no migration slice**, and an earlier version of this table had one
(then slice 10) while slices 1, 3 and 6 already wrote `3.0.0` state for their surfaces. That
was unsafe for the reason §2's migration rule now states: each of those flag-on installs is an
FR-16 trigger, so each must migrate the state it is about to own. Migration is therefore split
along the same seam as everything else — XDG shape in slice 1, the repository committed/local
pair in slice 3, eager user records in slice 5, MCP destinations in slice 7 — and §8 is read
as four obligations attached to four slices rather than one late PR.

Slice 1 is the one that matters most: it puts a complete, inspectable install on disk, so
every assumption in §4 and §5 gets tested against reality before the nine slices that follow
are built on them.

**Slice 1 is verifiable by hand, by someone who did not write it** (NFR-6 means little
otherwise). The recipe: configure one `vscode` user-scope target, enable
`AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`, install a fixture bundle declaring one prompt, one
instruction and one agent with an id that differs from its filename stem, then inspect
`~/.copilot/{prompts,instructions,agents}` for real files (not links) named from the
normalized id, and the XDG lockfile for one desired entry plus one materialization record.
Then `uninstall` and confirm those exact paths are gone and nothing else is. Then re-run the
same command with the flag **off** and confirm it refuses with the §5.12 message and writes
nothing.

Two things sit outside the slice sequence because they gate it:

- **Step 0 — primitives.** Export and generalize `routeToKind`; add canonical→alias naming
  plus explicit id normalization; add the **schema version gate** (§5.12) and `3.0.0` to the
  schema enum; define the **logical bundle key** (§5.13); add the `FileSystem` link-identity
  capability. Small, additive, no behavior change. Slice 1 needs all but the last; slice 5
  needs that one. The version gate and the bundle key are prerequisites rather than slices
  because writing `3.0.0` state without them is what makes a flagged merge unsafe and what
  would force a second schema break (NFR-4).
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
description and deprecated-`commitMode` note, which name the old filenames. Its `version`
enum currently allows `"2.0.0"` **only** (`lockfile.schema.json:28`), so adding `3.0.0`
there is part of Step 0's version gate, not an afterthought. The source-type enums in
`schemas/hub-config.schema.json:77` and `lockfile.schema.json:101` need the retired-value
policy from §7 before APM members are removed. `apm.schema.json` is removed with the
independent APM-authoring PR (§7, §14).

**New or amended ADRs:**

- Unify source fetching on `SourceAdapter`, overruling `resolver-registry.ts`'s
  "overlap is intentional and stays".
- Retire the `apm` and `local-apm` source types, with the schema enum policy.
- Adopt portable MCP destinations, citing the product documentation and version that
  establishes the deprecation and input-forwarding behavior.
- Lockfile `3.0.0`: split by role — committed desired state, local materialization — plus
  the logical bundle key (§5.13) and the schema version gate (§5.12).
- **Desired state has one source and git is the override mechanism** (§5.4), superseding the
  `excludes`-plus-local-pin model. Record the fragility trade explicitly, since it is the
  reason a future reviewer might expect an override layer and find none.
- Retire the `workspace` installation scope, recording the cache, skills and MCP-scope
  semantics that change with it, and the §4.9 rule for selecting a repository root from a
  multi-root workspace.
- **Amend ADR-0004.** The rename answers NFR-9, which asked whether it would *help or
  complicate* migration rather than requiring it; the answer below is that it helps, and
  RC-3's "the repo lockfile filename stays" is the constraint being amended, not overlooked.
  ADR-0004's decision to keep `prompt-registry.lock.json` rested on "no forced
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
| User-scope artifact | symlink-or-copy, pre-existing regular files skipped | real copies — except `local-skills`, which stays a live link (§4.8) |
| CLI user-scope routing | prefix-routed, bundle filename kept | manifest-routed, normalized id + suffix |
| Copilot repository placement | `RepositoryScopeWriter`, bundle filename kept | layout + manifest routing, normalized id |
| **Non-Copilot repository subdirectories** | prefix-routed by source path | routed by manifest kind — e.g. the fixture's `prompts/x.instructions.md` moves from `.opencode/commands/` to `.opencode/rules/` (§4.5) |
| **Extension user-scope filenames** | raw manifest id passed to `getTargetFileName` (`user-scope-service.ts:393`) | normalized id, like repository scope |
| **Untracked pre-existing destination** | extension skips it, CLI overwrites it | skipped and reported everywhere; `--force` overwrites (§4.10) |
| **Desired-state divergence** | `commitMode` moved bundle truth between two files | one desired state; divergence is an uncommitted edit (§5.4) |
| **Removal propagation** | none — a bundle dropped by a teammate stays installed | offered on explicit reconcile or prompt, never silent (§5.6) |
| **Non-default-profile MCP servers** | written and read through the default profile only | not migrated; reported with path and bundle (§6.1) |
| **APM authoring** | validate command + `apm.schema.json` supported | retired, in an independent PR (§7) |
| `workspace` scope | distinct cache, workspace skills dir, repository MCP scope | retired; folded into user |
| Scope conflict | reached only from explicit scope-move commands | enforced on every install |
| Drift protection | repository scope only, main lockfile only (`local-only` entries never checked) | all scopes and both commit modes, from `installedChecksum` in the local materialization file |
| MCP destinations | user-profile `mcp.json`, `.vscode/mcp.json` | portable `mcp-config.json`, `.mcp.json` |
| Input-requiring MCP servers | written, with a warning | skipped, with a warning |
| MCP config backups | created by default on write | not created by migration |
| Deployment order | cache write → MCP → scope sync → record | place → record → MCP (§6.7) |
| APM sources | installable | retired; records retained as unmanaged |
| Unknown source type | factory throws; schema enum may reject the config | warn and skip |

**External premises, to be cited and versioned rather than asserted:** that the VS Code
user-profile `mcp.json` and `.vscode/mcp.json` are deprecated; that
`$COPILOT_HOME/mcp-config.json` and `.mcp.json` are the portable, Agent-Host-native
destinations; that Agent Host does not forward servers requiring `${input:...}`; that a
non-default VS Code profile does not read the default-profile MCP file and that the
upstream issues are closed as not planned; that hosts other than Copilot discover
`.prompt.md` / `.agent.md` files and display sensible command names for them (§4.4); and that
the extension has materially more adoption than the CLI. The last one shaped §8.3's default assumption, so it is explicitly
marked unverified there and is not used to justify any lossy default.

### Accepted risks

Three reviews have now been run against this design. The **first**, an executable-code audit of
an earlier draft, recommended staging snapshots, trigger provenance plumbing, a full install
signature, a legacy-destination locator, state locking and an ambiguity taxonomy. Its factual
corrections are incorporated; those prescriptions were deliberately pruned back.

The **second** (see the header's review provenance) audited this design against the requirements
and explicitly declined to require cross-process locks, staged snapshots, deployment
fingerprints or a legacy-destination reconstruction framework — so incorporating it does not
reopen what the first pruning closed.

The **third** was a consistency pass of this document against itself and against the
requirements list. It added no machinery: it fixed a reversed deployment order in §3's
diagram, a stale reconcile tuple and a stale drift row in this section, removed the
conditional source-qualification that made §5.13's key mutable, stated the target-agnostic
nature of desired state that FR-10/FR-11/FR-15 already imply, made scope moves edit desired
state so they are stable under reconcile, and redistributed migration out of a single late
slice into the slices whose writers make each piece of state authoritative. Net effect on
NFR-1/NFR-3: one fewer schema variant, one fewer PR, no new mechanism.

**NFR-3 re-audit.** The net effect of the second review on implementation size: five
migration-only fields in the local record (§5.3), one operation table (§5.4), one identity
rule (§5.13), one version gate (§5.12), and a set of corrections to claims that were simply
wrong. Against that, one whole override layer was **deleted** — `excludes`, `local.bundles`,
a local `sources` map and their precedence rules. The design is smaller after this review
than before it. Each item below remains a risk accepted in exchange for a materially smaller
implementation.

| Accepted risk | Mitigation instead of machinery |
|---|---|
| A failure after the overwrite step leaves files mixed between two versions; previous bytes are not restored | Idempotent redeploy; overwrites happen last; applied effects are reported (§9.2). Matches today's behavior, where update uninstalls before the new install succeeds |
| A scheduled auto-update write could migrate a repository | Migration is invoked only from the three command handlers — a call-site rule, not a threaded flag (§8.1) |
| A layout-override or transformer change does not trigger reconcile | Reconcile compares `(logicalBundleKey, version, sourceId, targetType)` and nothing else; a user changing an override re-runs install (§5.6) |
| Orphaned files from old CLI-written entries are not recovered | Unproven destinations are left alone and reported unmanaged; no old-rules locator is built (§8.3) |
| Simultaneous CLI and extension writes can lose a materialization entry — its path list, checksums or MCP cleanup ownership. **This is not re-derivable**, and may need manual repair | Unique-temp-name atomic writes prevent corruption, which is the part that is engineered; the loss itself is accepted and stated honestly rather than mitigated (§8.4) |
| Personal divergence is an uncommitted edit to a tracked file, so `git checkout`, a merge or an IDE "discard changes" silently restores the team's version | Reconcile offers rather than acts, so the files follow only with a yes (§5.4, §5.6). Accepted in exchange for deleting the whole override layer |
| A false MCP duplicate verdict is still possible, because `computeServerIdentity` is lossy | Identities are computed live and never persisted, so the lossiness is not frozen into the state contract; fixing the function is a separate change (§6.5) |
| Non-default-profile MCP servers are not migrated | Reported with the profile path and bundle name; remedy is to reinstall the bundle (§6.1) |
| A retry whose bytes **differ** from a half-written file needs `--force`, because without a record the two cases are indistinguishable | Byte-identical retries converge with no flag, which is the common case after a failed state write (§9.3) |
| A `local-skills` install keeps a live link, so FR-21's real-copy rule is not universal | A named exception with a reason; the link-identity port capability stops any write reaching through it (§4.8) |
| Workspace-scope records keep repository-local artifacts where they are, so their scope label and their location disagree until the lazy path runs | Reported, not silently relocated — moving files at activation is the diff FR-16 forbids (§8.2) |
| MCP config backups are no longer created by migration | Read-modify-write merges preserve unrelated entries; nothing is wholesale replaced (§6.7) |
| Legacy and unified paths coexist behind `unifiedDeploy` for the whole cutover — double maintenance, doubled test matrix | Bounded by the flag-flip and deletion PRs (§11 slices 10–11+); accepted in exchange for E2E testing from slice 1 (§2) |

**Acceptance criteria, not established facts:** byte parity between layers, lockfile
portability across machines, transaction safety, and migration idempotence. Current tests
confirm today's behavior; they do not validate these.

## 14. Requirement amendments and decisions taken during review

The second review surfaced places where the design and the stated requirements genuinely
disagreed, or where the design had simply left a decision open. Each was put to the requester.
Three of their answers **change a stated requirement**, which is recorded here rather than
silently absorbed.

| # | Requirement | Resolution | Reasoning |
|---|---|---|---|
| 1 | **FR-16** — repository migration only on install or update | **Amended**: uninstall is also a permitted trigger (§8.1) | FR-16's purpose is that *opening* a repository never dirties the tree. Uninstall is user-initiated and writes the lockfile anyway, so migrating in the same step yields one coherent diff. The alternative keeps the legacy write path alive and doubles the uninstall test matrix for no user-visible gain |
| 2 | **FR-21** — user-scope installs place real file copies | **Amended by exception**: `local-skills` keeps its live link (§4.8) | FR-21 answers FR-3, which is about bundle installs landing in the wrong place. A `local-skills` link to a directory the user owns and edits is a different feature, and copying would silently break the live-edit loop |
| 3 | **FR-28** — exclude list plus local version pin, local wins | **Superseded**: there is no local desired state; divergence is an uncommitted edit to the committed file (§5.4) | The requester's own model. Deletes `excludes`, `local.bundles`, a local `sources` map and all precedence rules, in exchange for the fragility recorded in §13 |
| 4 | **FR-7** — drop both APM source types | **Extended**: APM authoring is retired too, in an **independent** PR (§7) | The design had left authoring as an open question. It shares no code with the lifecycle work, so it is sequenced outside §11 entirely |
| 5 | **FR-22** — workspace targets the main repo of the workspace file | Decided: the **first folder in the `.code-workspace` file that is a git repository**; refuse if none is (§4.9) | Deterministic, no new setting. Distinct from how *old* workspace records migrate, which follows artifact location (§8.2) |
| 6 | **FR-26** — MCP writes go to portable destinations only | Scoped: it concerns the four `servers`-keyed VS Code entries; the other seventeen are already `mcpServers` and unchanged (§6.1) | "Portable only" is a statement about what this project writes for the VS Code family, not a claim about every host |
| 7 | **FR-27** — no committed checksums, verify by re-derivation | Bounded: a local-state tier always, a full tier when the manifest is cached, and an explicit "unavailable offline" report otherwise (§5.9) | Re-derivation needs the versioned manifest. `doctor` does not become network- or auth-dependent, and does not report clean after verifying nothing |
| 8 | — (open) | Legacy **non-default-profile** MCP configs are not migrated; reported with their path (§6.1) | Profile enumeration plus a per-profile conflict policy is the machinery the locator's own KNOWN LIMITATION exists to avoid. Silence was rejected as the lossy default FR-18 warns against |
| 9 | — (open) | An untracked pre-existing destination is **skipped and reported**; `--force` overwrites (§4.10) | Preserves today's extension behavior, never destroys hand-written files silently, and reuses the existing flag. Refusing the whole install would let one stale file block an unrelated bundle |
| 10 | — (open) | Removal propagates only on **explicit** action: CLI reconcile, extension prompt (§5.6) | Symmetric with install. Nothing is deleted without a yes, which is also what makes #3's git-based divergence workable |
| 11 | — (open) | Flag-off code must refuse `3.0.0` state loudly; the version gate ships in Step 0 (§5.12) | Today's reader is an unchecked cast and today's writers re-stamp `2.0.0`, so without the gate a flagged merge can corrupt state rather than merely ignore it |

**Still unresolved, deliberately:** nothing. Every item the review flagged as needing a
decision has one. What the review flagged as *incorrect* is corrected inline with its
evidence; what it flagged as *missing* is either added or recorded as an accepted risk in
§13 with a reason.
