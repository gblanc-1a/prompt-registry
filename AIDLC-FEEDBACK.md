# AI-DLC Framework Feedback — Issue Drafts

Draft issues for [`awslabs/aidlc-workflows`](https://github.com/awslabs/aidlc-workflows). They are **not submitted**. Evidence remains in this workspace; these drafts state the reproducible problem and proposed fix concisely.

## Issue drafts

### AIDLC-ISSUE-001 — Incomplete reviews consume the review budget and can deadlock a wave

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** review orchestration / wave execution
- **Observed:** A reviewer that produces no review body or findings consumes its sole retry and becomes an empty `NOT-READY` receipt. After two such receipts, the wave returns `review_state: "NOT-READY"` and `completion_required: true`, but `unit complete --wave` refuses.
- **Expected:** Infrastructure failure must remain distinct from an artifact verdict; the next directive must expose an executable recovery.
- **Impact:** Functional Design became non-progressing despite revised artifacts; repeated resumes consumed more than a dozen framework calls.
- **Evidence:** Audit `ncelrnd1524-8b5d79f53367.md` lines 11528–12060; empty review records under `.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/3c0fc53f9e11caf4/`.

#### Proposed fixes

- **AIDLC-P-001:** Add `review-incomplete` / `review-unavailable` states; never encode an unavailable review as `NOT-READY`.
- **AIDLC-P-002:** Do not consume an iteration or retry when reviewer capability, dispatch, or review-file creation fails before substantive execution.
- **AIDLC-P-003:** Require a review record to be durably readable at the returned `reviewFile` path before emitting `REVIEW_REQUESTED` completion.
- **AIDLC-P-004:** Emit a typed recovery action (`retry after environment repair`, `redo with artifact reuse`, or `human risk decision`) when incomplete-review recovery is exhausted.

### AIDLC-ISSUE-002 — Redo recovery reveals required checkpoints only after the jump

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** recovery routing
- **Observed:** An engine-approved redo of `functional-design` succeeded, but the next call failed with `SUMMARY_RECEIPT_MISSING`; the required summary confirmation was not disclosed before the jump.
- **Expected:** A recovery route should disclose every mandatory post-jump checkpoint before the user commits.
- **Impact:** One unnecessary state transition and human turn before a fresh review could start.
- **Evidence:** `aidlc engine orchestrate next --stage functional-design` issued the redo command; the following `next` emitted `SUMMARY_RECEIPT_MISSING`.

#### Proposed fixes

- **AIDLC-P-005:** Preflight summary authorization and other checkpoint prerequisites when constructing a redo route.
- **AIDLC-P-006:** Offer a combined redo-and-reconfirm flow that preserves the mandatory human confirmation boundary but avoids a discovery round trip.

### AIDLC-ISSUE-003 — Exhausted substantive review with an upstream dependency loops instead of escalating

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** wave execution / stage escalation
- **Observed:** A fresh attempt completed two substantive reviews. The final review retained critical findings requiring a Contract Design change, but the engine re-emitted `build_required: false`, `completion_required: true`, and `review_state: "NOT-READY"`. Completion is known to refuse and a third review is disallowed.
- **Expected:** A terminal capped review whose findings require an upstream artifact should stop unit execution and name the engine-approved upstream revision route.
- **Impact:** Full rule/context delivery is repeated without a legal transition.
- **Evidence:** Review `c4e8430ed1f89649/2.review.md`; post-review Functional Design directive; `AIDLC-FEEDBACK.md` prior recurrence evidence.

#### Proposed fixes

- **AIDLC-P-007:** Emit `review_state: "escalation-required"` instead of `completion_required: true` for a capped unresolved review.
- **AIDLC-P-008:** Include the owning upstream stage and an engine-issued backward-jump command in that escalation directive.
- **AIDLC-P-009:** Make wave completion refuse at directive generation time, not after the client executes an implied-but-invalid command.

### AIDLC-ISSUE-004 — Review validation surfaces are not reliably executable or diagnosable

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** sensors / reviewer UX
- **Observed:** Stage declarations name validation surfaces but do not provide invocations. Sensor discovery required trial-and-error; later read-only validation calls returned exit `130` with no JSON or diagnostic.
- **Expected:** Reviewers can run each declared validation through a documented command with structured pass, fail, or unavailable output.
- **Impact:** Review results could not include authoritative sensor evidence and required unnecessary framework exploration.
- **Evidence:** Functional Design review `c4e8430ed1f89649/2.review.md`; audit evidence for sensor-command discovery in this session.

#### Proposed fixes

- **AIDLC-P-010:** Include exact read-only validation commands in each review dispatch brief.
- **AIDLC-P-011:** Make every sensor command support `--help` and print a complete usage line when arguments are missing.
- **AIDLC-P-012:** Reserve exit `130` for interruption; return JSON such as `{ "status": "unavailable", "reason": "…" }` for unsupported or unconfigured validation.

### AIDLC-ISSUE-005 — Resume redelivers unchanged rule bundles before reporting a known blocker

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** session resume / context efficiency
- **Observed:** Resuming the blocked unit repeatedly transfers the same two-part rule bundle (~25 KB) and 23 inline context paths before returning the same non-actionable wave state. Continuation tokens become stale after incidental state changes.
- **Expected:** Resume should identify a known blocker before heavyweight context delivery and reuse unchanged bundle state.
- **Impact:** Excess token use and tool turns without project progress.
- **Evidence:** Repeated `load-steering` directives for Functional Design in the active audit/session sequence.

#### Proposed fixes

- **AIDLC-P-013:** Add a compact `aidlc engine resume --json` response with blocker code, current unit, legal actions, and failed command summary.
- **AIDLC-P-014:** Cache rule bundles by hash for a session and deliver only deltas after the first successful load.
- **AIDLC-P-015:** On invalidated continuation, return a compact restart directive rather than forcing full rule delivery.

### AIDLC-ISSUE-006 — Resume is a hand-driven multi-call loop with two silent traps that burn context

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** session resume / CLI ergonomics · **Related:** AIDLC-ISSUE-004, AIDLC-ISSUE-005
- **Date:** 2026-09-22
- **Observed:** `/aidlc --resume` forces the conductor to hand-drive the steering-delivery loop (`orchestrate next --resume` → read `continue_token` → `orchestrate continue <token>` → repeat until `run-stage`). Two traps make each resume cost many tool calls and a lot of context:
  1. **Launcher raises SIGINT (exit `130`) intermittently.** The managed `aidlc` launcher frequently exits `130` even for `aidlc --version`, and when it is driven inside a shell loop the SIGINT tears the loop down mid-chain, so a scripted `next`→`continue`→`continue` resume cannot complete through the launcher. Output is often produced before the signal, but the non-zero exit and loop teardown make the flow look broken. Running the tool directly — `bun .kiro/tools/aidlc.ts engine orchestrate …` — is consistently clean (exit `0`) and completes the chain. (This is the same launcher-layer defect already recorded for `review-brief` in `memory/project.md`.)
  2. **`continue` takes a POSITIONAL token; `--token` is silently rejected with a misleading error.** `handleContinue` reads `args[0]` and guards on `args.length !== 1`. Invoking `orchestrate continue --token "<t>"` yields `args = ["--token", "<t>"]` (length 2), so the guard fires and returns `"Invalid steering continuation token: this stage's rules cannot be loaded from where they left off. Run a fresh next to restart delivery from part 1."` The message points at token staleness / state drift, so the natural (wrong) reaction is to re-run `next` — which redelivers the full multi-part rule bundle again (see ISSUE-005) and burns more context. The correct call is positional: `orchestrate continue "<t>"`.
- **Expected:** Resuming a workflow should take one command and return the terminal directive without the client re-implementing the steering loop, and an invalid-token error should distinguish "wrong argument shape" from "stale token" so it does not induce a needless full `next` restart.
- **Impact:** Every resume in this project has cost many framework round trips and a large fraction of the context window before any project work resumed; the misleading error repeatedly triggered a full-bundle `next` restart.
- **Evidence:** `.kiro/tools/aidlc-orchestrate.ts` `handleContinue` (positional `args[0]`, `args.length !== 1` guard, error string near the "cannot be loaded from where they left off" literal); this session reproduced the `--token` rejection and the `bun` vs launcher exit-code difference; `scripts/aidlc-resume.sh` (added this session) completes the full chain to `run-stage` in one invocation via bun + positional tokens.

#### Design rationale (added 2026-09-22)

The multistep steering loop with per-part tokens is not accidental output fragmentation — it is deliberate state-validation defense. Each `continue` token encodes `(stage, workflow_state_hash, bundle_hash, route, part_N)` and validates on every call. Between parts 1→2→3, the engine detects if state/rules changed (user edited state file, external mutation, etc.) and rejects the token. This catches state drift between parts.

However, this defensive design assumes a human conductor might hand-edit state files between parts. AI workflows will not. For AI resumption, this validation is unnecessary overhead: the agent is deterministic, won't mutate state mid-loop, and the framework could validate state once at loop start, batch parts server-side, and return only the terminal directive + bundle reference (see AIDLC-P-016).

#### Proposed fixes

- **AIDLC-P-016:** Ship an `aidlc engine orchestrate resume` (or `next --resume --drain`) that runs the whole steering-delivery loop server-side and returns the single terminal directive (`run-stage`/`ask`/`done`/`parked`/`error`) plus the already-delivered rule bundle, so the client never hand-drives `continue`. This trades the per-part state-validation surface (appropriate for humans) for AI-optimized single-call resumption (validate state once at loop entry, batch parts server-side).
- **AIDLC-P-017:** Accept `--token <t>` as an alias for the positional token in `orchestrate continue`, or reject unknown flags explicitly instead of folding them into the "stale token" path.
- **AIDLC-P-018:** Make the invalid-token error distinguish causes — wrong argument shape vs. failed MAC vs. state-hash drift vs. route-hash drift — and only the genuine-staleness cases should advise a fresh `next`.
- **AIDLC-P-019:** Fix the launcher so it never exits `130` on success (reserve `130` for real interruption), and ensure it does not deliver SIGINT to its process group at teardown, so scripted multi-call loops survive.

### AIDLC-ISSUE-007 — Approval-gate hook instructs the agent to acknowledge the gate "as a human"

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** approval gates / hooks · **Date:** 2026-09-22
- **Observed:** After `orchestrate report --stage contract-design --result awaiting-approval` opened the gate, a `PreToolUse` hook blocked **every** subsequent tool call (including a read of the report's own output file) with: "An approval gate is open and no human has acted since it opened. The gate requires a typed human turn before any tool call proceeds. Acknowledge the gate as a human, then continue." The human had already typed their approval, but *before* the gate opened, so the hook's "since it opened" window was empty. Taken literally, the remedy it names — the agent acknowledging the gate *as a human* — is the impersonation the gate exists to prevent, and it directly contradicts the framework's own rule that an approval is never recorded on the human's behalf.
- **Expected:** A gate hook should never instruct the agent to supply the human turn. It should say what is blocked and stop, leaving the agent to end its turn and re-present the gate. The wording should also distinguish "no human turn recorded yet" from "the human answered before the gate was mechanically opened".
- **Impact:** The only compliant path is to discard the user's already-given approval, re-present the gate, and ask them to retype the same answer — one wasted human round trip per gate whenever the approval arrives in the same turn that opens the gate. An agent that follows the hook's wording literally would silently self-approve.
- **Evidence:** `report --result awaiting-approval` for `contract-design` in this session, then two consecutive intercepted calls (`read_file /tmp/rep1.txt`, then the `report --result approved` shell call), both returning the quoted `HOOK_INSTRUCTION`; the approval only committed after the user retyped `1`.

#### Proposed fixes

- **AIDLC-P-020:** Reword the hook so it never asks the agent to act as the human: state that the gate is open and awaiting a human decision, and instruct the agent to end its turn and re-present the choices.
- **AIDLC-P-021:** Accept a human gate answer recorded in the same turn that opens the gate (compare against the last human message rather than only events strictly after the gate timestamp), so a decision given up front is not discarded.
- **AIDLC-P-022:** Narrow the block to gate-resolving actions (`report --result approved|rejected`) instead of all tool calls; reading a file or inspecting state cannot resolve a gate and should not be blocked.
- **AIDLC-P-023:** Have the hook name the exact compliant next step (re-present the gate and stop) so the remedy is unambiguous.

## Acceptance criteria

- A reviewer infrastructure failure consumes zero review budget and returns a typed recovery action.
- A wave directive never advertises completion when its completion command will refuse.
- A terminal review requiring an upstream change exposes the approved escalation route in one response.
- Every declared validation surface has a documented, read-only command and structured outcome.
- Resume identifies a known blocker without redelivering unchanged context.
- Resume completes in one command and returns the terminal directive; an invalid-token error names its cause and never falsely advises a full `next` restart; the CLI never exits `130` on success.
- No hook ever instructs the agent to supply, acknowledge, or stand in for a human turn; gate blocks apply only to gate-resolving actions.
