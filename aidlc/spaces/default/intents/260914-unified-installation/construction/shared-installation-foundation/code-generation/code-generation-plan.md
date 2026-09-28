# Code Generation Plan — Shared Installation Foundation (U1)

Unit: `shared-installation-foundation` (U1, `library`, complexity L).
Project type: brownfield. Application code is modified **in place** under
`packages/core`, `packages/infra`, and `packages/app`; no duplicate
`*_modified` files, no code under the record dir.

The step order follows the approved Bolt 1 PR boundaries (PR 1 through PR 7 in
`inception/delivery-planning/bolt-plan.md`). Each PR group is an independently
reviewable change: it compiles, its tests run, and it leaves the workspace green.
`project.md` mandates small reviewable PR boundaries, so the groups below are the
commit/PR seams and are not merged into one change.

## Sources

- `construction/shared-installation-foundation/functional-design/functional-spec.md` — workflows, state machines, result semantics, and the three superseding amendments (contract alignment, generation-bound verification + destination claims, claim hand-off sequencing).
- `construction/shared-installation-foundation/functional-design/entities.md` — the nineteen entities (YAML is source of truth).
- `construction/shared-installation-foundation/functional-design/rules.md` — BR1.1–BR6.6 plus BR3.6 (38 rules).
- `construction/shared-installation-foundation/nfr-requirements/security-requirements.md` — NFR1.2–NFR1.8, NFR1.1.1–NFR1.1.7, NFR2.1, NFR3.1, NFR3.2, NFR4.1.
- `construction/shared-installation-foundation/nfr-requirements/tech-stack-decisions.md` — Node built-ins only, `adm-zip` retained behind the infra adapter, durable temp+fsync+rename replacement, `mkdir` locks, XDG for journal/claims, HMAC verification tokens, Vitest + `fast-check`.
- `inception/units-generation/unit-of-work.md` — U1 responsibilities and boundaries.
- `inception/contract-design/contract-summary.md` — Contract 3 port and operation surface.
- `inception/requirements-analysis/requirements.md` — FR1–FR2.2, FR3.7 boundary, FR4, NFR1–NFR4.
- `inception/delivery-planning/bolt-plan.md` — Bolt 1 PR boundaries 1–7 and the Contract 3 safety-amendment delivery mapping.

## Brownfield baseline (what already exists)

Read before planning; these are the in-place modification points, not new files:

| Existing asset | Path | How U1 uses it |
| --- | --- | --- |
| Governed manifest validation | `packages/core/src/domain/collection/manifest-validator.ts` | Already enforces one root `deployment-manifest.yml`, full `files[]` inventory coverage with role/size/`sha256` verified against archive bytes, canonical archive-relative paths, and `items[]` kinds. U1 wraps it, adds the governed projection, and returns typed outcomes instead of throwing. |
| Release manifest types | `packages/core/src/domain/collection/types.ts` (`ReleaseDeploymentManifest`, `ReleaseManifestFile`, `ReleaseManifestFileRole`) | Source of `ArchiveFileRecord` / `ManifestItem` / `BundleProvenance` projections. |
| Read-back verification | `packages/core/src/domain/install/integrity.ts` (`verifyWrittenBytes`, `bytesEqual`, `decodeUtf8Strict`) | Reused as the BR4.1 read-back primitive; `decodeUtf8Strict` already separates text from binary payloads. |
| Layout routing | `packages/core/src/domain/install/layout.ts`, `packages/app/src/install/layout-resolver.ts` | Source of destination resolution; `TargetRoutingPort` wraps it and adds containment. |
| Targets and scopes | `packages/core/src/domain/install/target.ts`, `.../types.ts` | `Target`, `TargetType`, `InstallationScope` (`user \| workspace \| repository`), `RepositoryCommitMode`. `workspace` routes through the repository-scope layout when a root path is present (recorded decision, BR2.1). |
| Repository records | `packages/app/src/stores/json-lockfile-store.ts`, `packages/core/src/public/schemas/lockfile.schema.json` | `LockfileBundleEntry.files[].checksum` is an **archive**-side checksum and there is **no per-entry `target`**. Both change here (BR3.3, R-03). |
| Archive reader | `packages/infra/src/extractors/zip-bundle-extractor.ts` | Gains `ArchiveSafetyLimits` and entry-type rejection (NFR1.6, NFR1.7). |
| XDG storage | `packages/infra/src/storage/xdg-app-storage.ts`, `packages/core/src/ports/app-storage.ts` | The user-scope registry, journal, claim, coordinator, and lock root (ADR-0005, NFR1.1.4). |
| Install/uninstall orchestration | `packages/app/src/install/{pipeline,install-bundle,target-write,uninstall-pipeline}.ts` | Today they throw `InstallPipelineError`. U1 introduces the typed `LifecycleOutcome` surface; the existing pipeline keeps working and delegates. |

