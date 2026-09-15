# Unit Requirement Map

## Functional Requirement Assignment

No upstream user-story artifact was produced. This map therefore assigns every
functional requirement to a primary implementing Unit and its construction
directory.

| Requirement | Implementing Unit | Directory | Cross-cutting Units | Implementation order within unit |
| --- | --- | --- | --- | --- |
| FR1 | U1 | `u1-shared-installation-foundation` | U2, U3 | 1 |
| FR1.1 | U1 | `u1-shared-installation-foundation` | U2 | 2 |
| FR1.2 | U1 | `u1-shared-installation-foundation` | U2, U3 | 3 |
| FR1.3 | U1 | `u1-shared-installation-foundation` | U2, U3 | 4 |
| FR2 | U1 | `u1-shared-installation-foundation` | U2, U3, U4 | 5 |
| FR2.1 | U1 | `u1-shared-installation-foundation` | U3 | 6 |
| FR2.2 | U1 | `u1-shared-installation-foundation` | U2, U3, U4 | 7 |
| FR3 | U4 | `u4-activation-migration-compatibility` | U3 | 1 |
| FR3.1 | U4 | `u4-activation-migration-compatibility` | U1 | 2 |
| FR3.2 | U4 | `u4-activation-migration-compatibility` | U1 | 3 |
| FR3.3 | U4 | `u4-activation-migration-compatibility` | U1 | 4 |
| FR3.4 | U4 | `u4-activation-migration-compatibility` | U1 | 5 |
| FR3.5 | U4 | `u4-activation-migration-compatibility` | U3 | 6 |
| FR3.6 | U4 | `u4-activation-migration-compatibility` | U1 | 7 |
| FR3.7 | U4 | `u4-activation-migration-compatibility` | U1, U3 | 8 |
| FR3.8 | U4 | `u4-activation-migration-compatibility` | U1 | 9 |
| FR4 | U2 | `u2-cli-manifest-adoption` | U3, U4 | 1 |
| FR4.1 | U1 | `u1-shared-installation-foundation` | U2, U3, U4 | 8 |

## Cross-Cutting Requirement Coverage

| Concern | Units | Coverage approach |
| --- | --- | --- |
| Shared normal lifecycle | U1, U2, U3 | U1 owns behavior; U2 and U3 prove their entry points delegate to it. |
| Target/scope and storage isolation | U1, U2, U3, U4 | U1 supplies identity/routing contracts; adapters supply selected delivery context without changing policy. |
| Migration safety and recovery | U1, U4 | U1 enforces contained, verified operations; U4 coordinates current-state comparison, consent, and reporting. |
| Compatibility evidence and reviewable delivery | U1, U2, U3, U4 | Each unit has a bounded responsibility and focused observable evidence; Delivery Planning owns pull-request sequencing. |

## Coverage Verification

- Every functional requirement from `requirements.md` has one primary Unit ID
  and one declared construction directory.
- Every unit has primary assigned requirements: U1 owns the shared lifecycle and
  delivery evidence, U2 owns CLI compatibility evidence, U3 owns extension
  delegation, and U4 owns all migration behavior.
- Cross-cutting entries identify shared behavior without changing the primary
  accountable unit.

