# Contract Summary

## Contract scope

This design has no network API, public service, or externally consumed package
contract. The four contracts below are synchronous, in-process TypeScript
agreements inside the repository. The CLI and VS Code extension are delivery
adapters that consume the shared application lifecycle; they do not publish the
intermediate layers as independent products.

The contracts are derived from:

- `aidlc/spaces/default/intents/260914-unified-installation/inception/units-generation/unit-of-work.md`
- `aidlc/spaces/default/intents/260914-unified-installation/inception/units-generation/unit-of-work-dependency.md`
- `aidlc/spaces/default/intents/260914-unified-installation/inception/domain-design/components.md`
- `aidlc/spaces/default/intents/260914-unified-installation/inception/requirements-analysis/requirements.md`

## Contract overview

| # | Provider Unit | Consumer | Mechanism | Owner |
| --- | --- | --- | --- | --- |
| 1 | U1 Shared installation foundation | U2 CLI manifest adoption | Synchronous in-process TypeScript schemas and ports | U1 |
| 2 | U1 Shared installation foundation | U3 VS Code shared-lifecycle adoption | Synchronous in-process TypeScript schemas and ports | U1 |
| 3 | U1 Shared installation foundation | U4 Activation migration compatibility | Synchronous in-process lifecycle, governance, routing, registry, artifact-store, and cleanup-journal ports | U1 for shared lifecycle, journal, and reconciliation contracts; U4 for temporary migration interaction contracts |
| 4 | U3 VS Code shared-lifecycle adoption | U4 Activation migration compatibility | Synchronous activation and command-readiness boundary | U3 for readiness composition; U4 for migration outcomes and temporary interaction contracts |

## Contract 1: U1 to U2 shared lifecycle

U1 exposes the normal manifest-driven install, update, and uninstall use cases.
U2 translates CLI arguments into shared request types and translates typed
results into CLI output and exit behavior. U2 does not implement target writes,
managed-artifact cleanup, or lifecycle policy.

```shared-schema
contract: u1-to-u2-shared-lifecycle
protocol: synchronous-in-process-typescript
provider: U1 shared-installation-foundation
consumer: U2 cli-manifest-adoption
owner: U1
operations:
  - name: install
    input: InstallRequest
    output: LifecycleResult
  - name: update
    input: UpdateRequest
    output: LifecycleResult
  - name: uninstall
    input: UninstallRequest
    output: LifecycleResult
  - name: queryDestinationOwnership
    input: DestinationOwnershipQuery
    output: DestinationOwnershipResult
    notes:
      - The registry-wide collision query (R-02). The lifecycle runs it internally before every write; it is also exposed so an adapter can pre-check a target and scope. It reports every destination among the queried set that a different installation already manages.
schemas:
  InstallRequest:
    required: [bundle, target, scope]
    fields:
      bundle: GovernedBundleSource
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
      destinationOwnershipHandoff: DestinationOwnershipHandoff?
  UpdateRequest:
    required: [bundle, target, scope]
    fields:
      bundle: GovernedBundleSource
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
      destinationOwnershipHandoff: DestinationOwnershipHandoff?
  UninstallRequest:
    required: [bundleId, target, scope]
    fields:
      bundleId: BundleId
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
  ManagedInstallationIdentity:
    required: [bundleId, target, scope]
    fields:
      bundleId: BundleId
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
    notes:
      - The installation key is derived from these fields; target and scope are explicit identity attributes, not opaque key contents (R-03).
      - A persistence adapter may leave implicit only what its own storage location already fixes (for example, the repository a lockfile lives in).
  DestinationOwnershipHandoff:
    required: [destinationPath, cedingInstallation]
    fields:
      destinationPath: DestinationPath
      cedingInstallation: ManagedInstallationIdentity
    notes:
      - The explicit, caller-supplied authority that lets one installation take over a governed destination another installation currently manages.
      - Without it, a cross-installation destination collision returns conflict; it never silently overwrites.
  DestinationOwnershipQuery:
    required: [destinationPaths, target, scope]
    fields:
      destinationPaths: DestinationPath[]
      target: SupportedTarget
      scope: InstallationScope
  DestinationOwnershipResult:
    fields:
      conflicts: DestinationOwnershipConflict[]
  DestinationOwnershipConflict:
    required: [destinationPath, owningInstallation]
    fields:
      destinationPath: DestinationPath
      owningInstallation: ManagedInstallationIdentity
  LifecycleResult:
    discriminant: kind
    kinds:
      - success
      - validation-error
      - conflict
      - preserved-content
      - retryable-failure
      - safety-blocked
invariants:
  - ManifestGovernance validates one root deployment-manifest.yml and canonical items[] before writes.
  - TargetRouting derives destinations from target, scope, and item kind.
  - InstallationRegistry isolates state by bundle, target, scope, and repository identity, and target and scope are explicit identity attributes of ManagedInstallation (R-03).
  - InstallationLifecycle verifies binary writes before returning success.
  - Registry-wide destination ownership (R-02): before any write, the lifecycle runs a DestinationOwnershipQuery scoped to the resolved target and scope. A destination owned by a different installation returns conflict unless a matching DestinationOwnershipHandoff is supplied; on hand-off, the ceding installation's record and the acquiring installation's record and artifacts update atomically so neither is left with a stale or orphaned managed destination.
  - U2 never adds a CLI-specific target-write path.
```

