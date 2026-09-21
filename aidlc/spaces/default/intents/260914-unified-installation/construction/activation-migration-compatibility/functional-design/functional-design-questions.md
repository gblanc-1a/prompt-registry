# Functional Design Questions — Activation Migration Compatibility (U4)

U4 owns the extension's one-time, activation-time migration of legacy
extension-managed installations onto the shared lifecycle: discovery, deterministic
target/scope association, conflict-safe transfer, journalled cleanup, and reporting
(FR3–FR3.8, NFR1.1, NFR2, NFR4). It is the bounded VS Code exception permitted to
touch legacy internal storage, and it calls U1 for every normal target write and
uses U1's `MigrationCleanupJournal` contract — it defines no second lifecycle and
no durable per-installation outcome state.

Much is already pinned upstream: U1 designed the `CleanupJournalEntry` /
`CleanupArtifactProgress` state machine, the transfer/verified-duplicate/conflict
flows, and the byte-verification rules; the requirements fixed the safety and
state-free reporting behaviour in detail. These questions settle the decisions
those left open, grounded in how the extension already runs migrations
(idempotent, at activation, tracked in `globalState` via `MigrationRegistry`,
non-fatal, tagged `@migration-cleanup(name)`).

## Q1. How does U4 discover legacy extension-managed installations?

Before the shared lifecycle existed, the extension wrote bundle content into a
cache under its global storage (`globalStorageUri/bundles/{bundleId}`) and recorded
installs in the extension registry. Legacy installations are what that left behind.

- A. Discover from the extension's own installation records (the pre-migration registry entries) as the authoritative list of what was installed, then locate each one's legacy files under the recorded install path. Records drive discovery; the filesystem confirms.
- B. Discover by scanning the legacy storage directory tree for bundle content, independent of any record, so installs whose record was lost are still found.
- C. Both: use records as the primary list and reconcile against a scan of the legacy directory, reporting any filesystem content with no record and any record with no content.
- X. Other (please specify)

[Answer]:

## Q2. How is the migration scheduled relative to activation and bundle commands?

FR3 requires migration inspection before any bundle command is handled; ASM3
assumes activation can inspect legacy data without blocking activation
indefinitely (the measured latency target is deferred to NFR Requirements, the
next stage). The extension today runs migrations inline during activate() and
treats failure as non-fatal.

- A. Run inspection-and-migration inline during activation before command handlers are registered, so no bundle command can run until migration has at least been attempted; keep it non-fatal (a failure preserves legacy data and does not block activation), and defer the latency bound to NFR Requirements.
- B. Gate only command handling on migration: register commands in a disabled state, run migration in the background, and enable each command as migration for its target completes, so activation returns fast.
- C. Run migration inline but time-boxed: attempt within a bounded window, and any installation not reached in time is left for the next activation to retry, with commands gated until the window closes.
- X. Other (please specify)

[Answer]:

## Q3. Reconcile the state-free requirement with the extension's existing migration tracking.

The extension's `MigrationRegistry` records in `globalState` that a named migration
has run, so it runs once. But FR3.4/FR3.5/NFR4 forbid durable per-installation
completion, failure, or conflict state: each activation must re-derive an
installation's result from the legacy and target content currently present, and an
installation "has no further work" only because its legacy source is absent.

- A. Do not use `MigrationRegistry` per installation at all. Each eligible activation re-derives every installation's state from current legacy+target content; "done" means the legacy source is gone (consumed by verified cleanup), not a recorded flag. The journal is the only persistence, and it exists only while a destructive operation is in flight.
- B. Use `MigrationRegistry` for a single coarse "migration feature has run once" flag to skip the whole pass on later activations, but derive per-installation state from content as in A. One global flag, no per-installation state.
- C. Keep per-installation completion in `MigrationRegistry` for speed, and treat FR3.4's "no durable state" as satisfied because `globalState` is extension-local rather than a migration-outcome file.
- X. Other (please specify)

[Answer]:

## Q4. What data determines the deterministic target and scope association (FR3.8)?

Before migrating, every legacy installation must map to exactly one target and
scope, using the persisted legacy scope and a versioned mapping over the legacy
record's attributes (provenance, manifest item kinds), never the current user
selection or an implicit default. Ambiguous or unsupported data means skip-and-report.

- A. A versioned association table keyed on the legacy record's stored fields — its persisted scope, its recorded target type or provenance, and the item kinds it installed — producing exactly one supported target layout or a skip. The table version is recorded so the mapping can evolve without re-reading a durable per-installation outcome.
- B. Infer the target from where the legacy files physically sit (which base directory the content occupies), matching that path against the known target layouts.
- C. Both: use the association table as authoritative and use the physical location as a cross-check, skipping when they disagree.
- X. Other (please specify)

[Answer]:

## Q5. How is repository-scope legacy content associated with a workspace (FR3.7)?

Repository-scope migration runs only when activation can tie a legacy record's
recorded repository identity to exactly one open workspace folder; with none,
several, or an unresolvable identity, the installation is left untouched and
reported skipped. This reuses U1's offline repository-identity derivation and its
reconciliation port for redirects.

- A. Derive each open workspace folder's repository identity with U1's offline derivation, match the legacy record's stored identity against them, and proceed only on exactly one match; zero, many, or unresolved → skip-and-report. Use U1's reconciliation port only when a stored identity matches no open folder.
- B. Ask the user to pick the workspace folder when the match is ambiguous, rather than skipping.
- C. Match on workspace root path only, ignoring remote-URL identity, so a moved or renamed repository is treated as a new one.
- X. Other (please specify)

[Answer]:

## Q6. What is the `@migration-cleanup` extraction boundary for this unit?

The unit note requires compatibility code to be tagged `@migration-cleanup(name)`
for later removal, and U1's journal contract is deliberately shaped so nothing about
it is structurally migration-specific — leaving generalisation to ordinary uninstall
as a later non-breaking move. This question fixes what is tagged as temporary versus
what is durable shared surface.

- A. Tag only the extension-internal legacy concerns as temporary: legacy-root discovery, the legacy record reading, and the association table. The journal usage and transfer calls go through U1's durable contracts and are not tagged, since they are not migration-specific.
- B. Tag the entire U4 unit as `@migration-cleanup(activation-migration)`, so the whole activation-migration path is removed wholesale once migration is universally complete.
- C. Tag the legacy-internal concerns (as A) and additionally record a follow-up to generalise the journal to ordinary uninstall, so the tag set names both what is removed and what is promoted.
- X. Other (please specify)

[Answer]:
