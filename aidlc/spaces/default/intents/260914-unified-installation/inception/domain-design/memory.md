## Interpretations
- The shared packages remain the sole home for installation and migration policy; the CLI and VS Code extension remain delivery adapters.
- The active target is authoritative during migration, while XDG application storage owns shared user-scope cache and installation records.

## Deviations

## Tradeoffs
- Separating normal lifecycle execution from migration reconciliation keeps install, update, and uninstall behavior reusable while containing activation-specific comparison and conflict handling.

## Open questions
- Confirm the component boundary between shared lifecycle execution, migration reconciliation, and VS Code conflict presentation.
- Confirm the compatibility posture and managed-artifact identity model before producing the component catalogue.<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