## Contract 2: U1 to U3 shared lifecycle

U1 exposes the same lifecycle contract to the VS Code adapter. U3 translates
extension command inputs, workspace context, notifications, and user-facing
messages around the shared result. U3 does not reopen cached content for an
independent target sync and does not duplicate lifecycle policy.

```shared-schema
contract: u1-to-u3-shared-lifecycle
protocol: synchronous-in-process-typescript
provider: U1 shared-installation-foundation
consumer: U3 vscode-shared-lifecycle-adoption
owner: U1
operations:
  - name: install
    input: InstallRequest
    output: LifecycleResult
  - name: update
    input: UpdateRequest
    output: LifecycleResult
  - name: uninstall
    input: UninstallRequest
    output: LifecycleResult
  - name: queryDestinationOwnership
    input: DestinationOwnershipQuery
    output: DestinationOwnershipResult
    notes:
      - Same registry-wide destination collision query as Contract 1 (R-02); the schemas are the shared U1 types.
consumer_translation:
  input:
    - VS Code command arguments
    - active workspace and repository identity
    - explicit target and scope selection
  output:
    - VS Code notifications
    - conflict or consent interaction where the contract requires it
    - command result and diagnostic mapping
invariants:
  - User-scope shared cache and registry use the shared XDG application-storage ports.
  - Repository-scope records remain in the selected repository.
  - Target content is isolated by target and scope, and target and scope are explicit ManagedInstallation identity attributes (R-03).
  - The same registry-wide destination-ownership rule (R-02) applies to VS Code installs and updates: a destination owned by a different installation returns conflict unless an explicit DestinationOwnershipHandoff accompanies the request.
  - U3 may compose VS Code behavior but cannot change LifecycleResult semantics.
```

## Contract 3: U1 to U4 migration support

U4 owns legacy discovery and migration policy during activation, but U1 remains
the only normal target-write lifecycle. U4 consumes U1's validation, routing,
registry, lifecycle, and target-artifact contracts to transfer or compare
content. U4 supplies temporary migration interaction behavior and maps its
results into the extension summary.

U1 also owns the `MigrationCleanupJournal` port, schema, transition semantics,
and persistence boundary, as required by the unit definition. U4 drives the
cleanup transaction through that port; U1 guarantees each transition is durable
before the filesystem action it authorises. The journal describes one
destructive operation in flight and is deleted when that operation commits, so
it is never a durable per-installation reporting record.

Repository-rename reconciliation is likewise callable rather than implied. U1's
own identity derivation stays offline (no network call inside the shared core),
so the network capability is an injected port and re-keying a record is a
U1-owned registry operation.

