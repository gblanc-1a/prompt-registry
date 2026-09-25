# Entities — Shared Installation Foundation (U1)

Technology-agnostic entity model for the shared, manifest-driven installation
lifecycle. The YAML block below is the source of truth; the prose after it
summarises the entity set.

```yaml
entities:
  - name: GovernedBundleManifest
    description: >
      The validated root manifest that authorises an installation. A bundle is
      installable only when exactly one of these is found at the archive root.
      Upstream naming note: Domain Design's component catalogue calls this
      entity `BundleManifest` and assigns it to `ManifestGovernance`. It is
      named `GovernedBundleManifest` here because this model distinguishes the
      raw manifest read from the archive from the validated form that has
      passed BR1.1 through BR1.4; only the validated form ever reaches routing
      or the registry. The two names denote the same owned entity.
    attributes:
      - name: bundleId
        type: identifier
        required: true
        constraints: Stable across versions; identifies the bundle for lifecycle operations.
      - name: version
        type: string
        required: true
        constraints: The bundle's own released version; not a version of any internal contract.
      - name: formatVersion
        type: string
        required: true
        constraints: Manifest format version; an unrecognised value rejects the bundle.
      - name: name
        type: string
        required: true
      - name: description
        type: string
        required: false
    constraints:
      - Exactly one manifest may exist at the archive root; zero or more than one rejects the bundle.
      - The canonical primitive inventory is the item set; the legacy projection is never required for installation.
      - The manifest never contains the archive's own digest, so archive identity is external to it.
    relationships:
      - to: ManifestItem
        cardinality: one-to-many
        direction: owns
      - to: ArchiveFileRecord
        cardinality: one-to-many
        direction: owns
      - to: BundleProvenance
        cardinality: one-to-one
        direction: owns

  - name: ManifestItem
    description: >
      One canonical primitive declared by the manifest. Carries routing
      identity, not integrity; integrity belongs to the matching archive file
      record.
    attributes:
      - name: itemId
        type: identifier
        required: true
        unique: true
        constraints: Unique within one manifest.
      - name: archivePath
        type: path
        required: true
        constraints: Archive-relative; no absolute path and no parent traversal segment.
      - name: kind
        type: enum
        required: true
        constraints: Drawn from the canonical primitive vocabulary; determines the destination subtree.
      - name: contentHash
        type: digest
        required: false
        constraints: >
          Optional per-item integrity assertion from the authoritative root
          deployment-manifest.yml items[] inventory. When present, it is a
          SHA-256 over the referenced archive bytes and must match before a
          target write. When absent, the governed item remains installable:
          archive membership, archive-relative path, and kind still come from
          items[], and byte-for-byte target read-back verifies the actual
          archive bytes written.
      - name: name
        type: string
        required: false
      - name: description
        type: string
        required: false
    constraints:
      - Every item must have a matching archive file record at the same archive path.
      - An item is installable only when its matching file record has the installable role.
    relationships:
      - to: GovernedBundleManifest
        cardinality: many-to-one
        direction: belongs-to
      - to: ArchiveFileRecord
        cardinality: one-to-one
        direction: references

  - name: ArchiveFileRecord
    description: >
      Integrity and policy record for one file inside the archive. This is
      where per-file integrity lives, and the role decides whether the file is
      ever written to a target.
    attributes:
      - name: archivePath
        type: path
        required: true
        unique: true
        constraints: Archive-relative; excludes the root manifest itself.
      - name: role
        type: enum
        required: true
        allowed_values: [installable, metadata, ignored]
        constraints: Only an installable file is a candidate for a target write.
      - name: size
        type: integer
        required: true
        min: 0
        constraints: Exact uncompressed byte length.
      - name: contentDigest
        type: digest
        required: false
        constraints: >
          Derived from the optional ManifestItem.contentHash assertion. When a
          hash is supplied, it is verified against archive bytes before a
          write. When absent, this record records no independent digest and
          the accepted no-hash path relies on items[] governance plus required
          target read-back verification of the actual archive bytes.
    constraints:
      - Every archive file except the root manifest has exactly one record.
      - A file present in the archive with no record, or a record with no file, rejects the bundle.
      - The root deployment-manifest.yml `items[]` inventory is authoritative for governed installable membership, path, and kind; a missing optional per-item hash is not an inventory failure.
    relationships:
      - to: GovernedBundleManifest
        cardinality: many-to-one
        direction: belongs-to

  - name: BundleProvenance
    description: Immutable source facts resolved when the bundle was packaged.
    attributes:
      - name: source
        type: string
        required: true
      - name: revision
        type: string
        required: true
      - name: license
        type: string
        required: true
    constraints:
      - Recorded for governance and reporting; never used to resolve a destination.
    relationships:
      - to: GovernedBundleManifest
        cardinality: one-to-one
        direction: belongs-to

  - name: SupportedTarget
    description: >
      A named runtime destination whose layout determines where each item kind
      is written. Targets are data-driven, so adding one adds no lifecycle rule.
    attributes:
      - name: targetName
        type: identifier
        required: true
        unique: true
      - name: targetType
        type: enum
        required: true
        constraints: Selects the layout definition.
      - name: rootPath
        type: path
        required: false
        constraints: Required when the scope is not user scope.
      - name: allowedKinds
        type: list of enum
        required: false
        constraints: When present, restricts which item kinds this target accepts.
    relationships:
      - to: InstallationAddress
        cardinality: one-to-many
        direction: referenced-by

  - name: InstallationScope
    description: >
      Whether an installation belongs to the current user or to a specific
      repository. Scope selects both the destination layout and which registry
      adapter persists the record.
    attributes:
      - name: scopeValue
        type: enum
        required: true
        allowed_values: [user, repository]
        constraints: >
          The requirements define these two scopes. A target declaring a
          workspace scope routes through the repository-scope layout when a root
          path is present, rather than introducing a third routing rule.
    relationships:
      - to: InstallationAddress
        cardinality: one-to-many
        direction: referenced-by

  - name: RepositoryIdentity
    description: >
      Identifies the repository a repository-scope installation belongs to, so
      records for different repositories never collide and a legacy record can
      be associated with an open workspace.
    attributes:
      - name: canonicalRemoteUrl
        type: string
        required: false
        constraints: Normalised form of the repository's canonical remote; absent when the repository has no remote.
      - name: workspaceRootPath
        type: path
        required: false
        constraints: Absolute path; used as the identity only when no canonical remote exists.
      - name: identityValue
        type: string
        required: true
        constraints: >
          The normalised canonical remote URL when one exists, otherwise the
          absolute workspace root path. Derived without network access so it is
          available during an offline install.
    constraints:
      - At least one of the canonical remote URL or the workspace root path must be present.
      - Derivation never consults the network (BR3.2); only reconciliation may resolve a redirect, and only through the injected adapter-supplied port (BR6.2).
      - A stored identity changes only through reconcileRepositoryIdentity on exactly one confirmed redirect (BR6.1); U1 never infers a candidate itself (BR6.3).
    relationships:
      - to: ManagedInstallation
        cardinality: one-to-many
        direction: referenced-by

  - name: InstallationAddress
    description: >
      The resolved, contained destination for one item kind under one target
      and scope. Produced by routing; never stored as lifecycle policy.
    attributes:
      - name: destinationRoot
        type: path
        required: true
        constraints: Absolute and fully resolved; no unresolved path token may remain.
      - name: itemKind
        type: enum
        required: true
      - name: destinationPath
        type: path
        required: true
        constraints: Contained within the destination root after symbolic-link resolution.
    constraints:
      - A destination resolving outside its destination root is refused before any write.
      - Resolution depends only on target, scope, and item kind.
    relationships:
      - to: SupportedTarget
        cardinality: many-to-one
        direction: references
      - to: InstallationScope
        cardinality: many-to-one
        direction: references

  - name: ManagedInstallation
    description: >
      The record of one installed bundle at one target and scope. One logical
      record with two persistence locations: user-scope records in shared
      application data, repository-scope records in the repository's own
      lockfile.
    attributes:
      - name: installationKey
        type: identifier
        required: true
        unique: true
        constraints: >
          Derived from bundle identity, target, scope, and repository identity.
          Each persistence adapter may leave implicit whatever its storage
          location already determines.
      - name: bundleId
        type: identifier
        required: true
      - name: target
        type: reference
        required: true
        constraints: Explicit supported-target identity; participates in installation-key derivation and destination-ownership isolation.
      - name: scope
        type: reference
        required: true
        constraints: Explicit installation-scope identity; participates in installation-key derivation and destination-ownership isolation.
      - name: manifestVersion
        type: string
        required: true
      - name: installedAt
        type: timestamp
        required: true
      - name: sourceId
        type: identifier
        required: false
        constraints: Retained for identity matching across re-synchronisation.
      - name: repositoryIdentity
        type: reference
        required: false
        constraints: Required for repository scope; absent for user scope.
    constraints:
      - One record per bundle, target, scope, and repository identity combination.
      - An operation on one record never alters another record's artifacts or state.
      - Repository-scope records remain within their repository; user-scope records remain in shared application data.
    relationships:
      - to: ManagedArtifact
        cardinality: one-to-many
        direction: owns
      - to: RepositoryIdentity
        cardinality: many-to-one
        direction: references

  - name: ManagedArtifact
    description: >
      One installed file the registry is accountable for. Its fingerprint is
      what distinguishes content still owned by the installation from content
      the user has since changed.
    attributes:
      - name: destinationPath
        type: path
        required: true
        unique: true
        constraints: Unique within one managed installation.
      - name: itemKind
        type: enum
        required: true
      - name: installedFingerprint
        type: digest
        required: true
        constraints: >
          SHA-256 over the exact byte sequence written to the target, after any
          content transformation. The same sequence that read-back verification
          compares, so verification and fingerprinting share one pass.
      - name: sizeInBytes
        type: integer
        required: true
        min: 0
    constraints:
      - An artifact exists in the record only after its write was verified.
      - An artifact whose current bytes differ from its fingerprint is treated as locally changed and is never deleted by the lifecycle.
    relationships:
      - to: ManagedInstallation
        cardinality: many-to-one
        direction: belongs-to

  - name: CleanupJournalEntry
    description: >
      Restart-safety record for one in-flight destructive cleanup. Describes an
      operation in progress, not steady state, and does not outlive the
      operation that created it.
    attributes:
      - name: entryId
        type: identifier
        required: true
        unique: true
        constraints: U1 mints once at entry creation; a closed entry ID is never reused for a later cleanup operation.
      - name: generation
        type: positive integer
        required: true
        constraints: Starts at 1 and increments whenever U1 changes the authoritative entry state or artifact-progress set; verification evidence must match the live generation.
      - name: installationKey
        type: identifier
        required: true
        unique: true
        constraints: References the managed installation being reconciled; at most one live entry per key.
      - name: state
        type: enum
        required: true
        allowed_values: [prepared, target-verified, legacy-delete-pending, committed]
        constraints: >
          Advances only along the legal forward transitions; a repeated
          transition into legacy-delete-pending is permitted and is how
          per-artifact deletion progress becomes durable (BR5.10).
      - name: legacySourceRoot
        type: path
        required: true
        constraints: >
          The verified root containing the legacy content. Every legacy path
          must resolve inside it after symbolic-link resolution; BR5.7 enforces
          this and refuses any escaping path with a safety-blocked outcome.
      - name: updatedAt
        type: timestamp
        required: true
    constraints:
      - Carries safety progress only; it is never a record of migration outcomes.
      - A state change is durable before the filesystem action it authorises is attempted.
      - A committed entry is deleted as the final step of the same operation, so no finished entry remains.
      - The entry references registry-owned identity and fingerprints rather than copying inventories.
    relationships:
      - to: CleanupArtifactProgress
        cardinality: one-to-many
        direction: owns
      - to: ManagedInstallation
        cardinality: many-to-one
        direction: references

  - name: CleanupArtifactProgress
    description: >
      Per-artifact progress inside one journal entry, so an interrupted cleanup
      resumes at the exact artifact it stopped on.
    attributes:
      - name: legacyPath
        type: path
        required: true
        unique: true
      - name: expectedTargetPath
        type: path
        required: true
      - name: expectedFingerprint
        type: digest
        required: false
        constraints: >
          References the fingerprint held by the corresponding managed artifact.
          Optional because the journal references registry-owned fingerprints
          rather than copying them (BR5.3); when absent, the expected value is
          read from the managed artifact at verification time.
      - name: progressState
        type: enum
        required: true
        allowed_values: [pending, verified-identical, deleted, preserved]
        constraints: >
          Matches the Contract 3 CleanupArtifactState vocabulary exactly. There
          is no separate post-deletion state: BR4.6 requires absence to be
          verified before `deleted` is recorded at all, so a recorded `deleted`
          already means "removed and verified absent".
    constraints:
      - Deletion is attempted only from the verified-identical state.
      - A preserved entry records that the artifact was intentionally retained and must never be retried as a deletion.
    relationships:
      - to: CleanupJournalEntry
        cardinality: many-to-one
        direction: belongs-to

  - name: DestinationOwnershipClaim
    description: >
      Durable U1-owned reservation and ownership record for one target, scope,
      and destination path. It serializes competing lifecycle and migration
      writes and carries enough state for U1, rather than a delivery adapter, to
      resolve an interrupted hand-off or materialization.
    attributes:
      - name: claimId
        type: identifier
        required: true
        unique: true
      - name: target
        type: reference
        required: true
      - name: scope
        type: reference
        required: true
      - name: destinationPath
        type: path
        required: true
      - name: ownerInstallation
        type: reference
        required: true
      - name: generation
        type: positive integer
        required: true
      - name: state
        type: enum
        required: true
        allowed_values: [claimed, pending-materialization, finalized, rollback-required]
      - name: acquiringInstallation
        type: reference
        required: false
      - name: cedingInstallation
        type: reference
        required: false
      - name: priorManagedArtifact
        type: reference
        required: false
      - name: intendedFingerprint
        type: digest
        required: false
    constraints:
      - The tuple target, scope, destinationPath is unique across live claims.
      - U1 atomically creates or transfers the claim before target materialization; a competing writer sees claimed or pending-materialization, never an unowned destination.
      - Only U1 resolves pending-materialization or rollback-required: it finalizes after read-back verification, restores the ceding record on rollback when target bytes were not materialized, or returns a preserved retry outcome while retaining recovery evidence.
    relationships:
      - to: ManagedInstallation
        cardinality: many-to-one
        direction: references-owner-and-optional-ceding-owner
      - to: ManagedArtifact
        cardinality: one-to-one
        direction: references-prior-or-final-artifact

  - name: LifecycleOutcome
    description: >
      The explicit result of one lifecycle operation. Expected conditions are
      values, not failures, so delivery adapters map them to their own
      presentation.
    attributes:
      - name: kind
        type: enum
        required: true
        allowed_values:
          - success
          - validation-error
          - conflict
          - preserved-content
          - retryable-failure
          - safety-blocked
      - name: preservedArtifacts
        type: list of reference
        required: false
        constraints: >
          Present on a successful update that retained locally changed content.
          Preservation does not by itself make the operation unsuccessful.
      - name: detail
        type: string
        required: false
        constraints: Identifies the affected bundle and artifact where applicable.
    constraints:
      - A successful outcome is returned only after every write and removal in the operation was verified.
      - Preserved content is reported on the outcome rather than persisted as separate state.

  - name: MigrationTransferOutcome
    description: >
      The result of one `transferThroughLifecycle` call. A distinct union from
      `LifecycleOutcome` because the migration boundary has outcomes the normal
      lifecycle does not — a legacy copy that is already a verified duplicate,
      and a legacy installation deliberately left alone. Contract Design names
      this type `MigrationTransferResult`; the two names denote the same union.
    attributes:
      - name: kind
        type: enum
        required: true
        allowed_values:
          - transferred
          - verified-duplicate
          - preserved-conflict
          - retry-required
          - skipped
          - safety-blocked
        constraints: >
          Every exit of the migration transfer workflow returns one of these
          values. A `LifecycleOutcome.kind` raised by an inner lifecycle call is
          mapped to its member here and never returned directly.
      - name: transferredArtifacts
        type: list of reference
        required: false
        constraints: Present on `transferred`; the managed artifacts now verified at the target.
      - name: detail
        type: string
        required: false
        constraints: >
          Identifies the affected bundle and artifact. Required on
          `preserved-conflict`, `retry-required`, `skipped`, and
          `safety-blocked` so the caller can report which installation is
          affected and why.
    constraints:
      - Legacy content is intact for every kind except `transferred`, where it becomes eligible for journaled cleanup.
      - No durable per-installation migration state is created to produce this value.
    relationships:
      - to: LifecycleOutcome
        cardinality: one-to-one
        direction: maps-from

  - name: CleanupJournalEntryResult
    description: >
      The result of `openCleanupJournalEntry`, `recordCleanupTransition`, and
      `readCleanupJournalEntry`. Distinct from the lifecycle unions because the
      journal boundary has outcomes the lifecycle does not — resuming a live
      entry, finding none, and refusing a mismatched legacy source root.
    attributes:
      - name: kind
        type: enum
        required: true
        allowed_values:
          - created
          - resumed
          - absent
          - source-root-mismatch
          - validation-error
          - retryable-failure
          - safety-blocked
        constraints: >
          `created` and `resumed` come from open and transition calls; `absent`
          is returned only by read and close, never by open.
      - name: entry
        type: reference
        required: false
        constraints: Present on `created` and `resumed`; the live journal entry with its progress set.
      - name: detail
        type: string
        required: false
        constraints: >
          Required on `source-root-mismatch` (naming both roots),
          `validation-error`, and `retryable-failure` so the caller can tell an
          illegal transition from a contended key.
    constraints:
      - No kind other than `created` or `resumed` grants any deletion authority.
      - A `resumed` entry still re-verifies current bytes before a destructive action (BR5.5).
    relationships:
      - to: CleanupJournalEntry
        cardinality: one-to-one
        direction: references

  - name: CleanupJournalCloseResult
    description: The result of `closeCleanupJournalEntry`, whether committed or abandoned.
    attributes:
      - name: kind
        type: enum
        required: true
        allowed_values: [closed, absent, retryable-failure]
      - name: detail
        type: string
        required: false
    constraints:
      - An `abandoned` disposition is legal only from prepared or target-verified; from legacy-delete-pending the close is refused as a validation error (BR5.11).

  - name: RepositoryReconciliationResult
    description: >
      The result of `reconcileRepositoryIdentity`. Re-keying is deliberately
      conservative: anything short of exactly one confirmed redirect is a skip
      that leaves the stored record untouched.
    attributes:
      - name: kind
        type: enum
        required: true
        allowed_values: [rekeyed, skipped, validation-error, retryable-failure]
      - name: previousIdentity
        type: reference
        required: false
        constraints: Present on `rekeyed`; the identity the record was keyed under before.
      - name: newIdentity
        type: reference
        required: false
        constraints: Present on `rekeyed`; the confirmed identity the record now uses.
      - name: skipReason
        type: enum
        required: false
        allowed_values: [no-record, no-candidates, no-confirmation, ambiguous-confirmation, redirect-unavailable, no-redirect-port]
        constraints: Required on `skipped` so the caller can distinguish offline from ambiguous.
    constraints:
      - Managed artifacts and their fingerprints are never altered by reconciliation; only the record's key changes (BR6.5).
      - A skip is never an error: it is the expected outcome offline and whenever evidence is not unambiguous.
    relationships:
      - to: ManagedInstallation
        cardinality: one-to-one
        direction: references
      - to: RepositoryIdentity
        cardinality: many-to-one
        direction: references

  - name: ArtifactVerificationResult
    description: >
      The result of one `verifyManagedArtifacts` call: whether each expected
      target artifact is present and byte-identical to the fingerprint the
      registry recorded. This is the shared evidence behind U4's
      verified-duplicate decision, its pre-deletion byte comparison, and the
      journal's first-pass and resumption checks.
    attributes:
      - name: allVerified
        type: boolean
        required: true
        constraints: True only when every requested artifact verified as present-identical.
      - name: artifactVerdicts
        type: list of enum
        required: true
        allowed_values: [present-identical, present-different, absent, safety-blocked]
        constraints: One verdict per requested artifact, each naming its destination path.
      - name: detail
        type: string
        required: false
    constraints:
      - The verdicts describe bytes read during this call; a verdict is never carried across operations as standing authority.
      - A `safety-blocked` verdict on any artifact prevents `allVerified` regardless of the other verdicts.
    relationships:
      - to: ManagedArtifact
        cardinality: one-to-many
        direction: references
```

