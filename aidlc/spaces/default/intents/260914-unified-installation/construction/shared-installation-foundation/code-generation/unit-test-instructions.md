# Unit Test Instructions — Shared Installation Foundation (U1)

Test strategy: **Standard** — 5 to 8 tests per component, unit tests plus
integration tests for the key boundaries. Scope floor adds no extra new-test
floor and requires the existing suite to stay green. Methodology is
**test-after**: each layer is implemented, then its tests are written and run.

## Framework setup

Vitest is already configured in every package this unit touches; no new runner is
introduced.

- Runner: Vitest `^4.1.10` (`vitest run`), per package, via each package's
  `test` script.
- Runtime: Node `>= 24`, TypeScript `^5.9.3`.
- Property tests: `fast-check`, added as a pinned **dev** dependency only in the
  package that needs it, and only if absent. No production dependency is added
  anywhere in this unit.
- Test roots follow the existing convention — `packages/<pkg>/test/<mirror of
  src path>/<name>.test.ts`.
- Runner readiness is verified in plan Step 1, before the first test step.

## How to run THIS unit's tests

Each command names exact test file paths, so it runs only this unit's tests and
never the whole workspace suite. Run them from the repository root.

Core (domain types, ports, pure rules):

```bash
pnpm -C packages/core exec vitest run \
  test/domain/install/governed-manifest.test.ts \
  test/domain/install/lifecycle-outcome.test.ts \
  test/domain/install/address.test.ts \
  test/domain/install/managed-installation.test.ts \
  test/domain/install/cleanup-journal.test.ts
```

Infra (adapters, storage, locks, archive limits):

```bash
pnpm -C packages/infra exec vitest run \
  test/governance/manifest-governance-adapter.test.ts \
  test/extractors/zip-bundle-extractor.test.ts \
  test/routing/layout-target-routing.test.ts \
  test/storage/durable-file.test.ts \
  test/storage/mkdir-lock.test.ts \
  test/registry/user-scope-installation-registry.test.ts \
  test/registry/repository-scope-installation-registry.test.ts \
  test/registry/handoff-coordinator.test.ts \
  test/registry/xdg-cleanup-journal.test.ts
```

App (use cases and the public U1 surface):

```bash
pnpm -C packages/app exec vitest run \
  test/install/governed-lifecycle.test.ts \
  test/install/governed-lifecycle-update.test.ts \
  test/install/governed-lifecycle-uninstall.test.ts \
  test/install/destination-claim.test.ts \
  test/install/verify-managed-artifacts.test.ts \
  test/install/transfer-through-lifecycle.test.ts \
  test/install/reconcile-repository-identity.test.ts
```

Existing regression files this unit must keep green (already in the suite, run
them by exact path when a change touches them):

```bash
pnpm -C packages/app exec vitest run \
  test/install/pipeline.test.ts \
  test/install/uninstall-pipeline.test.ts \
  test/stores/json-lockfile-store.test.ts
```

Build and lint gates for the same unit:

```bash
pnpm -C packages -r build
pnpm -C packages -r lint:fix
```

## Coverage targets

- 5 to 8 tests per component for every component listed in the plan's
  implementation steps.
- Unit coverage for every pure rule: BR1.1–BR1.5, BR2.1–BR2.3, BR3.1–BR3.6,
  BR4.1–BR4.8, BR5.1–BR5.11, BR6.1–BR6.6.
- Integration coverage for the key boundaries: archive → governed manifest,
  routing → contained destination, lifecycle → artifact store → registry,
  journal → verification token → deletion authority, cross-store hand-off
  coordinator.
- Every failure path asserts the **absence** of the mutation it refused (no
  target-store call, no artifact record, no deletion).
- No lint, type-check, or coverage threshold is lowered to make a step pass.
  The scope adds no line-coverage floor beyond the Standard strategy; existing
  thresholds stay as configured.

## Mocking and stubbing guidance

- Mock at the **port boundary only**: `ManifestGovernancePort`,
  `TargetRoutingPort`, `InstallationRegistryPort`, `TargetArtifactStorePort`,
  `MigrationCleanupJournalPort`, `RepositoryRedirectPort`, `AppStoragePort`,
  `FileSystem`, `Clock`. Never mock the unit under test.
- Use fault-injecting fakes for the safety paths: a target store whose read-back
  returns different bytes (`retryable-failure` with no record), a filesystem that
  fails mid-`rename` (crash injection at every durable-replacement point), a
  registry whose second write fails (rollback without partial ownership change).
- Use a **network-denying** fake for every U1 test: any outbound attempt fails the
  test, proving NFR3.1. `RepositoryRedirectPort` is exercised as absent,
  `unavailable`, `no-redirect`, and `redirect-confirmed`.
- Real filesystem work goes in temp directories created per test and removed
  afterwards; containment, symlink, and `fsync` behaviour is verified against the
  real filesystem rather than an in-memory double.
- Verification tokens are never hand-minted in a test expecting success; the
  unkeyed-digest and altered-field cases are explicit rejection tests.

## Test data management

- Build ZIP fixtures programmatically from a small helper so each archive states
  its own governance facts: one root `deployment-manifest.yml`, a full `files[]`
  inventory with role/size/`sha256`, an `items[]` inventory with kinds, and
  provenance. Reuse the existing fixture roots
  (`packages/core/test/fixtures`, `packages/infra/test/fixtures`) and the
  existing helpers under each package's `test/helpers`.
- Keep boundary fixtures explicit and minimal for the archive limits: exactly at
  and exactly one over 10 000 entries, 256 MiB total, 64 MiB per entry, and a
  100:1 ratio. Generate oversized cases synthetically rather than committing
  large binaries.
- Include one binary payload fixture (not valid UTF-8) and one transformed text
  payload so fingerprint-as-written is proven for both paths.
- Never commit credentials, tokens, real remote URLs with userinfo, or
  environment values into fixtures.
