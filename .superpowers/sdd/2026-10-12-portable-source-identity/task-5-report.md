# Task 5 — Portable local snapshots and runtime bindings

Branch: `feat/unify-bundle-lifecycle-slice-1`

## RED

Command, run before production implementation:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts test/adapters/local-adapter.test.ts test/adapters/local-skills-adapter.test.ts test/adapters/local-awesome-copilot-adapter.test.ts
```

Observed output:

```text
Test Files  1 failed | 3 passed (4)
Tests       8 failed | 56 passed (64)
```

All eight new tests failed at the expected missing-capability assertion: local adapters had no `resolvePortableBundle` function. The three existing local adapter suites passed.

## GREEN

The same focused selector after implementation:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts test/adapters/local-adapter.test.ts test/adapters/local-skills-adapter.test.ts test/adapters/local-awesome-copilot-adapter.test.ts
```

Final output:

```text
Test Files  4 passed (4)
Tests       65 passed (65)
```

The new suite now has nine tests, including symlink non-traversal.

## Behavior and files

- Added `packages/infra/src/adapters/local-portable-resolution.ts` for portable local identity, workspace-root anchoring, explicit external bindings, safe raw-byte inventories, and local pin verification. It reuses core source identity validation and `sourceContentDigest`.
- Added `resolvePortableBundle` to `LocalAdapter`, `LocalAwesomeCopilotAdapter`, and `LocalSkillsAdapter`; exported the shared helper from the adapters barrel. Snapshot pins include the selected bundle/collection selector and digest raw inputs. `local-skills` stays `live`.
- Inventory acquisition uses injected `FileSystem.lstat` and `readFileBytes`; symbolic links are skipped rather than followed. The in-memory filesystem test double now reports ordinary `lstat` results.
- Added `packages/infra/test/adapters/local-portable-resolution.test.ts` for clone independence, relevant roots/selectors, explicit bindings and diagnostics, binary bytes/order-independent digesting, symlink safety, snapshot replay verification, live skills replay without writes, and same-name/different-root replay failure.
- No local-apm, binding/override storage, desired-state absolute roots, or cross-scope join logic was added.

## Validation

| Command | Result |
|---|---|
| `pnpm -C packages/infra run build` | Passed (`tsc` and template copy). |
| `pnpm -C packages/infra run lint:fix` | Exit 0; 0 errors and 96 warnings. Warnings are in existing infra code/tests, primarily `require-await` and one `no-console`. |
| `pnpm -C packages/infra run test` | Passed: 82 files, 895 tests. The existing invalid-YAML fixture in `awesome-copilot-bundle-provider.test.ts` emits expected stderr while its test passes. |

During implementation, the first build exposed a missing optional manifest-output-path argument in the local Awesome Copilot adapter; it was added and the final build passed. The first lint attempt reported seven `no-shadow` errors in the new adapter loops; names were corrected, and the final `lint:fix` completed with no errors. An intermediate focused run caught and corrected a missing collection-input fixture, an error-message expectation, and an invalid local-path fixture.

## Boundary note

External binding names are lockfile-scoped. This infra slice verifies the supplied binding/root and replay content but does not join sources across lockfiles; a later cross-scope operation must use an explicit binding association and resolved roots rather than treating equal names as proof of source equivalence.

## Fix round 1 — root-cause corrections

Base: `5f6f35b9e2e0da10c817ef3b123dcf6d29c96e18`
Branch: `feat/unify-bundle-lifecycle-slice-1`

### Finding 1 — Preserve known digest evidence

**RED**

Before changing production code, added the public local-adapter cases:

- `rejects a local snapshot when its known raw deployment-manifest digest differs`
- `reports known archive digests that local snapshots cannot verify`

Command:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts --reporter=dot
```

Output excerpt:

```text
❯ test/adapters/local-portable-resolution.test.ts (17 tests | 7 failed)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
... rejects a local snapshot when its known raw deployment-manifest digest differs
AssertionError: promise resolved instead of rejecting
```

Both digest cases were among the seven expected red regressions: manifest evidence was dropped and archive evidence was silently ignored.

**GREEN**

The local resolver now checks `manifestSha256` against the selected raw manifest bytes (deployment manifest for `local`, selected collection YAML for `local-awesome-copilot`). `sourceContentSha256` remains verified over raw selected inputs. Unsupported local archive digest evidence fails with `BUNDLE.UNSUPPORTED_DIGEST_EVIDENCE` before acquisition rather than being replaced by a new pin.

Focused command:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts -t 'known raw deployment-manifest|known archive digests'
```

Output: `2 passed | 15 skipped (17)`.

Additional positive coverage confirms matching raw deployment-manifest and collection-manifest hashes are accepted:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts test/adapters/local-adapter.test.ts test/adapters/local-skills-adapter.test.ts test/adapters/local-awesome-copilot-adapter.test.ts
```

Final focused output: `4 passed (4); 76 passed (76)`.

### Finding 2 — Refuse symlinked source-root ancestors before reads

**RED**

Added `refuses to read a local source beneath a symlinked ancestor`, using the injected filesystem to model `/workspace/link` as a symlink while placing candidate content under `./link/registry`.

The same RED command above reported the test among seven failing regressions; it returned a resolved payload instead of rejecting, demonstrating that final-root `lstat` alone traversed the ancestor.

**GREEN**

Local inventory now inspects each component of the absolute configured root path with injected `lstat` before reading directory entries or file bytes. A symlinked component fails as `FS.LOCAL_SOURCE_UNAVAILABLE`; symlink entries inside the inventory remain skipped as before.

Focused command:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts -t 'symlinked ancestor|relative configured source association'
```

