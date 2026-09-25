# Contract Design Questions

## Sources

- `unit-of-work.md` and `unit-of-work-dependency.md` define U1 through U4 and
  their technical boundaries.
- `components.md` defines the shared lifecycle, state, routing, and migration
  ownership.
- `requirements.md` defines validation, recovery, and Clean Architecture
  constraints.

## Q1. Which external API surface should this architecture expose?

The approved deployment model uses an embedded shared library with CLI and VS
Code delivery adapters, rather than a standalone service. The required
boundaries are U1-to-U2, U1-to-U3, U1-to-U4, and U3-to-U4.

- A. Expose no network or public API; formalize only in-process shared-package
  contracts used by the CLI and VS Code adapters.
- B. Add a public REST API for lifecycle operations.
- C. Add an event/message API for lifecycle operations.
- X. Other (please specify)

[Answer]: A. Expose no network or public API; formalize only in-process shared-package contracts used by the CLI and VS Code adapters.

## Q2. What mechanism should define the inter-unit contracts?

- A. Versioned TypeScript shared schemas and port interfaces, called in process.
- B. JSON schemas serialized across an internal process boundary.
- C. REST/HTTP contracts between all units.
- X. Other (please specify)

[Answer]: A. Versioned TypeScript shared schemas and port interfaces, called in process.

## Q3. Who owns each contract and its compatibility policy?

- A. U1 owns shared lifecycle schemas and ports; U2/U3 own input/output
  translation; U4 owns temporary migration interaction schemas. Additive fields
  are backward compatible and breaking changes require coordinated updates.
- B. Each delivery adapter owns its own copy of lifecycle schemas.
- C. A new shared service owns all contracts.
- X. Other (please specify)

[Answer]: A. U1 owns shared lifecycle schemas and ports; U2/U3 own input/output translation; U4 owns temporary migration interaction schemas. Additive fields are backward compatible and breaking changes require coordinated updates.

## Q4. How should contract failures cross unit boundaries?

- A. Return typed success, validation, conflict, preserved-content, retry, and
  safety outcomes; adapters map them to CLI output or VS Code interaction.
- B. Throw delivery-specific errors from U1 for each adapter to render.
- C. Automatically retry every error in the shared lifecycle.
- X. Other (please specify)

[Answer]: A. Return typed success, validation, conflict, preserved-content, retry, and safety outcomes; adapters map them to CLI output or VS Code interaction.

## Q5. What versioning policy should apply to the temporary migration boundary?

- A. Keep U4's mapping and interaction contracts internal and versioned with the
  extension; mark compatibility code for extraction, while U1 schemas follow
  package-semver compatibility rules.
- B. Publish the migration contract as a public API immediately.
- C. Leave migration contract changes unversioned until cleanup.
- X. Other (please specify)

[Answer]: X. Other (please specify): Keep all contracts internal to the repository. Evolve U1, U2, U3, and U4 through coordinated changes, using TypeScript compilation and tests to enforce compatibility. Do not promise public semver compatibility for intermediate layers.

## Q6. How should Contract 3 expose the U1-owned migration cleanup journal to U4?

Units Generation mandates that U1 own the `MigrationCleanupJournal` port, schema, transition semantics, and persistence boundary, and expose it to U4 across the U1-to-U4 boundary (unit-of-work.md, unit-of-work-dependency.md, story map). Contract 3 currently declares no journal port or journal operation, so the mandated responsibility is uncallable (review finding R-01) and U4 cannot drive the restart-safe cleanup state machine through the approved boundary.

- A. Add a U1-owned `MigrationCleanupJournalPort` to Contract 3 with typed operations that let U4 drive the state machine while U1 guarantees durability: open-or-resume an entry for an installation key, durably record each transition (`prepared` -> `target_verified` -> `legacy_delete_pending` -> `committed`) before the filesystem action it authorises, read the current entry for resumption, and close (delete) a committed or abandoned entry. The journal describes one in-flight destructive operation and is deleted at commit, so it is not a durable reporting record.
- B. Add the journal as a shared data schema only (no operations); leave U4 to persist and transition it directly.
- C. Move journal ownership to U4 entirely and drop the U1 mandate.
- X. Other (please specify)

[Answer]: A. Add a U1-owned `MigrationCleanupJournalPort` to Contract 3 with typed open-or-resume, durable-transition, read-for-resumption, and close operations.

## Q7. How should Contract 3 make the confirmed repository-rename reconciliation implementable?

