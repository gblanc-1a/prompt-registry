# AI-DLC Framework Feedback — Issue Drafts

Draft issues for [`awslabs/aidlc-workflows`](https://github.com/awslabs/aidlc-workflows). They are **not submitted**. Evidence remains in this workspace; these drafts state the reproducible problem and proposed fix concisely.

**Verification pass (2026-09-23).** Every claim below was re-checked against the `awslabs/aidlc-workflows` source *and* against this project's own audit trail. Source anchors are `core/…` / `harness/…` paths on `main`, which is ahead of the released `2.9.0` these issues were observed on — where `main` already fixes or already contains something a draft asks for, the draft says so and the proposed fix is narrowed to the remaining gap. Claims that could not be reproduced outside the Kiro IDE terminal, or that the source contradicts, are marked in each issue's **Verified** line.

**Shared evidence base.** All audit citations below are from one intent record: `aidlc/spaces/default/intents/260914-unified-installation/`, covering 2026-09-14 → 2026-09-23 (14,239 audit lines; 300 `HUMAN_TURN`, 60 `ERROR_LOGGED`, 36 `REVIEW_REQUESTED` vs 29 `REVIEW_COMPLETED`, 28 `SESSION_STARTED`, 23 `STAGE_AWAITING_APPROVAL`, 15 `GATE_APPROVED`, 9 `GATE_REJECTED`, 8 `STAGE_JUMPED`). Structured refusal records are under `.aidlc-engine/guard-refusals/`, review receipts under `.aidlc-engine/reviews/`.

## Issue drafts

### AIDLC-ISSUE-001 — An unavailable review is recorded as a NOT-READY artifact verdict

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** review orchestration / wave execution
- **Observed:** A reviewer that produces no review body consumes its one `--retry-pending` retry, and the engine then *instructs* the conductor to record the empty attempt as a verdict. The retry refusal is explicit: `Refusing review retry for "functional-design": REVIEW_REQUESTED iteration 1 already used its one pending-request retry. Do not dispatch it again; record the bounded incomplete-review NOT-READY…`. The receipt that follows is a verdict with nothing in it:

  ```json
  { "stage": "functional-design", "unit": "shared-installation-foundation", "iteration": 1,
    "verdict": "NOT-READY", "findings": [], "body": "", "recorded_at": "2026-09-22T08:53:13Z" }
  ```

  So "the reviewer never ran" and "the reviewer read the artifact and rejected it" become the same receipt, with the same budget consumption and the same downstream meaning. This is by design: `core/tools/aidlc-log.ts:2625` has an `incompleteFallback` path that accepts `--verdict NOT-READY` with `body === null` once the request has been retried.
- **Expected:** Infrastructure failure must remain distinct from an artifact verdict; the next directive must expose an executable recovery.
- **Impact:** **The Unit completed on two empty verdicts.** Iteration 1 (08:53:13Z) and iteration 2 (14:06:54Z) were both no-body `NOT-READY`, and `UNIT_COMPLETED` for `shared-installation-foundation` was emitted at 2026-09-22T14:11:41Z — no reviewer ever produced a word about that Unit's artifacts in that attempt. Four such empty receipts exist in this record (two attempts × two iterations; 570 bytes each, no `*.review.md` file alongside any of them).
- **Evidence:** Retry refusals at 2026-09-22T08:52:57Z and 2026-09-22T14:06:28Z; empty receipts `1.json` / `2.json` (570 bytes, `findings: []`, `body: ""`) under `.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/3c0fc53f9e11caf4/`, plus `…/72954e2bca2b9796/1.json` (2026-09-21T13:35:30Z).
- **Verified:** `core/tools/aidlc-log.ts:2625` confirms the no-body `NOT-READY` path. **Two claims in the original draft were wrong, and the audit shows what really happened.** (1) `unit complete --wave` does not refuse on a terminal `NOT-READY` — `core/tools/aidlc-state.ts:2469` treats `READY`, `NOT-READY` and `not-required` alike as review-settled, and has since 2.5.67. (2) The refusal that looked like a deadlock was an **idempotency refusal on an already-completed Unit**: `UNIT_COMPLETED` landed at 14:11:41Z, and the refusal — `Refusing wave completion for unit "shared-installation-foundation" of "functional-design": the engine does not currently expose that entry as build-complete, review-settled, and awaiting its completion receipt.` — was logged 16 seconds later at 14:11:57Z on a second `unit complete --wave` call. The wording is a three-way conjunction, so "you already did this" is indistinguishable from "this is not ready", which is why it read as non-progressing. The wave therefore never deadlocked; it silently advanced on empty reviews.

#### Proposed fixes

- **AIDLC-P-001:** Add a distinct `review-incomplete` / `review-unavailable` review state and stop minting a verdict for a review that was never written — remove or gate the `incompleteFallback` path so an unavailable review is never encoded as `NOT-READY`. (The review-state vocabulary already carries `retry-required`, `repair-required`, `recovery-required` and `escalation-required` at `core/tools/aidlc-directive.ts:119`; this adds one more member rather than a new mechanism.)
- **AIDLC-P-002:** Do not consume an iteration or retry when reviewer capability, dispatch, or review-file creation fails before substantive execution.
- **AIDLC-P-003:** Require the reviewer's review record to be durably readable at the dispatched `reviewFile` path before the dispatch is treated as executed, so the retry that follows an empty dispatch is charged to the framework and not to the review budget.
- **AIDLC-P-004:** Emit a typed recovery action (`retry after environment repair`, `redo with artifact reuse`, or `human risk decision`) when incomplete-review recovery is exhausted.
- **AIDLC-P-024:** Split the `unit complete --wave` refusal so an already-completed unit says so ("this unit was already completed at `<timestamp>`; nothing to record") instead of reusing the readiness sentence. A conjunctive refusal that covers idempotency, build state and review state makes a successful repeat look like a blocked wave, which is what turned a completed unit into ten minutes of re-diagnosis here.

### AIDLC-ISSUE-002 — Redo recovery reveals required checkpoints only after the jump

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** recovery routing
- **Observed:** An engine-approved redo of `functional-design` succeeded, but the next call failed with `SUMMARY_RECEIPT_MISSING`; the required summary confirmation was not disclosed before the jump.
- **Expected:** A recovery route should disclose every mandatory post-jump checkpoint before the user commits. The information is static: the stage declares `summary_confirmation: required` in its own frontmatter, so the engine can name the checkpoint at route-construction time.
- **Impact:** One unnecessary state transition and human turn before a fresh review could start — and then nine more refusals. The write side stayed frozen across the whole redo: the audit records the message `Refusing to write "…/functional-design/…": the artifact was last saved under a different summary confirmation than the one in force.` nine times between 2026-09-19 and 2026-09-22, each one a separate discovery of the same undisclosed prerequisite.
- **Evidence:** `aidlc engine orchestrate next --stage functional-design` issued the redo command; the following `next` emitted `SUMMARY_RECEIPT_MISSING`. Three structured refusal records survive under `.aidlc-engine/guard-refusals/`, and they confirm the ordering: the record whose `resetToken` is the `STAGE_JUMPED` event of 2026-09-22T16:02:04Z is a *post-jump* refusal, i.e. the jump completed and only then did the checkpoint surface. Those records already carry `remedies[].executableNow` with a `reconfirm-summary` action — so the engine can name the prerequisite; it just names it after the jump instead of before.
- **Secondary finding (wording):** the same records set `blockedAction: "review-request"` while the human-visible sentence says `Refusing to write …`. Two different nouns for one event make the audit and the terminal disagree about what was blocked.
- **Verified:** Holds. `core/aidlc-common/stages/construction/functional-design.md:10` declares `summary_confirmation: required`, and the refusal is raised at `core/tools/aidlc-lib.ts:10196`/`10363`; `core/tools/aidlc-jump.ts` contains no summary preflight (no occurrence of "summary" in the file). Partially addressed on `main` after 2.9.0: commit `52ac7ed` ("name a working next step in the refusals operators actually hit", #1322) makes the *write-freeze remedy* lead with finishing the revision and prices the jump's summary re-confirmation plus the re-save it forces. That covers the write-freeze entry point only — the redo route issued by `orchestrate next` still discloses nothing.

#### Proposed fixes

- **AIDLC-P-005:** Preflight summary authorization and other checkpoint prerequisites when constructing a redo route, the way the write-freeze remedy now prices its jump.
- **AIDLC-P-006:** Offer a combined redo-and-reconfirm flow that preserves the mandatory human confirmation boundary but avoids a discovery round trip.
- **AIDLC-P-025:** Align `blockedAction` in the guard-refusal record with the action named in the operator-facing sentence, so `review-request` and `Refusing to write` cannot describe the same refusal.

### AIDLC-ISSUE-003 — A capped review whose findings require an upstream change neither escalates nor blocks

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** wave execution / stage escalation
- **Observed:** A fresh attempt completed two substantive reviews — the configured maximum (`reviewer_max_iterations: 2`), so a third review is refused by the budget guard. The final review retained critical findings requiring a Contract Design change, yet the engine re-emitted `build_required: false`, `completion_required: true`, `review_state: "NOT-READY"` — a wave entry whose only legal move is to complete the Unit on an unresolved-critical verdict, with no route to the upstream stage that owns the fix.
- **Expected:** A terminal capped review whose findings require an upstream artifact should stop unit execution and name the engine-approved upstream revision route.
- **Impact:** The Unit completed while carrying known critical findings whose fix lives in another stage. The audit shows it: receipt `c4e8430ed1f89649/2.json` records `verdict: "NOT-READY"` with two open Critical findings (`R-01`, status `Unresolved`, whose `required_action` names a Contract 3 / Contract Design change and assigns it to that stage's owner; `R-06`, status `New`), and `UNIT_COMPLETED` for the same unit is emitted at 2026-09-22T15:53:32Z. The only thing that moved the work upstream afterwards was a human: `STAGE_JUMPED` at 2026-09-22T16:02:04Z, nine minutes later and outside any engine route.
- **Evidence:** Receipt `c4e8430ed1f89649/2.json` (verdict `NOT-READY`, 2 Critical open); `UNIT_COMPLETED` 2026-09-22T15:53:32Z; human `STAGE_JUMPED` 2026-09-22T16:02:04Z. The engine's own capped-review guidance appears eight times in the audit and confirms the intended exit is the human, not a route: `…the review budget is exhausted; include the findings in the approval summary for the human.` Stage-wide, the record holds 36 `REVIEW_REQUESTED` against 29 `REVIEW_COMPLETED`.
- **Verified:** The budget cap and the emitted shape hold (`reviewer_max_iterations: 2` in `core/aidlc-common/stages/construction/functional-design.md:13`; `REVIEW_BUDGET_EXHAUSTED` at `core/tools/aidlc-log.ts:2393`). **The original draft's premise that completion refuses is wrong** — `core/tools/aidlc-state.ts:2469` accepts terminal `NOT-READY` as review-settled, so `unit complete --wave` proceeds. The issue is therefore *silent acceptance*, not a deadlock, and is reframed above. `escalation-required` already exists in the vocabulary (`core/tools/aidlc-directive.ts:119`) but is reachable from exactly one producer — the spent stale-receipt recovery at `core/tools/aidlc-orchestrate.ts:6118`–`6121`; a capped unresolved verdict never maps to it.

#### Proposed fixes

- **AIDLC-P-007:** Route a capped review that is still `NOT-READY` on critical findings to the existing `review_state: "escalation-required"` instead of pairing `NOT-READY` with `completion_required: true`. The state, its directive validation, and its protocol semantics ("halt and present the situation to the human; only a human Request Changes decision may reset the stage attempt") already exist — only this producer is missing.
- **AIDLC-P-008:** Include the owning upstream stage and an engine-issued backward-jump command in that escalation directive.
- **AIDLC-P-009:** Refuse wave completion for an escalated entry at directive generation time, so the entry is never handed back as completable while a critical upstream finding is open.

### AIDLC-ISSUE-004 — Declared validation surfaces are named but not invocable, and half of them ignore `--help`

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** sensors / reviewer UX
- **Observed:** Stage declarations name validation surfaces as bare sensor ids (`sensors: [required-sections, upstream-coverage, linter, type-check, traceability]`), and the reviewer protocol tells the reviewer to "run the validation tools listed (via shell)" — but neither the declaration nor the review dispatch brief carries an invocation. Sensor discovery required trial-and-error, and the evaluators do not self-describe: four of the six framework sensor evaluators ignore `--help` entirely and answer it with `--output-path is required` and exit `1`, printing no usage line.
- **Expected:** Reviewers can run each declared validation through a documented command with structured pass, fail, or unavailable output.
- **Impact:** Review results could not include authoritative sensor evidence and required unnecessary framework exploration. The audit quantifies the gap: over nine days, `required-sections` fired 38 times (0 failures), `upstream-coverage` 38 times (23 failures), `traceability` 30 times (24 failures) — and `linter` and `type-check`, both declared by the stage, **never fired once**. Every firing was engine-dispatched; not a single one originated from a reviewer, so the two sensors a reviewer would most plausibly run by hand are exactly the two with no recorded execution.
- **Evidence:** Functional Design review `c4e8430ed1f89649/2.review.md`; per-sensor `SENSOR_FIRED` tallies above from the intent audit (2026-09-14 → 2026-09-23); `aidlc engine sensor describe <id>` reproduced on `main`.
- **Verified:** Holds, with one nuance and one correction. Nuance: a discovery path *does* exist — `aidlc engine sensor describe <id>` prints the manifest's `command:` field, and `aidlc engine sensor --help` works — so the fix is to surface that invocation where the reviewer reads, not to invent one. The `--help` gap reproduces exactly: `aidlc-sensor-claim-sources`, `aidlc-sensor-traceability`, `aidlc-sensor-required-sections` and `aidlc-sensor-upstream-coverage` all exit `1` on `--help` with `--output-path is required`, while `aidlc-sensor-linter` and `aidlc-sensor-type-check` print usage. Three of the five sensors Functional Design declares are in the silent group. Anchors: `core/aidlc-common/stages/construction/functional-design.md:42`, `core/aidlc-common/protocols/stage-protocol-reviewer.md:157` and `:166`, and `core/tools/aidlc-review-brief.ts` (no sensor content).

#### Proposed fixes

- **AIDLC-P-010:** Put the resolved read-only validation command — the one `sensor describe <id>` already knows — in each review dispatch brief, so the reviewer does not have to discover `sensor describe` to reach it.
- **AIDLC-P-011:** Make every sensor evaluator accept `--help` and print a complete usage line before argument validation, matching `aidlc-sensor-linter` and `aidlc-sensor-type-check`. A missing required argument should also print that usage line, not only the missing-argument sentence.
- **AIDLC-P-012:** Return JSON such as `{ "status": "unavailable", "reason": "…" }` for unsupported or unconfigured validation instead of a bare non-zero exit.

### AIDLC-ISSUE-005 — Resume redelivers unchanged rule bundles before reporting a known blocker

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** session resume / context efficiency
- **Observed:** Resuming the blocked unit repeatedly transfers the same two-part rule bundle and 23 inline context paths before returning the same non-actionable wave state. Continuation tokens become stale after incidental state changes.
- **Expected:** Resume should identify a known blocker before heavyweight context delivery and reuse unchanged bundle state.
- **Impact:** Excess token use and tool turns without project progress. Measured on this project, the memory layer alone is **23,162 bytes** per delivery (`org.md` 14,102 + `project.md` 6,242 + `team.md` 1,490 + `phases/construction.md` 1,328), before the inline protocol paths the same directive names (`stage-protocol-reviewer.md` 81,655 bytes; the builder protocol 60,221). None of it changed between resumes. The audit records **28** `SESSION_STARTED` events for this one intent, each paying the redelivery again.
- **Evidence:** Repeated `load-steering` directives for Functional Design in the active audit/session sequence; file sizes measured under `aidlc/spaces/default/memory/` and `core/aidlc-common/protocols/`.
- **Verified:** Holds. The staleness is by construction: `handleContinue` rejects a token whose embedded state digest no longer matches the live state file and directs the caller to a fresh `next` (`core/tools/aidlc-orchestrate.ts:9671`–`9678`), and a fresh `next` restarts delivery at part 1. There is no bundle-hash reuse or delta path anywhere in the steering layer, and `orchestrate` exposes no compact status verb (its subcommands are `next`, `continue`, `report`, `park`, `team-board`, `wait`).

#### Proposed fixes

- **AIDLC-P-013:** Add a compact `aidlc engine resume --json` response with blocker code, current unit, legal actions, and failed command summary.
- **AIDLC-P-014:** Cache rule bundles by hash for a session and deliver only deltas after the first successful load.
- **AIDLC-P-015:** On invalidated continuation, return a compact restart directive rather than forcing full rule delivery.

### AIDLC-ISSUE-006 — Resume is a hand-driven multi-call loop, and `continue --token` is rejected as a stale token

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** session resume / CLI ergonomics · **Related:** AIDLC-ISSUE-004, AIDLC-ISSUE-005
- **Date:** 2026-09-22
- **Observed:** `/aidlc --resume` forces the conductor to hand-drive the steering-delivery loop (`orchestrate next --resume` → read `continue_token` → `orchestrate continue <token>` → repeat until `run-stage`), and a parser trap makes each resume cost extra tool calls and context: **`continue` takes a POSITIONAL token; `--token` is silently rejected with a misleading error.** `handleContinue` reads `args[0]` and guards on `args.length !== 1`, and the dispatcher consumes only `--project-dir` and `--aidlc-attempt-id` before handing the rest through. So `orchestrate continue --token "<t>"` arrives as `args = ["--token", "<t>"]` (length 2), the guard fires, and the reply is `"Invalid steering continuation token: this stage's rules cannot be loaded from where they left off. Run a fresh next to restart delivery from part 1."` The message points at token staleness, so the natural (wrong) reaction is to re-run `next` — which redelivers the full multi-part rule bundle (see ISSUE-005) and burns more context. The correct call is positional: `orchestrate continue "<t>"`.
- **Expected:** Resuming a workflow should take one command and return the terminal directive without the client re-implementing the steering loop, and an invalid-token error should distinguish "wrong argument shape" from "stale token" so it does not induce a needless full `next` restart.
- **Impact:** Every resume in this project has cost many framework round trips and a large fraction of the context window before any project work resumed; the misleading error repeatedly triggered a full-bundle `next` restart.
- **Evidence:** `scripts/aidlc-resume.sh` (added this session) completes the full chain to `run-stage` in one invocation via positional tokens. The flag-as-positional family has a second recorded instance in the audit: `aidlc engine orchestrate next --stage …` variants produced `Unknown stage: --stage` at 2026-09-18T15:05:31Z — the same failure mode (a flag swallowed as a positional value) reported as a domain error about a stage that was never named.
- **Verified:** The token trap is confirmed verbatim in source: `core/tools/aidlc-orchestrate.ts:9661`–`9670` (positional `args[0]`, the `args.length !== 1` guard, and the exact error string), with flag consumption limited to `--project-dir` / `--aidlc-attempt-id` at `:9960`–`:9976`. Two pieces of support for the proposed fixes exist in `main` already: the engine itself drains the steering loop server-side inside `unit complete --wave` (`core/tools/aidlc-state.ts:2363`, `:2450`), and `orchestrate report` was taught after 2.9.0 to name an argument it cannot act on and list its accepted flags (`REPORT_FLAGS`, `core/tools/aidlc-orchestrate.ts:7886`, commit `52ac7ed`) — `continue` is now the outlier.

#### Design rationale (added 2026-09-22)

The multistep steering loop with per-part tokens is not accidental output fragmentation — it is deliberate state-validation defense. Each `continue` token encodes `(stage, workflow_state_hash, bundle_hash, route, part_N)` and validates on every call. Between parts 1→2→3, the engine detects if state/rules changed (user edited state file, external mutation, etc.) and rejects the token. This catches state drift between parts.

However, this defensive design assumes a human conductor might hand-edit state files between parts. AI workflows will not. For AI resumption, this validation is unnecessary overhead: the agent is deterministic, won't mutate state mid-loop, and the framework could validate state once at loop start, batch parts server-side, and return only the terminal directive + bundle reference (see AIDLC-P-016).

#### Proposed fixes

- **AIDLC-P-016:** Ship an `aidlc engine orchestrate resume` (or `next --resume --drain`) that runs the whole steering-delivery loop server-side and returns the single terminal directive (`run-stage`/`ask`/`done`/`parked`/`error`) plus the already-delivered rule bundle, so the client never hand-drives `continue`. `unit complete --wave` already drains the same loop internally, so the mechanism exists; this trades the per-part state-validation surface (appropriate for humans) for AI-optimized single-call resumption (validate state once at loop entry, batch parts server-side).
- **AIDLC-P-017:** Accept `--token <t>` as an alias for the positional token in `orchestrate continue`, or reject unknown flags explicitly — exactly as `orchestrate report` now does — instead of folding them into the "stale token" path.
- **AIDLC-P-018:** Separate "wrong argument shape" from "token failed to decode" in the first guard. State-hash drift and route-hash drift already have their own distinct messages (`core/tools/aidlc-orchestrate.ts:9675`, `:9688`); only these two causes are conflated, and only genuine staleness should advise a fresh `next`.

### AIDLC-ISSUE-007 — Approval-gate hook instructs the agent to acknowledge the gate "as a human", and misstates its own check

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** approval gates / hooks · **Date:** 2026-09-22
- **Observed:** After `orchestrate report --stage contract-design --result awaiting-approval` opened the gate, a `PreToolUse` hook blocked **every** subsequent tool call (including a read of the report's own output file) with: "An approval gate is open and no human has acted since it opened. The gate requires a typed human turn before any tool call proceeds. Acknowledge the gate as a human, then continue." Two problems. First, the remedy it names — the agent acknowledging the gate *as a human* — is the impersonation the gate exists to prevent, and it contradicts the framework's own rule that an approval is never recorded on the human's behalf. Second, the message misdescribes its own predicate: the check is not "a human turn since the gate opened" but "a human turn later than the most recent gate-resolution event anywhere in the workflow", so the text sends the operator looking at the wrong window and names none of the causes that actually fire.
- **Expected:** A gate hook should never instruct the agent to supply the human turn. It should say what is blocked, name which condition failed, and stop — leaving the agent to end its turn and re-present the gate.
- **Impact:** The only compliant path is to re-present the gate and ask the human to retype an answer they have effectively already given — one wasted human round trip per gate whenever an earlier resolution in the same turn has already consumed the turn. An agent that follows the hook's wording literally would silently self-approve.
- **Impact (measured):** cause (a) is not an edge case — it is the normal shape of this project's gates. Of the 23 `STAGE_AWAITING_APPROVAL` events in the audit, **20 opened with the human turn already consumed** by a gate-resolution event that landed between the last `HUMAN_TURN` and the gate. So on 20 of 23 gates the hook was primed to demand a turn the human had already spent, while printing a sentence that describes none of that.
- **Evidence:** `report --result awaiting-approval` for `contract-design` in this session, then two consecutive intercepted calls (`read_file /tmp/rep1.txt`, then the `report --result approved` shell call), both returning the quoted `HOOK_INSTRUCTION`; the approval only committed after the user retyped `1`. The audit preserves the full trace of exactly that sequence on 2026-09-22: `HUMAN_TURN` 07:44:23Z → `QUESTION_ANSWERED` 07:44:46Z (consumes it) → `STAGE_AWAITING_APPROVAL` 07:44:58Z → human retypes, `HUMAN_TURN` 07:47:07Z → `GATE_APPROVED` 07:47:17Z. Two minutes and one redundant human turn, spent entirely on a resolution boundary the message never mentioned.
- **Precedent in the same codebase:** `aidlc-log answer` already words this correctly — `Cannot record the summary choice because no human reply has arrived after this question, or that turn was already used by another decision. End the turn, wait for the human's choice, then record it.` It names the consumed-turn case and the compliant next step, and it does not ask the agent to stand in for the human. AIDLC-P-020/021/023 are asking the gate hook to match a sentence the framework already ships.
- **Verified:** The wording is verbatim in source at `harness/kiro-ide/hooks/aidlc-kiro-adapter.ts:1063`–`1082`, and it returns exit `2` from an unfiltered `PreToolUse` route, which is why a plain `read_file` was blocked — so the blast-radius claim holds. **The original draft's explanation of the cause was wrong:** the predicate `humanActedSinceGate` (`core/tools/aidlc-lib.ts:8486`) anchors on the latest *gate-resolution* event — `GATE_APPROVED`, `GATE_REJECTED`, `QUESTION_ANSWERED`, `SUMMARY_CONFIRMATION_RECORDED`, `VERIFICATION_COMMAND_RECORDED`, `CONSTRUCTION_POLICY_RECORDED`, `PLAN_APPROVAL_RECORDED`, or an autonomous `AUTONOMY_MODE_SET` (`:8472`) — not on the gate opening. A turn typed before the gate opened therefore still counts, *unless* one of: (a) that turn was already consumed by an earlier resolution in the same turn, since the boundary is workflow-global and deliberately fails closed on same-turn cascades; (b) the `HUMAN_TURN` and the resolution share a second-precision timestamp in different audit shards, which fails closed by design (`:8549`–`8566`); or (c) no `HUMAN_TURN` was recorded at all. The hook prints the same sentence for all three.

#### Proposed fixes

- **AIDLC-P-020:** Reword the hook so it never asks the agent to act as the human: state that the gate is open and awaiting a human decision, and instruct the agent to end its turn and re-present the choices.
- **AIDLC-P-021:** Keep the fail-closed invariant, but make the message name the condition that fired — turn already consumed by the previous resolution, unordered same-second events across shards, or no human turn on record — and describe the real anchor (the last recorded gate resolution) instead of "since it opened". Diagnosing the consumed-turn case is what removes the wasted round trip; weakening the one-turn-per-resolution rule is not proposed.
- **AIDLC-P-022:** Narrow the block to gate-resolving actions (`report --result approved|rejected`) instead of all tool calls; reading a file or inspecting state cannot resolve a gate and should not be blocked.
- **AIDLC-P-023:** Have the hook name the exact compliant next step (re-present the gate and stop) so the remedy is unambiguous.

### AIDLC-ISSUE-008 — Engine verbs treat `--help` as a flag expecting a value, so there is no way to discover a verb's arguments

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Harness:** Kiro IDE
- **Status:** open · **Area:** CLI ergonomics · **Related:** AIDLC-ISSUE-004, AIDLC-ISSUE-006
- **Observed:** Asking an engine verb for help produces a parse error instead of usage: `aidlc engine log review --help` answers `{"error":"--help expects a value, got end of arguments."}` and exits `1`. The generic flag parser treats every unrecognised long flag as `--name value`, so `--help` consumes the next token — and at end of arguments it fails. The same shape applies to other verbs (`aidlc engine state unit --help` exits `1` with an unrelated state-file error). There is no per-verb usage output anywhere in the engine surface.
- **Expected:** `--help` on any engine verb prints that verb's accepted arguments and exits `0`, before any other argument validation or state loading.
- **Impact:** Argument shapes have to be discovered by guessing, and the guesses are recorded in the audit as failures. Beyond the eight `--help` parse errors, the same record contains guessed-flag failures such as `Unknown --checkpoint "learnings"` (twice) and the `Unknown stage: --stage` case in AIDLC-ISSUE-006 — all of them avoidable if the verb could describe itself. This is also the root cause of the positional-vs-`--token` trap in AIDLC-ISSUE-006: `orchestrate continue --help` cannot tell you the token is positional.
- **Evidence:** Eight occurrences of `--help expects a value, got end of arguments.` in the intent audit, spread over five distinct days (2026-09-16 → 2026-09-22), so it was rediscovered repeatedly rather than learned once. Reproduced on `main`: `bun core/tools/aidlc-log.ts review --help` → `{"error":"--help expects a value, got end of arguments."}`, exit `1`.
- **Verified:** Reproduces on `main` as quoted. Note the inconsistency this creates with surfaces that *do* support help: `aidlc engine sensor --help` works, and `aidlc-sensor-linter` / `aidlc-sensor-type-check` print usage (AIDLC-ISSUE-004), so the framework already has the behaviour — it is just not uniform.

#### Proposed fixes

- **AIDLC-P-026:** Intercept `--help` / `-h` in the shared flag parser before the `--name value` rule and before state loading, for every engine verb; print usage and exit `0`.
- **AIDLC-P-027:** Reject unknown long flags with a message naming the flag and listing the verb's accepted flags — the pattern `orchestrate report` already implements via `REPORT_FLAGS` (`core/tools/aidlc-orchestrate.ts:7886`) — rather than silently reinterpreting them as `--name value`.
- **AIDLC-P-028:** Add a test that asserts every engine verb exits `0` on `--help` and prints its argument list, so the surfaces cannot drift apart again.

## Acceptance criteria

- A reviewer infrastructure failure consumes zero review budget, is never recorded as an artifact verdict, and returns a typed recovery action. No unit can reach `UNIT_COMPLETED` on a receipt whose `body` is empty.
- A repeated `unit complete --wave` on an already-completed unit says it is already complete, and never reuses the readiness refusal.
- A capped review still carrying critical findings is never handed back as a completable Unit; it escalates and names the upstream stage that owns the fix.
- A redo route names the summary re-confirmation before the jump, and the guard-refusal record's `blockedAction` matches the sentence the operator sees.
- Every declared validation surface has a documented, read-only command reachable from the review brief, answers `--help` with usage, and returns a structured outcome.
- Resume identifies a known blocker without redelivering unchanged context.
- Resume completes in one command and returns the terminal directive; an invalid-token error names its cause and never falsely advises a full `next` restart.
- No hook ever instructs the agent to supply, acknowledge, or stand in for a human turn; a gate block names the condition that fired — including "that turn was already used by another decision" — and applies only to gate-resolving actions.
- Every engine verb answers `--help` with its argument list and exit `0`, and names unknown flags instead of consuming the next token as their value.
### AIDLC-ISSUE-015 — Reviewer subagent network failure forces a fallback NOT-READY on a clean advisory pass

- **Status:** open · **Area:** review orchestration / harness reliability · **Date:** 2026-09-23
- **Observed:** The Contract Design advisory reviewer subagent failed twice with `Sub-agent execution failed: Client network error calling Q`, writing no review file. Per `stage-protocol-reviewer.md` the retried-incomplete path then records a terminal `NOT-READY` fallback (`--fallback-finding "review did not complete within its turn budget"`), which becomes the advisory finding carried to the human gate even though the artifact was never actually reviewed.
- **Expected:** An infrastructure failure in the reviewer transport should be distinguishable from a substantive `NOT-READY` verdict, and ideally should not consume the review as a negative artifact finding.
- **Impact:** A transient network error on the reviewer subagent is recorded identically to a real adversarial rejection; the human gate sees "review did not complete within its turn budget" with no way to tell it apart from a content finding. Reinforces AIDLC-ISSUE-001's theme (infrastructure failure encoded as a verdict) on the advisory path.
- **Evidence:** Two consecutive `Sub-agent execution failed: Client network error calling Q` dispatch failures on 2026-09-23; terminal receipt `.aidlc-engine/reviews/contract-design/stage/1f577801d52260b8/1.json` with the fallback finding and no `*.review.md`.

#### Proposed fixes

- **AIDLC-P-032:** Distinguish reviewer-transport failure (network/dispatch error) from reviewer-produced `NOT-READY`, e.g. a `review-unavailable` receipt state (per AIDLC-P-001), so the gate brief can say "the automated review could not run" rather than presenting a fabricated content finding.
- **AIDLC-P-033:** Allow a bounded additional transport retry (distinct from the one substantive `--retry-pending`) when the failure is a client/network error before any reviewer execution, so a transient outage does not spend the review.
### AIDLC-ISSUE-016 — Re-run write-freeze when artifacts are edited before the fresh summary receipt (recurrence of AIDLC-ISSUE-002)

- **Status:** open (recurrence of AIDLC-ISSUE-002) · **Area:** summary-confirmation authorization / stage re-run · **Date:** 2026-09-23
- **Observed:** On a delivery-planning re-run after a backward jump, the produced artifact (`bolt-plan.md`) was edited to fold in the amended contract, then the pre-generation summary confirmation was recorded, then `report --result awaiting-approval` was refused with `SUMMARY_ARTIFACT_UNAUTHORIZED` and a `guard-recovery` ask whose only paths are `reconfirm-summary` (re-present the summary, reconfirm, re-save the artifacts) or `request-changes`.
- **Expected:** On a re-run of a `summary_confirmation: required` stage, the required ordering (summary stop → confirm → generate) should be surfaced up front so the conductor writes artifacts after the receipt, rather than discovered only at the gate after the writes already happened. Same root cause as AIDLC-ISSUE-002: mandatory post-jump/re-run checkpoints are disclosed only after the write.
- **Impact:** One extra human recovery turn plus a full re-save of the produced artifacts, even though a valid `SUMMARY_CONFIRMATION_RECORDED` receipt already exists for the attempt — it simply postdates the writes.
- **Evidence:** `SUMMARY_CONFIRMATION_RECORDED` id `8ae00b77230a3d21710b6edb374a5badccf4944b6b9bcb5bf294cc5ff12a5280` recorded after the `bolt-plan.md` edits; subsequent `report --result awaiting-approval` returned `reason_codes:["SUMMARY_ARTIFACT_UNAUTHORIZED"]`.

#### Proposed fixes

- **AIDLC-P-034:** When a `summary_confirmation: required` stage re-enters via a backward jump with produced artifacts already on disk, have the engine's re-entry directive state the required order (reconfirm the summary before touching produced artifacts) so the write-freeze is avoided rather than recovered.
- **AIDLC-P-035:** Let a re-save that occurs strictly after the in-force `SUMMARY_CONFIRMATION_RECORDED` clear `SUMMARY_ARTIFACT_UNAUTHORIZED` without a separate human recovery turn when the confirmation itself is current and unchanged.
### AIDLC-ISSUE-017 — Resume helper exits SIGINT without creating its redirected output file

- **Status:** open (recurrence of AIDLC-ISSUE-006 / AIDLC-ISSUE-013)
- **Area:** Kiro IDE terminal path / session recovery
- **Observed:** `scripts/aidlc-resume.sh > /tmp/functional-design-resume.txt 2>&1` returned exit `130`, but `/tmp/functional-design-resume.txt` was empty or absent when read back.
- **Expected:** When the helper reports a successful terminal race, its redirected output exists and contains the terminal response; otherwise it should report a diagnosable failure rather than a bare SIGINT.
- **Impact:** The client cannot determine the current workflow action from the helper and must retry a recovery command after verifying no transport result was produced.
- **Evidence:** Kiro IDE terminal result on 2026-09-23 after Delivery Planning approval; read of `/tmp/functional-design-resume.txt` immediately after the exit found no content.

#### Proposed fixes

- **AIDLC-P-036:** Make `aidlc-resume.sh` write and fsync its terminal directive to a temporary sidecar file before returning, then atomically publish it to the requested stdout path so a successful teardown race cannot leave an empty capture.
### AIDLC-ISSUE-018 — Resume helper can report exit 0 without creating redirected output

- **Status:** open (recurrence of AIDLC-ISSUE-017) · **Area:** session recovery / Kiro IDE terminal path · **Date:** 2026-09-23
- **Observed:** `scripts/aidlc-resume.sh > /tmp/functional-final-route.txt 2>&1` returned exit `0`, but `/tmp/functional-final-route.txt` was empty or absent immediately afterward.
- **Expected:** A zero exit from the helper guarantees a readable terminal directive block in the redirected output.
- **Impact:** A caller cannot distinguish a successful no-op from missing workflow transport and must rerun a fresh routing request despite the reported success.
- **Evidence:** Delivery Planning approval re-entry on 2026-09-23; `read_file` of `/tmp/functional-final-route.txt` found no content after the helper's exit `0`.

#### Proposed fixes

- **AIDLC-P-037:** Make the helper return non-zero when its terminal directive capture is empty, and add an integration test asserting that a zero exit always yields a non-empty terminal-directive file under stdout redirection.
### AIDLC-ISSUE-019 — Per-unit Functional Design re-entry does not name the required completion action

- **Status:** open · **Area:** wave execution / gate routing · **Date:** 2026-09-23
- **Observed:** After a READY per-unit Functional Design review, the workflow re-entered with `gate:false`, `completion_required:true`, and `review_state:"outstanding"`, but gave no explicit `unit complete --wave` action. Attempting the ordinary stage gate returned: `Cannot present "functional-design" for approval because 4 of 4 work items are not complete (...) Run \`next\` to finish the remaining work items, then try again.`
- **Expected:** A wave directive should name the deterministic per-unit completion command after the review settles, or expose a typed recovery/action rather than requiring the conductor to infer whether to run `unit complete --wave`, `next`, or a stage gate.
- **Impact:** The workflow treats completed artifacts and a recorded READY review as zero completed work items, blocking the stage gate and forcing a trial-and-error routing call.
- **Evidence:** Functional Design unit `shared-installation-foundation`, review record `.aidlc-engine/reviews/functional-design/units/shared-installation-foundation/ab8d11f4136279b7/2.json`; gate refusal on 2026-09-23.

#### Proposed fixes

- **AIDLC-P-038:** Include an explicit `next_action` / emitted command for every `completion_required:true` wave entry after its required review is settled, stating whether the conductor must call `unit complete --wave` or continue routing.
- **AIDLC-P-039:** Make a premature stage-gate refusal identify the unfinished Unit entries and their next legal completion action rather than only advising a generic `next`.
### AIDLC-ISSUE-020 — Hook-preserved direct continuation command returns no transport result

- **Status:** open · **Area:** Kiro IDE hook / steering transport · **Date:** 2026-09-23
- **Observed:** A hook instructed the conductor to continue Functional Design with `bun .kiro/tools/aidlc-orchestrate.ts continue "<token>"`. The exact command returned exit `130` with no stdout, so no next rule chunk or terminal directive was available to apply. The workspace's documented safe route uses `bun .kiro/tools/aidlc.ts engine orchestrate continue "<token>"` instead.
- **Expected:** Hook-preserved continuation commands must use the canonical executable entrypoint and return a transport payload, or the hook must clearly mark the command as non-executable.
- **Impact:** Workflow rule delivery stalls: following the hook literally yields no directive, while retrying risks token drift and duplicated mechanics.
- **Evidence:** Functional Design step-two continuation hook on 2026-09-23; exact direct-source command exited `130` with empty stdout.

#### Proposed fixes

- **AIDLC-P-040:** Generate Kiro hook continuation instructions through the same `aidlc.ts engine orchestrate continue` entrypoint required by workspace guidance, and integration-test that the preserved command emits the next directive under the IDE terminal.
### AIDLC-ISSUE-021 — Delayed hook continuation token becomes stale before its prescribed use

- **Status:** open · **Area:** Kiro IDE hook / steering transport · **Date:** 2026-09-23
- **Observed:** The hook said to preserve but not immediately run its step-two continuation. Before it could be applied, intervening routing/report activity changed workflow state. The canonical continuation then returned: `This continuation token is no longer current for this workflow. Run a fresh next; do not reuse an earlier token.`
- **Expected:** A hook that requires deferred continuation should either issue a token stable across its own prescribed pause or provide a safe typed refresh action without forcing full rule delivery.
- **Impact:** The rule-delivery hook creates a token that can be invalid before the instructed action, causing a workflow stop and full fresh-routing restart.
- **Evidence:** Functional Design hook continuation on 2026-09-23; canonical `aidlc.ts engine orchestrate continue` response recorded in `/tmp/hook-functional-continue-canonical.txt`.

#### Proposed fixes

- **AIDLC-P-041:** Do not emit a deferred-use continuation token from the hook; either continue synchronously inside the hook transport or emit an explicit refresh command that returns the terminal directive without replaying stale-token failure semantics.

### AIDLC-ISSUE-022 — `sensor-traceability` reports other units' requirements as missing upstream IDs on a per-unit stage

- **Status:** Open
- **Area:** Sensors — `traceability` (`aidlc engine sensor-traceability`)
- **Observed:** Run against one unit's Functional Design coverage file, the sensor resolves upstream IDs from `requirements.md` without unit scoping. For unit `cli-manifest-adoption` it returned `pass:false`, `findings_count:14`, `missing_from_upstream_ids:["FR1.3","FR3","FR3.1","FR3.2","FR3.3","FR3.4","FR3.5","FR3.6","FR3.7","FR3.8","FR4.1"]` — the eight `FR3.*` entries are assigned to unit `activation-migration-compatibility` by `inception/units-generation/unit-of-work-story-map.md` and cannot be covered by this unit.
- **Expected:** On a `for_each: unit-of-work` stage, upstream ID resolution honours the per-unit assignment the story map declares (or the sensor reports unassigned IDs separately from genuinely missing ones), so `findings_count` reflects only this unit's gaps.
- **Impact:** 8 of 14 findings are noise. A reviewer or gate reader must re-derive the unit assignment by hand to tell a real coverage gap (here `FR1.3`, `FR4.1`) from another unit's requirement; taken at face value the result pushes a unit to trace requirements it must not own.
- **Evidence:** `bun .kiro/tools/aidlc.ts engine sensor-traceability --output-path aidlc/spaces/default/intents/260914-unified-installation/construction/cli-manifest-adoption/functional-design/traceability.json --stage-slug functional-design`; story-map assignment in `aidlc/spaces/default/intents/260914-unified-installation/inception/units-generation/unit-of-work-story-map.md`.

#### Proposed fixes

- **AIDLC-P-042:** When the stage is `for_each: unit-of-work` and the coverage file names a `unit`, filter resolved upstream IDs to the requirements the story map assigns to that unit (primary plus cross-cutting) before computing `missing_from_upstream_ids`.
- **AIDLC-P-043:** If the story map cannot be parsed, keep the current behaviour but return the unassignable IDs under a separate key (for example `unassigned_upstream_ids`) excluded from `findings_count`, so a per-unit result stays actionable.
### AIDLC-ISSUE-023 — A substantive review is discarded because its record carries an H1 title

- **Status:** open · **Area:** review orchestration / record validation · **Date:** 2026-09-23
- **Observed:** The reviewer produced a complete, substantive adversarial review for unit `cli-manifest-adoption` (1 Critical, 6 Major, 3 Minor, with sensor evidence). Recording it was refused: `Refusing REVIEW_COMPLETED for "functional-design": the reviewer appendix must be terminal and contain no later rendered H1 or H2 heading.` The sole cause was a leading `# Functional Design Review — cli-manifest-adoption (U2)` title line before `## Review`. There is no repair path for the conductor — the review file is reviewer-owned — so the only route is `--retry-pending` and a full re-dispatch, which re-runs the entire analysis and deletes the existing draft when it reopens the slot.
- **Expected:** A purely cosmetic leading-title violation should either be tolerated (or normalized) when the required `## Review` section, verdict, reviewer, iteration, and findings table are all present and unambiguous, or the refusal should name a non-destructive fix that preserves the completed analysis.
- **Impact:** A complete review was destroyed and its one retry spent; the re-dispatch then timed out (see AIDLC-ISSUE-024), leaving the Unit with a fallback `NOT-READY` carrying no findings even though a full review had actually been performed. Roughly an hour of review work produced no recorded evidence.
- **Evidence:** Request `review:85aec69a6107059748c9b7f70b13f143`; refusal on the first `--verdict NOT-READY` recording attempt; the review slot at `.aidlc-engine/reviews/functional-design/units/cli-manifest-adoption/ab8d11f4136279b7/` was empty afterwards; terminal fallback receipt `1.json` recorded with `--fallback-finding`.

#### Proposed fixes

- **AIDLC-P-042:** Accept a single leading H1 title before the `## Review` section, or normalize it away at record time, since it cannot create ambiguity about ownership fields or section boundaries.
- **AIDLC-P-043:** When a review file fails only structural validation, keep the draft bytes and return a typed repair action (for example, re-record from a normalized copy) instead of requiring a destructive re-dispatch that spends the retry allowance.
- **AIDLC-P-044:** State the required file shape — first line `## Review`, no later H1/H2 — in the reviewer dispatch contract itself, so a reviewer cannot satisfy its persona template and fail the recorder at the same time.

### AIDLC-ISSUE-024 — Reviewer subagent runs to a one-hour timeout and writes nothing

- **Status:** open · **Area:** review orchestration / dispatch reliability · **Date:** 2026-09-23
- **Observed:** The re-dispatched reviewer for `cli-manifest-adoption` was aborted after 3,600,000 ms with `Sub-agent ... timed out after 3600000ms and was aborted`, having written no review file. The brief was narrower than the first (it carried the prior findings to re-verify), and the first dispatch of the same task had completed in minutes.
- **Expected:** A reviewer dispatch should either return within a bounded budget or surface partial progress; an hour-long silent run before abort is not a usable failure mode, and the protocol's turn-budget fallback assumes something far shorter.
- **Impact:** One hour of wall-clock time yielded no evidence. Combined with AIDLC-ISSUE-023 the Unit reached its gate-relevant receipt with a synthetic `NOT-READY` and zero findings, which understates a design that had ten real defects.
- **Evidence:** Timeout abort message on 2026-09-23 for the `cli-manifest-adoption` iteration-1 re-dispatch; empty review slot; fallback receipt recorded immediately afterwards.

#### Proposed fixes

- **AIDLC-P-045:** Bound reviewer dispatches to a short budget (minutes, not an hour) and return a typed `review-timeout` outcome distinguishable from a substantive `NOT-READY`, per AIDLC-P-001's review-state split.
- **AIDLC-P-046:** Have the reviewer flush its findings table incrementally (or write a partial review marked incomplete) so an abort preserves whatever analysis completed.
### AIDLC-ISSUE-025 — A directed in-unit cleanup cannot be verified: the write that fixes it spends the last review

- **Status:** open · **Area:** review budget / Change Control interaction · **Date:** 2026-09-24
- **Observed:** On unit `cli-manifest-adoption`, the adversarial budget (`reviewer_max_iterations: 2`) was exhausted, so the human chose to repair only the unit's own self-inconsistencies and carry the contract-level findings. Making those repairs invalidated the terminal iteration-2 receipt, which under Change Control `strict` permitted exactly one stale-receipt recovery review (iteration 3). That recovery found the repair incomplete (R-03 landed 2 of 4 edits) and surfaced two new in-unit defects (R-15, R-16) — all three cheaply fixable documentation-consistency issues. But the recovery allowance is now spent: fixing them would invalidate the recovery receipt with no review left to verify the fix, and the engine refuses a further request. The only route back to a verifiable state is a gate rejection, which is unavailable here because per-unit gates are suppressed and the stage gate is several units away.
- **Expected:** A human-directed, explicitly bounded cleanup pass (no behaviour change, no contract change) should not consume the unit's last review opportunity, or the engine should offer a verification pass scoped to that cleanup.
- **Impact:** The unit settles carrying three defects that were identified, are trivially fixable, and cannot be fixed-and-verified. The workflow's own quality signal is strongest exactly when it can no longer be acted on. This is the mirror image of AIDLC-ISSUE-003: there, capped findings were silently accepted; here, a *directed repair* is what exhausts the budget.
- **Evidence:** Unit `cli-manifest-adoption`; receipts `.aidlc-engine/reviews/functional-design/units/cli-manifest-adoption/ab8d11f4136279b7/{2,3}.json`; iteration 3 recorded `recovery: stale-receipt` and returned NOT-READY with R-03 unresolved plus new R-15/R-16.

#### Proposed fixes

- **AIDLC-P-047:** Distinguish a bounded consistency-repair write (no `produces[]` semantic change beyond findings already recorded) from a substantive revision, and let it re-verify under the existing recovery allowance instead of consuming it.
- **AIDLC-P-048:** When per-unit gates are suppressed and recovery is spent, expose a per-unit Request Changes equivalent so a human can reset one unit's review attempt without waiting for the stage-wide gate.
### AIDLC-ISSUE-026 — Guard-recovery offers a `request-review` remedy the logger then refuses

- **Status:** open · **Area:** guard-recovery remedies / review budget · **Date:** 2026-09-24 · **Related:** AIDLC-ISSUE-025
- **Observed:** After post-recovery edits to unit `cli-manifest-adoption`, `orchestrate next` returned `ask_type: "guard-recovery"` with `reason_codes: ["REVIEW_RECOVERY_SPENT"]` and two remedies, the first being `{"op":"request-review","action":"Request review iteration 2 against the current artifact and source bytes.","requiresHuman":false,"executableNow":true}`. Executing exactly that remedy was refused: `Cannot start another review for "functional-design": the one recovery review was already used, and this stage's output document changed again afterward.` The same refusal payload then re-offered the identical `request-review` remedy with `executableNow: true`.
- **Expected:** A remedy advertised as `executableNow: true` must be executable, or it must not be offered. The skill's guard-recovery contract says to present only remedies whose `executableNow` is true and then execute the selected one, so an unexecutable-but-advertised remedy makes the recovery ask self-contradictory and loops.
- **Impact:** The conductor is directed to an action that cannot succeed, and the refusal re-offers it, inviting a retry loop against the two-refusals-per-identity stop rule. The only genuinely available route (`request-changes`) requires a human gate decision that is unreachable while per-unit gates are suppressed (AIDLC-ISSUE-025), so the unit cannot be settled or verified.
- **Evidence:** Resume output on 2026-09-24 for unit `cli-manifest-adoption` (`reason_codes: ["REVIEW_RECOVERY_SPENT"]`, `request-review` offered `executableNow: true`); subsequent `log review --iteration 2` refusal quoting the same remedy list.

#### Proposed fixes

- **AIDLC-P-049:** Compute `executableNow` for `request-review` against the same preconditions the logger enforces (recovery spent plus artifacts changed since the recovery receipt), so a spent budget reports `executableNow: false` instead of advertising an impossible action.
- **AIDLC-P-050:** Do not re-offer the just-refused remedy verbatim in the refusal's own recovery payload; return only remedies that remain genuinely available, which in this state is `request-changes` alone.
### AIDLC-ISSUE-027 — Recorded `Request Changes` recovery answer does not satisfy the reject guard

- **Status:** open · **Area:** guard-recovery / rejection authority · **Date:** 2026-09-24 · **Related:** AIDLC-ISSUE-025, AIDLC-ISSUE-026
- **Observed:** In the `REVIEW_RECOVERY_SPENT` state for unit `cli-manifest-adoption`, the only viable remedy is `request-changes`. The recovery question was presented to the human, who chose `Request Changes`; the pair was recorded (`DECISION_RECORDED` with options `Request Changes,Request review`, then `QUESTION_ANSWERED` `Details: Request Changes` `Unit: cli-manifest-adoption` at 2026-09-24T09:36:05Z). The immediately following rejection was still refused at 09:36:13Z: `Refusing to reject "functional-design": the recovery-question choice was not Request Changes. Carry out that action, or re-present the recovery question and wait for the human to choose Request Changes.` The refusal names the exact action that was just performed and recorded.
- **Expected:** A recorded `QUESTION_ANSWERED` of `Request Changes` against the recovery question should satisfy the reject guard, or the refusal should state which additional property it requires (checkpoint id, absence/presence of `--unit`, decision wording, or a specific option set) so the conductor can comply without guessing.
- **Impact:** Terminal deadlock for the unit. `request-review` is refused (AIDLC-ISSUE-026), `unit complete --wave` is refused, the engine will not route to any other unit, and the one advertised human route is refused after the human took it. Two refusals of the same action identity reached the conductor's stop rule, so no further attempt is permitted. The workflow cannot advance without out-of-band intervention.
- **Evidence:** Audit shard `aidlc/spaces/default/intents/260914-unified-installation/audit/` at 2026-09-24T09:36:05Z (`QUESTION_ANSWERED`, `Details: Request Changes`) and 09:36:13Z (`ERROR_LOGGED`, `aidlc-state reject functional-design --feedback … --user-input Request Changes`). First identical refusal at 09:35:0xZ before the pair was recorded.

#### Proposed fixes

- **AIDLC-P-051:** Make the reject guard accept the recorded recovery `QUESTION_ANSWERED` whose details equal `Request Changes` for the stage (and Unit, when per-unit), matching how the blocking-sensor override guard consumes its decision/answer receipt.
- **AIDLC-P-052:** Have the refusal name the missing property explicitly rather than restating the action as not done; a guard that cannot be satisfied from its own message is unactionable.
- **AIDLC-P-053:** Emit the exact expected recovery-answer identity in the `guard-recovery` ask payload (checkpoint name and whether `--unit` must be present or absent), so the conductor records a receipt the guard will accept on the first attempt.
### AIDLC-ISSUE-028 — `REVIEW_RECOVERY_SPENT` deadlock survives a session restart: `--resume` has no reachable forward move

- **Status:** open (recurrence and escalation of AIDLC-ISSUE-026 and AIDLC-ISSUE-027) · **Area:** guard-recovery / review budget / resume · **Date:** 2026-09-24 · **Related:** AIDLC-ISSUE-025, AIDLC-ISSUE-026, AIDLC-ISSUE-027
- **Observed:** A fresh session (`SESSION_STARTED` `sess_ca4dceba-3b58-42d8-b146-cb4c5ae49499`) resumed with `scripts/aidlc-resume.sh --resume`. The terminal directive was again `ask_type: "guard-recovery"`, `reason_codes: ["REVIEW_RECOVERY_SPENT"]`, stage `functional-design`, unit `cli-manifest-adoption`, with the same two remedies both marked `executableNow: true`. The human selected the non-human remedy (`request-review`); `log review --iteration 2` was refused exactly as in AIDLC-ISSUE-026 and re-offered itself. The other remedy (`request-changes`) was already refused twice in the prior session (AIDLC-ISSUE-027). So neither advertised remedy is executable, and the state is identical after a restart — there is no session-scoped reset.
- **Expected:** `--resume` should never return an ask whose every remedy is unexecutable. When both recovery routes are exhausted, the engine should either return a terminal `error` naming the required out-of-band step, or offer the one route that is actually open (Change Control `relaxed`, which the reviewer protocol documents as the value under which a stale terminal receipt stays valid and no recovery review is requested).
- **Impact:** The workflow is unrecoverable through its own surfaces. Every forward action for the unit — `request-review`, `request-changes`/reject, and `unit complete --wave` — is refused, the engine routes to no other unit, and resuming in a new session reproduces the same dead ask. The only remaining lever is an operator-level `aidlc engine config set change-control relaxed`, which no refusal, remedy, or ask mentions.
- **Secondary finding:** the Change Control value is not readable through the `config` section CLI — `config change-control --show --json` returns `unknown config section "change-control"; valid sections: models, runtime, providers, trust, flags, project` — so its current value (`strict (set by you)`) is only discoverable by reading `aidlc-state.md`, even though `config set change-control` is a valid verb.
- **Evidence:** `/tmp/aidlc-resume.txt` terminal directive on 2026-09-24; audit shard `aidlc/spaces/default/intents/260914-unified-installation/audit/ncelrnd1524-8b5d79f53367.md` at `2026-09-24T10:36:30Z` (`ERROR_LOGGED`, `aidlc-log review … --iteration 2 --unit cli-manifest-adoption`) following the prior-session refusals at `08:50:46Z`, `09:31:22Z`, and `09:36:13Z`; `aidlc-state.md:21` (`Change Control: strict (set by you)`).

#### Proposed fixes

- **AIDLC-P-054:** When every `guard-recovery` remedy is unexecutable, return a terminal `error` directive that names the out-of-band step, instead of an `ask` that cannot be answered productively.
- **AIDLC-P-055:** Include a `change-control` remedy in the `REVIEW_RECOVERY_SPENT` payload when the intent is `strict`, stating that `relaxed` keeps the existing terminal receipt valid and records `CHANGE_ACCEPTED`, so the documented escape is reachable from the refusal itself.
- **AIDLC-P-056:** Expose `change-control` as a readable `config` section (`config change-control --show --json`) so its value does not require parsing `aidlc-state.md`, matching the existing `config set change-control` verb.
### AIDLC-ISSUE-029 — Reviewer transport outage would spend the adversarial budget on a review that never ran (recurrence of AIDLC-ISSUE-015)

- **Status:** open (recurrence of AIDLC-ISSUE-015 and AIDLC-ISSUE-024) · **Area:** review orchestration / harness reliability · **Date:** 2026-09-24 · **Related:** AIDLC-ISSUE-001, AIDLC-ISSUE-015, AIDLC-ISSUE-024, AIDLC-ISSUE-028
- **Observed:** On unit `vscode-shared-lifecycle-adoption`, `log review --iteration 1` succeeded (`requestId review:e69307becf60f8a54c0a26b81a835415`). The reviewer dispatch failed immediately with `Sub-agent execution failed: Client network error calling Q`, writing no review file. The sanctioned single retry (`--retry-pending`, accepted with `retry: "pending-request"`) was followed by a second dispatch that failed with the identical error. Per `stage-protocol-reviewer.md` the next prescribed step is to record a terminal `NOT-READY` fallback with `--fallback-finding "review did not complete within its turn budget"` and then, because this is `adversarial` with iterations remaining, request iteration 2 — i.e. spend iteration 1 of 2 on an outage and then very likely spend iteration 2 the same way.
- **Expected:** A transport failure that occurs before the reviewer executes should not consume a review iteration, and should not be recorded as an artifact verdict. The protocol should offer a hold state ("reviewer unreachable, request still open, retry when transport recovers") distinct from a substantive `NOT-READY`.
- **Impact:** The prescribed path converts an infrastructure outage into two fabricated `NOT-READY` verdicts and an exhausted adversarial budget. On this same intent that end state is what produced the AIDLC-ISSUE-028 deadlock (`REVIEW_RECOVERY_SPENT` with no executable remedy), so following the protocol here risks re-entering a state we have just had to escape via a Change Control flip. The conductor stopped short of the fallback and surfaced the choice to the human instead.
- **Evidence:** Two consecutive `Sub-agent execution failed: Client network error calling Q` dispatch failures on 2026-09-24 for `functional-design` / `vscode-shared-lifecycle-adoption`; request `review:e69307becf60f8a54c0a26b81a835415` left unmatched with its retry spent and its review slot (`.aidlc-engine/reviews/functional-design/units/vscode-shared-lifecycle-adoption/ab8d11f4136279b7/1.review.md`) empty.

#### Proposed fixes

- **AIDLC-P-057:** Add a `review-unavailable` hold outcome (per AIDLC-P-001 / AIDLC-P-032) that leaves the request unmatched and re-dispatchable without consuming an iteration or the one `--retry-pending` allowance, so a transport outage is resumable rather than budget-consuming.
- **AIDLC-P-058:** Allow unlimited transport-level re-dispatch against an unmatched request whose artifact and source fingerprints are unchanged, and reserve `--retry-pending` for the case where the reviewer actually ran but produced an unusable review.
- **AIDLC-P-059:** Make the reviewer protocol state explicitly what a conductor should do when the retried dispatch fails for a *transport* reason rather than a reviewer-content reason; today both collapse onto the same `NOT-READY` fallback.
### AIDLC-ISSUE-030 — Gate-blocking hook makes the mandatory Review brief unreachable, and the approval `report` returns `done` while telling you to continue

- **Status:** open (recurrence of AIDLC-ISSUE-007, plus one new fact) · **Area:** approval-gate hook / report directive shape · **Date:** 2026-09-24 · **Related:** AIDLC-ISSUE-007, AIDLC-ISSUE-029
- **Observed (recurrence of AIDLC-ISSUE-007):** `orchestrate report --stage functional-design --result awaiting-approval` opened the gate, after which a `PreToolUse` hook blocked every subsequent tool call with the same wording AIDLC-ISSUE-007 records, including "Acknowledge the gate as a human, then continue." The conductor refused to impersonate the human turn and presented the gate from records it had already gathered.
- **Observed (new — ordering trap):** `stage-protocol-reviewer.md` requires `aidlc engine review-brief review --stage <slug> --why <first|revision|stale>` to be run and printed verbatim as the opening of every reviewer-backed human gate. `SKILL.md`'s completion sequence puts `report --result awaiting-approval` at step 4 and the gate presentation at step 5, so the brief is naturally run after the report — at which point the gate hook blocks it. The mandatory brief is therefore unreachable on the prescribed ordering, and the conductor had to compose the gate presentation by hand from the review records it happened to still hold.
- **Observed (new — directive shape):** the approving `report --stage functional-design --result approved --user-input "Approve"` returned `{"kind":"done","reason":"Committed approve for \"functional-design\" (scope: unified-bundle-installation-migration). State advanced; run next to continue."}`. `SKILL.md`'s directive table says `done` means the workflow is complete and the loop must STOP, yet this `reason` explicitly instructs the conductor to run `next`, and NFR Requirements is still pending. The kind and its own message give opposite instructions.
- **Expected:** (a) the gate hook should not block the tool the gate presentation is required to run, or `SKILL.md` should place the Review brief before `report --result awaiting-approval`; (b) a report-commit acknowledgement should not reuse the terminal `done` kind — a non-terminal commit needs its own kind (or `print` with a continue instruction), so the stop rule stays unambiguous.
- **Impact:** The one mandatory, deterministic, path-specific gate surface cannot be shown on the documented ordering, so every reviewer-backed gate is presented ad hoc from whatever the conductor still has in context — exactly the hand-rolled substitute the brief exists to replace. Separately, a conductor obeying the `done` stop rule halts a workflow that has nine stages left, while one obeying the `reason` violates the stop rule; either way the operator has to intervene.
- **Evidence:** 2026-09-24 session `sess_ca4dceba-3b58-42d8-b146-cb4c5ae49499`; gate-block hook output on `orchestrate report ... --result awaiting-approval` for `functional-design`; approval report output quoted verbatim above.

#### Proposed fixes

- **AIDLC-P-060:** Move the `review-brief review` call ahead of `report --result awaiting-approval` in `SKILL.md`'s completion sequence, or exempt `review-brief` (read-only) from the gate-blocking `PreToolUse` matcher.
- **AIDLC-P-061:** Restrict the gate-blocking hook to gate-resolving actions only (as AIDLC-ISSUE-007's acceptance criterion already asks), so read-only presentation tooling and output reads are never blocked.
- **AIDLC-P-062:** Introduce a non-terminal `committed` (or reuse `print`) directive for report acknowledgements that advance state, and reserve `done` for actual workflow/single-stage completion.

### AIDLC-ISSUE-031 — A batched non-gate question cannot be logged per question: the second `log answer` is refused

- **AI-DLC:** `2.9.0` (runtime `2.9.0`)
- **Area:** stage protocol §3 (non-gate question logging) vs the human-presence guard in `aidlc-log.ts answer`
- **Observed:** `stage-protocol.md` §3 pairs each structured question with its own
  `log decision` → `log answer` receipt, and the Kiro question-rendering annex explicitly
  permits batching ("at most ~4 questions per message"). Following both, I recorded two
  `DECISION_RECORDED` rows for a two-question follow-up batch (`Q2a`, `Q3a`), presented both
  in one message, and the human answered both in one reply. The first
  `log answer --stage nfr-requirements --unit shared-installation-foundation` succeeded; the
  second was refused with `{"error":"Cannot record this answer because no new human reply has
  arrived for the question. Wait for the human to type an answer, then try again."}`. The reply
  had arrived — it answered both questions — but it was one human turn, and the first `answer`
  consumed it.
- **Expected:** either (a) the protocol states that a batch of questions gets exactly one
  `decision`/`answer` pair covering the batch, so two decisions for one presented batch is the
  authoring error; or (b) the guard allows one `answer` per outstanding `DECISION_RECORDED`
  within the same human turn, since the turn genuinely answered each of them. Today the two
  documents point one way and the guard the other, and the refusal text asserts something
  factually untrue about the conversation ("no new human reply has arrived").
- **Impact:** the second question's choice has no `QUESTION_ANSWERED` row. The questions file
  still records it, and the later summary-confirmation receipt digests the whole file, so
  traceability survives — but the audit ledger under-describes a decision the human actually
  made, and the agent is pushed toward either padding turns (asking one question per message)
  or silently dropping receipts. The refusal also reads as a state error rather than an
  authoring constraint, which invites a retry loop.
- **Evidence:** `bun .kiro/tools/aidlc.ts engine log answer --stage nfr-requirements --unit
  "shared-installation-foundation" --details "Q3a: A - atomic rename everywhere"` → the error
  above, immediately after the same command for `Q2a` returned
  `{"emitted":"QUESTION_ANSWERED","stage":"nfr-requirements"}`. Questions file carrying both
  committed answers:
  `aidlc/spaces/default/intents/260914-unified-installation/construction/shared-installation-foundation/nfr-requirements/nfr-requirements-questions.md`.

#### Proposed fixes

- **AIDLC-P-063:** State the batching contract explicitly in §3: one `decision`/`answer` pair per
  *presented batch*, not per question, with the `--details` value naming every question and its
  exact chosen label. Then a two-question batch is one decision row, and the guard is never hit.
- **AIDLC-P-064:** Alternatively, let the presence guard satisfy every `DECISION_RECORDED` that is
  still unanswered at the time of the human turn, so a genuinely multi-answer reply can be
  recorded question by question.
- **AIDLC-P-065:** Reword the refusal so it names the real condition — the human turn was already
  consumed by a prior receipt — instead of claiming no reply arrived. The same wording problem is
  recorded for the gate hook in AIDLC-P-021.

### AIDLC-ISSUE-032 — A READY review with an empty findings table is rejected by the review recorder

- **Status:** Open
- **Area:** reviewer protocol / review-record parser
- **Observed:** The iteration-2 reviewer returned `READY` and wrote the prescribed `### Findings` table with one no-findings row whose ID was `—`. `aidlc engine log review ... --verdict READY` then refused it: `invalid finding ID "—"`. The reviewer protocol requires a findings table but does not define a valid empty-table representation accepted by the recorder.
- **Expected:** A reviewer that finds no issues can write a valid READY review and have its terminal receipt recorded without manufacturing a fake finding or triggering fallback recovery.
- **Impact:** A successful review is treated as malformed after its sole retry was spent on a prior timeout. The normal completion path is blocked despite a valid substantive outcome, forcing a NOT-READY fallback that falsely represents review availability.
- **Evidence:** `aidlc/spaces/default/intents/260914-unified-installation/.aidlc-engine/reviews/nfr-requirements/units/cli-manifest-adoption/c32cb885cf59f263/2.review.md`; command `bun .kiro/tools/aidlc.ts engine log review --stage nfr-requirements --unit cli-manifest-adoption --reviewer aidlc-architecture-reviewer-agent --iteration 2 --verdict READY` → `invalid finding ID "—"`.

#### Proposed fixes

- **AIDLC-P-066:** Define one canonical empty-findings representation (for example an empty table body or a `None` sentinel) in the reviewer template and accept it in the review parser for `READY` verdicts.
- **AIDLC-P-067:** Validate the reviewer output against the same grammar before the reviewer returns, so an invalid no-findings row is repaired before the terminal receipt attempt.
- **AIDLC-P-068:** Improve the refusal to name the expected empty-findings form and distinguish a structurally malformed empty review from a substantive invalid finding ID.
### AIDLC-ISSUE-033 — Repeated reviewer-dispatch transport failures consume the only retry before a reviewer starts

- **Status:** open (recurrence of AIDLC-ISSUE-029) · **Area:** review orchestration / harness reliability · **Date:** 2026-09-25 · **Related:** AIDLC-ISSUE-001, AIDLC-ISSUE-015, AIDLC-ISSUE-024, AIDLC-ISSUE-029
- **Observed:** For `nfr-requirements` unit `activation-migration-compatibility`, iteration 2 was requested successfully (`requestId review:f59753946a5c5642c923206c3604d332`). Four reviewer dispatches then failed before reviewer execution with `Sub-agent execution failed: Client network error calling Q`; no `2.review.md` was created. The only `--retry-pending` retry was accepted and a further dispatch failed with the same transport error, leaving an unmatched request whose substantive retry is spent. A later terminal call also timed out while merely listing the empty review directory; that terminal symptom is excluded from this framework issue.
- **Expected:** A reviewer transport failure before a review file exists must be held as `review-unavailable` and remain safely re-dispatchable after transport recovery; it must not consume the single incomplete-review retry or force a fabricated `NOT-READY` verdict.
- **Impact:** Changing the chat model may restore reviewer availability, but the framework's recorded state now prevents the requested retry. The prescribed fallback would consume iteration 2 on an unavailable reviewer and encode an infrastructure failure as an artifact verdict, defeating the requested independent re-review of revised NFR artifacts.
- **Evidence:** `/tmp/aidlc-rr2b.txt` records the accepted retry; `.aidlc-engine/reviews/nfr-requirements/units/activation-migration-compatibility/c32cb885cf59f263/` contains only `1.json`, with no `2.review.md`; the four dispatch errors occurred in this session after the iteration-2 request.

#### Proposed fixes

- **AIDLC-P-069:** Implement AIDLC-P-057/P-058: record a distinct `review-unavailable` state and permit transport-level re-dispatch of an unchanged unmatched request without spending `--retry-pending` or a review iteration.
- **AIDLC-P-070:** Return a typed recovery directive when the retry is spent by a transport failure, explicitly allowing a human to retry after changing the reviewer environment rather than directing the conductor to a content-level `NOT-READY` fallback.
