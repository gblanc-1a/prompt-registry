## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-22T16:25:00Z
**Iteration:** 1
**Class:** Advisory

### Context

Contract Design was re-entered by backward jump because a downstream Functional
Design review of unit `shared-installation-foundation` (U1) raised Critical
finding R-01: the approved Units Generation artifacts mandate that U1 own a
`MigrationCleanupJournal` port, schema, transition semantics, and persistence
boundary and expose it to U4, and the approved Q7 follow-up requires
repository-rename redirect reconciliation — but Contract 3 declared neither, so
both mandated responsibilities were uncallable. This review assessed the
amendment that makes them contractual (decisions: Q6 option A, Q7 option A).

Each finding below was raised against the first draft of the amendment and
repaired in the same iteration; the Required action column records the repair
that was applied.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | `contract-summary.md` > Contract 3 > `injected_ports` > `RepositoryRedirectPort` | The injected port was declared with only `name`, `supplied_by`, and `purpose` — no operation, input, or output — so the adapter required to supply it had no interface to implement. `RedirectResolution` was defined but referenced by no signature, while Contract 4's `MigrationInteractionPort` already set the convention for a consumer-supplied port. | Declared the port operation in Contract 4's style as `resolveRedirect: RepositoryRedirectQuery -> RedirectResolution`, and defined `RepositoryRedirectQuery` (`storedIdentity`, `candidateIdentity`) under `schemas`. | Resolved |
| R-02 | Major | Contract 3 > `injected_ports.supplied_by`; `## Ownership and compatibility rules` | Supplier and consumer did not line up: `supplied_by: [U2, U3]` told the CLI to supply a capability no contract lets it consume (Contract 1 declares no injected port and no reconcile operation), and nothing stated where an adapter-supplied port reaches U1 inside a U4-driven call. | Narrowed to `supplied_by: [U3]` and added a "Where the redirect port is wired" note naming the VS Code extension host as composition root, stating the CLI never reaches this operation. | Resolved |
| R-03 | Major | Contract 3 > `openCleanupJournalEntry` / `CleanupJournalEntryResult` | Open-or-resume was under-specified exactly where the journal exists to protect: no behaviour when a persisted entry names a different `legacySourceRoot` than the request (no mismatch kind), which would hand deletion authority for one legacy root to a transaction operating on another; and no statement of single-writer access while two extension hosts can activate concurrently. | Added the `source-root-mismatch` kind with an invariant granting it no deletion authority, plus an exclusivity invariant returning `retryable-failure` to a second concurrent holder. | Resolved |
| R-04 | Major | Contract 3 > reconciliation prose and `RepositoryReconciliationRequest`; vs `requirements.md` FR3.7 | Trigger and record class were unstated and collided with an approved acceptance criterion: the decision fires when a stored record matches no open workspace, yet the request required exactly one `currentIdentity` and never said who enumerates candidates or which record class may be re-keyed. FR3.7 requires a legacy installation with no matching workspace to be skipped, so an un-scoped re-key on the migration boundary could be read as authorising what FR3.7 forbids. | Request now takes `candidateIdentities[]` supplied by the caller (U1 enumerates nothing); invariants scope re-keying to U1 shared-registry `ManagedInstallation` records only, keep FR3.7 authoritative for legacy candidates, and resolve zero candidates or multiple confirmations to `skipped`. | Resolved |
| R-05 | Minor | Contract 3 > `CleanupJournalState.values` | Enum casing was snake_case while every other union in the document, including `CleanupArtifactState` in the same amendment, uses kebab-case. | Converted to `prepared`, `target-verified`, `legacy-delete-pending`, `committed`. | Resolved |
| R-06 | Minor | Contract 3 fenced block | Contract 3 was the only spec block without an `owner` key, while ownership is genuinely split across U1 and U4 and downstream stages read the machine-readable block. | Added an `owner:` map mirroring Contract 4: `shared-lifecycle-journal-and-reconciliation: U1`, `migration-policy-and-interaction: U4`. | Resolved |
| R-07 | Minor | Contract 3 schemas vs `components.md` | Upstream divergence was unreconciled: `components.md` models `MigrationCleanupJournal` as an external dependency of the U4 coordinator, and names `ManagedArtifact.installedHash` where the contract says `ArtifactFingerprint`. | Added a "Where the journal lives" note recording that `unit-of-work.md` supersedes the `components.md` placement, and mapped `ArtifactFingerprint` to `installedHash`. | Resolved |
| R-08 | Minor | Contract 3 > `CleanupJournalEntryResult`, `closeCleanupJournalEntry` | Two state-machine imprecisions: one result union served open, record, and read, so `absent` was a declared outcome of open and `entry` did not distinguish created from resumed; and no constraint said which states may be closed as `abandoned`, so abandoning from `legacy-delete-pending` would skip post-deletion absence verification. Per-artifact progress also implied undocumented self-transitions. | Split `entry` into `created`/`resumed` with per-operation notes, added an invariant permitting `abandoned` only from `prepared` or `target-verified`, and documented repeated `legacy-delete-pending` transitions as the per-artifact durability mechanism. | Resolved |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| required-sections | PASS — 9 meaningful H2 sections | Structural floor met; unchanged by the amendment. |
| YAML parse of all four `shared-schema` blocks | PASS — all four parse; every block now carries `owner` | The new `injected_ports`, operations, and schemas are well-formed. |
| Cross-reference resolution within Contract 3 | PASS — every type named in an operation signature is defined in the block or is a pre-existing document-level name; `RedirectResolution` is now reachable through `resolveRedirect` | The dangling-type defect behind R-01 is closed. |
| upstream-coverage | PASS — journal mandate from `unit-of-work.md` and `unit-of-work-dependency.md` satisfied; FR3.7 collision resolved; `components.md` divergence documented | Amendment is coherent with approved upstream. |
| linter, type-check | NOT APPLICABLE | The artifact carries only YAML-style spec blocks; no TS/JS. |

### Summary

The amendment resolves the upstream cause of downstream finding R-01. Contract 3
now declares `MigrationCleanupJournalPort` with four typed operations, the four
mandated states, and durability, exclusivity, containment, and resumption
invariants, so the U1-owned journal is genuinely callable by U4 and no mandated
capability remains unreachable. Repository-rename reconciliation is implementable
as declared: the injected `RepositoryRedirectPort` now has a callable signature
supplied by U3 with a stated composition root, `reconcileRepositoryIdentity` is
scoped to U1 shared-registry records with FR3.7 left authoritative for legacy
candidates, and U1's offline-only identity derivation is preserved because the
network capability is injected and optional. All eight findings are addressed by
localized edits inside Contract 3; the approved Q6 and Q7 decisions are
unchanged, and Contracts 1, 2, and 4 are untouched.