The approved Q7 follow-up decided: when a stored record matches no open workspace, resolve the redirect over the network, confirm the old canonical URL now points at the current one, then re-key the record; when offline, skip and leave the record untouched (BR6.1, BR6.2). Contract 3 exposes no port or operation for this, so the decision is declared unimplementable (review finding R-01). U1's identity derivation is offline-only by design (BR3.2), so the network capability must be injected rather than performed inside U1's core.

- A. Add an injected `RepositoryRedirectPort` (network capability: does old canonical URL now redirect to the current one) supplied by the delivery adapters, plus a U1-owned `reconcileRepositoryIdentity` registry operation that re-keys a `ManagedInstallation` from the old identity to the new one. U1 stays offline-pure and testable; the port returns "unavailable" offline and reconciliation is skipped.
- B. Perform the network redirect check inside U1 directly (drop the offline-only identity constraint).
- C. Assign repository-rename reconciliation to U4 rather than U1.
- X. Other (please specify)

[Answer]: A. Add an injected `RepositoryRedirectPort` supplied by the delivery adapters, plus a U1-owned `reconcileRepositoryIdentity` registry operation that re-keys a record from the old identity to the new one; U1 stays offline-pure and skips when the port is unavailable.

## Q8. How should Contract 3 make the journal transition to `target-verified` enforceable? (review finding R-01)

The adversarial review of Functional Design found that `CleanupTransitionRequest` carries only `installationKey`, `targetState`, and optional artifact progress. Nothing forces U1 to re-run full current-byte verification before the `prepared` -> `target-verified` transition, so U4 could request `target-verified` and then drive legacy deletion without the U1-owned journal boundary being able to enforce the verification prerequisite (NFR1.1, NFR2).

- A. U1 performs and persists the full target/legacy verification as part of the `prepared` -> `target-verified` transition itself: `recordCleanupTransition` for that target state internally calls `verifyManagedArtifacts` over the entry's artifacts against current bytes, refuses the transition (typed `validation-error`/`safety-blocked`) when any artifact is absent, different, or unsafe, and only persists `target-verified` on a full pass. U4 cannot assert verification; it can only request the transition.
- B. U4 passes a verification result token that U1 validates against the exact journal entry, artifact set, and a fresh current-read before accepting the transition; U1 rejects an absent, stale, altered, or mismatched token.
- C. Keep the transition as-is and rely on U4 discipline to verify first.
- X. Other (please specify)

[Answer]: B. U4 passes a verification result token that U1 validates against the exact journal entry, artifact set, and a fresh current-read before accepting the transition; U1 rejects an absent, stale, altered, or mismatched token.

## Q9. How should the shared lifecycle prevent one installation from overwriting a destination another installation already manages? (review finding R-02)

The review found the lifecycle reads only the prior record for the selected installation key, so its changed-content check protects only destinations that record already owns. No rule detects a governed destination already managed by a *different* bundle at the same target and scope, so a second install could overwrite another installation's file and leave its record and fingerprint intact.

- A. Add a registry-wide destination-ownership invariant plus a collision query scoped to the resolved target and scope. Before every write, U1 rejects (typed `conflict`) a destination owned by a different installation unless an explicit, defined ownership hand-off is supplied; records and artifacts update atomically so one installation can never overwrite or silently orphan another's managed content.
- B. Add only a read-time collision query that warns but still writes.
- C. Take no cross-installation ownership measure; keep per-key checks only.
- X. Other (please specify)

[Answer]: A. Add a registry-wide destination-ownership invariant and a target-and-scope-scoped collision query; reject a cross-installation destination conflict unless an explicit ownership hand-off is supplied, with atomic record/artifact updates.

## Q10. Should `ManagedInstallation` carry explicit `target` and `scope` as contractual identity attributes? (review finding R-03)

The review found the U1 managed-installation identity is contractually an opaque `installationKey`, although the component catalogue and Contract 3 treat target and scope as part of the identity and every workflow relies on them. An opaque key forces each adapter to reverse-engineer key contents to specify persistence, collision handling, and recovery.

- A. Make `target` and `scope` required attributes of `ManagedInstallation` (and model their relationships to `SupportedTarget` and `InstallationScope`), align `installationKey` derivation with those explicit values, and use them in lookup, persistence, collision, update, uninstall, and journal/recovery specifications.
- B. Keep the opaque key and document its internal composition in prose only.
- C. Make no change.
- X. Other (please specify)

