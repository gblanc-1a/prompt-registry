# Entities — VS Code Shared-Lifecycle Adoption (U3)

U3 is the VS Code delivery adapter. Like U2 it owns no lifecycle policy and no
target-write path; its entities are the **translation and presentation values**
that let the extension's commands, notifications, and views run on the shared
lifecycle and the shared registry instead of the retired cache-then-sync path.

Types owned by the shared foundation (U1) — `GovernedBundleManifest`,
`ManagedInstallation`, `ManagedArtifact`, `LifecycleOutcome`, `SupportedTarget`,
`InstallationScope`, `RepositoryIdentity`, and the `AppStorage` port — are
referenced, never redefined. The YAML block is the source of truth; a prose
summary follows it.

```yaml
entities:
  - name: ExtensionLifecycleInvocation
    description: >
      One extension command (install, update, or uninstall) reduced to the
      fields the shared lifecycle needs. It is the adapter's translation of a
      VS Code command plus workspace context into a shared request; it holds no
      behaviour and no target-write path.
    attributes:
      - name: operation
        type: enum
        required: true
        allowed_values: [install, update, uninstall]
      - name: bundleSpecification
        type: string
        required: false
        constraints: The user-selected bundle reference resolved by the shared lifecycle; absent for uninstall.
      - name: target
        type: reference
        required: true
        references: SupportedTarget
      - name: scope
        type: reference
        required: true
        references: InstallationScope
      - name: commitModeSelection
        type: reference
        required: false
        references: CommitModeSelection
        constraints: Repository scope only; resolved from the extension's scope UI or the target default, and consumed by the shared layer (U1/U2 rule BR6.1), never acted on here.
      - name: overwriteDecision
        type: enum
        required: false
        allowed_values: [confirmed, declined, unavailable]
        constraints: Present only on the re-invocation that follows a conflict prompt; absent on the first call.
    constraints:
      - The adapter never resolves a destination, writes a target file, or copies bundle content into extension storage.
      - Bundle resolution, download, validation, and target writes belong to the shared lifecycle.

  - name: ConflictPrompt
    description: >
      The VS Code interaction raised when the shared lifecycle returns a conflict
      result. The decision logic lives in the shared layer; the prompt and its
      captured answer live here.
    attributes:
      - name: bundleId
        type: identifier
        required: true
      - name: conflictingDestination
        type: path
        required: true
        constraints: Reported by the shared conflict result; identifies the existing target content.
      - name: userDecision
        type: enum
        required: true
        allowed_values: [confirmed, declined, unavailable]
        constraints: unavailable when the extension is running without an interactive surface.
    constraints:
      - A prompt is raised only in response to a shared conflict result; the adapter never decides overwrite policy itself.
      - The captured decision is passed back on a re-invocation of the same shared operation.

  - name: ExtensionRegistryProjection
    description: >
      The extension-facing view of an installation, derived from the shared
      ManagedInstallation record so existing extension queries and views keep
      working without a second source of truth.
    attributes:
      - name: bundleId
        type: identifier
        required: true
      - name: version
        type: string
        required: true
      - name: scope
        type: reference
        required: true
        references: InstallationScope
      - name: target
        type: reference
        required: true
        references: SupportedTarget
      - name: source
        type: reference
        required: true
        references: ManagedInstallation
        constraints: The shared record this projection is derived from; the projection is never authoritative.
    constraints:
      - The projection is read-only and rebuilt from the shared registry; it stores no state the shared registry does not hold.
      - Writes go to the shared registry through the delegating registry manager, never to a separate extension store.

  - name: LegacyExtensionRecordImport
    description: >
      The one-time reconciliation that moves the extension's pre-existing
      installation records into the shared registry, after which the extension
      registry manager only delegates.
    attributes:
      - name: importState
        type: enum
        required: true
        allowed_values: [pending, imported, absent]
        constraints: absent when the extension has no legacy records; imported once records were copied into the shared registry.
    constraints:
      - Import reads the legacy extension records at most once; a completed import is never repeated.
      - Import adds a shared record only when the shared registry has none for that installation key.
      - A legacy record is imported only when its target and (for repository scope) repository identity resolve uniquely; an ambiguous record is skipped and reported, not guessed.
      - Import reconciles records only; it never reads, writes, or deletes runtime target content.

  - name: ExtensionResultPresentation
    description: >
      The mapping from one shared LifecycleOutcome to what the extension shows:
      the VS Code notification, the progress state, and the registry tree
      refresh. Derived purely from the shared result kind and the shared
      registry.
    attributes:
      - name: outcomeKind
        type: enum
        required: true
        allowed_values: [success, validation-error, conflict, preserved-content, retryable-failure, safety-blocked]
      - name: notificationSeverity
        type: enum
        required: true
        allowed_values: [info, warning, error]
        constraints: Derived from the outcome kind alone; success and a success carrying preserved files are info, conflict is warning, the rest are error.
      - name: preservedArtifacts
        type: list of reference
        required: false
        references: ManagedArtifact
        constraints: Surfaced in the notification when the success outcome carries them.
    constraints:
      - The adapter maps outcome kinds to messaging; it holds no separate success/failure state of its own.
      - The registry tree reflects the shared registry after the operation, not an adapter-side cache.
```

## Summary

Five entities, all delivery-adapter concerns.

**Command translation** — `ExtensionLifecycleInvocation` reduces a VS Code
command plus workspace context to the shared request fields, including the
optional `overwriteDecision` that rides the re-invocation after a conflict
prompt. It resolves a `CommitModeSelection` for repository scope (the same
per-invocation resolution U2 defines) but never acts on it.

**Conflict interaction** — `ConflictPrompt` is the VS Code overwrite dialogue
raised only in response to a shared `conflict` result; the decision logic stays
in the shared layer, and the captured answer is passed back on re-invocation.

**Registry projection and import** — `ExtensionRegistryProjection` is a read-only
view derived from the shared `ManagedInstallation`, so the tree and existing
queries keep working without a second source of truth;
`LegacyExtensionRecordImport` moves the extension's old records into the shared
registry once, after which the extension registry manager only delegates.

**Result presentation** — `ExtensionResultPresentation` maps a shared outcome to
notification severity, preserved-file surfacing, and a tree refresh, derived
purely from the shared result kind and the shared registry.
