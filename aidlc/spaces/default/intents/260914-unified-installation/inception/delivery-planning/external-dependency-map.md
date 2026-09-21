# External Dependency Map

## Conclusion

No external dependency or approval window is expected to block this delivery.
The work is repository-contained: the CLI and VS Code extension consume shared
workspace packages, and the intermediate layers are not published as independent
packages. Every pull request in the plan can be built, reviewed, and merged
within this repository's normal workflow.

## External Dependencies

| Dependency | Owner | Timing | Blocks | Fallback |
| --- | --- | --- | --- | --- |
| None identified | Not applicable | Not applicable | None | Continue with repository-local implementation and tests |

## Internal Checkpoints

These are delivery controls, not external dependencies:

| Checkpoint | Consuming PR(s) | Evidence |
| --- | --- | --- |
| Design PR merged | PRs 1–13 | Shared contracts, type/port layout, and journal states fixed before implementation |
| U1 foundation ready | PRs 7, 8 | Manifest governance, routing, registry, install/update/uninstall, and the shared journal contract landed and green |
| CLI/VS Code parity | PR 8 | Equivalent install, update, uninstall, isolation, and typed-outcome behavior through both adapters |
| Inception traceability check | Construction transition | No unresolved traceability findings (NFR1.1 now resolved) |
| Extension packaging & activation checks | PRs 9–13 | Activation runs migration before bundle commands, the migration summary is visible, packaging stays green |
| Destructive-cleanup gate | PR 11 | Full byte verification and post-cleanup absence proven; PR reviewed on its own before merge |

## Assumptions

- Shared packages, CLI, and VS Code extension can be changed in the same
  repository change sequence.
- No external API or separately released intermediate package must be stabilized.
- Internal review and CI or packaging checks run within the repository's normal
  workflow.
