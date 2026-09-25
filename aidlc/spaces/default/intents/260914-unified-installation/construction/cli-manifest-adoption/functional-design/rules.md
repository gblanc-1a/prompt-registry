# Business Rules — CLI Manifest Adoption (U2)

Sources: `inception/units-generation/unit-of-work.md` (U2's boundary),
`inception/units-generation/unit-of-work-story-map.md` (assigned requirements),
`inception/requirements-analysis/requirements.md` (FR1–FR4.1),
`inception/domain-design/components.md` (shared components), and
`inception/contract-design/contract-summary.md` (request, result, and ownership
schemas).

Rule identifiers use the `BR{group}.{seq}` format. Groups: 1 delegation, 2 bundle
handover, 3 record migration, 4 result and exit mapping, 5 declarative batch, 6
commit mode, 8 shared-foundation alignment. Because U2 is a delivery adapter,
most rules are **negative
constraints** — they forbid the adapter from reproducing policy that belongs to
the shared foundation. The YAML block is the source of truth; a summary table
follows it.

```yaml
rules:
  - id: BR1.1
    statement: A CLI lifecycle command performs target writes only through the shared lifecycle.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: Every install, update, and uninstall command, including the apply wrapper.
    logic: >
      IF a command must write, update, or remove target content
      THEN it fills a shared lifecycle request and delegates
      ELSE the command is a rule violation.
    violation: A CLI-specific target-write path or a rigid archive subdirectory is prohibited.
    source: FR1, FR1.1

  - id: BR1.2
    statement: The adapter does not reinterpret a shared result; it maps it.
    category: constraint
    applies_to: CliResultPresentation
    trigger: Every returned LifecycleResult.
    logic: >
      IF the shared lifecycle returns an outcome kind
      THEN the adapter presents and exit-codes that same kind
      ELSE it may not invent, merge, or suppress a kind.
    violation: Changing outcome semantics at the delivery edge is prohibited.
    source: FR1

  - id: BR2.1
    statement: The CLI hands the bundle specification to the shared lifecycle and does not resolve or download it itself.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: An imperative install naming a bundle specification.
    logic: >
      IF a bundle must be fetched and read
      THEN the shared lifecycle owns source resolution, download, archive reading, and validation
      ELSE no CLI-side resolution or extraction path is retained.
    violation: A surviving CLI download or extraction path duplicates shared behaviour.
    source: FR1.1, FR4

  - id: BR3.1
    statement: User-scope records are read from and written to the shared registry only.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: Any user-scope lifecycle operation.
    logic: >
      IF a user-scope record is read or written
      THEN use the shared registry through its user-scope adapter
      ELSE the operation is a rule violation.
    violation: Writing the legacy user-config lockfile for a new operation is prohibited after import.
    source: FR2.1

  - id: BR3.2
    statement: The legacy user-scope lockfile is imported once, additively, and never deletes runtime content.
    category: policy
    applies_to: LegacyUserLockfileImport
    trigger: First user-scope operation when a legacy user lockfile exists and import state is pending.
    logic: >
      IF the legacy user lockfile exists AND the shared registry has no record for one of its installation keys
      THEN copy that record into the shared registry
      ELSE leave the existing shared record authoritative.
      After processing every entry, mark import complete and stop writing the legacy file.
    violation: Re-importing after completion, overwriting a newer shared record, or deleting runtime files is prohibited.
    source: FR2.1

  - id: BR3.3
    statement: Repository-scope records stay in the selected repository's lockfile.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: Any repository-scope operation.
    logic: >
      IF a repository-scope record is read or written
      THEN use the repository lockfile within that repository through the shared registry adapter
      ELSE the operation is a rule violation.
    violation: Moving a repository record into user-scope storage is prohibited.
    source: FR2.1, FR2.2

  - id: BR3.4
    statement: A legacy user-scope entry is imported only when its target resolves to exactly one configured target.
    category: policy
    applies_to: LegacyUserLockfileImport
    trigger: Reconciling one legacy user-scope entry during the one-time import.
    logic: >
      IF the legacy entry carries a target hint
      THEN use it as the target
      ELSE associate the entry with the single configured target whose user-scope layout contains the entry's recorded managed files.
      IF exactly one target results THEN derive the full shared key and import additively
      ELSE skip the entry, report the reason, and leave the legacy copy untouched.
    violation: Guessing a target for an ambiguous entry, or importing against a target the entry's files do not occupy, is prohibited.
    source: FR2.1

  - id: BR4.1
    statement: Only a success outcome exits zero.
    category: policy
    applies_to: CliResultPresentation
    trigger: Mapping a single-bundle outcome to a process exit code.
    logic: >
      IF the outcome kind is success
      THEN exit zero, listing any preserved artifacts it carries on standard output
      ELSE exit with the non-zero code assigned to that kind.
    violation: Exiting zero for any non-success kind is prohibited.
    source: FR1

  - id: BR4.2
    statement: Each non-success kind has its own distinct exit code.
    category: constraint
    applies_to: CliResultPresentation
    trigger: Mapping a non-success outcome to a process exit code.
    logic: >
      IF the outcome kind is validation-error, conflict, preserved-content, retryable-failure, or safety-blocked
      THEN map it to the one exit code reserved for that kind
      ELSE no mapping applies.
    violation: Two distinct kinds sharing one non-zero code is prohibited.
    source: FR1

  - id: BR4.3
    statement: preserved-content is a non-success exit because the requested change did not happen.
    category: policy
    applies_to: CliResultPresentation
    trigger: A returned preserved-content outcome.
    logic: >
      IF the outcome kind is preserved-content
      THEN exit non-zero and report that the update did not proceed
      ELSE this rule does not apply.
    violation: Treating preserved-content as a completed change is prohibited; a success carrying preserved files is the distinct zero-exit case.
    source: FR1

  - id: BR5.1
    statement: A declarative install expands its lockfile into ordered single-bundle operations.
    category: constraint
    applies_to: DeclarativeInstallBatch
    trigger: An install naming a lockfile path.
    logic: >
      IF a lockfile is given
      THEN install each named bundle through the shared single-bundle operation in lockfile order
      ELSE this rule does not apply.
    violation: Requiring a batch operation from the shared lifecycle is prohibited.
    source: FR1

  - id: BR5.2
    statement: A declarative batch continues after a per-bundle failure and reports every result.
    category: policy
    applies_to: DeclarativeInstallBatch
    trigger: A member installation returns a non-success outcome.
    logic: >
      IF one bundle fails
      THEN record its outcome and continue with the remaining bundles
      ELSE continue normally.
      Report a per-bundle result table at the end.
    violation: Aborting the whole batch at the first failure is prohibited.
    source: FR1

  - id: BR5.3
    statement: A declarative batch exits non-zero when any member did not succeed.
    category: policy
    applies_to: DeclarativeInstallBatch
    trigger: Batch completion.
    logic: >
      IF every member returned success
      THEN exit zero
      ELSE exit non-zero.
    violation: Exiting zero while any member failed is prohibited.
    source: FR1

  - id: BR6.1
    statement: Commit mode is resolved per invocation; carrying it to the shared layer awaits open delta 2.
    category: constraint
    applies_to: CommitModeSelection
    trigger: A repository-scope lifecycle command.
    logic: >
      IF the command supplies a commit-mode flag
      THEN use it
      ELSE use the target definition's commit mode.
      Attach the resolved value to the shared lifecycle request once the shared
      contract carries a field for it (see open delta 2); until then the resolved
      value is passed no further and no adapter-side commit-mode behaviour is
      substituted.
    violation: Acting on commit mode in the adapter — selecting a lockfile file or editing git exclusions — is prohibited; those are shared concerns.
    source: FR2.1, FR4
  - id: BR8.1
    statement: Uninstall resolves its bundle identity from the shared registry before delegating.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: An uninstall command naming a bundle by user-typed reference.
    logic: >
      IF the user-typed reference matches exactly one managed installation in the
      shared registry for the selected target, scope, and repository identity
      THEN use that installation's bundleId on the Contract 1 UninstallRequest
      ELSE report no-match or ambiguity and exit non-zero without delegating.
    violation: >
      Sending an unresolved specification string as bundleId, or deriving a
      bundle identity by parsing the reference, is prohibited — Contract 1
      declares no source resolution on uninstall.
    source: FR1, FR1.3
  - id: BR8.2
    statement: Repository-scope requests carry a repository identity derived from the selected working tree.
    category: constraint
    applies_to: CliLifecycleInvocation
    trigger: Any lifecycle command whose scope is repository.
    logic: >
      IF the scope is repository
      THEN derive the repository identity from the selected working tree and set
      it on the shared request
      ELSE omit it, as user scope has none.
    violation: >
      Omitting the identity on a repository-scope request, or inventing one, is
      prohibited: Contract 1 isolates registry state by bundle, target, scope,
      and repository identity.
    source: FR2.1, FR2.2
  - id: BR8.3
    statement: The CLI supplies no destination-ownership hand-off and resolves no claim state.
    category: constraint
    applies_to: CliResultPresentation
    trigger: A shared write that returns a cross-installation ownership conflict.
    logic: >
      IF the shared lifecycle reports a destination owned by another installation
      THEN report the affected bundle, destination path, and owning installation
      from the shared result and exit with the conflict code
      ELSE continue normally.
      Never set destinationOwnershipHandoff, and never act on a claimed,
      pending-materialization, or rollback-required claim state.
    violation: >
      Supplying a hand-off from the CLI, retrying the write, or touching target
      content to clear a claim is prohibited; ownership transfer and claim
      recovery belong to the shared foundation.
    source: FR2.2, FR4
  - id: BR8.4
    statement: Every lockfile-touching command in scope reads installation state from the shared registry.
    category: constraint
    applies_to: LegacyUserLockfileImport
    trigger: An in-scope command that reads or writes installation records — init, profile, status, or a lifecycle command.
    logic: >
      IF the command reports or records user-scope installation state
      THEN read it from the shared registry, running the one-time legacy import
      first when its state is pending
      ELSE it is out of this unit's scope.
      A status report distinguishes records already in the shared registry from
      legacy entries the pending import has not yet reconciled.
    violation: >
      Reading or writing the legacy user lockfile as a live record store after
      import, or reporting installation state from it, is prohibited.
    source: FR2.1, FR4
```

## Summary

| id | statement | category | source |
| --- | --- | --- | --- |
| BR1.1 | CLI writes only through the shared lifecycle. | constraint | FR1, FR1.1 |
| BR1.2 | The adapter maps a shared result, never reinterprets it. | constraint | FR1 |
| BR2.1 | The shared lifecycle owns bundle resolution and download. | constraint | FR1.1, FR4 |
| BR3.1 | User-scope records live only in the shared registry. | constraint | FR2.1 |
| BR3.2 | Legacy user lockfile is imported once, additively, non-destructively. | policy | FR2.1 |
| BR3.3 | Repository records stay in the repository lockfile. | constraint | FR2.1, FR2.2 |
| BR3.4 | A legacy entry is imported only when its target resolves uniquely. | policy | FR2.1 |
| BR4.1 | Only success exits zero. | policy | FR1 |
| BR4.2 | Each non-success kind has its own exit code. | constraint | FR1 |
| BR4.3 | preserved-content exits non-zero — the change did not happen. | policy | FR1 |
| BR5.1 | Declarative install expands into ordered single-bundle operations. | constraint | FR1 |
| BR5.2 | A batch continues after failure and reports every result. | policy | FR1 |
| BR5.3 | A batch exits non-zero if any member failed. | policy | FR1 |
| BR6.1 | Commit mode is resolved per invocation; carrying it on the request depends on open delta 2. | constraint | FR2.1, FR4 |
| BR8.1 | Uninstall resolves bundle identity from the shared registry before delegating. | constraint | FR1, FR1.3 |
| BR8.2 | Repository-scope requests carry a derived repository identity. | constraint | FR2.1, FR2.2 |
| BR8.3 | The CLI supplies no ownership hand-off and resolves no claim state. | constraint | FR2.2, FR4 |
| BR8.4 | Every in-scope lockfile-touching command reads state from the shared registry. | constraint | FR2.1, FR4 |

## Shared-foundation alignment

Group 8 in the YAML source of truth above carries this unit's alignment with
`inception/contract-design/contract-summary.md`: BR8.1 resolves an uninstall's
bundle identity from the shared registry, BR8.2 supplies repository identity on
repository-scope requests, BR8.3 forbids any CLI-side ownership hand-off or
claim resolution, and BR8.4 routes every in-scope lockfile-touching command
through the shared registry. These are negative constraints plus request
translation; they add no adapter-local lifecycle policy.