**No shared user-scope installation record store exists today** (the extension
keeps user records in its own storage, the CLI keeps only
`.ai-primitives-hub/target-state.json`). The user-scope `InstallationRegistryPort`
adapter is therefore new code, not a port of an existing store.

### Named deltas carried into implementation

1. **Fingerprint semantics change.** `LockfileFileEntry.checksum` (archive bytes)
   is replaced by an artifact record carrying `destinationPath`, `itemKind`,
   `installedFingerprint` (bytes **as written**, post-transform) and
   `sizeInBytes` (BR3.3, NFR1.4). The lockfile schema version is bumped and old
   entries are read through a compatibility reader that reports them as
   unverifiable rather than silently treating an archive checksum as a
   fingerprint.
2. **`items[]`-authoritative membership with an optional per-item hash.** BR1.3
   makes the root `items[]` inventory authoritative and `contentHash` optional.
   The existing governed (`formatVersion: 1`) path **keeps** its stricter
   mandatory `files[].sha256` check — a defined integrity target is not weakened
   to satisfy an optional-hash rule — and `items[].contentHash` is verified
   whenever supplied. Governed membership, path, and kind come from `items[]`.
3. **Explicit identity attributes.** `ManagedInstallation` carries `bundleId`,
   `target`, `scope`, optional `repositoryIdentity`, with `installationKey`
   derived from them (R-03, BR3.1). The repository-lockfile adapter continues to
   imply `scope` and repository identity from its path but now stores `target`
   explicitly, because one repository can have several targets.

## Testing Contract

```json
{
  "version": 1,
  "methodology": "test-after",
  "source": "org",
  "ordering": "implement each applicable testable layer, then write and run",
  "scope": "unified-bundle-installation-migration",
  "test_strategy": "standard",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "test-after",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Data model / database behavior - implement.",
      "Data model / database behavior - write and run its tests after implementation.",
      "Repository / data access - implement.",
      "Repository / data access - write and run its tests after implementation.",
      "Business logic - implement.",
      "Business logic - write and run its tests after implementation.",
      "API / endpoint - implement.",
      "API / endpoint - write and run its tests after implementation.",
      "Frontend behavior - implement.",
      "Frontend behavior - write and run its tests after implementation.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:fa337aad8275f33f99e722432a622d59ce7232988c631f9e54e5044a1b1f7a5d",
  "contract_sha256": "sha256:8de3f6268d03be3db08961e8d5d1468823bacc4f91eef2d2cbab0f037f61e4ae"
}
```

### How this plan applies the contract

Methodology is **test-after** with the ordering "implement each applicable
testable layer, then write and run that layer's tests". Every implementation step
below is therefore immediately followed by its own test step, per layer, in the
contract's layer order. Test-runner readiness comes before the first executable
test step (Step 1). The contract's `Frontend behavior` layer is **genuinely
inapplicable**: U1 is a `library` unit with no UI surface (stated in
`security-requirements.md`), so it is omitted without changing the methodology.
The `API / endpoint` layer maps to U1's **public port/SDK surface** (the exported
Contract 3 operations), not to an HTTP endpoint.

Volume obligation: 5–8 tests per component (standard strategy). Scope floor:
keep the existing suite green; no additional new-test floor. Both apply.

## Implementation steps

### Group A — runner readiness (precedes every test step)

- [x] **Step 1 — Verify the test runner and record the unit-scoped command.**
  Confirm Vitest runs in `packages/core`, `packages/infra`, and `packages/app`
  (`vitest run` per package; Node >= 24, TypeScript ^5.9.3). Record the exact
  unit-scoped commands in `unit-test-instructions.md`. Confirm `fast-check` is
  available where property tests are planned; add it as a dev dependency only in
  the package that needs it, pinned, if it is absent. No production dependency is
  added anywhere in this unit.

### Group B — PR 1: Manifest governance (FR1.1, FR1.2, NFR1)

