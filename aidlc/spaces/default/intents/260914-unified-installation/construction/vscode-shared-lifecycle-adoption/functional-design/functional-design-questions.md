# Functional Design Questions — VS Code Shared-Lifecycle Adoption (U3)

U3 is the VS Code delivery adapter. Like U2 it owns no lifecycle policy and no
target-write path; it adapts the extension's install, update, and uninstall
commands to the shared lifecycle, retires the extension's cache-then-sync target
writes, and keeps the VS Code-specific command, notification, and bookkeeping
concerns at the delivery edge.

The extension as it stands does three things this migration has to change:

- It **caches then syncs**: `bundle-installer.ts` downloads, extracts, and copies
  every file into a bundle-cache directory under the extension's global storage,
  and a separate write applies them to the target. The requirement is a single
  manifest-driven write with no second sync path.
- It reaches **`context.globalStorageUri.fsPath` directly** for that cache and for
  shared data, which ADR-0005 says new code must resolve through the injected
  `AppStorage` port instead.
- It **prompts and reports in VS Code terms** — skill-overwrite prompts, progress
  notifications, the registry tree view — which must stay in the adapter while the
  decision logic moves to the shared lifecycle's result kinds.

These questions settle how far each of those changes goes. Nothing decided
upstream, and nothing answered for U1 or U2, is re-asked.

## Q1. What happens to the extension's bundle-cache directory?

Today every install copies the extracted files into
`globalStorageUri/bundles/{bundleId}` and then the target write happens; uninstall
removes that cache directory too. The shared lifecycle writes directly to the
target and records what it wrote in the shared registry, so the cache is no longer
where installed state lives.

- A. Retire the bundle cache entirely. The extension hands the bundle to the shared lifecycle, which writes the target and records the installation; nothing is copied into extension global storage. Uninstall reads the shared registry, not a cache directory.
- B. Keep a download cache (the fetched archive) under the shared XDG cache location for offline reinstall, but retire the extracted-files copy and the sync-from-cache write. The archive cache is the shared foundation's concern, not the extension's.
- C. Keep the extracted-files cache for one release as a fallback that the extension reconciles against the target, then retire it. Two write paths coexist temporarily.
- X. Other (please specify)

[Answer]: A. Retire the bundle cache entirely. The extension hands the bundle to the shared lifecycle, which writes the target and records the installation; nothing is copied into extension global storage. Uninstall reads the shared registry, not a cache directory.

## Q2. How does the extension reach shared application data?

The extension currently reads and writes its cache and records under
`context.globalStorageUri.fsPath`. ADR-0005 says new `app`/shared code resolves
on-disk roots through the injected `AppStorage` port (XDG by default), never
through `globalStorageUri` directly. The shared registry U1 owns already uses
`AppStorage`.

- A. The extension resolves all shared application-data access through the injected `AppStorage` port, matching the CLI and the shared registry. `globalStorageUri` is used only for genuinely VS Code-local state (if any remains), and that exception is documented.
- B. The extension keeps using `globalStorageUri` for its own bookkeeping but routes only the shared registry and cache through `AppStorage`, accepting two storage roots.
- C. Keep `globalStorageUri` as the extension's storage root and have the shared foundation accept it as the `AppStorage` implementation the extension injects, so the extension's data stays where users' existing installs already are.
- X. Other (please specify)

[Answer]: A. The extension resolves all shared application-data access through the injected `AppStorage` port, matching the CLI and the shared registry. `globalStorageUri` is used only for genuinely VS Code-local state (if any remains), and that exception is documented.

## Q3. Where does the extension's installation record live now?

The extension has its own `RegistryManager`/`RegistryStorage` and an
`InstalledBundle` record. The shared registry (U1) is the single source of truth
for managed installations, keyed by bundle, target, scope, and repository
identity, with user-scope records in shared XDG data and repository-scope records
in the repository lockfile.

- A. The shared registry becomes the source of truth. The extension's registry manager becomes a thin read/write delegator over the shared registry; the extension-specific `InstalledBundle` shape is derived from the shared record for the views that need it. Existing extension records are imported once (as U2 does for the CLI user lockfile).
- B. The extension keeps its own registry as a cache/projection it rebuilds from the shared registry on activation, so the tree view and existing queries keep working unchanged while the shared registry stays authoritative.
- C. Keep the extension registry authoritative for the extension and have it write through to the shared registry, so both stay populated during the migration.
- X. Other (please specify)

[Answer]: A. The shared registry becomes the source of truth. The extension's registry manager becomes a thin read/write delegator over the shared registry; the extension-specific `InstalledBundle` shape is derived from the shared record for the views that need it. Existing extension records are imported once (as U2 does for the CLI user lockfile).

## Q4. How does a shared `conflict` outcome become a VS Code interaction?

