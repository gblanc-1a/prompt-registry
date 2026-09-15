# API Documentation

## Delivery APIs

| Surface | Observed contract | Notes |
| --- | --- | --- |
| `ai-primitives-hub install` | Supports local `--from`, remote bundle/source, declarative `--lockfile`, interactive mode, `--target`, `--scope`, `--commit-mode`, `--dry-run`, and allowlisted targets | CLI is already composed around the shared install path. |
| VS Code commands | Includes `promptRegistry.installBundle`, update, uninstall, scope-move, and lockfile-cleanup actions | Commands enter services through extension activation and command wiring. |

## Shared Installation API

`installBundle()` and the installation pipeline compose injected `BundleResolver`, `BundleDownloader`, `BundleExtractor`, and target-writer factory ports. The observable sequence is resolve -> download -> extract -> validate -> filter governed installable files -> preflight -> write -> report.

`TargetWriteRejectedError` represents a rejected partial target write. A writer is not invoked after governed validation fails.

## Manifest Contract

- A root `deployment-manifest.yml` is required by the shared validator.
- A governed `formatVersion: 1` archive declares canonical paths, complete archive inventory, item identity/kind, installable versus metadata roles, byte size, and SHA-256 values.
- `items[]` is canonical in governed manifests; `prompts[]` is optional.
- Legacy manifests retain compatibility handling in shared code, but the CLI rejects an archive missing the root manifest with `BUNDLE.MANIFEST_MISSING`.

## Target and Storage Contracts

- User-scoped `vscode`, `vscode-insiders`, and `copilot-cli` layout entries resolve to `${HOME}/.copilot`.
- Repository scope uses a `.github` layout.
- `AppStorage` abstracts application bookkeeping. `XdgAppStorage` separates config, cache, and data.
- `VsCodeAppStorage` retains `context.globalStorageUri` for extension bookkeeping, which is distinct from the target directory.

## Extension Compatibility Contracts

| API or service | Current behavior | Migration risk |
| --- | --- | --- |
| `BundleInstaller.installFromBuffer()` | Builds a local pipeline around a downloaded buffer and writes to `globalStorageUri/bundles/<bundleId>` or a skills special case | Bypasses shared target-writer selection and synthesizes a fallback manifest when the root manifest is absent. |
| `UserScopeService.syncBundle()` | Reopens cached manifest, iterates `manifest.prompts`, and creates symlinks or copies | Valid `items[]`-only governed archives have no sync entries. |
| `RepositoryScopeService` | Reopens `manifest.prompts` and delegates individual placement to `FileTreeTargetWriter.writeManifestItems()` | Same schema split; repository routing requires parity coverage. |
| `MigrationRegistry.runMigration()` | Runs callback, then marks named migration completed in VS Code global state | Completion does not model per-bundle outcomes, interruption, or conflicts. |

## Contract Recommendations

1. Define an app-level migration contract that returns per-bundle/item status such as transferred, duplicate-equivalent, conflict, skipped, or retryable failure. These are proposed states, not confirmed current API values.
2. Require the extension adapter to translate its downloaded buffer and UI notifications into the same app install input and result contract used by the CLI.
3. Establish an explicit, tested policy for manifest-less archives before consolidating callers. Do not silently preserve the extension-only fallback.