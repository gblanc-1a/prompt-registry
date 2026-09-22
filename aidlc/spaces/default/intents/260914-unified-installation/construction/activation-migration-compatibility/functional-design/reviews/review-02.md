## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-21T15:18:00Z
**Iteration:** 2

### Review conduct

Conducted inline in the conductor's context (the delegated reviewer launches
without filesystem tools on this harness), against the revised bytes, with the
human's standing approval. Independence is weaker than the protocol intends; the
human accepted this when choosing to push the remaining units forward.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | functional-spec.md > step 3.1; rules.md > BR1.3; entities.md > deploymentForm | Resolved. Step 3.1 now branches on `deploymentForm`: a `symlink` target is explicitly NOT a duplicate — it is materialized through U1 (real files written) before the cache and redundant symlink are cleaned up — and only a `copy` whose bytes match is a verified duplicate. New rule BR1.3 forbids removing the cache while the target is still a symlink, and the result-semantics table reflects the materialize path. The broken-symlink hazard is closed. | Resolved | Resolved |
| R-02 | Major | entities.md > LegacyInstallationCandidate.legacySourceRoot | Resolved. `legacySourceRoot` is now optional: for a symlink it is the resolved cache location (always present); for a copy it is located by bundle id against the legacy cache layout when it exists, and absent otherwise — in which case the copy is left in place with no cache cleanup. The copy-form source derivation is defined. | Resolved | Resolved |
| R-03 | Minor | functional-spec.md > step 1; rules.md > BR2.4; entities.md > targetType | Resolved. Step 1 and new rule BR2.4 resolve the current target from the running host's application identity mapped to a `SupportedTarget` via U1 routing, and an unmapped host (or one with no user-scope layout) ends the pass with nothing touched. | Resolved | Resolved |
| R-04 | Minor | traceability.json > FR3.6; functional-spec.md > deviations | Resolved. FR3.6 now targets BR1.3/BR4.1/BR5.2 — all user-scope operations — and the deviation section states repository scope is carried by the committed lockfile, so no retained FR3.6 wording assumes a repository path U4 no longer handles. | Resolved | Resolved |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability (manual cross-check of traceability.json against rules.md) | PASS: all 19 rules (BR1.1–BR6.2, incl. new BR1.3, BR2.4) are covered or explained; BR2.2 remains correctly in `reverse` as the FR3.7-deviation rule; FR3.7 is `N/A` with reason; every other FR/NFR row is `OK`. | No orphan rules; deviations represented correctly. |
| upstream-coverage (against requirements.md, story map) | PASS by design: FR3–FR3.8 and NFR1.1/NFR2/NFR4 present; FR3.7 a confirmed recorded deviation, not a silent gap. | Assigned set complete; one intentional deviation. |
| linter, type-check | NOT APPLICABLE | YAML source-of-truth and mermaid only; no TS/JS snippet; design-stage snippet limit respected. |
| required-sections | NOT ARMED | No stage template supplied under the team's memory/templates/. |

### Summary

Both blocking findings and the two minors are resolved. The deployment-form
distinction — materialize a symlinked target before cache cleanup, treat only an
identical copy as a duplicate — closes the broken-symlink hazard, and the copy-form
source, host-to-target resolution, and user-scope FR3.6 wording are now specified.
The state-free design and the two human-confirmed deviations (FR3.7 dropped, FR3.8
reinterpreted) are consistent and cleanly traced. READY.
