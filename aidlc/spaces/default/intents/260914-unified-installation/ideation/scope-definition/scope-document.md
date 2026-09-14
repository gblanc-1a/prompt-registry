# Scope Definition: Unified Bundle Installation Migration

## Outcome

CLI and VS Code extension users have one reliable, consistent bundle
installation experience. Both entry points use the same manifest-driven
lifecycle and resolve runtime content from the selected target and installation
scope using the established target layouts; shared application records remain
in the established XDG locations. [intent] [CON-001] [CON-003]

## In Scope

- One shared lifecycle for install, update, and uninstall that both the CLI
  and VS Code extension use. [intent] [CON-002] [CON-008]
- Validation of ZIP bundles through exactly one root
  `deployment-manifest.yml`, with archive-relative manifest paths and
  destination selection based on item kind. [CON-001] [Q1]
- Target-aware runtime installation for both user and repository scope. For
  example, VS Code and Copilot CLI use `~/.copilot` at user scope and
  `${workspaceRoot}/.github` at repository scope; Kiro uses `~/.kiro` at user
  scope and `${workspaceRoot}/.kiro` at repository scope. The selected target
  layout remains the source of truth. [layouts]
- Shared user-scope bundle cache and installation registry ownership through
  the existing CLI XDG cache and data locations. [CON-003] [Q4] [Q8]
- Target- and scope-aware lifecycle behavior so operations for one supported
  target cannot alter another target's artifacts or state. [intent] [CON-004]
- A one-time, automatic migration of extension-managed installation data to
  the shared lifecycle at either scope. Existing content at the selected
  target location is authoritative. A legacy duplicate is removed only after
  identity and content verification; a non-identical copy is preserved and
  reported as a conflict. [CON-006] [CON-007]
- A reviewable delivery plan consisting of a design pull request followed by
  small implementation pull requests. The implementation order will follow
  detailed design and dependency analysis. [intent] [Q1]

## Out of Scope

- Moving repository lockfiles or repository artifacts out of their repository
  scope and into user-scope XDG storage. [CON-005]
- Making a runtime target location the owner of download caches or the shared
  installation registry. [CON-003]
- Automatically overwriting or deleting non-identical legacy data.
  [CON-006] [CON-007]
- Defining the exact migration completion marker, interruption recovery
  sequence, or identity/content comparison algorithm before detailed design.
  [CON-009]
- Selecting the implementation pull-request test matrix before delivery
  planning. [CON-010]
- Committing to a fixed release date or implementation sequence before the
  architecture and dependency analysis completes. [Q1] [Q2]

## Scope Boundaries

| Boundary | Decision | Evidence |
| --- | --- | --- |
| Archive acceptance | One root manifest; manifest paths are archive-relative. | CON-001 |
| Runtime delivery | Item kind routes content to the selected target root for the requested user or repository scope. | CON-002; layouts |
| User application data | Shared cache and registry use the existing CLI XDG locations. | CON-003 |
| Repository data | Lockfiles and installed artifacts remain in the repository at the selected target's repository layout. | CON-005; layouts |
| Existing target data | The selected target location is authoritative during migration. | CON-006 |
| Legacy duplicates | Remove only verified identical copies; preserve and report conflicts. | CON-007 |

## Delivery Principles

- Start with a design pull request that establishes shared ownership,
  compatibility, migration safety, and review boundaries.
- Follow with independently reviewable implementation pull requests whose
  ordering is derived from the approved dependency analysis.
- With no fixed delivery deadline, prioritize a safe migration and lasting
  removal of duplicated lifecycle rules over a standalone short-term patch.
  [Q2]

## Success Criteria

| ID | Criterion |
| --- | --- |
| SC-01 | The CLI and VS Code extension use the same installation lifecycle for valid bundles. |
| SC-02 | A valid ZIP with a root `deployment-manifest.yml` installs without a hardcoded internal archive path. |
| SC-03 | Runtime content is installed at the selected target's user or repository layout; shared cache and registry data retain their established owners. |
| SC-04 | Install, update, and uninstall maintain target and scope isolation. |
| SC-05 | Existing extension-managed user data can migrate safely: verified duplicates are cleaned up, conflicts are preserved and reported, and retry after interruption is safe. |
| SC-06 | The work is delivered through a design pull request followed by small, reviewable implementation pull requests. |

## Open Decisions

- Specify an idempotent migration state model and interruption-recovery order.
- Define verification criteria for duplicate identity and content.
- Confirm whether any CLI or extension compatibility break is justified by the
  final architecture.
- Define the pull-request-level unit, integration, and migration test matrix.

## Traceability

| Scope item | Sources |
| --- | --- |
| Shared lifecycle and manifest-driven archive handling | intent-statement; CON-001; CON-002; CON-008 |
| XDG ownership and target isolation | intent-statement; CON-003; CON-004; CON-005 |
| Target-aware runtime layouts and legacy migration | CON-006; CON-007; CON-009; packages/infra/src/writers/default-layouts.json |
| Reviewable delivery sequence | intent-statement; scope-definition-questions Q1-Q2 |