The installer today prompts the user directly when a skill directory already
exists (`promptOverwriteSkill`). In the shared lifecycle, existing target content
is a `conflict` result kind, not an inline prompt — the shared layer does not ask
questions. So the decision moves out and the interaction stays in the adapter.

- A. The shared lifecycle returns `conflict` without writing; the extension maps it to the VS Code overwrite prompt, and on confirmation re-invokes the shared operation with an explicit overwrite decision. The shared layer never prompts.
- B. The extension pre-checks for existing content before calling the shared lifecycle, prompts if needed, and passes the decision on the first call, so `conflict` is rarely returned.
- C. Keep the installer's own overwrite prompt and existing-content handling for skills, and use the shared conflict result only for non-skill content.
- X. Other (please specify)

[Answer]: A. The shared lifecycle returns `conflict` without writing; the extension maps it to the VS Code overwrite prompt, and on confirmation re-invokes the shared operation with an explicit overwrite decision. The shared layer never prompts.

## Q5. What is the extension's user-facing result and progress reporting built from?

Every shared operation returns one of six result kinds (success, validation-error,
conflict, preserved-content, retryable-failure, safety-blocked). The extension
shows notifications, progress, and a registry tree that must reflect what
happened.

- A. VS Code notifications and the tree view are derived purely from the shared result kind and the shared registry — one mapping from kind to notification, and the tree reads the shared registry. The adapter adds no state of its own to decide messaging.
- B. The adapter keeps its own notion of success/failure for messaging (as today) and treats the shared result as advisory, so existing notification text is preserved verbatim.
- C. Derive notifications from the shared result kind, but keep a separate extension-side record of the last operation's detail for richer progress messages the shared result does not carry.
- X. Other (please specify)

[Answer]: A. VS Code notifications and the tree view are derived purely from the shared result kind and the shared registry — one mapping from kind to notification, and the tree reads the shared registry. The adapter adds no state of its own to decide messaging.

## Q6. Which extension surfaces are in this unit's scope?

The extension has three lifecycle commands (install, update, uninstall) plus a
large surface around them: the registry tree view, marketplace view,
auto-update/update-checker services, MCP config, and the bundle-installer and
registry-manager services. Activation-time migration is a separate unit (U4).

- A. The three lifecycle commands and the two services they drive (bundle-installer, registry-manager) only. Views and auxiliary services are adjusted only where the shared registry changes the data they read, and that adjustment is noted but not owned here.
- B. Those, plus the registry tree view and marketplace view, since they display installation state that now comes from the shared registry and would otherwise show stale data.
- C. Every extension surface that reads or writes the bundle cache, the extension registry, or the target tree, so no stale reader survives the unit.
- X. Other (please specify)

[Answer]: C. Every extension surface that reads or writes the bundle cache, the extension registry, or the target tree, so no stale reader survives the unit.


## Consolidated Summary Confirmation

These are the decisions I will build the U3 design artifacts from.

- **Bundle cache (Q1)** — retire the extension's extracted-files bundle cache
  entirely. The extension hands the bundle to the shared lifecycle, which writes
  the target and records the installation; nothing is copied into extension
  global storage, and uninstall reads the shared registry rather than a cache
  directory. This is the cache-then-sync retirement U3 owns.
- **Shared storage access (Q2)** — the extension resolves all shared
  application-data access through the injected `AppStorage` port, matching the CLI
  and the shared registry (ADR-0005). `globalStorageUri` is used only for
  genuinely VS Code-local state, if any remains, and that exception is documented.
- **Installation record (Q3)** — the shared registry becomes the source of truth.
  The extension's registry manager becomes a thin read/write delegator over the
  shared registry; the extension-specific `InstalledBundle` shape is derived from
  the shared record for the views that need it. Existing extension records are
  imported once, as U2 does for the CLI user lockfile (ADR-0001 strangler-fig).
- **Conflict interaction (Q4)** — the shared lifecycle returns `conflict` without
  writing; the extension maps it to the VS Code overwrite prompt and, on
  confirmation, re-invokes the shared operation with an explicit overwrite
  decision. The shared layer never prompts. This depends on a shared-foundation
  delta: normal install/update must detect pre-existing target content, return
  `conflict` rather than overwriting, and accept an overwrite decision on the
  request. U1's install workflow does not do this yet; the delta is recorded for
  the foundation repair at the stage decision.
- **Result and progress reporting (Q5)** — VS Code notifications and the registry
  tree view are derived purely from the shared result kind and the shared
  registry: one mapping from kind to notification, and the tree reads the shared
  registry. The adapter adds no state of its own to decide messaging.
- **Unit scope (Q6)** — every extension surface that reads or writes the bundle
  cache, the extension registry, or the target tree, so no stale reader survives
  the unit. That includes the three lifecycle commands, the bundle-installer and
  registry-manager services, and the registry tree and marketplace views that read
  installation state. Activation-time migration stays in U4.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
