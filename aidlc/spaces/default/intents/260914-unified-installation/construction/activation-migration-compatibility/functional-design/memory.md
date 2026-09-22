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
- 2026-09-21T15:18:00Z — U4 scope was narrowed sharply by the human: migrate only the CURRENT IDE the extension runs as (vscode/vscode-insiders/kiro), at USER scope, discovered from LIVE TARGET LINKS (symlink or copy) that resolve into the legacy cache — not from cache contents or records. The cache proves the source, never the install. Confirmed the extension actually symlinks skills into the target (bundle-installer symlink() with copy fallback), so the model is accurate.
- 2026-09-21T15:18:00Z — State-free is absolute (Q3=A): no MigrationRegistry per-installation flag, no durable outcome store. Each activation re-derives from disk; "done" = legacy source gone. U1's cleanup journal is the only persistence and only while a destructive op is in flight. Scheduling (Q7=A) is inline-before-command-handlers, non-fatal, no time-box — the common case is a no-op so it stays fast.

## Deviations
- 2026-09-21T15:18:00Z — TWO human-confirmed requirement deviations, recorded in functional-spec "Requirement deviations" and traceability, to raise at the stage gate: (FR3.7) repository-scope migration DROPPED — repo installs are carried by the committed lockfile, never migrated from the cache (Q8=A); (FR3.8) versioned association table REINTERPRETED as "current IDE + user scope + live target link" (Q9=A). BR2.2 embodies the FR3.7 exclusion and sits in traceability reverse; FR3.7 row is N/A with reason.
- 2026-09-21T15:18:00Z — Whole unit tagged @migration-cleanup(activation-migration) for wholesale removal once migration is universally complete (Q6=B), unlike U1's finer-grained tagging intent.

## Tradeoffs
- 2026-09-21T15:18:00Z — Review (R-01, Critical) caught that a symlinked target reads byte-identical through the link, so the naive verified-duplicate path would delete the cache and strand a broken symlink. Fixed with BR1.3: a symlink target is always MATERIALIZED via U1 (real files written) before cache+symlink cleanup; only an identical COPY is a true verified duplicate. Copy-form legacySourceRoot located by bundle id against the cache layout, absent → leave copy in place with no cleanup.
- 2026-09-21T15:18:00Z — Shares U3's delta A: depends on the single shared OverwriteDecision (confirmed|declined|unavailable), not a migration-only overwrite mechanism (BR4.3). To close in the U1 repair at the stage decision.
