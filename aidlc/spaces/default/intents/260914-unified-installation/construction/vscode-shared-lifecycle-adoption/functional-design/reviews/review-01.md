## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-21T14:40:00Z
**Iteration:** 1

### Review conduct

Conducted inline in the conductor's context (the delegated reviewer launches
without filesystem tools on this harness), against the dispatched bytes, with the
human's standing approval. The independence guarantee is weaker than the protocol
intends: the same context authored the artifacts.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | construction/vscode-shared-lifecycle-adoption/functional-design/functional-spec.md > "Dependencies on the shared foundation (contract deltas)" delta A; "Conflict interaction" | Delta A introduces an overwrite-decision-on-normal-install mechanism (conflict → prompt → re-invoke with overwriteDecision). The migration path already has one: FR3.3 and the U1→U4 contract's `OverwriteDecision {confirmed, declined, unavailable}`. Left as written, the foundation repair could grow two parallel overwrite mechanisms — one for migration, one for normal install — with the same shape and different call sites. | State that delta A must reuse the single `OverwriteDecision` concept the migration path already defines (one overwrite mechanism on the shared lifecycle, consumed by both the extension prompt and U4), not a parallel one. Record it that way in the delta. | New |
| R-02 | Major | functional-spec.md > "Legacy extension-record import workflow" step 2; rules.md (no rule) | The import "derives its shared installation key (bundle, target, scope, repository identity)" from each legacy extension record, but the extension's `InstalledBundle` record carries no explicit target field (target is implied by `installPath`), and repository identity is not stored on it. As in the U2 review (R-02), the shared key cannot be built from the legacy record without a stated derivation, and no rule governs it. | Add a rule (mirroring U2's BR3.4) stating how target and repository identity are resolved for a legacy extension record — from a recorded hint / installPath, else the configured target whose layout contains the record's files — and skip-and-report an ambiguous record rather than guessing. | New |
| R-03 | Minor | functional-spec.md and entities.md (result type) | Naming drift: the spec and entities use `LifecycleOutcome` while Contract Design (contract 2) names the returned type `LifecycleResult`. U2's design added a one-line note reconciling the two; U3 has none. | Add the same one-line naming note U2 carries, deferring the single-name decision to the foundation repair. | New |
| R-04 | Minor | functional-spec.md (no "unit scope" section); traceability + rules coverage of Q6=C | Q6 was answered C — "every extension surface that reads or writes the bundle cache, the extension registry, or the target tree" — which the summary expands to include the marketplace view and (by implication) auto-update/update-checker. But the rules only govern the registry tree (BR5.2); the marketplace view and auxiliary readers are named in scope with no rule stating they adopt the read-only projection. The scope claim is broader than the rules cover. | Either add a rule that every installation-state reader adopts the shared-registry projection (BR3.2), naming the marketplace view and auto-update readers, or narrow the stated scope and defer those readers with a rationale. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability (manual cross-check of traceability.json against rules.md) | PASS on orphans: all 13 rules (BR1.1–BR5.2) appear as coverage targets; every FR row is `OK`; `reverse` correctly empty. | No orphan rules; the gaps are in rule completeness (R-02, R-04), not coverage of existing rules. |
| upstream-coverage (against requirements.md, story map) | PASS: U3 has no primary FR; the cross-cutting FRs the story map assigns to it (FR1, FR1.2, FR2.1, FR2.2) are all present and `OK`. | Assigned set complete. |
| linter, type-check | NOT APPLICABLE | YAML source-of-truth and mermaid only; no TS/JS snippet; design-stage snippet limit respected. |
| required-sections | NOT ARMED | No stage template supplied under the team's memory/templates/. |

### Summary

The migration stance is right and matches both ADRs — cache-then-sync retired,
`AppStorage` for shared data (ADR-0005), the extension registry reduced to a
read-only projection over the shared registry (ADR-0001 strangler-fig), and
messaging derived from the shared result kind. Two things block readiness: delta A
risks a second overwrite mechanism parallel to the migration one and should be
stated as reusing the single shared concept, and the legacy-record import repeats
U2's key-derivation gap without the rule U2 added to close it. The two minors are
quick consistency fixes.
