# Initiative Brief: Unified Bundle Installation Migration

## Intent and Problem

Replace divergent CLI and VS Code extension bundle-installation paths with one
shared, manifest-driven lifecycle. The current CLI path can reject valid ZIP
bundles because it assumes a fixed archive layout, and the two entry points
hold user-level installation data in inconsistent locations.

## Approved Scope

- Shared install, update, and uninstall lifecycle in `packages/core`,
  `packages/infra`, and `packages/app`; CLI and extension remain delivery
  adapters.
- Exactly one archive-root `deployment-manifest.yml`; manifest paths resolve
  relative to that root and item kind selects the target destination.
- Target- and scope-aware runtime installation: Copilot user scope uses
  `~/.copilot`, repository scope uses `${workspaceRoot}/.github`; Kiro uses
  `~/.kiro` and `${workspaceRoot}/.kiro`.
- Shared user cache and durable installation registry remain in the existing
  CLI XDG locations, not runtime target directories.
- One-time extension-data migration preserves target content as authoritative;
  only identity- and content-verified duplicates may be removed, while
  conflicts remain intact and are reported.

## Exclusions

- Moving repository lockfiles or artifacts to user-scope XDG storage.
- Overwriting or deleting non-identical legacy data.
- Fixing a release date, implementation order, migration completion marker,
  recovery sequence, comparison algorithm, or test matrix before detailed
  design and delivery planning.

## Feasibility and Risk

The initiative is technically feasible because the CLI already separates XDG
application storage from target runtime output and the shared packages support
the intended ownership boundary. The principal risks are rigid ZIP assumptions,
target/scope state leakage, data loss during duplicate cleanup, interruption
during migration, and continued extension-side lifecycle ownership.

The approved safeguards are root-manifest validation, target and scope identity
throughout lifecycle operations, idempotent recovery design, authoritative
target data, and identity plus content verification before deletion.

## Delivery Approach

Start with a design pull request defining ownership, compatibility, migration
state, recovery order, comparison rules, and acceptance evidence. Follow with
small implementation pull requests in the dependency order established by
reverse engineering, design, and delivery planning.

## Recommendation

**Go.** Proceed to inception with the scope and safeguards above. Do not enable
automatic legacy cleanup until the detailed migration state model, recovery
path, and comparison tests are defined and accepted.

## Sources

- [Intent statement](../intent-capture/intent-statement.md)
- [Scope document](../scope-definition/scope-document.md)
- [Intent backlog](../scope-definition/intent-backlog.md)
- [Feasibility assessment](../feasibility/feasibility-assessment.md)
- [Constraint register](../feasibility/constraint-register.md)
- [Approval answers](approval-handoff-questions.md)

## Assumptions & Open Questions

- The existing CLI XDG directories remain the cross-client user-scope storage
  contract.
- Detailed design must resolve migration completion state, interruption
  recovery order, identity/content comparison, compatibility policy, and the
  pull-request test matrix.