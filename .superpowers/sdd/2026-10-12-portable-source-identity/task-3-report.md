# Task 3 — Offline evidence-preserving identity migration

## Behavior

- Added core-only legacy identity classification and deterministic retention-key policy. A portable mapping requires caller-supplied verified source and logical bundle identity; URLs, source IDs, runtime names, and version suffixes never manufacture provider identity.
- Batch planning retains every conflicting alias as unresolved when versions, resolutions, source descriptors, local roots, target bindings, or stored/installed baselines disagree.
- Extended the app migration path to classify raw v2 and branch-era v3 records before strict v3 reading. It preserves desired intent, hashes, file ownership baselines, commit mode, MCP metadata, target bindings, and local-root evidence. Shared unresolved evidence omits absolute local roots and unsafe URLs.
- Canonicalized malformed historical pin shapes into strict `unpinned` evidence, retaining valid normalized SHA-256 digests and safe provider coordinates rather than weakening strict v3 validation.
- Kept migration offline and resumable: local-first state carries temporary mapping evidence until desired state is safe; restarts reconstruct mappings from local evidence, including when a stale completion marker was present.
- Added read-only migration preview before uninstall lookup so no-match uninstall performs zero writes.

## Files changed

- `packages/core/src/domain/install/portable-identity-migration.ts`
- `packages/core/test/domain/install/portable-identity-migration.test.ts`
- `packages/app/src/stores/migrate-lockfile-v3.ts`
- `packages/app/test/stores/migrate-lockfile-v3.test.ts`
- `packages/app/src/deploy/undeploy.ts`
- `packages/app/test/deploy/undeploy.test.ts`

## RED/GREEN evidence

- **Core policy RED:** `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — initially 8 tests failed because the core migration policy/API was absent.
- **App shape/resume RED:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — branch-era v3 input was rejected by the strict reader instead of being classified for migration; the interruption case could not resume offline.
- **No-match RED:** the focused uninstall regression initially observed v2 bytes rewritten despite no matching ownership record.
- **Malformed pin RED:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts -t 'downgrades noncanonical legacy pins'` — 1 failed, 38 skipped; strict writer rejected `legacyMetadata` carried through a raw historical pin.
- **Core policy GREEN:** `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — 1 file passed, 8 tests passed.
- **App migration GREEN:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — 1 file passed, 39 tests passed, including the malformed-pin regression and all five interruption points.
- **No-match GREEN:** `pnpm -C packages/app exec vitest run test/deploy/undeploy.test.ts -t 'no match|matches nothing|ownership match'` — 1 file passed, 3 tests passed, 26 skipped.

## Validation

- `pnpm -C packages/core build` — **exit 0** (`tsc`).
- `pnpm -C packages/core lint:fix` — **exit 0**, 0 errors and 19 warnings.
- `pnpm -C packages/app lint:fix` — **exit 0**, 0 errors and 526 warnings.
- `git diff --check` — passed.
- `pnpm -C packages/core test` — **exit 1**, 1 file failed and 25 passed; 6 failed and 346 passed. The six failures are the known legacy-shape schema fixtures in `test/domain/install/lockfile-version.test.ts`: “accepts a desired-state file with no generated metadata,” “accepts a local file with materialization only,” “accepts a fully populated desired-state file,” “accepts a fully populated local file with all migration fields,” “accepts an unmanaged target record with no targetType or scope,” and “accepts a migrated record carrying legacy-shaped checksums.” These Task 6 fixtures were not used to relax the amended v3 schema.
- `pnpm -C packages/app exec vitest run --reporter=dot` — **exit 1**, 4 files failed and 61 passed; 123 failed and 856 passed (979 total). Failures are confined to deferred old-contract deploy consumers: `test/deploy/deploy.test.ts`, `test/deploy/plan.test.ts`, `test/deploy/resolve-undeploy-key.test.ts`, and `test/deploy/undeploy.test.ts`. Their fixtures/expectations still use `sourceId`-based active keys and pre-migration lifecycle behavior; the focused migration and no-match tests pass.
- `pnpm -C packages/app build` — **exit 2**, 14 downstream TypeScript errors in `src/deploy/deploy.ts`, `src/deploy/plan.ts`, `src/deploy/resolve-undeploy-key.ts`, and `src/deploy/undeploy.ts` (old `sourceId`/`archiveSha` contract and managed/unmanaged union access). These are the scheduled Task 6 deploy lifecycle integration failures; migration code itself adds no TypeScript errors.

## Self-review and concerns

- Strict v3 reader/writer/schema behavior was left unchanged. Noncanonical historical pins are downgraded to valid unpinned evidence; provider IDs and artifact pins are not invented.
- Migration reads local and legacy records but performs no network/provider lookup. Preview performs no writes; a no-match uninstall returns before migration.
- Temporary evidence is stripped only after both pair halves are written for managed records. Unresolved/unmanaged evidence remains available for later cleanup and refcounting.
- The remaining package-wide build/test failures are the known Task 6 deploy lifecycle and six Task 6 schema-fixture incompatibilities listed above; no unrelated lifecycle changes were made.

## Commit

- `fix(app): preserve identity evidence across resumable v3 migration`
- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
