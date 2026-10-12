# Task 2 — Strict amended v3 wire/store contract

## Files changed

- `packages/app/src/stores/lockfile-v3.ts`
- `packages/app/test/stores/lockfile-v3.test.ts`
- `packages/app/test/stores/lockfile-v3-schema.test.ts` (new)
- `packages/core/src/public/schemas/lockfile-v3.schema.json`

## Behavioral changes

- Defined active v3 desired/local records around core's public portable identity, resolution, and migration-evidence types; removed legacy `sourceId`/archive-pin shapes from the active contract.
- Added strict v3 validation to readers, pair writers, and single-file writes. Version mismatch/classification remains ahead of shape validation, and both pair halves validate before either write.
- Enforced source-key/descriptor and bundle-key/source-key correspondence; strict resolution variants, digest and version agreement; numeric GitHub and UUID Azure provider IDs; portable local relative-root/binding locators; and migration-only unmanaged legacy evidence.
- Preserved Artifactory non-identity configuration (`indexFile`, `authMode`, `credentialRef`) during same-type descriptor refreshes. Config remains separate from source identity.
- Updated the amended v3 schema and schema tests; v2 schema was not changed.
- Retained local-before-desired write ordering and unique temporary files.

## RED/GREEN evidence

- Initial focused contract RED:
  - Command: `pnpm -C packages/app exec vitest run test/stores/lockfile-v3.test.ts test/stores/lockfile-v3-schema.test.ts`
  - Result before implementation: **15 failed, 33 passed**. Failures covered active `sourceId`, portable key/descriptor mismatches, resolution/version disagreement, absolute local locators, and permissive schema shapes.
- Config preservation RED:
  - Command: `pnpm -C packages/app exec vitest run test/stores/lockfile-v3.test.ts -t "preserves Artifactory auth and credential-reference config"`
  - Result before fix: **1 failed, 36 skipped**; refreshed descriptor dropped `authMode` and `credentialRef`.
- Date-time strictness RED:
  - Command: `pnpm -C packages/app exec vitest run test/stores/lockfile-v3.test.ts -t "rejects a local generatedAt value"`
  - Result before fix: **1 failed, 37 skipped**; a date-only value was accepted by the reader.
- Final focused GREEN:
  - Command: `pnpm -C packages/app exec vitest run test/stores/lockfile-v3.test.ts test/stores/lockfile-v3-schema.test.ts`
  - Result: **2 files passed, 51 tests passed**.

## Validation

- `pnpm -C packages/app run lint:fix` — **exit 0**, 0 errors and 525 warnings.
- `git diff --check` — passed.
- `pnpm -C packages/app run build` — **exit 2**, with 18 downstream TypeScript errors in consumers scheduled for Tasks 3/6; details below.
- `pnpm -C packages/app exec vitest run --reporter=dot` — **5 test files failed, 60 passed; 155 tests failed, 791 passed (946 total)**. Failed suites: `test/deploy/deploy.test.ts`, `test/deploy/plan.test.ts`, `test/deploy/undeploy.test.ts`, `test/deploy/resolve-undeploy-key.test.ts`, and `test/stores/migrate-lockfile-v3.test.ts`. These still exercise the old request/migration shapes; Task 2 did not modify them.

## Expected downstream build breakages (Tasks 3/6)

- `src/deploy/deploy.ts`: line 93 (`sourceId` vs `LogicalBundleKeyParts`); line 150 (`sourceId` vs `LockfileV3DesiredEntry`); lines 151 and 152 (`archiveSha` absent from `LockfileV3DesiredEntry`); line 156 (`string` vs `RetainedSourceType`); line 185 (`sourceId` vs `LockfileV3BundleRecord`).
- `src/deploy/plan.ts`: line 58 (`sourceId` vs `LogicalBundleKeyParts`); line 60 (`url` absent from `PortableSourceDescriptor`); line 61 (`sourceId` absent from `LockfileV3DesiredEntry`); line 109 (`sourceId` vs `LogicalBundleKeyParts`).
- `src/deploy/resolve-undeploy-key.ts`: line 80 (`sourceId` absent from `LogicalBundleKeyParts`).
- `src/deploy/undeploy.ts`: line 160 and line 228 (`state`/`unmanagedReason` are not present on the managed-materialization union member).
- `src/stores/migrate-lockfile-v3.ts`: line 99 legacy source entries lack portable descriptor `identity`/`locator`; line 114 `sourceId` absent from `LockfileV3DesiredEntry`; line 117 `archiveSha` absent from that entry; line 135 `sourceId` absent from `LockfileV3BundleRecord`.

