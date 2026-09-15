# Requirements: Unified Bundle Installation Migration

## Sources

- [desc] Initial description: `aidlc engine workspace project-description`
- [intent] `aidlc/spaces/default/intents/260914-unified-installation/ideation/intent-capture/intent-statement.md`
- [scope] `aidlc/spaces/default/intents/260914-unified-installation/ideation/scope-definition/scope-document.md`
- [RE-business] `aidlc/spaces/default/codekb/prompt-registry/business-overview.md`
- [RE-architecture] `aidlc/spaces/default/codekb/prompt-registry/architecture.md`
- [RE-structure] `aidlc/spaces/default/codekb/prompt-registry/code-structure.md`
- [Q1-Q8] `aidlc/spaces/default/intents/260914-unified-installation/inception/requirements-analysis/requirements-analysis-questions.md`
- [confirmation] Consolidated stakeholder answers confirmed in `requirements-analysis-questions.md`
- [revision] Stakeholder direction recorded during the Requirements Analysis approval review

## Intent Analysis

The migration removes divergent bundle installation behavior between the CLI
and the VS Code extension. It must replace the CLI's rigid archive-path
assumption and the extension's cache-then-sync path with one manifest-driven,
target-aware lifecycle. Runtime files must resolve to the layout-derived root
for the selected target and scope; application cache and installation records
must remain owned by the shared XDG application storage. Existing
extension-managed content must move only after target verification and the
required user confirmation for conflicts. [desc] [intent] [scope]
[RE-business] [revision]

## Functional Requirements

### Shared Manifest-Driven Installation

#### FR1. Shared lifecycle entry point

The system shall provide one shared application-layer lifecycle for bundle
install, update, and uninstall operations, used by both the CLI and the VS
Code extension. The extension shall limit its responsibility to VS
Code-specific composition, commands, notifications, and bookkeeping. [intent]
[scope] [RE-architecture] [RE-structure]

**Acceptance criteria**

- Given the CLI installs a valid bundle, when it selects a target and scope,
  then it invokes the shared lifecycle rather than a CLI-specific target-write
  path.
- Given the VS Code extension installs, updates, or uninstalls a valid bundle,
  when it selects a target and scope, then it invokes that same shared
  lifecycle rather than reopening cached content for a second sync path.

#### FR1.3. Shared update and uninstall behavior

The shared lifecycle shall update and uninstall the managed installation for
the selected bundle, target, and scope. An update shall apply the current
governed `items[]` content to that installation and update its shared
installation record. When a valid newer manifest omits an artifact previously
recorded as managed, the lifecycle shall remove that artifact only when its
current bytes match the content recorded for the prior installation. When the
bytes differ, it shall preserve and report the locally changed artifact, and
remove it from the managed artifact set so a later uninstall does not delete
it. An uninstall shall remove only the managed artifacts and installation
record for that installation; it shall not alter another target, scope, or
unmanaged content. [intent] [scope] [Q12] [RE-business] [RE-structure]

**Acceptance criteria**

- Given a managed `items[]` bundle is installed for a selected target and
  scope, when either entry point updates it with a valid newer bundle, then
  the shared lifecycle updates its managed target artifacts and installation
  record for that same target and scope.
- Given a managed bundle is installed for a selected target and scope, when
  either entry point uninstalls it, then the shared lifecycle removes that
  installation's managed target artifacts and installation record while
  leaving other targets, scopes, and unmanaged content unchanged.
- Given a newer valid manifest omits an artifact recorded for a prior managed
  installation, when that artifact still matches its recorded prior content,
  then the shared lifecycle removes it from the target and the managed
  installation record.
- Given a newer valid manifest omits an artifact recorded for a prior managed
  installation, when that artifact's current bytes differ from its recorded
  prior content, then the shared lifecycle preserves and reports the artifact,
  removes it from the managed installation record, and does not remove it on a
  later uninstall.

#### FR1.1. Root-manifest archive validation