- [x] **Step 2 — Data model: governed manifest projection (implement).**
  New `packages/core/src/domain/install/governed-manifest.ts`:
  `GovernedBundleManifest`, `ManifestItem` (with optional `contentHash`),
  `ArchiveFileRecord` (`role: installable | metadata | ignored`, `size`,
  optional `contentDigest`), `BundleProvenance`, and a pure
  `projectGovernedManifest(validated, files)` that builds them from the existing
  `ReleaseDeploymentManifest`. Enforce BR1.5 (only an `installable`-roled item is
  a write candidate) as a pure predicate. Export from `domain/index.ts`.
- [x] **Step 3 — Data model: shared result vocabulary (implement).**
  New `packages/core/src/domain/install/lifecycle-outcome.ts`: `LifecycleOutcome`
  (`success | validation-error | conflict | preserved-content |
  retryable-failure | safety-blocked`, `preservedArtifacts`, `detail`),
  `MigrationTransferOutcome`, `ArtifactVerificationResult` (per-artifact verdicts
  + `allVerified`), `CleanupJournalEntryResult`, `CleanupJournalCloseResult`,
  `RepositoryReconciliationResult` (with `skipReason`). Discriminated unions only;
  expected conditions are values, never thrown errors (BR4.8, NFR4.1).
- [x] **Step 4 — Data-model tests (write and run).**
  `packages/core/test/domain/install/governed-manifest.test.ts` and
  `lifecycle-outcome.test.ts`: projection of a governed manifest, non-installable
  item produces no write candidate, missing file record rejected, `metadata` /
  `ignored` roles excluded, outcome-union exhaustiveness and `preserved-content`
  vs `success` + `preserved` discrimination.
- [x] **Step 5 — Port + adapter: `ManifestGovernancePort` (implement).**
  New `packages/core/src/ports/manifest-governance.ts` declaring
  `validate(bundleSource): Promise<GovernedManifestResult>` where the result is
  either the governed projection or a `validation-error` outcome. New
  `packages/infra/src/governance/manifest-governance-adapter.ts` wrapping
  `validateManifest` + `projectGovernedManifest`, converting
  `ManifestValidationError` into `validation-error` (BR1.1–BR1.4) and verifying
  any supplied `items[].contentHash` against archive bytes (NFR1.2).
- [x] **Step 6 — Archive admission limits and entry types (implement).**
  Modify `packages/infra/src/extractors/zip-bundle-extractor.ts`: add
  `ArchiveSafetyLimits` (defaults 10 000 entries, 256 MiB total uncompressed,
  64 MiB per entry, 100:1 max regular-file ratio, directories excluded from
  ratio), enforced **before** any entry is materialised; reject absent,
  non-finite, non-positive, or less-restrictive overrides as `validation-error`
  (NFR1.6). Reject symbolic links, device nodes, and unsupported ZIP entry types
  (NFR1.7). Keep reads binary-safe.
- [x] **Step 7 — Governance tests (write and run).**
  `packages/infra/test/governance/manifest-governance-adapter.test.ts` and
  additions to `packages/infra/test/extractors/zip-bundle-extractor.test.ts`:
  missing / duplicate root manifest, inventory mismatch, traversal path,
  mismatched item hash, exact-boundary and one-over-limit fixtures for each of
  the four limits, tightening-only override accepted, loosening override
  rejected, prohibited entry types. Every failure case asserts **no target-store
  call** (NFR1.2).

### Group C — PR 2: Target/scope routing (FR2, FR2.2)

- [x] **Step 8 — Data model + port: installation address (implement).**
  New `packages/core/src/domain/install/address.ts` (`InstallationAddress` with
  `destinationRoot`, `itemKind`, `destinationPath`) and
  `packages/core/src/ports/target-routing.ts`
  (`resolve(target, scope, kind): InstallationAddress | safety-blocked`).
  Containment is a pure predicate over resolved paths (BR2.2); no runtime root is
  hardcoded (BR2.1).
- [x] **Step 9 — Routing adapter (implement).**
  New `packages/infra/src/routing/layout-target-routing.ts` composing the
  existing layout resolver and `resolvePathTokens`, adding real-path containment
  with rejection of **any** symbolic-link component and of absolute or
  traversal-bearing results (NFR1.1.1). `workspace` scope routes through the
  repository-scope layout when a root path is present.
