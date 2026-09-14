## Sources

- [desc] Initial description: "I want to fix an issue with the current architecture while following docs/contributor-guide/architecture/library-centric-architecture/clean-architecture.md.\n\nToday when trying to install a bundle through the CLI or through the vscode extension we are going through 2 different code paths.\nAnd today when trying to install this bundle through the CLI it will fails because of the structure within the zip file that is rigid and not looking at all at the manifest but only looking into harcoded path.\n\nI want to plan a migration that will be reviewable but end up with only on single installation path that should be the same for both CLI and VSCode extension.\nAlso today vscode extension might install bundle at user level in the hidden folder of the extension while CLI will install them into the ~/.copilot folder. I would like to unify both extension and CLI to install in the ~/.copilot folder.\n\nI want the plan to include clear separated PR that are not huge and reviewable to be able to solve both the architecture and functional concerns.\nIt should also include a way for people with bundle already installed in their hidden vscode folder to move them transparently to the new target folder as a one of migration. --aidlc-attempt-id call_NHdDseH4D9RXhsuzxYGARkUp__vscode-1789392757075"
- [scope] Workflow-selected scope: `unified-bundle-installation-migration`.

## Q1. What is the primary problem this migration must solve?

The answer will anchor the plan's outcome and acceptance criteria.

- A. Make CLI and VS Code bundle installation use one shared, manifest-driven path.
- B. Fix only the CLI ZIP-layout failure.
- C. Move extension-installed bundles to `~/.copilot` only.
- D. Address all of the above as one migration.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: A. Make CLI and VS Code bundle installation use one shared, manifest-driven path.

## Q2. Who should the plan treat as the directly affected users?

This determines which existing installations and workflows must remain compatible.

- A. CLI users only.
- B. VS Code extension users only.
- C. Users of both the CLI and VS Code extension.
- D. Repository maintainers only.
- E. Not identified.
- X. Other (please specify)

[Answer]: C. Users of both the CLI and VS Code extension.

## Q3. How should success be measured for the completed migration?

This will make the final plan's acceptance checks concrete.

- A. Both entry points install the same valid bundle into `~/.copilot` using the shared path.
- B. CLI additionally supports ZIPs whose manifest is not at the currently hardcoded location.
- C. Existing extension installations are migrated without data loss or manual steps.
- D. All of A, B, and C, with tests covering each behavior.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: Other: A and B. Both entry points install the same valid bundle into `~/.copilot` using the shared path, and the CLI supports ZIPs whose manifest is not at the currently hardcoded location.

## Q4. What is driving this work now?

This distinguishes a regression response from planned architecture debt reduction.

- A. A current CLI installation failure caused by ZIP layout assumptions.
- B. Architecture debt from duplicated installation paths.
- C. Inconsistent installation locations between the CLI and extension.
- D. All of A, B, and C.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: D. All of A, B, and C.

## Q5. Which stakeholders should be represented in the plan?

Their interests will be captured without assuming an ownership model.

- A. Extension maintainers and CLI maintainers.
- B. Extension maintainers, CLI maintainers, and affected users.
- C. Repository architecture owners and maintainers.
- D. No additional stakeholders beyond the requestor.
- E. Not identified.
- X. Other (please specify)

[Answer]: B. Extension maintainers, CLI maintainers, and affected users.

## Q6. Who makes the final decisions on scope and PR sequencing?

This identifies the plan's decision-maker and any necessary review input.

- A. The requestor.
- B. Repository maintainers by pull-request review.
- C. A designated architecture owner.
- D. Shared decision between the requestor and repository maintainers.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: A. The requestor.

## Q7. What communication or review cadence should the plan assume?

This will shape the proposed PR boundaries and release notes.

- A. One small, independently reviewable pull request at a time.
- B. A design PR followed by implementation PRs.
- C. A sequence of small PRs, each with focused tests and review notes.
- D. No special cadence beyond normal repository review.
- E. Not applicable.
- X. Other (please specify)

[Answer]: B. A design PR followed by implementation PRs.

## Q8. Does the selected migration boundary match your intent?

The proposed boundary covers one shared, manifest-driven installation path, a common `~/.copilot` target for Copilot installs, transparent one-time extension-storage migration, matching update and uninstall behavior, and a shared user-installation registry. The registry must be readable and writable by the CLI and IDE adapters, identify each installation by target type, and isolate every supported target at user and repository scope so lifecycle operations for one target cannot affect another target's artifacts or state.

- A. Confirm this lifecycle, shared-registry, and target-isolation boundary.
- B. Limit the work to the CLI installer.
- C. Limit the work to VS Code storage migration.
- D. Expand the boundary to include related installation workflows.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: A. Confirm this lifecycle, shared-registry, and target-isolation boundary, with isolation applying to every supported target.

## Q9. What compatibility policy should govern the migration?

The two entry points have different maturity and existing local data, so the plan needs an explicit compatibility policy.

- A. Preserve VS Code extension backward compatibility and transparently migrate existing extension-installed bundles; permit a breaking change for either entry point when necessary to keep one simple shared architecture.
- B. Preserve backward compatibility for both the CLI and VS Code extension.
- C. Permit incompatible changes for both entry points.
- D. Decide the compatibility policy during implementation.
- E. Not yet defined.
- X. Other (please specify)

[Answer]: Other: Take an informed decision during feasibility and architecture design. A breaking change for either the CLI or VS Code extension may be accepted when evidence shows it produces a cleaner, simpler architecture.

## Consolidated Summary Confirmation

- Looks correct
- Request changes

[Answer]: Looks correct