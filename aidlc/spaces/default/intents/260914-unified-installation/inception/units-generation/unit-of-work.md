# Units of Work

## Sources

- `components` from Domain Design defines component ownership and dependencies.
- `decisions` from Domain Design constrains lifecycle, state, compatibility, and
  migration ownership.
- `requirements` from Requirements Analysis defines the functional behavior
  assigned to the units.

## Unit Definitions

| Unit ID | Runtime Unit | Directory | Unit | Kind | Deployment | Complexity | Boundaries |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U1 | `shared-installation-foundation` | `u1-shared-installation-foundation` | Shared installation foundation | library | shared in-process library | L | Shared packages only; owns normal lifecycle policy and I/O ports, not CLI parsing, VS Code UX, or legacy discovery. |
| U2 | `cli-manifest-adoption` | `u2-cli-manifest-adoption` | CLI manifest adoption | library | embedded CLI delivery adapter | M | CLI composition and compatibility only; delegates all target writes and lifecycle policy to U1. |
| U3 | `vscode-shared-lifecycle-adoption` | `u3-vscode-shared-lifecycle-adoption` | VS Code shared-lifecycle adoption | library | embedded VS Code delivery adapter | M | Extension command composition, notifications, and bookkeeping only; delegates normal lifecycle policy to U1. |
| U4 | `activation-migration-compatibility` | `u4-activation-migration-compatibility` | Activation migration compatibility | library | embedded temporary VS Code compatibility adapter | L | Activation-time legacy discovery and interaction only; uses U1 for transfer and does not create a second lifecycle. |

## Responsibilities

### U1: Shared installation foundation

- Define core domain entities and ports for governed manifests, installation
  addresses, managed installations, and managed artifacts.
- Implement shared infrastructure adapters for binary-safe archive reads,
  layout-derived destinations, XDG and repository records, and contained target
  artifact writes.
- Provide shared app use cases for install, update, and uninstall, including
  read-back verification and hash-based preservation of locally changed files.
- Keep runtime target content separate from shared user-scope application data.

### U2: CLI manifest adoption

- Adapt supported CLI lifecycle commands to the U1 application use cases.
- Replace hardcoded ZIP-internal paths with the root manifest's governed
  archive-relative `items[]` inventory.
- Preserve supported command workflows unless compatibility would retain
  duplicate lifecycle policy.

### U3: VS Code shared-lifecycle adoption

- Adapt extension bundle install, update, and uninstall commands to the U1
  application use cases.
- Retire cache-then-sync target writes while retaining VS Code-specific command,
  notification, and bookkeeping concerns at the delivery boundary.
- Use the shared XDG application-data and repository-lockfile boundaries.

### U4: Activation migration compatibility

- Inspect legacy extension-managed installations during activation before bundle
  commands run and associate each one with exactly one target and scope.
- Reconcile legacy content through U1 while treating target content as
  authoritative and requiring explicit overwrite consent for conflicts.
- Verify identity and bytes before cleanup, preserve data on failure or
  ambiguity, and report restartable current-run outcomes without durable
  migration outcome state.

## Constraints and Notes

| Unit | Implementation notes and constraints |
| --- | --- |
| U1 | Preserve Clean Architecture dependency direction: core defines rules and ports, infra implements I/O, app orchestrates. Validate a single root `deployment-manifest.yml`, archive containment, governed integrity, destination containment, binary content, and read-back before success. |
| U2 | No CLI-specific target-write path or rigid archive subdirectory may remain. The adapter may translate CLI inputs and output, but must not reproduce lifecycle policy. |
| U3 | Follow the extension migration strategy: new behavior belongs in shared packages and services become thin delegators. Do not have the extension cache content merely to reopen it for an independent target sync. |
| U4 | Mark compatibility code for later extraction with `@migration-cleanup(name)`. Never overwrite target content without affirmative user input; never delete legacy data before current identity, all managed bytes, and post-cleanup absence are verified. |

## Acceptance Boundaries

- U1 is complete when both delivery surfaces can call the same manifest-driven
  lifecycle and its shared registry distinguishes managed from locally changed
  content by selected bundle, target, and scope.
- U2 and U3 are complete when each routes normal install, update, and uninstall
  through U1 without adding target-write policy at its delivery edge.
- U4 is complete when activation-time migration is safe, deterministic,
  restartable, and leaves legacy content intact for every unsafe, ambiguous,
  declined, or failed transition.

