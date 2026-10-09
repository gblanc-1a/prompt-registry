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
- **Drift detection is broken for CLI-written lockfiles only.**
  `LockfileFileEntry.checksum`'s documentation — "SHA256 of the extracted archive bytes for
  this path (not the optionally transformed on-disk result). User-modification checks
  compare this against the current file; transformed files will therefore look modified
  until an `installedChecksum` field is added (issue #357 Stage 2)" — describes the CLI's
  behavior only. `detectModifiedFiles` compares the on-disk hash against `entry.checksum`,
  which is **correct** for extension-written entries and wrong for CLI-written ones.
- **`checkAndOfferMissingSources` offers a remedy it does not implement.** It compares
  lockfile source ids against locally configured ids, prompts "Would you like to add
  them?", and on confirmation does nothing: "Actual addition would be handled by
  RegistryManager/HubManager. For now, just log the intent."
- **Type inferred from an id.** `install.ts:1538` decides a source is awesome-copilot via
  `entry.sourceId.startsWith('awesome-copilot-')`, misclassifying any name-derived id as
  plain `github` and sending it down the wrong fetch path.
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
- Existing extension installs transfer to the unified layout without the user having to
  act, and without a surprise diff in a shared repository.
- The lockfile schema supports a future `install --lockfile --target <t>` per-harness
  workflow **without a further breaking change**.
- The committed lockfile is portable: a teammate can replay it on a different harness,
  on a different machine, without having configured the same sources by the same names.
- Opening a repository never dirties the working tree.

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
- **P2** Sources resolve by **identity** `(type, normalizedUrl, branch, collectionsPath)`,
  not by id. All four fields are already present in `LockfileSourceEntry` — except
  `collectionsPath`, which the extension's own type omits entirely and which therefore
  defaults to `'collections'`, matching what `generateSourceId` already does. Identity
  matching makes existing non-portable lockfiles work **without rewriting them**, and lets
  `RepositoryActivationService.checkAndOfferMissingSources` actually resolve instead of
  logging intent — its handler is currently a stub: "Actual addition would be handled by
  RegistryManager/HubManager. For now, just log the intent."
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

### 6.5 Tracking sidecar retires into the materialization record

`readTrackingMetadata`/`writeTrackingMetadata` persist `managedServers` to a sidecar
beside each `mcp.json` — a second answer to "what did this bundle install". It folds into
`targets[t].bundles[b].mcpServers` (§5.3). `originalConfig` is dropped: it is recoverable
from the bundle manifest, and `identity` (the existing `computeServerIdentity` output) is
all `detectAndDisableDuplicates` compares. Cross-bundle duplicate detection still works by
iterating materialization records. `mcpConfigPath` records the file actually written, so uninstall
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
- **Reconcile on open is read-only** (§5.6).
- **`--dry-run` never migrates.**
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

For each user- or workspace-scope record in `RegistryStorage`:

1. Read the cached bundle at `globalStorage/bundles/<bundleId>`.
2. `deployBundle` at user scope for the detected host.
3. Write the target record to the local side of the XDG lockfile.
4. Drop the install truth from `globalState`, keeping only UI cache.

Workspace-scope records become user-scope records, since their files are physically in
`~/.copilot/`. Idempotent: an existing materialization record means done, backed by a
`MigrationRegistry` flag. One info notification plus a logged summary.

§4.6's symlink-before-write rule is what makes step 2 safe.

### 8.3 Legacy lockfiles are predominantly extension-written

The extension has real adoption; the CLI does not. The migration is therefore designed
around extension semantics as the default and treats CLI-written entries as a detected
special case — and must handle a single lockfile containing both, which happens whenever
the extension installed one bundle and the CLI another into the same repository.
`generatedBy` records only the last writer, so it is **not** a safe discriminator.

**Path resolution — per entry, by existence.** Test `join(repoRoot, entry.path)`. If it
exists, the path was on-disk (extension-written). If not, re-derive the destination from
the bundle-relative path through the deterministic placement function and test that
(CLI-written). Lazy migration guarantees the manifest is in hand, so re-derivation is
always available.

**Checksums — replaced, never interpreted.** Per §5.8 the legacy value's meaning depends on
the writer and cannot be determined by inspection.

- For the bundle whose install/update triggered migration: compute both `checksum` and
  `installedChecksum` fresh.
- For every other bundle: set `installedChecksum` to the hash of the **current on-disk
  file** and omit `checksum`. Current state becomes the drift baseline.

This rule is chosen for the dominant case: extension-written entries already store the
on-disk hash, so adopting current state is **lossless** for them. For the rarer CLI-written
entries, drift that predates migration is forgiven exactly once — better than carrying a
value whose meaning we would have to guess.

**Assigning a target to legacy materialization.** Legacy lockfiles carry no target
dimension, but they came from one host, inferable from the path prefix: `.kiro/` → kiro,
`.cursor/` → cursor, `.claude/` → claude-code, `.opencode/` → opencode. `.github/` is
ambiguous between vscode and copilot-cli, resolved by preferring the currently detected
host when consistent with the prefix, else a synthetic `legacy-<prefix>` target name. A
wrong label is cosmetic: the record stores explicit paths and the file is never shared.

**Carried over unchanged:** `version`, `sourceId`, `sourceType`, `installedAt`.
`commitMode` is implied by which legacy file held the entry and is recorded on the target
record.

The CLI's XDG user lockfile is already named `ai-primitives-hub.lock.json`, so it needs no
rename — only the same shape migration, with bundle-relative paths re-derived identically.

### 8.4 MCP and APM

MCP entries move out of `${vscodeUserDir}/mcp.json` and `.vscode/mcp.json` into the
portable files keyed `mcpServers`, and the tracking sidecar is deleted. APM-sourced records
stay on disk, flagged unmanaged with one warning naming the bundle.

No backup and no rollback, by decision. The single non-crash concession: a record whose
cache is missing cannot be redeployed, so it is reported as unmanaged with the bundle name
rather than throwing.

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
| CLI vs extension byte-identical | Drive `deploy` through both wirings, assert identical tree and both lockfiles. The actual success criterion |
| Committed file carries no local identifiers | No `targetName`, `baseDir`, `installedAt` or `files` appears in `ai-primitives-hub.lock.json` |
| Effective desired state | `(committed − excludes) ⊕ local` across all four combinations |
| Legacy extension lockfile migration | Production-shaped `prompt-registry.lock.json` with on-disk `path` + on-disk `checksum` → lossless target record, `installedChecksum` equal to the stored value |
| Legacy CLI lockfile migration | Bundle-relative `path` + archive `checksum` → path re-derived, `installedChecksum` recomputed from disk |
| **Mixed legacy lockfile** | One file with both writers' entries → each resolved independently by existence probe |
| Lazy migration ordering | Opening a workspace writes nothing; first install migrates and deletes the legacy committed file |
| Reconcile removal | Bundle dropped from committed desired state → files cleaned on next reconcile, nothing removed on open |
| Portable replay | Lockfile written with a name-derived `sourceId` replays on a machine where that source is configured under a different name (P2) |
| No type inference from id | An awesome-copilot source with id `team-prompts` fetches through the awesome-copilot path (P3) |
| Drift on transformed content | The issue #357 Stage 2 case `installedChecksum` fixes, for CLI-written entries |
| Symlink replacement | Pre-place a symlink, deploy, assert the cache is untouched and the destination is a regular file |
| Shared-destination refcount | Two targets → one `.mcp.json`; uninstall one, the other's servers survive |
| Binary assets through local sources | `readBundleFiles` preserves bytes where the `archiver` text path corrupted them |
| `resolveBundle` call count | `install owner/repo:foo@1.2.3` does not walk the release catalog |
| User-scope migration | Fixture globalState + cache + symlinks → real files, lockfile records, symlinks gone; second run is a no-op |
| Unknown source type | `apm` in a hub config → warn, skip, rest of the hub loads |

## 11. Sequencing

Slices 7 and 8 are independent of 1–6 and may run in parallel. Slice 2 is a prerequisite
for 3 and 4; slice 9 requires both.

1. `app/deploy` skeleton, `PrimitiveKind` routing, layout inversion, golden placement
   matrix. No delivery changes.
2. Lockfile `3.0.0`: role split, two files, `installedChecksum`, `excludes`, effective
   desired state, v2 readers for both writers' shapes.
3. Source identity: P1 deterministic ids, P2 identity matching (including the
   `checkAndOfferMissingSources` stub), P3 remove type sniffing. Independent of the
   schema work and shippable alone.
4. CLI cuts over to `deploy`; delete prefix routing and `RepositoryScopeWriter`.
5. Extension cuts over; delete the scope services.
6. MCP relocation and the portable-path layout change.
7. Download unification on `SourceAdapter`; delete `resolvers/` and `downloaders/`.
8. APM retirement.
9. Migration: eager user scope, lazy repository scope, lockfile rename.
10. Documentation, schemas, and ADRs.

Slices 1–3 are pure additions with no delivery-layer behavior change, so they can merge
independently of the rest.

## 12. Documentation, schemas, and ADRs

**Update:** `apps/vscode-extension/src/services/AGENTS.md` (its Key Services table names
the deleted services), `apps/vscode-extension/AGENTS.md`, `packages/AGENTS.md` (its
dual-naming rule cites the lockfile filename), the root `AGENTS.md`,
`docs/contributor-guide/architecture/installation-flow.md`, `adapters.md`,
`mcp-integration.md`, `update-system.md`, `authentication.md`, `core-flows.md`,
`validation.md`, `library-centric-architecture/{codemap,component,system-context}.md`,
`docs/contributor-guide/testing/{golden-path,test-plan}.md`, `docs/user-guide/sources.md`,
`docs/author-guide/creating-a-hub.md`.

**Schemas:** `apps/vscode-extension/schemas/lockfile.schema.json` and the published copy
under `packages/core/**/public/schemas/` are rewritten for `3.0.0` — including the
description and the deprecated-`commitMode` note, both of which name the old filenames.
`apm.schema.json` is deleted with §7.

**New or amended ADRs:**

- Unify source fetching on `SourceAdapter`, overruling `resolver-registry.ts`'s
  "overlap is intentional and stays".
- Retire the `apm` and `local-apm` source types.
- Adopt portable MCP destinations; drop the deprecated VS Code locations.
- Lockfile `3.0.0`: split by role — committed desired state, local materialization.
- Retire the `workspace` installation scope.
- **Amend ADR-0004.** Its decision to keep `prompt-registry.lock.json` rested on "no
  forced migration for existing extension users or already-committed repository
  lockfiles". The role split voids that premise independently of any rename: the committed
  file's meaning changes either way. Once a semantic break is unavoidable, reusing the
  filename is actively harmful — an un-upgraded extension reading a `3.0.0` file sees
  entries with no `files` array and `checkFilesMissing()` concludes everything is missing,
  offering repair. Under the rename it finds no file, concludes "no repository installs",
  and does nothing; the committed `.github/` files keep working because Copilot reads them
  directly. Inert beats wrong. ADR-0004's second premise — that both tools read and write
  the same file — is preserved, and the rename also converges repository scope on the
  filename `resolveUserConfigPaths()` already uses for user scope. ADR-0004 itself
  anticipated this: "until the lockfile is naturally retired far in the future, if ever."
