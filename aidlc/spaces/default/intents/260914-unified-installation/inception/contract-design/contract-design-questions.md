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

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct