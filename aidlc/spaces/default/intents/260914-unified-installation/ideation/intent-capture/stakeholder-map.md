# Stakeholder Map

## Stakeholders

| Stakeholder | Interest | Source |
| --- | --- | --- |
| CLI maintainers | A single reliable, manifest-driven installation path that handles valid bundle ZIP structures. | [Q1] [Q4] [Q5] |
| VS Code extension maintainers | Shared lifecycle behavior and a transparent migration from existing extension-held installations. | [Q5] [Q8] |
| Users of the CLI and VS Code extension | Consistent user-level Copilot installation behavior and continued ability to update or uninstall their bundles. | [Q2] [Q3] [Q8] |
| Requestor | Final authority for migration scope and pull-request sequencing. | [Q6] |

## Decision Roles

| Decision area | Decision-maker | Influencers | Source |
| --- | --- | --- |
| Scope and pull-request sequencing | Requestor | CLI maintainers, VS Code extension maintainers, and affected users | [Q5] [Q6] |
| Compatibility policy | Unknown (open question) | CLI maintainers, VS Code extension maintainers, and affected users | [Q5] [Q9] |

## Communication Requirements

| Requirement | Source |
| --- | --- |
| Use a design pull request followed by implementation pull requests. | [Q7] |
| Keep every target isolated at both user and repository scope when communicating or reviewing lifecycle changes. | [Q8] |

## Assumptions & Open Questions

- The final compatibility decision, including whether either entry point may break, will be made during feasibility and architecture work. [Q9]