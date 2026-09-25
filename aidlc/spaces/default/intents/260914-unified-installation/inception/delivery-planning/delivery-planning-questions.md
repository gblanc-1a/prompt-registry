# Delivery Planning Questions

## Sources

- `requirements.md` defines the shared lifecycle, migration safety, compatibility,
  and reviewable-delivery requirements (notably FR4.1: a design pull request
  followed by small, independently reviewable implementation pull requests).
- `components.md` defines the shared installation and migration components
  (ManifestGovernance, TargetRouting, InstallationRegistry, InstallationLifecycle,
  ExtensionMigrationCoordinator, and the MigrationCleanupJournal port).
- `unit-of-work.md` defines U1 (shared foundation, Large), U2 (CLI adapter),
  U3 (VS Code adapter), and U4 (activation migration, Large).
- `unit-of-work-dependency.md` defines the dependency graph: U2 and U3 depend on
  U1; U4 depends on U1 and U3.
- `contract-summary.md` defines the four repository-internal TypeScript boundary
  contracts and their typed lifecycle outcomes.

## Context: decisions carried forward from the earlier planning pass

We planned this stage once before, then went back to Domain Design to close the
migration-cleanup safety gap (the journaled destructive-cleanup boundary, now
designed via the `MigrationCleanupJournal` port). That fix is in place, so this
pass plans against the resolved design. The sequencing decisions you already
made still look sound and I am carrying them forward unless you change them:

- Build order is risk-first: the shared installation foundation (U1) first,
  then the CLI and VS Code adapters, then the activation-time migration last.
- The CLI adapter (U2) and the VS Code adapter (U3) both sit on top of U1 and
  can proceed once U1's contracts are stable.
- No external team, API, or approval window blocks the work; it is all inside
  this repository.
- Construction runs here in one session with the normal approval at each stage
  (no separate unit-owning teams).

These questions focus on the one thing that most needs your judgment: how to cut
the work into small, independently reviewable pull requests — the outcome you
asked for repeatedly.

## Q1. How small should the implementation pull requests be?

A **pull request (PR)** here is one reviewable change you merge on its own. U1
(shared foundation) and U4 (migration) are the two large Units. The choice is
how finely to split them so no single PR is hard to review.

- A. Component-level PRs: split each large Unit along its architectural components — e.g. U1 becomes separate PRs for manifest validation, target/scope routing, the installation registry, the install/update/uninstall lifecycle, and the target file-writer; U4 becomes separate PRs for legacy discovery and association, verified transfer, journaled cleanup, and conflict/consent handling. Adapters (U2, U3) stay one PR each.
- B. Unit-level PRs: one implementation PR per Unit (four PRs total plus the design PR).
- C. Behavior-slice PRs: cut across components by capability — e.g. "install works end to end," then "update/uninstall with preservation," then "migration transfer," then "migration cleanup" — each slice touching whatever layers it needs.
- D. Another decomposition; describe it.
- X. Other (please specify)

[Answer]: A. Component-level PRs: split each large Unit along its architectural components (U1 into manifest validation, target/scope routing, registry, lifecycle, and file-writer PRs; U4 into legacy discovery/association, verified transfer, journaled cleanup, and conflict/consent PRs); adapters U2 and U3 stay one PR each. (2026-09-18T15:56:48Z; **Mode:** guided)

## Q2. Should a design pull request come first, before any implementation PR?

FR4.1 calls for a design PR before implementation PRs. A design-first PR would
lock the four boundary contracts and the shared TypeScript type/port layout
(the open items Contract Design flagged) so the later implementation PRs stay
small and stable.

- A. Yes — a design/ADR PR first that fixes the shared contracts, type/port file layout, and the migration-cleanup journal states, then implementation PRs build on it.
- B. No separate design PR — fold the contract/type decisions into the first implementation PR (U1 foundation).
- C. Other (please specify)

[Answer]: A. Yes — a design/ADR PR first that fixes the shared contracts, type/port file layout, and the migration-cleanup journal states, then implementation PRs build on it. (2026-09-18T15:56:48Z; **Mode:** guided)

## Q3. Should the CLI adapter and VS Code adapter be separate, parallel-eligible PRs?

U2 (CLI) and U3 (VS Code) both depend only on U1 and not on each other, so once
U1 is in place they can be reviewed and merged independently.

