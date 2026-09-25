# Technology Stack Decisions — CLI Manifest Adoption (U2)

## Decision summary

U2 uses the existing TypeScript CLI stack. No delivery-layer I/O adapter is
introduced: Clipanion parses input, `packages/app` exposes use cases, and Node
formats output and exit status.

| Decision | Selection | Rationale |
| --- | --- | --- |
| Runtime and language | Node.js `>=24`, TypeScript `^5.9.3` | Existing repository baseline. |
| CLI framework | Existing Clipanion `4.0.0-rc.4` | Keeps commands as thin delivery adapters. |
| Lifecycle access | Public `packages/app` use cases and contract types | U2 delegates to U1 rather than importing `infra` target stores or registries. |
| Input handling | Typed argv parsing; opaque bundle references | Avoids shell interpolation, CLI-side download, and duplicate archive policy. |
| Presentation | Credential-focused redaction helper at the delivery boundary | Removes secrets while retaining useful location context. |
| Exit-code contract | `0/2/3/4/5/6` for success/validation/conflict/preserved/retryable/safety | Stable, small, project-owned scripting contract. |
| Declarative batch | Unlimited members; streaming execution/result rendering | Honors the explicit no-limit decision while bounding retained memory and each result row. |
| Conflict diagnostics | Deferred pending Contract 1 surface | U2 cannot query ownership after a bare `conflict` result without duplicating routing. |
| Legacy import | Deferred pending U1 import/reconciliation API | U2 cannot write registry records or an import ledger under the current contract. |
| Testing | Existing Vitest package and CLI integration tests | Table-driven result/redaction tests and fake app boundaries verify observable behavior. |

## Implementation details

### Redaction boundary

One formatting helper receives values before terminal rendering. It removes URL
authority userinfo, query strings, fragments, and credential/token-like fields,
and replaces a home prefix with `~`. It preserves ordinary paths plus URL scheme,
host, and path. The helper applies to success output, conflicts, errors, batch
rows, diagnostics, and exception fallback paths.

### Exit semantics

| Lifecycle result | Process exit |
| --- | --- |
| `success` | `0` |
| `validation-error` | `2` |
| `conflict` | `3` |
| `preserved-content` | `4` |
| `retryable-failure` | `5` |
| `safety-blocked` | `6` |

### Unlimited declarative batches with bounded process resources

The CLI deliberately has no entry-count limit. It expands lockfile members in
source order and processes them sequentially. It keeps only the active member
and aggregate counters, writes each redacted row immediately, and truncates a
rendered row to 2 KiB after redaction. An abort signal stops processing after
the active lifecycle call returns and exits non-zero with an interrupted
summary. This preserves a full per-member report without retaining an
unbounded result array.

The residual risk — a deliberately huge lockfile producing a long terminal or
CI log — is accepted by the explicit no-limit decision. U2 neither discards
member results nor adds a hidden aggregate-output ceiling.

### Deferred shared-boundary decisions

Contract 1 currently returns a bare lifecycle kind on conflict and requires a
caller to supply destination paths to `queryDestinationOwnership`. Since U2
must not route destinations, it cannot provide the promised destination/owner
diagnostic. This remains deferred until the shared result carries safe conflict
details or U1 supplies a request-keyed diagnostic query.

Likewise, the current contract declares no U1 registry import/write or
import-ledger operation for U2. The one-time legacy-import algorithm is a
functional-design intention but cannot be implemented in this delivery adapter
until U1 owns an explicit reconciliation API and persistence boundary. U2 must
not create a side-channel registry writer to bridge the gap.

## Consequences

### Positive

- Scripts receive deterministic exit codes without parsing prose.
- Local troubleshooting remains useful while output is safe to copy to logs.
- Large declarative activations do not accumulate result objects in memory.
- Adapter policy remains centralised in U1, including currently deferred work.

### Trade-offs

- An intentional unlimited batch can still create a long-running invocation and
  large terminal/CI log; the design bounds memory and row size, not total work.
- Credential-focused redaction needs maintained token-key detection and tests.
- Two U2 workflows remain blocked until Contract 1 grows the appropriate U1
  surfaces, rather than being implemented through adapter-side workarounds.

## Upstream references

- `construction/cli-manifest-adoption/functional-design/functional-spec.md`
- `construction/cli-manifest-adoption/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
- `codekb/prompt-registry/technology-stack.md`
