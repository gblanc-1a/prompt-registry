# Code Structure

## Repository Shape

| Area | Responsibility | Migration relevance |
| --- | --- | --- |
| `packages/core` | Pure domain types, manifest validation, installation layout rules, port interfaces | Owns policy contracts; must not depend on VS Code or filesystem APIs. |
| `packages/infra` | ZIP extraction, XDG storage, target layouts, filesystem writers | Owns IO and target-layout adapters. |
| `packages/app` | Installation pipeline, registry orchestration, writer selection | Appropriate owner for shared install and migration use cases. |
| `packages/cli` | Clipanion commands and production composition | Already routes install behavior through shared packages. |
| `apps/vscode-extension` | Extension activation, services, UI, migrations, VS Code storage | Contains the compatibility path to replace by delegation. |
| `lib` | Legacy collection scripts | Not on the direct installation write path. |
| `docs` | Architecture, installation, contributor and user documentation | Historical installation-flow documentation needs later reconciliation. |

## Installation Slice

- `packages/core/src/domain/collection/manifest-validator.ts`: validates root manifest and governed archive inventory.
- `packages/core/src/domain/install/layout.ts`: domain installation layout rules.
- `packages/core/src/ports/app-storage.ts`, `bundle-extractor.ts`, `target-writer.ts`: boundaries for application state and IO.
- `packages/infra/src/extractors/zip-bundle-extractor.*`: ZIP-to-byte-map adapter with traversal protection.
- `packages/infra/src/storage/xdg-app-storage.*`: XDG bookkeeping adapter.
- `packages/infra/src/writers/default-layouts.*` and `repo-scope-writer.*`: concrete target layout and repository write behavior.
- `packages/app/src/install/install-bundle.ts`, `pipeline.ts`, `target-write.ts`: shared installation orchestration and target-write flow.
- `packages/app/src/writers/file-tree-writer.ts`: binary-safe target-file write and verification.
- `packages/cli/src/commands/install.ts`: CLI delivery adapter.
- `apps/vscode-extension/src/services/bundle-installer.ts`: extension-local buffer cache and special-case install bridge.
- `apps/vscode-extension/src/services/user-scope-service.ts` and `repository-scope-service.ts`: legacy second-phase synchronization.
- `apps/vscode-extension/src/services/registry-manager.ts`: extension registry integration boundary.
- `apps/vscode-extension/src/services/migration-registry.ts`: named migration lifecycle registry.
- `apps/vscode-extension/src/storage/vscode-app-storage.ts`: extension bookkeeping adapter.

## Observed Code Patterns

- Shared packages use dependency inversion through `core` ports and `infra` implementations.
- The app pipeline uses explicit phases and typed failure paths, including `TargetWriteRejectedError`.
- The extension uses service orchestration plus VS Code command registration and global-state migration records.
- The extension's installation duplication is a strangler-fig migration target, not a reason to add new domain rules to extension services.

## Coupling and Migration Hotspots

1. `RegistryManager.installBundle()` reaches an app registry use case but passes an extension-local `BundleInstaller.installFromBuffer()` callback, reversing the intended ownership of installation policy.
2. Extension scope services reopen cached manifests and consume only `manifest.prompts`; governed `items[]` remains the shared schema’s canonical representation.
3. `UserScopeService.unsyncBundle()` reconstructs the legacy cache path rather than using the installation record’s `installPath`, making post-migration update and uninstall behavior a compatibility hotspot.
4. Current migration registry completion is process-level and cannot alone encode per-transfer progress or interruption recovery.

## Recommendation Boundary

Keep new migration state transitions and idempotency rules in `packages/app`, with filesystem comparison and copying behind `core` ports and `infra` adapters. The extension should compose those dependencies and render VS Code-specific results without becoming another installation-policy owner.