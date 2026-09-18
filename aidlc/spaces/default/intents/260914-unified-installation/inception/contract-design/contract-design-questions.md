# Contract Design Questions

## Sources

- `unit-of-work.md` and `unit-of-work-dependency.md` define U1 through U4 and
  their technical boundaries.
- `components.md` defines the shared lifecycle, state, routing, and migration
  ownership.
- `requirements.md` defines validation, recovery, and Clean Architecture
  constraints.

## Q1. Which external API surface should this architecture expose?

The approved deployment model uses an embedded shared library with CLI and VS
Code delivery adapters, rather than a standalone service. The required
boundaries are U1-to-U2, U1-to-U3, U1-to-U4, and U3-to-U4.

- A. Expose no network or public API; formalize only in-process shared-package
  contracts used by the CLI and VS Code adapters.
- B. Add a public REST API for lifecycle operations.
- C. Add an event/message API for lifecycle operations.
- X. Other (please specify)

[Answer]: A. Expose no network or public API; formalize only in-process shared-package contracts used by the CLI and VS Code adapters.

## Q2. What mechanism should define the inter-unit contracts?

- A. Versioned TypeScript shared schemas and port interfaces, called in process.
- B. JSON schemas serialized across an internal process boundary.
- C. REST/HTTP contracts between all units.
- X. Other (please specify)

[Answer]: A. Versioned TypeScript shared schemas and port interfaces, called in process.

## Q3. Who owns each contract and its compatibility policy?

- A. U1 owns shared lifecycle schemas and ports; U2/U3 own input/output
  translation; U4 owns temporary migration interaction schemas. Additive fields
  are backward compatible and breaking changes require coordinated updates.
- B. Each delivery adapter owns its own copy of lifecycle schemas.
- C. A new shared service owns all contracts.
- X. Other (please specify)

[Answer]: A. U1 owns shared lifecycle schemas and ports; U2/U3 own input/output translation; U4 owns temporary migration interaction schemas. Additive fields are backward compatible and breaking changes require coordinated updates.

## Q4. How should contract failures cross unit boundaries?

- A. Return typed success, validation, conflict, preserved-content, retry, and
  safety outcomes; adapters map them to CLI output or VS Code interaction.
- B. Throw delivery-specific errors from U1 for each adapter to render.
- C. Automatically retry every error in the shared lifecycle.
- X. Other (please specify)

[Answer]: A. Return typed success, validation, conflict, preserved-content, retry, and safety outcomes; adapters map them to CLI output or VS Code interaction.

## Q5. What versioning policy should apply to the temporary migration boundary?

- A. Keep U4's mapping and interaction contracts internal and versioned with the
  extension; mark compatibility code for extraction, while U1 schemas follow
  package-semver compatibility rules.
- B. Publish the migration contract as a public API immediately.
- C. Leave migration contract changes unversioned until cleanup.
- X. Other (please specify)

[Answer]: X. Other (please specify): Keep all contracts internal to the repository. Evolve U1, U2, U3, and U4 through coordinated changes, using TypeScript compilation and tests to enforce compatibility. Do not promise public semver compatibility for intermediate layers.

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct