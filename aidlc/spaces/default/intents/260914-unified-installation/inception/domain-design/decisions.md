# Architecture Decisions


## ADR-001: Shared Managed Installation Lifecycle

### Context

The CLI and VS Code extension currently reach target files through different
paths. The CLI has a rigid archive-path assumption, while the extension caches
and synchronizes content through extension services. Requirements FR1, FR1.1,
FR1.2, FR1.3, FR2, FR2.1, FR2.2, and NFR3 require one manifest-driven
lifecycle that preserves the repository's Clean Architecture dependency
direction.

### Decision

Create `InstallationLifecycle` in the shared application layer. It composes
shared `ManifestGovernance`, `TargetRouting`, and `InstallationRegistry`
components through core-defined ports and infra implementations. Both CLI and
VS Code delivery adapters invoke this lifecycle rather than writing target
content through delivery-specific policy.

### Consequences

- Positive: root-manifest validation, `items[]` processing, target/scope
  isolation, update behavior, uninstall behavior, and read-back verification
  have one testable implementation.
- Positive: delivery adapters retain only command, notification, and
  composition responsibilities.
- Negative: shared ports and temporary adapters must land before the extension
  can retire its cache-then-sync path.
- Neutral: individual target layouts still vary, but only behind
  `TargetRouting` and its layout provider.

### Alternatives Rejected

- Keep separate CLI and extension lifecycles with common manifest helpers:
  rejected because update, uninstall, and target-write policy would remain
  duplicated.
- Adapt the CLI to extension services: rejected because it makes shared
  packages depend on VS Code and reverses the intended dependency direction.

## ADR-002: Managed Installation Records Are Shared Domain State

### Context

FR1.3 requires updates and uninstalls to remove only content still managed by
the selected installation. FR2.1 requires user-scope cache and registry data
to use shared XDG application storage, while repository records remain in the
repository. A lifecycle operation needs durable proof of prior managed bytes.

### Decision

Model `ManagedInstallation` and `ManagedArtifact` as shared domain entities.
Key each installation by bundle identity, target, and scope, and record each
managed destination path with its installed content hash. Persist user-scope
records through the injected XDG `AppStorage` port and repository-scope records
through a repository-local lockfile port.

### Consequences

- Positive: update, uninstall, and migration cleanup can distinguish managed,
  locally changed, and unmanaged files deterministically.
- Positive: one target or scope cannot mutate another installation's records.
- Negative: registry schema and compatibility adapters need migration coverage.
- Neutral: target runtime folders remain consumers of installed artifacts, not
  owners of shared application records.

### Alternatives Rejected

- Infer managed content from the current manifest: rejected because it cannot
  safely identify omitted or locally changed files.
- Store user registry data in runtime target roots: rejected because it
  conflates target output with shared application state.

## ADR-003: Temporary Extension-Owned Activation Migration

### Context

FR3 through FR3.8 require activation-time transfer, authoritative target
comparison, explicit overwrite choice, and verified deletion of legacy
extension content. The confirmed design keeps migration in the extension
initially, but must avoid establishing a second normal installation lifecycle.

### Decision

Introduce `ExtensionMigrationCoordinator` as temporary compatibility code in
the VS Code extension, tagged for later extraction. It owns legacy discovery,
deterministic target/scope association, byte-for-byte comparison, conflict and
retry coordination, and run summaries. It calls `InstallationLifecycle` for
transfer. VS Code notification and explicit overwrite input enter through a
delivery-facing `MigrationInteraction` port; the coordinator owns the policy
for when that input is needed.

This is an explicitly bounded exception to NFR3. The exception covers only
legacy extension-path discovery, association, migration reconciliation, and
journaled cleanup because the extension is the only boundary that can resolve
the IDE extension's internal legacy path and determine which files it owns.
U4 owns this exception and must preserve the following compatibility contract:

- U4 calls U1's shared lifecycle for all target writes and never implements a
  second normal install, update, or uninstall path.
- U4 receives target, scope, identity, and typed lifecycle outcomes through
  shared ports; VS Code notifications and overwrite decisions remain at the
  extension interaction edge.
- U4 may delete only legacy artifacts discovered under the extension-owned
  root and named by a verified cleanup journal; target content remains
  authoritative.
