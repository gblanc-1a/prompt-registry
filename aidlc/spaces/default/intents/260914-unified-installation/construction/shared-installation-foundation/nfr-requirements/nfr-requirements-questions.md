# NFR Requirements Questions — Shared Installation Foundation (U1)

Unit kind: `library`. Only security requirements, technology-stack decisions and
traceability are produced for this unit, so these questions cover security
posture and technology selection only. Response-time, throughput, scaling and
observability targets belong to the units that expose a runtime surface.

Each question names the gap it closes. Six questions, all answerable from the
existing design plus your preference.

---

## Q1. Which hash do we use for artifact fingerprints and manifest content hashes?

The design says every managed artifact carries a fingerprint over "the bytes as
written to the target" (business rule BR3.3), and that a manifest item's
optional `contentHash` is recomputed from the archive bytes and must match
exactly before any write (BR1.3). Neither names an algorithm or an encoding, and
the fingerprint is what decides whether a file counts as locally changed — so it
has to be collision-resistant and stable across platforms and Node versions.

A. SHA-256, lowercase hex, via Node's built-in `crypto` — no new dependency,
   already the digest shape used elsewhere in this repository
B. SHA-512, lowercase hex, via Node's built-in `crypto` — larger digest, same
   dependency story, slower on small files
C. SHA-256 with an algorithm prefix stored in the record (`sha256:<hex>`) so a
   future migration to a different digest can be detected rather than guessed
D. BLAKE3 via a new dependency — fastest, but adds a native/wasm dependency to
   the shared packages
E. Size plus modification time rather than a content digest — cheapest, but
   cannot detect an edit that preserves both

X. Other (please specify)

[Answer]: A

---

## Q2. How is the one-shot cleanup verification token made tamper-evident?

Contract 3's safety amendment gives the cleanup verification token a
`signature` field and requires the shared lifecycle to reject an "absent, stale,
altered, wrong-entry, wrong-generation, subset, or non-current" token before it
will authorise any legacy deletion. Both sides of that boundary are TypeScript
running in the same process, so what the signature actually has to defend
against is a coding mistake in the migration coordinator — replaying a token,
hand-building one, or mutating its artifact list — not a remote attacker.

A. The shared lifecycle keeps an in-memory table of issued tokens and hands the
   caller an opaque single-use handle; the signature is a random identifier and
   redeeming it removes the entry, so replay is impossible by construction
B. HMAC-SHA-256 over the token's fields using a per-process random key the
   shared lifecycle never exposes — the token stays a plain serialisable value
   and validation is stateless
C. A plain SHA-256 digest over the token's fields with no secret — detects
   accidental mutation, but a caller could mint its own token
D. Both A and B: an opaque single-use handle whose payload is also HMAC-signed,
   so an interrupted run cannot resurrect a token from a log or a crash dump
E. Persist a single-use nonce in the journal entry itself, so validity survives
   a process restart and the token remains meaningful across a resumed run

X. Other (please specify)

[Answer]: B (initially undecided between C and E; committed in Q2a after the trade-off analysis)

---

## Q3. What write strategy makes target and registry writes crash-safe?

The migration filesystem safety requirement (NFR1.1) says destructive
transitions must be atomic or journaled so an interrupted cleanup cannot delete
unmanaged content or claim completion while managed legacy files remain, and
business rule BR5.2 says a journal state change must be durable *before* the
filesystem action it authorises. "Durable" needs a concrete technique, because a
plain `writeFile` can leave a half-written file after a power loss.

A. Write to a temporary file in the destination directory, `fsync` it, then
   `rename` over the destination — atomic on the same filesystem; apply to
   target artifacts, registry records and journal entries alike
B. Same as A, and also `fsync` the containing directory after the rename, so
   the rename itself survives a power loss (strictest, slowest)
C. Temporary file plus `rename` for the registry and journal only; write target
   artifacts directly, since read-back verification already detects a truncated
   write and the operation can simply be retried
D. Write everything directly and rely on read-back verification plus the
   journal to detect and repair an interrupted operation
E. Write everything directly, but keep a `.bak` copy of the previous registry
   and journal contents for manual recovery

X. Other (please specify)

[Answer]: A (initially undecided between C and E; committed in Q3a after the trade-off analysis)

---

## Q4. Where do journal entries and destination-ownership claims live, and what enforces exclusivity?

The shared foundation owns the cleanup journal's persistence boundary and the
destination-ownership claims, and business rule BR5.9 requires access to be
exclusive per installation — a second concurrent holder must be turned away with
a retryable failure rather than sharing the entry. Two VS Code windows open on
the same machine are the realistic concurrent case. Neither the storage location
nor the locking mechanism is decided yet.

A. Store both alongside the registry they reference (user-scope in the shared
   XDG application-storage directory, repository-scope in the repository
   lockfile), and enforce exclusivity with an `O_EXCL` lock file next to the
   record, carrying the holder's process id and a timestamp for stale detection
B. Same storage split as A, but enforce exclusivity with a `mkdir`-based lock —
   atomic on every filesystem including network shares, no reliance on
   `O_EXCL` semantics
C. Same storage split as A, with an advisory `flock`-style lock held for the
   duration of the operation — released automatically if the process dies, but
   unreliable on some network filesystems
D. Keep journal entries and claims in the shared XDG application-storage
   directory for *both* scopes, so one lock mechanism covers everything and the
   repository lockfile stays a pure installation record
E. Hold the lock only in memory within a single process and accept that two
   windows can race — simplest, and the read-back and verification checks are
   the real safety net

X. Other (please specify)

[Answer]: D

---

## Q5. How hard do we harden archive extraction, and with which library?

