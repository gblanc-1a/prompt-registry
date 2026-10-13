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

## Fix round 1 — reviewer findings

### Findings addressed

1. **Legacy desired intent discarded:** unioned the remaining old desired generation with an already-written desired generation while migration is incomplete. The role boundary is preserved: only the selected legacy desired source and, when a current desired file exists, the first prior desired candidate contribute intent; a later legacy local half is never reinterpreted as desired intent.
2. **Conflicting baselines collapsed:** stopped grouping app candidates before core policy evaluation. Core receives each raw candidate, and deterministic local retention keys include the materialization projection so differing stored/installed checksums remain separate complete records.
3. **Historical local pins replaced:** each candidate now carries its own resolution evidence into core classification. Desired and local pins are compared independently; disagreement retains the desired record as unresolved and the actual local pin with its materialization.
4. **Credential-bearing evidence leaked:** added a shared credential-free diagnostic-value validator and restricted retained selectors to an explicit safe-field allowlist. Credential-bearing refs, URL credentials, and unsafe selector values are omitted rather than copied.
5. **Stale ownership resurrected after completion:** legacy records are ignored only when the completion marker accompanies amended desired and local shapes. A branch-era marker does not bypass conversion. Completed amended pairs still schedule deletion of stale legacy files without importing their ownership.
6. **Known outer digests were lost:** canonicalization now combines independently valid outer hashes with partial resolution metadata before converting incomplete pins to unpinned evidence.
7. **Incompatible MCP records merged:** core now detects incompatible MCP config destinations/server ownership; distinct complete materializations get distinct retention keys.
8. **Temporary vs. permanent evidence:** conversion strips temporary portable mappings from completed managed records and clears only that temporary mapping field from unmanaged records, retaining their permanent diagnostic evidence.
9. **Lint warning accounting:** recorded the current package lint-fix warning totals separately from errors; both commands completed with zero errors (core 19 warnings, app 526 warnings).

### RED/GREEN evidence

- Initial core regression run: `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — **RED**, 3 failures: credential-bearing source diagnostics, missed MCP conflicts, and colliding materialization retention keys.
- Initial app regression run: `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — **RED**, 7 failures: lost legacy intent, collapsed baselines, replaced local pin, stale ownership resurrection, dropped outer digests, merged MCP destinations, and temporary evidence behavior.
- Credential-selector mutation probe — **RED**: a credential-bearing selector was retained by the pre-fix diagnostic projection.
- Additional role-boundary regression: `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts -t 'unions remaining legacy intent'` — **RED**, 1 failed / 45 skipped; the plan incorrectly added `local-only` from the old local half as desired intent alongside `web-dev`.
- Focused fix: `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts -t 'unions remaining legacy intent'` — **GREEN**, 1 passed / 45 skipped; only the old desired intent remains unresolved.
- Core migration policy: `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — **GREEN**, 1 file / 12 tests passed.
- App migration and resume coverage: `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — **GREEN**, 1 file / 46 tests passed.
- Related no-match undeploy coverage: `pnpm -C packages/app exec vitest run test/deploy/undeploy.test.ts -t 'no match|matches nothing|ownership match'` — **GREEN**, 3 passed / 26 skipped.

### Files changed

- `packages/core/src/domain/install/portable-identity-migration.ts`
- `packages/core/src/domain/source/portable-identity.ts`
- `packages/core/test/domain/install/portable-identity-migration.test.ts`
- `packages/app/src/stores/migrate-lockfile-v3.ts`
- `packages/app/test/stores/migrate-lockfile-v3.test.ts`

### Validation and remaining failures

- `pnpm -C packages/core lint:fix` — **exit 0**, 0 errors / 19 warnings.
- `pnpm -C packages/core build` — **exit 0**.
- `pnpm -C packages/app lint:fix` — **exit 0**, 0 errors / 526 warnings.
- `git diff --check` — **passed**.
- Full core suite — **6 failed / 350 passed**, all six are the pre-existing Task 6 legacy-shape schema fixtures in `test/domain/install/lockfile-version.test.ts`; strict schema was not weakened.
- Full app suite — **4 files failed, 123 failed / 863 passed**, confined to the known Task 6 deploy lifecycle consumers: `test/deploy/deploy.test.ts`, `test/deploy/plan.test.ts`, `test/deploy/resolve-undeploy-key.test.ts`, and `test/deploy/undeploy.test.ts`.
- `pnpm -C packages/app build` — **exit 2**, 14 known Task 6 deploy lifecycle type errors in `src/deploy/deploy.ts`, `src/deploy/plan.ts`, `src/deploy/resolve-undeploy-key.ts`, and `src/deploy/undeploy.ts`; no migration-file errors were reported.

### Self-review and concerns

- Rechecked the original failure causes against the changed boundaries: app now classifies source-document shapes and composes IO, while core owns candidate grouping/conflicts and retention-key evidence. No new desired-state map, migration journal, network fetch, or schema relaxation was introduced.
- Added a follow-up role-boundary regression after review exposed that unioning every v2 candidate could reinterpret the old local half as desired intent; the narrowed selection now retains desired intent without importing local-only rows.
- Remaining failures are the named Task 6 deploy lifecycle and schema-fixture work only. No additional migration-specific blocker or ambiguity remains.

### Fix commit

- `fix(app): preserve legacy identity candidates without collapsing evidence`
- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## Fix round 2 — important diagnostic and digest evidence findings

### Findings addressed

