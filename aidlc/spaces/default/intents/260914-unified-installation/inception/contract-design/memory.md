<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
- 2026-09-23T13:10:00Z — Contract amendment closes the second Functional Design review: journal evidence now binds to an immutable entry ID plus generation, destination ownership becomes a durable atomic claim with recovery states, and migration transfer uses the same claim protocol instead of a weaker migration exception.
- 2026-09-23T08:55:00Z — R-01 enforced via a token model (Q8=B) rather than U1 re-verifying inside the transition: U4 supplies a VerificationResultToken minted by verifyManagedArtifacts, and U1 rejects the target-verified transition unless the token binds the exact journal entry, artifact set, and a fresh current-read. Keeps U4 driving the state machine while U1 still gates deletion authority on live evidence.
- 2026-09-23T08:55:00Z — R-02 closed by adding a registry-wide destination-ownership invariant plus a target/scope-scoped collision query (Q9=A); a cross-installation destination conflict returns conflict unless an explicit ownership hand-off token is supplied, and record+artifact updates are atomic. R-03 closed by making target and scope required ManagedInstallation identity attributes (Q10=A).
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-09-15T14:31:59Z — the advisory review identified six contract details that remain open before implementation: U3/U4 call direction, complete shared type definitions, operation-specific result payloads, activation deadline and readiness behavior, filesystem retry and interruption semantics, and repository identity invariants.