- A. Keep them as two separate PRs that may proceed in parallel after U1, with a shared check that both entry points behave identically.
- B. Serialize them: land the CLI adapter first, then apply what we learn to the VS Code adapter.
- C. Combine both adapters into one PR.
- X. Other (please specify)

[Answer]: B. Serialize: land the CLI adapter first, then apply what we learn to the VS Code adapter. (2026-09-18T15:56:48Z; **Mode:** guided)

## Q4. Should the destructive migration cleanup be isolated in its own gated PR?

The riskiest change is deleting a user's legacy extension files after a verified
transfer. Isolating that behind its own PR (and its own review) keeps the
non-destructive transfer reviewable on its own and contains the blast radius.

- A. Yes — the non-destructive transfer (copy to the new location and verify) ships in one PR, and the destructive cleanup (journaled delete of the legacy copy) ships in a separate, separately reviewed PR.
- B. Keep the full migration (transfer plus verified cleanup) in one PR.
- C. Other (please specify)

[Answer]: A. Yes — the non-destructive transfer (copy to the new location and verify) ships in one PR, and the destructive cleanup (journaled delete of the legacy copy) ships in a separate, separately reviewed PR. (2026-09-18T15:56:48Z; **Mode:** guided)

## Q5. Are the carried-forward sequencing and staffing decisions still correct?

This confirms the items listed in the context above so they are recorded for
this pass.

- A. Yes — keep risk-first order (U1 foundation, then U2/U3 adapters, then U4 migration), no external blockers, and build here in one session with the normal per-stage approval.
- B. Mostly, but I want to change one thing (describe it).
- C. No — I want a different sequencing or staffing approach (describe it).
- X. Other (please specify)

[Answer]: A. Yes — keep risk-first order (U1 foundation, then U2/U3 adapters, then U4 migration), no external blockers, and build here in one session with the normal per-stage approval. (Refined by Q3: the CLI adapter lands before the VS Code adapter rather than in parallel.) (2026-09-18T15:56:48Z; **Mode:** guided)


## Q6. Where should the repository-rename reconciliation work land in the PR sequence?

Contract Design was amended after this stage last ran, to close a gap the
Functional Design review found: Contract 3 now declares the U1-owned
`MigrationCleanupJournalPort` (four typed operations, already covered by PR 6 and
PR 11) **and** a capability that has no PR yet — repository-rename
reconciliation. That capability has two halves in two different Units: U1 owns
the `reconcileRepositoryIdentity` registry operation that re-keys a record, and
U3 supplies the injected `RepositoryRedirectPort` that performs the one network
check. U1 stays offline-only; when the port is absent or unavailable the
reconciliation is skipped.

Per your component-level decision (Q1), the choice is how to cut this.

- A. Add a dedicated U1 PR in Bolt 1 for `reconcileRepositoryIdentity` (offline re-keying against a supplied candidate list, with the skip rules), and have Bolt 3's extension PR supply the `RepositoryRedirectPort`. The existing PR 13 keeps FR3.7 repository-scope migration parity as its own concern.
- B. Fold `reconcileRepositoryIdentity` into the existing registry PR (PR 3) and the port into Bolt 3's PR 8, adding no new PR.
- C. Defer the whole reconciliation capability to Bolt 4 and handle it inside PR 13 alongside repository-scope parity.
- X. Other (please specify)

[Answer]: A. Add a dedicated U1 PR in Bolt 1 for `reconcileRepositoryIdentity` (offline re-keying against a supplied candidate list, with the skip rules), and have Bolt 3's extension PR supply the `RepositoryRedirectPort`. PR 13 keeps FR3.7 repository-scope migration parity as its own concern.

## Consolidated Summary Confirmation

The existing risk-first plan, component-level PR boundaries, serialized adapters,
and separately reviewed destructive cleanup remain unchanged. This re-run adds
the latest Contract 3 safety details to the existing PR sequence:

1. **PR 0** locks the journal-entry ID/generation, single-use verification token,
   durable destination claim, and migration parity schemas.
2. **PR 3** implements the target/scope/destination ownership claim with
   pending-materialization and rollback-required recovery state.
3. **PR 6** owns the generation-bound journal token and transition validation
   contract.
4. **PR 12** uses U1's claim recovery and exact-generation token validation
   before migration cleanup; it remains the isolated destructive PR.
5. Migration transfer receives the same claim protocol and preserves legacy
   content on ownership conflict; U4 never gains a direct target-write path.

- Looks correct
- Request changes

[Answer]: Looks correct