Two placement notes, because both were ambiguous before this amendment:

- **Where the redirect port is wired.** `RepositoryRedirectPort` is supplied by
  U3 only, and reconciliation is reachable solely through the activation
  migration boundary. The VS Code extension host is the composition root: it
  constructs the port and passes it with the rest of U1's injected ports when it
  drives U4. U2 supplies no such port and Contract 1 declares none, so the CLI
  never reaches this operation.
- **Where the journal lives.** `components.md` models
  `MigrationCleanupJournal` as an external dependency of the U4 coordinator.
  `unit-of-work.md` supersedes that placement: the port, schema, transition
  semantics, and persistence boundary are U1's, and U4 owns only the transaction
  that drives them. Code Generation follows `unit-of-work.md`.

`ArtifactFingerprint` is the shared name for the value `components.md` calls
`ManagedArtifact.installedHash`; it covers the exact byte sequence written to
the target.

```shared-schema
contract: u1-to-u4-migration-support
protocol: synchronous-in-process-typescript
provider: U1 shared-installation-foundation
consumer: U4 activation-migration-compatibility
shared_ports:
  - ManifestGovernancePort
  - TargetRoutingPort
  - InstallationRegistryPort
  - InstallationLifecyclePort
  - TargetArtifactStorePort
  - MigrationCleanupJournalPort
owner:
  shared-lifecycle-journal-and-reconciliation: U1
  migration-policy-and-interaction: U4
injected_ports:
  - name: RepositoryRedirectPort
    supplied_by: [U3]
    purpose: Optional network capability used only to confirm a repository rename; absent or unavailable means reconciliation is skipped.
    operations:
      - resolveRedirect: RepositoryRedirectQuery -> RedirectResolution
operations:
  - name: validateGovernedBundle
    input: GovernedBundleSource
    output: ValidationResult
  - name: resolveInstallationAddress
    input: InstallationAddressRequest
    output: AddressResult
  - name: readManagedInstallation
    input: InstallationKey
    output: ManagedInstallationResult
  - name: transferThroughLifecycle
    input: MigrationTransferRequest
    output: MigrationTransferResult
  - name: verifyManagedArtifacts
    input: VerificationRequest
    output: VerificationResult
    notes:
      - On an allVerified result it also mints a VerificationResultToken bound to the installation key, the verified artifact set and fingerprints, and the observed read; U4 passes that token back on the target-verified transition (R-01).
  - name: openCleanupJournalEntry
    input: CleanupJournalOpenRequest
    output: CleanupJournalEntryResult
  - name: recordCleanupTransition
    input: CleanupTransitionRequest
    output: CleanupJournalEntryResult
  - name: readCleanupJournalEntry
    input: InstallationKey
    output: CleanupJournalEntryResult
  - name: closeCleanupJournalEntry
    input: CleanupJournalCloseRequest
    output: CleanupJournalCloseResult
  - name: reconcileRepositoryIdentity
    input: RepositoryReconciliationRequest
    output: RepositoryReconciliationResult
schemas:
  MigrationTransferRequest:
    required: [source, target, scope, bundleIdentity]
    fields:
      source: LegacyInstallationSource
      target: SupportedTarget
      scope: InstallationScope
      bundleIdentity: BundleIdentity
      overwriteDecision: OverwriteDecision?
  MigrationTransferResult:
    discriminant: kind
    kinds:
      - transferred
      - verified-duplicate
      - preserved-conflict
      - retry-required
      - skipped
      - safety-blocked
  OverwriteDecision:
    values: [confirmed, declined, unavailable]
  CleanupJournalOpenRequest:
    required: [installationKey, legacySourceRoot, artifacts]
    fields:
      installationKey: InstallationKey
      legacySourceRoot: LegacySourceRoot
      artifacts: CleanupArtifactProgress[]
  CleanupTransitionRequest:
    required: [installationKey, targetState]
    fields:
      installationKey: InstallationKey
      targetState: CleanupJournalState
      artifacts: CleanupArtifactProgress[]?
      verificationToken: VerificationResultToken?
    notes:
      - verificationToken is REQUIRED when targetState is target-verified and is otherwise ignored (R-01).
      - U1 accepts the prepared -> target-verified transition only after it re-validates the token against the exact journal entry, the entry's full artifact set, and a fresh current-read of those bytes; an absent, stale, altered, or mismatched token is rejected with validation-error (or safety-blocked on an unsafe path) and the entry stays in prepared with no deletion authority.
  VerificationResultToken:
    required: [installationKey, artifactFingerprints, readVersion, issuedAt, signature]
    fields:
      installationKey: InstallationKey
      artifactFingerprints: ArtifactFingerprint[]
      readVersion: string
      issuedAt: Timestamp
      signature: string
    notes:
      - Minted only by verifyManagedArtifacts on an allVerified result, binding the exact installation key, the verified artifact set and their fingerprints, and the read it observed.
      - It is evidence of one past verification, not standing authority: U1 re-reads current bytes when it validates the token, so a token that no longer matches the live target is rejected.
  CleanupJournalCloseRequest:
    required: [installationKey, disposition]
    fields:
      installationKey: InstallationKey
      disposition: CleanupJournalDisposition
  CleanupJournalState:
    values: [prepared, target-verified, legacy-delete-pending, committed]
  CleanupJournalDisposition:
    values: [committed, abandoned]
  CleanupJournalEntry:
    required: [installationKey, state, legacySourceRoot, artifacts, updatedAt]
    fields:
      installationKey: InstallationKey
      state: CleanupJournalState
      legacySourceRoot: LegacySourceRoot
      artifacts: CleanupArtifactProgress[]
      updatedAt: Timestamp
  CleanupArtifactProgress:
    required: [legacyPath, expectedTargetPath, progressState]
    fields:
      legacyPath: LegacyPath
      expectedTargetPath: DestinationPath
      expectedFingerprint: ArtifactFingerprint?
      progressState: CleanupArtifactState
  CleanupArtifactState:
    values: [pending, verified-identical, deleted, preserved]
  CleanupJournalEntryResult:
    discriminant: kind
    kinds:
      - created
      - resumed
      - absent
      - source-root-mismatch
      - validation-error
      - retryable-failure
      - safety-blocked
    notes:
      - created and resumed are returned by openCleanupJournalEntry and recordCleanupTransition; absent is returned only by readCleanupJournalEntry and closeCleanupJournalEntry.
      - source-root-mismatch is returned when a persisted entry for this installation key names a different legacySourceRoot than the request.
  CleanupJournalCloseResult:
    discriminant: kind
    kinds:
      - closed
      - absent
      - retryable-failure
  RepositoryRedirectQuery:
    required: [storedIdentity, candidateIdentity]
    fields:
      storedIdentity: RepositoryIdentity
      candidateIdentity: RepositoryIdentity
  RepositoryReconciliationRequest:
    required: [storedIdentity, candidateIdentities, bundleId, target, scope]
    fields:
      storedIdentity: RepositoryIdentity
      candidateIdentities: RepositoryIdentity[]
      bundleId: BundleId
      target: SupportedTarget
      scope: InstallationScope
    notes:
      - The caller supplies the candidate current identities; U1 does not enumerate workspaces.
      - Zero candidates, or more than one confirmed redirect, resolves to skipped.
  RepositoryReconciliationResult:
    discriminant: kind
    kinds:
      - rekeyed
      - skipped
      - validation-error
      - retryable-failure
  RedirectResolution:
    values: [redirect-confirmed, no-redirect, unavailable]
invariants:
  - U4 cannot bypass ManifestGovernance, TargetRouting, InstallationRegistry, or InstallationLifecycle.
  - Existing target content remains authoritative until explicit overwrite consent.
  - Legacy deletion requires identity verification, byte-for-byte managed-content verification, and post-cleanup absence verification.
  - Ambiguous association, failed verification, declined consent, and unsafe paths preserve legacy content.
  - No durable per-installation migration success, failure, or conflict record is created solely for reporting.
  - U1 owns journal persistence and transition durability; U4 owns the cleanup transaction that drives it. A transition is durable before the filesystem action it authorises.
  - A journal entry exists only while its destructive operation is in flight; a committed entry is deleted as the final step of that operation.
  - A resumed entry re-verifies target bytes through verifyManagedArtifacts before any deletion; a persisted verification claim is never sufficient authority.
  - The prepared -> target-verified transition is enforceable, not advisory (R-01): recordCleanupTransition requires a VerificationResultToken and re-validates it against the journal entry, its full artifact set, and a fresh current-read before persisting target-verified; U4 cannot assert verification by state alone, and an absent, stale, altered, or mismatched token leaves the entry in prepared with no deletion authority.
  - Every legacy path in an entry stays inside that entry's verified legacy source root.
  - Journal access is exclusive per installation key; a second concurrent holder receives retryable-failure rather than a shared entry.
  - An open request whose legacySourceRoot differs from the persisted entry returns source-root-mismatch and grants no deletion authority.
  - Repeated recordCleanupTransition calls to legacy-delete-pending are permitted; same-state transition records are how per-artifact deletion progress becomes durable.
  - abandoned is permitted only from prepared or target-verified. An entry in legacy-delete-pending must reach committed through post-deletion absence verification, because deletion is already in flight.
  - reconcileRepositoryIdentity re-keys U1 shared-registry ManagedInstallation records only. It never transfers, overwrites, or deletes a legacy installation candidate; FR3.7's skip-when-no-workspace-matches criterion remains authoritative for those.
  - reconcileRepositoryIdentity re-keys a record only when RepositoryRedirectPort returns redirect-confirmed for exactly one candidate; no-redirect, unavailable, zero candidates, and multiple confirmations all resolve to skipped and leave the stored record untouched.
  - U1 performs no network call to derive an identity; the redirect capability is injected by the delivery adapter and is optional.
```

