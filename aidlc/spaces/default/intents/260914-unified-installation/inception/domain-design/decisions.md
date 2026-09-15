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

### Consequences

- Positive: migration runs before bundle commands and remains compatible with
  activation and VS Code interaction patterns.
- Positive: legacy content is retained on association failure, conflict,
  failed transfer, or failed verification; cleanup occurs only after current
  identity/content and post-cleanup checks.
- Negative: migration policy lives temporarily outside the shared packages and
  requires an explicit later cleanup to avoid permanent duplication.
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