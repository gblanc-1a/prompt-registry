# Code Quality Assessment

## Strengths

- The shared installation pipeline has focused Vitest coverage for pipeline phases, typed failures, writer selection, governed archive filtering, legacy compatibility, and validation-before-write behavior.
- ZIP tests cover valid archives, invalid archives, directory filtering, and traversal rejection.
- XDG storage tests cover config/cache/data separation and durable state.
- CLI install tests cover local/remote installs, target and scope selection, allowlist rejection before writes/locks, lockfile replay, governed metadata exclusion, and repository routing.
- Extension tests cover storage placement, user/repository services, scope routing, manifest-path behavior, migration idempotence, and mocked VS Code dependencies.
- CI builds, lints, tests across operating systems, packages the VSIX, runs integration tests, and performs Trivy/CodeQL, SBOM, and license checks.

## Risks And Gaps

| Finding | Evidence | Recommended verification |
| --- | --- | --- |
| Caller parity gap | Governed manifests use canonical `items[]`; extension sync uses `manifest.prompts` | Add a fixture for valid `items[]`-only archive and assert identical target output through CLI and extension public entry points. |
| Manifest-less inconsistency | CLI rejects missing root manifest; extension synthesizes one | Select a single compatibility policy and write rejection/normalization tests before consolidation. |
| Migration state insufficient | Existing completed migration state lacks per-transfer progress and conflict outcomes | Add focused interruption, retry, duplicate, conflict, update, uninstall, and cleanup-eligibility tests. |
| Legacy cleanup unsafe | Cache and records both represent existing installations | Keep automatic cleanup disabled until recovery and ownership rules pass. |
| Weak extension assertions | Some focused installer tests assert object/interface existence rather than filesystem behavior | Prefer observable command/service outcomes and filesystem assertions. |
| Unsync legacy assumption | `unsyncBundle()` reconstructs a cache path instead of reading `installPath` | Cover post-migration uninstall and update against reconciled records. |

## Security And State-Recovery Assessment

The existing security posture is strong at the shared path: traversal rejection, governed full-inventory validation, hashes and sizes, binary-safe writes, read-back integrity verification, and secure CI controls are observed. The migration must preserve those controls while adding containment under both legacy and target roots, symlink-aware checks, non-destructive duplicate/conflict behavior, and durable recovery state.

A migration may not mark global completion merely because activation ran. It needs a state model that can distinguish completed transfer, duplicate equivalence, non-destructive conflict, retryable interruption, and unknown/error outcomes. Until that model and tests exist, deletion of extension-local content risks unrecoverable loss or broken update/uninstall behavior.

## Reviewable PR Staging

1. Add shared/extension contract fixtures, beginning with governed `items[]`-only parity, and establish the manifest-less policy.
2. Route extension installation composition through the shared app pipeline while preserving readable legacy state and focused parity tests.
3. Add resumable, non-destructive migration with durable outcome records, duplicate comparison, interruption/retry behavior, and update/uninstall reconciliation tests.
4. Only after evidence from the previous stages, separately review cleanup eligibility, cache removal, compatibility deletion, and documentation updates.

## Quality Conclusion

Existing tooling governs code-quality claims: ESLint/Prettier configuration, package-local test suites, c8/Vitest coverage, and secure CI remain the controlling standards. The migration is safe to plan, but not yet safe to implement as a cleanup or big-bang rewrite.