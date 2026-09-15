# Requirements Analysis Questions

## Sources

- [desc] Initial description: CLI and VS Code installation must converge on one shared path, place Copilot user-scope content in `~/.copilot`, and transparently migrate existing extension installations.
- [scope] Scope definition: `aidlc/spaces/default/intents/260914-unified-installation/ideation/scope-definition/scope-document.md`
- [RE] Reverse-engineering findings: `aidlc/spaces/default/codekb/prompt-registry/business-overview.md`, `aidlc/spaces/default/codekb/prompt-registry/architecture.md`, and `aidlc/spaces/default/codekb/prompt-registry/code-structure.md`

## Q1. When should the extension start its one-time migration?

The trigger determines when existing extension-managed data is inspected without delaying unrelated work.

- A. During extension activation, before users run any bundle command.
- B. When the user first installs, updates, or uninstalls a bundle through the extension.
- C. Only when the user explicitly runs a migration command.
- D. During a release-time background job outside the extension.
- E. Decide the trigger during detailed design.
- X. Other (please specify)

[Answer]: A. During extension activation, before users run any bundle command.

## Q2. What must happen when migration is interrupted after some legacy bundles have been transferred?

This defines the required observable recovery behavior while leaving the exact state model to detailed design.

- A. Resume safely on the next eligible run, preserving completed bundle outcomes and retrying only unfinished work.
- B. Restart the complete migration after checking every destination again.
- C. Stop permanently and require a user to restart migration.
- D. Roll back all transferred bundles before retrying.
- E. Decide after detailed migration design.
- X. Other (please specify)

[Answer]: B. Restart the complete migration after checking every destination again.

## Q3. How should a non-identical legacy copy be reported after the target installation is kept authoritative?

Non-identical files cannot be removed automatically, so users and maintainers need a clear outcome to act on.

- A. Show a target-appropriate warning and retain a structured conflict record for later lifecycle operations.
- B. Write a diagnostic log entry only.
- C. Block all bundle operations until the conflict is resolved manually.
- D. Show one warning but do not retain any conflict state.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: D. Show one warning but do not retain any conflict state. And with proper context mention to the user to clean manually

## Q4. What proof is required before a verified duplicate is automatically removed from extension storage?

Earlier scope approves cleanup only for a verified duplicate; this question defines the acceptance threshold without choosing the comparison algorithm.

- A. Match installation identity and all managed content, then record the cleanup outcome.
- B. Match installation identity only.
- C. Match the bundle version only.
- D. Never remove duplicates automatically, even when they match.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: A. Match installation identity and all managed content, then record the cleanup outcome.

## Q5. What compatibility expectation should the migration meet for existing CLI and VS Code users?

The architecture may permit an evidence-led breaking change, but the requirements need the default user-facing contract.

- A. Preserve supported install, update, and uninstall workflows unless approved architecture evidence requires a documented incompatibility.
- B. Preserve only VS Code extension workflows.
- C. Preserve only CLI workflows.
- D. Allow either entry point to change without a compatibility commitment.
- E. Decide during architecture design.
- X. Other (please specify)

[Answer]: E. Decide during architecture design.

## Q6. Which completion outcome must the migration expose for every legacy installation it examines?

This makes the migration testable across successful transfers, verified cleanup, conflicts, and recovery.

- A. A durable per-installation outcome of migrated, already current, cleaned duplicate, conflict preserved, or retry pending.
- B. A single overall succeeded or failed result only.
- C. A user-facing summary only, with no durable outcome record.
- D. No explicit completion reporting is required.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: C. A user-facing summary only, with no durable outcome record.

## Q7. Where may the cleanup result required for a verified duplicate be recorded?

Q4 requires recording a cleanup outcome, while Q6 excludes a durable per-installation outcome record. This determines whether ordinary diagnostics are acceptable.

- A. Include the cleanup result only in the activation-time user-facing summary or standard diagnostics; do not add migration state.
- B. Persist a durable per-installation cleanup result so future lifecycle operations can read it.
- C. Keep the result only in a developer diagnostic log, without showing it to the user.
- D. Do not record the cleanup result.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: A. Include the cleanup result only in the activation-time user-facing summary or standard diagnostics; do not add migration state.

## Q8. What information must the warning include when a non-identical legacy copy is preserved for manual cleanup?

The warning must give people enough context to clean up safely without persisting a conflict record.

