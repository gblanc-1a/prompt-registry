# RAID Log: Unified Bundle Installation Migration

## Risks

| ID | Risk | Likelihood | Impact | Response | Owner |
| --- | --- | --- | --- | --- | --- |
| R-001 | ZIP parsing remains layout-specific in one client. | Medium | High | Create one shared root-manifest validator and manifest-relative resolver. | Architecture / Development |
| R-002 | A verified-duplicate check is incomplete and removes distinct data. | Low | Critical | Require identity and content verification; preserve any mismatch. | Development |
| R-003 | An interruption leaves legacy and XDG records inconsistent. | Medium | High | Define idempotent migration state, retry behavior, and write ordering. | Architecture / Development |
| R-004 | Target and repository state cross-contaminate. | Medium | High | Test target and scope isolation across install, update, and uninstall. | Development / QA |

## Assumptions

| ID | Assumption | Validation Needed | Owner |
| --- | --- | --- | --- |
| A-001 | Existing XDG application storage is accessible to both CLI and extension through shared packages. | Confirm the extension can use the shared `AppStorage` boundary without VS Code storage. | Architecture |
| A-002 | Existing extension cache and registry data contains enough information for identity and content verification. | Reverse engineer legacy records and representative installations. | Development |
| A-003 | Target item kinds can unambiguously determine destination paths. | Define and validate the manifest-to-target mapping. | Architecture |

## Issues

| ID | Issue | Impact | Next Action | Owner |
| --- | --- | --- | --- | --- |
| I-001 | The CLI currently assumes a rigid ZIP layout. | Valid bundles can fail installation. | Replace layout assumption with shared root-manifest handling. | Development |
| I-002 | CLI and extension have divergent installation ownership and storage. | Behavior can drift across clients. | Consolidate lifecycle logic in shared packages. | Architecture / Development |

## Dependencies

| ID | Dependency | Why It Matters | Status | Owner |
| --- | --- | --- | --- | --- |
| D-001 | Shared `core`/`infra`/`app` installation boundary | Required to keep CLI and extension behavior aligned. | Available, needs extension adoption | Architecture |
| D-002 | Existing XDG storage resolution | Defines user-scope cache and durable-record locations. | Available | Development |
| D-003 | Target configuration and target writers | Required to route runtime content by target type and scope. | Available, needs consolidation | Development |
| D-004 | Delivery-planning test strategy | Needed to select the acceptance evidence for each pull request. | Pending | Delivery / QA |

## Sources

- [intent-statement](../intent-capture/intent-statement.md) [desc] [Q1] [Q4] [Q8]
- [feasibility-questions](feasibility-questions.md) [Q1] [Q2] [Q3] [Q4] [Q5] [Q6] [Q7] [Q8] [Q9]
- [feasibility-assessment](feasibility-assessment.md) [scope]

## Assumptions & Open Questions

- Transparent migration can become a release metric only after the recovery
  design proves that interrupted and conflicting migrations preserve data. [Q6]
- Per-pull-request verification remains to be selected in delivery planning. [Q5]
