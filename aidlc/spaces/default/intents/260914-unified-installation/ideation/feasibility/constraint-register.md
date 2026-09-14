# Constraint Register: Unified Bundle Installation Migration

| ID | Category | Constraint | Design Consequence | Status |
| --- | --- | --- | --- | --- |
| CON-001 | Archive compatibility | Every accepted ZIP must contain exactly one root `deployment-manifest.yml`. Manifest paths are archive-relative. | Validation cannot depend on a wrapping directory or a hardcoded archive layout. | Confirmed |
| CON-002 | Target routing | Item kind determines its runtime destination in the selected target. | Manifest interpretation and target writing must be shared across CLI and extension. | Confirmed |
| CON-003 | Storage ownership | User cache uses existing CLI XDG cache storage; durable user installation records use existing CLI XDG data storage. | Do not move cache or registry ownership into `~/.copilot` or `~/.kiro`. | Confirmed |
| CON-004 | Target isolation | User and repository operations must not affect another target's artifacts or state. | Scope and target identity must be present in registry, writer, update, and uninstall paths. | Confirmed |
| CON-005 | Repository ownership | Repository lockfiles and repository artifacts remain under the repository root. | Do not migrate repository records into user XDG storage. | Confirmed |
| CON-006 | Compatibility | `~/.copilot` is authoritative when it conflicts with extension-managed data. | Preserve target data; never overwrite it during migration. | Confirmed |
| CON-007 | Deletion safety | An extension duplicate can be removed only after identity and content verification. | Preserve non-identical copies as conflicts and report automatic cleanup. | Confirmed |
| CON-008 | Architecture | Common logic must stay free of VS Code dependencies. | Keep VS Code UI and workspace integration in the extension; move lifecycle rules into shared packages. | Confirmed |
| CON-009 | Recovery | Migration must safely tolerate interruption and retry. | Design idempotent migration state and ordering before enabling transparent cleanup. | Open |
| CON-010 | Evidence | Pull-request acceptance evidence is not yet selected. | Delivery planning must define focused unit, integration, and migration coverage. | Open |
| CON-011 | Success criteria | Transparent migration is not yet a confirmed release metric. | Resolve after the recovery and conflict design is complete. | Open |

## Sources

- [intent-statement](../intent-capture/intent-statement.md) [desc] [Q8]
- [feasibility-questions](feasibility-questions.md) [Q1] [Q2] [Q3] [Q4] [Q5] [Q6] [Q7] [Q8] [Q9]
- [feasibility-assessment](feasibility-assessment.md) [scope]

## Assumptions & Open Questions

- The existing CLI XDG directories are available to the extension through the
  shared storage abstraction. [assumption]
- The exact identity and content-verification algorithm remains a design
  decision. [Q7] [Q9]
