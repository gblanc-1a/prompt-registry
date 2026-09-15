# Domain Design Questions

## Sources

- [requirements] `aidlc/spaces/default/intents/260914-unified-installation/inception/requirements-analysis/requirements.md`
- [architecture] `aidlc/spaces/default/codekb/prompt-registry/architecture.md`
- [inventory] `aidlc/spaces/default/codekb/prompt-registry/component-inventory.md`

## Q1. How should shared installation and migration responsibilities be separated?

The normal install, update, and uninstall lifecycle must be reusable by both
entry points, while activation migration also needs comparison and cleanup
rules.

- A. Create separate shared application components: `InstallationLifecycle` for
  install, update, and uninstall, and `LegacyInstallationMigration` for
  reconciliation that calls the lifecycle for transfers.
- B. Create one shared `BundleLifecycle` component that owns normal operations
  and migration reconciliation together.
- C. Keep migration logic in the VS Code extension and move only normal
  installation into the shared packages.
- D. Keep separate CLI and VS Code lifecycle components with a shared manifest
  helper.
- E. Defer the boundary until implementation.
- X. Other (please specify)

[Answer]: C. Keep migration logic in the VS Code extension and move only normal
  installation into the shared packages. Make sure to mark it for later cleanup.

## Q2. Where should the migration conflict decision live?

The shared migration behavior must never overwrite authoritative target content
without an explicit user decision, but it must not depend on VS Code APIs.

- A. The shared migration component returns a structured pending-conflict result;
  the VS Code adapter presents the overwrite choice and explicitly resumes the
  operation with that choice.
- B. The shared migration component receives a delivery-provided decision port
  that asks the user during the migration operation.
- C. The extension performs target comparison and conflict decisions itself;
  the shared component handles only transfers with no conflicts.
- D. Preserve every conflict without offering an in-product overwrite choice.
- E. Defer the interaction boundary until implementation.
- X. Other (please specify)

[Answer]: X. Other - Notification should be presented to the user in the extension with the decision and all this logic should be part of the migration logic

## Q3. What should identify a managed installation and its removable artifacts?

Updates and cleanup need an identity that isolates targets and scopes, and a
byte-level basis for safely removing content that is no longer managed.

- A. Key installations by bundle identity, selected target, and scope; record
  each managed destination path with its installed content hash.
- B. Key installations by bundle identity and target only; infer scope and
  managed content from the current manifest.
- C. Key installations by manifest version only; delete all paths omitted by a
  newer manifest.
- D. Do not persist per-artifact content hashes; require user confirmation for
  every cleanup.
- E. Defer the record shape until Contract Design.
- X. Other (please specify)

[Answer]: A. Key installations by bundle identity, selected target, and scope; record
  each managed destination path with its installed content hash.

## Q4. What compatibility posture should guide the shared-lifecycle migration?

Earlier stages permit a documented incompatibility only when evidence shows it
removes duplicated policy and yields a simpler architecture.

- A. Preserve existing supported CLI and extension commands and behavior through
  thin compatibility adapters unless that would retain duplicate policy.
- B. Permit a documented breaking change for either entry point whenever it is
  necessary to maintain one shared lifecycle, with migration notes and focused
  compatibility evidence.
- C. Preserve VS Code extension behavior but permit CLI breaking changes.
- D. Make both entry points breaking changes as part of the migration.
- E. Defer the compatibility decision until Delivery Planning.
- X. Other (please specify)

[Answer]: A. Preserve existing supported CLI and extension commands and behavior through
  thin compatibility adapters unless that would retain duplicate policy.

## Q5. Which domain representation best fits this repository's architecture?

The repository already uses Clean Architecture packages, and this stage must
name the logical building blocks rather than deployment services.

- A. Model installation records and managed artifacts as shared domain entities,
  with target layouts, archive bytes, and user notifications behind ports.
- B. Model only manifest items as domain entities; keep installation records and
  migration comparison in infrastructure adapters.
- C. Model every target layout as a separate domain component with independent
  lifecycle rules.
- D. Keep the current extension services as the primary domain model and have
  the CLI adapt to them.
- E. Defer the model until Functional Design.
- X. Other (please specify)

[Answer]: X. Other - Which one do you recommend ? What are the pros and cons of each ?

## Q5a. Which domain-model boundary should the design adopt?

**Recommendation: A.** It keeps stable business facts and rules shared while
allowing target layouts, archive access, filesystem writes, and VS Code
notifications to vary behind ports. It also supports the chosen short-term
extension-owned migration implementation without making extension services the
long-term source of installation policy.

- A. Model `ManagedInstallation` and `ManagedArtifact` as shared domain
  entities, with `InstallationLifecycle` as shared application orchestration.
  Target layouts, archive bytes, filesystem operations, registry persistence,
  and notifications sit behind ports.
  - Pros: preserves Clean Architecture; enables one lifecycle for CLI and the
    extension; makes target-and-scope isolation and safe deletion testable
    without VS Code; leaves a clean extraction path for migration policy.
  - Cons: introduces shared record and port contracts before the extension can
    switch over; requires temporary compatibility adapters.
- B. Model only manifest items as shared domain entities, with installation
  records and migration comparison implemented in infrastructure.
  - Pros: smaller initial change and fewer new core types.
  - Cons: puts lifecycle policy beside I/O; makes safe update and uninstall
    behavior harder to test independently and risks another delivery-specific
    implementation.
- C. Model every target layout as its own domain component with independent
  lifecycle rules.
  - Pros: each target can evolve independently.
  - Cons: duplicates the policy this migration is intended to unify and makes
    parity across targets more expensive.
- D. Keep the extension services as the primary domain model and adapt the CLI
  to them.
  - Pros: reuses existing extension behavior in the short term.
  - Cons: reverses the repository's dependency direction, couples the CLI to
    VS Code, and blocks reuse by other delivery adapters.
- E. Defer the model until Functional Design.
  - Pros: avoids an immediate commitment.
  - Cons: leaves component ownership and the shared lifecycle boundary unclear
    for the next planning stages.
- X. Other (please specify)

[Answer]: A. Model `ManagedInstallation` and `ManagedArtifact` as shared domain
  entities, with `InstallationLifecycle` as shared application orchestration.
  Target layouts, archive bytes, filesystem operations, registry persistence,
  and notifications sit behind ports.

## Consolidated Summary Confirmation

- Move canonical install, update, and uninstall policy into shared packages;
  retain activation migration in the VS Code extension initially and mark it
  for later extraction after the shared lifecycle is stable.
- Keep migration conflict handling in migration logic while the extension owns
  the VS Code notification and overwrite decision interaction.
- Identify managed installations by bundle identity, target, and scope, and
  persist each managed destination path with its installed content hash.
- Preserve supported CLI and extension commands through thin compatibility
  adapters unless doing so would retain duplicated policy.
- Model `ManagedInstallation` and `ManagedArtifact` as shared domain entities;
  place target layouts, archive access, filesystem operations, registry
  persistence, and notifications behind ports.
- Trace every approved non-functional requirement to its responsible component
  and ADR. Keep `NFR1.1` partial while the atomic or journaled cleanup concern
  remains open.
- Defer `FR4.1` pull-request sequencing and its test matrix to Delivery
  Planning rather than representing it as migration-coordinator behavior.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

## Requested Changes Feedback

- Address R-01 by adding coverage entries for `NFR1`, `NFR1.1`, `NFR2`,
  `NFR3`, and `NFR4`, naming the responsible component and ADR. Preserve the
  open R-02 cleanup concern as partial coverage for `NFR1.1`.
- Address R-03 by marking `FR4.1` deferred to Delivery Planning.