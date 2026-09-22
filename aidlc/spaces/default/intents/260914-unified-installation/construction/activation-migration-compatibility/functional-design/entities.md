# Entities — Activation Migration Compatibility (U4)

U4 is the extension's one-time, activation-time migration of legacy
extension-managed **user-scope** installations onto the shared lifecycle. It is a
bounded, disposable compatibility unit (`@migration-cleanup(activation-migration)`):
it discovers legacy content, transfers it through U1, drives U1's cleanup journal,
and reports — creating **no durable per-installation outcome state**.

Shared types owned by U1 — `GovernedBundleManifest`, `ManagedInstallation`,
`ManagedArtifact`, `LifecycleOutcome`, `CleanupJournalEntry`,
`CleanupArtifactProgress`, `SupportedTarget`, `InstallationScope`, and the shared
`OverwriteDecision` — are referenced, never redefined. The YAML block is the source
of truth; a prose summary follows it.

```yaml
entities:
  - name: LegacyInstallationCandidate
    description: >
      One legacy extension-managed installation discovered at activation. It is
      derived from what is actually deployed at the current target — a live
      symlink or copy in the target install place that resolves into the legacy
      extension cache — not from the cache contents or a stored record alone.
      It is transient: it exists only for the duration of one activation's
      migration pass and is never persisted.
    attributes:
      - name: bundleId
        type: identifier
        required: true
        constraints: Identifies the bundle whose legacy content was found at the target.
      - name: targetLinkPath
        type: path
        required: true
        constraints: The live symlink or copy in the current target's install place; its presence is what makes this a candidate.
      - name: legacySourceRoot
        type: path
        required: false
        constraints: >
          For a symlink deployment, the legacy cache location the target link
          resolves into (always present). For a copy deployment, the legacy cache
          location identified by bundle id against the legacy cache layout when it
          still exists; absent when no legacy source can be located, in which case
          the copy is left in place with no cache cleanup. Every legacy path must
          resolve inside it when present.
      - name: deploymentForm
        type: enum
        required: true
        allowed_values: [symlink, copy]
        constraints: >
          symlink — the target holds a symbolic link into the legacy cache, so the
          target must be materialized (real files transferred) before the cache is
          removed. copy — the target holds an independent copy of the bytes, which
          may be a true verified duplicate of what a fresh install would write.
      - name: legacyManagedArtifacts
        type: list of reference
        required: true
        references: LegacyArtifactObservation
        constraints: The managed files observed for this candidate; empty makes the candidate non-migratable.
    constraints:
      - A candidate exists only when a live target link resolves into the legacy cache; cache bytes with no live target link are not a candidate.
      - The candidate is always user scope and always the current running target; other scopes and targets are never candidates.
      - Nothing about the candidate is persisted; it is rebuilt from disk on each activation.

  - name: LegacyArtifactObservation
    description: >
      One managed file observed for a candidate, captured from the current target
      and its legacy source so it can be compared before any destructive step.
    attributes:
      - name: targetPath
        type: path
        required: true
        constraints: Where the artifact is (or would be) deployed at the current target.
      - name: legacyPath
        type: path
        required: true
        constraints: The corresponding file under the legacy source root; must resolve inside it.
      - name: observedState
        type: enum
        required: true
        allowed_values: [present-both, target-only, legacy-only, missing]
        constraints: What was found now; recomputed each activation, never stored.
    relationships:
      - to: LegacyInstallationCandidate
        cardinality: many-to-one
        direction: belongs-to

  - name: CurrentTargetContext
    description: >
      The single target and scope U4 migrates for: the IDE the extension is
      currently running as, at user scope. There is exactly one per activation;
      it is the entire association rule (no versioned attribute table).
    attributes:
      - name: targetType
        type: enum
        required: true
        constraints: The current IDE (e.g. vscode, vscode-insiders, kiro); resolved from the running extension host.
      - name: scope
        type: reference
        required: true
        references: InstallationScope
        constraints: Always user; repository scope is out of U4's scope.
      - name: userTargetRoot
        type: path
        required: true
        constraints: The current target's user-scope install root, from U1 target routing; where live links are inspected.
    constraints:
      - Exactly one context per activation; U4 never migrates for another target or for repository scope.
      - The context is derived from the running host, never from a stored per-installation record.

  - name: MigrationDisposition
    description: >
      The result U4 derives for one candidate on this activation, mapped from the
      shared transfer/cleanup outcome. It is reported and then discarded; it is
      never written as durable migration state.
    attributes:
      - name: bundleId
        type: identifier
        required: true
      - name: kind
        type: enum
        required: true
        allowed_values:
          - transferred
          - verified-duplicate-cleaned
          - preserved-conflict
          - retry-required
          - skipped
          - safety-blocked
        constraints: Derived from U1's MigrationTransferResult and cleanup outcome for this candidate on this run.
      - name: reason
        type: string
        required: false
        constraints: Present for skipped/preserved/retry/safety kinds; identifies the affected bundle and artifact.
    constraints:
      - A disposition is computed from the current run's observed state, never read from a prior run.
      - It contributes to the activation summary and is then discarded; it is not persisted.

  - name: MigrationRunSummary
    description: >
      The user-facing summary of one activation's migration pass, assembled from
      the run's dispositions. It reports outcomes without becoming durable
      per-installation state.
    attributes:
      - name: dispositions
        type: list of reference
        required: true
        references: MigrationDisposition
      - name: attemptedCount
        type: integer
        required: true
        min: 0
      - name: surface
        type: enum
        required: true
        allowed_values: [notification, diagnostics]
        constraints: Where the summary is surfaced; it carries no persisted record.
    constraints:
      - The summary is derived entirely from this run's dispositions; it is not stored for a later run to read.
      - A later activation reconstructs its own summary from the content present then.
```

## Summary

Five entities, all transient — nothing here is persisted, which is the point of
the state-free requirement (FR3.4/FR3.5/NFR4).

**Discovery** — `LegacyInstallationCandidate` is derived from a live target link
(symlink or copy) that resolves into the legacy cache, with its
`LegacyArtifactObservation` set captured from current disk. A cache with no live
target link is not a candidate; the cache proves the source, never the install.
Every candidate is user scope and the current running target.

**Association** — `CurrentTargetContext` is the whole association rule: the IDE the
extension runs as, at user scope, one per activation. It replaces FR3.8's versioned
attribute table (recorded deviation), and repository scope is excluded (recorded
FR3.7 deviation).

**Result** — `MigrationDisposition` maps U1's transfer/cleanup outcome for one
candidate on this run, and `MigrationRunSummary` assembles the run's dispositions
for a notification or diagnostics. Both are computed from current content and
discarded; neither is durable migration state, so the next activation re-derives
everything from what is on disk then.