Bundle validation already rejects parent-traversal segments and paths outside
the archive root (BR1.4), which covers the classic zip-slip case. It says
nothing about a compressed archive that expands to an enormous size, an archive
with an unreasonable number of entries, or an entry that is a symbolic link or a
device node. The current extraction dependency, `adm-zip`, provides no such
limits and decompresses eagerly into memory.

A. Keep `adm-zip` and add explicit guards: cap total uncompressed bytes, cap
   entry count, cap per-entry uncompressed size, cap compression ratio, and
   reject any entry that is not a regular file or directory
B. Keep `adm-zip` and add the entry-type rejection only; treat size limits as
   unnecessary because bundles are produced by a trusted publishing pipeline
C. Replace `adm-zip` with a streaming reader (for example `yauzl`) so entries
   are validated and size-capped as they are read rather than after the whole
   archive is expanded in memory, plus the same guards as A
D. Do A now and record replacing the extraction library as a follow-up, so this
   unit lands without a dependency change
E. No additional limits; path containment plus the governed inventory is a
   sufficient boundary

X. Other (please specify)

[Answer]: A

---

## Q6. What is the policy when a destination path involves a symbolic link?

Business rule BR2.2 says a resolved destination is acceptable when it "resolves
inside the destination root after symbolic-link resolution", and BR5.7 sets the
same bar for legacy paths. Read literally, a symbolic link that happens to point
back inside the root is allowed. That is defensible, but it also means a link
created outside our control decides where our bytes land, and a link can be
re-pointed between the check and the write.

A. Reject any destination whose path contains a symbolic-link component,
   whether or not it resolves inside the root — simplest to reason about, and a
   link inside a managed tree is not something we create
B. Allow a symbolic link only when its fully resolved target is inside the
   destination root, exactly as the rule reads today
C. Allow a contained symbolic link, and additionally re-verify containment
   immediately before the write by opening the resolved path rather than the
   link, to close the re-point window
D. Reject symbolic links on the write path, but allow contained ones when only
   reading or verifying, so a user's own linking does not make verification
   report a false safety block
E. Reject any symbolic link anywhere in a destination or legacy path, and treat
   an encountered link as a safety block that is reported to the user with the
   offending path

X. Other (please specify)

[Answer]: A


---

# Follow-up questions

Q2 and Q3 were left undecided with a request for the trade-offs between options
C and E. The analysis was given in conversation; these two questions capture the
committed choice. The answers below supersede the hesitation recorded above.

## Q2a. Cleanup verification token — committed choice

Recap of the two options under consideration, plus the alternative the analysis
surfaced:

- C: plain SHA-256 digest over the token fields, no secret.
- E: persist a single-use nonce in the journal entry so validity survives a
  process restart.
- B: HMAC-SHA-256 over the token fields with a per-process key the shared
  lifecycle never exposes (from the original option set; keeps verification
  read-only while also making a hand-minted token impossible).

Option letters below are the same ones used in Q2, so there is one lettering
scheme across both questions.

C. Unkeyed SHA-256 digest; rely on the entry generation binding and the
   mandatory fresh re-read for replay protection
E. Persist a single-use nonce in the journal entry
B. HMAC-SHA-256 with a per-process key (recommended: same cost as C, closes the
   hand-minted-token hole, leaves `verifyManagedArtifacts` read-only)

X. Other (please specify)

[Answer]: B

## Q3a. Crash-safe write strategy — committed choice

Recap of the two options under consideration, plus the alternative the analysis
surfaced:

- C: temporary file plus atomic rename for the registry and journal only;
  target artifacts written directly and retried on a failed read-back.
- E: write everything directly, keeping a `.bak` copy of the previous registry
  and journal contents.
- A: temporary file plus atomic rename everywhere, including target artifacts
  (from the original option set).

Option letters below are the same ones used in Q3, so there is one lettering
scheme across both questions.

C. Atomic rename for registry and journal, direct writes for target artifacts
   (acceptable only if the brief window where a torn artifact file is visible to
   the target runtime is acceptable)
E. Direct writes everywhere plus `.bak` copies
A. Atomic rename everywhere, one uniform technique, no torn artifact ever
   visible at a destination (recommended)

X. Other (please specify)

[Answer]: A


---

## Consolidated Summary Confirmation

Answers to be used for artifact generation:

- Q1 — Artifact fingerprints and manifest content hashes use **SHA-256,
  lowercase hex, via Node's built-in `crypto`** (A). No new dependency; no
  algorithm prefix stored in the record.
- Q2 / Q2a — The one-shot cleanup verification token is made tamper-evident with
  **HMAC-SHA-256 over the token fields using a per-process random key the shared
  lifecycle never exposes** (B). Validation stays stateless, the token stays a
  plain serialisable value, and `verifyManagedArtifacts` remains read-only.
- Q3 / Q3a — Crash safety uses **temporary file, `fsync`, then atomic `rename`
  everywhere** (A): target artifacts, registry records and journal entries all
  use the same technique, so no torn file is ever visible at a destination.
- Q4 — Journal entries and destination-ownership claims live in **the shared XDG
  application-storage directory for both scopes** (D), so one lock mechanism
  covers everything and the repository lockfile stays a pure installation
  record.
- Q5 — Archive extraction **keeps `adm-zip` and adds explicit guards** (A): caps
  on total uncompressed bytes, entry count, per-entry uncompressed size and
  compression ratio, plus rejection of any entry that is not a regular file or
  directory.
- Q6 — Destination paths **reject any path containing a symbolic-link
  component** (A), whether or not it resolves inside the destination root.

Prompt: Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
