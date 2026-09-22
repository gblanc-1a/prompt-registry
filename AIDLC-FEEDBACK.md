# AIDLC Feedback

This log records reproducible friction in the AI-DLC workflow, hooks, and related tooling. Entries are append-only.

## Friction entries

### 2026-09-22 — Functional Design review recovery deadlock on resume

- **Status:** open
- **Workflow:** `260914-unified-installation`
- **Affected stage / unit:** `functional-design` / `shared-installation-foundation`
- **Observed state:** The workflow is in revision 9. `aidlc-state.md` reports `functional-design` as `[R]`, with `functional-design` still active and `nfr-requirements` next.

#### What happened

The Functional Design unit was revised to address the twelve findings from the prior review. The revised artifacts are present, but the required adversarial review never produced a substantive review result:

1. Review iteration 1 was requested for artifact fingerprint `sha256:c2764e2f88db5825b7ce21055a641414666529eb67f1d92c0b8197e66cbef292` with request ID `review:1bf1cad49223a9dfe368dfa731db4f6d`.
2. Its sole `--retry-pending` retry was spent. A later retry correctly refused with:
   ```text
   Refusing review retry for "functional-design": REVIEW_REQUESTED iteration 1 already used its one pending-request retry. Do not dispatch it again; record the bounded incomplete-review NOT-READY fallback or start the next permitted review iteration.
   ```
3. The fallback created `.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/3c0fc53f9e11caf4/1.json`, whose `body` is empty and whose `findings` array is empty, but whose verdict is `NOT-READY`.
4. The same sequence repeated for review iteration 2, request ID `review:aa00be2a414ade0c41be11174b126e19`. Its fallback record is also an empty `NOT-READY` result.
5. With the two-pass adversarial budget exhausted, the engine re-emitted a wave directive with `build_required: false`, `completion_required: true`, and `review_state: "NOT-READY"`. Attempting the required completion command then refused:
   ```text
   aidlc engine state unit complete --wave --stage "functional-design" --unit "shared-installation-foundation"

   Refusing wave completion for unit "shared-installation-foundation" of "functional-design": the engine does not currently expose that entry as build-complete, review-settled, and awaiting its completion receipt.
   ```

The result is a circular state: the unit cannot be completed because it is not exposed as review-settled, yet no review retry is permitted and the directive does not provide a recovery or repair action. Each resume replays expensive framework setup and reaches the same state.

#### Evidence

- Audit: `aidlc/spaces/default/intents/260914-unified-installation/audit/ncelrnd1524-8b5d79f53367.md`
  - iteration 1 request and retry: lines 11528–11559
  - iteration 1 retry refusal and fallback completion: lines 11688–11706
  - iteration 2 request and retry: lines 11716–11762
  - iteration 2 retry refusal and fallback completion: lines 12011–12029
  - wave completion refusal: lines 12058–12060
- Fallback review records:
  - `aidlc/spaces/default/intents/260914-unified-installation/.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/3c0fc53f9e11caf4/1.json`
  - `aidlc/spaces/default/intents/260914-unified-installation/.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/3c0fc53f9e11caf4/2.json`
- Both records have an empty `body` and no findings, so they are evidence of an incomplete review attempt rather than a completed design assessment.

#### Root cause

This is not a design-artifact failure. It is an unreconciled workflow-state failure caused by three defects interacting:

1. **Reviewer execution failure is treated as a review outcome.** A review worker that cannot produce the mandated review file consumes the one retry and later becomes an empty `NOT-READY` fallback. The system loses the distinction between “the artifact failed review” and “the review infrastructure did not run.”
2. **Wave settlement does not handle terminal incomplete-review fallbacks.** The engine exposes `review_state: "NOT-READY"` but does not expose the matching lead-repair, human-decision, or fresh-review route. It then refuses the only completion command the directive implies.
3. **Resume repeatedly performs heavyweight setup before revealing the same dead-end.** The orchestrator reloads the full two-part active rule bundle and large inline context set before it can determine that no legal state transition exists. Continuation tokens also become stale whenever incidental state changes occur, requiring another full `next`/rule-delivery pass.

#### Cost

