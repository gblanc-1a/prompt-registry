# SourceAdapter API Reference

AI Primitives Hub normalizes collection sources through the `SourceAdapter`
port in `packages/core/src/ports/source-adapter.ts`. Concrete implementations
live in `packages/infra/src/adapters/` and are constructed by
`packages/app/src/registry/create-source-adapter.ts`.

The repository does not currently expose runtime registration of arbitrary
third-party adapter classes. Supporting another source type requires a code
change to the shared packages.

## Interface

```typescript
interface SourceAdapter {
  readonly type: string;
  readonly source: RegistrySource;

  fetchBundles(): Promise<Bundle[]>;
  resolvePortableBundle?(selection: PortableBundleSelection): Promise<PortableBundlePayload | null>;
  downloadBundle(bundle: Bundle): Promise<Buffer>;
  fetchMetadata(): Promise<SourceMetadata>;
  validate(): Promise<ValidationResult>;
  requiresAuthentication(): boolean;
  getManifestUrl(bundleId: string, version?: string): string;
  getDownloadUrl(bundleId: string, version?: string): string;
  downloadReadme(bundle: Bundle): Promise<string | null>;
  forceAuthentication?(): Promise<void>;
}
```

## Method Semantics

| Member | Current contract |
|---|---|
| `type` | Source-type identifier handled by the adapter |
| `source` | Normalized source configuration used to construct the adapter |
| `fetchBundles` | Return normalized bundle metadata available from the source |
| `resolvePortableBundle` | Optionally resolve a selection into its portable source descriptor, immutable resolution evidence, and verified files. `null` means the bundle is not found; an absent method is an unsupported capability, never permission to fall back to a mutable lookup |
| `downloadBundle` | Return the installable archive as a `Buffer` |
| `fetchMetadata` | Return source-level display and diagnostic metadata |
| `validate` | Return user-facing source validation details |
| `requiresAuthentication` | Indicate whether the configured source normally requires credentials |
| `getManifestUrl` | Return a URL/path for display or diagnostics |
| `getDownloadUrl` | Return a URL/path for display or diagnostics |
| `downloadReadme` | Return bundle README text, or `null` when unavailable |
| `forceAuthentication` | Optionally trigger delivery-supported reauthentication |

`downloadBundle` is the archive-download boundary used by the legacy adapter
pipeline. Even when a remote source exposes a ready-made ZIP URL, the adapter
downloads it and returns a buffer. The URL methods do not create a separate
URL-based install pipeline. The portable v3 lifecycle uses
`resolvePortableBundle` instead.

## Portable Resolution

The opt-in unified CLI lifecycle calls `resolvePortableBundle` with a
`PortableBundleSelection`. The selection may carry an expected source
descriptor, an exact prior resolution for replay, and a runtime-only
`localLocation` for workspace or named external bindings. A
`PortableBundlePayload` returns the canonical source descriptor, logical and
manifest IDs, version, resolution, and file inventory; adapters may also
return original source files or archive bytes for verification.

The method is optional for compatibility, but the portable caller requires it:
an adapter without it is rejected rather than silently using `fetchBundles`,
`downloadBundle`, or a newer/default revision. A missing bundle is distinct
from an unsupported adapter. Local external bindings resolve a name using the
active source configuration; their machine-specific root is runtime input and
must not be copied into shared desired state.

For the current portable CLI install path, GitHub release archives are
ZIP-only; tar and tar.gz assets are not supported. Tree and local-snapshot
adapters return verified files directly rather than relying on archive
extraction.

## Built-in Implementations

| Source type | Implementation | Portable v3 CLI status |
|---|---|---|
| `github` | `GitHubAdapter` | Supported for pinned GitHub release ZIPs |
| `local` | `LocalAdapter` | Supported for pinned local snapshots |
| `awesome-copilot` | `AwesomeCopilotAdapter` | Supported for pinned GitHub tree snapshots |
| `local-awesome-copilot` | `LocalAwesomeCopilotAdapter` | Supported for pinned local snapshots |
| `skills` | `SkillsAdapter` | Supported for pinned GitHub tree snapshots |
| `local-skills` | `LocalSkillsAdapter` | Resolves as live; copy-based CLI placement is refused until live-link support |
| `apm` | `ApmAdapter` | Not integrated into the portable v3 lifecycle |
| `local-apm` | `LocalApmAdapter` | Not integrated into the portable v3 lifecycle |
| `azure-devops` | `AzureDevOpsAdapter` | Adapter exists; portable v3 lifecycle integration is deferred |

The registry source union is broader than the Hub configuration schema. See
[Hub Schema](./hub-schema.md) before using a source type in
`hub-config.yml`. Adapter existence and portable identity or pin types do not
by themselves imply end-to-end support: Artifactory and VS Code extension
integration are also deferred from the current portable CLI lifecycle.

## Factory Dependencies

`createSourceAdapter` requires delivery-provided implementations of:

```typescript
interface SourceAdapterFactoryDeps {
  fs: FileSystem;
  clock: Clock;
  httpClient: HttpClient;
  processRunner: ProcessRunner;
  fallbackTokenProviders: readonly TokenProvider[];
}
```

This keeps VS Code and Node/CLI details outside the domain and infrastructure
implementations.

For sources with credentials, an explicit `source.token` is placed before
the delivery fallbacks in a `CompositeTokenProvider`. GitHub-hosted adapters
receive a `GitHubApiClient`; Azure DevOps receives an
`AzureDevOpsApiClient`.

## Adding an Adapter in This Repository

1. Extend the source type and configuration in `packages/core`.
2. Implement `SourceAdapter` in `packages/infra/src/adapters/`.
3. Export it from the infra adapter index.
4. Add the construction case to `createSourceAdapter` in `packages/app`.
5. Add tests for the adapter and factory case.
6. Update source configuration documentation.
7. Update the Hub schema separately if Hubs should accept the new type.

Do not register the adapter in an extension-only factory. Both delivery
layers use the shared application factory.

## See Also

- [Source Adapter Architecture](../contributor-guide/architecture/adapters.md)
- [Authentication](../contributor-guide/architecture/authentication.md)
- [Development Setup](../contributor-guide/development-setup.md)
- [Testing](../contributor-guide/testing.md)
