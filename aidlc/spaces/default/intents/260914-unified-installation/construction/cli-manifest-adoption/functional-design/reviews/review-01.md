## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-21T14:05:00Z
**Iteration:** 1

### Review conduct

The delegated reviewer subagent launches without filesystem tools on this
harness (confirmed twice on the shared-installation-foundation review), so with
the human's standing approval this pass was conducted in the conductor's own
context against the dispatched bytes. The independence guarantee is therefore
weaker than the protocol intends: the same context authored the artifacts. The
human accepted this trade-off when choosing to push the remaining units forward.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | construction/cli-manifest-adoption/functional-design/functional-spec.md > "apply wrapper" | The spec states apply "resolves to the install operation with no distinct behaviour." That is factually wrong. `apply` re-activates the currently active profile across every configured target via `runProfileActivation` — it resolves the active profile from `ProfileActivationStore`, optionally syncs the hub, iterates all targets, and returns exit 1 if any target failed. A developer implementing "apply = install" would destroy the profile-activation feature. It also forces a scope decision the unit never made: profile activation is a multi-bundle, multi-target concern beyond single-bundle lifecycle. | Either specify apply's real workflow (profile resolution, hub sync, per-target activation, its own failure/exit semantics) and its relationship to the shared lifecycle, or explicitly place apply and profile activation out of this unit's scope with a rationale. Remove the "no distinct behaviour" claim. | New |
| R-02 | Major | construction/cli-manifest-adoption/functional-design/functional-spec.md > "Legacy user-lockfile import workflow" step 2; rules.md > BR3.2 | The import "derives its shared installation key" from each legacy entry, but the legacy user lockfile is keyed by bundleId with no per-entry target (the CLI's user lockfile has never carried a target field). The shared installation key needs bundle + target + scope + repository identity (U1 BR3.1). The workflow gives no rule for supplying the missing target/scope, so the key cannot be built without guessing. | State how the key is completed for a legacy entry that lacks a target — e.g. map each legacy user-scope entry to a specific configured target, or import per-configured-target — and record it as a rule. | New |
| R-03 | Minor | construction/cli-manifest-adoption/functional-design/traceability.json > FR1.2, FR2 | FR1.2 and FR2 are marked `N/A` "owned by U1", but the story map lists U2 as a cross-cutting unit for both, whose obligation is to prove its entry points delegate rather than reproduce the behaviour. `N/A` understates that proof obligation. | Mark FR1.2 and FR2 `OK` targeting the delegation rule BR1.1 (U2 proves delegation), rather than `N/A`. | New |
| R-04 | Minor | functional-spec.md and entities.md (result type); contract-summary.md contract 1 | Naming drift: Contract Design names the returned type `LifecycleResult`; U1's entities and this spec call it `LifecycleOutcome`. Both names are used for the same value with no mapping note. | Use one name, or add a one-line note that `LifecycleResult` (contract) is `LifecycleOutcome` (design). Same class as the U1 review's R-11. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability (manual cross-check of traceability.json against rules.md) | PASS on orphans: all 13 rules (BR1.1–BR6.1) appear as coverage targets; `reverse` correctly empty. Accuracy issue on FR1.2/FR2 flagged as R-03. | No orphan rules; the defect is classification accuracy, not coverage. |
| upstream-coverage (against requirements.md, story map) | PARTIAL: FR4 (U2 primary) and the cross-cutting FRs the story map assigns to U2 are all present in upstream_ids. | Assigned set complete. |
| linter, type-check | NOT APPLICABLE | Artifacts carry only YAML source-of-truth and mermaid; no TS/JS snippet; design-stage snippet limit respected. |
| required-sections | NOT ARMED | No stage template supplied under the team's memory/templates/. |

### Summary

The delegation model is sound — the adapter-maps-not-reproduces stance, the
continue-on-failure batch, the exit-code discipline, and the honest separation of
foundation deltas (source resolution, commit-mode registry, git-exclude port) from
U2-owned work are all correct and well argued. What blocks readiness is one factual
error — apply does profile activation, not install — and one implementability gap in
the legacy-lockfile import, where the shared key cannot be derived from the legacy
entry as described. The two minors are quick accuracy fixes.