## Contract 4: U3 to U4 activation and command readiness

U3 owns activation sequencing and the command-readiness composition. U4 owns
migration inspection, association, reconciliation, and the temporary interaction
contract. U3 must invoke U4 before enabling bundle command handling, while U4
must return a current-run result even when content is preserved, skipped, or
requires a later retry.

```shared-schema
contract: u3-to-u4-activation-readiness
protocol: synchronous-in-process-typescript
provider: U3 vscode-shared-lifecycle-adoption
consumer: U4 activation-migration-compatibility
owner:
  readiness-composition: U3
  migration-policy-and-outcomes: U4
operations:
  - name: runActivationMigration
    input: ActivationMigrationContext
    output: MigrationRunResult
schemas:
  ActivationMigrationContext:
    required: [supportedTargets, openWorkspaces, legacyStore, interaction]
    fields:
      supportedTargets: SupportedTarget[]
      openWorkspaces: WorkspaceIdentity[]
      legacyStore: LegacyExtensionStorePort
      interaction: MigrationInteractionPort
  MigrationRunResult:
    required: [readiness, summary, outcomes]
    fields:
      readiness: CommandReadiness
      summary: MigrationSummary
      outcomes: MigrationOutcome[]
  CommandReadiness:
    values: [ready, ready-with-preserved-outcomes]
  MigrationSummary:
    fields:
      transferred: BundleArtifactReference[]
      verifiedDuplicates: BundleArtifactReference[]
      preservedConflicts: BundleArtifactReference[]
      skipped: MigrationSkip[]
      retryRequired: MigrationRetry[]
      safetyBlocks: MigrationSafetyBlock[]
  MigrationInteractionPort:
    operations:
      - requestOverwrite: OverwriteRequest -> OverwriteDecision
invariants:
  - U3 does not enable bundle commands until runActivationMigration returns.
  - A declined, skipped, or retry-required item is reported in the current-run summary and remains eligible for later observation when its legacy source remains.
  - U4 does not persist migration outcome state solely to make the summary possible.
  - Migration interaction remains at the VS Code delivery boundary and is not introduced into U1's normal lifecycle policy.
```

