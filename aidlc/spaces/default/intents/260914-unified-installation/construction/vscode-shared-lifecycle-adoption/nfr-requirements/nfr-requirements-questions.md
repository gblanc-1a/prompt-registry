# NFR Requirements Questions — VS Code Shared-Lifecycle Adoption (U3)

U3 is a `library` delivery adapter. This pass covers VS Code-safe presentation,
cancellation and lifecycle delegation. U1 remains responsible for target writes,
archive extraction, registry mutation, overwrite enforcement, and source
resolution.

## Q1. How much location detail should VS Code notifications show?

Conflict, preservation, and safety messages need to help a developer identify
the affected installation, but a full remote URL or absolute path can expose
credentials, signed queries, or a local username when copied to a bug report.

A. Show bundle name, target, scope, repository basename, and path relative to
   the workspace or home directory; redact URL userinfo, query strings,
   fragments, and token-like fields
B. Show full paths and URLs in VS Code notifications because they are local
C. Show only the bundle name and outcome kind; require a separate diagnostics
   command for location detail
D. Show the full path but redact URLs only

X. Other (please specify)

[Answer]: B

---

## Q2. What should happen when a user cancels an extension lifecycle command?

U3 must remain responsive while U1 may be resolving or writing a bundle. A
cancellation policy needs to avoid claiming that an operation stopped when a
shared write has already started, while still allowing the UI to stop waiting.

A. Pass a cancellation signal to U1; if cancellation arrives before a mutation,
   return a cancelled presentation; otherwise await U1's typed result, refresh
   the shared-registry projection, and report the actual final outcome
B. Immediately hide progress and report cancellation regardless of U1 state
C. Ignore cancellation once a command is started; always block the UI until U1
   returns
D. Cancel only source resolution; once U1 returns an archive, never allow a
   cancellation signal to reach it

X. Other (please specify)

[Answer]: A

---

## Q3. How should U3 represent the two unimplemented U1 contract deltas?

The functional design relies on U1 owning source resolution and returning a
conflict that accepts the shared `OverwriteDecision`. Neither surface exists in
the current U1 design/contract. U3 must not restore its cache-then-sync writer
or add an extension-only overwrite path while they are absent.

A. Mark both workflows unavailable with a clear capability message until the U1
   contract surfaces land; do not offer a degraded extension-only fallback
B. Keep the command available and use the old extension cache-then-sync path as
   a temporary fallback
C. Keep the command available but silently omit overwrite prompting and source
   resolution until U1 catches up
D. Implement source resolution in U3 now but defer only overwrite prompting

X. Other (please specify)

[Answer]: X - Give me more details about this what exact functional impact are those gap entitling ?


---

## Q3a. Contract-delta handling — final decision

The functional impact of the two missing U1 surfaces is now clarified:

- Without source resolution, U3 cannot accept a bundle specification that needs
  download/resolution because it must not restore the retired cache/extraction
  path.
- Without the shared overwrite decision, U3 can report a conflict but cannot
  safely ask for consent and re-invoke U1 to resolve it.

A. Mark affected install/update actions unavailable with a clear capability
   message until U1 supplies both contract surfaces; do not restore an
   extension-only fallback
B. Restore the old extension cache-then-sync writer temporarily
C. Keep actions available but silently omit source resolution and overwrite
   handling
D. Implement extension-owned source resolution now and defer only overwrite
   prompting

X. Other (please specify)

[Answer]: X — Delta B: U1 owns source resolution. Delta A: U1 returns a safe conflict path; U3 reports that path and manual remediation guidance, without an extension overwrite prompt or retry.


---

## Consolidated Summary Confirmation

Answers to be used for artifact generation:

- Q1 — VS Code notifications show full paths and URLs because the extension is
  used in a local development environment (B). Credential-bearing values remain
  subject to existing secret-handling rules.
- Q2 — U3 passes a cancellation signal to U1. Before any mutation it shows a
  cancelled presentation; after mutation begins it awaits U1's typed final
  result, refreshes the shared-registry projection, and reports the actual
  outcome (A).
- Q3 / Q3a — Delta B is assigned to U1: shared source resolution belongs in the
  shared lifecycle. Delta A is narrowed: U1 must return a safe conflict path;
  U3 reports that path plus manual remediation guidance and does not present an
  overwrite prompt or re-invoke with consent.

Prompt: Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
