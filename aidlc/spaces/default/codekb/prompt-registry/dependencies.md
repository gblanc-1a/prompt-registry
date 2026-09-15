# Dependencies

## Internal Dependency Direction

```text
CLI and VS Code extension -> app -> infra -> core
                                   -> core
```

The scan reports that `core` has no internal package dependency, `infra` depends only on `core`, and `app` imports `core` and `infra`. CLI and extension depend on shared packages. New migration logic should preserve this direction.

## Installation Dependencies

| Consumer | Dependency | Purpose |
| --- | --- | --- |
| `app` install pipeline | `BundleResolver`, `BundleDownloader`, `BundleExtractor`, target-writer factory | External operations through explicit ports. |
| Infra ZIP adapter | `adm-zip` | Archive extraction after path normalization and traversal rejection. |
| Infra writers/layouts | Node filesystem and layout configuration | Concrete target routing and byte writes. |
| CLI install command | App installation use case plus production context | Delivery composition and terminal interaction. |
| Extension registry manager | App registry use case plus `BundleInstaller` callback and registry storage | Current inversion that preserves extension-local installation policy. |
| Extension scope services | Cached manifest files, layout resolution, `FileTreeTargetWriter` | Current second target-write phase. |
| Extension migrations | VS Code `globalState` and global storage | Existing migration lifecycle and legacy state. |

## External Security-Sensitive Dependencies

- ZIP extraction is constrained by archive path normalization and traversal rejection.
- YAML parsing supplies manifest and layout values; validation must occur before writes.
- Filesystem adapters govern containment, symlink behavior, raw-byte copying, and integrity verification.
- CI runs Trivy/CodeQL, SBOM generation, and license reporting in the extension secure workflow.

## Dependency Constraints For Migration

- Do not introduce a dependency from `core` to VS Code or direct filesystem APIs.
- Do not make `~/.copilot` or `~/.kiro` a registry location; they remain resolved targets.
- Do not retain a second extension writer-policy dependency after a verified switchover.
- Keep legacy global-storage reads available during migration until durable outcome records make update, uninstall, and retry behavior unambiguous.