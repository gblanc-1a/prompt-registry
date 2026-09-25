# External Dependency Map

## Conclusion

No external dependency or approval window is expected to block this delivery.
The work is repository-contained: the CLI and VS Code extension consume shared
workspace packages, and the intermediate layers are not published as independent
packages. Every pull request in the plan can be built, reviewed, and merged
within this repository's normal workflow.

One outbound network touch exists in the shipped behaviour, and it blocks
nothing: the repository-rename redirect check. It is reached only through the
injected `RepositoryRedirectPort` that U3 supplies, it fires only when a stored
record matches no open workspace, and an absent or unreachable host degrades to
"skip and leave the record untouched" rather than an error. U1 itself performs no
network call, so every U1 pull request is reviewable and testable offline.

## External Dependencies

| Dependency | Owner | Timing | Blocks | Fallback |
| --- | --- | --- | --- | --- |
| Git remote reachability for the repository-rename redirect check | The user's own git host (only touched through the injected `RepositoryRedirectPort`) | At activation, only when a stored record matches no open workspace | Nothing — it is optional by contract | The port returns `unavailable`, reconciliation is skipped, and the stored record is left untouched |

## Internal Checkpoints

These are delivery controls, not external dependencies:

| Checkpoint | Consuming PR(s) | Evidence |
| --- | --- | --- |
| Design PR merged | PRs 1–14 | Shared contracts, type/port layout, journal states, and the journal/reconciliation signatures fixed before implementation |
| U1 foundation ready | PRs 8, 9 | Manifest governance, routing, registry, install/update/uninstall, the shared journal contract, and offline reconciliation landed and green |
| CLI/VS Code parity | PR 9 | Equivalent install, update, uninstall, isolation, and typed-outcome behavior through both adapters |
| Redirect port wired | PR 9 | The extension composition root supplies `RepositoryRedirectPort`, making PR 7's reconciliation reachable; absent-port behaviour still skips cleanly |
| Inception traceability check | Construction transition | No unresolved traceability findings (NFR1.1 now resolved) |
| Extension packaging & activation checks | PRs 10–14 | Activation runs migration before bundle commands, the migration summary is visible, packaging stays green |
| Destructive-cleanup gate | PR 12 | Full byte verification and post-cleanup absence proven; PR reviewed on its own before merge |

## Assumptions

- Shared packages, CLI, and VS Code extension can be changed in the same
  repository change sequence.
- No external API or separately released intermediate package must be stabilized.
- Internal review and CI or packaging checks run within the repository's normal
  workflow.
## Contract safety delivery controls

Destination-ownership claim recovery is an internal U1 checkpoint, not an
external dependency. PRs 3, 6, 11, and 12 must demonstrate claim finalization,
rollback-required recovery, and preserved-conflict behavior before migration
cleanup can delete a legacy artifact. The optional repository-redirect network
check remains non-blocking and cannot bypass these controls.