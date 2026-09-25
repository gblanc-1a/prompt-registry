# Technology Stack Decisions — Activation Migration Compatibility (U4)

## Technology position

**No new technology is introduced.** U4 is disposable compatibility code inside the existing VS Code extension and inherits the repository stack recorded in `codekb/prompt-registry/technology-stack.md` verbatim. Every selection below is an inheritance decision, justified against that scan rather than chosen fresh, because a unit tagged for wholesale removal must not leave a dependency behind it.

| Concern | Selection (inherited) | Observed version | Rationale |
| --- | --- | --- | --- |
| Language | TypeScript | `^5.9.3` | Shared packages and extension implementation already use it; U4 must type against U1's ports without a translation layer. |
| Runtime | Node.js | `>=24` | Workspace runtime requirement; U4 runs in the extension host. |
| Host API | VS Code Extension API | `^1.105.0` | Activation sequencing, the non-modal warning, and the Output channel are host APIs. Per the scan's platform implication, they stay at the delivery boundary and are not pulled into `core` or `app` contracts. |
| Filesystem access | Node `fs` through U1's ports | — (platform) | U4 reads only; every write, comparison, and deletion goes through U1 (NFR1.2), so U4 adds no filesystem library. |
| Archive handling | none in U1 (`adm-zip` stays in U1/legacy installer) | `^0.6.0` where used | U4 never unpacks an archive; the transfer is U1's. Naming this explicitly keeps the ZIP-traversal protections the scan calls out on one owner. |
| Unit and integration tests | Mocha with Sinon | Mocha `^11.7.6` | The extension's existing test cycle; U4's tests live with the extension, not in the Vitest-based shared packages. |
| Property/edge tests | fast-check | scan-reported | Available for path-containment and token-rejection cases (NFR1.1.1, NFR1.1.3) without adding a dependency. |
| Timing evidence | Mocha against a real filesystem | Mocha `^11.7.6` | ASM3.1's p95 must be measured with U1's real byte comparison; the existing runner is sufficient, so no benchmarking harness is added. |
| Bundling | webpack | `^5.108.4` | U4 ships inside the existing extension production bundle; removal is a code deletion, not a build change. |
| Lint and format | ESLint 9, Prettier | ESLint `9` | Type-aware extension linting already covers this code; the scan's baseline is the quality claim. |
| Persistence | none | — | U4 holds no durable outcome state (NFR4.2), so no storage technology is selected. |

## Behavioural decisions (consequences of the above)

| Decision | Selection | Rationale |
| --- | --- | --- |
| Execution | Inline during VS Code activation, before bundle handlers | Meets the migration ordering requirement (BR3.1). |
| Activation bound | 2 seconds p95 for non-interactive discovery and verification | Keeps activation responsive while still checking live migration state (ASM3.1). |
| Over-bound behaviour | Abandon at a non-destructive boundary; return `ready-with-preserved-outcomes` | Bounds the pass without a partial commit (NFR2.2). |
| Conflict interaction | No activation-time wait for overwrite input | U4 records manual guidance and lets activation complete (NFR4.3). |
| Notifications | Non-modal warning plus Output-channel detail | Visible without blocking activation; supports diagnostics. |
| Sensitive output | Full ordinary local paths/URLs; redact credentials, signed query values, and token-like data | Local troubleshooting without secret leakage. |
| Writes and cleanup | U1 lifecycle, registry claims, and `MigrationCleanupJournal` only | One safety and durability boundary (NFR1.2, NFR1.1.3, NFR1.1.4). |
| State | No U4 durable outcome store | Recovery derives from current disk and U1 journal state. |
| Removal | `@migration-cleanup(activation-migration)` compatibility unit | Allows wholesale removal once migration is complete. |

## Consequences

- A slow or conflicted candidate cannot delay extension activation indefinitely, and an exhausted bound never leaves a half-finished deletion.
- A user sees manual remediation guidance, including the overwrite decision that was not applied, rather than an activation-blocking prompt.
- U4 cannot diverge from U1's containment, verification, ownership, overwrite, or cleanup rules.
- Output remains useful for local diagnosis but omits credentials and tokens.
- Because nothing was added to the stack, removing U4 is a deletion with no dependency or build cleanup.

## Upstream references

- `aidlc/spaces/default/codekb/prompt-registry/technology-stack.md` (observed versions and platform implications)
- `construction/activation-migration-compatibility/functional-design/functional-spec.md`
- `construction/activation-migration-compatibility/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