## Shared result and failure semantics

All four boundaries use explicit result types for expected lifecycle outcomes.
Adapters map those outcomes to their own presentation and process semantics.
The shared layer does not throw delivery-specific errors.

- `success` means governed content was written and read-back verification
  succeeded, or the requested cleanup was verified according to the operation.
- `validation-error` identifies malformed manifests, invalid governed
  inventory, or invalid request data before target writes begin.
- `conflict` identifies existing target content or an overwrite decision that
  must be surfaced to the user before replacement.
- `preserved-content` identifies content intentionally retained because bytes
  differ, consent was declined, or cleanup could not be proven safe.
- `retryable-failure` identifies a failed or interrupted operation that can be
  retried after current target and source state are re-read.
- `safety-blocked` identifies containment, traversal, symlink, identity, or
  verification conditions that prevent a write or deletion.

Retries are not automatic for every error. A caller may retry only when the
result is explicitly retryable, the operation is bounded and idempotent for the
same bundle, target, and scope, and migration rechecks current target content.
An overwrite retry still requires explicit user consent. There is no network
protocol and therefore no network timeout contract; activation and filesystem
operation budgets remain bounded implementation concerns. Programmer defects
are outside the expected result union and must not be represented as
delivery-specific exceptions.

## Ownership and compatibility rules