Output: `2 passed | 15 skipped (17)`. The full focused local adapter run also passed: `4 passed (4); 76 passed (76)`.

### Finding 3 — Verify binding association without CWD guessing

**RED**

Added `does not guess a relative configured source association from an external binding root`, using source URL `./registry` with an unrelated absolute binding root. It was among the seven expected RED failures: the adapter read from the binding despite having no workspace anchor to establish that association.

**GREEN**

Both `resolveLocalSourceIdentity` and root acquisition now require an absolute configured locator to match the explicit binding root. A relative locator without a workspace anchor fails actionably with `CONFIG.UNVERIFIABLE_LOCAL_BINDING`; a mismatched absolute locator continues to fail with `CONFIG.CONFLICTING_LOCAL_BINDING`.

Focused command and output:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts -t 'symlinked ancestor|relative configured source association'
```

`2 passed | 15 skipped (17)`.

### Finding 4 — Exact local skill IDs precede canonical legacy aliases

**RED**

Added cases for an exact skill ID that also suffix-matched another skill, rejection of arbitrary suffix IDs, and preservation of the exact existing source-specific legacy ID. The exact-priority and arbitrary-suffix cases were among the seven expected RED failures; the exact legacy alias case passed as a compatibility check.

**GREEN**

`LocalSkillsAdapter` now gathers exact logical-ID matches first and uses only the exact `buildBundleId` result as a legacy alias when there is no exact match. Arbitrary `endsWith` matching is removed. `local-skills` remains live and its existing no-write replay behavior is unchanged.

Focused command and output:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts -t 'exact local skill ID|arbitrary local skill ID suffixes|source-specific legacy local skill ID'
```

`3 passed | 14 skipped (17)`.

### Finding 5 — Reject selected collection output collisions

**RED**

Added `rejects selected collection inputs that flatten to the same output filename`, selecting two distinct `example.prompt.md` inputs from different directories. It was among the seven expected RED failures: later bytes silently replaced earlier bytes at `prompts/example.prompt.md`.

**GREEN**

The local Awesome Copilot adapter tracks each selected output path and source path. Distinct selected inputs mapping to one output fail actionably with `BUNDLE.OUTPUT_PATH_COLLISION`; generated manifest selectors and output bytes remain aligned for collision-free selections.

Focused command and output:

```sh
pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts -t 'flatten to the same output filename'
```

`1 passed | 16 skipped (17)`.

The positive `keeps generated collection selectors pointed at the matching selected output bytes` regression also passes in the final focused local adapter run (`76 passed`).

### Changed files

- `packages/infra/src/adapters/local-portable-resolution.ts` — verify supported digest evidence, bind absolute roots only, and reject symlinked source-root ancestors before acquisition.
- `packages/infra/src/adapters/local-adapter.ts` — pass raw deployment-manifest bytes for digest verification.
- `packages/infra/src/adapters/local-awesome-copilot-adapter.ts` — pass raw collection-manifest bytes and reject selected output collisions.
- `packages/infra/src/adapters/local-skills-adapter.ts` — exact skill ID priority and exact source-specific legacy alias matching.
- `packages/infra/test/adapters/local-portable-resolution.test.ts` — regression and preservation coverage for all five findings.

No changes were made to `local-apm-adapter.ts`, core contracts, binding storage, lockfile equivalence, or symlink-following behavior.

### Validation

| Command | Result |
|---|---|
| `pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts test/adapters/local-adapter.test.ts test/adapters/local-skills-adapter.test.ts test/adapters/local-awesome-copilot-adapter.test.ts` | Passed: 4 files, 76 tests. |
| `pnpm -C packages/infra run build` | Passed: `tsc` and template copy. |
| `pnpm -C packages/infra run lint:fix` | Exit 0: 0 errors, 96 warnings (95 `require-await`, 1 `no-console`); no warning was reported in a changed file. This matches the prior Task 5 baseline of 96 warnings. ESLint also prints its existing multiple-projects advisory. |
| `pnpm -C packages/infra run test` | Passed: 82 files, 906 tests. The invalid-YAML fixture in `awesome-copilot-bundle-provider.test.ts` prints expected stderr while its test passes, as in the prior baseline report. |

### Review and concerns

- Raw selected file bytes and source-content digests are retained; known unsupported archive evidence is rejected, not discarded.
- Workspace-relative identities/selectors remain portable. Workspace-anchored roots are resolved from the supplied workspace, and live local skills are neither copied nor written.
- Root validation intentionally rejects configured source paths containing symlink ancestors; configure the real path for such sources. It does not add symlink following or alter per-entry symlink skipping.
- Binding associations are runtime-only; equal binding names do not establish cross-lockfile equivalence.