- [x] **Step 10 — Routing tests (write and run).**
  `packages/core/test/domain/install/address.test.ts` and
  `packages/infra/test/routing/layout-target-routing.test.ts`: kind → destination
  for at least two target types at both scopes, unresolved token failure,
  traversal escape, absolute path, symlinked parent component, `allowedKinds`
  restriction, target/scope isolation (BR2.3). Escapes assert no mutation.

### Group D — PR 3: Installation registry, storage ports, destination claims (FR2.1, FR2.2, R-02, R-03, BR3.6)

- [x] **Step 11 — Data model: managed records and claims (implement).**
  New `packages/core/src/domain/install/managed-installation.ts`:
  `ManagedInstallation` (explicit `bundleId`, `target`, `scope`,
  `repositoryIdentity?`, `manifestVersion`, `installedAt`, `sourceId?`),
  `ManagedArtifact` (`destinationPath`, `itemKind`, `installedFingerprint`,
  `sizeInBytes`), `RepositoryIdentity` with offline derivation (normalised
  canonical remote URL, else absolute workspace root; userinfo stripped),
  `deriveInstallationKey(identity)` (BR3.1, BR3.2), plus
  `DestinationOwnershipClaim` (`claimId`, `target`, `scope`, `destinationPath`,
  `ownerInstallation`, `generation`, `state: claimed | pending-materialization |
  finalized | rollback-required`, `acquiringInstallation?`,
  `cedingInstallation?`, `priorManagedArtifact?`, `intendedFingerprint?`) and
  `DestinationOwnershipHandoff`.
- [x] **Step 12 — Registry-record tests (write and run).**
  `packages/core/test/domain/install/managed-installation.test.ts`: key derivation
  stability and collision behaviour across bundle/target/scope/identity, offline
  identity derivation with and without a remote, userinfo stripping, artifact
  uniqueness per record, claim-state legality.
- [x] **Step 13 — Ports: registry and artifact store (implement).**
  New `packages/core/src/ports/installation-registry.ts`
  (`get`, `put`, `delete`, `queryDestinationOwnership(destinationPaths, target,
  scope)`, `reconcileRepositoryIdentity`, claim transaction operations) and
  `packages/core/src/ports/target-artifact-store.ts` (`write`, `read`, `remove`,
  each containment- and symlink-safe). One schema, two adapters (BR3.4).
- [x] **Step 14 — Durable primitives (implement).**
  New `packages/infra/src/storage/durable-file.ts`: restrictive temp file in the
  final parent directory, complete write, file `fsync`, same-filesystem atomic
  `rename`, best-effort parent-directory `fsync`; direct overwrite prohibited
  (NFR1.1.2). New `packages/infra/src/storage/mkdir-lock.ts`: `mkdir`-based lock
  with holder + acquisition-time metadata, second holder gets
  `retryable-failure`, stale metadata is diagnostic only (NFR1.1.5).
- [x] **Step 15 — Repository/data-access adapters (implement).**
  New `packages/infra/src/registry/user-scope-installation-registry.ts` over
  `AppStoragePort` (XDG), and
  `packages/infra/src/registry/repository-scope-installation-registry.ts` over
  the lockfile. Modify `packages/app/src/stores/json-lockfile-store.ts` and
  `packages/core/src/public/schemas/lockfile.schema.json`: bump
  `LOCKFILE_SCHEMA_VERSION`, add per-entry `target`, replace the archive-side
  `files[].checksum` with `destinationPath` / `installedFingerprint` /
  `sizeInBytes`, and read pre-bump entries through a compatibility reader that
  marks them unverifiable instead of misreading an archive checksum as a
  fingerprint. Neither adapter reads or writes the other's storage. Journal,
  claim, coordinator, and lock state live in XDG for both scopes; lockfiles hold
  installation records only (NFR1.1.4).
- [x] **Step 16 — Claim transaction and cross-store coordinator (implement).**
  New `packages/app/src/install/destination-claim.ts` implementing the
  authoritative hand-off sequencing: under the installation-key lock, one
  transaction validates the live claim and any hand-off, **atomically detaches**
  the destination from the ceding installation's active managed set, and creates
  the acquiring `pending-materialization` claim recording ceding identity, prior
  artifact linkage, intended fingerprint, and generation — before any target
  write. Then materialize under reservation, finalize on verified read-back, or
  resolve failure: restore the detached ceding pre-image when no materialization
  occurred, finalize when a fresh read proves the intended bytes, else retain
  `rollback-required` evidence and return a preserved retry outcome. New
  `packages/infra/src/registry/handoff-coordinator.ts` persists the XDG
  coordinator record through phases `prepared` → `ceding-detached` →
  `acquiring-pending` → completion, replaying a phase only when its expected
  pre-image still matches (NFR1.1.3, NFR2.1, BR3.6).
