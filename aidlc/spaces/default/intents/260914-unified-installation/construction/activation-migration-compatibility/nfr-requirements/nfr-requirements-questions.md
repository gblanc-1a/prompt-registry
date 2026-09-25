# NFR Requirements Questions — Activation Migration Compatibility (U4)

U4 is bounded compatibility code tagged `@migration-cleanup(activation-migration)`.
It is non-fatal, holds no durable outcome state, and delegates every target write
and destructive cleanup action to U1.

## Q1. What activation-time responsiveness budget should U4 meet?

Migration must run before bundle command handlers register, but migration failure
must not block extension activation. The requirements explicitly leave the
activation latency budget open. A concrete budget is needed to decide when U4
reports a pending/retry disposition and yields activation rather than waiting on
slow discovery, verification, or user interaction.

A. Complete non-interactive discovery and verification within 2 seconds at p95;
   do not wait for overwrite interaction during activation — report a manual
   action and continue activation
B. Complete within 5 seconds at p95; allow an overwrite prompt to block command
   readiness until the user answers
C. No measured budget; always complete the full migration attempt before
   activation can finish
D. Complete within 500 ms; skip any candidate requiring target verification or
   transfer

X. Other (please specify)

[Answer]: A

---

## Q2. How should U4 present preserved conflicts and retry-required outcomes?

The migration result is current-run only: it must identify the affected bundle
and artifact, explain whether content was preserved or needs retry, and provide
manual guidance without creating durable conflict state. This decision sets the
interactive presentation surface.

A. A non-modal VS Code warning notification plus a detailed Output-channel entry
   with full ordinary local paths/URLs and credential-bearing values redacted
B. A blocking modal dialog for every preserved conflict or retry-required item
C. Output-channel entry only; no notification
D. A silent telemetry event only

X. Other (please specify)

[Answer]: A


---

## Consolidated Summary Confirmation

Answers to be used for artifact generation:

- Q1 — Non-interactive discovery and verification complete within 2 seconds at
  p95. Activation never waits for overwrite interaction; it reports a manual
  action and continues.
- Q2 — Preserved conflicts and retry-required outcomes show as non-modal VS Code
  warnings and produce a detailed Output-channel entry. Ordinary local
  paths/URLs are present; credential-bearing values are redacted.

Prompt: Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
