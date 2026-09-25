# Technology Stack Decisions — VS Code Shared-Lifecycle Adoption (U3)

## Decision summary

U3 remains a thin TypeScript VS Code adapter over shared application use cases.
No U3-only lifecycle, registry, cache, download, overwrite, cancellation, or
reconciliation implementation is introduced.

| Decision | Selection | Rationale |
| --- | --- | --- |
| Extension platform | VS Code Extension API `^1.105.0` | Existing delivery boundary. |
| Runtime/language | Node.js `>=24`, TypeScript `^5.9.3` | Existing workspace baseline. |
| Shared storage | Injected `AppStorage` port | Preserves ADR-0005. |
| Presentation | Full ordinary local paths/URLs, credential-bearing values redacted | Local diagnostics without leaking secrets. |
| Lifecycle access | `packages/app` typed use cases | Keeps U3 out of infra and policy. |
| Cancellation | Deferred to U1 contract | A truthful pre-mutation cancellation result needs U1 authority. |
| Conflict flow | Deferred to functional/contract revision | Current approved prompt/retry design conflicts with the later manual-guidance direction. |
| Source resolution | U1-owned and deferred | No cache/download fallback in U3. |
| Legacy reconciliation | U1/U4-owned and deferred | U3 cannot mutate the shared registry or own import policy. |
| State readers | Shared-registry projection only | Retires cache readers and duplicate installation state. |

## Dependency decisions

The user-selected manual conflict guidance is an intentional product decision,
but it changes the earlier approved U3 prompt-and-retry workflow. The NFR stage
does not silently rewrite that prior contract. A targeted revision must align:

1. the U3 functional spec and BR4.1–BR4.2;
2. the U1-to-U3 result shape carrying a safe conflict path; and
3. the removal of `OverwriteDecision` re-invocation from U3.

U1 also needs explicit cancellation semantics before U3 can distinguish an
accepted cancellation from one that races with a mutation. Legacy extension
records need an application-level U1/U4 reconciliation boundary before U3 can
move them into the shared registry. These are blocked dependencies, not
extension-side workarounds.

## Consequences

- U3 keeps a single shared lifecycle and registry authority.
- Users can inspect local ordinary paths and URLs in notifications without
  exposing credential-bearing values.
- The revised manual-conflict direction, truthful cancellation, and legacy
  import remain unavailable until their upstream contracts are made explicit.

## Upstream references

- `construction/vscode-shared-lifecycle-adoption/functional-design/functional-spec.md`
- `construction/vscode-shared-lifecycle-adoption/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
