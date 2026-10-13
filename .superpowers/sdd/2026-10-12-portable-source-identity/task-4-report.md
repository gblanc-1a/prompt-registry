# Task 4: Portable GitHub resolution report

## TDD evidence

The focused adapter selector was run before production implementation:

```text
pnpm -C packages/infra exec vitest run test/adapters/github-portable-resolution.test.ts test/adapters/github-adapter.test.ts test/adapters/skills-adapter.test.ts test/adapters/awesome-copilot-adapter.test.ts
```

RED result: the 8 new portable-resolution tests failed because the adapters did not yet implement `resolvePortableBundle`; the 80 existing adapter tests passed.

After implementation, the same selector exposed an incorrect expected digest in the new Skills fixture. The actual digest was `498bd0e1bfff8777ac647b2e6c165ace615c3df0ba9e6a6227de4d9049ddd1af`, consistent with the shared raw-file map digest contract for the relative source paths `SKILL.md` and `assets/data.bin`. The fixture was corrected; no production digest behavior was changed for that mismatch.

## Implementation

- Added a shared GitHub identity helper that resolves provider repository IDs, preserves identity through renames, rejects repository replacement and credential-bearing locators, and records effective tree selectors.
- Added portable release acquisition by exact release/asset IDs, archive SHA-256 verification, and manifest ID/version validation; returned payloads retain the original archive bytes.
- Added commit-pinned Skills and Awesome Copilot tree acquisition, source-content verification, and explicit unpinned evidence for mutable external collection inputs.
- Kept legacy listing, downloading, and resolver paths intact.

Changed files:

- `packages/infra/src/adapters/github-portable-resolution.ts`
- `packages/infra/src/adapters/github-adapter.ts`
- `packages/infra/src/adapters/skills-adapter.ts`
- `packages/infra/src/adapters/awesome-copilot-adapter.ts`
- `packages/infra/src/adapters/index.ts`
- `packages/infra/test/adapters/github-portable-resolution.test.ts`

## Validation

| Command | Result |
| --- | --- |
| `pnpm -C packages/infra exec vitest run test/adapters/github-portable-resolution.test.ts test/adapters/github-adapter.test.ts test/adapters/skills-adapter.test.ts test/adapters/awesome-copilot-adapter.test.ts` | Passed: 4 files, 92 tests |
| `pnpm -C packages/infra exec vitest run test/resolvers/github-resolver.test.ts test/resolvers/skills-resolver.test.ts test/resolvers/awesome-copilot-resolver.test.ts` | Passed: 3 files, 37 tests |
| `pnpm -C packages/infra test` | Passed: 81 files, 866 tests |
| `pnpm -C packages/infra run build` | Passed (`tsc` and template copy) |
| `pnpm -C packages/infra run lint:fix` | Passed: 0 errors; 97 warnings |
| `git diff --check` | Passed |

No unrelated consumer-fixture failures were observed in the owning infra suite.

## Concern

Portable release resolution currently accepts ZIP artifacts only. The retained legacy catalog recognizes `.tar.gz` assets, but the existing injected/default `BundleExtractor` is ZIP-only. Legacy behavior is unchanged; portable resolution of a tarball release remains unsupported.
