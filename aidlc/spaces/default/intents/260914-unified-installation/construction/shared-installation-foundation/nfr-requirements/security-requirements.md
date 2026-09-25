# Security Requirements — Shared Installation Foundation (U1)

## Scope and identifier convention

U1 owns the governed installation lifecycle, registry boundary, cleanup journal,
and destination-ownership claims. It is a `library` unit: performance,
scalability, reliability, and observability artifacts do not apply because it
exposes no runtime service or UI surface.

The inception requirement `NFR1.1` already exists as **Migration filesystem
safety**, so derived controls use a stable, disjoint hierarchy: controls derived
from `NFR1` begin at `NFR1.2`; controls derived from `NFR1.1` use
`NFR1.1.<n>`; and controls derived from NFR2, NFR3, and NFR4 use their own
parent prefix. This avoids treating an inherited requirement and a U1 control as
the same traceability element.

## Security requirements

| ID | Requirement | Verification evidence | Upstream |
| --- | --- | --- | --- |
| NFR1.2 | U1 shall reject an archive before any target mutation unless exactly one root `deployment-manifest.yml` is present, its inventory exactly matches archive contents, every archive-relative path is contained and has no parent traversal, and every supplied item `contentHash` matches the archive bytes. | Tests cover missing, duplicate, mismatched, traversal-bearing, and hash-mismatched archives; each asserts no target-store call. | NFR1 |
| NFR1.3 | U1 shall accept only manifest items with a matching `installable` file record as write candidates and shall not resolve a destination for any other item. | Tests cover non-installable and missing-record entries and assert no routing or write. | NFR1 |
| NFR1.4 | U1 shall use Node's built-in `crypto` to compute SHA-256 digests in lowercase hexadecimal for manifest content hashes and installed-artifact fingerprints. The digest input is the exact archive bytes for binary content or the exact transformed UTF-8 bytes written for text. | Known-vector, binary, and transformed-text fingerprint tests. | NFR1 |
| NFR1.5 | Every governed target write shall be read back and compared byte-for-byte with its intended sequence before registry admission or `success`; a mismatch returns `retryable-failure`. | Fault-injecting target-store tests assert no artifact record after a mismatched read-back. | NFR1 |
| NFR1.6 | Before extraction or governed use, the `adm-zip` adapter shall reject an archive with more than 10,000 entries, more than 256 MiB total uncompressed data, an entry over 64 MiB uncompressed, or a regular-file compression ratio over 100:1. Directories are excluded from ratio evaluation. `ArchiveSafetyLimits` may be passed from application configuration only to tighten these limits; absent, non-finite, non-positive, or less-restrictive overrides are rejected as `validation-error` before extraction. | Exact-boundary and one-over-limit tests for defaults and tightening overrides; malformed override tests. | NFR1 |
| NFR1.7 | A manifest item is admissible only when it is a regular file or directory as appropriate to its role. U1 rejects symbolic links, device nodes, and unsupported ZIP entry types. | Archive fixture tests for each prohibited type. | NFR1 |
| NFR1.8 | U1 shall preserve locally changed content: it shall never overwrite a still-managed artifact without explicit consent, never delete a changed omitted artifact, and remove a preserved artifact from the managed set so uninstall cannot delete it later. | Lifecycle tests cover no-consent conflict, consented replacement, omitted changed content, and later uninstall. | NFR1 |
| NFR1.1.1 | U1 shall return `safety-blocked` before reading, writing, comparing, or deleting when an archive, target, or legacy path escapes its verified root or contains any symbolic-link component, even if the link currently resolves inside the root. | Filesystem integration tests cover traversal, absolute paths, link components, and legacy-source escapes; all assert no mutation. | NFR1.1 |
| NFR1.1.2 | Registry records, journal entries, ownership claims, and target artifacts shall use one durable replacement primitive: create a restrictive temporary file in the final parent directory, write complete bytes, `fsync` the file, atomically rename on the same filesystem, then `fsync` the parent directory where supported. Direct overwrite writes are prohibited. | Crash-injection tests show each final path is either the previous complete file or intended complete file, never partial content. | NFR1.1 |
| NFR1.1.3 | A destination hand-off spanning shared XDG claims and a repository lockfile shall use a durable coordinator record in shared XDG storage, guarded by the installation-key lock. The record contains immutable ceding/acquiring identities, destination, expected pre-images, claim generation, and phase. It persists `prepared` before removing the ceding record artifact; persists `ceding-detached` after that repository-lockfile replacement; persists `acquiring-pending` after the XDG claim replacement; and only finalizes after target read-back and acquiring-record admission. Recovery under the same lock replays the next idempotent phase or compensates the ceding pre-image when target materialization never occurred. It shall never expose two finalized owners, an unowned destination to a competing writer, or a completed hand-off without verified target bytes. | Crash injection immediately before and after every cross-store replacement; recovery asserts no dual owner, orphaned destination, or competing materialisation. | NFR1.1 |
| NFR1.1.4 | Journal and claim records shall live in the shared XDG application-storage directory for both scopes. Repository-scope installation records remain in the repository lockfile, which contains neither journal nor claim state. | Storage adapter tests assert resolved roots and lockfile schema. | NFR1.1 |
| NFR1.1.5 | U1 shall enforce exclusive access to each cleanup-journal installation key and destination hand-off using a `mkdir`-based XDG lock with holder and acquisition-time metadata. A second holder returns `retryable-failure`; stale lock recovery must re-read journal, claim, and target state before any destructive authority is restored. | Parallel tests permit exactly one holder; stale-lock tests reject timestamp-only takeover. | NFR1.1 |
| NFR1.1.6 | A cleanup verification token shall be HMAC-SHA-256 over installation key, journal entry id, generation, complete fingerprint set, read version, and issue time, with an ephemeral per-process key never exposed outside U1. | Tests reject changed fields, wrong generation, subset sets, and hand-minted unkeyed digests. | NFR1.1 |
| NFR1.1.7 | `verifyManagedArtifacts` shall remain read-only. A token is invalid when its entry changes generation or closes, it is redeemed, its complete artifact set differs, or U1's immediate fresh read no longer matches. Resumed cleanup requires a new verification before each deletion. | Contract tests assert verification performs no journal write and resumption re-verifies before removal. | NFR1.1 |
| NFR2.1 | Interrupted target materialization, journal cleanup, and cross-store hand-off shall resume only through the durable coordinator and current target/legacy-byte verification. A retry shall not overwrite target content without explicit consent or delete legacy content based on a prior run's evidence. | Restart tests across every coordinator phase and journal state. | NFR2 |
| NFR3.1 | U1 shall make no network call. Repository identity derives only from a normalized local remote URL or absolute workspace path; optional redirect resolution returns `skipped` when unavailable. | Network-denying fake tests and absent/unavailable port tests. | NFR3 |
| NFR3.2 | Lifecycle policy belongs in `packages/core`, `packages/app`, and `packages/infra` according to their responsibilities. CLI and VS Code adapters translate inputs and typed results only; they shall not duplicate validation, safety, migration, or locking policy. | Dependency-boundary checks and shared-use-case tests through both adapters. | NFR3 |
| NFR4.1 | Every typed conflict, preservation, retry, and safety outcome shall identify the affected bundle and artifact when available, describe the safe next action, and not create durable migration outcome or conflict state solely for reporting. | Result-schema and activation-summary tests. | NFR4 |

## Threat and control summary

| Threat | Primary controls |
| --- | --- |
| Archive traversal, hostile metadata, or archive bomb | NFR1.2, NFR1.6, NFR1.7, NFR1.1.1 |
| Symlink redirection or time-of-check/time-of-use race | NFR1.1.1 |
| Torn files or a crash during an ownership hand-off | NFR1.1.2, NFR1.1.3, NFR2.1 |
| Replayed, forged, stale, or incomplete cleanup evidence | NFR1.1.5, NFR1.1.6, NFR1.1.7 |
| Local content loss | NFR1.8, NFR2.1 |
| Delivery-adapter policy drift | NFR3.2 |
| Unsafe or opaque user-facing outcomes | NFR4.1 |

## Data handling

- SHA-256 fingerprints and manifest hashes are integrity metadata, not secrets.
- Per-process HMAC keys are process memory only; never persist, log, or return
  them.
- Strip remote-URL userinfo before persisting or reporting repository identity.
- Do not log archive payload bytes, token internals, credentials, or raw
  environment values.

## Upstream references

- `construction/shared-installation-foundation/functional-design/functional-spec.md`
- `construction/shared-installation-foundation/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
- `codekb/prompt-registry/technology-stack.md`
