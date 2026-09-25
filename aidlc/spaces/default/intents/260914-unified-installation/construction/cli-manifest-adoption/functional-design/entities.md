# Entities — CLI Manifest Adoption (U2)

U2 is a delivery adapter. It owns almost no durable state: its job is to
translate CLI invocations into the shared lifecycle's request types and to
translate the shared `LifecycleResult` into CLI output and exit behaviour. The
entities below are therefore mostly **translation values** that live for one
command invocation, plus one genuinely stateful concern — the one-time import of
the CLI's legacy user-scope lockfile into the shared registry.

Types owned by the shared foundation (U1) and declared in
`inception/contract-design/contract-summary.md` — `GovernedBundleSource`,
`GovernedBundleManifest`, `ManagedInstallation`, `ManagedInstallationIdentity`,
`ManagedArtifact`, `InstallationAddress`, `LifecycleResult`, `BundleId`,
`SupportedTarget`, `InstallationScope`, `RepositoryIdentity`,
`DestinationOwnershipClaim`, and `DestinationOwnershipHandoff` — are referenced,
never redefined here. The unit's boundary comes from
`inception/units-generation/unit-of-work.md`, its assigned requirements from
`inception/units-generation/unit-of-work-story-map.md` and
`inception/requirements-analysis/requirements.md`, and the shared components it
delegates to from `inception/domain-design/components.md`. The YAML block is the source of truth; a
prose summary follows it.

```yaml
entities:
  - name: CliLifecycleInvocation
    description: >
      One parsed CLI lifecycle command (install, update, uninstall, or the
      apply wrapper) reduced to the fields the shared lifecycle needs. It carries
      no behaviour; it is the adapter's translation of argv into a shared request.
    attributes:
      - name: operation
        type: enum
        required: true
        allowed_values: [install, update, uninstall]
        constraints: The apply wrapper resolves to install; no separate value.
      - name: bundleSpecification
        type: string
        required: false
        constraints: >
          The user-supplied bundle reference to be resolved by the shared
          lifecycle. Absent for a declarative (lockfile-driven) invocation.
          Install and update carry it; uninstall does not, because Contract 1's
          UninstallRequest takes a resolved bundleId instead.
      - name: bundleId
        type: reference
        required: false
        references: BundleId
        constraints: >
          The resolved bundle identity Contract 1's UninstallRequest requires.
          Required for uninstall and absent otherwise. The adapter obtains it by
          looking the user-typed reference up against the shared registry's
          managed installations for the selected target, scope, and repository
          identity (BR8.1); it is never derived by parsing a specification
          string.
      - name: lockfilePath
        type: path
        required: false
        constraints: Present only for a declarative install; names the lockfile to expand.
      - name: target
        type: reference
        required: true
        references: SupportedTarget
      - name: scope
        type: reference
        required: true
        references: InstallationScope
      - name: repositoryIdentity
        type: reference
        required: false
        references: RepositoryIdentity
        constraints: >
          Required when scope is repository and absent for user scope, matching
          the optional repositoryIdentity field on every Contract 1 request. The
          adapter derives it from the selected repository working tree (BR8.2)
          and never invents it.
      - name: commitModeSelection
        type: reference
        required: false
        references: CommitModeSelection
        constraints: Applies only to repository scope; defaults from the target definition.
    constraints:
      - Exactly one of bundleSpecification or lockfilePath is present for install and update; uninstall carries bundleId instead.
      - The adapter never resolves a destination or writes a target file; it only fills a shared request.
      - The adapter supplies no destinationOwnershipHandoff on any request (BR8.3); an ownership conflict is reported, never overridden from the CLI.

  - name: CommitModeSelection
    description: >
      The effective commit mode for one repository-scope invocation. Commit mode
      is a field of the shared target definition; this entity records how the CLI
      resolved it for a single command. It is intended to travel on the lifecycle
      request once open delta 2 adds a field for it; while that delta stands the
      resolved value is recorded and carried no further.
    attributes:
      - name: value
        type: enum
        required: true
        allowed_values: [commit, local-only]
      - name: origin
        type: enum
        required: true
        allowed_values: [flag, target-default]
        constraints: flag when supplied on the command line, target-default when taken from the target.
    constraints:
      - The CLI resolves the value but never acts on it.
      - Its intended consumers are the shared repository registry adapter (lockfile selection) and a shared git-exclude port. Neither is declared in the current contract, so while open delta 2 stands the resolved value is carried no further and the CLI substitutes no commit-mode behaviour of its own.

  - name: DeclarativeInstallBatch
    description: >
      The expansion of one lockfile into an ordered list of single-bundle
      installations, so a declarative install maps onto the shared lifecycle's
      single-bundle operation without a batch contract.
    attributes:
      - name: sourceLockfilePath
        type: path
        required: true
      - name: plannedInstallations
        type: list of reference
        required: true
        references: CliLifecycleInvocation
        constraints: One per bundle named in the lockfile, in lockfile order.
    constraints:
      - Execution continues after a failed member; it does not stop at the first failure.
      - The batch is an adapter-side loop, not a shared-lifecycle operation.
    relationships:
      - to: BatchBundleResult
        cardinality: one-to-many
        direction: produces

  - name: BatchBundleResult
    description: >
      The recorded outcome of one bundle within a declarative batch, so the
      adapter can present a per-bundle result table and derive a single exit code.
    attributes:
      - name: bundleSpecification
        type: string
        required: true
      - name: outcomeKind
        type: enum
        required: true
        allowed_values: [success, validation-error, conflict, preserved-content, retryable-failure, safety-blocked]
        constraints: Copied from the shared LifecycleResult for this bundle; never reinterpreted.
    relationships:
      - to: DeclarativeInstallBatch
        cardinality: many-to-one
        direction: belongs-to

  - name: LegacyUserLockfileImport
    description: >
      The one-time reconciliation that moves the CLI's pre-existing user-scope
      lockfile records into the shared registry. After import the CLI stops
      writing that file; the shared registry is the only user-scope record store.
    attributes:
      - name: legacyLockfilePath
        type: path
        required: true
        constraints: The CLI's user-config-root lockfile, distinct from a repository lockfile.
      - name: importState
        type: enum
        required: true
        allowed_values: [pending, imported, absent]
        constraints: absent when no legacy file exists; imported once records were copied into the shared registry.
    constraints:
      - Import reads the legacy file at most once; a completed import is never repeated.
      - Import adds a shared user-scope record only when the shared registry has none for that installation key.
      - A legacy entry is imported only when its target resolves to exactly one configured target; an ambiguous entry is skipped and reported, not guessed.
      - Import never deletes user runtime content; it reconciles records only.

  - name: CliResultPresentation
    description: >
      The mapping from one shared LifecycleResult to what the CLI emits: the
      human-readable report, the list of preserved files when present, and the
      process exit code.
    attributes:
      - name: outcomeKind
        type: enum
        required: true
        allowed_values: [success, validation-error, conflict, preserved-content, retryable-failure, safety-blocked]
      - name: exitCode
        type: integer
        required: true
        min: 0
        constraints: >
          Zero only for success (including a success that carries preserved
          files). Each other kind has its own distinct non-zero code.
      - name: preservedArtifacts
        type: list of reference
        required: false
        references: ManagedArtifact
        constraints: >
          Listed on standard output when the success outcome carries them. The
          shared LifecycleResult declares no payload to read them from, so this
          field is unpopulated until open gap 2 closes.
      - name: conflictDetails
        type: list of reference
        required: false
        references: CliConflictDetail
        constraints: >
          Present when the outcome kind is conflict, so the report can name the
          affected bundle and destination instead of stating only that a
          conflict occurred.
    constraints:
      - The adapter maps outcome kinds to exit codes; it never changes outcome semantics.

  - name: CliConflictDetail
    description: >
      One reportable conflict the shared lifecycle returned, so the CLI can tell
      the user which bundle and which destination were affected and which
      installation currently owns that destination.
    attributes:
      - name: bundleSpecification
        type: string
        required: true
      - name: destinationPath
        type: path
        required: true
        constraints: Copied from the shared conflict result; the adapter resolves no destination itself.
      - name: owningInstallation
        type: reference
        required: false
        references: ManagedInstallationIdentity
        constraints: >
          Present when the conflict is a cross-installation destination-ownership
          conflict; absent for a locally-changed-content conflict on the selected
          installation's own artifact. Typed as the contract types it, in
          DestinationOwnershipResult.conflicts.
    constraints:
      - Every field is copied from a declared shared read; the adapter derives no ownership fact of its own.
      - The destination path and owning identity come from queryDestinationOwnership, which Contract 1 declares; they are not read off the payload-free LifecycleResult union.
    relationships:
      - to: CliResultPresentation
        cardinality: many-to-one
        direction: belongs-to
```

