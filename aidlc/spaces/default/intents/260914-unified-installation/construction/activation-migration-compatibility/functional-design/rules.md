# Business Rules — Activation Migration Compatibility (U4)

Rule identifiers use the `BR{group}.{seq}` format. Groups: 1 discovery, 2
association and scope, 3 scheduling and state, 4 transfer and consent, 5 cleanup
safety, 6 reporting. All U4 code is compatibility code tagged
`@migration-cleanup(activation-migration)` and removable wholesale. The YAML block
is the source of truth; a summary table follows it.

```yaml
rules:
  - id: BR1.1
    statement: A legacy installation is a migration candidate only when a live target link resolves into the legacy cache.
    category: constraint
    applies_to: LegacyInstallationCandidate
    trigger: Activation-time discovery.
    logic: >
      IF the current target's install place holds a live symlink or copy that resolves into the legacy extension cache
      THEN that bundle is a candidate
      ELSE it is not a candidate, even when legacy cache bytes still exist.
    violation: Treating cache bytes with no live target link as an install is prohibited.
    source: FR3

  - id: BR1.3
    statement: A symlinked target is materialized through U1 before the legacy cache is removed.
    category: constraint
    applies_to: LegacyInstallationCandidate
    trigger: A candidate whose deploymentForm is symlink.
    logic: >
      IF the target is a symlink into the legacy cache
      THEN transfer through U1 to write real target files first, and only then clean up the cache and the redundant symlink
      ELSE (copy form) a byte-identical target may be treated as a verified duplicate.
    violation: Removing the legacy cache while the target is still a symlink into it (stranding a broken link) is prohibited; a symlinked target is never treated as a verified duplicate.
    source: FR3.2, FR3.6

  - id: BR1.2
    statement: Discovery reads the current target and legacy source; it never mutates during inspection.
    category: constraint
    applies_to: LegacyArtifactObservation
    trigger: Building a candidate's observed artifact set.
    logic: >
      IF observing artifacts
      THEN read the current target link, the legacy source, and their bytes
      ELSE no write, overwrite, or deletion occurs during discovery.
    violation: Any filesystem mutation during inspection is prohibited.
    source: FR3, NFR1.1

  - id: BR2.1
    statement: U4 migrates only the current IDE at user scope.
    category: constraint
    applies_to: CurrentTargetContext
    trigger: Every activation migration pass.
    logic: >
      IF an installation is user scope AND its target is the IDE the extension is currently running as
      THEN it is in scope for migration
      ELSE it is out of scope and left untouched.
    violation: Migrating another target, or repository scope, is prohibited (recorded deviation from FR3.7).
    source: FR3.8

  - id: BR2.2
    statement: Repository-scope legacy content is never migrated from the extension cache.
    category: constraint
    applies_to: CurrentTargetContext
    trigger: Discovery encountering repository-scope content.
    logic: >
      IF content is repository scope
      THEN leave it to the committed repository lockfile and do not migrate it
      ELSE proceed only for user scope.
    violation: Reading, transferring, or deleting repository-scope content during activation migration is prohibited.
    source: FR3.8

  - id: BR2.3
    statement: The association is the current running target and user scope, not a stored attribute mapping.
    category: constraint
    applies_to: CurrentTargetContext
    trigger: Associating a candidate with a target and scope.
    logic: >
      IF a candidate is discovered
      THEN its target is the current IDE and its scope is user, resolved from the running host and U1 target routing
      ELSE no candidate exists.
    violation: Inferring a target from a stored per-installation record, provenance table, or user selection is prohibited (recorded deviation from FR3.8).
    source: FR3.8

  - id: BR2.4
    statement: The current target is resolved from the running host; an unmapped host yields nothing to migrate.
    category: constraint
    applies_to: CurrentTargetContext
    trigger: Resolving the current target context at activation.
    logic: >
      IF the running host's application identity maps to a supported target with a user-scope layout
      THEN that is the current target context
      ELSE the pass ends with nothing to do and nothing is touched.
    violation: Guessing a target for an unmapped host, or migrating for a host that maps to no supported user-scope layout, is prohibited.
    source: FR3.8

  - id: BR3.1
    statement: Migration runs inline during activation before bundle command handlers are registered.
    category: constraint
    applies_to: CurrentTargetContext
    trigger: Extension activation.
    logic: >
      IF the extension activates
      THEN the migration pass is attempted before any bundle command handler is registered
      ELSE no bundle command may run ahead of migration inspection.
    violation: Handling a bundle command before migration has been attempted is prohibited.
    source: FR3

  - id: BR3.2
    statement: Migration failure is non-fatal and preserves legacy data.
    category: policy
    applies_to: MigrationDisposition
    trigger: Any failure during the migration pass.
    logic: >
      IF the migration pass or one candidate fails
      THEN preserve legacy data, record a current-run disposition, and allow activation to complete
      ELSE proceed normally.
    violation: Failing extension activation because migration failed, or deleting data on failure, is prohibited.
    source: FR3.4, NFR2

  - id: BR3.3
    statement: Migration keeps no durable per-installation state; each activation re-derives from current content.
    category: constraint
    applies_to: MigrationDisposition
    trigger: Every activation migration pass.
    logic: >
      IF an installation's state is needed
      THEN derive it from the legacy source and current target content present now
      ELSE no MigrationRegistry flag or outcome record supplies it.
      An installation has no further work only because its legacy source is absent.
    violation: Recording per-installation completion, failure, or conflict state for reporting is prohibited.
    source: FR3.4, FR3.5, NFR4

  - id: BR4.1
    statement: Every target write and transfer goes through the U1 shared lifecycle.
    category: constraint
    applies_to: MigrationDisposition
    trigger: Transferring a candidate's content to the target.
    logic: >
      IF content must be written to the target
      THEN call the U1 transfer/lifecycle contract
      ELSE U4 writes no target bytes itself.
    violation: A U4-local target-write path or a second lifecycle is prohibited.
    source: FR3.6, NFR3

  - id: BR4.2
    statement: Existing target content is authoritative until the user explicitly consents to overwrite.
    category: policy
    applies_to: MigrationDisposition
    trigger: The shared lifecycle reports a conflict for a candidate.
    logic: >
      IF target content exists and differs
      THEN surface the conflict and obtain the shared OverwriteDecision from the user before any overwrite
      ELSE proceed without overwriting.
      On declined or unavailable, preserve both locations and report a deferred conflict with manual-cleanup guidance.
    violation: Overwriting target content without an explicit confirmed decision is prohibited.
    source: FR3.1, FR3.3

  - id: BR4.3
    statement: U4 reuses the single shared OverwriteDecision, not a migration-specific one.
    category: constraint
    applies_to: MigrationDisposition
    trigger: Requesting an overwrite decision.
    logic: >
      IF an overwrite decision is needed
      THEN use the shared OverwriteDecision the lifecycle defines (confirmed | declined | unavailable)
      ELSE no parallel decision type is introduced.
    violation: Defining a migration-only overwrite mechanism is prohibited.
    source: FR3.3

  - id: BR5.1
    statement: Destructive cleanup runs only through U1's cleanup journal contract.
    category: constraint
    applies_to: MigrationDisposition
    trigger: Removing a verified legacy duplicate after transfer.
    logic: >
      IF legacy content is to be removed
      THEN drive U1's MigrationCleanupJournal through prepared, target-verified, legacy-delete-pending, committed
      ELSE no ad-hoc deletion path is used.
    violation: Deleting legacy content outside the journalled, restart-safe sequence is prohibited.
    source: NFR1.1, FR3.2

  - id: BR5.2
    statement: A legacy artifact is deleted only after target identity and bytes are verified, and its absence is confirmed after.
    category: constraint
    applies_to: LegacyArtifactObservation
    trigger: Each legacy artifact deletion during cleanup.
    logic: >
      IF a legacy artifact is a deletion candidate
      THEN confirm the expected target artifact exists and is byte-identical, delete, then verify no managed legacy artifact remains
      ELSE preserve it.
    violation: Deleting before verification, or leaving managed legacy content while reporting complete, is prohibited.
    source: FR3.2, NFR1.1, NFR2

  - id: BR5.3
    statement: Every legacy and target path is contained within its resolved root; unsafe paths block the operation.
    category: validation
    applies_to: LegacyArtifactObservation
    trigger: Every comparison, overwrite, or deletion.
    logic: >
      IF a legacy or target path resolves outside its root or requires unsafe symlink traversal
      THEN perform no overwrite or deletion and report a safety failure
      ELSE proceed.
    violation: Acting on a path that escapes its root is prohibited.
    source: NFR1.1

  - id: BR5.4
    statement: An interrupted cleanup re-verifies current bytes on the next activation before resuming a deletion.
    category: constraint
    applies_to: MigrationDisposition
    trigger: Resuming after an interrupted or failed prior cleanup.
    logic: >
      IF a prior cleanup was interrupted
      THEN the next activation re-derives state and re-verifies target and legacy bytes before any deletion
      ELSE start fresh from current content.
    violation: Resuming a deletion on a stale verification claim from a prior run is prohibited.
    source: NFR2, FR3.4

  - id: BR6.1
    statement: The migration result is summarised from the current run only.
    category: policy
    applies_to: MigrationRunSummary
    trigger: Completing an activation migration pass.
    logic: >
      IF the pass completes or cannot complete
      THEN summarise the run's dispositions in a notification or diagnostics
      ELSE nothing is reported.
      The summary is assembled from this run's observed state, not a stored outcome record.
    violation: Building the summary from durable per-installation outcome state is prohibited.
    source: FR3.5, NFR4

  - id: BR6.2
    statement: A preserved conflict or failed transfer is reported with manual-cleanup guidance and remains eligible next run.
    category: policy
    applies_to: MigrationDisposition
    trigger: A candidate is preserved due to conflict, decline, or failure.
    logic: >
      IF a candidate is preserved
      THEN report the affected bundle and artifact with manual-cleanup guidance for the legacy copy, and leave it eligible for a later run
      ELSE no deferred-conflict report is emitted.
    violation: Persisting a durable conflict record, or dropping a preserved candidate from later eligibility, is prohibited.
    source: FR3.3, FR3.5, NFR4
```

