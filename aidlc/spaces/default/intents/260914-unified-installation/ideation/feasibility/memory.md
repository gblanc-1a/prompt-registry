<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-09-14T15:34:19Z — treated XDG storage as the shared application boundary; the CLI already separates cached bundles and durable installation records from target runtime output, so `~/.copilot` and `~/.kiro` remain target roots rather than registry roots.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-09-14T15:34:19Z — chose automatic cleanup only for identity- and content-verified legacy duplicates; preserving non-identical data prevents loss at the cost of reporting conflicts for later resolution.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-09-14T15:34:19Z — define the migration completion marker and recovery ordering before committing to transparent migration as a release success metric.
- 2026-09-14T15:34:19Z — select per-pull-request migration and integration test evidence during delivery planning.
