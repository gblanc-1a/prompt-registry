# Units Generation Questions

## Sources

- [components] `aidlc/spaces/default/intents/260914-unified-installation/inception/domain-design/components.md`
- [decisions] `aidlc/spaces/default/intents/260914-unified-installation/inception/domain-design/decisions.md`
- [requirements] `aidlc/spaces/default/intents/260914-unified-installation/inception/requirements-analysis/requirements.md`

## Q1. How should this work be divided into independently reviewable units?

The change spans shared package policy, the CLI entry point, the VS Code
extension lifecycle bridge, and activation-time legacy reconciliation. The
units need to support small pull requests without retaining a second install,
update, or uninstall path.

- A. Use four units: shared installation foundation; CLI manifest adoption;
  VS Code shared-lifecycle adoption; and activation migration compatibility.
  The last unit is temporary extension integration over shared lifecycle and
  migration contracts, rather than a new extension-owned lifecycle.
- B. Use three units: shared installation foundation; both delivery adapters;
  and activation migration compatibility.
- C. Use one end-to-end installation migration unit.
- D. Split one unit per domain-design component.
- X. Other (please specify)

[Answer]: A. Use four units: shared installation foundation; CLI manifest adoption;
  VS Code shared-lifecycle adoption; and activation migration compatibility.
  The last unit is temporary extension integration over shared lifecycle and
  migration contracts, rather than a new extension-owned lifecycle.

## Q2. What unit granularity should guide the implementation plan?

- A. Keep each unit small enough for one focused pull request and independently
  testable behavior; use dependencies rather than combining delivery layers.
- B. Prefer fewer, larger units to reduce coordination and intermediate adapters.
- C. Optimize only for the minimum number of files changed per unit.
- X. Other (please specify)

[Answer]: A. Keep each unit small enough for one focused pull request and independently
  testable behavior; use dependencies rather than combining delivery layers.

## Q3. How should independent units be handled in the dependency map?

- A. Record all valid dependencies and expose delivery adapters that share only
  the foundation as parallel opportunities.
- B. Serialize all units in one strict implementation sequence.
- C. Defer dependency decisions until Delivery Planning.
- X. Other (please specify)

[Answer]: A. Record all valid dependencies and expose delivery adapters that share only
  the foundation as parallel opportunities.

## Q4. What integration boundary should connect the units?

- A. Define shared package contracts and ports for manifest access, target
  routing, managed-installation records, target writes, and migration outcomes;
  keep CLI and VS Code composition at their delivery edges.
- B. Allow the CLI and extension to call each other's existing services while
  shared packages are introduced incrementally.
- C. Use direct filesystem access from each delivery adapter for migration.
- X. Other (please specify)

[Answer]: A. Shared package contracts and ports for manifest access, target routing,
  managed installation state, target writes, and migration outcomes; delivery adapters
  retain CLI/VS Code composition.

## Q5. What deployment model should each unit use?

- A. Treat the shared foundation as a library and each CLI/VS Code change as an
  embedded delivery adapter; introduce no standalone runtime service.
- B. Extract the shared lifecycle into a separately deployed service.
- C. Package every unit as an independently released executable.
- X. Other (please specify)

[Answer]: A. Treat the shared foundation as a library and each CLI/VS Code change as an
  embedded delivery adapter; introduce no standalone runtime service.

## Consolidated Summary Confirmation

The plan contains four small, independently testable units. The shared
foundation is an in-process library in `packages/`; CLI and VS Code compose it
at their delivery edges. The two adoption units may proceed in parallel after
the foundation is available. The activation migration unit remains temporary
extension compatibility code and must not introduce a second lifecycle.

1. **U1: Shared installation foundation**
   - Create shared manifest governance, target routing, managed-installation
     registry, and install/update/uninstall lifecycle contracts and use cases.
   - Add archive, target-layout, storage, registry, and target-artifact adapters
     behind the shared ports.
   - Covers the shared manifest-driven lifecycle, `items[]`, target/scope
     isolation, shared XDG ownership, and safe update/uninstall behavior.

2. **U2: CLI manifest adoption** (depends on U1)
   - Make existing CLI install, update, and uninstall commands compose and call
     the shared lifecycle.
   - Remove the CLI's hardcoded ZIP-internal layout assumption while preserving
     supported command workflows through a thin adapter.

3. **U3: VS Code shared-lifecycle adoption** (depends on U1; parallel with U2)
   - Make extension bundle commands compose and call the shared lifecycle for
     install, update, and uninstall.
   - Retire the extension's cache-then-sync target-write path while retaining
     only VS Code commands, notifications, and bookkeeping at the edge.

4. **U4: Activation migration compatibility** (depends on U1 and U3)
   - Add temporary, explicitly tagged extension compatibility code that runs
     before bundle commands and reconciles legacy content through the shared
     lifecycle.
   - Keep U4 bounded to extension-internal legacy-root discovery and
     reconciliation because only the extension can resolve that path and its
     ownership. Preserve authoritative target content, require explicit
     overwrite consent, and use U1's journaled cleanup contract before deleting
     legacy artifacts.

**Dependency topology:** `U1 -> U2`, `U1 -> U3`, and `U1 + U3 -> U4`.
Delivery Planning will sequence pull requests and define the complete test
matrix; this topology only records valid technical dependencies.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct