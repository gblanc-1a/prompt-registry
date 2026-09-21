# Business Rules — VS Code Shared-Lifecycle Adoption (U3)

Rule identifiers use the `BR{group}.{seq}` format. Groups: 1 delegation, 2 storage
boundary, 3 registry adoption, 4 conflict interaction, 5 result presentation. As
with U2, most rules are **negative constraints** that keep the adapter from
reproducing shared policy. The YAML block is the source of truth; a summary table
follows it.

```yaml
rules:
  - id: BR1.1
    statement: An extension lifecycle command performs target writes only through the shared lifecycle.
    category: constraint
    applies_to: ExtensionLifecycleInvocation
    trigger: Every install, update, and uninstall command.
    logic: >
      IF a command must write, update, or remove target content
      THEN it fills a shared lifecycle request and delegates
      ELSE the command is a rule violation.
    violation: A VS Code-specific target-write path is prohibited.
    source: FR1

  - id: BR1.2
    statement: The extension does not cache bundle content and then sync it to the target.
    category: constraint
    applies_to: ExtensionLifecycleInvocation
    trigger: Any install or update.
    logic: >
      IF a bundle is installed or updated
      THEN the shared lifecycle writes the target directly and records the installation
      ELSE no extracted-files copy is created in extension storage and no second sync write runs.
    violation: Copying extracted bundle files into extension storage to reopen for a target sync is prohibited.
    source: FR1

  - id: BR1.3
    statement: The extension does not require the optional prompts[] projection for installation.
    category: constraint
    applies_to: ExtensionLifecycleInvocation
    trigger: Installing a bundle whose manifest declares canonical items[].
    logic: >
      IF a bundle's manifest declares installable items[]
      THEN install proceeds through the shared lifecycle on items[] alone
      ELSE the absence of prompts[] does not block installation.
    violation: Requiring prompts[] for VS Code installation is prohibited.
    source: FR1.2

  - id: BR2.1
    statement: Shared application-data access resolves through the injected AppStorage port.
    category: constraint
    applies_to: ExtensionLifecycleInvocation
    trigger: Any read or write of shared cache or registry data.
    logic: >
      IF the extension reads or writes shared cache or registry data
      THEN it resolves the on-disk root through the injected AppStorage port
      ELSE it may not reach a shared root through vscode global storage directly.
    violation: Using extension global storage as a shared-data root in new code is prohibited (ADR-0005).
    source: FR2.1

  - id: BR2.2
    statement: Extension global storage holds only genuinely VS Code-local state, if any.
    category: constraint
    applies_to: ExtensionLifecycleInvocation
    trigger: Any decision about where extension state lives.
    logic: >
      IF a piece of state is shared application data
      THEN it lives under AppStorage
      ELSE only genuinely VS Code-local state may use extension global storage, and the exception is documented.
    violation: Placing shared installation state in extension global storage is prohibited.
    source: FR2.1

  - id: BR3.1
    statement: The shared registry is the single source of truth for installation records.
    category: constraint
    applies_to: ExtensionRegistryProjection
    trigger: Any read or write of installation records.
    logic: >
      IF an installation record is read or written
      THEN the shared registry is authoritative and the extension manager delegates to it
      ELSE a separate authoritative extension store is a rule violation.
    violation: Maintaining a second authoritative installation record in the extension is prohibited.
    source: FR2.1, FR2.2

  - id: BR3.2
    statement: The extension-facing installation view is derived read-only from the shared record.
    category: constraint
    applies_to: ExtensionRegistryProjection
    trigger: Building any extension view or query over installations.
    logic: >
      IF a view or query needs installation data
      THEN it derives a read-only projection from the shared ManagedInstallation
      ELSE it may not persist state the shared registry does not hold.
    violation: Storing view state that the shared registry does not hold is prohibited.
    source: FR2.1

  - id: BR3.3
    statement: Legacy extension records are imported once, additively, and non-destructively.
    category: policy
    applies_to: LegacyExtensionRecordImport
    trigger: First activation when legacy extension records exist and import state is pending.
    logic: >
      IF a legacy extension record has no matching shared record for its installation key
      THEN copy it into the shared registry
      ELSE leave the existing shared record authoritative.
      After processing every record, mark import complete and delegate thereafter.
    violation: Re-importing after completion, overwriting a newer shared record, or touching runtime content is prohibited.
    source: FR2.1

  - id: BR3.4
    statement: Repository-scope records stay in the selected repository; user-scope records use shared XDG data.
    category: constraint
    applies_to: ExtensionRegistryProjection
    trigger: Any scoped record read or write.
    logic: >
      IF the scope is repository THEN the record lives in the repository lockfile through the shared registry adapter
      ELSE the user-scope record lives in shared XDG data through the shared registry adapter.
    violation: Crossing user-scope and repository-scope storage boundaries is prohibited.
    source: FR2.1, FR2.2

  - id: BR3.5
    statement: A legacy extension record is imported only when its target and repository identity resolve uniquely.
    category: policy
    applies_to: LegacyExtensionRecordImport
    trigger: Reconciling one legacy extension record during the one-time import.
    logic: >
      IF the record carries a target hint or an installPath that resolves to one configured target
      THEN use that target, and for repository scope resolve repository identity from the record's workspace
      ELSE associate the record with the single configured target whose layout contains its files.
      IF exactly one target (and, for repository scope, one repository identity) results
      THEN derive the full shared key and import additively
      ELSE skip the record, report the reason, and leave it in place.
    violation: Guessing a target or repository identity for an ambiguous record, or importing against a target its files do not occupy, is prohibited.
    source: FR2.1

  - id: BR3.6
    statement: Every installation-state reader adopts the shared-registry read-only projection.
    category: constraint
    applies_to: ExtensionRegistryProjection
    trigger: Any extension surface that displays or queries installation state.
    logic: >
      IF a surface — the registry tree, the marketplace view's installed indicators, or the auto-update/update-checker services — reads installation state
      THEN it reads the shared-registry projection (BR3.2)
      ELSE it may not read a retired bundle cache or a separate extension store.
    violation: An installation-state reader backed by a retired cache or a second store is prohibited.
    source: FR2.1

  - id: BR4.1
    statement: An overwrite prompt is raised only in response to a shared conflict result.
    category: policy
    applies_to: ConflictPrompt
    trigger: The shared lifecycle returns a conflict outcome.
    logic: >
      IF the shared lifecycle returns conflict
      THEN raise the VS Code overwrite prompt for the identified bundle and destination
      ELSE the adapter does not prompt about existing content.
    violation: Deciding overwrite policy in the adapter, or prompting without a shared conflict result, is prohibited.
    source: FR1

  - id: BR4.2
    statement: A confirmed overwrite is applied by re-invoking the shared operation with the decision.
    category: policy
    applies_to: ConflictPrompt
    trigger: The user answers the overwrite prompt.
    logic: >
      IF the user confirms
      THEN re-invoke the same shared operation carrying overwriteDecision confirmed
      ELSE pass declined (or unavailable when non-interactive) and leave target content unchanged.
    violation: Writing target content from the adapter after a confirmation is prohibited; the shared lifecycle performs the write.
    source: FR1

  - id: BR5.1
    statement: User-facing messaging is derived from the shared result kind alone.
    category: constraint
    applies_to: ExtensionResultPresentation
    trigger: Every returned LifecycleOutcome.
    logic: >
      IF an outcome is returned
      THEN derive the notification severity and text from its kind, surfacing preserved artifacts when the success outcome carries them
      ELSE the adapter has no separate success/failure state to message from.
    violation: Messaging from an adapter-held notion of success or failure is prohibited.
    source: FR1

  - id: BR5.2
    statement: The registry tree reflects the shared registry after an operation, not an adapter cache.
    category: constraint
    applies_to: ExtensionResultPresentation
    trigger: Refreshing any installation view after a lifecycle operation.
    logic: >
      IF a view refreshes after an operation
      THEN it reads the shared registry
      ELSE it may not read a retired bundle cache or a separate extension store.
    violation: Rendering installation state from a retired cache is prohibited.
    source: FR2.1
```

