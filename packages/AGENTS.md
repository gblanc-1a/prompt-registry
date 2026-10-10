# Packages — Shared Domain (Ports & Adapters)

The four `@ai-primitives-hub/*` packages are the shared implementation behind both delivery layers (CLI and VS Code extension). Dependencies point inward only:

```text
CLI / Extension → app → infra → core
```

| Package | Role | May depend on | Never |
|---|---|---|---|
| `core` | Domain types, business rules, port interfaces | (nothing) | `infra`, `app`, `vscode`, direct `fs`/`http` |
| `infra` | Adapters implementing core's ports | `core` | `app`, `cli`, `vscode` |
| `app` | Use-case orchestration + public SDK surface | `core`, `infra` | `cli`, `vscode`; no business rules |
| `cli` | Thin Clipanion delivery adapter | `core`, `infra`, `app` | `vscode` |

## Rules

- Put domain logic and new port interfaces in `core`; keep it dependency-free (matches existing `ports/*.ts` style — no `vscode`, no `fs`).
- Implement external systems in `infra` behind a core port. Add a source adapter by copying one in `infra/src/adapters/`, implementing `SourceAdapter`, and wiring it into `app`'s `createSourceAdapter` switch.
- `app` orchestrates only — it composes ports and adapters, holds no business rules, and takes storage via the injected `AppStorage` port (never `vscode.ExtensionContext`).
- `cli` commands stay thin: parse/format I/O, delegate everything else to `app`. Clipanion is pinned exactly (`4.0.0-rc.4`, no `^`).
- Lockfile naming follows the dual-naming rule (ADR-0004) and is deliberately different per scope ([ADR-0008](../docs/contributor-guide/architecture/adr/0008-unified-bundle-deploy-and-lockfile-v3.md)). The CLI's **user-scope** state is the XDG pair `ai-primitives-hub.lock.json` (desired state) and `ai-primitives-hub.local.lock.json` (materialization), schema `3.0.0` only behind `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`; with the flag off it stays a single `2.0.0` file of the first name. The **repository** lockfiles keep `prompt-registry.lock.json` / `prompt-registry.local.lock.json` and the `2.0.0` schema until slice 3. Do not rename the repository files or "unify" the two sets of names.

## Commands

```bash
pnpm -C packages -r build
pnpm -C packages -r test
pnpm -C packages -r lint
```

Tests use Vitest. For a bug fix or feature: add a focused failing test in the owning package, make the minimal change, rerun, then run that package's suite.

## References

- [ADR index](../docs/contributor-guide/architecture/adr/adr-index.md) — the decisions these boundaries encode
- [Clean architecture](../docs/contributor-guide/architecture/library-centric-architecture/clean-architecture.md) and [codemap](../docs/contributor-guide/architecture/library-centric-architecture/codemap.md)