[Answer]: A. Make target and scope required managed-installation attributes with modelled relationships and align key derivation and all dependent specifications to them.

## Q11. How should a verification token bind to exactly one cleanup journal entry? (review finding R-01)

`VerificationResultToken` currently carries an installation key and artifact
fingerprints, but two cleanup operations for the same installation can have the
same values. U1 therefore cannot distinguish a token minted for a closed entry
from one minted for the current live entry. The transition also says a token must
be unexpired without defining the condition.

- A. Give every `CleanupJournalEntry` an immutable `entryId` and monotonically
  increasing `generation`. `VerificationRequest`, `VerificationResultToken`, and
  `CleanupTransitionRequest` carry both values. A token is valid only for the
  exact live entry/generation and one `prepared -> target-verified` attempt; it
  expires as soon as that transition succeeds, the entry changes generation, or
  the entry closes. U1 still performs the fresh full-set read before transition.
- B. Keep only the installation key and add a fixed five-minute token expiry.
- C. Persist the prior token on the installation record and treat it as reusable
  until cleanup commits.
- X. Other (please specify)

[Answer]: A. Give every CleanupJournalEntry an immutable entryId and monotonically increasing generation; bind VerificationRequest, VerificationResultToken, and CleanupTransitionRequest to both; make the token valid only for the exact live entry/generation and one prepared-to-target-verified attempt, while U1 still performs a fresh full-set read.

## Q12. How should U1 make destination ownership atomic across concurrent installs? (review finding R-02)

A separate ownership query followed by a target write lets two installers both
observe an unowned destination, then both write it. A hand-off can also change
target bytes before the ceding and acquiring records update, leaving ownership
inconsistent after a crash.

- A. Add a durable `DestinationOwnershipClaim` keyed by `(target, scope,
  destinationPath)`. One registry transaction atomically validates current
  ownership and any hand-off, creates or transfers the claim, and records a
  pending materialization generation. The target write is bound to that claim;
  read-back verification finalizes ownership. Failed or interrupted writes leave
  a recoverable pending claim that blocks competing writes until rollback or
  verified completion.
- B. Use an in-memory lock around the existing query/write sequence.
- C. Keep the query and rely on delivery adapters to serialize installs.
- X. Other (please specify)

[Answer]: A. Add a durable DestinationOwnershipClaim keyed by target, scope, and destinationPath; atomically validate or transfer ownership and record pending materialization; bind the target write to the claim; finalize only after read-back verification; preserve a recoverable pending claim after failure or interruption.

## Q13. How should migration writes receive the same destination-ownership protection? (review finding R-03)

Contract 3 currently lets U4 call `transferThroughLifecycle` with an overwrite
decision but provides neither a destination hand-off nor an explicit guarantee
that migration writes use the shared ownership rule.

- A. Add optional `DestinationOwnershipHandoff` to `MigrationTransferRequest`
  and require `transferThroughLifecycle` to run the same U1 claim protocol as
  install and update. It returns `preserved-conflict` when another installation
  owns the destination and no valid hand-off is present; U4 preserves legacy
  content and surfaces the conflict.
- B. Keep hand-off out of Contract 3 and state only that U4 should avoid known
  collisions.
- C. Let U4 write directly to resolve ownership conflicts before calling U1.
- X. Other (please specify)

[Answer]: A. Add optional DestinationOwnershipHandoff to MigrationTransferRequest and require transferThroughLifecycle to use the same U1 claim protocol, returning preserved-conflict when another installation owns the destination and no valid hand-off is supplied.

## Consolidated Summary Confirmation

The previously confirmed Q1–Q10 decisions remain unchanged. The confirmed
additions are:

1. Every cleanup entry has an immutable `entryId` and monotonically increasing
   `generation`; verification requests, results/tokens, and transition requests
   bind to both. A token is single-attempt evidence for the exact live generation
   and expires after a successful transition, generation change, or close.
2. Destination ownership uses a durable claim keyed by target, scope, and
   destination path. One registry transaction validates or transfers ownership,
   records pending materialization, and blocks competitors; read-back verifies
   and finalizes the claim, while interrupted work remains recoverable.
3. Migration transfer accepts an optional ownership hand-off and always uses the
   same U1 claim protocol. A destination another installation owns returns
   `preserved-conflict` without a valid hand-off, preserving legacy content.

- Looks correct
- Request changes

[Answer]: Looks correct