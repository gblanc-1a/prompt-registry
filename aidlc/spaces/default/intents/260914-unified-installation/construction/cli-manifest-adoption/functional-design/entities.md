# Entities — CLI Manifest Adoption (U2)

U2 is a delivery adapter. It owns almost no durable state: its job is to
translate CLI invocations into the shared lifecycle's request types and to
translate the shared `LifecycleResult` into CLI output and exit behaviour. The
entities below are therefore mostly **translation values** that live for one
command invocation, plus one genuinely stateful concern — the one-time import of
the CLI's legacy user-scope lockfile into the shared registry.

Types owned by the shared foundation (U1) — `GovernedBundleManifest`,
`ManagedInstallation`, `ManagedArtifact`, `InstallationAddress`,
`LifecycleOutcome`, `SupportedTarget`, `InstallationScope`, `RepositoryIdentity`
— are referenced, never redefined here. The YAML block is the source of truth; a
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
      - name: commitModeSelection
        type: reference
        required: false
        references: CommitModeSelection
        constraints: Applies only to repository scope; defaults from the target definition.
    constraints:
      - Exactly one of bundleSpecification or lockfilePath is present.
      - The adapter never resolves a destination or writes a target file; it only fills a shared request.

  - name: CommitModeSelection
    description: >
      The effective commit mode for one repository-scope invocation. Commit mode
      is a field of the shared target definition; this entity records how the CLI
      resolved it for a single command so it can travel on the lifecycle request.
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
      - The CLI resolves the value but never acts on it; the shared registry adapter and the shared git-exclude port consume it.

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
        constraints: Copied from the shared LifecycleOutcome for this bundle; never reinterpreted.
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
      The mapping from one shared LifecycleOutcome to what the CLI emits: the
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
        constraints: Listed on standard output when the success outcome carries them.
    constraints:
      - The adapter maps outcome kinds to exit codes; it never changes outcome semantics.
```

## Summary

Six entities, five of them single-invocation translation values and one
(`LegacyUserLockfileImport`) a genuine one-time reconciliation.

**Invocation translation** — `CliLifecycleInvocation` reduces a parsed command
to the shared request fields, carrying exactly one of a bundle specification (the
shared lifecycle resolves and downloads it) or a lockfile path (a declarative
install). `CommitModeSelection` records how the CLI resolved the repository-scope
commit mode for one command; the CLI resolves it but never acts on it — the
shared registry adapter picks the lockfile file and the shared git-exclude port
maintains the exclusions.

**Declarative batch** — `DeclarativeInstallBatch` expands one lockfile into an
ordered list of single-bundle invocations, and `BatchBundleResult` records each
one's copied outcome kind so the adapter can print a per-bundle table and derive
one exit code. The batch is an adapter loop, not a shared operation; the shared
lifecycle stays single-bundle.

**Legacy import** — `LegacyUserLockfileImport` moves the CLI's old user-config
lockfile records into the shared registry once, then the CLI stops writing that
file. It reconciles records only and never touches runtime content.

**Result presentation** — `CliResultPresentation` maps a shared outcome to
report, preserved-file list, and exit code. Only `success` exits zero, including
when it carries preserved files; every other kind — `preserved-content` among
them, because it means the change did not happen — gets its own non-zero code.
