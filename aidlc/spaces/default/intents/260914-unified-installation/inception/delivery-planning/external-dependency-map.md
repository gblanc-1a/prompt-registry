# External Dependency Map

## Conclusion

No external dependency or approval window is expected to block this delivery.
The implementation is repository-contained: the CLI and VS Code extension
consume shared workspace packages, and the intermediate layers are not
published as independent packages.

## External Dependencies

| Dependency | Owner | Timing | Blocks | Fallback |
| --- | --- | --- | --- | --- |
| None identified | Not applicable | Not applicable | None | Continue with repository-local implementation and tests |

## Internal Checkpoints

These are delivery controls, not external dependencies:

| Checkpoint | Consuming pass | Evidence |
| --- | --- | --- |
| U1 contract and lifecycle readiness | Bolt 2 | Complete shared types, result payloads, repository identity rules, retry semantics, and focused lifecycle tests |
| CLI/VS Code parity checkpoint | Bolt 2 | Equivalent install, update, uninstall, isolation, and typed outcome behavior through both adapters |
| Inception traceability check | Construction transition | No unresolved traceability findings; current Partial NFR1.1 finding must be resolved first |
| Extension packaging and activation checks | Bolt 3 | Activation occurs before bundle commands, migration summary is visible, and packaging remains green |

## Assumptions

- Shared packages, CLI, and VS Code extension can be changed in the same
  repository change sequence.
- No external API or separately released intermediate package must be stabilized.
- Internal review and CI or packaging checks can run within the repository's
  normal workflow.
