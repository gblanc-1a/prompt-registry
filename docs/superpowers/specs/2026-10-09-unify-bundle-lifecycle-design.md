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

**Placement.** Four placement implementations exist:

1. `FileTreeTargetWriter.write()` (CLI) — layout-driven, routes by **bundle path prefix**,
   keeps bundle filenames.
2. `FileTreeTargetWriter.writeManifestItems()` (`packages/app`) — layout-driven, routes by
   **manifest `type`**, renames to `{id}.{ext}`. **Production callers: none.** Tests only.
3. `RepositoryScopeWriter` (`packages/infra`) — **hardcodes `.github`** and a private
   type→subdirectory map, ignoring layouts entirely.
4. Extension `UserScopeService` (symlinks) + `RepositoryScopeService` (copies) —
   layout-driven, manifest-driven, renaming.

Fixture `apps/vscode-extension/test/fixtures/local-library/web-dev-bundle` declares
`file: prompts/typescript-standards.instructions.md` with `type: instructions`. Prefix
routing places it in `prompts/`; manifest routing places it in `instructions/`. The
extension is correct, the CLI is wrong.

Because `RepositoryScopeWriter` hardcodes `.github`, CLI repository-scope installs for
`kiro`, `cursor`, `claude-code` and `opencode` land in the wrong directory.

**User-scope artifact.** The extension extracts a bundle into
`globalStorage/bundles/<id>` and creates **symlinks** into `~/.copilot/<route>/`. The CLI
writes **real files**. The reported symptom — "the extension installs into the hidden VS
Code folder, the CLI installs properly to `~/.copilot/agents`" — is this.

**State.** The extension tracks user-scope installs in `RegistryStorage`/`globalState`;
the CLI tracks them in `~/.config/ai-primitives-hub/ai-primitives-hub.lock.json`. Neither
sees the other's installs.

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
file resolver in `app` — has zero production callers.

**Rules the CLI is missing.** `LockfileManager.detectModifiedFiles()` plus
`LocalModificationWarningService` warn before an update clobbers local edits; the CLI
writes per-file checksums on install and never compares them, silently overwriting.
`ScopeConflictResolver` enforces "a bundle lives at one scope only"; the CLI does not.

### 1.2 Defects found during design, fixed by this work

- **`workspace` scope is indistinguishable from `user` scope.** `ScopeServiceFactory`
  maps both to `UserScopeService`, and `resolveLayoutFromLayers` routes every
  non-`repository` scope through the `user` layout branch. A "workspace" install writes to
  `~/.copilot/` exactly like a user install.
- **Multi-target lockfile collision.** `lockfilePathForTarget`
  (`packages/cli/src/framework/target.ts:101`) returns the same single user lockfile for
  every user-scope target, and entries are keyed `bundles[bundleId]`. Installing one
  bundle to a `my-vscode` target and then a `my-kiro` target overwrites the first's file
  list, orphaning its files on uninstall. The same collision exists at repository scope
  (`.github` vs `.kiro` under one repo lockfile). The extension never hits it because it
  has exactly one host.
