## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-09-21T15:10:00Z
**Iteration:** 1

### Review conduct

Conducted inline in the conductor's context (the delegated reviewer launches
without filesystem tools on this harness), against the dispatched bytes, with the
human's standing approval. Independence is weaker than the protocol intends: the
same context authored the artifacts.

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Critical | functional-spec.md > "Activation migration pass" step 3.1; entities.md > LegacyInstallationCandidate.deploymentForm | The symlink deployment form breaks the verified-duplicate path. When the target is a symlink into the legacy cache (the extension's actual mechanism — confirmed in bundle-installer), the target bytes are the cache bytes, so the "target present and byte-identical → verified duplicate → journalled cleanup" branch runs and deletes the legacy cache. That leaves a dangling symlink at the target — the exact opposite of a completed migration. A symlinked target is not a duplicate to clean up; it must be materialized (real bytes written to the target by U1) before the cache is removed. | Split step 3.1 by deploymentForm: a `symlink` candidate always transfers through U1 to materialize real target files, and only then cleans up the cache and the symlink; only a `copy` candidate whose bytes match is a true verified-duplicate. Add a rule making this explicit. | New |
| R-02 | Major | entities.md > LegacyInstallationCandidate (legacySourceRoot, deploymentForm=copy) | `legacySourceRoot` is defined as "the legacy cache location the target link resolves into," which is well-defined for a symlink but not for a copy — a copy does not resolve anywhere. For a copy-form candidate the workflow has no stated way to locate the legacy cache source it must verify against and clean up. | Define how a copy-form candidate's legacy source is identified (e.g. by bundle id against the legacy cache layout), or state that copy-form candidates without a resolvable legacy source are transferred-and-left (no cache cleanup) with a reason. | New |
| R-03 | Minor | entities.md > CurrentTargetContext.targetType; functional-spec.md step 1 | "The IDE the extension is currently running as" is asserted but not specified, and it is load-bearing (it is the entire association rule). VS Code, VS Code Insiders, Cursor, and Kiro all present as VS Code-family hosts; how `targetType` is resolved among them determines which legacy content is in scope. | State how the current target type is determined from the running host (e.g. host app id / product name mapping to a SupportedTarget), and what happens when it maps to no supported target. | New |
| R-04 | Minor | traceability.json > FR3.7, BR2.2; functional-spec.md > "Requirement deviations" | The FR3.7 (repository-scope) and FR3.8 (association) deviations are human-confirmed (Q8/Q9) and recorded consistently — FR3.7 is `N/A` with reason, BR2.2 enforces the exclusion and sits in `reverse`, and the spec's deviation section names both. This is sound and traceable; the only gap is that the FR3.6 acceptance criteria mention repository-scope parity indirectly via "resolved target and scope" — confirm no retained FR3.6 wording assumes a repository path U4 no longer handles. | Confirm the FR3.6 coverage is user-scope only in wording, or note the repository portion as carried by the deviation. Not blocking. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability (manual cross-check of traceability.json against rules.md) | PASS on orphans: all 17 rules (BR1.1–BR6.2) are covered or explained — BR2.2 is correctly in `reverse` as the FR3.7-deviation rule; every other rule appears as an OK target; FR3.7 is `N/A` with reason. | No orphan rules; the deviation is represented correctly. |
| upstream-coverage (against requirements.md, story map) | PARTIAL by design: every FR the story map assigns to U4 (FR3–FR3.8) plus NFR1.1/NFR2/NFR4 is present; FR3.7 is a confirmed, recorded deviation rather than a silent gap. | Assigned set complete; one intentional deviation. |
| linter, type-check | NOT APPLICABLE | YAML source-of-truth and mermaid only; no TS/JS snippet; design-stage snippet limit respected. |
| required-sections | NOT ARMED | No stage template supplied under the team's memory/templates/. |

### Summary

The state-free design is right and consistent — no durable per-installation state,
re-derivation from disk, journalled cleanup via U1, and the two requirement
deviations are human-confirmed and cleanly traced. What blocks readiness is the
deployment-form handling: a symlinked target reads as a byte-identical duplicate,
so the cleanup path would delete the cache and strand a broken symlink (R-01,
Critical), and the copy form has no defined legacy-source derivation (R-02). Both
are concrete and local to the discovery/transfer branch.