- **User impact:** the construction workflow does not advance past Functional Design despite revised artifacts being available.
- **Interaction cost:** more than a dozen framework-only tool turns were spent attempting review retries, reading state, reconstructing directives, handling stale continuation tokens, and attempting wave completion.
- **Context cost:** each retry/resume reloaded roughly 25 KB of rules plus 23 inline context files; this consumed a substantial amount of context without improving the unit state.

#### Safe immediate recovery

Do not force the unit complete, edit workflow state files directly, or fabricate a review record. The clean escape must create a fresh, reviewable attempt.

1. Preserve the revised Functional Design artifacts; do not change them merely to force a fingerprint mismatch.
2. Request a human-approved redo of `functional-design` through the public route (`/aidlc --stage functional-design`) and execute only the exact jump command returned by the orchestrator. This should establish a new stage attempt and fresh review budget while retaining/reusing the already revised artifacts through the engine’s artifact-reuse path.
3. Before any new review request, verify that the architecture reviewer can read the supplied paths and write the provided review-file path. If tool access is unavailable, stop immediately with a typed recovery choice; do not spend the review request or its retry.
4. If the redo route does not return an executable recovery action, stop automated retries. The framework needs state-tool repair support; editing `aidlc-state.md`, audit rows, or review receipts manually would weaken the audit trail and may create a more difficult inconsistency.

**Workaround safety:** The redo path is safe only when the engine itself prints and validates the jump. It is not safe to call state lifecycle commands directly or to hand-edit state/audit files.

#### Proposed framework improvements

1. **Classify review failures separately from review verdicts.** Add a terminal `review-unavailable` / `review-incomplete` status that cannot masquerade as an empty `NOT-READY` review. The status should preserve the cause (no reviewer tool access, timeout, malformed file, write failure).
2. **Return a typed recovery directive after exhausted incomplete reviews.** When no substantive review exists, emit one of: `retry with repaired reviewer environment`, `redo stage with artifact reuse`, or `present human risk decision`. Never emit a wave entry that completion will reject.
3. **Make wave state internally consistent.** If a wave directive exposes `completion_required: true`, its completion command must be executable. Otherwise expose `build_required: true` with a repair brief, or a typed `ask`/guard-recovery action. Include the precise missing condition in the directive rather than requiring a failed completion command to discover it.
4. **Preflight reviewer capabilities before `REVIEW_REQUESTED`.** Validate that the selected Kiro reviewer has read access to required artifacts and write access to the generated review file. A platform-level capability failure must not spend an iteration or pending-request retry.
5. **Support resumable review dispatch.** Persist a compact request snapshot and worker health outcome. On session resume, reattach/retry a review that never started without creating a new request or exhausting the one retry; only an actual reviewer run should consume the retry.
6. **Provide a compact resume snapshot.** Add an `aidlc engine resume --json` response containing current stage, unit/wave entry, blocker classification, legal next commands, previous failed command, and a bounded evidence summary. This lets a new session decide in one call instead of replaying all rules and reading audit history.
7. **Use rule-bundle caching/delta delivery.** Bind the bundle hash to the session and return only changed rule fragments after the first successful load. Do not make opaque continuation tokens the only way to retain the loaded bundle; token invalidation should return a compact restart directive, not force the entire bundle to be transferred again.
8. **Expose a single “why blocked” surface.** `aidlc engine orchestrate next` should report a machine-readable blocker such as `review_incomplete_budget_exhausted` and the engine-approved recovery command. This avoids protocol archaeology across audit, review JSON, state, and directive payloads.
9. **Make launcher fallbacks first-class.** The managed route for `aidlc engine review-brief ...` previously failed with `aidlc-review-brief.ts does not export main(argv)` while `bun .kiro/tools/aidlc.ts engine review-brief ...` worked. The launcher should use the registered tool implementation directly, or print the supported fallback as structured recovery metadata rather than requiring a user/project-specific learned workaround.

#### Acceptance criteria for the fix

- A reviewer that cannot access its inputs or output path consumes **zero** review iterations and **zero** pending-request retries.
- An empty fallback review cannot block a wave without the engine exposing an executable recovery action.
- A resumed deadlocked unit reaches a typed recovery directive in one `next` call, without full rule/context redelivery.
- The repair path establishes a fresh attempt and review budget without hand-editing state or audit evidence.
- The unit either completes successfully or produces a clear, human-owned decision point; it never repeats the same directive plus a command that deterministically refuses.
