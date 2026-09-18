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
| 3 | U1 Shared installation foundation | U4 Activation migration compatibility | Synchronous in-process lifecycle, governance, routing, registry, and artifact-store ports | U1 for shared lifecycle contracts; U4 for temporary migration interaction contracts |
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
schemas:
  InstallRequest:
    required: [bundle, target, scope]
    fields:
      bundle: GovernedBundleSource
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
  UpdateRequest:
    required: [bundle, target, scope]
    fields:
      bundle: GovernedBundleSource
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
  UninstallRequest:
    required: [bundleId, target, scope]
    fields:
      bundleId: BundleId
      target: SupportedTarget
      scope: InstallationScope
      repositoryIdentity: RepositoryIdentity?
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
  - InstallationRegistry isolates state by bundle, target, scope, and repository identity.
  - InstallationLifecycle verifies binary writes before returning success.
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
  - Target content is isolated by target and scope.
  - U3 may compose VS Code behavior but cannot change LifecycleResult semantics.
```

## Contract 3: U1 to U4 migration support

U4 owns legacy discovery and migration policy during activation, but U1 remains
the only normal target-write lifecycle. U4 consumes U1's validation, routing,
registry, lifecycle, and target-artifact contracts to transfer or compare
content. U4 supplies temporary migration interaction behavior and maps its
results into the extension summary.

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
invariants:
  - U4 cannot bypass ManifestGovernance, TargetRouting, InstallationRegistry, or InstallationLifecycle.
  - Existing target content remains authoritative until explicit overwrite consent.
  - Legacy deletion requires identity verification, byte-for-byte managed-content verification, and post-cleanup absence verification.
  - Ambiguous association, failed verification, declined consent, and unsafe paths preserve legacy content.
  - No durable per-installation migration success, failure, or conflict record is created solely for reporting.
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
  manifest governance, target routing, installation registry, lifecycle, and
  target artifact storage.
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
| U1 to U4 | What exact byte-comparison and cleanup journal algorithm proves identity, managed-content equality, and post-cleanup absence? | Detailed U4 implementation and its safety tests |
| U3 to U4 | What activation-time latency budget and cancellation behavior keeps migration bounded before bundle commands become available? | NFR Requirements and U4 implementation |
| U3 to U4 | Which migration outcomes permit `ready-with-preserved-outcomes` versus requiring a later activation retry before command readiness? | Functional Design and U3 command gating |

These questions do not change the approved boundary mechanisms or ownership
model. They are implementation details to resolve in the downstream design and
delivery stages.