- A. The affected bundle identity, both locations, that the target copy remains authoritative, and that the legacy copy was preserved because content differs.
- B. The affected bundle identity and a general instruction to clean up the legacy copy.
- C. A generic migration warning without location or identity details.
- D. No user-facing warning; use diagnostics only.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: B. The affected bundle identity and a general instruction to clean up the legacy copy.

## Q9. How must runtime destinations be expressed and resolved?

The requirements must support all target layouts without making a fixed runtime
root part of the lifecycle contract.

- A. Resolve each destination from the selected target, installation scope, and
	item kind; do not hardcode a target-root path in the requirements.
- B. Define one fixed user-scope root for every supported target.
- C. Let each delivery adapter choose a runtime root independently.
- D. Keep the existing fixed-path examples as normative requirements.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: A. Resolve each destination from the selected target, installation scope, and item kind; do not hardcode a target-root path in the requirements.

## Q10. What proof and cleanup sequence is required before deleting legacy artifacts?

Migration cleanup is destructive, so the requirements need an observable proof
sequence before the previous location can be cleared.

- A. Confirm every expected target artifact exists and is identical, delete the
	corresponding managed legacy artifacts, then confirm no managed artifact
	remains at the previous location before reporting success.
- B. Confirm installation identity only, then delete all legacy content.
- C. Copy target content and delete legacy content without read-back checks.
- D. Never delete legacy artifacts automatically.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: A. Confirm every expected target artifact exists and is identical, delete the corresponding managed legacy artifacts, then confirm no managed artifact remains at the previous location before reporting success.

## Q11. How should target conflicts and failed-transfer retries be handled?

Existing target artifacts may have been manually created, and a retry can require
replacing target bytes after an earlier failed transfer.

- A. Notify the user and require explicit overwrite confirmation before replacing
	target content; an approved overwrite follows the Q10 sequence, while a
	declined or unanswered request preserves both locations without durable
	migration conflict state.
- B. Always preserve target content and require manual migration outside the
	extension.
- C. Automatically overwrite target content when the legacy copy is newer.
- D. Store a durable per-installation conflict outcome and retry automatically.
- E. Decide during detailed design.
- X. Other (please specify)

[Answer]: A. Notify the user and require explicit overwrite confirmation before replacing target content; an approved overwrite follows the Q10 sequence, while a declined or unanswered request preserves both locations without durable migration conflict state.

## Q12. What should an update do with a formerly managed artifact omitted from the newer manifest?

The shared lifecycle must define this outcome so an update cannot silently
retain stale managed content or delete a file a user has modified.

- A. Remove the obsolete artifact only when it still matches the content
	recorded for the prior installation; preserve and report a changed artifact.
- B. Retain every omitted artifact; updates only add or replace items still
	declared by the newer manifest.
- C. Remove every artifact that the prior installation record marked as
	managed, regardless of later local changes.
- D. Require explicit user confirmation before removing each omitted managed
	artifact, and preserve it when confirmation is declined or unavailable.
- E. Decide the behavior during detailed design.
- X. Other (please specify)

[Answer]: A. Remove the obsolete artifact only when it still matches the content recorded for the prior installation; preserve and report a changed artifact.

## Consolidated Summary Confirmation

- Start the one-time extension migration during extension activation, before users run bundle commands.
- If interrupted, restart the migration on the next eligible run after checking every target destination again.
- Keep non-identical legacy content and show a warning with the affected bundle identity plus guidance to clean up the legacy copy manually.
- Remove an extension-stored duplicate only after installation identity and all managed content match, then report the cleanup result.
- Decide the CLI and VS Code compatibility policy during architecture design.
- Provide a user-facing migration summary without durable per-installation migration outcome state.
- Report verified-duplicate cleanup only in the activation-time user-facing summary or standard diagnostics; do not add migration state.
- For a preserved non-identical copy, include the affected bundle identity and a general manual-cleanup instruction.
- Resolve runtime destinations from the selected target, installation scope, and
	item kind without hardcoded target-root paths in the requirements.
- Before cleanup, confirm every expected target artifact exists and is identical;
	after deletion, confirm no managed artifact remains at the previous location.
- Require explicit user confirmation before replacing an existing target artifact
	or retrying a failed transfer that would replace target bytes. An approved
	overwrite uses the same verification and cleanup sequence; a declined or
	unanswered request preserves both locations without durable conflict state.
- When an update omits a formerly managed artifact, remove it only when it
	still matches the content recorded for the prior installation; preserve and
	report locally changed content.

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct