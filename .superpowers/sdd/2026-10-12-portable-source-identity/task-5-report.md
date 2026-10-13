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