- U1 owns shared lifecycle schemas, discriminated result types, and ports for
  manifest governance, target routing, installation registry, lifecycle,
  target artifact storage, and migration cleanup journalling. U1 also owns the
  `reconcileRepositoryIdentity` and `queryDestinationOwnership` registry
  operations.
- `target` and `scope` are explicit identity attributes of `ManagedInstallation`
  and of the `ManagedInstallationIdentity` schema (R-03). The `installationKey`
  is derived from those explicit values plus the bundle and repository identity;
  it is not an opaque token whose contents an adapter must reverse-engineer.
- U1 enforces registry-wide destination ownership (R-02): before any write it
  runs `queryDestinationOwnership` scoped to the resolved target and scope, and
  returns `conflict` for a destination another installation manages unless a
  matching `DestinationOwnershipHandoff` is supplied. A hand-off updates the
  ceding and acquiring records and artifacts atomically. This is a U1
  responsibility; no adapter may bypass it.
- The journal `prepared -> target-verified` transition is token-gated (R-01):
  `verifyManagedArtifacts` mints a `VerificationResultToken`, and U1 re-validates
  that token against the entry, its artifact set, and a fresh read before
  persisting `target-verified`. U4 drives the state machine but cannot assert
  verification without live evidence U1 accepts.
- The `RepositoryRedirectPort` is an injected capability, not a U1
  responsibility: U2 and U3 supply it, and U1 treats an absent or `unavailable`
  port as "skip reconciliation" rather than an error.
- U2 owns CLI input and output translation. It does not fork U1 schemas or
  lifecycle policy.
- U3 owns VS Code command composition, activation sequencing, readiness
  composition, notifications, and interaction adapters. It does not fork U1
  lifecycle result semantics.
- U4 owns temporary legacy-association, migration-summary, and migration-
  interaction schemas. Compatibility code remains extension-owned and is
  marked for later extraction as required by the unit definition.
- These contracts are repository-internal. There is no public package-semver
  compatibility promise or independent publication of the intermediate layers.
- Schema and port changes are coordinated repository changes. Optional
  additive object fields are compatible when consumers ignore unknown fields;
  new required fields, changed meanings, removed fields, or new discriminant
  cases require all affected consumers to be updated together.
- TypeScript compilation, focused unit tests, and boundary integration tests
  are the compatibility checks. The manifest `version` is bundle data and is
  not a version of these TypeScript contracts.