- [x] **Step 17 — Registry, claim, and coordinator tests (write and run).**
  `packages/infra/test/registry/{user-scope,repository-scope}-installation-registry.test.ts`,
  `packages/infra/test/storage/{durable-file,mkdir-lock}.test.ts`,
  `packages/app/test/install/destination-claim.test.ts`,
  `packages/infra/test/registry/handoff-coordinator.test.ts`: round-trip per
  scope, scope isolation, legacy-entry compatibility read, crash injection
  before/after every durable replacement (final path is either the previous or
  the intended complete file, never partial), concurrent claim admits exactly one
  writer, hand-off leaves no dual owner and no unowned destination, rollback
  restores the ceding record, exactly one lock holder, stale-lock takeover
  refused on timestamp alone.

### Group E — PR 4: Install lifecycle and artifact store (FR1, NFR1, R-02)

- [x] **Step 18 — Artifact store adapter (implement).**
  New `packages/infra/src/writers/target-artifact-store.ts`: binary payloads
  written verbatim, text payloads transformed then encoded, every write through
  the durable primitive, every path containment- and symlink-checked before any
  read, write, or removal (BR3.3, BR2.2, NFR1.1.1).
- [x] **Step 19 — Business logic: `applyGovernedArtifacts` + install (implement).**
  New `packages/app/src/install/governed-lifecycle.ts` exposing the internal
  `applyGovernedArtifacts` write-verify-record primitive (write → read back and
  compare against the intended sequence → fingerprint that same sequence →
  admit only after verification; BR4.1, BR3.5, NFR1.5) and `install(request)`
  following the specified sequence: validate → derive repository identity →
  resolve destinations → read the prior record → run
  `queryDestinationOwnership` and the BR4.7 local-change check **before the
  first write** → claim → write and verify → record → reconcile omitted
  artifacts → return the outcome. A different installation owning a destination
  returns `conflict` unless a matching `DestinationOwnershipHandoff` is supplied.
  `applyGovernedArtifacts` stays internal to `InstallationLifecyclePort` and is
  never exposed as a Contract 3 operation.
- [x] **Step 20 — Install-lifecycle tests (write and run).**
  `packages/app/test/install/governed-lifecycle.test.ts`: happy-path install of a
  small governed bundle, read-back mismatch returns `retryable-failure` **and
  records no artifact**, locally changed still-named artifact without consent
  returns `conflict` with nothing written, same case with consent replaces and
  refreshes the fingerprint, cross-installation destination conflict without
  hand-off returns `conflict`, valid hand-off transfers ownership atomically,
  containment escape returns `safety-blocked` with no write.

### Group F — PR 5: Update and uninstall (FR1.3)

- [x] **Step 21 — Business logic: update and uninstall (implement).**
  Extend `governed-lifecycle.ts` with `update(request)` (three-way diff:
  still-managed identical, still-managed changed, omitted; BR4.7 applied to the
  changed group before any write; omitted artifacts removed only when bytes match
  the fingerprint, else preserved and dropped from the managed set; success
  carries the preserved list) and `uninstall(request)` (remove only still-managed
  artifacts, verify each path is absent, delete the record when empty, return
  removed + skipped). Wire `packages/app/src/install/uninstall-pipeline.ts` and
  `packages/app/src/install/pipeline.ts` to delegate to the shared lifecycle
  without keeping a second write or removal path (NFR3.2).
- [x] **Step 22 — Update/uninstall tests (write and run).**
  `packages/app/test/install/governed-lifecycle-update.test.ts` and
  `governed-lifecycle-uninstall.test.ts`: omitted unchanged artifact removed,
  omitted changed artifact preserved and de-managed, preserved artifact untouched
  by a later uninstall (BR4.3 + BR4.5), unverified removal returns
  `retryable-failure` and retains the record, unmanaged file never deleted,
  successful update reports its preserved list (BR4.4),
  `preserved-content` returned only when the requested change was unachievable
  (BR4.8). Keep the existing
  `packages/app/test/install/{pipeline,uninstall-pipeline}.test.ts` green.

