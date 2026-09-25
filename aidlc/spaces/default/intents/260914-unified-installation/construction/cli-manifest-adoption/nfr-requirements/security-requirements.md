# Security Requirements — CLI Manifest Adoption (U2)

## Scope and boundary

U2 is a CLI delivery adapter. It parses commands, passes typed requests to the
shared lifecycle, and maps typed lifecycle results to terminal output and exit
codes. It does not download bundles, extract archives, resolve destinations,
write targets, manipulate managed artifacts, resolve ownership claims, or run
migration cleanup.

The requirements below protect CLI inputs, diagnostic output, result mapping,
and delegation boundaries. U1 owns archive, filesystem, ownership, and cleanup
controls.

## Security requirements

| ID | Requirement | Verification evidence | Upstream |
| --- | --- | --- | --- |
| NFR1.2 | U2 shall construct requests only through the shared application API. A single-bundle operation yields one typed request; declarative install yields one request per lockfile member; and `apply`/`profile activate` yield one request per expanded `(bundle, target)` member. None may directly mutate a target. | Command tests assert the correct per-member request count and no direct target-store or filesystem-target mutation. | NFR1 |
| NFR1.3 | U2 shall parse argv and lockfile paths through typed Clipanion command options and Node path handling. Bundle specifications are opaque data passed to U1; they shall not be interpolated into a shell command or evaluated as code. | Tests cover metacharacters, whitespace, Unicode, and malformed options; static review finds no shell execution path accepting a bundle specification. | NFR1 |
| NFR1.4 | U2 shall redact URL userinfo, query strings, fragments, authorization values, token-like fields, and home-directory prefixes before writing a bundle specification, repository identity, error, or result row to stdout, stderr, logs, or diagnostics. It shall preserve URL scheme/host/path, bundle identifier, target, and repository basename. | Formatting tests cover credentials in URL authority, signed-query URLs, bearer/token parameters, fragments, and ordinary local paths. | NFR1 |
| NFR1.5 | U2 shall map each lifecycle kind without reinterpretation: only `success` exits `0`; `validation-error` exits `2`; `conflict` exits `3`; `preserved-content` exits `4`; `retryable-failure` exits `5`; and `safety-blocked` exits `6`. | Table-driven command tests assert the code and redacted message for each kind. | NFR1, NFR4 |
| NFR1.1.1 | When U1 returns a containment, traversal, symbolic-link, ownership, or verification safety refusal, U2 shall report `safety-blocked` and exit `6`; it shall not retry, clear a claim, provide a hand-off, or touch target content. | Tests assert no further lifecycle call, no ownership hand-off, and code `6`. | NFR1.1 |
| NFR2.1 | U2 shall surface `retryable-failure` as a user- or script-directed retry opportunity with exit `5`. It shall not automatically retry against potentially changed target or legacy state. | Tests assert exactly one lifecycle call and code `5`. | NFR2 |
| NFR3.1 | U2 shall preserve Clean Architecture: commands are thin Clipanion delivery adapters over `packages/app`; lifecycle policy and I/O stay in shared packages. | Dependency and command tests confirm commands use the application façade and do not import target-store or registry implementations. | NFR3 |
| NFR4.1 | **Deferred — Contract 1 gap.** U2 shall report a conflict's destination and owning installation only when a declared U1 surface provides those details without caller-supplied destination paths. Until Contract 1 supplies safe conflict details on `LifecycleResult` or a U1-owned request-keyed diagnostic query, U2 shall report only the redacted bundle reference, `conflict` kind, exit `3`, and safe next action; it shall not duplicate target routing to manufacture diagnostics. | Contract test is added only after the shared surface exists; current tests assert no adapter-side routing/query attempt. | NFR4 |
| NFR4.2 | **Deferred — Contract 1 gap.** U2 shall mark a legacy import complete only after every entry has a durable `imported`, `already-present`, or `skipped-with-reason` disposition through a U1-owned import/reconciliation API and persistence boundary. Until that API exists, U2 shall not copy registry records or persist an import ledger itself. | Current tests assert the affected workflows remain blocked without a declared U1 API; restart tests are added when the API lands. | NFR4 |
| NFR4.3 | Declarative install shall preserve lockfile order, continue after a member failure, and stream one redacted result per member. It imposes no entry-count limit, as explicitly selected. It shall retain at most the active member plus aggregate counters in memory, limit each rendered result row to 2 KiB after redaction, and stop after the active member on `SIGINT`/cancellation with a non-zero interrupted outcome. No aggregate output ceiling is imposed; the accepted residual risk is a long terminal or CI log for intentionally large lockfiles. | Large-lockfile tests assert O(1) retained result state, source order, one row per member, cancellation at a member boundary, and per-row truncation. | NFR4 |

## Data handling

- Redaction applies before terminal output, result tables, exception wrapping,
  diagnostics, and test snapshots.
- Ordinary local paths remain useful for troubleshooting; only a home-directory
  prefix is replaced with `~` to avoid local-account disclosure.
- U2 never emits URL credentials, signed URL query values, tokens,
  authorization headers, or lifecycle-token internals.
- U2 creates no adapter-owned lifecycle outcome state. Deferred import
  bookkeeping remains outside U2 until the shared API is declared.

## Acceptance checks

- Correct request cardinality is observable for single, declarative, and
  composition commands, with no direct target mutation.
- No shell receives user-controlled bundle input.
- Every lifecycle kind has one stable, documented exit code.
- Output preserves useful non-secret context and excludes credential-bearing URL
  components or token-like values.
- Safety results are never bypassed and retryable results are never retried
  automatically.
- Unlimited declarative input is streamed with bounded retained state, a
  per-result output bound, and cancellation at an operation boundary.
- Deferred conflict and import workflows remain explicitly unavailable until
  their declared U1 contract surfaces exist.

## Upstream references

- `construction/cli-manifest-adoption/functional-design/functional-spec.md`
- `construction/cli-manifest-adoption/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
- `codekb/prompt-registry/technology-stack.md`
