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

[Answer]: X - You should care not about what is in the cache but about which symlink (or copy) are actually existing in the current target of the extension. Because cache could be present but symlink could have been deleted.

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

[Answer]: X - Keep it as simple as possible it should be fast what is the simplest solution ?

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

[Answer]: Do not use `MigrationRegistry` per installation at all. Each eligible activation re-derives every installation's state from current legacy+target content; "done" means the legacy source is gone (consumed by verified cleanup), not a recorded flag. The journal is the only persistence, and it exists only while a destructive operation is in flight.

## Q4. What data determines the deterministic target and scope association (FR3.8)?

Before migrating, every legacy installation must map to exactly one target and
scope, using the persisted legacy scope and a versioned mapping over the legacy
record's attributes (provenance, manifest item kinds), never the current user
selection or an implicit default. Ambiguous or unsupported data means skip-and-report.

- A. A versioned association table keyed on the legacy record's stored fields — its persisted scope, its recorded target type or provenance, and the item kinds it installed — producing exactly one supported target layout or a skip. The table version is recorded so the mapping can evolve without re-reading a durable per-installation outcome.
- B. Infer the target from where the legacy files physically sit (which base directory the content occupies), matching that path against the known target layouts.
- C. Both: use the association table as authoritative and use the physical location as a cross-check, skipping when they disagree.
- X. Other (please specify)

[Answer]: Migrate bundle associated to the current IDE only. For example if we are in Kiro only bundle installed at user level in the globalStorage should be migrated and only if symlink are targeting them from the installation place. Same for vscode or vscode insiders

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

[Answer]: X. Migration should only affect element installed at user level so it should not be associated to any workspace, since those installed at repository level should be handled via lockfile and we do not care about the temporary cache.

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

[Answer]: B. Tag the entire U4 unit as `@migration-cleanup(activation-migration)`, so the whole activation-migration path is removed wholesale once migration is universally complete.


## Q7. Follow-up to Q2 — the simplest fast scheduling

You asked for the simplest fast solution. Given Q3 (state-free, re-derived from
disk each activation), the migration is a **no-op in the common case**: once an
installation has been migrated its legacy source is gone, so re-derivation finds
nothing to do and returns immediately. That makes the simplest option also the
fast one.

Proposed: run inspection-and-migration **inline during activation, before command
handlers are registered**, non-fatal (a failure preserves legacy data and never
blocks activation), with **no time-box** — because after the first successful run
there is nothing left to scan. Defer any measured latency bound to NFR
Requirements (the next stage). This is option A from Q2, chosen as the simplest.

- A. Yes — inline, before command handlers, non-fatal, no time-box; the common case is a no-op so it stays fast.
- B. No — I want the background-gated or time-boxed variant after all (say which).
- X. Other (please specify)

[Answer]: A

## Q8. Confirm dropping repository-scope migration (overrides FR3.7)

Your Q5 answer scopes migration to user-level content only, on the grounds that
repository-scope installs live in the committed lockfile and need no migration from
the temporary cache. That is a deliberate **override of FR3.7**, which as written
requires repository-scope migration parity (discover a legacy repo-scope install,
associate it to a unique open workspace, and apply the same transfer/cleanup rules).

I will encode "repository-scope migration is out of scope; repository installs are
carried by the committed lockfile and never migrated from the extension cache" and
record it as a requirements deviation to raise at the stage gate — unless you'd
rather keep FR3.7.

- A. Confirmed — drop repository-scope migration; user-level only. Record the FR3.7 deviation for the gate.
- B. Keep FR3.7 — repository-scope migration stays in U4 as the requirement specifies.
- X. Other (please specify)

[Answer]: A

## Q9. Confirm the FR3.8 association simplification

Your Q4 answer replaces the versioned association table (over provenance and item
kinds) with a much simpler rule: migrate only bundles for the **current IDE the
extension is running as** (vscode, vscode-insiders, kiro, …), at **user scope**,
and **only where the target install place still has a live symlink or copy** into
the legacy cache. Discovery (Q1) is driven by those live target links, not by cache
contents or records.

This is simpler and matches how the extension actually installs (confirmed: skills
are symlinked into the target, cache alone is not "installed"). It reinterprets
FR3.8's "versioned migration mapping over the legacy record's attributes" as "the
current running target + user scope," which I will record as a deviation for the
gate.

- A. Confirmed — associate to the current IDE + user scope, discover from live target links, skip anything else. Record the FR3.8 reinterpretation for the gate.
- B. Keep the versioned association table as FR3.8 specifies.
- X. Other (please specify)

[Answer]: A


## Consolidated Summary Confirmation

These are the decisions I will build the U4 design artifacts from. Two of them
narrow the approved requirements and are recorded as deviations to raise at the
stage gate.

- **Discovery (Q1)** — driven by what is actually deployed at the current target,
  not by cache contents or records. U4 inspects the target install place for live
  symlinks (or copies) that resolve into the legacy extension cache; a bundle with
  no live target link has nothing to migrate even if cache bytes remain. The cache
  is evidence of the source, never proof of an install.
- **Scheduling (Q2, Q7)** — inline during activation, before command handlers are
  registered, so no bundle command runs before migration is attempted. Non-fatal:
  a failure preserves legacy data and never blocks activation. No time-box; once an
  installation is migrated its legacy source is gone, so later activations
  re-derive nothing and return immediately. Any measured latency bound is deferred
  to NFR Requirements.
- **State-free (Q3)** — no per-installation tracking in `MigrationRegistry` or any
  durable outcome store. Each eligible activation re-derives every installation's
  state from the legacy source and current target content; "no further work" means
  the legacy source is absent (consumed by verified cleanup). U1's cleanup journal
  is the only persistence and exists only while a destructive cleanup is in flight.
- **Association (Q4, Q9)** — migrate only bundles for the **current IDE the
  extension is running as** (e.g. vscode, vscode-insiders, kiro), at **user scope**,
  and only where the target install place still has a live symlink/copy into the
  legacy cache. This replaces FR3.8's versioned attribute-mapping table with
  "current running target + user scope," and matches how the extension actually
  installs. **Recorded deviation from FR3.8** (versioned association table) for the
  gate.
- **Repository scope (Q5, Q8)** — **out of scope.** Repository-scope installs are
  carried by the committed repository lockfile and are never migrated from the
  extension cache. **Recorded deviation from FR3.7** (repository-scope migration
  parity) for the gate.
- **Cleanup boundary (Q6)** — the entire U4 unit is tagged
  `@migration-cleanup(activation-migration)` for wholesale removal once migration
  is universally complete.
- **Unchanged, inherited from U1 and the requirements** — every target write and
  the transfer go through U1's shared lifecycle and `MigrationCleanupJournal`
  contract; target content is authoritative and overwrite needs explicit user
  consent (the shared `OverwriteDecision`); legacy deletion requires identity +
  byte verification then post-delete absence; and unsafe, ambiguous, declined, or
  failed transitions preserve legacy data and report from the current run.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