The system shall accept a ZIP bundle only when it contains exactly one root
`deployment-manifest.yml`. The manifest shall declare archive-relative content
paths, and each item's kind shall determine the destination selected by the
target layout. The CLI shall not require a hardcoded internal archive path.
[scope] [Q1] [RE-business]

**Acceptance criteria**

- Given a valid ZIP whose root manifest references archive-relative content,
  when the CLI installs it, then installation succeeds without relying on a
  hardcoded archive subdirectory.
- Given a ZIP without exactly one valid root manifest, when either entry point
  attempts installation, then it rejects the bundle before target files are
  written.

#### FR1.2. Canonical manifest items

The shared lifecycle shall install governed `items[]` entries as the canonical
manifest representation. It shall not require the optional `prompts[]` field
for VS Code installation behavior. [RE-business] [RE-structure]

**Acceptance criteria**

- Given a valid manifest containing installable `items[]` entries and no
  `prompts[]` entries, when either entry point installs it, then the expected
  target content is installed.

### Target-Aware Lifecycle and Storage Ownership

#### FR2. Target and scope routing

The system shall resolve runtime destination paths from the selected target,
item kind, and requested user or repository scope. It shall not hardcode a
runtime root in lifecycle or migration requirements. Both user-scope and
repository-scope content shall be installed at the layout-derived destination
for the selected target, scope, and item kind. [intent] [scope] [Q9]
[revision]

**Acceptance criteria**

- Given a user-scope installation for any supported target, when a valid bundle
  is installed, then its runtime files are written to the destination resolved
  by that target's user-scope layout and the item's kind.
- Given a repository-scope installation, when a valid bundle is installed,
  then its runtime files and repository records remain at the destination
  resolved by the selected target's repository-scope layout rather than
  user-scope storage.

#### FR2.1. Shared application data ownership

The system shall store the shared user-scope bundle cache in the existing CLI
XDG cache location and the shared installation registry in the existing CLI
XDG data location. It shall not treat any runtime target as the owner of shared
application records. [scope] [Q1-Q8] [RE-business] [revision]

**Acceptance criteria**

- Given either entry point completes a user-scope lifecycle operation, when it
  reads or writes shared cache or registry data, then it uses the shared XDG
  application storage boundary.
- Given a repository lifecycle operation, when it reads or writes a lockfile,
  then the lockfile remains rooted in that repository.

#### FR2.2. Target and scope isolation

The system shall isolate install, update, and uninstall state and artifacts by
supported target and by user or repository scope. An operation for one target
or scope shall not alter another target's artifacts or state. [intent] [scope]

**Acceptance criteria**

- Given installations for two distinct targets or scopes, when one is updated
  or uninstalled, then the other installation's target files and lifecycle
  records remain unchanged.

### Extension Migration

#### FR3. Activation-time migration

The VS Code extension shall inspect and perform its one-time migration during
extension activation, before users run bundle commands. [Q1]

**Acceptance criteria**

- Given extension-managed legacy bundle content exists, when the extension
  activates, then migration inspection occurs before any bundle install,
  update, or uninstall command is handled.

#### FR3.1. Authoritative target content

The migration shall treat content already present at the selected runtime
destination as a conflict requiring the user's decision. It shall not overwrite
target content with legacy extension content unless the user explicitly chooses
to overwrite it. [scope] [Q3] [revision]

**Acceptance criteria**

- Given matching bundle identities exist at a target and in legacy extension
  storage, when their managed content differs, then the target copy remains
  unchanged until the user explicitly chooses to overwrite it.

#### FR3.2. Verified duplicate cleanup

The migration shall remove an extension-stored duplicate only after verifying
both installation identity and all managed content match the target copy. Before
removing each legacy artifact, it shall confirm that every expected target
artifact exists and is identical. After deletion, it shall verify that no
managed legacy artifact remains at the previous location. It shall include the
cleanup result in the activation-time user-facing summary or standard diagnostics
without adding durable migration state. [scope] [Q4] [Q7] [Q10] [revision]

