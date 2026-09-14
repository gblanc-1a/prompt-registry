## Q1. Which source shapes must the shared installer support in this migration?

The current CLI failure comes from assuming one ZIP layout, so this defines the compatibility boundary for manifest discovery.

- A. Any ZIP containing exactly one valid `deployment-manifest.yml` at any archive depth.
- B. A root manifest plus ZIPs with one wrapping directory.
- C. Only the currently documented ZIP layout after fixing the CLI bug.
- D. Support existing known layouts now; record broader discovery as follow-up work.
- E. Decide after inspecting representative bundles.
- X. Other (please specify)

[Answer]: X. Other - at the root of the zip we should have deployment-manifest.yml and it should give path within the archive and we should based on the kind to know the destination folder.

## Q2. How should the one-time migration handle an existing extension installation that conflicts with data already in `~/.copilot`?

This determines whether the migration can remain transparent without overwriting a user's current CLI-managed files.

- A. Preserve both locations and report the conflict for manual resolution.
- B. Treat the `~/.copilot` installation as authoritative and leave the extension copy untouched.
- C. Move the extension copy only when no conflicting destination exists; otherwise report the conflict.
- D. Merge compatible data automatically and preserve a backup before resolving conflicts.
- E. Decide after inspecting the current storage formats.
- X. Other (please specify)

[Answer]: X. Other - Treat the `~/.copilot` installation as authoritative and propose the user to remove the duplicate in the extension folder

## Q3. What compatibility promise should the migration make for existing extension storage?

This sets the release and rollback expectation for users who already have bundles installed through VS Code.

- A. Migrate automatically on first use and keep a reversible backup for one release.
- B. Migrate automatically on first use, with no retained backup after a successful move.
- C. Keep reading legacy storage indefinitely while writing only to `~/.copilot`.
- D. Require an explicit user action before migration.
- E. Decide after the architecture assessment identifies storage and rollback constraints.
- X. Other (please specify)

[Answer]: B. Migrate automatically on first use, with no retained backup after a successful move.

## Q4. Where should installation metadata be owned after unification?

Both entry points need the same target-aware install, update, and uninstall state without allowing one target to affect another.

- A. A shared registry under `~/.copilot`, owned by the common application layer.
- B. A shared registry under `~/.copilot`, with separate CLI and extension adapters owning their records.
- C. Keep separate registries but synchronize them through the common installation path.
- D. Derive metadata solely from installed files whenever an operation runs.
- E. Decide after examining the existing registry formats.
- X. Other (please specify)

[Answer]: X. Other - A shared user-scope registry in the CLI's XDG application data location, owned by the common application layer; keep repository lockfiles at the repository root.

## Q5. What evidence must each implementation pull request provide before it can be merged?

The plan will split the migration into reviewable pull requests, and this defines their minimum proof of behavior.

- A. Focused unit tests for the changed package plus the existing relevant suite.
- B. Unit tests plus CLI and VS Code integration coverage of the shared path.
- C. Unit and integration tests plus a migration fixture covering existing extension storage.
- D. End-to-end manual verification is sufficient for migration behavior.
- E. Decide during delivery planning.
- X. Other (please specify)

[Answer]: E. Decide during delivery planning.

## Q6. Should transparent migration remain a required success metric?

The confirmed migration boundary includes moving existing extension installations, but the earlier success metric selected only the shared path and ZIP compatibility. This answer resolves that mismatch before the plan treats migration as mandatory or optional.

- A. Yes, migration without data loss or manual steps is a required success metric.
- B. Yes, but conflict cases may require an explicit user decision.
- C. No, retain migration as a follow-up after shared installation is complete.
- D. No, remove migration from this workflow.
- E. Decide after feasibility work identifies the storage risks.
- X. Other (please specify)

[Answer]: E. Decide after feasibility work identifies the storage risks.

## Q7. When a user has both an extension-stored bundle and a `~/.copilot` installation with the same identity, what should the extension do?

The current code retains extension-managed bundle data while synchronizing some Copilot content. Your earlier answer makes the `~/.copilot` version authoritative, but a transparent migration cannot require a manual cleanup without changing that promise.

- A. Keep `~/.copilot` authoritative, show a non-blocking cleanup action for the duplicate, and leave the extension copy until the user confirms removal.
- B. Keep `~/.copilot` authoritative and automatically remove the extension duplicate after checking that it is the same installation.
- C. Keep `~/.copilot` authoritative but retain the extension duplicate indefinitely.
- D. Stop and ask the user to choose which installation to keep.
- E. Treat conflict handling as a post-migration implementation detail.
- X. Other (please specify)

[Answer]: B. Keep `~/.copilot` authoritative and automatically remove the extension duplicate after checking that it is the same installation.

## Q8. Which extension-owned data should move to shared application storage during migration?

The extension currently uses its own bundle cache and may separately synchronize content into target folders; the CLI already owns its cache and installed records through XDG storage. Repository operations already use a repository lockfile. This answer defines the data boundary without merging user and repository targets.

- A. Move the complete user-scope bundle cache and shared registry to the CLI's XDG application storage; leave repository lockfiles and repository artifacts in the repository.
- B. Move only the content that the Copilot runtime consumes; keep extension metadata in VS Code storage.
- C. Move the complete cache, registry, and all target records into the shared target, including repository records.
- D. Keep the current cache but add a second shared registry in the target.
- E. Decide after reverse engineering maps the exact current files and ownership.
- X. Other (please specify)

[Answer]: Move the extension's complete user-scope bundle cache to the CLI's existing XDG cache location and its installation registry to the CLI's existing XDG data location, owned by the shared application layer; keep repository lockfiles and repository artifacts rooted in their repository. Reuse the same target-aware installer for CLI and VS Code, with the extension only adapting VS Code-specific interactions. Target runtime files remain in their configured target roots.

## Q9. How should the migration resolve a verified duplicate?

Q2 says to propose that the user removes an extension duplicate, while Q7 selects automatic removal after matching the installation. The migration needs one policy so it cannot both wait for consent and delete immediately.

- A. After verifying identity and content, remove the extension duplicate automatically and report the result.
- B. After verifying identity and content, retain the duplicate and offer the user a cleanup action.
- C. Keep duplicates indefinitely, even when they match.
- D. Treat every duplicate as a conflict that requires an explicit user choice.
- E. Decide after the detailed migration design.
- X. Other (please specify)

[Answer]: A. Remove a verified extension duplicate automatically and report the result.

## Consolidated Summary Confirmation

- Require `deployment-manifest.yml` at the ZIP root. The manifest declares archive-relative paths, while each item's kind determines its target destination.
- Treat the existing target installation, such as `~/.copilot`, as authoritative.
- On first use, migrate existing extension user-scope data automatically without retaining a backup after a successful move.
- Store the user-scope bundle cache in the CLI's XDG cache location (`$AI_PRIMITIVES_HUB_CACHE` or `$XDG_CACHE_HOME/ai-primitives-hub`) and installation registry in its XDG data location (`$XDG_DATA_HOME/ai-primitives-hub`), owned by the shared application layer. Keep repository lockfiles and repository artifacts in their repository; runtime files remain in their configured target roots, such as `~/.copilot` or `~/.kiro`.
- Reuse the shared target-aware installer from both the CLI and VS Code extension; keep the extension limited to VS Code-specific integration.
- A verified extension duplicate is removed automatically and the result is reported. Non-identical data remains a conflict; it is not automatically deleted or overwritten.
- Decide per-pull-request test evidence during delivery planning.
- Decide whether transparent migration is a required success metric after this feasibility assessment identifies the storage risks.

[Answer]: Looks correct