1. **Embedded credential URLs in shared diagnostics:** `isSafeDiagnosticValue` now scans HTTP(S) URLs anywhere in a diagnostic string, not only strings beginning with a URL. Direct URL validation and credential-assignment/query-key guards remain intact. Public `classifyLegacyIdentity` tests cover direct and prefixed userinfo URLs in both `sourceId` and `descriptor.ref`; unsafe values are omitted while ordinary `sourceRef`/`ref` values remain.
2. **Embedded digest evidence lost during migration:** historical resolution normalization now unions valid hashes from resolution fields, existing resolution evidence, and outer entry fields without replacing embedded values with absent outer properties. When values for the same digest kind conflict, no single hash is selected: each conflicting value is retained under source-labeled migration evidence in `knownPins`, while that digest kind is omitted from `knownDigests`.

### RED/GREEN evidence

- **Core RED:** `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — **exit 1**, 2 failed / 14 passed. The failures reproduced prefixed credential-bearing URLs leaking through `sourceRef` and selector `ref`; direct URL and existing query-key cases passed.
- **App RED:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — **exit 1**, 3 failed / 46 passed. The embedded-only and mixed embedded/outer digest cases lost hashes, and conflicting embedded/outer archive hashes were not both preserved.
- **Core GREEN:** `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` — **exit 0**, 1 file / 16 tests passed.
- **App GREEN:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — **exit 0**, 1 file / 49 tests passed, including the pre-existing outer-only digest regression.
- The first post-fix app run exposed an invalid negative `toHaveProperty` assertion when `knownDigests` was absent; the test was corrected to assert the optional digest is `undefined`, then the focused app suite passed.

### Files changed

- `packages/core/src/domain/source/portable-identity.ts`
- `packages/core/test/domain/install/portable-identity-migration.test.ts`
- `packages/app/src/stores/migrate-lockfile-v3.ts`
- `packages/app/test/stores/migrate-lockfile-v3.test.ts`
- `.superpowers/sdd/2026-10-12-portable-source-identity/task-3-report.md`

### Validation and concerns

- `pnpm -C packages/core build` — **exit 0**.
- `pnpm -C packages/core lint:fix` — **exit 0**, 0 errors / 19 warnings; all warnings are in untouched core files. Focused lint-fix on changed core files produced no warnings.
- `pnpm -C packages/app lint:fix` — **exit 0**, 0 errors / 526 warnings. Focused lint-fix reported 9 warnings in the two changed app files, all at pre-existing, untouched lines (one source warning and eight test-helper/test warnings); none are in the new/modified hunks.
- Full core suite, `pnpm -C packages/core exec vitest run --reporter=dot` — **exit 1**, 1 file failed / 25 passed; 6 failed / 354 passed. The failures are the six known Task 6 legacy-shape schema fixtures in `test/domain/install/lockfile-version.test.ts`; the v3 schema was not changed.
- Full app suite, `pnpm -C packages/app exec vitest run --reporter=dot` — **exit 1**, 4 files failed / 61 passed; 123 failed / 866 passed. Failures remain in the known Task 6 deploy consumers: `test/deploy/deploy.test.ts`, `test/deploy/plan.test.ts`, `test/deploy/resolve-undeploy-key.test.ts`, and `test/deploy/undeploy.test.ts`.
- `pnpm -C packages/app build` — **exit 2**, the 14 known Task 6 type errors remain in `src/deploy/deploy.ts`, `src/deploy/plan.ts`, `src/deploy/resolve-undeploy-key.ts`, and `src/deploy/undeploy.ts`; no errors were reported in the changed migration file.
- `git diff --check` — passed.

### Self-review and concerns

- Digest disagreements are retained as evidence rather than silently selecting embedded or outer values. Valid independent digest kinds continue to be preserved together.
- Existing safe references, direct credential-query key rejection, repository diagnostic helpers and strict v3 schema behavior are unchanged.
- The already-portable MCP ownership observation from the review remains tracked for the final gate and was deliberately not expanded in this round.

### Fix commit

- `fix(migration): preserve safe diagnostics and digest evidence`
- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## Fix round 3 — Important digest alias normalization

### Finding addressed

- Outer digest aliases were selected with raw nullish coalescing before normalization. A malformed preferred `archiveSha256` could therefore mask a valid `archiveSha` or `checksum` and erase its conflict with an embedded archive hash.
- Normalize each outer, resolution, and embedded-evidence digest alias independently. Union every valid digest, keep conflicting values under source-attributed `knownPins`, and leave that digest kind out of `knownDigests`. The same candidate collection is used for strict-resolution mismatch detection and outer-only historical pins.
- Added app migration coverage spanning `archiveSha256`/`archiveSha`/`checksum`, source-content and manifest digests, conflicting embedded evidence, and malformed preferred aliases.

### RED/GREEN evidence

- **RED:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts -t 'normalizes every historical digest alias before retaining conflicts'` — **exit 1**, 1 failed / 49 skipped. Valid `archiveSha` and `checksum` conflicts were absent when the preferred outer `archiveSha256` value was malformed. The initial fixture also used non-hex placeholders for some additional aliases; these were corrected to valid SHA-256 literals before the green run.
- **Focused GREEN:** the same selector — **exit 0**, 1 passed / 49 skipped.
- **Migration GREEN:** `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts` — **exit 0**, 1 file / 50 tests passed, including embedded-only, outer-only, combined, and conflict coverage.

### Validation and concerns

- `pnpm -C packages/app lint:fix` — **exit 0**, 0 errors / 526 warnings.
- `pnpm -C packages/app build` — **exit 2**, with the 14 known Task 6 deploy type errors in `src/deploy/deploy.ts`, `src/deploy/plan.ts`, `src/deploy/resolve-undeploy-key.ts`, and `src/deploy/undeploy.ts`; no migration-file errors.
- `git diff --check` — passed.
- No core migration helper changed. The outstanding app build errors are the previously tracked Task 6 deployment/schema integration work; this fix does not weaken schemas or alter that scope.

### Fix commit

- `fix(app): preserve all valid legacy digest aliases`
- `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