**Acceptance criteria**

- Given matching identity and managed content at the legacy and target
  locations, when migration runs, then it verifies every expected target
  artifact exists and is identical, removes the legacy duplicate, verifies no
  managed legacy artifact remains, and reports the cleanup result.
- Given identity or any managed content does not match, when migration runs,
  then it does not remove the legacy content as a verified duplicate unless the
  user confirms the conflict-overwrite flow.

#### FR3.3. Conflict notification and overwrite decision

When a transfer encounters a target artifact that already exists, including one
created manually by a user, or when a previous transfer failed and a retry would
replace target content, the migration shall show a user-facing conflict notice.
It shall identify the affected bundle and artifact, state that target content
already exists or a prior transfer failed, and ask whether to overwrite the
target artifact. It shall not overwrite without an explicit affirmative answer.
If the user declines or does not answer, it shall preserve both locations and
report the deferred conflict with a manual-cleanup instruction for the legacy
copy. It shall not persist a durable conflict record. [scope] [Q3] [Q6] [Q8]
[Q11] [revision]

**Acceptance criteria**

- Given a target artifact already exists or a retry follows a failed transfer,
  when migration reaches that artifact, then it identifies the bundle and
  artifact, explains the conflict or failed-transfer context, and asks the user
  whether to overwrite the target artifact.
- Given the user declines or does not answer an overwrite request, when
  migration completes, then it preserves both the target and legacy artifacts,
  identifies the affected bundle and artifact, provides a manual-cleanup
  instruction for the legacy copy, reports the deferred conflict, and retains
  no durable conflict record.
- Given the user confirms an overwrite request, when migration replaces the
  target artifact, then it applies the verification and legacy-cleanup sequence
  defined in FR3.2 before reporting the transfer complete.

#### FR3.4. Restartable migration

If activation-time migration is interrupted after legacy content is
transferred, the next eligible activation shall restart the migration after
checking every target destination again. Migration shall derive each activation's
result from the legacy installation and target content currently present; it
shall not use a durable per-installation completion, failure, or conflict
record. An installation has no further migration work in an eligible activation
when its legacy source is absent. A preserved conflict or failed transfer remains
eligible for a later comparison or retry and shall be reported again from the
current run's observed state. [Q2] [Q6] [Q7]

**Acceptance criteria**

- Given migration is interrupted after one or more transfers, when the
  extension next activates, then it checks every target destination before
  repeating migration work.
- Given the repeated check finds authoritative target content or a verified
  duplicate, when migration resumes, then it does not overwrite target
  content or remove a non-verified legacy copy without the user's explicit
  overwrite decision.
- Given a prior activation removed a legacy source after verified transfer or
  duplicate cleanup, when a later eligible activation runs, then it finds no
  legacy source for that installation and performs no further migration work.
- Given a prior activation preserved a conflict or failed to verify a transfer,
  when a later eligible activation runs, then it re-evaluates the current
  legacy and target content without reading a durable per-installation outcome
  record and reports the current result.

#### FR3.5. Migration summary

The extension shall provide a user-facing summary for the migration run. The
summary may report transferred content, verified-duplicate cleanup, preserved
conflicts, overwrite decisions, and failures requiring a later retry, but the
migration shall not create durable per-installation outcome state solely for
that summary. [Q6] [Q7] [revision]

**Acceptance criteria**

- Given migration runs during activation, when it finishes or cannot finish,
  then the user can identify its outcome from the run's summary or standard
  diagnostics.

#### FR3.6. Target-absent legacy transfer

