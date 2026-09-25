# Technology Stack Decisions — Shared Installation Foundation (U1)

## Decision summary

U1 remains a TypeScript library in the shared packages. It uses Node's built-in
filesystem and cryptography APIs, retains `adm-zip` behind an infra adapter, and
adds no production dependency.

| Decision | Selection | Rationale |
| --- | --- | --- |
| Runtime and language | Node.js `>=24`, TypeScript `^5.9.3` | Existing workspace baseline with stable filesystem, path, crypto, and stream APIs. |
| Architecture | `core` ports, `infra` adapters, `app` use cases | Preserves Clean Architecture; delivery layers only translate inputs and results. |
| Artifact digest | Node SHA-256, lowercase hex | Stable byte-level integrity metadata with no dependency. |
| Verification-token authenticity | Node HMAC-SHA-256, ephemeral per-process key | Validates U1 issuance without making read-only verification mutate durable state. |
| Durable file replacement | temp file + file `fsync` + same-directory atomic `rename` + directory `fsync` where supported | One complete-file guarantee for target artifacts, registry records, journal entries, and claims. |
| Cross-store hand-off | XDG coordinator/WAL under the installation-key `mkdir` lock | Gives repository-lockfile and XDG claim changes recoverable ordering rather than pretending they form one filesystem transaction. |
| Registry storage | User records: XDG `AppStoragePort`; repository records: repository lockfile | Preserves current scope ownership and ADR-0005. |
| Journal/claim storage | XDG application storage for both scopes | One coordination namespace; lockfiles stay pure installation records. |
| Locking | `mkdir` lock directories with holder/time metadata | Portable atomic acquisition; stale metadata is diagnostic, never autonomous authority. |
| Archive reader | Existing `adm-zip` plus fixed, tightening-only admission limits | Hardens the existing adapter without a package migration. |
| Symlinks | Reject any symbolic-link component | Removes link-repoint ambiguity rather than accepting currently-contained links. |
| Tests | Vitest and existing `fast-check` as appropriate | Matches package tooling; supports port-boundary, fault-injection, and property tests. |

## Cross-store hand-off protocol

A target hand-off can change a repository lockfile and an XDG claim, which are
different persistence stores. Per-file atomic rename is necessary but does not
turn them into one atomic commit. U1 therefore implements a recoverable,
lock-serialized coordinator transaction in shared XDG storage:

1. Acquire the installation-key `mkdir` lock and validate the current
   destination ownership claim plus the ceding record's expected pre-image.
2. Atomically persist a coordinator record at phase `prepared`; it names the
   ceding/acquiring identities, destination, pre-image fingerprint, intended
   fingerprint, claim generation, and replay operation.
3. Atomically replace the ceding registry file to detach the artifact, then
   persist coordinator phase `ceding-detached`.
4. Atomically replace the XDG claim with `pending-materialization` for the
   acquiring identity, then persist phase `acquiring-pending`.
5. Materialize through the durable target-write primitive and perform read-back
   verification.
6. Atomically admit the acquiring artifact, finalize the claim, persist the
   coordinator completion, and clear the coordinator record.

On restart, U1 reacquires the same lock and reads the coordinator record. A
phase is replayed only if its expected pre-image still matches. If target bytes
were never verified, U1 compensates by restoring the ceding pre-image before it
releases the destination. If target bytes were verified, U1 completes the
remaining idempotent record/claim steps. A competing writer sees the lock or a
pending/rollback-required claim and returns `retryable-failure` or
`preserved-conflict`; it never treats the destination as unowned.

## Details

### Digest and token model

`crypto.createHash('sha256').digest('hex')` creates lower-case hexadecimal
artifact and manifest digests. It receives exact archive bytes for binary
content and exact transformed UTF-8 bytes for text.

U1 creates an ephemeral random key at lifecycle construction and uses
`crypto.createHmac('sha256', key)` over a canonical serialization of the
verification-token fields. The key is not persisted. A process restart
invalidates old tokens by design; resumption must perform a fresh current-byte
verification before it can authorise deletion.

### Archive admission limits

The selected defaults are 10,000 entries, 256 MiB total uncompressed bytes,
64 MiB per entry, and a 100:1 maximum regular-file compression ratio. An
`ArchiveSafetyLimits` configuration may only lower a limit. Missing, non-finite,
non-positive, or less-restrictive values make bundle validation fail before
extraction. The controls are enforced by the `adm-zip` infra adapter before any
entry is materialised for a target write.

### Durable writes and storage

All final writes use a temporary file in the destination parent directory,
`fsync`, same-filesystem `rename`, and best-effort supported directory `fsync`.
The coordinator protocol handles the remaining multi-file ordering and recovery
problem; it is not replaced by `.bak` files or an in-memory lock.

Repository-scope installation records stay in their repository lockfile. Cleanup
journals, destination claims, coordinator records, and locks live in shared XDG
application storage for both scopes. This supports multiple extension windows
without moving installation records or adding migration outcomes solely for
reporting.

## Consequences

### Positive

- No new production dependency is required.
- Target files cannot be observed torn at their final destination.
- Hand-offs have explicit durable ordering, recovery ownership, and crash-test
  points across both stores.
- U1 can reject forged or stale cleanup evidence while keeping verification
  read-only.

### Trade-offs

- `fsync` and coordinator records increase installation latency, but the work is
  bounded and safety-sensitive.
- A coordinator protocol is more complex than a single-store transaction and
  requires phase-specific crash tests.
- Rejecting any symlink can require a user to replace a local link before a
  target can be managed.
- `adm-zip` remains an eager parser; fixed limits must remain conservative and
  exercised in tests.

## Implementation guardrails

- Put filesystem, ZIP, storage, lock, and coordinator implementations in
  `packages/infra`; expose ports and domain state only from `core`.
- Keep use-case orchestration and typed-result mapping in `packages/app`.
- Do not add delivery-layer consent, notification, workspace enumeration, or
  network redirect behavior to U1.
- Never persist HMAC keys, raw token internals, archive payloads, credentials,
  or sensitive environment values.

## Upstream references

- `construction/shared-installation-foundation/functional-design/functional-spec.md`
- `construction/shared-installation-foundation/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
- `codekb/prompt-registry/technology-stack.md`
