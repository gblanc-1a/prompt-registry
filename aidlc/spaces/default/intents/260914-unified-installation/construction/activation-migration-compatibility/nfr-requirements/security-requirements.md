# Security Requirements — Activation Migration Compatibility (U4)

## Scope

U4 is disposable compatibility code tagged `@migration-cleanup(activation-migration)`. It discovers only current-IDE, user-scope legacy candidates; delegates every target write, verification, and cleanup action to U1; holds no durable migration outcome state; and never migrates repository scope.

## Requirements

| ID | Requirement | Evidence | Upstream |
| --- | --- | --- | --- |
| NFR1.2 | Discovery shall be read-only. Every transfer, materialisation, target write, verification, and legacy deletion shall use U1 lifecycle and cleanup-journal ports. | Fakes assert no U4 target-store write/delete call. | NFR1 |
| NFR1.1.1 | Every target and legacy path shall be contained in its resolved root; unsafe paths or symlink traversal return a safety disposition with no mutation. A symlink into the legacy cache is materialised through U1 before cleanup. | Path-escape and symlink-materialisation integration tests. | NFR1.1 |
| NFR1.1.2 | U4 shall request cleanup only after U1 verifies all expected target artifacts byte-identical; U1 shall verify legacy absence after each deletion. | Journal-driving tests cover verified duplicate, interrupted cleanup, and absence verification. | NFR1.1 |
| NFR2.1 | Non-interactive discovery and verification shall complete within 2 seconds at p95. U4 shall not wait for overwrite interaction during activation; it records a current-run manual-action disposition and lets activation continue. | Timed activation tests with mock U1 responses; interactive-conflict test asserts no activation block. | NFR2 |
| NFR2.2 | Migration failure is non-fatal: legacy content remains intact, activation completes, and a later activation re-derives state from current disk and U1 journal evidence. | Restart tests for failed transfer and interrupted cleanup. | NFR2 |
| NFR3.1 | U4 shall have no direct target-write or cleanup path and shall remain isolated compatibility code removable as one unit. | Dependency checks and `@migration-cleanup` marker verification. | NFR3 |
| NFR4.1 | Results are current-run only. Preserved conflicts and retry-required outcomes show a non-modal warning plus Output-channel detail naming the bundle/artifact, ordinary local path/URL, and manual action; credentials and token-like values are redacted. | Presentation tests for each disposition and sensitive URL fields. | NFR4 |
| NFR4.2 | U4 shall not persist completion, failure, conflict, or report state. Eligibility for later migration derives only from live target links, legacy source presence, and U1 journal state. | Repeated-activation tests prove no U4 outcome store is read or written. | NFR4 |

## Acceptance checks

- Current-IDE/user-scope boundary prevents migration of another target or repository scope.
- No target or legacy mutation bypasses U1.
- Activation remains responsive at the 2-second p95 non-interactive budget.
- Conflicts never block activation and retain manual guidance.
- Interrupted cleanup re-verifies before any later deletion.

## Upstream references

- `construction/activation-migration-compatibility/functional-design/functional-spec.md`
- `construction/activation-migration-compatibility/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
