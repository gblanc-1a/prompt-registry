<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->


## Interpretations
- 2026-09-21T14:48:00Z — U3 is the strangler-fig delivery adapter for the extension's install/update/uninstall. The three big migrations, all answered A: retire the extracted-files bundle cache entirely (no cache-then-sync); resolve shared data through the injected AppStorage port per ADR-0005 (not context.globalStorageUri); make the shared registry the single source of truth with the extension registry manager reduced to a thin read-only-projection delegator per ADR-0001. Existing extension records import once, like U2's CLI user lockfile.
- 2026-09-21T14:48:00Z — Conflict handling keeps decision in the shared layer and interaction in the adapter: shared lifecycle returns `conflict` writing nothing, extension prompts, re-invokes with an explicit overwriteDecision. Review (R-01) tightened this to reuse the SINGLE OverwriteDecision concept the migration path (U1→U4 contract, FR3.3) already defines, so the foundation repair grows one overwrite mechanism, not two parallel ones.

## Deviations
- 2026-09-21T14:48:00Z — Two shared-foundation deltas recorded rather than resolved here (same discipline as U2): (delta A) normal install/update must detect pre-existing target content, return `conflict` writing nothing, and accept the shared OverwriteDecision — U1's install workflow does not; (delta B) source resolution/download on the shared request — same delta U2 recorded. Both must close in the U1 repair at the stage decision.

## Tradeoffs
- 2026-09-21T14:48:00Z — Legacy extension-record import (Q3=A): the extension's InstalledBundle carries no explicit target (implied by installPath) and no repository identity, so the shared key can't be built directly. Review (R-02) added BR3.5 mirroring U2's BR3.4 — resolve target from hint/installPath else the single configured target whose layout holds the files, resolve repo identity from the record's workspace, skip-and-report ambiguity rather than guess.
