# Feasibility Assessment: Unified Bundle Installation Migration

## Decision

The migration is technically feasible. The CLI already separates application
storage from target runtime output through `XdgAppStorage`; the shared package
layers can become the single owner of the manifest-driven installation
lifecycle, while the CLI and VS Code extension remain delivery adapters.

## Recommended Technical Direction

- Require exactly one `deployment-manifest.yml` at the archive root. Resolve
  each manifest path relative to that root and resolve its destination from the
  item's kind.
- Centralize extraction validation, target-aware writes, installation records,
  and install/update/uninstall behavior in `packages/core`, `packages/infra`,
  and `packages/app` according to their existing ownership boundaries.
- Keep user-scope downloaded bundle data in the CLI's XDG cache location:
  `$AI_PRIMITIVES_HUB_CACHE` when set, otherwise
  `$XDG_CACHE_HOME/ai-primitives-hub` and then `~/.cache/ai-primitives-hub`.
- Keep durable user-scope installation records in
  `$XDG_DATA_HOME/ai-primitives-hub`, defaulting to
  `~/.local/share/ai-primitives-hub`. Repository lockfiles and repository
  artifacts remain rooted in their repository.
- Continue writing runtime-consumed content to the configured target root,
  such as `~/.copilot` or `~/.kiro`. The target root is not the download cache
  or shared application registry.
- Have the extension adapt only VS Code interactions, including commands,
  workspace discovery, dialogs, and notifications. It must not duplicate the
  shared installation rules.

## Migration Feasibility

Transparent migration is feasible only when it is target-isolated, idempotent,
and interruption-safe. On first use, the extension can move its user-scope
cache and registry to the shared XDG locations, then use the common lifecycle.
For an existing target installation, such as `~/.copilot`, that location is
authoritative. The extension may automatically remove its former copy only
after identity and content verification; it must report that removal. A
non-identical copy is a conflict and must be preserved without automatic
overwrite or deletion.

The migration must persist sufficient completion state to make a retry safe if
the process ends between writing a target, recording its shared registry entry,
and removing an identity-verified legacy duplicate. Exact transactional
mechanics and test evidence are design and delivery-planning decisions.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Rigid ZIP assumptions survive in a delivery adapter | Valid bundles still fail differently by entry point | Put root-manifest validation and manifest-relative path resolution in the shared lifecycle. |
| Legacy and target installations differ despite matching identifiers | Automatic cleanup could lose user data | Require content verification before removing the legacy copy; preserve mismatches as conflicts. |
| Interrupted migration leaves split state | Update or uninstall may read stale records | Make migration idempotent and order durable state changes so it can resume safely. |
| Target records leak across user and repository scope | One target can modify another's artifacts | Route every operation by target and scope; retain repository lockfiles and artifacts at repository scope. |
| Extension continues owning installation logic | CLI and extension drift again | Reduce the extension to a thin adapter over the shared packages. |

## Open Decisions

- Determine during this feasibility and architecture work whether transparent
  migration becomes a release success metric, based on the final interruption
  and conflict-handling design.
- Determine per-pull-request test evidence during delivery planning.

## Sources

- [intent-statement](../intent-capture/intent-statement.md) [desc] [Q1] [Q4] [Q8]
- [feasibility-questions](feasibility-questions.md) [Q1] [Q2] [Q3] [Q4] [Q5] [Q6] [Q7] [Q8] [Q9]
- `packages/infra/src/storage/xdg-app-storage.ts` [scope]
- `packages/infra/src/storage/xdg-base-dirs.ts` [scope]

## Assumptions & Open Questions

- The existing XDG layout remains the intended cross-client user-scope storage
  contract. [assumption]
- The migration's exact completion marker and recovery ordering require design
  before transparent migration can be declared a release success metric. [Q6]
- Delivery planning will choose the pull-request-level test matrix. [Q5]
