# Component Inventory

## Core Manifest And Installation Domain

**Health:** Healthy

**Responsibility:** Owns pure bundle, manifest, target, layout, and port contracts, including governed manifest validation and installation file selection.

**Dependencies:** None on `infra`, application delivery frameworks, direct filesystem access, or VS Code APIs.

**Migration role:** Keep canonical manifest rules and installation inventory policy here. Do not put extension migration IO or UI behavior in this component.

## Application Installation And Migration Use Cases

**Health:** At risk

**Responsibility:** Orchestrates shared install pipeline phases, registry workflows, writer selection, and structured outcomes.

**Dependencies:** `core` contracts and injected or imported `infra` adapters, following the established repository layering.

**Migration role:** Recommended owner of the unified install entry point and a future resumable migration use case. It must not duplicate core validation rules or expose raw VS Code dependencies.

## Infrastructure Storage, Archive, Layout, And Writer Adapters

**Health:** Healthy

**Responsibility:** Implements ZIP extraction, XDG application storage, data-driven layouts, repository writers, filesystem writes, path containment, and read-back verification.

**Dependencies:** `core` ports and Node-facing libraries.

**Migration role:** Provide concrete secure comparison, transfer, and target-write adapters under app orchestration. Target roots are derived from layouts, while XDG storage is shared application bookkeeping.

## CLI Delivery Adapter

**Health:** Healthy

**Responsibility:** Parses Clipanion options, assembles production dependencies, invokes shared installation logic, renders terminal results, and records selected lockfile information.

**Dependencies:** `app`, `core`, and `infra`.

**Migration role:** Serves as the behavioral reference for shared manifest-driven target writes; it should remain thin.

## VS Code Extension Delivery And Compatibility Services

**Health:** At risk

**Responsibility:** Registers commands, coordinates registry installation, caches downloaded bundles, synchronizes user/repository scopes, and supports update/uninstall workflows.

**Dependencies:** VS Code API and shared packages; legacy services include `BundleInstaller`, `UserScopeService`, and `RepositoryScopeService`.

**Migration role:** Replace cache-then-sync installation policy with app delegation. Retain only adapter duties, VS Code notifications, and temporary compatibility reads until migration evidence supports removal.

## Extension Migration Registry And Bookkeeping

**Health:** At risk

**Responsibility:** Runs named activation migrations and records pending/completed/skipped state in VS Code global state; retains extension-local storage through `VsCodeAppStorage`.

**Dependencies:** VS Code `globalState` and `globalStorageUri`.

**Migration role:** Existing lifecycle records provide an activation seam but need augmentation or an app-owned durable transfer journal before transparent cache migration can be considered recoverable.

## Collection Tooling And Publishing

**Health:** Healthy

**Responsibility:** Builds, validates, generates manifests for, and publishes collections.

**Dependencies:** Legacy `lib` scripts and repository tooling.

**Migration role:** Not directly on the target-write path; preserve manifest generation compatibility through focused fixtures.

## Documentation And Secure Delivery Controls

**Health:** At risk

**Responsibility:** Maintains contributor/user documentation and CI validation, security scanning, SBOM/license reporting, tests, and VSIX packaging.

**Dependencies:** Documentation site and GitHub Actions configuration.

**Migration role:** Update historical installation documentation only after manifest-less policy and migration behavior are approved. CI should gate parity and recovery tests.