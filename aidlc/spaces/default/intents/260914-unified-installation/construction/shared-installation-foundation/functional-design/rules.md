# Business Rules — Shared Installation Foundation (U1)

Rule identifiers use the `BR{group}.{seq}` format. Groups: 1 governance, 2
routing, 3 registry, 4 lifecycle, 5 journal, 6 reconciliation. The YAML block
below is the source of truth; a summary table follows it. Thirty rules.

```yaml
rules:
  - id: BR1.1
    statement: A bundle is installable only when exactly one root deployment manifest is present.
    category: validation
    applies_to: GovernedBundleManifest
    trigger: Bundle validation, before the first filesystem mutation.
    logic: >
      IF the archive contains exactly one root deployment manifest at the archive root
      THEN accept the manifest
      ELSE reject the bundle before any target file is written.
    violation: Return a validation-error outcome; write nothing.
    source: FR1.1

  - id: BR1.2
    statement: Every archive file except the root manifest has exactly one file record.
    category: validation
    applies_to: ArchiveFileRecord
    trigger: Bundle validation.
    logic: >
      IF every non-manifest archive path has a matching file record AND every file record has a matching archive path
      THEN accept the inventory
      ELSE reject the bundle.
    violation: Return validation-error; the inventory is not trusted for routing.
    source: FR1.2

  - id: BR1.3
    statement: An installable file is verified against its file-record digest before any target write.
    category: validation
    applies_to: ArchiveFileRecord
    trigger: Bundle validation for an installable file.
    logic: >
      IF the file's role is installable
      THEN recompute the file's digest and require an exact match with the file-record digest
      ELSE the file is not a write candidate.
    violation: Return validation-error and write nothing.
    source: FR1.1, NFR1

  - id: BR1.4
    statement: Archive containment and safe paths are enforced before validation trusts an entry.
    category: validation
    applies_to: ArchiveFileRecord
    trigger: Bundle validation.
    logic: >
      IF every archive-relative path is contained within the archive root AND contains no parent-traversal segment
      THEN validate the entry
      ELSE reject the bundle.
    violation: Return validation-error; write nothing.
    source: FR1.1, NFR1

  - id: BR1.5
    statement: A manifest item is installable only when its matching file record has the installable role.
    category: constraint
    applies_to: ManifestItem
    trigger: Bundle validation and destination resolution.
    logic: >
      IF the item's matching archive file record has role installable
      THEN the item is a write candidate
      ELSE the item is retained in the archive but never written.
    violation: An item without a matching installable file record must not produce a destination.
    source: FR1.2

  - id: BR2.1
    statement: A destination is resolved solely from the selected target, scope, and item kind.
    category: constraint
    applies_to: InstallationAddress
    trigger: Every install, update, and destructive operation.
    logic: >
      IF a supported target, an installation scope, and an item kind are known
      THEN resolve the destination through the target's layout
      ELSE refuse the operation.
    violation: A hardcoded runtime root or item path is a rule violation.
    source: FR2

  - id: BR2.2
    statement: Every resolved destination is contained within its destination root.
    category: validation
    applies_to: InstallationAddress
    trigger: Destination resolution and every write or removal.
    logic: >
      IF the resolved destination path resolves inside the destination root after symbolic-link resolution
      THEN proceed with the operation
      ELSE return a safety-blocked outcome and perform no filesystem action.
    violation: A path escape is refused unconditionally, whether it would write, verify, or delete.
    source: FR2, NFR1.1

  - id: BR2.3
    statement: Content is isolated by supported target and installation scope.
    category: constraint
    applies_to: ManagedInstallation
    trigger: Every install, update, and uninstall.
    logic: >
      IF an operation targets one bundle at one target and scope
      THEN it may only read or modify that installation's own artifacts and record
      ELSE the operation is a rule violation.
    violation: Another target's or scope's artifacts and records must remain unchanged.
    source: FR2.2

  - id: BR3.1
    statement: The managed installation key is the identity of a bundle at a target, scope, and repository.
    category: constraint
    applies_to: ManagedInstallation
    trigger: Registry read or write.
    logic: >
      IF a record is looked up or persisted
      THEN key it by bundle identifier, target, scope, and repository identity, allowing each persistence adapter to leave implicit whatever its storage location already determines
      ELSE the record may not be accepted into the registry.
    violation: Two records with the same effective identity are a rule violation.
    source: FR2.1, FR2.2

  - id: BR3.2
    statement: Repository identity is derivable without network access.
    category: constraint
    applies_to: RepositoryIdentity
    trigger: Every install-time or update-time identity derivation.
    logic: >
      IF a canonical remote URL exists for the repository
      THEN the identity is the normalised form of that URL
      ELSE the identity is the absolute workspace root path.
    violation: A network call may not participate in derivation.
    source: FR2.2, FR3.8

  - id: BR3.3
    statement: A managed artifact's fingerprint covers the bytes as written to the target.
    category: constraint
    applies_to: ManagedArtifact
    trigger: Every artifact write during install or update.
    logic: >
      IF the payload is valid UTF-8 THEN fingerprint the encoded content after the transform step
      ELSE fingerprint the archive bytes verbatim.
      The fingerprinted sequence is the exact sequence used for read-back verification.
    violation: An artifact record must not be persisted with a fingerprint over any other sequence.
    source: FR1.3

  - id: BR3.4
    statement: The registry has one schema and two persistence adapters, and the file each uses does not move.
    category: constraint
    applies_to: ManagedInstallation
    trigger: Every registry read and write.
    logic: >
      IF the scope is user THEN persist through the shared application-data adapter
      ELSE persist through the repository lockfile adapter within the selected repository.
    violation: Persisting a user-scope record inside a repository, or a repository-scope record in shared application data, is a rule violation.
    source: FR2.1

  - id: BR3.5
    statement: An artifact is admitted to the registry only after its write was verified.
    category: constraint
    applies_to: ManagedArtifact
    trigger: Every install and update write.
    logic: >
      IF the artifact was written AND the written bytes were read back AND they match the intended bytes
      THEN record the artifact
      ELSE the artifact must not appear in the record.
    violation: An unverified artifact must not enter the registry.
    source: FR1.3, NFR1

  - id: BR4.1
    statement: Every install and update write is verified by reading it back before the operation reports success.
    category: validation
    applies_to: LifecycleOutcome
    trigger: Every write during install or update.
    logic: >
      IF the intended bytes match the bytes read back from the destination
      THEN the write is verified
      ELSE the operation returns retryable-failure or safety-blocked according to why verification failed.
    violation: A successful outcome may not be returned while any write is unverified.
    source: NFR1

  - id: BR4.2
    statement: An omitted artifact is removed only when its current bytes still match its fingerprint.
    category: policy
    applies_to: ManagedArtifact
    trigger: Update whose newer manifest omits a previously managed artifact.
    logic: >
      IF the artifact's current bytes match its installed fingerprint
      THEN remove the artifact and its record
      ELSE preserve the file on disk, report it as preserved, and drop it from the managed artifact set.
    violation: A locally changed file may never be deleted by the lifecycle.
    source: FR1.3

  - id: BR4.3
    statement: A preserved artifact leaves the managed set so a later uninstall does not touch it.
    category: constraint
    applies_to: ManagedArtifact
    trigger: The moment a preservation decision is made under BR4.2.
    logic: >
      IF the artifact is preserved under BR4.2
      THEN remove it from the record's artifact set as part of the same operation
      ELSE the artifact remains managed.
    violation: A preserved artifact remaining managed would be deletable at a later uninstall.
    source: FR1.3

  - id: BR4.4
    statement: A successful update reports the artifacts it preserved.
    category: policy
    applies_to: LifecycleOutcome
    trigger: Update completion.
    logic: >
      IF preservation occurred under BR4.2 or BR4.7 AND every other write was verified
      THEN return a success outcome carrying the list of preserved artifacts
      ELSE the outcome carries no preserved list.
    violation: >
      A successful update that preserved one or more artifacts but returned an
      outcome without them is a rule violation: the caller cannot then tell the
      user which content was retained.
    source: FR1.3

  - id: BR4.5
    statement: Uninstall removes only artifacts still managed by the selected installation.
    category: constraint
    applies_to: ManagedArtifact
    trigger: Uninstall of a managed installation.
    logic: >
      IF an artifact is in the record's managed set
      THEN remove the file at its destination path and drop it from the record
      ELSE the file is untouched.
    violation: Unmanaged files must not be deleted by uninstall, and other installations' artifacts must remain unchanged.
    source: FR1.3, FR2.2

  - id: BR4.6
    statement: Every removal is verified by confirming the path is gone before the operation reports success.
    category: validation
    applies_to: LifecycleOutcome
    trigger: Every removal during update, uninstall, or migration cleanup.
    logic: >
      IF the destination path is absent after the removal call returns
      THEN the removal is verified
      ELSE the operation returns retryable-failure and the artifact record is retained.
    violation: A successful outcome may not be returned while any removal is unverified.
    source: NFR1, NFR1.1

  - id: BR4.7
    statement: A still-named artifact whose bytes no longer match its fingerprint is never overwritten without explicit consent.
    category: policy
    applies_to: ManagedArtifact
    trigger: >
      Install or update, for any destination that a prior managed artifact
      record already covers and the incoming manifest still names. Evaluated
      before the first write of the operation, not after it.
    logic: >
      IF a prior managed artifact exists at the destination
      AND its current bytes differ from its recorded fingerprint
      AND no explicit overwrite consent accompanies the request
      THEN write nothing at that destination, leave the artifact managed with
      its original fingerprint, and return a conflict outcome identifying the
      bundle and the artifact
      ELSE write and verify the artifact normally.
      This extends FR1.3's preservation principle from omitted artifacts to
      still-named ones, and matches the authoritative-target stance the
      migration requirements take for target content.
    violation: >
      Overwriting locally changed content that the lifecycle still manages is a
      rule violation, and install and update may not answer this case
      differently.
    source: FR1.3, NFR1.1

  - id: BR4.8
    statement: The preserved-content outcome is reserved for an operation that could not proceed.
    category: policy
    applies_to: LifecycleOutcome
    trigger: Outcome selection at the end of any lifecycle operation.
    logic: >
      IF the operation completed its requested writes and removals, preserving
      some artifacts along the way
      THEN return success carrying the preserved list under BR4.4
      ELSE, when preservation left the requested change unachievable, return
      preserved-content.
    violation: >
      Returning preserved-content for an operation that did complete, or
      success for one that could not proceed, misreports the outcome to the
      delivery adapter.
    source: FR1.3, NFR4

  - id: BR5.1
    statement: A cleanup journal entry describes one in-flight destructive operation, never outcomes.
    category: constraint
    applies_to: CleanupJournalEntry
    trigger: The lifetime of a cleanup entry.
    logic: >
      IF the operation is destructive
      THEN the entry records only progress-through-states
      ELSE no entry is created.
    violation: The entry must not carry user-facing outcome content or long-lived history.
    source: NFR1.1, NFR4

  - id: BR5.2
    statement: A journal state change is durable before the filesystem action it authorises.
    category: constraint
    applies_to: CleanupJournalEntry
    trigger: Every state transition.
    logic: >
      IF a filesystem action changes the safety envelope
      THEN the journal transition to the state authorising that action is persisted first
      ELSE the action is refused.
    violation: A crash between action and state change may not leave the safety envelope inconsistent.
    source: NFR1.1

  - id: BR5.3
    statement: A journal entry references registry-owned identity and fingerprints rather than copying inventories.
    category: constraint
    applies_to: CleanupJournalEntry
    trigger: Journal entry creation and every progress step.
    logic: >
      IF per-artifact progress needs an identity or expected content match
      THEN reference the corresponding managed artifact by destination path and fingerprint
      ELSE no per-artifact record is added.
    violation: Duplicating inventory data into the journal would create a second source of truth.
    source: NFR1.1

  - id: BR5.4
    statement: A committed journal entry does not outlive its operation.
    category: constraint
    applies_to: CleanupJournalEntry
    trigger: Cleanup reaches the committed state.
    logic: >
      IF the entry is committed
      THEN delete it as the final step of the same operation
      ELSE the operation is incomplete.
    violation: A surviving entry would make the journal durable outcome state.
    source: NFR1.1, NFR4

  - id: BR5.5
    statement: Resuming a journal entry re-reads current bytes before authorising a destructive action.
    category: constraint
    applies_to: CleanupJournalEntry
    trigger: Journal entry resumption after interruption.
    logic: >
      IF a per-artifact progress record is in verified-identical
      THEN re-verify the target and legacy bytes before deletion
      ELSE the deletion is refused until verification succeeds.
    violation: A stale verification claim from a prior run is never sufficient authority.
    source: NFR2

  - id: BR5.6
    statement: First-pass target verification precedes any deletion authority.
    category: validation
    applies_to: CleanupJournalEntry
    trigger: >
      The prepared-to-target-verified transition, on the operation's first pass
      through a journal entry.
    logic: >
      IF every artifact the entry expects at the target is present AND its
      current bytes are byte-identical to the fingerprint recorded for the
      corresponding managed artifact
      THEN persist the transition to target-verified
      ELSE leave the entry in prepared and authorise no deletion.
    violation: >
      Advancing to target-verified while any expected target artifact is absent
      or different would grant deletion authority the target content does not
      support.
    source: NFR1.1, NFR2

  - id: BR5.7
    statement: Every legacy path is contained within the entry's verified legacy source root.
    category: validation
    applies_to: CleanupJournalEntry
    trigger: >
      Journal entry creation, and every comparison, verification, or deletion
      touching a legacy path.
    logic: >
      IF the legacy path resolves inside the entry's legacy source root after
      symbolic-link resolution AND contains no parent-traversal segment
      THEN the path may be compared, verified, or deleted
      ELSE return a safety-blocked outcome and perform no filesystem action on it.
    violation: >
      A legacy path escaping its source root, or reachable only through an
      unsafe symbolic link, is refused unconditionally — the same containment
      bar BR2.2 sets for destinations.
    source: NFR1.1

  - id: BR6.1
    statement: Identity derivation is offline; redirect resolution is a separate reconciliation-only step.
    category: constraint
    applies_to: RepositoryIdentity
    trigger: A stored record matches no open workspace.
    logic: >
      IF a stored record's identity value matches no open workspace
      THEN request redirect resolution through the injected reconciliation port and, when a redirect confirms the old identity now points at the current one, re-key the record
      ELSE leave the record untouched.
    violation: The shared foundation may not take a direct network dependency; reconciliation must go through the port.
    source: FR3.7, FR3.8

  - id: BR6.2
    statement: Redirect resolution is skipped when the reconciliation port cannot reach the network.
    category: policy
    applies_to: RepositoryIdentity
    trigger: Redirect resolution requested under BR6.1.
    logic: >
      IF the reconciliation port reports network unavailable
      THEN leave the stored record untouched and return without a match
      ELSE proceed with the redirect check.
    violation: Offline behavior may not block on a network call or invent a match.
    source: FR3.7, ASM3
```

