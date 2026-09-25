# Security Requirements — VS Code Shared-Lifecycle Adoption (U3)

## Scope and dependency posture

U3 is a VS Code delivery adapter. It composes commands, delegates to U1,
presents typed outcomes, and reads shared-registry projections. It does not
write targets, resolve destinations, extract bundles, mutate registry records,
or implement lifecycle policy.

Several desired behaviors are intentionally **deferred**: they conflict with the
already-approved U3 functional flow or lack a declared U1/U4 contract surface.
This document records the dependency rather than making U3 invent a fallback.

## Security requirements

| ID | Requirement | Verification evidence | Upstream |
| --- | --- | --- | --- |
| NFR1.2 | U3 shall invoke U1 for lifecycle operations and shall not restore the extracted-files cache or cache-then-sync writer. | Command tests assert U1 delegation and no target/cache write. | NFR1 |
| NFR1.3 | U3 shall treat bundle specifications as typed data and shall not resolve, download, extract, or execute them. | Tests assert no adapter-owned source-resolution path. | NFR1 |
| NFR1.4 | Notifications may show full ordinary local paths and URLs for interactive troubleshooting, but shall redact URL userinfo, bearer/token-like values, signed query parameters, and authorization fields. | Presentation tests cover ordinary paths, credential URLs, signed URLs, and tokens. | NFR1 |
| NFR1.1.1 | A U1 `safety-blocked` result is an error presentation with no cache fallback, retry, claim manipulation, or target mutation. | Tests assert no secondary action after safety failure. | NFR1.1 |
| NFR2.1 | **Deferred — U1 cancellation contract delta.** U3 may not claim cancellation was accepted before mutation until U1 accepts a cancellation input and returns an authoritative accepted-before-mutation outcome or boundary acknowledgement. Until then it awaits existing U1 outcomes and never represents a requested cancellation as completed cancellation. | Contract tests are added after U1 exposes the input/result boundary. | NFR2 |
| NFR3.1 | Shared application data resolves through injected `AppStorage`; `ExtensionContext.globalStorageUri` is VS Code-local only. U3 keeps the ports-and-adapters dependency direction. | Injected-AppStorage tests and dependency checks. | NFR3 |
| NFR4.1 | **Deferred — U3 functional/contract revision required.** The current approved U3 functional flow prompts and re-invokes U1 with `OverwriteDecision`; the later user direction is manual conflict guidance with a safe path and no retry. U3 shall not implement either revised behavior until the functional spec, BR4.1–BR4.2, and U1-to-U3 contract are revised together. The revision must specify the safe conflict-path result and remove the overwrite prompt/re-invocation coherently. | Revised functional/contract tests after the upstream decision is formally changed. | NFR4 |
| NFR4.2 | **Deferred — U1 source-resolution delta.** Source resolution and download belong to U1. U3 shall not restore an extension-only cache/download fallback. | No-resolution-path tests; U1 integration tests after the contract lands. | NFR4 |
| NFR4.3 | Installation-state readers use the shared-registry read-only projection, never a retired cache or a separate extension store. | Tree, marketplace, and update-service integration tests. | NFR4 |
| NFR4.4 | **Deferred — U1/U4 reconciliation boundary.** U3 legacy-record reconciliation needs a U1/U4 application API that owns registry mutation, deterministic target/repository resolution, and durable import state. Until it exists, U3 must not directly copy records, mark imports complete, or create a registry-policy workaround. | Boundary tests after the reconciliation API is declared. | NFR4 |

## Data handling and acceptance checks

- Full ordinary local locations are suitable for VS Code UI diagnostics; secrets
  and signed-token values remain redacted.
- U3 persists no lifecycle outcome or installation authority.
- Every current U3 command delegates to U1 and has no target/cache mutation path.
- Deferred behaviors remain unavailable rather than receiving adapter-side
  substitutes.

## Upstream references

- `construction/vscode-shared-lifecycle-adoption/functional-design/functional-spec.md`
- `construction/vscode-shared-lifecycle-adoption/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
- `codekb/prompt-registry/technology-stack.md`