- The extraction trigger is either a future stable legacy-storage port that
  exposes the legacy root and ownership metadata without VS Code-specific
  context, or the end of the supported legacy-migration window, at which point
  U4 is removed rather than retained as permanent lifecycle policy. The U4
  owner is responsible for recording that transition and its compatibility
  evidence.

### Consequences

- Positive: migration runs before bundle commands and remains compatible with
  activation and VS Code interaction patterns.
- Positive: legacy content is retained on association failure, conflict,
  failed transfer, or failed verification; cleanup occurs only after current
  identity/content and post-cleanup checks.
- Negative: migration policy lives temporarily outside the shared packages and
  requires an explicit later cleanup to avoid permanent duplication. This is a
  deliberate, bounded NFR3 exception caused by extension-internal path
  ownership, not a general permission for delivery-layer business rules.
- Neutral: the migration derives outcomes from current source and target state;
  it records no separate durable conflict or outcome state solely for reporting.

### Alternatives Rejected

- Extract all migration policy into `packages/` immediately: rejected because
  it expands the first change beyond a reviewable migration boundary.
- Let VS Code services transfer directly to targets: rejected because it would
  recreate a second target-write path.
- Automatically overwrite target content: rejected because target content is
  authoritative and overwrite requires an explicit user decision.

## ADR-004: Compatibility Through Thin Adapters

### Context

FR4 requires a documented compatibility policy before implementation. The
requestor prefers existing supported CLI and VS Code commands to remain stable
unless compatibility would preserve duplicated policy.

### Decision

Preserve existing supported command and user workflows through thin delivery
adapters. Permit a documented incompatibility only when evidence shows that the
adapter itself would retain duplicate lifecycle policy or prevent the shared
architecture.

### Consequences

- Positive: user-facing entry points can transition incrementally while sharing
  implementation policy.
- Positive: any break has an explicit architectural justification and focused
  compatibility evidence.
- Negative: adapters add temporary transitional code and coverage.
- Neutral: delivery planning selects the individual PR sequence and test matrix.

### Alternatives Rejected

- Guarantee every historical internal behavior indefinitely: rejected because
  it can require preserving duplicate cache-then-sync policy.
- Permit unrestricted changes to both entry points: rejected because migration
  risk would be borne by users without evidence-led justification.

## ADR-005: Journaled Destructive Migration Cleanup

### Context

NFR1.1 requires migration cleanup to be atomic or journaled so an interrupted
operation cannot delete unmanaged content or report completion while managed
legacy artifacts remain. The earlier design assigned path containment,
byte-for-byte comparison, and post-cleanup verification to
`ExtensionMigrationCoordinator`, but did not define the boundary that makes an
interrupted multi-artifact cleanup recoverable.

### Decision

Represent destructive migration cleanup as a journaled transaction owned by
`ExtensionMigrationCoordinator` and backed by a `MigrationCleanupJournal` port.
The coordinator records the installation identity, expected target artifact
set, source and target hashes, and cleanup state before any legacy deletion.
Each artifact may move through `prepared`, `target-verified`, and
`legacy-delete-pending` states only after the required containment and byte
checks. The coordinator deletes only the explicitly managed legacy artifact
named by the journal, records the deletion result, and marks the transaction
`committed` only after a fresh scan confirms no managed legacy artifact remains.
If activation stops at any earlier state, the next run reopens the journal,
rechecks target bytes and source presence, and either completes the safe pending
transition or preserves the source and reports a retry-required outcome.
The journal transition itself is crash-safe and scoped to one legacy
installation and its verified managed artifact set.

### Consequences

- Positive: interrupted cleanup has an explicit recovery point and cannot be
  reported complete without post-delete absence verification.
- Positive: the journal scopes every destructive action to an identified,
  verified managed artifact and prevents unmanaged deletion.
- Negative: migration needs a small durable journal with crash-safe writes and
  cleanup of committed journal entries; this is temporary compatibility state,
  not a general installation outcome registry.
- Neutral: a journal entry records operation safety and recovery progress only;
  it does not become a durable per-installation success, failure, or conflict
  result for user reporting.

### Alternatives Rejected

- Delete all legacy files after an in-memory comparison: rejected because a
  process interruption can leave partial cleanup with no recovery boundary.
- Use the shared installation registry as the migration journal: rejected
  because the registry owns managed installation identity, not activation-only
  destructive progress, and the migration must remain temporary.
- Mark cleanup complete immediately after deletion calls return: rejected
  because filesystem state must be rescanned before completion is reported.