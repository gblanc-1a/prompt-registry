# Task 7 — Registered-command corrective-slice acceptance

## Checkpoint and scope

Task 7 covers the supported CLI USER/VSCODE portable-v3 corrective slice only.
Tasks 1–6 are already present through `f4990c2d`; lifecycle refactors, Tasks
8–9, and VS Code extension integration remain out of scope. The original plan
and its supersession notice were not changed.

The registered tests use `runCommand`, real temporary filesystem state, and
production command classes. Only interactive prompts and external providers
are substituted at their boundaries. No deploy unit under test is mocked.

## Coverage matrix

| Required behavior | Existing coverage reused | Task 7 registered-command coverage |
|---|---|---|
| Install → inspect desired/local → exact replay → uninstall | Existing install and uninstall command tests | `keeps the registered install/replay/uninstall lifecycle on one portable key and pin` checks both state halves, unchanged desired bytes and resolution on replay, restored target files, and key removal/cleanup on uninstall |
| No registry `sourceId` or absolute source roots; source aliases share key/pin | `resolve-portable-bundle.test.ts` covers adapter identity independence | `keeps logical keys and exact local pins stable when the registry source alias changes` changes the active hub source ID and name, checks the same key/pin/files, canonical relative locator, no `sourceId`, no absolute workspace path, and no old aliases in desired state |
| Immutable remote pins, exact replay, and no latest fallback | `install-unified.test.ts`: provider release pins, exact pinned replay, missing pin, and “never downloads the latest instead” | Reused; no duplicate provider/CLI cases added |
| Stable local digests across clone roots and changed-source rejection | `local-portable-resolution.test.ts`: same workspace-relative identity/content digest across roots and changed snapshot replay rejection | Alias test additionally compares recorded local resolution and installed files |
| Flag-off refusal leaves v3 state and target unchanged | Existing registered CLI parameterized status/update/uninstall refusal and install refusal cases | Reused; both lockfiles and target tree are compared before/after |
| v2 and branch-era v3 metadata, completion markers, retained evidence, and conflicts | `install-unified.test.ts`, `migrate-lockfile-v3.test.ts`, and `portable-identity-migration.test.ts`, including stale completion marker, amended v3 evidence, conflicting digests/materializations, and distinct same-basename roots | Reused at migration/replay boundaries; no identical cases duplicated |
| Changed release asset/tree content fails pin verification | `github-portable-resolution.test.ts`: replaced asset ID, changed archive bytes, tree digest mismatch; `local-portable-resolution.test.ts`: changed snapshot digest | Reused at adapter boundary; no duplicate lower-level verification test added |
| Missing external binding yields actionable replay failure with no writes | Existing binding identity behavior in app/infra | `keeps a missing external binding as an actionable replay failure without writes` verifies key, reason, `CONFIG.MISSING_LOCAL_BINDING`, unchanged desired bytes, absent local half/target files, and zero FS writes |
| Live-source refusal is pre-effect; dry-run is mutation-free | Existing copy-only deploy preflight and dry-run coverage | `fails a live local-skills install before placement or lockfile writes` exercises the interactive registered path; `runs a local dry-run with rejecting mutation ports and leaves both state halves untouched` rejects all mutation methods |
| Ownership, intent, and diagnostics survive failures | Existing migration, replay, and uninstall command tests | Lifecycle test verifies ownership removal; missing-binding test verifies failed intent is not replayed or rewritten; live-source case verifies actionable refusal and no target/lockfile effects |

## RED/GREEN evidence

- **RED command:** `pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts`
- **RED observation:** The new interactive local-skills case exposed a registered-command gap: the copy-only resolver printed the live-source refusal, but the hub picker returned exit code `0` and JSON `status: "ok"` with `installed: 0/1`. No deployment target or lockfile effects occurred.
- **Production correction:** `interactiveBundleSelection()` now reports `warning` for incomplete selection installs and returns non-zero for an incomplete install when unified deploy is enabled. With the flag off, the previous exit behavior remains unchanged.
- **GREEN command:** `pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts`
- **GREEN output:** `Test Files 1 passed (1); Tests 24 passed (24); Duration 1.19s` on the final focused run.

## Validation

| Command | Result |
|---|---|
| `pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts` | Passed: 1 file, 24 tests |
| `pnpm -C packages -r lint:fix` | Passed on the final run with no errors. The initial pass identified a `no-shadow` error and an unnecessary async prompt mock in the new fixture; the callback parameter was renamed and mock made synchronous. Remaining workspace output is warning-only. No non-fixing lint command was run. |
| `pnpm -C packages -r build` | Passed across 8 of 9 workspace projects. Website output warned that `website/docs` does not exist; Docusaurus still compiled client/server and generated the site. Node also emitted its localStorage experimental warning. |
| `pnpm -C packages -r test` | **Failed twice under recursive parallel load** in `lib/dist-test/test/release-manifest.test.js`, each at a different `createReleaseManifestPlan()` `before each` hook. First: `creates a canonical manifest with an integrity inventory over archive bytes` timed out at 2000 ms (`169 passing`, `1 failing`). Second: `keeps collection tags at the root and does not clone them onto items` timed out at 2000 ms (`170 passing`, `1 failing`). No timeout test was modified. |
| `pnpm -C packages -r --workspace-concurrency=1 test` | Passed on the final serial run (exit 0), including all recursive workspace suites. CLI summary: 37 files and 512 tests passed. Extension integration emitted unauthenticated GitHub-session and VS Code chat-participant diagnostics, but exited successfully. |
| `pnpm -C website run build` | Passed. Docusaurus warned that `website/docs` is absent and Node emitted the localStorage experimental warning; static files were generated. |

## Files and self-review

- `packages/cli/src/commands/install.ts` — corrected incomplete interactive unified installs to warn and exit non-zero.
- `packages/cli/test/commands/unified-deploy-user-scope.test.ts` — added registered lifecycle, alias identity/pin, missing binding, mutation-rejecting dry-run, and interactive live-source acceptance cases.
- `docs/user-guide/sources.md` — documented the opt-in CLI scope, supported source/archive boundary, named bindings, and deferred integrations.
- `docs/contributor-guide/architecture/installation-flow.md` — documented verified target, source/pin limits, binding/path privacy, live refusal, and alias-independent keys.
- `docs/reference/adapter-api.md` — documented portable resolution semantics and distinguished adapter presence from end-to-end v3 support.

Self-review confirmed the implementation change is limited to the interactive flag-on failure path; legacy flag-off behavior is unchanged. The report and direct docs describe the current supported slice rather than advertising unsupported provider or extension capabilities. The unrelated, initially dirty `github-actions/validate-collections/dist/index.js` remains excluded from the Task 7 commit; the required recursive build also regenerates that workspace artifact. The original plan notice remains untouched.

## Commit and concerns

Planned scoped commit: `test(cli): verify portable v3 lifecycle across machine configurations`, with the required Copilot co-author trailer. The commit hash will be provided in the task completion status.

Only validation concern is the reproducible-under-load but serially passing `lib` setup-hook timeout described above. Website and extension diagnostics were non-fatal.