## Summary

Seven entities, six of them single-invocation translation values and one
(`LegacyUserLockfileImport`) a genuine one-time reconciliation.

**Invocation translation** — `CliLifecycleInvocation` reduces a parsed command
to the shared request fields, carrying exactly one of a bundle specification (the
shared lifecycle resolves and downloads it) or a lockfile path (a declarative
install). `CommitModeSelection` records how the CLI resolved the repository-scope
commit mode for one command; the CLI resolves it but never acts on it. Its
intended consumers are a shared registry adapter that would pick the lockfile
file and a shared git-exclude port that would maintain the exclusions, and
neither is declared in the current contract — so while open delta 2 stands the
resolved value is carried no further and the CLI substitutes nothing of its own.

**Declarative batch** — `DeclarativeInstallBatch` expands one lockfile into an
ordered list of single-bundle invocations, and `BatchBundleResult` records each
one's copied outcome kind so the adapter can print a per-bundle table and derive
one exit code. The batch is an adapter loop, not a shared operation; the shared
lifecycle stays single-bundle.

**Legacy import** — `LegacyUserLockfileImport` moves the CLI's old user-config
lockfile records into the shared registry once, then the CLI stops writing that
file. It reconciles records only and never touches runtime content.

**Result presentation** — `CliResultPresentation` maps a shared outcome to
report, preserved-file list, conflict details, and exit code. Only `success`
exits zero, including when it carries preserved files; every other kind —
`preserved-content` among them, because it means the change did not happen —
gets its own non-zero code. `CliConflictDetail` carries the bundle plus the
destination path and owning identity read from the contract's
`queryDestinationOwnership`, so the report can name what was affected. The
preserved-file list stays unpopulated until open gap 2 gives `success` a declared
payload.

## Shared-foundation identity alignment

Per `inception/contract-design/contract-summary.md`, the shared foundation
exposes `target` and `scope` as required `ManagedInstallation` attributes and
owns a durable `DestinationOwnershipClaim` keyed by target, scope, and
destination path, with states `claimed`, `pending-materialization`, `finalized`,
and `rollback-required`. U2 consumes both: legacy user-lockfile entries map onto
that explicit identity rather than an opaque key, and CLI-triggered writes
observe the shared claim. U2 defines no adapter-local copy of either concept,
supplies no ownership hand-off, and resolves no claim state itself.

Naming note, settled against the contract: the shared result union is
`LifecycleResult` in `contract-summary.md` and appears as `LifecycleOutcome` in
the U1 design prose. This unit treats `LifecycleResult` as the contract name and
uses it in request/response translation; the two denote the same six-kind union.
