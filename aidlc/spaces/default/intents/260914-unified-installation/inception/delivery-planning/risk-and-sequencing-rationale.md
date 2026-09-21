# Risk and Sequencing Rationale

## Decision

The sequence is **risk-first** with an explicit small-PR decomposition. A design
pull request fixes the shared contracts first; then U1 (the shared foundation
everything depends on) is built as component-level PRs; then the CLI adapter and,
after it, the VS Code adapter; then the activation-time migration last, with its
file-deleting cleanup isolated in its own separately-reviewed pull request.

The approved order is:

0. Design PR — shared contracts, type/port layout, and migration-cleanup journal
   states.
1. U1 shared installation foundation (PRs for manifest governance, routing,
   registry, install, update/uninstall, and the shared journal contract).
2. U2 CLI adapter adoption.
3. U3 VS Code adapter adoption (after U2).
4. U4 activation migration compatibility (non-destructive transfer, then the
   isolated journaled destructive cleanup, then conflict/consent and
   repository-scope parity).

## Why This Order

U1 has no dependency and owns the only normal target-write lifecycle, so it is
the highest-leverage risk to retire first. A design PR precedes it (FR4.1) so the
four boundary contracts and the shared TypeScript type/port layout are stable
before implementation, keeping every later PR small.

The adapters are serialized rather than run in parallel (the team's chosen
stance): landing the CLI adapter first surfaces any lifecycle-adoption friction
once, and the VS Code adapter then applies those lessons. Both are thin adapters
over U1 and neither depends on the other, so serializing costs little and
simplifies review.

U4 is last because its activation behavior depends on the U3 command-readiness
boundary and because it is the only destructive work. Within U4 the
non-destructive verified transfer (PR 10) precedes the journaled destructive
cleanup (PR 11); isolating the delete in its own PR keeps the risky change small,
separately reviewable, and easy to gate.

## Resolved Upstream Risk

The atomic-or-journaled destructive-cleanup boundary (NFR1.1) that previously
blocked this transition is now designed: Domain Design added the
`MigrationCleanupJournal` port with prepared / target-verified /
legacy-delete-pending / committed states and crash-safe recovery (ADR-003,
ADR-005), and the current `domain-design/traceability.json` records NFR1.1 as
OK. The delivery plan carries that design into U1's journal-contract PR (PR 6)
and U4's cleanup PR (PR 11) as implementation constraints.

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Owner / PR |
| --- | --- | --- | --- | --- |
| Shared contract types or result payloads are incomplete | Medium | High | Fix named types, discriminants, stable reason codes, and conditional repository identity in the design PR before any implementation PR | Architect / PR 0 |
| Filesystem cleanup or interrupted writes leave state inconsistent | Medium | Critical | Journaled destructive cleanup with byte verification, post-cleanup absence check, and restart recovery; isolate it in its own PR | U1/U4 / PRs 6, 11 |
| CLI and VS Code behavior diverges after adoption | Medium | High | Serialize the adapters and run a parity check at the VS Code PR against the same lifecycle scenarios | U2/U3 / PRs 7, 8 |
| Repository-scope identity is missing or ambiguous | Medium | High | Require canonical repository identity; preserve data and report skipped on mismatch or ambiguity | U1/U4 / PRs 3, 13 |
| Activation migration blocks command readiness unpredictably | Medium | High | Define deadline, cancellation, interaction-unavailable, and readiness mapping in the design PR; gate readiness in PR 9 | U3/U4 / PRs 0, 9 |
| Legacy content deleted without complete verification | Medium | Critical | Keep target authoritative, require explicit overwrite consent, compare every managed artifact byte-for-byte, verify post-cleanup absence; destructive cleanup reviewed on its own | U4 / PR 11 |
| A large PR becomes hard to review | Medium | Medium | Component-level PR decomposition for the two large Units (U1, U4); adapters stay one PR each | Delivery lead / all Bolts |

## Alternatives Considered

### Value-first

Shipping the most visible CLI or VS Code adoption first was rejected: adapter
work would depend on an under-specified shared lifecycle and could reproduce the
policy duplication this initiative removes.

### Full walking skeleton first

A walking skeleton — a minimal end-to-end slice touching every layer — was not
made a separate first Bolt because the migration boundary carries the sharpest
filesystem and activation risk; proving a thin U1 happy path first is a safer
foundation. Bolt 1 still includes that happy-path install.

### Formal WSJF scoring

Weighted Shortest Job First (ranking value, urgency, and risk reduction over job
size) was not needed: the dependency graph plus the high-risk shared filesystem
foundation already determine the dominant order, so numeric scores would add
precision without an independent estimate.

### Parallel adapter delivery

Building U2 and U3 concurrently was available (they do not depend on each other)
but the team chose to serialize them for simpler, sequential review; the elapsed-
time saving did not outweigh the added coordination given a single in-session
team.

### One migration PR

Keeping transfer and destructive cleanup in a single U4 PR was rejected: the
delete is the highest-consequence change and is safer to review and gate on its
own, after the non-destructive transfer has landed.

## Sequencing Exit Criteria

Construction may begin once the Inception phase check passes. The previously
open NFR1.1 destructive-cleanup finding is resolved (domain-design traceability
now records NFR1.1 OK), so `verification/phase-check-inception.md` is expected to
read PASS for this pass.
