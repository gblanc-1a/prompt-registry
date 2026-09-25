# Security Requirements — Activation Migration Compatibility (U4)

## Scope

U4 is disposable compatibility code tagged `@migration-cleanup(activation-migration)`. It discovers only current-IDE, user-scope legacy candidates; delegates every target write, verification, and cleanup action to U1; holds no durable migration outcome state; and neither reads nor mutates repository-scope legacy content during the activation pass (BR2.2).

## Derived requirement ID convention

Derived requirements append one sub-number to the full ID of their inception parent. Because inception already defines `NFR1.1` as a requirement in its own right, rows derived from `NFR1` start at `.2` so they cannot collide with it, and rows derived from inception `NFR1.1` take the form `NFR1.1.x`. A requirement that confirms an inception *assumption* rather than deriving from an inception NFR carries that assumption's ID instead (`ASM3.1`); it is recorded under "Activation bound" below and is not claimed as NFR coverage.

## Requirements

| ID | Requirement | Evidence | Upstream |
| --- | --- | --- | --- |
| NFR1.2 | Discovery shall be read-only. Every transfer, materialisation, target write, verification, and legacy deletion shall use U1 lifecycle, registry, and cleanup-journal ports. | Fakes assert no U4 target-store write/delete call. | NFR1 |
| NFR1.1.1 | Every target and legacy path shall be contained in its resolved root; unsafe paths or symlink traversal return a safety disposition with no mutation. A symlink into the legacy cache is materialised through U1 before cleanup. | Path-escape and symlink-materialisation integration tests. | NFR1.1 |
| NFR1.1.2 | U4 shall request cleanup only after U1 verifies all expected target artifacts byte-identical; U1 shall verify legacy absence after each deletion. | Journal-driving tests cover verified duplicate, interrupted cleanup, and absence verification. | NFR1.1 |
| NFR1.1.3 | Each `prepared → target-verified` transition U4 requests shall carry a `VerificationResultToken` whose installation key, `journalEntryId`, `generation`, and complete fingerprint set match the live entry. An absent, stale, altered, wrong-entry, wrong-generation, subset, or already-consumed token shall produce no deletion and leave the entry unchanged. The token authorises one transition; it is never standing deletion authority, and U4 shall not cache or replay one across candidates or activations. | Token tests for each rejection case assert the entry state and legacy bytes are unchanged. | NFR1.1 |
| NFR1.1.4 | U4 shall never call the target artifact store directly to bypass a destination ownership claim, a conflict, or a `rollback-required` state. A destination owned by another installation without a valid `DestinationOwnershipHandoff` shall yield `preserved-conflict` with legacy content intact; a `rollback-required` or `pending-materialization` claim shall yield a preserved/safety disposition and be resolved by U1 recovery on a later activation, never by a U4 write. | Ownership-conflict, `rollback-required`, and `pending-materialization` tests assert no write and a preserved disposition. | NFR1.1 |
| NFR2.1 | Migration failure is non-fatal: legacy content remains intact, activation completes, and a later activation re-derives state from current disk and U1 journal evidence. | Restart tests for failed transfer and interrupted cleanup. | NFR2 |
| NFR2.2 | Exhausting the activation bound (ASM3.1) shall behave as an interruption, not a partial commit. The bound shall be evaluated only at candidate boundaries and before a destructive transition is authorised — never between `legacy-delete-pending` and `committed`. An abandoned candidate shall leave its journal entry in a non-destructive state (`prepared` or `target-verified`) with legacy content intact; candidates not yet started shall take the `skipped` disposition with reason `activation-budget-exhausted` and remain eligible next activation. `runActivationMigration` shall always return, and shall return `readiness: ready-with-preserved-outcomes` whenever any candidate was abandoned or skipped for the bound, so U3's command gating is never stalled. | Bound-exhaustion tests assert the returned `CommandReadiness`, each disposition, intact legacy bytes, and a journal entry in a non-destructive state. | NFR2 |
| NFR2.3 | An interrupted or abandoned cleanup shall re-verify current target and legacy bytes on the next activation before resuming any deletion; a prior run's verification claim shall never authorise a deletion. | Resume tests assert re-verification precedes deletion after an abandoned and after a crashed cleanup. | NFR2 |
| NFR3.1 | U4 shall have no direct target-write or cleanup path and shall remain isolated compatibility code removable as one unit. | Dependency checks and `@migration-cleanup` marker verification. | NFR3 |
| NFR4.1 | Results are current-run only. Preserved conflicts and retry-required outcomes show a non-modal warning plus Output-channel detail naming the bundle/artifact, ordinary local path/URL, and manual action; credentials, signed query values, and token-like values are redacted. | Presentation tests for each disposition and sensitive URL fields. | NFR4 |
| NFR4.2 | U4 shall not persist completion, failure, conflict, or report state. Eligibility for later migration derives only from live target links, legacy source presence, and U1 journal state. | Repeated-activation tests prove no U4 outcome store is read or written. | NFR4 |
| NFR4.3 | When target content would be replaced, the result shall present the overwrite decision as deferred guidance rather than an activation-time prompt: it shall state that no overwrite was applied, that existing target content remains authoritative, which bundle and artifact are affected, and the action available to resolve it. | Preserved-conflict presentation test asserts the decision is stated with its manual action and that activation is not blocked. | NFR4 |

