<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->


- 2026-09-25T07:54:15Z — U1 is a `library` unit, so only security-requirements, tech-stack-decisions and traceability apply here; performance/scalability/reliability/observability artifacts are kind-gated to `service`/`ui` and are not produced for this unit. Scoped the question set to security posture and technology selection accordingly rather than writing artifacts the unit kind excludes.
<!-- aidlc-wave-memory:shared-installation-foundation:2a59cd49cfe232c2c928d5eae11bf0336655a353fd6eea2a7e54b90b9bfaa068 -->


- 2026-09-25T11:58:02Z — U2 is a delivery adapter, so its NFR scope is bounded to secure argv/lockfile handling, diagnostic presentation, exit semantics, and delegation integrity. Target-write, archive, ownership, and cleanup controls remain U1 responsibilities rather than being duplicated here.
<!-- aidlc-wave-memory:cli-manifest-adoption:0b72e00c2fa202304f8c701cd4e2606ddc60d042ce74d4f342665d458b11dd47 -->


- 2026-09-25T13:47:57Z — U3 is a thin VS Code delivery adapter. Its NFR work covers UI presentation, cancellation, AppStorage isolation, and avoiding cache resurrection; target content, overwrite enforcement, source resolution, and registry mutation remain U1-owned responsibilities.
<!-- aidlc-wave-memory:vscode-shared-lifecycle-adoption:75127f6a9b473c740a007652ce79136ea638dcc6ad9fe2ac8f751f73f186f7f2 -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->


- 2026-09-25T07:54:15Z — Presented the two follow-up questions (Q2a, Q3a) as one batch with two recorded decisions, but only one answer receipt could be written: the human-presence guard treats one reply as one turn and the first `log answer` consumed it. The questions file carries both committed choices and the summary-confirmation receipt digests it, so traceability holds. Logged as AIDLC-ISSUE-031.
<!-- aidlc-wave-memory:shared-installation-foundation:077bfe38b4440597dc511698a256206d918ac47c16f40c648c431e7bb223312f -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->

- 2026-09-25T07:54:15Z — ASM3 (activation can inspect legacy data without blocking activation indefinitely) and the contract-design open question about an activation-time latency budget both belong to the U3/U4 activation boundary, not to U1. Since this library unit produces no performance-requirements document, the budget must be settled in the activation-migration-compatibility unit's NFR pass; flagging so it is not lost.
<!-- aidlc-wave-memory:shared-installation-foundation:0ecae702cd93a23b47131b82db4a564040e1e5c3fdf136d58beb480152ff973a -->
