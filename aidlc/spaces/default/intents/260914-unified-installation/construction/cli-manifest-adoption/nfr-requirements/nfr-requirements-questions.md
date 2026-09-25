# NFR Requirements Questions — CLI Manifest Adoption (U2)

U2 is a `library` delivery adapter. Its non-functional requirements cover input
handling, outcome presentation, exit-code stability, and keeping lifecycle
policy in the shared foundation. It does not own target writes, archive
extraction, registry durability, destination ownership, or migration cleanup.

## Q1. What stable numeric exit-code mapping should scripts rely on?

The functional design requires a unique non-zero code for each shared lifecycle
outcome, but does not select the numbers. A stable mapping is necessary for CI
and automation to distinguish an invalid bundle from a conflict that needs user
consent, a retryable I/O failure, or a safety refusal.

A. Use POSIX-style generic codes: `2` validation-error, `3` conflict, `4`
   preserved-content, `5` retryable-failure, `6` safety-blocked
B. Use `1` for every non-success kind and keep the detail only in text output
C. Use sysexits-compatible values where practical: `64` validation-error, `73`
   conflict/preserved-content, `74` retryable-failure, `77` safety-blocked
D. Leave numeric codes implementation-defined; only zero/non-zero is stable

X. Other (please specify)

[Answer]: A

---

## Q2. Which values must U2 redact from human-readable output?

U2 receives user-provided bundle specifications and reports conflict details.
A bundle URL can carry credentials or a signed query string; a repository remote
can carry userinfo; and a filesystem path may reveal a local username. The CLI
needs enough detail for a user to identify the failing bundle and destination
without copying credentials into terminals, CI logs, or diagnostics.

A. Redact URL userinfo, query strings, fragments, authorization/token-like
   fields, and home-directory prefixes; show the scheme, host, path, bundle
   identifier, target, and repository basename
B. Redact only obvious secret parameter values, preserving complete URLs and
   absolute paths for easier debugging
C. Print original values by default; provide a future `--redact` flag for CI
D. Redact every URL and path completely; show only a generated correlation id

X. Other (please specify)

[Answer]: A

---

## Q3. How should declarative install bound one command invocation?

The CLI intentionally continues after individual bundle failures so it can
report a full per-bundle result table. Without a command-level bound, a malformed
or generated lockfile can create a very large, long-running sequence of shared
lifecycle calls and excessive terminal output. This is an adapter-level
reliability concern, not a new lifecycle policy.

A. Default to at most 100 bundle entries per invocation; reject a larger
   lockfile before any delegate call, with an explicit `--batch-size` override
   capped at 1,000
B. Default to at most 100 bundle entries; process larger lockfiles in chunks of
   100 and continue automatically, preserving lockfile order
C. No entry-count limit; the lockfile is trusted project input and each member
   is already independently validated by U1
D. Default to 20 entries and require an explicit `--allow-large-batch` flag for
   any larger lockfile

X. Other (please specify)

[Answer]: C

---

## Q4. What evidence makes the one-time legacy user-lockfile import complete?

The design says import is additive and runs at most once, but the completion
marker must not be written after a partially failed import — otherwise U2 would
silently stop retrying unresolved legacy entries. The marker is migration
bookkeeping for adapter records, not U1 target or cleanup state.

A. Persist `imported` only after every legacy entry was either imported,
   deliberately skipped with a durable reason, or already present in the shared
   registry; persist a per-entry result ledger with the marker
B. Persist `imported` after the first import attempt regardless of per-entry
   failures; users manually repair any unresolved entries
C. Never persist completion; rescan and reconcile the legacy lockfile on every
   user-scope command
D. Persist `imported` only when every entry imports successfully; any skipped
   ambiguous entry leaves the entire import pending forever

X. Other (please specify)

[Answer]: A

---

## Consolidated Summary Confirmation

Answers to be used for artifact generation:

- Q1 — Lifecycle outcomes use project-owned stable exit codes: `0` success,
  `2` validation-error, `3` conflict, `4` preserved-content, `5`
  retryable-failure, and `6` safety-blocked.
- Q2 — Human-readable output redacts URL userinfo, query strings, fragments,
  authorization/token-like fields, and home-directory prefixes while retaining
  the scheme, host, path, bundle identifier, target, and repository basename.
- Q3 — Declarative install has no adapter entry-count limit. It preserves
  lockfile order and delegates every member to the shared lifecycle.
- Q4 — The one-time legacy user-lockfile import is complete only after every
  entry was imported, deliberately skipped with a durable reason, or found
  already present in the shared registry; a per-entry result ledger persists
  with the completion marker.

Prompt: Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