### Group G — PR 6: Cleanup journal contract and token-gated verification (NFR1.1)

- [x] **Step 23 — Data model + port: journal (implement).**
  New `packages/core/src/domain/install/cleanup-journal.ts`
  (`CleanupJournalEntry` with `entryId`, `generation`, `installationKey`,
  `state: prepared | target-verified | legacy-delete-pending | committed`,
  `legacySourceRoot`, `updatedAt`; `CleanupArtifactProgress` with
  `progressState: pending | verified-identical | deleted | preserved`;
  pure transition legality including the same-state
  `legacy-delete-pending` advance) and
  `packages/core/src/ports/migration-cleanup-journal.ts` declaring the four
  operations `openCleanupJournalEntry`, `recordCleanupTransition`,
  `readCleanupJournalEntry`, `closeCleanupJournalEntry`.
- [x] **Step 24 — Business logic: verification, tokens, journal persistence (implement).**
  New `packages/app/src/install/verify-managed-artifacts.ts` — read-only
  verification returning per-artifact verdicts plus `allVerified`, minting a
  `VerificationResultToken` (HMAC-SHA-256 over installation key, entry id,
  generation, complete fingerprint set, read version, issue time; ephemeral
  per-process key, never persisted) only when the full expected set is present and
  byte-identical. New
  `packages/infra/src/registry/xdg-cleanup-journal.ts` persisting entries
  durably under the installation-key lock: durable-before-action transitions,
  `source-root-mismatch` refusal, exclusive access, legacy-path containment
  inside the verified source root, `abandoned` permitted only from `prepared` or
  `target-verified`, committed entries deleted as the final step, generation
  incremented on every authoritative change and on token consumption.
- [x] **Step 25 — Journal and token tests (write and run).**
  `packages/core/test/domain/install/cleanup-journal.test.ts`,
  `packages/app/test/install/verify-managed-artifacts.test.ts`,
  `packages/infra/test/registry/xdg-cleanup-journal.test.ts`: every legal and
  illegal transition, repeated `legacy-delete-pending` accepted, token replay
  rejected, wrong generation rejected, subset/expanded/altered artifact set
  rejected, hand-minted unkeyed digest rejected, closed entry rejected, stale
  token whose fresh read no longer matches rejected, verification performs no
  journal write, resumption re-verifies before each delete, legacy path escaping
  its source root returns `safety-blocked`, second holder gets
  `retryable-failure`, restart at each journal state resumes safely.

### Group H — PR 7: Repository-identity reconciliation, U1 half (FR2.1, FR3.7 boundary, NFR3)

- [ ] **Step 26 — Port + use case: reconciliation (implement).**
  New `packages/core/src/ports/repository-redirect.ts` — the **optional,
  injected** `RepositoryRedirectPort` with
  `resolveRedirect(query): RedirectResolution` (`redirect-confirmed |
  no-redirect | unavailable`). New
  `packages/app/src/install/reconcile-repository-identity.ts`: validate the
  request (repository scope, at least one caller-supplied candidate), resolve the
  record, ask the injected port once per candidate, re-key only on **exactly
  one** confirmation, persist under the new key and remove the old key in the
  same operation leaving artifacts and fingerprints untouched. Absent port,
  `unavailable`, zero candidates, zero confirmations, or more than one
  confirmation all return `skipped` with a reason. U1 makes no network call and
  enumerates no workspaces (BR6.1–BR6.6, NFR3.1).
- [ ] **Step 27 — Reconciliation tests (write and run).**
  `packages/app/test/install/reconcile-repository-identity.test.ts`: single
  confirmation re-keys and removes the old key, two confirmations skip as
  ambiguous, zero candidates skip, absent port skips, `unavailable` skips as
  offline, non-repository scope is a `validation-error`, persistence failure
  returns `retryable-failure` with the original record intact, artifacts and
  fingerprints unchanged after a re-key, and a network-denying fake proves no
  outbound call anywhere in U1.

### Group I — API/endpoint layer: U1's public surface

