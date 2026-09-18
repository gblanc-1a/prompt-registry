# Risk and Sequencing Rationale

## Decision

The sequence is risk-first. The first pass hardens U1 because it owns the
shared lifecycle and the filesystem behaviors on which both delivery surfaces
and migration depend. The plan uses a small happy-path install inside U1 to
make the foundation demonstrable without pretending that the first pass is a
complete end-to-end migration.

The approved order is:

1. U1 shared installation foundation.
2. U2 CLI and U3 VS Code shared-lifecycle adoption, mostly in parallel after
   U1 contracts stabilize.
3. U4 activation migration compatibility after U3 reaches the shared adapter
   checkpoint.

## Why This Order

U1 has no dependency and supplies the only normal target-write lifecycle. U2
and U3 depend on it but are independent of each other, so parallel adapter work
reduces elapsed time after the shared contract is stable. U4 depends on both U1
and the U3 activation/readiness boundary, so starting it earlier would couple
migration behavior to an unstable delivery surface.

The sequence also addresses the six concerns raised during Contract Design:
complete cross-boundary types, U3/U4 call direction, typed result payloads,
activation readiness, filesystem retry and interruption behavior, and repository
identity invariants. These are U1 readiness constraints or explicit U4 risks,
not reasons to duplicate lifecycle policy in an adapter.

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner / pass |
| --- | --- | --- | --- | --- |
| Shared contract types or result payloads are incomplete | High | High | Resolve named types, discriminants, stable reason codes, affected artifacts, and conditional repository identity before adapter coding | U1 / Bolt 1 |
| Filesystem cleanup or interrupted writes leave state and artifacts inconsistent | High | Critical | Define atomic or journaled boundaries, re-read current state on retry, verify bytes before deletion, and add failure-path tests | U1 and U4 / Bolts 1 and 3 |
| CLI and VS Code behavior diverges after adoption | Medium | High | Run both adapters against the same lifecycle scenarios and hold the shared parity checkpoint before U4 | U2/U3 / Bolt 2 |
| Repository-scope identity is missing or ambiguous | Medium | High | Require canonical repository identity for repository scope and preserve data on mismatch or ambiguity | U1 and U4 / Bolts 1 and 3 |
| Activation migration blocks command readiness unpredictably | Medium | High | Define deadline, cancellation, interaction-unavailable, retry, and readiness mapping before U4 implementation | U3/U4 / Bolts 2 and 3 |
| Legacy content is deleted without complete verification | Medium | Critical | Keep target authoritative, require explicit overwrite consent, compare every managed artifact byte-for-byte, and verify post-cleanup absence | U4 / Bolt 3 |
| Contract review concerns remain accepted without implementation constraints | Medium | High | Carry each concern into U1/U4 Definitions of Done and re-check before Construction transition | Delivery lead / pre-Construction check |

## Alternatives Considered

### Value-first

This would put the most visible CLI or VS Code adoption first. It was rejected
because adapter work would depend on an under-specified shared lifecycle and
could reproduce the very policy duplication this initiative is removing.

### Full walking skeleton first

A walking skeleton is a minimal end-to-end slice touching every architectural
layer. It was not selected as a formal first Bolt because the migration boundary
has unresolved filesystem and activation semantics; proving a thin U1 happy path
first gives a safer foundation for the later adapter and migration slices.

### Formal WSJF scoring

Weighted Shortest Job First would rank value, urgency, risk reduction, and job
size. It was not needed because the dependency graph and the high-risk shared
filesystem foundation already determine the dominant order; adding numerical
scores would create precision without a meaningful independent estimate.

### Fully sequential adapter delivery

Completing U2 before U3 would reduce concurrent coordination but delay the
second delivery surface and lose the opportunity to test parity while both
adapters are being changed. Mostly parallel delivery with one shared checkpoint
keeps the concurrency bounded.

## Sequencing Exit Criteria

Construction may begin only after the Inception phase check is passing. The
current traceability report still contains a Partial NFR1.1 finding for the
atomic or journaled destructive-cleanup boundary; that finding is recorded in
`verification/phase-check-inception.md` and blocks the transition until its
owning design is resolved.
