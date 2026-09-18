# Unit Dependency Topology

## Dependency DAG

The topology records direct technical dependencies only. It does not select an
implementation order or a critical path; Delivery Planning owns those economic
sequencing decisions.

- U2 depends on U1 because its CLI adapter composes the shared lifecycle.
- U3 depends on U1 because its extension adapter composes the shared lifecycle.
- U4 depends on U1 for canonical transfer and state contracts, and on U3 because
  it is extension activation compatibility around the adopted command lifecycle.
- U4's cleanup journal is consumed through U1's shared safety contract; it does
  not make U4 a second normal lifecycle implementation.
- U1 has no unit dependency.

```yaml
units:
  - name: shared-installation-foundation
    kind: library
    depends_on: []
  - name: cli-manifest-adoption
    kind: library
    depends_on: [shared-installation-foundation]
  - name: vscode-shared-lifecycle-adoption
    kind: library
    depends_on: [shared-installation-foundation]
  - name: activation-migration-compatibility
    kind: library
    depends_on: [shared-installation-foundation, vscode-shared-lifecycle-adoption]
```

## Integration Points

| Producer | Consumer | Contract | Integration responsibility |
| --- | --- | --- | --- |
| U1 | U2 | Shared application lifecycle commands; manifest, target/scope, and result types | U2 maps CLI input/output and injects shared adapters. |
| U1 | U3 | Shared application lifecycle commands; managed-installation record and result types | U3 maps extension command input, notifications, and workspace context. |
| U1 | U4 | Manifest governance, routing, registry, lifecycle, target artifact, typed migration outcomes, and the U1-owned `MigrationCleanupJournal` port/schema/persistence contract | U4 supplies extension-internal legacy-root discovery, association, reconciliation, journal transaction orchestration, and user interaction; U1 remains the only normal target-write lifecycle and owns the shared journal contract and persistence boundary. U4 invokes that contract and may delete only verified legacy artifacts. |
| U3 | U4 | Extension activation and command-readiness boundary | U4 completes reconciliation before U3 command handlers are allowed to perform bundle operations. |

## Parallel Development Opportunities

- `cli-manifest-adoption` and `vscode-shared-lifecycle-adoption` have no direct
  dependency on each other and may develop concurrently once their U1 contracts
  are available.
- `activation-migration-compatibility` is not parallel with U3 because it relies
  on the extension's shared-lifecycle adoption boundary.
- Contract stabilization within U1 may unblock adapter implementation while U1
  is still being refined, but publication and construction readiness follow the
  declared dependency DAG.

The U1-to-U4 boundary carries the journal contract from U1 to U4; it does not
transfer extension-root discovery or migration orchestration ownership to U1.