- No adapter may introduce a second lifecycle implementation to work around a
  contract change.

## Open questions

| Contract | Question | Blocks |
| --- | --- | --- |
| U1 to U2 and U1 to U3 | What exact TypeScript file and export layout should hold the shared schemas and ports? | Code Generation for U1, U2, and U3 |
| U1 to U4 | What exact byte-comparison and cleanup journal algorithm proves identity, managed-content equality, and post-cleanup absence? The journal port, states, and durability rules are now contractual; the remaining question is the concrete comparison algorithm. | Detailed U4 implementation and its safety tests |
| U3 to U4 | What activation-time latency budget and cancellation behavior keeps migration bounded before bundle commands become available? | NFR Requirements and U4 implementation |
| U3 to U4 | Which migration outcomes permit `ready-with-preserved-outcomes` versus requiring a later activation retry before command readiness? | Functional Design and U3 command gating |

These questions do not change the approved boundary mechanisms or ownership
model. They are implementation details to resolve in the downstream design and
delivery stages.
## Contract 3 safety amendment — generation-bound cleanup and atomic destination ownership

This amendment is authoritative for Contract 3 and supersedes any earlier
schema or invariant that omits these fields or permits weaker behavior. It
keeps U1 as the shared lifecycle and persistence boundary; U4 remains the
activation-time migration coordinator and does not gain a direct target-write
path.