## Activation bound

**ASM3.1** — Non-interactive discovery, target comparison, and verification for the whole activation pass shall complete within **2 seconds at p95**. U4 shall not wait for overwrite interaction during activation; it records a current-run manual-action disposition and lets activation continue (NFR4.3). Exhausting the bound is governed by NFR2.2.

This requirement confirms assumption **ASM3** ("Activation can inspect legacy data without blocking extension activation indefinitely", status *Confirm during NFR requirements*) and satisfies the constraint "The migration must execute at extension activation before bundle commands [Q1]". It also answers the Contract 3-to-4 open question "What activation-time latency budget **and cancellation behavior** keeps migration bounded before bundle commands become available?" — the budget here, the cancellation behaviour in NFR2.2. It is not derived from an inception NFR, so it is not claimed as NFR coverage in `traceability.json`; it is carried forward to NFR Design through NFR2.2, which references it.

**Measurement population and conditions** — the p95 is measured over activation passes on a reference developer machine (macOS or Linux, SSD, warm OS page cache), with a discovery population of up to 10 candidate bundles and up to 200 managed artifacts in total, against a **real filesystem** with U1 performing its actual byte-for-byte comparison and read-back verification. Mocked-U1 timing tests bound U4's own discovery and orchestration only and are not sufficient evidence for this bound, because U1's comparison is the dominant cost. A cold-cache first activation is reported separately and is not held to the 2 s p95.

## Overwrite decision at activation time

The activation pass never awaits user input. U4 still uses the single shared `OverwriteDecision` (`confirmed | declined | unavailable`, BR4.3) and Contract 4's required `ActivationMigrationContext.interaction: MigrationInteractionPort` is unchanged; U4 requests the decision without blocking, and a decision that cannot be produced without waiting resolves as **`unavailable`**. Consequently `preserved-conflict` is the only conflict disposition reachable in an activation pass: existing target content stays authoritative (BR4.2), both locations are preserved, and NFR4.3 presents the deferred decision with its manual action.

## Requirement deviations (raise at the stage gate)

- **The `confirmed` overwrite branch is unreachable from `runActivationMigration`.** `functional-spec.md` § Activation migration pass step 3.1 specifies "On `confirmed`, transfer with the decision", and Contract 4 lists `interaction` as a *required* field of `ActivationMigrationContext`. Because the answered activation bound forbids waiting for the decision, no activation pass can produce `confirmed`. The port and the shared decision type are retained as contracted, and the `confirmed` transfer path remains specified for any future non-activation, user-initiated migration entry point; U4's current scope defines no such entry point. This narrows the approved behaviour and is recorded here for the gate.

## Acceptance checks

- Current-IDE/user-scope boundary prevents migration of another target or repository scope; repository-scope legacy content is neither read nor mutated during the activation pass.
- No target or legacy mutation bypasses U1, and no deletion proceeds without a live, matching verification token.
- Activation remains responsive at the 2-second p95 non-interactive bound, measured against a real filesystem.
- Exhausting the bound returns a result, leaves legacy content intact, and leaves no journal entry past `target-verified`.
- Conflicts never block activation, state the overwrite decision, and retain manual guidance.
- Interrupted or abandoned cleanup re-verifies before any later deletion.

## Upstream references

- `construction/activation-migration-compatibility/functional-design/functional-spec.md`
- `construction/activation-migration-compatibility/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md` (NFR1, NFR1.1, NFR2, NFR3, NFR4; ASM3; activation constraint [Q1])
- `inception/contract-design/contract-summary.md` (Contract 3 and its safety amendment, Contract 4, open questions)
