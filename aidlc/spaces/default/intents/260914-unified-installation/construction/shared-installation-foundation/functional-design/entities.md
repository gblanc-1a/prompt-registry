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
        required: true
        constraints: SHA-256 over the archive bytes, in canonical prefixed lowercase hexadecimal form.
    constraints:
      - Every archive file except the root manifest has exactly one record.
      - A file present in the archive with no record, or a record with no file, rejects the bundle.
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
      - Derivation never consults the network; only reconciliation may resolve a redirect.
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
      - name: installationKey
        type: identifier
        required: true
        unique: true
        constraints: References the managed installation being reconciled; at most one live entry per key.
      - name: state
        type: enum
        required: true
        allowed_values: [prepared, target-verified, legacy-delete-pending, committed]
      - name: legacySourceRoot
        type: path
        required: true
        constraints: The verified root containing the legacy content; every legacy path must resolve inside it.
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
        required: true
        constraints: References the fingerprint held by the corresponding managed artifact.
      - name: progressState
        type: enum
        required: true
        allowed_values: [pending, verified-identical, deleted, absent-after-delete, preserved]
    constraints:
      - Deletion is attempted only from the verified-identical state.
      - A preserved entry records that the artifact was intentionally retained and must never be retried as a deletion.
    relationships:
      - to: CleanupJournalEntry
        cardinality: many-to-one
        direction: belongs-to

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
```

## Summary

Eleven entities across four groups.

**Bundle governance** — `GovernedBundleManifest` with its `ManifestItem` set,
`ArchiveFileRecord` set, and `BundleProvenance`. The split between items and
file records is the load-bearing detail: items carry routing identity (path,
kind) while file records carry integrity (size, digest) and the role that
decides whether a file is ever written. Only an `installable` file is a write
candidate; `metadata` and `ignored` files stay in the archive deliberately.

**Addressing** — `SupportedTarget`, `InstallationScope`, `RepositoryIdentity`,
and the resolved `InstallationAddress`. Destinations are derived from target,
scope, and item kind, so no runtime root is embedded in lifecycle policy.
Repository identity is derivable offline, which keeps installation working with
no network.

**Managed state** — `ManagedInstallation` and its `ManagedArtifact` set. One
logical record, two persistence locations: shared application data for user
scope, the repository's own lockfile for repository scope. The artifact
fingerprint covers the bytes as written, which is what lets the lifecycle tell
its own content from content the user has edited.

**Operations** — `CleanupJournalEntry` with `CleanupArtifactProgress`, and
`LifecycleOutcome`. The journal is deliberately not shaped like the registry
record: the registry describes steady state and outlives every operation, while
the journal describes one destructive operation in flight and is deleted when it
commits. It references registry-owned fingerprints rather than copying them, so
there is one source of truth for what is managed.
