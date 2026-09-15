# Business Overview

## Purpose

AI Primitives Hub distributes AI primitive bundles through a pnpm monorepo, a CLI, and a VS Code extension. A bundle has a root `deployment-manifest.yml`, content files, target/layout metadata, and installation records. The active intent is to plan one manifest-driven bundle installation path shared by the CLI and extension, with user-scoped Copilot output at `~/.copilot` and a transparent migration from extension-local bundle copies.

## Primary Capabilities Observed

- Validate bundle manifests and governed archive inventories before target writes.
- Resolve, download, extract, and install bundles through the CLI.
- Install and manage bundles through VS Code commands, registry services, and user or repository scopes.
- Route target files from data-driven layouts, including Copilot user-scope output at `${HOME}/.copilot` and repository output below `.github`.
- Track extension migration state in VS Code global state and persist extension bookkeeping below `context.globalStorageUri`.

## Migration-Relevant Finding

**Evidence:** The CLI uses the shared installation pipeline, while the extension first caches bundle content under `context.globalStorageUri/bundles/<bundleId>` and then performs a second sync phase. `UserScopeService` and `RepositoryScopeService` process `manifest.prompts`, whereas governed manifests treat `items[]` as canonical and `prompts[]` as optional.

**Impact:** A governed `items[]`-only archive can validate in the shared path but yield no extension sync entries. A shared path must demonstrate caller parity before extension callers are switched.

## Constraints

- `~/.copilot` and `~/.kiro` are target roots, not application registry roots.
- XDG `AppStorage` and `VsCodeAppStorage` represent application bookkeeping boundaries.
- Existing archive traversal rejection, governed inventory/hash validation, binary-safe writing, and read-back verification are security controls to preserve.
- Legacy cache deletion is not currently justified. It must remain disabled until completion, recovery, duplicate comparison, ownership, and test rules are specified.

## Sources

- `aidlc/spaces/default/intents/260914-unified-installation/inception/reverse-engineering/developer-scan.md`
- `AGENTS.md`
- `docs/contributor-guide/architecture/library-centric-architecture/clean-architecture.md`