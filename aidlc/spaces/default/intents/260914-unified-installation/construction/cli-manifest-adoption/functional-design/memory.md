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
- 2026-09-21T14:12:00Z — Commit mode is not a CLI special case. The code shows commitMode already lives on core's target definition and the extension exposes it by name (`switchCommitMode`, "excluded via .git/info/exclude"), and default-layouts.json already resolves the Copilot-like targets' repository scope to the workspace `.github` tree. So the special-case RepositoryScopeWriter contributes nothing to destinations; it only (a) selects which repository lockfile holds the record by commit mode and (b) maintains git exclusions. Split accordingly: destinations via shared layout (done), lockfile selection into the shared repository registry adapter (amends U1's "each adapter's file does not move" rule), git exclusion into a small shared port that is a no-op under `commit`.
- 2026-09-21T14:12:00Z — apply and profile activate are CLI composition, not single-bundle lifecycle. First draft wrongly said apply "resolves to install"; apply actually re-activates the active profile across every configured target via runProfileActivation. Framing that survived review: composition (which profile, which targets, hub sync, failure roll-up) stays in the adapter as permitted CLI-specific concern; every (bundle, target) write delegates to the shared single-bundle lifecycle. No new lifecycle rule needed beyond delegation + batch roll-up + commit mode.

## Deviations
- 2026-09-21T14:12:00Z — Two U2 decisions depend on shared-foundation behaviour the U1 functional design does not yet describe, and are recorded as explicit deltas in U2's functional-spec rather than resolved here: (1) source resolution/download on the shared install request (Q4), and (2) commit-mode-aware repository registry + git-exclude port (Q1/Q7). This keeps U2 from being built silently on top of U1's known-broken result vocabulary; both deltas must close in the U1 repair at the stage decision.

## Tradeoffs
- 2026-09-21T14:12:00Z — Legacy user-lockfile import (Q2 = import once): the old CLI user lockfile is keyed by bundleId with no target, but the shared key needs a target. Chose deterministic association (BR3.4): use a recorded target hint, else the single configured target whose user-scope layout contains the entry's managed files, else skip-and-report — mirroring U4's migration association discipline rather than guessing a default target.