When a legacy extension-managed installation exists and its selected target
has no corresponding installation, the migration shall transfer its governed
content through the shared lifecycle to the resolved target and scope. After
the resulting target content is verified, it shall remove each legacy artifact
only when every expected target artifact exists and is identical, then verify
that no managed legacy artifact remains. If transfer or verification fails, or
if a target artifact already exists, it shall preserve the legacy source,
notify the user, and request an overwrite decision before replacing target
content. If transfer or verification fails without an existing target artifact
that a retry would replace, it shall preserve the legacy source and report the
failure as requiring a later retry. [scope] [RE-architecture] [Q4] [Q7]
[Q10] [Q11] [revision]

**Acceptance criteria**

- Given a legacy extension-managed installation and no corresponding selected
  target installation, when extension activation runs migration, then it uses
  the shared lifecycle to install the governed content at the resolved target
  and scope.
- Given that transfer completes, when the target read-back verification and
  identity/content comparison succeed, then the migration removes the legacy
  artifacts, confirms none remain at the previous location, and reports the
  completed transfer.
- Given target installation or verification fails, when migration handles the
  failure and no target artifact would be replaced by a retry, then it
  preserves the legacy source and reports the outcome as requiring a later
  retry without claiming a completed transfer.
- Given a failed transfer leaves or encounters a target artifact that a retry
  would replace, when migration handles the retry, then it preserves the legacy
  source and requests explicit overwrite confirmation before replacing that
  target artifact.

#### FR3.7. Repository-scope migration parity

The migration shall discover legacy extension-managed repository-scope
installations only when extension activation can associate their recorded
repository identity with exactly one open workspace folder. It shall resolve
that folder's target layout and apply the same authoritative-target,
verification, cleanup, and user-confirmed conflict-overwrite rules as user-scope
migration. With no open workspace folder, multiple matching folders, or an
unresolvable legacy repository identity, the migration shall leave that legacy
installation untouched and report it as skipped with the reason. Repository
migration shall remain isolated from user-scope cache, registry, and runtime
artifacts. [scope] [RE-business] [Q1-Q8]

**Acceptance criteria**

- Given a legacy repository-scope installation for the selected repository,
  when extension activation runs migration, then it resolves the selected
  repository target layout and processes the installation through the shared
  lifecycle.
- Given no open workspace folder matches a legacy repository installation's
  recorded repository identity, when extension activation runs migration, then
  it does not transfer, overwrite, or delete that installation and reports it
  as skipped because no unique repository is available.
- Given more than one open workspace folder matches a legacy repository
  installation's recorded repository identity, when extension activation runs
  migration, then it does not select a folder implicitly and reports the
  installation as skipped because the repository association is ambiguous.
- Given repository-scope migration encounters an existing target copy, when
  it compares the legacy and target installations, then it applies the same
  target verification, user-confirmed overwrite, verified-duplicate cleanup,
  and legacy-location verification behavior as user-scope migration.
- Given user-scope and repository-scope legacy installations exist, when one
  scope migrates, then it does not alter the other scope's cache, registry,
  lockfile, or runtime artifacts.

#### FR3.8. Deterministic legacy target and scope association

Before migration, the system shall associate every legacy installation with a
target and installation scope deterministically. It shall use the persisted
legacy installation scope and a versioned migration mapping over the legacy
record's supported attributes, including its provenance and manifest item
kinds, to identify exactly one supported target layout. It shall not infer a
target from the current user selection or choose an implicit default. If the
legacy data is missing, unsupported, or maps to no target or more than one
target, the system shall preserve the legacy installation unchanged and report
it as skipped with the association reason. Repository-scope association remains
subject to FR3.7's unique-workspace requirement. [scope] [RE-structure]
[revision]

**Acceptance criteria**

- Given a legacy user-scope installation has supported metadata that maps to
  exactly one target and scope, when migration runs, then it uses that resolved
  target layout and scope for all comparison, transfer, and cleanup steps.
- Given a legacy installation has missing, unsupported, or ambiguous target or
  scope association data, when migration runs, then it performs no target
  write, overwrite, or legacy deletion and reports the installation as skipped
  with the association reason.