## Entity groups

The model contains nineteen entities across four groups. The groups below are derived from the YAML source of truth above; they do
not add independent fields or relationships.

## Bundle governance — `GovernedBundleManifest` with its `ManifestItem` set,
`ArchiveFileRecord` set, and `BundleProvenance`. The split between items and
file records is the load-bearing detail: items carry routing identity (path,
kind) while file records carry integrity (size, digest) and the role that
decides whether a file is ever written. Only an `installable` file is a write
candidate; `metadata` and `ignored` files stay in the archive deliberately.
Domain Design calls the first entity `BundleManifest`; the name here marks the
validated form, and the entity is the same one.

**Addressing** — `SupportedTarget`, `InstallationScope`, `RepositoryIdentity`,
and the resolved `InstallationAddress`. Destinations are derived from target,
scope, and item kind, so no runtime root is embedded in lifecycle policy.
Repository identity is derivable offline, which keeps installation working with
no network. `RepositoryIdentity` is an addition to the upstream component
catalogue; the functional specification records it as a boundary change with its
rationale.

**Managed state** — `ManagedInstallation` and its `ManagedArtifact` set. One
logical record, two persistence locations: shared application data for user
scope, the repository's own lockfile for repository scope. The artifact
fingerprint covers the bytes as written, which is what lets the lifecycle tell
its own content from content the user has edited.

**Operations** — `CleanupJournalEntry` with `CleanupArtifactProgress`,
`LifecycleOutcome`, `MigrationTransferOutcome`, `ArtifactVerificationResult`,
and the three boundary result unions `CleanupJournalEntryResult`,
`CleanupJournalCloseResult`, and `RepositoryReconciliationResult`. The journal
result union is kept separate from the lifecycle unions for the same reason the
migration union is: it carries outcomes the lifecycle has no vocabulary for —
resuming a live entry, finding none, and refusing a mismatched legacy source
root. `RepositoryReconciliationResult` treats every ambiguous or offline case as
`skipped` with a reason rather than an error, because leaving a record untouched
is the correct conservative outcome. The journal is deliberately not shaped like the
registry record: the registry describes steady state and outlives every
operation, while the journal describes one destructive operation in flight and
is deleted when it commits. It references registry-owned fingerprints rather
than copying them, so there is one source of truth for what is managed. The two
result unions are kept separate on purpose — the normal lifecycle has no
`verified-duplicate` or `skipped` outcome, and the migration boundary must not
inherit outcome kinds it cannot honour.