## Summary

| id | statement | category | source |
| --- | --- | --- | --- |
| BR1.1 | Extension writes only through the shared lifecycle. | constraint | FR1 |
| BR1.2 | No cache-then-sync; the shared lifecycle writes the target directly. | constraint | FR1 |
| BR1.3 | prompts[] is not required for VS Code installation. | constraint | FR1.2 |
| BR2.1 | Shared data resolves through the AppStorage port. | constraint | FR2.1 |
| BR2.2 | Extension global storage holds only VS Code-local state. | constraint | FR2.1 |
| BR3.1 | The shared registry is the single source of truth. | constraint | FR2.1, FR2.2 |
| BR3.2 | The extension view is a read-only projection of the shared record. | constraint | FR2.1 |
| BR3.3 | Legacy extension records are imported once, additively. | policy | FR2.1 |
| BR3.4 | Records stay within their scope's storage boundary. | constraint | FR2.1, FR2.2 |
| BR3.5 | A legacy record is imported only when its target and repository resolve uniquely. | policy | FR2.1 |
| BR3.6 | Every installation-state reader adopts the shared-registry projection. | constraint | FR2.1 |
| BR4.1 | Prompt only in response to a shared conflict result. | policy | FR1 |
| BR4.2 | A confirmed overwrite re-invokes the shared operation with the decision. | policy | FR1 |
| BR5.1 | Messaging is derived from the shared result kind alone. | constraint | FR1 |
| BR5.2 | The tree reflects the shared registry, not a cache. | constraint | FR2.1 |