These failures are recorded without weakening the new types or expanding into the deferred deploy/migration tasks.

## Commit

- `20f389bb feat(app): define portable v3 lockfile shapes`

## Fix round 1

### Findings addressed

- Legacy evidence now uses the core credential-free HTTP(S) URL check, including `X-Amz-Signature` and `passwd` query keys; the schema hostname patterns no longer consume `?` or `#`.
- Linked materialization files are path-only at runtime and in the schema, including unmanaged linked records.
- Core resolution policy now matches pinned providers to their portable source family and permits `live` only for `local-skills`; the strict desired-state reader enforces it.
- The canonical legacy workspace-root locator `.` is accepted by the runtime validator, matching the schema, while absolute roots remain rejected.
- Cloned source fixtures prevent the mismatch test from mutating shared test state; its assertion checks the intended source-key mismatch.

### RED/GREEN evidence

- **RED command:** `set -o pipefail; pnpm -C packages/app exec vitest run --reporter=dot test/stores/lockfile-v3.test.ts test/stores/lockfile-v3-schema.test.ts 2>&1 | tail -n 100`
- **RED output:** exit 1; `Test Files 2 failed (2)`; `Tests 9 failed | 52 passed (61)`. The nine failures reproduced secret `X-Amz-Signature`/`passwd` evidence acceptance, rejection of `.`, GitHub live-resolution acceptance, all three linked-file metadata cases, and the two schema locator/path-only cases.
- **GREEN command:** `pnpm -C packages/app exec vitest run --reporter=dot test/stores/lockfile-v3.test.ts test/stores/lockfile-v3-schema.test.ts`
- **GREEN output:** exit 0; `Test Files 2 passed (2)`; `Tests 62 passed (62)`. The final selector also exercises positive resolution/source-family pairs for GitHub release/tree, Azure DevOps, Artifactory, local snapshot, local-skills live, and unpinned evidence.

### Validation

- `pnpm -C packages/core run build` — **exit 0** (`tsc`).
- `pnpm -C packages/core exec vitest run test/domain/source/portable-identity.test.ts test/domain/bundle/resolution.test.ts` — **exit 0**, 2 files and 26 tests passed.
- `pnpm -C packages/app run lint:fix` — **exit 0**, 0 errors and 525 warnings, unchanged from the original Task 2 report.
- `pnpm -C packages/core run lint:fix` — **exit 0**, 0 errors and 19 warnings, all in untouched registry/port files.
- `pnpm -C packages/app run build` — **exit 2**, the same 18 downstream deploy/migration TypeScript errors recorded above for Tasks 3/6; no types were weakened and no deferred files were changed.
- `git diff --check` — **passed**.

### Files changed

- `packages/app/src/stores/lockfile-v3.ts`
- `packages/app/test/stores/lockfile-v3.test.ts`
- `packages/app/test/stores/lockfile-v3-schema.test.ts`
- `packages/core/src/domain/bundle/resolution.ts`
- `packages/core/src/domain/source/portable-identity.ts`
- `packages/core/src/public/schemas/lockfile-v3.schema.json`
- `.superpowers/sdd/2026-10-12-portable-source-identity/task-2-report.md`

### Self-review and concerns

- Source-family compatibility lives in core and is invoked by the strict desired-state reader after descriptor and logical-key validation. The Draft-07 schema cannot correlate an arbitrary bundle key to a dynamic `sources` map key, so schema examples now pair each accepted resolution with its correct source family while runtime enforces the cross-reference.
- Both runtime and schema reject any non-path field on linked file records. The shared URL predicate preserves active source-locator behavior and closes the evidence-only query-key gap.
- No unrelated files or generated output changed. The app build remains blocked only by the previously recorded deferred Tasks 3/6 errors; the full app suite was not rerun.

### Fix commit

- `fix(app): enforce v3 lockfile identity invariants`
- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
