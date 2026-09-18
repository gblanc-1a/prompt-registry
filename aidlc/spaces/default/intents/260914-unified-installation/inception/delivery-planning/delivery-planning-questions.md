# Delivery Planning Questions

## Sources

- `requirements.md` defines the shared lifecycle, migration safety, compatibility,
  and reviewable-delivery requirements.
- `components.md` defines the shared installation and migration components.
- `unit-of-work.md` defines U1 through U4 and their implementation boundaries.
- `unit-of-work-dependency.md` defines the dependency DAG: U2 and U3 depend on
  U1, and U4 depends on U1 and U3.
- `contract-summary.md` defines the repository-internal TypeScript boundaries,
  typed lifecycle outcomes, and unresolved implementation questions.

## Q1. Which delivery heuristic should determine the order of the planned build passes?

A build pass is one bounded implementation slice that ends with a demonstrable,
tested result. The dependency graph requires U1 before U2/U3 and U3 before U4;
this question chooses the economic reason for selecting the first slice within
those constraints.

- A. Risk-first: prove the shared lifecycle, filesystem safety, and migration recovery risks as early as possible.
- B. Value-first: deliver the CLI and VS Code user-visible adoption as early as possible.
- C. Thin end-to-end slice first: connect the smallest path through U1, one delivery adapter, and the relevant verification boundary before expanding coverage.
- D. Weighted scoring: rank slices using value, urgency, risk reduction, and job size.
- X. Other (please specify)

[Answer]: A. Risk-first: start with U1's shared lifecycle correctness, including the highest-risk filesystem and contract behavior, while proving a minimal happy-path install. (2026-09-15T14:55:57Z; **Mode:** chat)

## Q2. How should the four Units of Work be grouped into planned build passes?

The planned passes may differ from the runtime dependency batches, but every pass
must preserve the U1/U2/U3/U4 dependency constraints and have a reviewable
Definition of Done.

- A. One pass per Unit: U1, then U2 and U3 separately, then U4.
- B. U1 as a foundation pass, U2 and U3 together as an adapter pass, then U4 as a migration pass.
- C. A thin end-to-end pass first, followed by focused hardening passes for the remaining Units.
- D. Another grouping across Units; describe the grouping and why it is reviewable.
- X. Other (please specify)

[Answer]: B. Use a foundation pass for U1, an adapter pass for U2 and U3, and a separate migration pass for U4. (2026-09-15T14:55:57Z; **Mode:** chat)

## Q3. Should U2 CLI adoption and U3 VS Code adoption be developed concurrently?

Both adapters depend on U1 but do not depend directly on each other. The answer
sets the delivery coordination stance; it does not permit implementation before
the shared U1 contracts are usable.

- A. Parallel after U1 contracts stabilize: develop U2 and U3 concurrently with shared integration checkpoints.
- B. Sequential: complete U2 first, then use its integration experience to guide U3.
- C. Mostly parallel, with a short shared checkpoint before either adapter is considered complete.
- X. Other (please specify)

[Answer]: C. Develop U2 and U3 mostly in parallel after U1 contracts stabilize, with a shared checkpoint for lifecycle parity, typed result mapping, and integration tests. (2026-09-15T14:55:57Z; **Mode:** chat)

## Q4. What should receive the earliest focused risk treatment?

The current design has known risk around byte-safe filesystem cleanup, typed
result completeness, repository identity, and activation-time migration
readiness. Selecting the priority determines what the first pass must prove and
what may remain as a documented follow-up.

- A. Shared lifecycle correctness: manifest validation, routing, registry isolation, safe writes, update, and uninstall.
- B. Migration safety: target authority, explicit overwrite consent, verified cleanup, restartability, and repository association.
- C. Adapter compatibility: preserving CLI and VS Code workflows while removing duplicate lifecycle policy.
- D. Contract completeness: resolving the review findings before implementation, including result payloads and activation readiness.
- X. Other (please specify)

[Answer]: A. Prioritize shared lifecycle correctness: manifest validation, routing, registry isolation, safe writes, update, and uninstall; resolve contract completeness as an entry criterion. (2026-09-15T14:55:57Z; **Mode:** chat)

## Q5. Are there external dependencies or approval windows that can block delivery?

The implementation is expected to remain inside this repository, with the CLI
and VS Code extension as consumers of shared packages. Record any dependency
that could delay a planned build pass, including its owner, expected timing,
blocked pass, and fallback if it slips.

- A. No external dependency or approval window; all work is repository-contained and AI-executable.
- B. Existing repository or package ownership decisions need an internal review before implementation.
- C. VS Code activation, extension packaging, or release constraints may block migration work.
- D. Another dependency exists; describe its owner, timing, blocked pass, and fallback.
- X. Other (please specify)

[Answer]: A. No external dependency or approval window; all work is repository-contained and AI-executable, with internal review and packaging checks treated as delivery checkpoints. (2026-09-15T14:55:57Z; **Mode:** chat)

## Q6. How should Construction be staffed and gated?

Construction can be run as one in-session sequence with a human approval after
each stage, or as several unit-owning teams only when the work is organized
unit-by-unit. A team-owned plan also needs a choice about whether approval is
requested after every stage or once after the unit's design and code are done.

- A. Build every Unit here in one session, with approval checkpoints as the workflow reaches them.
- B. Use separate teams for Units, organize Construction unit-by-unit, and approve after each stage.
- C. Use separate teams for Units, organize Construction unit-by-unit, and approve once at the end of each Unit.
- D. Use a different staffing or checkpoint model; describe it.
- X. Other (please specify)

[Answer]: A. Build every Unit here in one session with approval checkpoints as the workflow reaches them, using the default stage-major Construction iteration. (2026-09-15T14:55:57Z; **Mode:** chat)

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct
