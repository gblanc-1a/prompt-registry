# Team Allocation

## Operating Model

This plan runs as one in-session sequence rather than separate unit-owning
teams. A **mob** here — the group working together on one slice — is the
delivery lead in this session, with the developer execution role doing the
implementation and the architect perspective consulted at the boundary and
migration-safety checkpoints. There is no separate **Program Board** (the
multi-team coordination view) because only one team is involved.

The plan keeps the default stage-major Construction iteration and the workflow's
stage-level approval gates. No independent team approval or unit-end gate is
introduced.

## Bolt & PR Ownership

| Bolt | Unit(s) / PRs | Primary owner | Supporting perspective | Working mode | Approval point |
| --- | --- | --- | --- | --- | --- |
| Bolt 0: Shared design | U1 design — PR 0 | `aidlc-architect-agent` | `aidlc-delivery-agent` for sequencing | One in-session mob | Design PR review |
| Bolt 1: Shared foundation | U1 — PRs 1–6 | `aidlc-developer-agent` | `aidlc-architect-agent` for contracts, boundaries, journal contract | One in-session mob | Each active Construction stage; each PR review |
| Bolt 2: CLI adapter | U2 — PR 7 | `aidlc-developer-agent` | `aidlc-architect-agent` for thin-adapter conformance | One in-session mob | Each active Construction stage; PR review |
| Bolt 3: VS Code adapter | U3 — PR 8 | `aidlc-developer-agent` | `aidlc-architect-agent` for parity check | One in-session mob after U2 | Each active Construction stage; PR review |
| Bolt 4: Activation migration | U4 — PRs 9–13 | `aidlc-developer-agent` | `aidlc-architect-agent` for migration safety, journal use, readiness boundary | One in-session mob after U3 | Each active Construction stage; PR review, with the destructive-cleanup PR reviewed on its own |

## Responsibilities

### Delivery lead

- Keeps the sequence aligned with the approved dependency graph.
- Maintains the Definitions of Done, confidence hypotheses, and PR boundaries.
- Holds the destructive-cleanup PR until its non-destructive transfer PR is in.
- Confirms the Inception phase check is passing before Construction begins.

### Developer execution role

- Implements the Units in the approved Bolt and PR order.
- Keeps each PR small, independently reviewable, and green.
- Adds focused tests at each changed boundary.
- Preserves the Clean Architecture dependency direction and reports typed
  lifecycle and migration outcomes through the delivery adapters.

### Architect perspective

- Owns the design PR (contracts, type/port layout, journal states, ADRs).
- Checks that U2 and U3 remain thin adapters over the shared lifecycle.
- Reviews the U4 transfer, journaled cleanup, retry, and activation-readiness
  design, with extra scrutiny on the destructive-cleanup PR.

## Coordination Checkpoints

- **Design merged:** the design PR (contracts, types, journal states) merges
  before any implementation PR.
- **Foundation ready:** U1 PRs 1–6 land before adapter work.
- **Adapter parity:** compare CLI and VS Code behavior for install, update,
  uninstall, target/scope isolation, and typed outcomes at PR 8.
- **Migration readiness:** do not begin U4 until U3 command readiness and the
  shared transfer path are stable; review the destructive-cleanup PR on its own.
- **Stage gates:** use the normal workflow approval after each applicable
  Construction stage; no separate team-owned gate is required.
