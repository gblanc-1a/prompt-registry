# Technology Stack Decisions — Activation Migration Compatibility (U4)

## Decisions

| Decision | Selection | Rationale |
| --- | --- | --- |
| Execution | Inline during VS Code activation, before bundle handlers | Meets the migration ordering requirement. |
| Activation budget | 2 seconds p95 for non-interactive discovery and verification | Keeps activation responsive while still checking live migration state. |
| Conflict interaction | No activation-time wait for overwrite input | U4 records manual guidance and lets activation complete. |
| Notifications | Non-modal warning plus Output-channel detail | Visible without blocking activation; supports diagnostics. |
| Sensitive output | Full ordinary local paths/URLs; redact credentials, signed query values, and token-like data | Local troubleshooting without secret leakage. |
| Writes and cleanup | U1 lifecycle and `MigrationCleanupJournal` only | One safety and durability boundary. |
| State | No U4 durable outcome store | Recovery derives from current disk and U1 journal state. |
| Removal | `@migration-cleanup(activation-migration)` compatibility unit | Allows wholesale removal once migration is complete. |

## Consequences

- A slow or conflicted candidate cannot delay extension activation indefinitely.
- A user sees manual remediation guidance rather than an activation-blocking prompt.
- U4 cannot diverge from U1’s containment, verification, overwrite, or cleanup rules.
- Output remains useful for local diagnosis but omits credentials and tokens.

## Upstream references

- `construction/activation-migration-compatibility/functional-design/functional-spec.md`
- `construction/activation-migration-compatibility/functional-design/rules.md`
- `inception/requirements-analysis/requirements.md`
- `inception/contract-design/contract-summary.md`