## Summary

| id | statement | category | source |
| --- | --- | --- | --- |
| BR1.1 | A candidate needs a live target link into the legacy cache. | constraint | FR3 |
| BR1.2 | Discovery reads only; it never mutates. | constraint | FR3, NFR1.1 |
| BR1.3 | A symlinked target is materialized before the cache is removed. | constraint | FR3.2, FR3.6 |
| BR2.1 | Migrate only the current IDE at user scope. | constraint | FR3.8 |
| BR2.2 | Repository-scope content is never migrated from the cache. | constraint | FR3.8 |
| BR2.3 | Association is the current target + user scope, not a stored mapping. | constraint | FR3.8 |
| BR2.4 | Current target resolved from the running host; unmapped host → nothing to migrate. | constraint | FR3.8 |
| BR3.1 | Migration runs inline before command handlers register. | constraint | FR3 |
| BR3.2 | Migration failure is non-fatal and preserves data. | policy | FR3.4, NFR2 |
| BR3.3 | No durable per-installation state; re-derive from disk. | constraint | FR3.4, FR3.5, NFR4 |
| BR4.1 | All writes/transfers go through the U1 lifecycle. | constraint | FR3.6, NFR3 |
| BR4.2 | Target authoritative until explicit overwrite consent. | policy | FR3.1, FR3.3 |
| BR4.3 | Reuse the single shared OverwriteDecision. | constraint | FR3.3 |
| BR5.1 | Destructive cleanup only via U1's journal. | constraint | NFR1.1, FR3.2 |
| BR5.2 | Verify before delete; confirm absence after. | constraint | FR3.2, NFR1.1, NFR2 |
| BR5.3 | Contain every path; unsafe paths block. | validation | NFR1.1 |
| BR5.4 | Re-verify current bytes before resuming a deletion. | constraint | NFR2, FR3.4 |
| BR6.1 | Summarise from the current run only. | policy | FR3.5, NFR4 |
| BR6.2 | Report preserved conflicts with manual-cleanup guidance; stay eligible. | policy | FR3.3, FR3.5, NFR4 |