```shared-schema
contract: u1-to-u4-safety-amendment
extends: u1-to-u4-migration-support
protocol: synchronous-in-process-typescript
provider: U1 shared-installation-foundation
consumer: U4 activation-migration-compatibility
owner:
  shared-lifecycle-registry-journal-and-claims: U1
  migration-policy-interaction-and-current-run-summary: U4
operations:
  - name: verifyManagedArtifacts
    input: VerificationRequest
    output: VerificationResult
  - name: recordCleanupTransition
    input: CleanupTransitionRequest
    output: CleanupJournalEntryResult
  - name: queryDestinationOwnership
    input: DestinationOwnershipQuery
    output: DestinationOwnershipResult
  - name: transferThroughLifecycle
    input: MigrationTransferRequest
    output: MigrationTransferResult
schemas:
  CleanupJournalEntry:
    required: [entryId, generation, installationKey, state, legacySourceRoot, artifacts, updatedAt]
    fields:
      entryId: CleanupJournalEntryId
      generation: positive-integer
      installationKey: InstallationKey
      state: CleanupJournalState
      legacySourceRoot: LegacySourceRoot
      artifacts: CleanupArtifactProgress[]
      updatedAt: Timestamp
    notes:
      - U1 mints entryId on creation and increments generation whenever the entry's authoritative state or artifact-progress set changes.
      - A closed entry cannot be reused. A later cleanup for the same installation receives a new entryId.
  VerificationRequest:
    required: [installationKey, journalEntryId, journalGeneration, artifacts]
    fields:
      installationKey: InstallationKey
      journalEntryId: CleanupJournalEntryId
      journalGeneration: positive-integer
      artifacts: VerificationArtifact[]
  VerificationArtifact:
    required: [destinationPath, expectedFingerprint]
    fields:
      destinationPath: DestinationPath
      expectedFingerprint: ArtifactFingerprint
  VerificationResult:
    required: [allVerified, artifactVerdicts]
    fields:
      allVerified: boolean
      artifactVerdicts: ArtifactVerificationVerdict[]
      verificationToken: VerificationResultToken?
    notes:
      - verificationToken is present only when allVerified is true.
  VerificationResultToken:
    required: [installationKey, journalEntryId, journalGeneration, artifactFingerprints, readVersion, issuedAt, signature]
    fields:
      installationKey: InstallationKey
      journalEntryId: CleanupJournalEntryId
      journalGeneration: positive-integer
      artifactFingerprints: ArtifactFingerprint[]
      readVersion: string
      issuedAt: Timestamp
      signature: string
    notes:
      - The token is valid for one prepared-to-target-verified request on the exact live entryId and generation.
      - It becomes invalid when that transition succeeds, the entry generation changes, the entry closes, the artifact set differs, or U1's fresh read no longer matches.
  CleanupTransitionRequest:
    required: [installationKey, journalEntryId, expectedGeneration, targetState]
    fields:
      installationKey: InstallationKey
      journalEntryId: CleanupJournalEntryId
      expectedGeneration: positive-integer
      targetState: CleanupJournalState
      artifacts: CleanupArtifactProgress[]?
      verificationToken: VerificationResultToken?
    notes:
      - verificationToken is required only for prepared-to-target-verified.
      - U1 rejects an absent, stale, altered, wrong-entry, wrong-generation, subset, or non-current token with validation-error or safety-blocked and leaves the entry unchanged.
  DestinationOwnershipClaim:
    required: [claimId, target, scope, destinationPath, owner, generation, state]
    fields:
      claimId: DestinationOwnershipClaimId
      target: SupportedTarget
      scope: InstallationScope
      destinationPath: DestinationPath
      owner: ManagedInstallationIdentity
      generation: positive-integer
      state: DestinationOwnershipClaimState
      pendingMaterialization: PendingMaterialization?
    notes:
      - The unique registry key is target + scope + destinationPath.
  DestinationOwnershipClaimState:
    values: [claimed, pending-materialization, finalized, rollback-required]
  DestinationOwnershipHandoff:
    required: [destinationPath, cedingInstallation]
    fields:
      destinationPath: DestinationPath
      cedingInstallation: ManagedInstallationIdentity
  DestinationOwnershipQuery:
    required: [destinationPaths, target, scope]
    fields:
      destinationPaths: DestinationPath[]
      target: SupportedTarget
      scope: InstallationScope
  DestinationOwnershipResult:
    fields:
      claims: DestinationOwnershipClaim[]
      conflicts: DestinationOwnershipConflict[]
  MigrationTransferRequest:
    required: [source, target, scope, bundleIdentity]
    fields:
      source: LegacyInstallationSource
      target: SupportedTarget
      scope: InstallationScope
      bundleIdentity: BundleIdentity
      overwriteDecision: OverwriteDecision?
      destinationOwnershipHandoff: DestinationOwnershipHandoff?
invariants:
  - For every U1 write path, one durable registry transaction validates the current destination claim, validates any hand-off, and creates or transfers a pending-materialization claim before target bytes are written. A competing writer cannot observe the destination as unowned once that transaction commits.
  - The target write is bound to the pending claim. U1 finalizes ownership only after containment, binary write, and read-back verification succeed; it records rollback-required on a failed or interrupted materialization so recovery, not a competing writer, resolves the claim.
  - A hand-off transfers ownership only when the ceding installation currently owns the exact target, scope, and destination. U1 atomically removes the artifact from the ceding record and establishes pending ownership for the acquiring record; neither record may retain a stale shared claim.
  - transferThroughLifecycle always uses the same claim protocol as install and update. When another installation owns a destination and no valid hand-off is supplied, it returns preserved-conflict, writes nothing at that destination, and leaves legacy content intact for U4 to report.
  - U4 never calls the artifact store directly to bypass a claim, conflict, or rollback-required state.
  - A prepared-to-target-verified transition requires a VerificationResultToken whose installation key, entryId, generation, and complete fingerprint set exactly match the live entry. U1 re-reads every target artifact before it persists the transition; the token is evidence, never standing deletion authority.
```

### Amendment consequences

- The journal token now distinguishes one live cleanup operation from a later
  operation for the same installation and has explicit validity boundaries.
- Destination ownership is serialized durably at the registry boundary rather
  than by adapter convention or an in-memory lock. Crash recovery is explicit
  through the pending-materialization / rollback-required states.
- Migration transfer has no weaker exception: it surfaces a preserved conflict
  when it cannot lawfully acquire a destination, preserving both target and
  legacy content until a valid hand-off exists.