- Given a legacy repository-scope installation maps to a target and scope, when
  no unique open workspace can be associated with its repository identity, then
  it applies FR3.7 and leaves the installation unchanged.

### Compatibility and Delivery

#### FR4. Evidence-led compatibility decision

The architecture design shall decide whether supported CLI or VS Code install,
update, and uninstall workflows can remain compatible or require a documented
incompatibility to achieve the shared lifecycle. [intent] [scope] [Q5]

**Acceptance criteria**

- Given architecture design is completed, when compatibility trade-offs are
  reviewed, then it documents the chosen policy, affected workflows, and
  rationale before implementation changes rely on an incompatibility.

#### FR4.1. Reviewable delivery sequence

The migration shall be delivered as a design pull request followed by small,
independently reviewable implementation pull requests. Their ordering and test
matrix shall follow approved dependency and delivery planning. [intent]
[scope]

**Acceptance criteria**

- Given implementation planning is complete, when pull requests are proposed,
  then each has a bounded responsibility, stated dependencies, and focused
  evidence appropriate to its changed behavior.

## Non-Functional Requirements

#### NFR1. Validation and write safety

The shared lifecycle shall preserve archive traversal rejection, governed
inventory and hash validation, binary-safe target writes, containment checks,
and read-back verification before it reports installation success.
[RE-business] [RE-architecture]

**Acceptance criteria**

- Given a malformed, traversal-bearing, or governed-inventory-invalid archive,
  when either entry point submits it, then validation fails before target files
  are written.
- Given binary bundle content is installed, when the write completes, then
  read-back verification confirms the written bytes match the input bytes.

#### NFR1.1. Migration filesystem safety

Migration comparison, overwrite, and cleanup shall constrain every legacy and
target artifact path to its resolved installation root, reject unsafe path
escapes and symlink traversal, and compare managed artifact content byte for
byte before legacy deletion. Its destructive transitions shall be atomic or
journaled so an interrupted or failed cleanup cannot delete unmanaged content
or report migration complete while managed legacy artifacts remain. [scope]
[RE-business] [RE-architecture] [Q10] [revision]

**Acceptance criteria**

- Given a legacy or target artifact resolves outside its installation root or
  requires unsafe symlink traversal, when migration evaluates it, then it
  performs no overwrite or deletion and reports the safety failure.
- Given managed legacy and target artifacts are compared for cleanup, when
  their bytes differ, then migration preserves the legacy artifact and follows
  the applicable conflict or retry behavior.
- Given cleanup is interrupted or fails, when migration reports its outcome,
  then it does not claim completion and does not delete unmanaged content.

#### NFR2. Recovery correctness

After an interrupted migration, restarting from activation shall be safe when
target destinations are rechecked. Repeating the migration shall not overwrite
target content without an explicit user decision, or delete legacy content
without current identity and managed-content verification followed by a
legacy-location check. [scope] [Q2] [Q4] [Q10] [Q11] [revision]

**Acceptance criteria**

- Given the same interrupted migration is restarted multiple times, when each
  run rechecks the target, then the target remains authoritative and cleanup
  occurs only after current verification succeeds; any overwrite is preceded by
  the user's explicit confirmation and followed by the required cleanup checks.

#### NFR3. Architecture conformance

New shared installation and migration rules shall follow the repository's
Clean Architecture dependency direction: core defines domain rules and ports,
infra implements I/O adapters, app orchestrates use cases, and CLI and VS Code
remain delivery adapters. [desc] [RE-architecture] [RE-structure]

**Acceptance criteria**

- Given the implementation is reviewed, when new installation policy is
  located, then it resides in the shared packages rather than duplicating
  business rules in extension services or CLI commands.

#### NFR4. Operational clarity without migration state

Migration diagnostics and user-facing summaries shall make cleanup and retry
outcomes understandable without creating separate durable migration outcome or
conflict state. [Q3] [Q6] [Q7] [Q8]

**Acceptance criteria**