## Summary

| id | statement | category | source |
| --- | --- | --- | --- |
| BR1.1 | Exactly one root deployment manifest is required. | validation | FR1.1 |
| BR1.2 | Every non-manifest archive file has one file record. | validation | FR1.2 |
| BR1.3 | Installable file digests are verified before any write. | validation | FR1.1, NFR1 |
| BR1.4 | Archive containment and safe paths are enforced. | validation | FR1.1, NFR1 |
| BR1.5 | Only installable-roled items are write candidates. | constraint | FR1.2 |
| BR2.1 | Destinations resolve from target, scope, and item kind alone. | constraint | FR2 |
| BR2.2 | Every destination stays inside its destination root. | validation | FR2, NFR1.1 |
| BR2.3 | Content is isolated by target and scope. | constraint | FR2.2 |
| BR3.1 | Record identity is bundle + target + scope + repository. | constraint | FR2.1, FR2.2 |
| BR3.2 | Repository identity is derived without network access. | constraint | FR2.2, FR3.8 |
| BR3.3 | Fingerprint the bytes as written, post-transform. | constraint | FR1.3 |
| BR3.4 | One registry schema, two persistence locations that do not move. | constraint | FR2.1 |
| BR3.5 | Only verified artifacts are admitted to the registry. | constraint | FR1.3, NFR1 |
| BR4.1 | Success requires every write to be read-back verified. | validation | NFR1 |
| BR4.2 | Preserve, never delete, locally changed omitted artifacts. | policy | FR1.3 |
| BR4.3 | A preserved artifact leaves the managed set. | constraint | FR1.3 |
| BR4.4 | A successful update reports the artifacts it preserved. | policy | FR1.3 |
| BR4.5 | Uninstall touches only still-managed artifacts. | constraint | FR1.3, FR2.2 |
| BR4.6 | Success requires every removal to be verified absent. | validation | NFR1, NFR1.1 |
| BR4.7 | A still-named, locally changed artifact is never overwritten without consent. | policy | FR1.3, NFR1.1 |
| BR4.8 | preserved-content is reserved for an operation that could not proceed. | policy | FR1.3, NFR4 |
| BR5.1 | The journal describes operations in flight, not outcomes. | constraint | NFR1.1, NFR4 |
| BR5.2 | State transitions are durable before their filesystem actions. | constraint | NFR1.1 |
| BR5.3 | The journal references registry data rather than copying it. | constraint | NFR1.1 |
| BR5.4 | Committed entries are deleted in the same operation. | constraint | NFR1.1, NFR4 |
| BR5.5 | Resuming re-verifies current bytes. | constraint | NFR2 |
| BR5.6 | First-pass target verification precedes any deletion authority. | validation | NFR1.1, NFR2 |
| BR5.7 | Every legacy path stays inside its verified legacy source root. | validation | NFR1.1 |
| BR6.1 | Derivation is offline; redirect resolution goes through a reconciliation port. | constraint | FR3.7, FR3.8 |
| BR6.2 | Redirect resolution is skipped when the network is unavailable. | policy | FR3.7, ASM3 |
