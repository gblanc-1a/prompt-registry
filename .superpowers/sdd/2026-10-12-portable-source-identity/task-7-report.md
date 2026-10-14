# Task 7 — Registered-command corrective-slice report

## Checkpoint and scope

Task 7 closes registered CLI user-scope v3 acceptance gaps only. Work started
at `1ff60d968aebaa002ce5f18ad0843fb479512886` on
`feat/unify-bundle-lifecycle-slice-1`. Tasks 8–9 and extension integration
remain deferred. The original plan and its supersession notice were not
changed.

Only production discrepancy found was the flag-off interactive incomplete
install JSON regression: `install.ts` emitted `warning` unconditionally but
gated its non-zero exit on the unified-deploy flag. The fix gates both outputs
on the same `unifiedFailure` condition. Other required behaviors were already
correct; their new registered cases are first-green characterization, not
production fixes.

## Registered coverage matrix

| Requirement | Registered coverage | Observable assertions |
|---|---|---|
| Flag-off incomplete interactive regression | `packages/cli/test/commands/unified-deploy-user-scope.test.ts` — `preserves legacy flag-off ok JSON status for an incomplete interactive install` | Real `runCommand`, real local hub/filesystem, `status: ok`, empty warnings, `installed: 0/1`, exit `0`, no deployment/state writes |
| Flag-on incomplete selection | Same file — `fails a live local-skills install before placement or lockfile writes` | JSON `warning`, exit `1`, actionable live-source refusal, target and both lockfiles untouched |
| Stale old-v3 completion marker and local-first interruption | Same file — `resumes a branch-era v3 local-first migration offline without duplicating legacy ownership` | Real XDG files, interruption after local rename, incomplete marker/state observed, offline restart, retained unresolved intent and digests, one old unmanaged owner, one new desired entry, no HTTP/cache |
| Conflicting aliases, historical pins and baselines | Same file — `retains conflicting branch-era aliases, pins, and file baselines as separate reported records` | Two legacy aliases/pins remain unresolved and reported; known pins and both baseline/checksum pairs retained; two distinct unmanaged records; no merge or overwrite |
| Independent clone/machine roots | Same file — `produces identical portable desired state across independent clone roots and replays local bytes` | Two canonical real roots and source absolute paths differ; aliases differ; logical key, relative locator, local digest/files and desired-lockfile bytes match; second root replays correct real files with provider lookup denied |
| Moved tree branch / incompatible configured ref | Same file — `replays a moved tree branch from the recorded commit, not an incompatible configured ref` | After branch movement and hub ref change, replay fetches recorded commit only, never resolves `main`/`master`, preserves desired bytes/pin/source descriptor and materializes pinned bytes |
| Unavailable release metadata with existing ownership | `packages/cli/test/commands/install-unified.test.ts` — `keeps remote ownership and pinned intent after metadata outage, then uninstalls offline` | Registered `runCommand`, real files/state and mocked HTTP/token boundaries; exact pin/ownership/desired bytes retained after provider 503, actionable replay failure, no writes/latest lookup, then provider-free uninstall |
| Changed bytes under the same asset ID | Same file — `rejects altered bytes for the same pinned asset before placement without latest fallback` | Exact release pin and asset ID returned with altered valid ZIP; digest mismatch before writes, no release-list/tag fallback, unchanged state and no target file |
| Existing exact release pin/replay cases | Same file — `records the provider source identity and exact release pin when no source is configured`; `fetches the recorded source descriptor at the pinned version and deploys it`; `fails closed when the pinned version is not a release, and never downloads the latest instead` | Existing registered coverage reused; `runRemote` now uses public `runCommand` with injected external HTTP/token boundaries |
| Existing missing-binding, dry-run and cleanup coverage | `unified-deploy-user-scope.test.ts` — `keeps a missing external binding as an actionable replay failure without writes`; `runs a local dry-run with rejecting mutation ports and leaves both state halves untouched`; plus existing uninstall cases | Registered entry point, real filesystem, retained desired bytes/ownership and no mutation on refusal/dry-run |

Only the prompt and external HTTP/token boundaries are substituted. Target files,
lockfiles, hub configuration and clone roots use real filesystem state; write
assertions inspect the recording filesystem's actual output paths.

## TDD evidence

**RED — flag-off warning regression**

```text
pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts -t 'preserves legacy flag-off ok JSON status'
```

Observed the intended assertion failure: expected `status: "ok"`, received
`status: "warning"`; exit code was already `0`. The test also checks that the
flag-on counterpart emits `warning` and exits `1`.

**GREEN — corrected behavior and final registered cases**

```text
pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts test/commands/install-unified.test.ts
```

Passed: 2 test files, 93 tests. The release metadata/asset, clone/tree, and
migration/conflict cases were first-green characterizations. During test
authoring, initial runs caught fixture/setup mistakes (clone archive location,
provider-call log including initial install requests, and the existing
uninstall behavior retaining an empty local v3 file); setup/assertions were
corrected without changing production behavior or weakening the required
ownership/state checks.

## Validation

| Command | Result |
|---|---|
| `pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts test/commands/install-unified.test.ts` | Passed: 2 files, 93 tests |
| `pnpm -C packages/cli test` | Passed: 37 files, 519 tests |
| `pnpm -C packages/cli run lint:fix` | Passed, 0 errors; 11 existing warnings in other CLI tests (`hub.test.ts`, `install.test.ts`, `framework/hub-manager.test.ts`). No non-fixing lint run followed. |
| `pnpm -C packages -r build` | Passed, exit 0 (8 of 9 workspace projects). Website/Docusaurus compiled; warnings: absent `website/docs` and Node's experimental localStorage notice. |
| `pnpm -C packages -r --workspace-concurrency=1 test` | Passed, exit 0 after the final changes. |
| `git --no-pager diff --check -- . ':!github-actions/validate-collections/dist/index.js'` | Passed, no whitespace errors in the scoped changes. |
| `pnpm -C website run build` | Not separately run: no website/docs source was changed; the package workspace build above included and passed the Docusaurus build. |

The recursive parallel test gate `pnpm -C packages -r test` was not repeated
because its prior failures are already recorded: two different `lib` release
manifest `beforeEach` setup hooks timed out at 2 seconds under parallel
workspace load (169 passing / 1 failing, then 170 passing / 1 failing).
Those tests were not changed; the full serial workspace run passed.

The pre-existing dirty `github-actions/validate-collections/dist/index.js`
remains excluded from the scoped change. The required package build invoked its
workspace build script; the artifact is not staged or restored. No docs pages
needed edits: the existing architecture documentation already states the
flag-on warning/non-zero behavior, and this fix restores the flag-off legacy
JSON behavior.

## Changed files and commit

- `packages/cli/src/commands/install.ts` — gate interactive incomplete warning
  and exit code together.
- `packages/cli/src/framework/golden.ts` — allow registered-command tests to
  inject external HTTP/token boundaries through `runCommand`.
- `packages/cli/test/commands/unified-deploy-user-scope.test.ts` — flag
  regression and real-filesystem migration, conflict, clone and tree cases.
- `packages/cli/test/commands/install-unified.test.ts` — registered remote
  metadata outage, offline cleanup and altered-asset acceptance.
- This report — final acceptance and validation evidence.

The scoped conventional fix commit and required co-author trailer are recorded
in the completion status.