- Given a preserved conflict or interrupted run, when the user receives the
  migration result, then the message identifies the affected bundle and
  artifact where applicable, states the conflict or retry context, and presents
  the overwrite decision when target content would be replaced.

## Constraints

- The migration must follow `docs/contributor-guide/architecture/library-centric-architecture/clean-architecture.md`. [desc]
- User-scope runtime target layouts remain target-owned; shared application
  cache and registry data remain in the existing XDG application storage.
  [scope] [RE-business]
- Repository lockfiles and repository artifacts remain within their repository
  scope. [scope]
- Runtime destinations must be derived from the selected target, scope, and
  item kind; requirements must not hardcode target-root paths. [revision]
- Existing target content must not be overwritten without explicit user
  confirmation. [revision]
- Legacy data must not be deleted until target identity and every managed
  artifact are verified, followed by confirmation that no managed legacy
  artifact remains. [revision]
- The migration must execute at extension activation before bundle commands.
  [Q1]
- It must not add durable migration outcome or conflict state solely for
  reporting. [Q3] [Q6] [Q7]

## Assumptions

| ID | Assumption | Rationale | Status |
| --- | --- | --- | --- |
| ASM1 | Target layouts can identify the destination for each manifest item kind. | The existing data-driven layouts are the source of truth for runtime destinations. | Confirm during domain design |
| ASM2 | Legacy and target installations expose enough identity and managed-content data for a current comparison. | Verified cleanup requires every target artifact to be present and identical before deletion, while the detailed comparison algorithm remains deferred. | Confirm during architecture and contract design |
| ASM3 | Activation can inspect legacy data without blocking extension activation indefinitely. | Migration is required before bundle commands but has no measured latency target yet. | Confirm during NFR requirements |
| ASM4 | Standard diagnostics can report an activation-time migration result without becoming migration state. | The agreed outcome excludes durable per-installation migration records. | Confirm during architecture design |

## Out of Scope

- Moving repository lockfiles or repository artifacts into user-scope XDG
  storage. [scope]
- Treating runtime target folders as the owner of shared cache or registry
  records. [scope]
- Automatically overwriting target content without the user's explicit
  confirmation. [revision]
- Deleting legacy artifacts before all expected target artifacts have been
  verified identical and the legacy location can be checked afterward.
  [revision]
- Defining the exact duplicate-comparison algorithm, migration completion
  algorithm or detailed interruption-recovery sequence in this stage. [scope]
- Selecting the implementation pull-request test matrix before delivery
  planning. [scope]
- Committing to a fixed release date or implementation sequence before
  architecture and dependency analysis. [scope]

## Open Questions

- What compatibility policy, including any justified CLI or VS Code breaking
  changes, does architecture design approve? [Q5]
- Which exact identity and managed-content comparison algorithm satisfies
  FR3.2 while preserving filesystem safety? [scope] [Q4]
- How is activation-time migration scheduled and bounded so it completes before
  bundle commands without degrading extension startup unacceptably? [ASM3]
- Which focused unit, integration, and migration fixtures demonstrate each
  planned pull request's behavior? [scope]

## Traceability

| Requirement | Primary sources | Downstream design focus |
| --- | --- | --- |
| FR1-FR1.3 | [intent], [scope], [RE-business], [RE-architecture], [RE-structure] | Shared app lifecycle and manifest contracts |
| FR2-FR2.2 | [intent], [scope], [Q1-Q8], [revision] | Target layout, storage ownership, and isolation |
| FR3-FR3.7 | [scope], [Q1-Q8], [RE-business], [RE-architecture], [revision] | Migration state-free reporting, confirmation, and cleanup safety |
| FR4-FR4.1 | [intent], [scope], [Q5] | Compatibility decision and delivery plan |
| NFR1-NFR4 | [scope], [RE-business], [RE-architecture], [Q1-Q8] | Security, recovery, Clean Architecture, and diagnostics |