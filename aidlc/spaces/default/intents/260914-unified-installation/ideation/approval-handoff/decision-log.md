# Ideation Decision Log

| Decision | Status | Basis |
| --- | --- | --- |
| Use one shared manifest-driven lifecycle for install, update, and uninstall. | Approved | Intent, scope, and Q1 |
| Require exactly one root `deployment-manifest.yml` and archive-relative manifest paths. | Approved | CON-001 |
| Route runtime output by selected target and user/repository scope. | Approved | CON-002, CON-004, CON-005 |
| Keep user cache and durable registry in the existing CLI XDG locations. | Approved | CON-003 |
| Treat selected target data as authoritative during extension-data migration. | Approved | CON-006 |
| Remove legacy duplicates only after identity and content verification; preserve and report conflicts. | Approved | CON-007 |
| Keep common lifecycle code free of VS Code dependencies. | Approved | CON-008 |
| Deliver a design pull request followed by small implementation pull requests. | Approved | Scope and Q3 |
| Treat market research, staffing analysis, and rough mockups as unnecessary for this internal migration. | Approved | Q5 |
| Specify migration completion, recovery ordering, comparison algorithm, compatibility policy, and test matrix in detailed design. | Deferred | Q4, CON-009 through CON-011 |

## Sources

- [Scope document](../scope-definition/scope-document.md)
- [Constraint register](../feasibility/constraint-register.md)
- [Approval answers](approval-handoff-questions.md)

## Assumptions & Open Questions

None beyond the decisions explicitly deferred above.