- [ ] **Step 28 — Publish the Contract 3 surface (implement).**
  Export the U1 port interfaces, domain types, and use cases through
  `packages/core/src/{domain,ports}/index.ts`, `packages/core/src/index.ts`,
  `packages/infra/src/index.ts`, `packages/app/src/install/index.ts`, and
  `packages/app/src/index.ts`, exposing exactly the declared operations:
  `install`, `update`, `uninstall`, `transferThroughLifecycle`,
  `verifyManagedArtifacts`, the four journal operations, and
  `reconcileRepositoryIdentity`. `applyGovernedArtifacts` is **not** exported as
  a Contract 3 operation. Add the U1 half of `transferThroughLifecycle` in
  `packages/app/src/install/transfer-through-lifecycle.ts`, mapping each inner
  `LifecycleOutcome` to a `MigrationTransferOutcome` member, including the
  partial-target `preserved-conflict` branch and the `verified-duplicate`
  branch. No delivery-layer consent, notification, workspace enumeration, or
  network behaviour is added to U1.
- [ ] **Step 29 — Public-surface tests (write and run).**
  `packages/app/test/install/transfer-through-lifecycle.test.ts` plus barrel
  assertions in `packages/core/test/index.test.ts`,
  `packages/infra/test/index.test.ts`, `packages/app/test/index.test.ts`: each
  transfer branch (`transferred`, `verified-duplicate`, `preserved-conflict`
  including the partial target, `retry-required`, `skipped`, `safety-blocked`),
  no bare `LifecycleOutcome` escapes the migration boundary, and
  `applyGovernedArtifacts` is not reachable from the public barrels.

### Group J — build configuration, quality gates, documentation

- [ ] **Step 30 — Environment and build configuration.**
  Run `pnpm -C packages -r build` and `pnpm -C packages -r lint:fix` until clean.
  Verify the dependency direction (`core` imports nothing from `infra`/`app`, no
  `vscode`, no direct `fs` in `core`) — NFR3.2. Do **not** lower any lint,
  type-check, or coverage threshold to make a step pass; surface the gap instead.
- [ ] **Step 31 — Documentation and traceability.**
  Update `docs/contributor-guide/architecture/library-centric-architecture/`
  with the shared lifecycle, registry, journal, and claim boundaries, and add an
  ADR for the lockfile schema bump and fingerprint-semantics change. Then write
  the record artifacts: `code-summary.md`, `source-manifest.json` (every
  application-source path created, modified, or deleted), and
  `traceability.json` covering every BR and NFR id below.

## Traceability — plan step to upstream id

| Step(s) | Upstream ids |
| --- | --- |
| 2, 4, 5, 7 | BR1.1, BR1.2, BR1.3, BR1.4, BR1.5, NFR1.2, NFR1.3 |
| 6, 7 | NFR1.6, NFR1.7 |
| 3, 4 | BR4.8, NFR4.1 |
| 8, 9, 10 | BR2.1, BR2.2, BR2.3, NFR1.1.1 |
| 11, 12 | BR3.1, BR3.2, BR3.4 |
| 13, 15, 17 | BR3.4, NFR1.1.4 |
| 14, 17 | NFR1.1.2, NFR1.1.5 |
| 16, 17 | BR3.6, NFR1.1.3, NFR2.1 |
| 18, 19, 20 | BR3.3, BR3.5, BR4.1, BR4.7, NFR1.4, NFR1.5, NFR1.8 |
| 21, 22 | BR4.2, BR4.3, BR4.4, BR4.5, BR4.6, BR4.7, BR4.8, NFR1.8 |
| 23, 24, 25 | BR5.1, BR5.2, BR5.3, BR5.4, BR5.5, BR5.6, BR5.7, BR5.8, BR5.9, BR5.10, BR5.11, NFR1.1.6, NFR1.1.7, NFR2.1 |
| 26, 27 | BR6.1, BR6.2, BR6.3, BR6.4, BR6.5, BR6.6, NFR3.1 |
| 28, 29 | FR1, FR1.1, FR1.2, FR1.3, FR2, FR2.1, FR2.2, FR4, NFR4.1 |
| 30 | NFR3.2 |
| 31 | FR4.1 |

## Definition of done for this unit

- Each of Groups B through H is an independently reviewable, green change on the
  Bolt 1 PR seam it names.
- A small governed bundle installs, updates, and uninstalls through the shared
  lifecycle at both scopes, preserving locally changed content.
- Target, scope, repository, and unmanaged-content isolation is proven by tests.
- The journal contract, verification tokens, and `reconcileRepositoryIdentity`
  are published for U4 and exercised with no network access and no redirect port.
- `pnpm -C packages -r build` and `pnpm -C packages -r lint:fix` are clean, and
  every unit-scoped test command in `unit-test-instructions.md` passes.
