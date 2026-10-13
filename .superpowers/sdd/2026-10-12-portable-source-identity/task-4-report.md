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

---

# Task 4 fix round 1

Base: `b805d953882e3cdfccb8fd2973bfc704eb6ad92d`.

## RED evidence

Before changing production code, added adapter-boundary tests and ran:

```text
pnpm -C packages/infra exec vitest run test/adapters/github-portable-resolution.test.ts test/adapters/github-adapter.test.ts test/adapters/skills-adapter.test.ts test/adapters/awesome-copilot-adapter.test.ts
```

RED result: `1 failed | 3 passed` files; `10 failed | 93 passed` tests. Failures demonstrated:

- A pinned Skills path for `skills/demo` returned `null` for a request naming another skill instead of rejecting the logical-ID mismatch.
- A tree file path containing `a #?.bin` was requested unescaped and missed the injected byte fixture.
- Skills and Awesome Copilot ignored recorded archive/manifest digest kinds they could not verify.
- Awesome Copilot followed repository `default_branch: master` instead of its configured/default `main`.
- A fresh release-tag lookup with the wrong manifest ID returned no payload instead of trying a matching catalog release.
- Release selection chose a leading `.tar.gz` asset and rejected it without considering the later supported ZIP.
- GitHub release acquisition accepted incorrect known source-content and manifest digests.
- Adding the external skill fixture changed its complete source inventory; the old literal digest then failed with actual `d6ba8b4d37da267f9f9d6f22e6ed92d6fd5101e1f78c0208e66dccbbe10b8aa3`. The fixture expectation was updated to match the two external inputs and collection manifest; this was a test-fixture correction, not a production digest change.

The same RED run confirmed the direct Skills omitted-ref characterization already followed the repository metadata's `master` default. Existing pinned wrong-bundle release behavior also remained fail-closed.

## Fix

- Validate the requested Skills logical selector against the recorded `bundlePath` before tree acquisition.
- Keep Skills ref discovery based on the GitHub repository default when no ref/recorded descriptor exists; pass Awesome Copilot's own effective branch (`configured branch` or `main`) to shared identity resolution.
- Verify GitHub release `archiveSha256`, the core `sourceContentDigest` over extracted raw files, and `manifestSha256` over the extracted raw manifest bytes.
- Reject unsupported tree digest kinds with actionable `BUNDLE.UNSUPPORTED_DIGEST_EVIDENCE` errors rather than dropping historical evidence.
- Allow only fresh, unpinned release candidates to fall back after a manifest logical-ID mismatch. Reuse the resolved source metadata during fallback; pinned replay continues to address exact IDs and fails closed.
- URL-encode each repository path segment when constructing immutable raw-content URLs.
- Select a supported ZIP from the release asset list even when a tarball appears first; exact recorded unsupported assets still fail explicitly.
- Generate Awesome Copilot manifest file references from acquired output paths, preserve the collection logical ID, and fail if any generated manifest file reference is absent from the returned payload.
- Preserve legacy catalog/download/resolver behavior and external-input unpinned evidence.

## GREEN validation

| Command | Result |
| --- | --- |
| `pnpm -C packages/infra exec vitest run test/adapters/github-portable-resolution.test.ts test/adapters/github-adapter.test.ts test/adapters/skills-adapter.test.ts test/adapters/awesome-copilot-adapter.test.ts` | Passed: 4 files, 104 tests |
| `pnpm -C packages/infra exec vitest run test/resolvers/github-resolver.test.ts test/resolvers/skills-resolver.test.ts test/resolvers/awesome-copilot-resolver.test.ts` | Passed: 3 files, 37 tests |
| `pnpm -C packages/infra test` | Passed: 81 files, 878 tests |
| `pnpm -C packages/infra run build` | Passed: TypeScript compile and template copy |
| `pnpm -C packages/infra run lint:fix` | Passed: 0 errors, 97 warnings; warning count matches the prior Task 4 report baseline, with no warnings in changed files |
| `git diff --check` | Passed |

An initial build caught a TypeScript narrowing error in the exact-release lookup; the release-ID guard was made explicit and the build then passed. The full suite emitted its existing invalid-YAML fixture diagnostic on stderr while passing.

## Files changed in this fix

- `packages/infra/src/adapters/github-portable-resolution.ts`
- `packages/infra/src/adapters/github-adapter.ts`
- `packages/infra/src/adapters/skills-adapter.ts`
- `packages/infra/src/adapters/awesome-copilot-adapter.ts`
- `packages/infra/test/adapters/github-portable-resolution.test.ts`
- `.superpowers/sdd/2026-10-12-portable-source-identity/task-4-report.md`

## Remaining concern and commit

Portable GitHub release extraction remains ZIP-only because that is the injected/default extractor's supported format. This fix now picks a ZIP when one is available and rejects a recorded tarball explicitly; legacy catalog behavior is unchanged. No other known concerns remain.

Scoped conventional commit:

```text
fix(infra): enforce portable GitHub pins and selectors

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