- **Drift detection is broken for transformed files.** `LockfileFileEntry.checksum`'s own
  documentation: "SHA256 of the extracted archive bytes for this path (not the optionally
  transformed on-disk result). User-modification checks compare this against the current
  file; transformed files will therefore look modified until an `installedChecksum` field
  is added (issue #357 Stage 2)."
- **Kind vocabulary gap.** `KIND_TO_ROUTE_KEY` is keyed on the 5-value `CopilotFileType`,
  so `writeManifestItems` silently `skipped.push()`es every other kind. The layouts route
  11 more.
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
- Existing extension installs transfer to the unified layout in one shot at activation.
- The lockfile schema supports a future `install --lockfile --target <t>` per-harness
  workflow **without a further breaking change**.

### Non-goals

- Unifying the source **configuration** models (CLI `targets.yml` + hub config vs the
  extension's registry sources UI). Both already produce `RegistrySource`, so they
  converge for free at the adapter boundary; the models themselves stay.
- Unifying hub/profile management (`hub-manager` is 858 lines in the extension against
  584 in `app`). Separate concern, separate change.
- Collapsing `InstallPipeline` and the registry use-cases into a single orchestrator.
- Making `install --lockfile --target` a first-class per-harness workflow. The schema and
  most of the behavior will support it; promoting it is a follow-up.
- Re-keying `kindRoutes` by canonical kind (see §4.5).

### Decisions taken

| Decision | Choice |
|---|---|
| Scopes in play | all three |
| Source of truth for installs | shared lockfile |
| User-scope artifact | real file copies, not symlinks |
| `workspace` scope | retired; `user` and `repository` remain |
| Existing `workspace` records | migrate to **user** scope (their files are in `~/.copilot/`) |
| Migration trigger | automatic at activation, one info notification, no backup/rollback |
| MCP | folded into the shared lifecycle |
| Bundle fetching | unified on `SourceAdapter`, auth injected per layer |
| `apm` / `local-apm` | retired |
| Unknown source type | warn and skip, rest of the hub loads |
| MCP destinations | portable only |

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
  targetName: string;              // lockfile install-record key
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

- `InstallPipeline` remains the CLI's resolve→download driver; its write stage calls
  `deployBundle`.
- `installRegistryBundle` / `uninstallInstalledBundle` / `updateRegistryBundle` keep their
  ports shape. Their `installFromBuffer` / `removeInstallation` port implementations become
  one-line calls into `deploy`, so the extension's existing orchestration and tests survive.
  This is a swap of the bottom half, not a rewrite of the top.
- `--from <dir>` stays a CLI flag that bypasses source resolution: `readLocalBundle` feeds
  `ExtractedFiles` straight into `deploy`. It is a different concept from the `local`
  **source type** and both survive. CLI `local` means "this directory *is* one built
  bundle"; `LocalAdapter` means "this directory *is a source* containing many bundles".

Approximate totals: ~6500 lines deleted (the §3.4 table alone sums to ~6500 before the
unsized entries), ~2000 relocated, 2 new port methods, 1 new `app` module.

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

The layout's `repository` branch supplies `baseDir` (`${workspaceRoot}/.github`,
`${workspaceRoot}/.kiro`, …), so `RepositoryScopeWriter`'s hardcoded `.github` and its
private type→subdirectory map both go. Repository installs on kiro, cursor, claude-code
and opencode start landing correctly.

`target.allowedKinds` filtering is preserved, now comparing canonical kinds directly
instead of round-tripping through `copilotTypeToPrimitiveKind`.

**Deferred:** once prefix routing is gone, `kindRoutes` keys are consumed only via
inversion, making the "keys are source prefixes" semantics vestigial. Re-keying by
canonical kind would be cleaner but is a schema change across 22 definitions plus the
`~/.config/ai-primitives-hub/layouts.yml` and `./ai-primitives-hub-layouts.yml` override
files, for no behavior gain.

### 4.6 Symlink replacement is a writer requirement

Today's user-scope destinations are symlinks into the cache, and `writeManifestItems`
resolves to the **same paths** (same layout, same `{id}.{ext}` naming). `fs.writeFile`
follows a symlink, so writing through one would overwrite the cached bundle instead of
replacing the link. The writer must `lstat` and `unlink` an existing symlink before
writing. This is permanent writer behavior, not migration-only code.

## 5. State

### 5.1 Truth model

The lockfile is authoritative for "what is installed". `RegistryStorage`/`globalState`
keeps only UI cache: display manifests, readmes, source catalogs, setup state.
`InstalledBundle` becomes a projection `app` assembles from lockfile + cache.
`globalStorage/bundles/` survives as a pure cache — `prompt-loader.ts:107` scans it to
list installed prompts and the marketplace joins `installPath` with manifest-relative
paths — but is no longer the installed artifact.

Filenames stay as ADR-0004 mandates: `prompt-registry.lock.json` /
`prompt-registry.local.lock.json` for repository scope, the XDG user lockfile for user
scope.

### 5.2 Schema `2.1.0` — desired state separated from materialized state

```ts
{
  version: "2.1.0",

  // DESIRED — portable, committed, what `install --lockfile` consumes
  bundles: { "<bundleId>": { version, sourceId, sourceType, checksum?, installedAt } },
  sources: { "<sourceId>": { type, url, branch?, collectionsPath? } },
  hubs?, profiles?,

  // MATERIALIZED — machine- and target-specific, optional
  installs?: {
    "<targetName>": {
      targetType,
      baseDir?,
      commitMode?,
      bundles: {
        "<bundleId>": {
          version,
          files: [{ path, checksum, installedChecksum }],
          mcpConfigPath?: string,
          mcpServers?: { "<prefixedName>": { originalName, identity, disabled?: true } }
        }
      }
    }
  }
}
```

**Why top-level siblings rather than `installs` nested in each bundle entry.**
`replaySingleEntry` already reads only desired state — `entry.sourceId`, `entry.version`,
`lock.sources[...]`, with `target` passed separately — and never touches `entry.files`. The
declarative path is therefore already target-agnostic in behavior; the schema just has to
say so. The split buys:

1. `bundles` + `sources` alone is a complete, valid lockfile.
   `install --lockfile f --target my-kiro` needs nothing else.
2. `installs` is optional and omittable — a lockfile can be committed with zero
   materialized records, which is the "commit desired state, each developer materializes
   for their own harness" workflow.
3. **Invariant, enforced by test:** desired state never references a `targetName` (local
   to `targets.yml`, meaningless across machines) or a `baseDir` (absolute). Both live only
   in `installs`.
4. It decouples "is desired state committed" from "are the files committed". Today one
   `commitMode` flag governs both because they share a record. With the split `commitMode`
   belongs to the install record, so desired state goes in the committed lockfile while
   materialized records for `local-only` installs go in the git-excluded local lockfile,
   and reading merges the two. Impossible with nested `installs`.
5. `installs[t].bundles[b].version` vs `bundles[b].version` detects a target materialized
   at a stale version, so `status` can report "desired 1.2.0, my-vscode at 1.1.0".

The `installs` key also resolves the multi-target collision in §1.2: records are keyed by
target name, so one bundle materialized to `my-vscode` and `my-kiro` keeps two independent
file lists.

### 5.3 Path semantics

`path` becomes the **on-disk** path relative to the record's root: the workspace root for
repository scope, the resolved `baseDir` for user scope. Today the extension stores
workspace-relative on-disk paths while the CLI stores bundle-relative paths and recomputes
the destination at removal time via `pickRoute` — which manifest-driven renaming makes
impossible. Recording the written path is the only correct option, and it matches what
production extension lockfiles already contain, so existing repository lockfiles need no
migration.

Removal iterates `installs[].bundles[].files[].path` joined to that record's root. No path
recomputation anywhere.

### 5.4 `installedChecksum`

`installedChecksum` records the bytes actually written, post-transform. `checksum` is
retained for round-trip compatibility but is no longer load-bearing. This unblocks drift
detection for transformed files (issue #357 Stage 2).

### 5.5 Legacy reads

If `installs` is absent, synthesize one install record from entry-level `files` and
`commitMode` under a default target name. Every existing `prompt-registry.lock.json` keeps
working untouched. Writers always emit `installs`. Readers accept both shapes.

### 5.6 Rules, surfaced identically by both layers

| Rule | Moved from | `planDeploy` field | Extension | CLI |
|---|---|---|---|---|
| Local modification | `detectModifiedFiles()` | `drifted` | existing warning dialog | refuse unless `--force` (**new**) |
| Missing files | `checkFilesMissing()` | `missing` | repair prompt | report in `status` |
| Scope conflict | `ScopeConflictResolver` | `conflict` | existing migrate-with-rollback UX | refuse with hint (**new**) |

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

Only `vscode` and `vscode-insiders` used the `servers` key; the other nine targets already
use `mcpServers`, so the fleet becomes uniform. `serversKey` stays in the layout schema —
data-driven and free, and it preserves room for a future `servers`-keyed target.
**`supportsInputs` is removed**, its only `true` holder having left.

Two consequences, both simplifying: no profile-scoped MCP path remains, so
`McpConfigLocator` is deleted outright rather than reduced, its documented default-profile
limitation becomes moot, and `detectActiveProfile`/`getActiveProfileName` are deleted as
the dead code they already are. `${vscodeUserDir}` drops to zero users and retires from
`core`.

### 6.2 Inputs become detect-and-warn

VS Code does not forward servers to Agent Host if they "require interactive input (for
example, `${input:...}` variables)", and the portable format documents no `inputs`
section. Keep `collectInputReferences` to detect such servers and skip them with an
actionable warning. The machinery that existed to make them work — `mergeInputs`,
`autoDeriveMissingInputs`, `removeOrphanedInputs`, and the "auto-derived" branch of
`notifyMcpInstallWarnings` — becomes dead and is removed. No `promptForInput` port is
needed.

### 6.3 Relocation

`McpServerManager` (801) and `McpConfigService` (472), both with zero `vscode.`
references, move to `app/deploy/mcp` with file IO behind an infra store. Layout and token
resolution reuse `resolveMcpLayoutConfig` and `core`'s `resolveMcpConfigPath` /
`resolvePathTokens`, which exist and are tested but have no production callers today.

### 6.4 Scope vocabulary

`'user' | 'workspace'` → `'user' | 'repository'`, matching `McpConfigScope`.
`installServers`/`installServersToWorkspace` and
`uninstallServers`/`uninstallServersFromWorkspace` collapse into one scope-parameterised
pair. The deliberate no-fallback rule stays: windsurf has no repository MCP file, and
inheriting the user entry would make a repository install write into `$HOME`.

### 6.5 Tracking sidecar retires into the install record

`readTrackingMetadata`/`writeTrackingMetadata` persist `managedServers` to a sidecar
beside each `mcp.json` — a second answer to "what did this bundle install". It folds into
`installs[t].bundles[b].mcpServers` (§5.2). `originalConfig` is dropped: it is recoverable
from the bundle manifest, and `identity` (the existing `computeServerIdentity` output) is
all `detectAndDisableDuplicates` compares. Cross-bundle duplicate detection still works by
iterating install records. `mcpConfigPath` records the file actually written, so uninstall
targets it correctly even after this round changes the layout.

### 6.6 Shared destinations need a refcount

`.mcp.json` is now shared by vscode, claude-code and copilot-cli at repository scope, so
two targets in one repository can write the same prefixed server name to the same file,
and uninstalling one target would remove a server another still claims. The same hazard
applies to files wherever two targets' layouts route to one directory.
`RepositoryScopeService.collectFilesUsedByOtherBundles` already implements this refcount
for bundle-level overlap; it moves to `app` and widens to cover targets and MCP entries.

## 7. Retiring APM

`SourceType` in `packages/core/src/domain/source/types.ts` shrinks from 9 to 7. Removed:
`ApmAdapter` (650), `LocalApmAdapter` (443), `ApmRuntimeManager` (580), `ApmCliWrapper`
(284). `ProcessRunner`'s only consumer was `ApmAdapter`, so its wiring leaves
`create-source-adapter`'s deps and the extension's `infra-adapter-factory`.

**Graceful degradation:** an unknown `SourceType` — `apm` or `local-apm` in an existing hub
config or lockfile — produces one actionable warning naming the source, and the rest of the
hub loads normally. Installed APM bundles stay on disk, reported as unmanaged. A stale
entry in a shared hub config must not break every other source in it.

Ten documentation files reference apm, including `docs/user-guide/sources.md` and
`docs/author-guide/creating-a-hub.md`.

## 8. Migration

One shot, from `runMigrations()` at activation, tagged
`@migration-cleanup(unify-bundle-lifecycle)`, idempotent — an existing install record
means done, backed by a `MigrationRegistry` flag. One info notification plus a logged
summary.

For each user- or workspace-scope record in `RegistryStorage`:

1. Read the cached bundle at `globalStorage/bundles/<bundleId>`.
2. `deployBundle` at user scope for the detected host.
3. Write the `installs` record to the user lockfile.
4. Drop the install truth from `globalState`, keeping only UI cache.

Workspace-scope records become user-scope records, since their files are physically in
`~/.copilot/`. Repository-scope records need no file movement: entries migrate to the
`installs` shape on the next write, and legacy reads keep working meanwhile. MCP entries
move out of `${vscodeUserDir}/mcp.json` and `.vscode/mcp.json` into the portable files
keyed `mcpServers`; the tracking sidecar is deleted. APM-sourced records stay on disk,
flagged unmanaged with one warning naming the bundle.

No backup and no rollback, by decision. The single non-crash concession: a record whose
cache is missing cannot be redeployed, so it is reported as unmanaged with the bundle name
rather than throwing.

§4.6's symlink-before-write rule is what makes step 2 safe.

## 9. Error handling

`DeployError { code, stage }` with `stage: 'extract' | 'validate' | 'place' | 'mcp' |
'record'`, mirroring `InstallPipelineError`'s shape so the extension's error mapping and
the CLI's `RegistryError` codes both keep working.

Order is place → MCP → record. A failed record rolls back files and MCP through the
writer's existing `rollback(written)`. `writeTargetSafely` / `TargetWriteRejectedError`
and `verifyWrittenBytes` are unchanged. MCP failure stays non-fatal to the bundle install,
with the existing notification behavior.

## 10. Testing

Vitest in `packages/`, Mocha in the extension. A focused failing test comes first for each
slice.

| Test | Purpose |
|---|---|
| **Golden placement matrix** — one fixture bundle × 11 targets × 2 scopes → expected path set | Highest-value test in the plan; locks every placement decision in §4 and §6 |
| Layout inversion guard, every target × scope | No kind maps to two different output directories; future layout edits fail loudly |
| CLI vs extension byte-identical | Drive `deploy` through both wirings, assert identical tree and lockfile. The actual success criterion |
| Legacy lockfile read | Production-shaped `prompt-registry.lock.json` with entry-level `files` → synthesized install record |
| Desired-state portability | No `targetName` or `baseDir` appears outside `installs` |
| Drift on transformed content | The issue #357 Stage 2 case `installedChecksum` fixes |
| Symlink replacement | Pre-place a symlink, deploy, assert the cache is untouched and the destination is a regular file |
| Shared-destination refcount | Two targets → one `.mcp.json`; uninstall one, the other's servers survive |
| Binary assets through local sources | `readBundleFiles` preserves bytes where the `archiver` text path corrupted them |
| `resolveBundle` call count | `install owner/repo:foo@1.2.3` does not walk the release catalog |
| Migration | Fixture globalState + cache + symlinks → real files, lockfile records, symlinks gone; second run is a no-op |
| Unknown source type | `apm` in a hub config → warn, skip, rest of the hub loads |

## 11. Sequencing

Slices 6 and 7 are independent of 1–5 and may run in parallel.

1. `app/deploy` skeleton, `PrimitiveKind` routing, layout inversion, golden placement
   matrix. No delivery changes.
2. Lockfile schema: `bundles`/`installs` split, `installedChecksum`, legacy read.
3. CLI cuts over to `deploy`; delete prefix routing and `RepositoryScopeWriter`.
4. Extension cuts over; delete the scope services.
5. MCP relocation and the portable-path layout change.
6. Download unification on `SourceAdapter`; delete `resolvers/` and `downloaders/`.
7. APM retirement.
8. One-shot migration.
9. Documentation and ADRs.

## 12. Documentation and ADRs

**Update:** `apps/vscode-extension/src/services/AGENTS.md` (its Key Services table names
the deleted services), `apps/vscode-extension/AGENTS.md`, `packages/AGENTS.md`,
`docs/contributor-guide/architecture/installation-flow.md`, `adapters.md`,
`mcp-integration.md`, `update-system.md`,
`library-centric-architecture/{codemap,component}.md`, `docs/user-guide/sources.md`,
`docs/author-guide/creating-a-hub.md`.

**New or amended ADRs:**

- Unify source fetching on `SourceAdapter`, overruling `resolver-registry.ts`'s
  "overlap is intentional and stays".
- Retire the `apm` and `local-apm` source types.
- Adopt portable MCP destinations; drop the deprecated VS Code locations.
- Lockfile `2.1.0`: desired state separated from materialized state.
- Retire the `workspace` installation scope.
