# Team Allocation

## Operating Model

This delivery plan uses one in-session sequence rather than separate unit-owning
teams. Each **mob** is the active group working together on one delivery slice;
here the practical mob is the delivery lead in this session, with the developer
execution role and architect perspective available at the relevant checkpoints.

The plan keeps the default stage-major Construction iteration and the workflow's
stage-level approval gates. No independent team approval or unit-end gate is
introduced.

## Bolt Ownership

| Bolt | Unit(s) | Primary owner | Supporting perspective | Working mode | Approval point |
| --- | --- | --- | --- | --- | --- |
| Bolt 1: Shared lifecycle foundation | U1 | `aidlc-developer-agent` | `aidlc-architect-agent` for contracts, boundaries, and risk closure | One in-session mob | Each active Construction stage |
| Bolt 2: CLI and VS Code adapter adoption | U2 and U3 | `aidlc-developer-agent` | `aidlc-architect-agent` at the shared adapter checkpoint | Mostly parallel work slices after U1 contracts stabilize | Each active Construction stage and shared parity checkpoint |
| Bolt 3: Activation migration compatibility | U4 | `aidlc-developer-agent` | `aidlc-architect-agent` for migration safety and readiness boundary | One in-session mob after U3 completion | Each active Construction stage |

## Responsibilities

### Delivery lead

- Keeps the sequence aligned with the approved dependency graph.
- Maintains the Definitions of Done and confidence hypotheses.
- Holds U2 and U3 at the shared checkpoint until lifecycle parity is shown.
- Escalates the phase-check blocker before Construction begins.

### Developer execution role

- Implements the Units in the approved Bolt order.
- Adds focused tests at each changed boundary.
- Preserves the Clean Architecture dependency direction.
- Reports typed lifecycle and migration outcomes through the delivery adapters.

### Architect perspective

- Resolves shared contract and repository-identity questions before U1 coding.
- Checks that U2 and U3 remain thin adapters.
- Reviews the U4 safety, retry, cleanup, and activation-readiness design.

## Coordination Checkpoints

- **U1 readiness:** Complete the shared type/result, repository identity, retry,
  and activation-boundary contract constraints before adapter implementation.
- **Adapter parity:** Compare CLI and VS Code behavior for install, update,
  uninstall, target/scope isolation, and typed outcome mapping.
- **Migration readiness:** Do not begin U4 until U3 command readiness and the
  shared lifecycle transfer path are stable.
- **Stage gates:** Use the normal workflow approval after each applicable
  Construction stage; no separate team-owned gate is required.
