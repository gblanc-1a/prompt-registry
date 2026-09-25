<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
- 2026-09-25T15:36:35Z — "do not wait for overwrite interaction during activation" resolved as: U4 still requests the shared OverwriteDecision through Contract 4's required interaction port, but never awaits it, so a decision that cannot be produced without waiting resolves as `unavailable`. That makes `preserved-conflict` the only conflict disposition reachable in an activation pass, and NFR4's "presents the overwrite decision" criterion is met by deferred manual guidance rather than a prompt.
- 2026-09-25T14:56:30Z — U4 is disposable compatibility code. Its NFRs center on activation responsiveness, non-fatal safety behavior, state-free current-run reporting, and strict U1-owned transfer/cleanup; it must not gain a second lifecycle or persistent outcome store.
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
- 2026-09-25T15:36:35Z — the answered activation bound makes functional-spec step 3.1's `confirmed` overwrite branch unreachable from `runActivationMigration`. Recorded as an explicit requirement deviation for the gate rather than silently dropped; the port and shared decision type stay as contracted.
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
- 2026-09-25T15:36:35Z — the 2s p95 bound confirms assumption ASM3 and has no inception NFR parent, so it carries the ID `ASM3.1` and is recorded outside the NFR coverage table rather than folded under NFR2 (Recovery correctness), whose text has no latency content. Cost: the bound is not itself an `NFRx.y` row, so downstream stages pick it up through NFR2.2, which references it, instead of directly.
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
