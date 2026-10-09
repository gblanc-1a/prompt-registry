# Unified Bundle Lifecycle — Step 0 + Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design's Step 0 prerequisites and Slice 1 — a complete, hand-verifiable CLI user-scope install and uninstall for the `vscode` target, writing lockfile `3.0.0` behind the `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` flag, with the XDG user lockfile's v2→v3 shape migration.

**Architecture:** A new `packages/app/src/deploy/` module owns the shared deploy pipeline (`planDeploy` / `deployBundle` / `undeployBundle`), composing pure domain policy from `core` (kind routing, naming, logical bundle key, lockfile version gate) with injected ports. The CLI's three inline install branches and its user-scope uninstall gain a flag-on path that delegates to `deploy`; the legacy path stays byte-for-byte unchanged with the flag off. Dependencies point inward only: `cli` → `app` → `infra` → `core`.

**Tech Stack:** TypeScript (Node 24+, pnpm 11+), Vitest for `packages/`, Clipanion 4.0.0-rc.4 for the CLI, `semver`, `js-yaml`.

**Spec:** [`docs/superpowers/specs/2026-10-09-unify-bundle-lifecycle-design.md`](../specs/2026-10-09-unify-bundle-lifecycle-design.md) and [`...-requirements.md`](../specs/2026-10-09-unify-bundle-lifecycle-requirements.md) (committed at `fe1615a2`). Read §2 (delivery constraints), §3.1, §4.1–§4.7, §5.1–§5.3, §5.7, §5.8, §5.12, §5.13, §8.3, §8.4, §10, §11 before starting.

## Global Constraints

- Node 24+, pnpm 11+. Clipanion is pinned exactly to `4.0.0-rc.4` — never add a `^`.
- Dependency direction is absolute: `core` depends on nothing (no `infra`, no `app`, no `vscode`, no `node:fs`); `infra` depends only on `core`; `app` depends on `core` + `infra` and holds **no business rules**; `cli` commands stay logic-free and delegate to `app`.
- Feature flag, CLI surface: env var `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`, default **off**. Accepted truthy values `1`, `true`, `yes`; falsy `0`, `false`, `no`, empty, unset; anything else throws — exactly mirroring `parseGitHubAppAuthEnabled` (`packages/infra/src/harvest/github-source-auth-runtime.ts:100`).
- Lockfile schema version written by the flag-on path: the exact string `"3.0.0"`. The flag-off path keeps writing `"2.0.0"`.
- Dual naming (ADR-0004) is deliberate: the repository-scope lockfile stays `prompt-registry.lock.json`, extension identifiers stay `AmadeusITGroup.prompt-registry`, command ids stay `promptregistry.*`. Do not rename them in this plan. The CLI's XDG user lockfile is already `ai-primitives-hub.lock.json` (`packages/app/src/registry/user-config-paths.ts:63`) — its **filename does not change**, only its contents' shape.
- On-disk roots resolve through injected ports (`AppStorage`, `FileSystem`), never `vscode.ExtensionContext.globalStorageUri` and never direct `node:fs` in `core`/`app`.
- `path` in a v3 materialization record is the **on-disk** path, POSIX-normalized, relative to the record's root — the resolved `baseDir` for user scope (§5.7). Never bundle-relative.
- Two checksums (§5.8): `installedChecksum` = SHA-256 of the bytes actually written (post-transform), required for every managed record; `checksum` = SHA-256 of the source archive bytes for that file, optional provenance.
- Logical bundle key is `{sourceId}/{manifestId}`, **always**, at every scope and in every file (§5.13). No single-source shorthand.
- Use `Logger.getInstance()` rather than `console.log` in extension code; in `packages/` use the injected `onEvent`/`LogSink` seams. Errors must be actionable.
- Always run lint with `:fix` (`pnpm -C packages -r lint:fix`), and do not run the non-fixing variant afterwards.
- Every task ends with a commit. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).

## Review Focus

Input classes the spec implies that no task's happy path exercises. Each has a test pinned to the task that owns the code, listed here once so the whole set is visible:

1. **A v3 lockfile read by flag-off code.** The gate must fire on read *before* any parse-dependent access, and the subsequent write must not happen at all — not "happen with a re-stamped version". Pinned to Task 1 and re-asserted end-to-end in Task 15.
2. **A custom `kindRoutes` key that `routeToKind` does not recognize.** Not ambiguous — simply unknown. It must be *reported*, not silently dropped, and it must not be confused with the ambiguity failure. Pinned to Task 2.
3. **A manifest id whose normalized form collides with another item's**, and an id that is a YAML-parsed number. `normalizePromptId` maps `foo.bar` and `foo-bar` to the same name; two items can therefore target one file. Pinned to Task 3.
4. **A `sourceId` or `manifestId` containing `/`.** The key is `{sourceId}/{manifestId}`, so a slash in either half makes the key ambiguous on parse. Pinned to Task 4.
5. **An interrupted XDG migration** — the file was read as v2, converted in memory, and the process died before the write landed; and the inverse, a half-written file. Re-running must converge, and a v2 file must never be partially rewritten. Pinned to Task 8.

## Scope Notes and Stated Assumptions

Three places where the design leaves a choice the implementation must make. Each is a deliberate decision, recorded here so a reviewer can reject it explicitly:

1. **The role split applies at both scopes — §5.1 is amended.** The design said "User scope keeps one XDG file, `ai-primitives-hub.lock.json`, carrying both roles — it is machine-local by nature, so the split buys nothing there." **That is overruled by requester decision (2026-10-09):** the two scopes must function identically, differing only in where they are rooted. So user scope gets the same two files, same shapes, same role boundary:

   | Role | Repository scope (slice 3) | User scope (this plan) |
   |---|---|---|
   | Desired state — `bundles`, `sources`, `hubs?`, `profiles?` | `<repo>/ai-primitives-hub.lock.json`, committed | `<xdg>/ai-primitives-hub/ai-primitives-hub.lock.json` |
   | Materialization — `targets`, `generatedAt`, `generatedBy`, `migration?` | `<repo>/ai-primitives-hub.local.lock.json`, git-excluded | `<xdg>/ai-primitives-hub/ai-primitives-hub.local.lock.json` |

   Consequences that change this plan rather than just its wording:

   - The user-scope **desired** file carries §5.2's shape exactly — including **no** `generatedAt` and **no** `generatedBy`. Those live only in the local file, which is what §5.2 already says ("Both fields stay in the local file, where churn is invisible"). That makes the desired file byte-comparable at both scopes, which is the property §8.1's two-developers-same-content promise rests on; there is now no scope at which it is weaker.
   - §5.2's `required: ["generatedAt", "generatedBy", ...]` finding in Scope Note 2 is therefore **load-bearing for slice 1**, not deferred to slice 3: the user-scope desired file is the first v3 file written, and it omits both. Task 1 Step 9 is upgraded accordingly.
   - §8.4's write/delete ordering applies to the user-scope migration too (Task 8), in its degenerate form: there is one legacy user file and it keeps its name, so the sequence is write the new local file → rewrite the desired file in place as v3 → set the completion marker. No legacy deletions, same hazard — the schema changes under an unchanged filename, which is exactly why §5.12's version gate is a prerequisite.
   - `resolveUserConfigPaths` gains `userLocalLockfile`.

   The honest cost of the overrule: two files at a scope where one would have done, and a two-file write that is not one filesystem transaction (§8.4's hazard, now present at user scope). The benefit is that slices 3 and 6 inherit one store, one migration shape and one set of tests instead of two, and nothing about "how state works" depends on which scope you are in.

2. **A factual correction to §5.12.** The spec says "`lockfile.schema.json:28` enumerates `"2.0.0"` as the only allowed version, so `3.0.0` fails wire-format validation before any of this is reached." That is not what the file contains: `version` is `{"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$", "examples": ["2.0.0"]}` in `packages/core/src/public/schemas/lockfile.schema.json:23` — which is the only real copy (see the schema-copies note below). `"3.0.0"` therefore already validates. The real wire-format blocker for v3 is `required: [..., "generatedAt", "generatedBy", ...]`, which the v3 **desired** file omits — and after Scope Note 1's amendment that file exists at user scope, so the blocker lands in **this** plan, not slice 3. Task 1 therefore pins the behavior with a test instead of widening a non-existent enum, splits `required` per role in the schema, and records the correction in the spec.

3. **Slice 1 includes a minimal v3-aware `install --lockfile` replay.** §11 scopes slice 1 to "CLI user-scope install and uninstall", but `detectInstallContext` (`packages/cli/src/commands/install.ts:483`) auto-selects the lockfile branch when no bundle is named, and `findProjectLockfile` falls back to the XDG user lockfile (`packages/cli/src/framework/target.ts:78`). Once slice 1 has written v3 there, a flag-on bare `install` would hit the version gate and fail — a capability regression inside the flag-on window, which §2's bridge rule forbids. Task 13 therefore teaches the replay branch to read v3 desired state and deploy through `deploy`. This is the smallest addition that keeps install → replay → uninstall coherent for the slice's own surface.

## File Structure

**`packages/core`** — pure domain policy, no IO:

| File | Responsibility |
|---|---|
| `src/domain/install/lockfile-version.ts` (new) | The §5.12 version gate as pure policy: parse a lockfile's `version`, classify it as readable/unknown-major, and build the actionable error message. |
| `src/domain/primitive/route-kinds.ts` (new) | `ROUTE_PREFIX_KINDS` + `routeToKind`, moved out of `app`'s writer and made public; plus `invertKindRoutes`, which turns a resolved layout's `kindRoutes` into `Map<PrimitiveKind, string>` with explicit ambiguity and unknown-key diagnostics (§4.3, §4.7). |
| `src/domain/install/copilot-file-type.ts` (modify) | Gains `copilotFileTypeForKind` (canonical `PrimitiveKind` → Copilot alias) and `targetFileNameForKind`, which normalizes the id once for every caller (§4.4, §4.7). |
| `src/domain/bundle/logical-key.ts` (new) | `logicalBundleKey`, `parseLogicalBundleKey`, and legacy-alias resolution from a version-bearing extension id or a bare CLI `manifest.id` (§5.13). |
| `src/domain/install/placement.ts` (new) | Manifest-item normalization: both manifest formats → `NormalizedPlacementItem[]`, and the pure kind → destination-path function the deploy module and verification share (§4.1, §4.6). |
| `src/ports/filesystem.ts` (modify) | Adds the non-optional link-identity capability: `lstat` returning `FileStat & { isSymbolicLink: boolean }` (§3.2, §4.8). |

**`packages/infra`** — adapters:

| File | Responsibility |
|---|---|
| `src/fs/node-filesystem.ts` (modify) | Implements `lstat` via `node:fs/promises`' `lstat`. |
| `src/flags/unified-deploy.ts` (new) | `parseUnifiedDeployEnabled` / `isUnifiedDeployEnabled`, following the `isGitHubAppAuthEnabled` precedent. |

**`packages/app`** — use-case orchestration:

| File | Responsibility |
|---|---|
| `src/stores/lockfile-v3.ts` (new) | The v3 wire types for **both** role files, scope-agnostic: `emptyDesiredLockfileV3` / `emptyLocalLockfileV3`, gated readers, and an atomic writer with a unique temp name (§8.4). Nothing in it knows whether it is running at user or repository scope — the caller supplies the two paths. |
| `src/stores/json-lockfile-store.ts` (modify) | `readLockfile` applies the version gate before returning; writers refuse to re-stamp a version they did not understand. |
| `src/stores/migrate-lockfile-v3.ts` (new) | The one-way v2→v3 shape migration (§8.3 last paragraph) and §8.4's ordering, as a pure converter plus a resumable apply step. Parameterized by the file pair, so slice 3 reuses it for the repository pair instead of writing a second one. |
| `src/registry/user-config-paths.ts` (modify) | Gains `userLocalLockfile`. |
| `src/deploy/types.ts` (new) | `DeployRequest`, `PlacementContext`, `DeployPlan`, `UndeployRequest`, `DeployResult`, `DeployPorts`. |
| `src/deploy/plan.ts` (new) | `planDeploy` — read-only, no writes through any port. |
| `src/deploy/deploy.ts` (new) | `deployBundle` / `redeployBundle` — place, then record, in that order. |
| `src/deploy/undeploy.ts` (new) | `undeployBundle` — removes exactly the recorded paths. |
| `src/deploy/index.ts` (new) | Barrel. |

**`packages/cli`** — thin delivery:

| File | Responsibility |
|---|---|
| `src/commands/install.ts` (modify) | Flag-on branch for `--from` (local), remote, and lockfile replay at user scope; delegates to `deploy`. |
| `src/commands/uninstall.ts` (modify) | Flag-on branch for user-scope uninstall; delegates to `undeployBundle`. |
| `src/deploy-wiring.ts` (new) | Builds `DeployPorts` and `PlacementContext` from a CLI `Context` + `Target`. One place, shared by install and uninstall, so the two cannot drift. |

**Tests** mirror source paths: `packages/core/test/domain/...`, `packages/app/test/{stores,deploy}/...`, `packages/cli/test/commands/...`. Slice 1's end-to-end coverage lands in `packages/cli/test/commands/unified-deploy-user-scope.test.ts`, driven through the registered command classes with `runCommand`, a real `NodeFileSystem` and a real temp directory — the existing pattern at `packages/cli/test/commands/install.test.ts:64`.

---

## Step 0 — Prerequisites

§11 exempts Step 0 from the vertical-slice rule: these five tasks are additive and behavior-neutral with the flag off. Nothing in Slice 1 may merge before all of them.

### Task 1: Lockfile schema version gate

The §5.12 prerequisite. Every read checks the version first; a known major parses, an unknown major fails loudly and no write proceeds.

**Files:**
- Create: `packages/core/src/domain/install/lockfile-version.ts`
- Create: `packages/core/test/domain/install/lockfile-version.test.ts`
- Modify: `packages/core/src/domain/index.ts` (add the barrel line)
- Modify: `packages/app/src/stores/json-lockfile-store.ts:193-199` (`readLockfile`) and `:207-217` (`writeLockfile`)
- Test: `packages/app/test/stores/json-lockfile-store.test.ts`
- Modify: `packages/core/src/public/schemas/lockfile.schema.json` (add `"3.0.0"` to the `version` property's `examples`) — **and nothing else**; see the schema-copies note below
- Modify: `docs/superpowers/specs/2026-10-09-unify-bundle-lifecycle-design.md` §5.12 (the enum correction from Scope Note 2)

**Interfaces:**
- Consumes: nothing.
- Produces: `KNOWN_LOCKFILE_MAJORS: readonly [2, 3]`, `type LockfileVersionVerdict = { kind: 'readable'; major: number } | { kind: 'unknown-major'; major: number } | { kind: 'malformed'; raw: unknown }`, `classifyLockfileVersion(raw: unknown): LockfileVersionVerdict`, `lockfileVersionErrorMessage(file: string, verdict: LockfileVersionVerdict): string`, `UnsupportedLockfileVersionError` (extends `Error`, carries `code = 'LOCKFILE.UNSUPPORTED_VERSION'`, `file`, `major`).

- [ ] **Step 1: Write the failing core test**

Create `packages/core/test/domain/install/lockfile-version.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  classifyLockfileVersion,
  lockfileVersionErrorMessage,
} from '../../../src/domain/install/lockfile-version';

describe('classifyLockfileVersion', () => {
  it('accepts the two known majors', () => {
    expect(classifyLockfileVersion('2.0.0')).toEqual({ kind: 'readable', major: 2 });
    expect(classifyLockfileVersion('3.0.0')).toEqual({ kind: 'readable', major: 3 });
  });

  it('accepts a higher minor or patch inside a known major', () => {
    expect(classifyLockfileVersion('3.4.1')).toEqual({ kind: 'readable', major: 3 });
  });

  it('reports an unknown major rather than coercing it', () => {
    expect(classifyLockfileVersion('4.0.0')).toEqual({ kind: 'unknown-major', major: 4 });
  });

  it('reports a malformed version instead of guessing', () => {
    expect(classifyLockfileVersion('two')).toEqual({ kind: 'malformed', raw: 'two' });
    expect(classifyLockfileVersion(2)).toEqual({ kind: 'malformed', raw: 2 });
    expect(classifyLockfileVersion(undefined)).toEqual({ kind: 'malformed', raw: undefined });
  });
});

describe('lockfileVersionErrorMessage', () => {
  it('names the file and tells the user what to do', () => {
    const message = lockfileVersionErrorMessage(
      '/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json',
      { kind: 'unknown-major', major: 4 }
    );

    expect(message).toContain('/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json');
    expect(message).toContain('newer version of AI Primitives Hub');
    expect(message).toContain('unifiedDeploy');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm -C packages/core test -- lockfile-version`
Expected: FAIL — `Failed to resolve import "../../../src/domain/install/lockfile-version"`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/domain/install/lockfile-version.ts`:

```ts
/**
 * Domain layer — lockfile schema version policy.
 *
 * The §5.12 gate of the unified-bundle-lifecycle design: a lockfile's
 * `version` is classified before anything reads its structures, so a
 * reader that predates a schema major fails loudly instead of casting
 * an unknown shape (`JSON.parse(raw) as Lockfile`) and a writer never
 * re-stamps a version it did not understand.
 *
 * Pure policy: no IO, no filenames of its own. Callers supply the path
 * only so the message can name it.
 * @module domain/install/lockfile-version
 */

/** Schema majors this build knows how to read. */
export const KNOWN_LOCKFILE_MAJORS: readonly number[] = [2, 3];

/** Outcome of inspecting a lockfile's `version` field. */
export type LockfileVersionVerdict =
  | { kind: 'readable'; major: number }
  | { kind: 'unknown-major'; major: number }
  | { kind: 'malformed'; raw: unknown };

const SEMVER_SHAPE = /^(\d+)\.\d+\.\d+$/;

/**
 * Classify a lockfile's declared schema version.
 * @param raw - The `version` field exactly as parsed from JSON.
 * @returns A verdict; never throws.
 */
export const classifyLockfileVersion = (raw: unknown): LockfileVersionVerdict => {
  if (typeof raw !== 'string') {
    return { kind: 'malformed', raw };
  }
  const match = SEMVER_SHAPE.exec(raw);
  if (match === null) {
    return { kind: 'malformed', raw };
  }
  const major = Number(match[1]);
  return KNOWN_LOCKFILE_MAJORS.includes(major)
    ? { kind: 'readable', major }
    : { kind: 'unknown-major', major };
};

/**
 * Build the actionable message for a lockfile this build cannot read.
 * @param file - Absolute lockfile path, named so the user can find it.
 * @param verdict - A non-`readable` verdict from {@link classifyLockfileVersion}.
 * @returns A single-sentence message naming the file and the remedy.
 */
export const lockfileVersionErrorMessage = (
  file: string,
  verdict: LockfileVersionVerdict
): string => {
  if (verdict.kind === 'malformed') {
    return `${file} has no readable schema version (found ${JSON.stringify(verdict.raw)}). `
      + 'Expected a "<major>.<minor>.<patch>" string.';
  }
  return `${file} was written by a newer version of AI Primitives Hub `
    + `(lockfile schema ${verdict.kind === 'unknown-major' ? verdict.major : '?'}.x). `
    + 'Upgrade AI Primitives Hub, or disable unifiedDeploy and retry.';
};

/** Thrown when a lockfile's schema version is not readable by this build. */
export class UnsupportedLockfileVersionError extends Error {
  public readonly code = 'LOCKFILE.UNSUPPORTED_VERSION';

  /**
   * @param file - Absolute lockfile path.
   * @param verdict - The verdict that rejected it.
   */
  public constructor(
    public readonly file: string,
    public readonly verdict: LockfileVersionVerdict
  ) {
    super(lockfileVersionErrorMessage(file, verdict));
    this.name = 'UnsupportedLockfileVersionError';
  }
}
```

Add to `packages/core/src/domain/index.ts`, after the `export * from './install/installable';` line:

```ts
export * from './install/lockfile-version';
```

- [ ] **Step 4: Run the core test to verify it passes**

Run: `pnpm -C packages/core test -- lockfile-version`
Expected: PASS (7 assertions across 6 tests).

- [ ] **Step 5: Write the failing app-store test**

Append to `packages/app/test/stores/json-lockfile-store.test.ts`:

```ts
describe('readLockfile version gate', () => {
  it('refuses a lockfile whose major this build does not know', async () => {
    const fs = {
      exists: async () => true,
      readFile: async () => JSON.stringify({ version: '4.0.0', bundles: {}, sources: {} }),
      writeFile: async () => undefined
    };

    await expect(readLockfile('/tmp/x.lock.json', fs))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });

  it('reads a 3.0.0 lockfile without casting it to the v2 shape', async () => {
    const fs = {
      exists: async () => true,
      readFile: async () => JSON.stringify({ version: '3.0.0', bundles: {}, sources: {}, targets: {} }),
      writeFile: async () => undefined
    };

    const lock = await readLockfile('/tmp/x.lock.json', fs);

    expect(lock?.version).toBe('3.0.0');
  });

  it('refuses to re-stamp a 3.0.0 file as 2.0.0', async () => {
    const writes: string[] = [];
    const fs = {
      exists: async () => true,
      readFile: async () => JSON.stringify({ version: '3.0.0', bundles: {}, sources: {} }),
      writeFile: async (_p: string, contents: string) => {
        writes.push(contents);
      }
    };

    await expect(writeLockfile(
      '/tmp/x.lock.json',
      { version: '3.0.0', bundles: {}, sources: {} } as never,
      fs
    )).rejects.toThrow(/LOCKFILE\.UNSUPPORTED_VERSION|refus/i);
    expect(writes).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm -C packages/app test -- json-lockfile-store`
Expected: FAIL — the first test resolves instead of rejecting (today's `readLockfile` is an unchecked cast), and the third writes.

- [ ] **Step 7: Implement the gate in the store**

In `packages/app/src/stores/json-lockfile-store.ts`, add to the existing `@ai-primitives-hub/core` import block:

```ts
import {
  classifyLockfileVersion,
  UnsupportedLockfileVersionError,
} from '@ai-primitives-hub/core';
```

Replace `readLockfile`'s body (`:193-199`):

```ts
export const readLockfile = async (file: string, fs: LockfileFs): Promise<Lockfile | null> => {
  if (!(await fs.exists(file))) {
    return null;
  }
  const raw = await fs.readFile(file);
  const parsed = JSON.parse(raw) as { version?: unknown };
  const verdict = classifyLockfileVersion(parsed.version);
  if (verdict.kind !== 'readable') {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  return parsed as Lockfile;
};
```

Replace `writeLockfile`'s body (`:207-217`):

```ts
export const writeLockfile = async (
  file: string,
  lock: Lockfile,
  fs: LockfileFs
): Promise<void> => {
  // A v2 writer must never re-stamp state it does not understand (§5.12):
  // the legacy helpers below all set LOCKFILE_SCHEMA_VERSION unconditionally,
  // so a v3 payload reaching here is a wiring defect, not a value to coerce.
  const verdict = classifyLockfileVersion(lock.version);
  if (verdict.kind !== 'readable' || verdict.major !== 2) {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  if (fs.mkdir !== undefined) {
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(file, JSON.stringify(lock, null, 2) + '\n');
};
```

- [ ] **Step 8: Run the app suite to verify it passes and nothing regressed**

Run: `pnpm -C packages/app test`
Expected: PASS. If an existing test constructs a lockfile without a `version`, fix the **test fixture** to carry `version: '2.0.0'` — that is the shape the production writer has always produced (`emptyLockfile`, `:160`).

- [ ] **Step 9: Pin the schema finding and add the v3 wire schema**

Two parts, because Scope Note 1 makes the v3 desired file land in this plan.

**9a — leave the v2 schema alone.** Do not rewrite `lockfile.schema.json` for v3. Both generations coexist for the whole cutover (§2's accepted cost), and the extension's `validate()` applies this file to v2 state throughout slices 1–9; relaxing its `required` would stop it catching a genuinely malformed v2 file. Add only `"3.0.0"` to the `version` property's `examples` array.

> **Schema copies: there is one file, not three.** An earlier version of this plan told you to update three paths, mirroring the design's §12 wording. That was wrong, and it is corrected here:
> - `packages/core/src/public/schemas/` is the one real directory. **Edit only this.**
> - `schemas/` at the repo root is a **tracked symlink** to it (git mode 120000). Editing it is editing core's copy; there is no second file to keep in sync, and nothing to `cp`.
> - `apps/vscode-extension/schemas/` is **gitignored** (`.gitignore:56-57`). Normally it is a symlink to the same directory; `apps/vscode-extension/scripts/package-helpers.js` expands it into real files for VSIX packaging and restores the symlink afterwards. A checkout may be sitting in the expanded state, in which case the files there are stale build output.
>
> So: never hand-edit either of the latter two, and never `git add` anything under `apps/vscode-extension/schemas/` — tracking a build artifact guarantees drift and fights `restore-schemas` on the next packaging run.

**9b — add `lockfile-v3.schema.json`.** Create `packages/core/src/public/schemas/lockfile-v3.schema.json` as a `oneOf` over the two role shapes, and export it from `packages/core/src/index.ts` next to the existing schema exports:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json",
  "title": "AI Primitives Hub Lockfile 3.x",
  "description": "Either half of the role-split lockfile pair. The desired-state file is shareable and carries no local identifiers; the local file carries materialization only. Both shapes apply identically at user and repository scope.",
  "oneOf": [
    { "$ref": "#/definitions/desiredState" },
    { "$ref": "#/definitions/localState" }
  ],
  "definitions": {
    "desiredState": {
      "type": "object",
      "required": ["$schema", "version", "bundles", "sources"],
      "additionalProperties": false,
      "properties": {
        "$schema": { "type": "string" },
        "version": { "type": "string", "pattern": "^3\\.\\d+\\.\\d+$" },
        "bundles": { "type": "object", "additionalProperties": { "$ref": "#/definitions/desiredEntry" } },
        "sources": { "type": "object", "additionalProperties": { "$ref": "#/definitions/sourceEntry" } },
        "hubs": { "type": "object" },
        "profiles": { "type": "object" }
      }
    },
    "localState": {
      "type": "object",
      "required": ["version", "generatedAt", "generatedBy", "targets"],
      "additionalProperties": false,
      "properties": {
        "version": { "type": "string", "pattern": "^3\\.\\d+\\.\\d+$" },
        "generatedAt": { "type": "string", "format": "date-time" },
        "generatedBy": { "type": "string" },
        "migration": { "type": "object", "properties": { "lockfileV3": { "enum": ["complete"] } } },
        "targets": { "type": "object", "additionalProperties": { "$ref": "#/definitions/targetRecord" } }
      }
    }
  }
}
```

Fill in `desiredEntry`, `sourceEntry`, `targetRecord`, the bundle record and the file entry from §5.2 and §5.3 — copy the v2 file's `sourceEntry` definition verbatim, since it is unchanged. `additionalProperties: false` on `desiredState` is the schema-level expression of §10's "committed file carries no local identifiers" row: a `targetName`, `baseDir`, `installedAt`, `files`, `generatedAt` or `generatedBy` key makes the file invalid rather than merely unexpected.

Then add these tests to `packages/core/test/domain/install/lockfile-version.test.ts`:

```ts
import Ajv from 'ajv';
import lockfileV3Schema from '../../../src/public/schemas/lockfile-v3.schema.json';

describe('lockfile 3.x wire-format schema', () => {
  const validate = new Ajv({ strict: false }).compile(lockfileV3Schema);

  it('accepts a desired-state file with no generated metadata', () => {
    expect(validate({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: { 'src/web-dev': { version: '1.0.0', sourceId: 'src' } },
      sources: { src: { type: 'local', url: '/tmp/x' } }
    })).toBe(true);
  });

  it('rejects a desired-state file carrying a local identifier', () => {
    expect(validate({
      $schema: 'x',
      version: '3.0.0',
      bundles: {},
      sources: {},
      targets: {}
    })).toBe(false);
  });

  it('accepts a local file with materialization only', () => {
    expect(validate({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      targets: {
        'my-vscode': {
          targetType: 'vscode',
          scope: 'user',
          baseDir: '/home/u/.copilot',
          bundles: {
            'src/web-dev': {
              version: '1.0.0',
              sourceId: 'src',
              installedAt: '2026-10-09T12:00:00.000Z',
              files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
            }
          }
        }
      }
    })).toBe(true);
  });

  it('rejects a local file with no generated metadata', () => {
    expect(validate({ version: '3.0.0', targets: {} })).toBe(false);
  });
});
```

Check whether `ajv` is already a `packages/core` dependency (`grep -n ajv packages/core/package.json`); the extension validates with it (`lockfile-manager.property.test.ts`). If it is not, add it as a **devDependency** of `packages/core` only — `core` must stay dependency-light, and nothing in `src/` validates at runtime here.

Then add this test for the v2 finding:

```ts
import lockfileSchema from '../../../src/public/schemas/lockfile.schema.json';

describe('lockfile wire-format schema', () => {
  it('constrains version by pattern, not by an enum of one', () => {
    // §5.12 claims an enum rejects 3.0.0; it does not exist. The pattern
    // admits any semver, so the code-level gate above is the real guard.
    const version = lockfileSchema.properties.version as Record<string, unknown>;

    expect(version.enum).toBeUndefined();
    expect(version.pattern).toBe('^\\d+\\.\\d+\\.\\d+$');
    expect(version.examples).toContain('3.0.0');
  });

  it('keeps requiring the two generated fields, which is why v3 needs its own schema', () => {
    // A v3 desired-state file omits both (§5.2), at either scope, so it
    // cannot be validated against this file — hence lockfile-v3.schema.json
    // rather than a rewrite of this one.
    expect(lockfileSchema.required).toContain('generatedAt');
    expect(lockfileSchema.required).toContain('generatedBy');
  });
});
```

- [ ] **Step 10: Correct and amend the spec**

Two edits to `docs/superpowers/specs/2026-10-09-unify-bundle-lifecycle-design.md`.

First, §5.12's third bullet:

```markdown
- `lockfile.schema.json`'s `version` is `{"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"}`
  with `2.0.0` only as an *example*, so `3.0.0` already passes wire-format validation. The
  real wire-format blocker for v3 is `required: [..., "generatedAt", "generatedBy", ...]`,
  which §5.2 removes from the desired-state file — so v3 gets its own
  `lockfile-v3.schema.json` and the v2 file is left intact, because both generations are
  validated throughout the cutover. An earlier version of this spec said the enum admitted
  `2.0.0` alone; it has no enum.
```

Second, §5.1's user-scope paragraph. The requester decided on 2026-10-09 that the two scopes must behave identically, which overrules it:

```markdown
**User scope uses the same two files, rooted under XDG** —
`${XDG_CONFIG_HOME:-$HOME/.config}/ai-primitives-hub/ai-primitives-hub.lock.json` for
desired state and `…/ai-primitives-hub.local.lock.json` for materialization. An earlier
version of this section kept one merged file there, on the grounds that a machine-local
file gains nothing from the split. That is **amended by requester decision**: the two
scopes must function identically and differ only in where they are rooted. The split is
therefore unconditional, which also means the desired-state file is byte-comparable at
every scope rather than only in a repository, and that one store, one migration shape and
one test set serve both scopes. The cost is accepted: a two-file write is not one
filesystem transaction at user scope either, so §8.4's ordering applies there too.
```

Also update §8.3's last paragraph, which currently says the XDG file "needs only the shape migration" — it now needs the shape migration **and** the split into a pair, in §8.4's order. And add the decision to §14's amendment list, matching that section's existing format.

- [ ] **Step 11: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/core test && pnpm -C packages/app test
git add packages/core/src/domain/install/lockfile-version.ts \
        packages/core/test/domain/install/lockfile-version.test.ts \
        packages/core/src/domain/index.ts \
        packages/core/src/index.ts \
        packages/core/package.json \
        packages/core/src/public/schemas/lockfile-v3.schema.json \
        packages/app/src/stores/json-lockfile-store.ts \
        packages/app/test/stores/json-lockfile-store.test.ts \
        packages/core/src/public/schemas/lockfile.schema.json \
        docs/superpowers/specs/2026-10-09-unify-bundle-lifecycle-design.md
git commit -m "feat(core): gate lockfile reads and add the 3.x wire schema

Every read classifies the declared version before touching its
structures, and the v2 writer refuses a payload it did not understand
instead of re-stamping it. Prerequisite for writing 3.0.0 state behind
a feature flag (design 5.12).

Adds lockfile-v3.schema.json as a oneOf over the two role shapes rather
than rewriting the v2 schema: both generations are validated for the
whole cutover, and a v3 desired-state file omits generatedAt and
generatedBy by design. additionalProperties: false on the desired shape
is how 'no local identifiers' becomes a wire-format rule.

Also amends the spec: user scope uses the same two-file split as
repository scope, and the v2 schema has no version enum."
```

### Task 2: Export and generalize kind routing, and invert layouts

`routeToKind` and `ROUTE_PREFIX_KINDS` are module-private in `app`'s writer (`packages/app/src/writers/file-tree-writer.ts:540-572`). They are domain policy (§3.5 puts kind normalization in `core`), and inverting a resolved layout into `Map<PrimitiveKind, outputDir>` is what makes manifest-driven routing possible without a new hardcoded table (§4.3).

**Files:**
- Create: `packages/core/src/domain/primitive/route-kinds.ts`
- Create: `packages/core/test/domain/primitive/route-kinds.test.ts`
- Modify: `packages/core/src/domain/index.ts`
- Modify: `packages/app/src/writers/file-tree-writer.ts` (delete the private copies, import from `core`, re-export for existing callers)
- Create: `packages/app/test/writers/layout-inversion-guard.test.ts` (the every-target × scope guard of §4.3)

**Interfaces:**
- Consumes: `PrimitiveKind`, `normalizePrimitiveKind`, `KindRoutes` from Task 1's package (all pre-existing).
- Produces: `ROUTE_PREFIX_KINDS: Readonly<Record<string, PrimitiveKind>>`, `routeToKind(prefix: string): PrimitiveKind | null`, `type KindRouteInversion = { byKind: Map<PrimitiveKind, string>; unknownKeys: string[] }`, `invertKindRoutes(routes: KindRoutes): KindRouteInversion`, `AmbiguousKindRouteError`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/domain/primitive/route-kinds.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  AmbiguousKindRouteError,
  invertKindRoutes,
  routeToKind,
} from '../../../src/domain/primitive/route-kinds';

describe('routeToKind', () => {
  it('resolves a plural alias prefix through kind normalization', () => {
    expect(routeToKind('prompts/')).toBe('prompt');
    expect(routeToKind('instructions/')).toBe('instruction');
    expect(routeToKind('chat-modes/')).toBe('chat-mode');
  });

  it('resolves a host-specific prefix through the prefix table', () => {
    expect(routeToKind('.kiro/steering/')).toBe('steering');
    expect(routeToKind('.claude/output-styles/')).toBe('output-style');
    expect(routeToKind('.opencode/plugins/')).toBe('plugin');
  });

  it('tolerates a missing trailing slash', () => {
    expect(routeToKind('prompts')).toBe('prompt');
    expect(routeToKind('.cursor/rules')).toBe('rule');
  });

  it('returns null for a prefix it does not recognize', () => {
    expect(routeToKind('my-custom-dir/')).toBeNull();
  });
});

describe('invertKindRoutes', () => {
  it('maps each recognized key to its output directory', () => {
    const result = invertKindRoutes({
      'prompts/': 'prompts/',
      'instructions/': 'instructions/',
      'chat-modes/': 'agents/'
    });

    expect(result.byKind.get('prompt')).toBe('prompts/');
    expect(result.byKind.get('instruction')).toBe('instructions/');
    expect(result.byKind.get('chat-mode')).toBe('agents/');
    expect(result.unknownKeys).toEqual([]);
  });

  it('accepts two keys reaching one kind when they agree on the output', () => {
    // cursor's real layout: both `.cursor/agents/` and `agents/` yield `agents/`.
    const result = invertKindRoutes({ '.cursor/agents/': 'agents/', 'agents/': 'agents/' });

    expect(result.byKind.get('agent')).toBe('agents/');
  });

  it('throws when two keys reach one kind with different outputs', () => {
    expect(() => invertKindRoutes({ 'prompts/': 'prompts/', prompt: 'commands/' }))
      .toThrow(AmbiguousKindRouteError);
  });

  it('reports an unrecognized custom key instead of dropping it silently', () => {
    const result = invertKindRoutes({ 'prompts/': 'prompts/', 'team-stuff/': 'team/' });

    expect(result.byKind.get('prompt')).toBe('prompts/');
    expect(result.unknownKeys).toEqual(['team-stuff/']);
  });

  it('names the kind and both outputs in the ambiguity error', () => {
    try {
      invertKindRoutes({ 'prompts/': 'prompts/', prompt: 'commands/' });
      expect.unreachable('expected AmbiguousKindRouteError');
    } catch (error) {
      expect((error as Error).message).toContain('prompt');
      expect((error as Error).message).toContain('prompts/');
      expect((error as Error).message).toContain('commands/');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/core test -- route-kinds`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/domain/primitive/route-kinds.ts`:

```ts
/**
 * Domain layer — layout prefix ↔ primitive kind routing.
 *
 * Moved out of `app`'s `file-tree-writer.ts`, where `ROUTE_PREFIX_KINDS`
 * and `routeToKind` were module-private. Manifest-driven placement
 * inverts a resolved layout's `kindRoutes` (whose keys are source-path
 * prefixes) into kind → output directory, so this policy has to be
 * public and has to state what happens when the inversion is not a
 * function: a kind reachable through two keys with *different* outputs
 * is an error, while a key this vocabulary does not recognize is a
 * reported omission (design 4.3, 4.7).
 * @module domain/primitive/route-kinds
 */
import type {
  KindRoutes,
} from '../install/layout';
import type {
  PrimitiveKind,
} from './types';
import {
  normalizePrimitiveKind,
} from './types';

/**
 * Host-specific layout prefixes that carry a kind the alias vocabulary
 * cannot derive from the directory name alone.
 */
export const ROUTE_PREFIX_KINDS: Readonly<Record<string, PrimitiveKind>> = {
  '.kiro/steering/': 'steering',
  '.kiro/specs/': 'spec',
  '.claude/commands/': 'command',
  '.claude/output-styles/': 'output-style',
  '.cursor/rules/': 'rule',
  '.cursor/agents/': 'agent',
  '.cursor/skills/': 'skill',
  '.cursor/commands/': 'command',
  '.opencode/tools/': 'tool',
  '.opencode/commands/': 'command',
  '.opencode/agents/': 'agent',
  '.opencode/skills/': 'skill',
  '.opencode/rules/': 'rule',
  '.opencode/hooks/': 'hook',
  '.opencode/plugins/': 'plugin',
  '.devin/knowledge/': 'knowledge',
  '.devin/playbooks/': 'playbook',
  '.devin/powers/': 'power',
  '.devin/prompts/': 'prompt',
  '.devin/instructions/': 'instruction',
  '.devin/agents/': 'agent',
  '.devin/skills/': 'skill',
  '.devin/hooks/': 'hook',
  '.devin/plugins/': 'plugin'
};

/**
 * Map a layout prefix back to the primitive kind it represents.
 * @param prefix - Layout key, with or without its trailing slash.
 * @returns The canonical kind, or null when the prefix is not recognized.
 */
export const routeToKind = (prefix: string): PrimitiveKind | null => {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return normalizePrimitiveKind(prefix.replace(/\/$/, ''))
    ?? ROUTE_PREFIX_KINDS[withSlash]
    ?? null;
};

/** Result of inverting a layout's `kindRoutes`. */
export interface KindRouteInversion {
  /** Canonical kind → output subdirectory, relative to the layout's baseDir. */
  byKind: Map<PrimitiveKind, string>;
  /**
   * Keys whose kind could not be resolved at all. Reported rather than
   * dropped: `kindRoutes` allows arbitrary strings, and a user override
   * with a custom key would otherwise lose its items in silence.
   */
  unknownKeys: string[];
}

/** Thrown when one kind is reachable through two keys with different outputs. */
export class AmbiguousKindRouteError extends Error {
  public readonly code = 'LAYOUT.AMBIGUOUS_KIND_ROUTE';

  /**
   * @param kind - The kind reachable two ways.
   * @param first - Output directory from the first key seen.
   * @param second - Conflicting output directory.
   */
  public constructor(
    public readonly kind: PrimitiveKind,
    first: string,
    second: string
  ) {
    super(
      `layout maps primitive kind "${kind}" to two different output directories `
      + `("${first}" and "${second}"); fix the layout's kindRoutes so each kind has one destination`
    );
    this.name = 'AmbiguousKindRouteError';
  }
}

/**
 * Invert a resolved layout's `kindRoutes` into kind → output directory.
 * @param routes - The resolved layout's `kindRoutes`.
 * @returns The inversion plus any unrecognized keys.
 * @throws {AmbiguousKindRouteError} When one kind has two different outputs.
 */
export const invertKindRoutes = (routes: KindRoutes): KindRouteInversion => {
  const byKind = new Map<PrimitiveKind, string>();
  const unknownKeys: string[] = [];

  for (const [key, outputDir] of Object.entries(routes)) {
    const kind = routeToKind(key);
    if (kind === null) {
      unknownKeys.push(key);
      continue;
    }
    const existing = byKind.get(kind);
    if (existing !== undefined && existing !== outputDir) {
      throw new AmbiguousKindRouteError(kind, existing, outputDir);
    }
    byKind.set(kind, outputDir);
  }

  return { byKind, unknownKeys };
};
```

Add to `packages/core/src/domain/index.ts`, after `export * from './primitive/types';`:

```ts
export * from './primitive/route-kinds';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/core test -- route-kinds`
Expected: PASS (10 tests).

- [ ] **Step 5: Delete the private copies in `app` and import from `core`**

In `packages/app/src/writers/file-tree-writer.ts`: delete the `ROUTE_PREFIX_KINDS` constant and the `routeToKind` arrow (`:540-572`), add `routeToKind` to the existing named import from `@ai-primitives-hub/core`, and re-export the pair for any caller that had reached them indirectly:

```ts
export {
  invertKindRoutes,
  ROUTE_PREFIX_KINDS,
  routeToKind,
} from '@ai-primitives-hub/core';
```

Leave `pickRoute`, `normalizeBundlePath` and `copilotTypeToPrimitiveKind` alone — §3.4 retires prefix routing, but that deletion is gated on a no-callers test in slice 11+, not here.

- [ ] **Step 6: Run the app writer suite to confirm no behavior change**

Run: `pnpm -C packages/app test -- file-tree-writer`
Expected: PASS, unchanged count. This is the behavior-neutrality check for the move.

- [ ] **Step 7: Write the every-target × scope inversion guard**

Create `packages/app/test/writers/layout-inversion-guard.test.ts`:

```ts
/**
 * The §4.3 guard: inverting every built-in layout must be unambiguous,
 * and no built-in may carry a key the kind vocabulary cannot resolve.
 * A future layout edit that breaks either property fails here rather
 * than silently misplacing files.
 */
import {
  invertKindRoutes,
  TARGET_TYPES,
} from '@ai-primitives-hub/core';
import {
  defaultLayouts,
} from '@ai-primitives-hub/infra';
import {
  describe,
  expect,
  it,
} from 'vitest';

const SCOPES = ['user', 'repository'] as const;

describe('built-in layout inversion', () => {
  for (const targetType of TARGET_TYPES) {
    for (const scope of SCOPES) {
      it(`${targetType} / ${scope} inverts to one directory per kind`, () => {
        const def = defaultLayouts.layouts[targetType];
        expect(def, `no built-in layout for ${targetType}`).toBeDefined();
        const scoped = scope === 'repository' ? (def.repository ?? def.user) : def.user;

        const result = invertKindRoutes(scoped.kindRoutes);

        expect(result.unknownKeys).toEqual([]);
        expect(result.byKind.size).toBeGreaterThan(0);
      });
    }
  }

  it('covers every declared target type', () => {
    for (const targetType of TARGET_TYPES) {
      expect(Object.keys(defaultLayouts.layouts)).toContain(targetType);
    }
  });
});
```

- [ ] **Step 8: Run the guard**

Run: `pnpm -C packages/app test -- layout-inversion-guard`
Expected: PASS for all 22 cells. **If a cell fails, that is a real finding, not a test bug** — §4.3 claims the inversion was verified unambiguous across all 11 targets. Record the failing target/scope and the conflicting outputs in the task's report before changing anything; the fix may belong in `default-layouts.json`, and that is a design question, not a mechanical one.

- [ ] **Step 9: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/core test && pnpm -C packages/app test
git add packages/core/src/domain/primitive/route-kinds.ts \
        packages/core/test/domain/primitive/route-kinds.test.ts \
        packages/core/src/domain/index.ts \
        packages/app/src/writers/file-tree-writer.ts \
        packages/app/test/writers/layout-inversion-guard.test.ts
git commit -m "feat(core): make kind routing public and invertible

Moves ROUTE_PREFIX_KINDS and routeToKind out of app's writer into core
and adds invertKindRoutes, which derives kind -> output directory from a
resolved layout. Ambiguity throws; an unrecognized custom key is
reported rather than dropped (design 4.3, 4.7).

Adds a guard over all 11 target types x 2 scopes."
```

### Task 3: Canonical-kind naming with normalized ids

`getTargetFileName` takes Copilot *aliases* (`instructions`, `chatmode`) and does not normalize the id; only `RepositoryScopeService` normalizes today (§4.7). The shared writer must normalize once, for every caller.

**Files:**
- Modify: `packages/core/src/domain/install/copilot-file-type.ts`
- Modify: `packages/core/test/domain/install/copilot-file-type.test.ts` (create if absent)

**Interfaces:**
- Consumes: `PrimitiveKind`, `normalizePromptId`, `getTargetFileName`, `CopilotFileType`.
- Produces: `copilotFileTypeForKind(kind: PrimitiveKind): CopilotFileType | null`, `type KindNameShape = 'copilot-suffixed' | 'directory' | 'plain-file' | 'not-placed'`, `nameShapeForKind(kind: PrimitiveKind): KindNameShape`, `destinationNameForKind(kind: PrimitiveKind, id: string, sourceBasename: string): string | null`.

- [ ] **Step 1: Write the failing test**

Create or append to `packages/core/test/domain/install/copilot-file-type.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  copilotFileTypeForKind,
  destinationNameForKind,
  nameShapeForKind,
} from '../../../src/domain/install/copilot-file-type';

describe('copilotFileTypeForKind', () => {
  it('maps the four Copilot-suffixed kinds onto their aliases', () => {
    expect(copilotFileTypeForKind('prompt')).toBe('prompt');
    expect(copilotFileTypeForKind('instruction')).toBe('instructions');
    expect(copilotFileTypeForKind('chat-mode')).toBe('chatmode');
    expect(copilotFileTypeForKind('agent')).toBe('agent');
    expect(copilotFileTypeForKind('skill')).toBe('skill');
  });

  it('returns null for a kind with no Copilot alias', () => {
    expect(copilotFileTypeForKind('hook')).toBeNull();
    expect(copilotFileTypeForKind('steering')).toBeNull();
  });
});

describe('nameShapeForKind', () => {
  it('classifies every kind into one of the four shapes', () => {
    expect(nameShapeForKind('prompt')).toBe('copilot-suffixed');
    expect(nameShapeForKind('skill')).toBe('directory');
    expect(nameShapeForKind('plugin')).toBe('directory');
    expect(nameShapeForKind('power')).toBe('directory');
    expect(nameShapeForKind('hook')).toBe('plain-file');
    expect(nameShapeForKind('steering')).toBe('plain-file');
    expect(nameShapeForKind('mcp-server')).toBe('not-placed');
  });
});

describe('destinationNameForKind', () => {
  it('renames a Copilot-suffixed file from the normalized id', () => {
    expect(destinationNameForKind('prompt', 'create-component', 'anything.md'))
      .toBe('create-component.prompt.md');
    expect(destinationNameForKind('instruction', 'ts-standards', 'x.md'))
      .toBe('ts-standards.instructions.md');
  });

  it('is a no-op for a well-formed bundle whose id matches its filename stem', () => {
    expect(destinationNameForKind('prompt', 'create-component', 'create-component.prompt.md'))
      .toBe('create-component.prompt.md');
  });

  it('normalizes an id that is not filename-safe', () => {
    expect(destinationNameForKind('prompt', 'My Prompt/v2', 'x.prompt.md'))
      .toBe('My-Prompt-v2.prompt.md');
  });

  it('normalizes a YAML-parsed numeric id', () => {
    expect(destinationNameForKind('prompt', 42 as unknown as string, 'x.prompt.md'))
      .toBe('42.prompt.md');
  });

  it('uses the normalized id as the directory name for a directory kind', () => {
    expect(destinationNameForKind('skill', 'My Skill', 'skills/my-skill/SKILL.md'))
      .toBe('My-Skill');
  });

  it('preserves the source basename for a plain-file kind', () => {
    expect(destinationNameForKind('hook', 'pre-commit', 'hooks/pre-commit.sh'))
      .toBe('pre-commit.sh');
    expect(destinationNameForKind('steering', 'style', 'steering/style.md'))
      .toBe('style.md');
  });

  it('returns null for a kind that is never placed as a file', () => {
    expect(destinationNameForKind('mcp-server', 'srv', 'mcp/srv.json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/core test -- copilot-file-type`
Expected: FAIL — `copilotFileTypeForKind is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/domain/install/copilot-file-type.ts`:

```ts
/**
 * Canonical primitive kind → Copilot file-type alias.
 *
 * `getTargetFileName` speaks the alias vocabulary (`instructions`,
 * `chatmode`); manifest-driven placement routes on canonical
 * `PrimitiveKind`. This is the bridge, and it is explicit so the
 * mapping is not re-derived per call site (design 4.7).
 * @param kind - Canonical primitive kind.
 * @returns The Copilot alias, or null when the kind has none.
 */
export function copilotFileTypeForKind(kind: PrimitiveKind): CopilotFileType | null {
  switch (kind) {
    case 'prompt': {
      return 'prompt';
    }
    case 'instruction': {
      return 'instructions';
    }
    case 'chat-mode': {
      return 'chatmode';
    }
    case 'agent': {
      return 'agent';
    }
    case 'skill': {
      return 'skill';
    }
    default: {
      return null;
    }
  }
}

/** How a kind's on-disk name is derived (design 4.4). */
export type KindNameShape = 'copilot-suffixed' | 'directory' | 'plain-file' | 'not-placed';

const DIRECTORY_KINDS: readonly PrimitiveKind[] = ['skill', 'plugin', 'power'];

/**
 * Classify a kind's naming shape.
 * @param kind - Canonical primitive kind.
 * @returns The naming shape that applies to it.
 */
export function nameShapeForKind(kind: PrimitiveKind): KindNameShape {
  if (kind === 'mcp-server') {
    return 'not-placed';
  }
  if (DIRECTORY_KINDS.includes(kind)) {
    return 'directory';
  }
  return copilotFileTypeForKind(kind) === null ? 'plain-file' : 'copilot-suffixed';
}

/**
 * Compute the on-disk name for one placed primitive.
 *
 * Normalizes the id exactly once, here, so no caller passes a raw
 * manifest id through (`UserScopeService:393` and `BundleInstaller:272`
 * both did, which is the behavior change design §13 records).
 * @param kind - Canonical primitive kind.
 * @param id - Manifest item id; may be a YAML-parsed number.
 * @param sourceBasename - Basename of the bundle-relative source path.
 * @returns File name, directory name, or null when the kind is not placed.
 */
export function destinationNameForKind(
  kind: PrimitiveKind,
  id: string,
  sourceBasename: string
): string | null {
  const shape = nameShapeForKind(kind);
  if (shape === 'not-placed') {
    return null;
  }
  if (shape === 'plain-file') {
    return sourceBasename.replace(/^.*[/\\]/, '');
  }
  const normalized = normalizePromptId(id);
  if (shape === 'directory') {
    return normalized;
  }
  const alias = copilotFileTypeForKind(kind);
  // `shape === 'copilot-suffixed'` is derived from a non-null alias above.
  return getTargetFileName(normalized, alias as CopilotFileType);
}
```

Add `PrimitiveKind` to the file's imports:

```ts
import type {
  PrimitiveKind,
} from '../primitive/types';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/core test -- copilot-file-type`
Expected: PASS (12 tests).

- [ ] **Step 5: Add the Review Focus #3 test — normalized-id collision**

`destinationNameForKind` is a pure name function and cannot detect a collision on its own; detection belongs to whatever builds the destination set. Pin the *property* here so the deploy planner in Task 9 has something to point at:

```ts
describe('normalized id collisions (Review Focus 3)', () => {
  it('two distinct ids can normalize to the same file name', () => {
    // Not a bug in this function — a fact the planner must detect.
    // `planDeploy` reports it as a duplicate destination (Task 9).
    expect(destinationNameForKind('prompt', 'foo.bar', 'a.md'))
      .toBe(destinationNameForKind('prompt', 'foo-bar', 'b.md'));
  });
});
```

- [ ] **Step 6: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/core test
git add packages/core/src/domain/install/copilot-file-type.ts \
        packages/core/test/domain/install/copilot-file-type.test.ts
git commit -m "feat(core): derive on-disk names from canonical kinds

Adds copilotFileTypeForKind, nameShapeForKind and
destinationNameForKind, which normalizes the manifest id once for every
caller instead of leaving it to the call site (design 4.4, 4.7)."
```

### Task 4: One logical bundle key

§5.13's prerequisite: a version-independent, source-qualified key, written in that form at every scope, plus legacy alias resolution so migration can map a version-bearing extension id or a bare CLI `manifest.id` onto it.

**Files:**
- Create: `packages/core/src/domain/bundle/logical-key.ts`
- Create: `packages/core/test/domain/bundle/logical-key.test.ts`
- Modify: `packages/core/src/domain/index.ts`

**Interfaces:**
- Consumes: `extractBundleIdentity` and `VERSION_SUFFIX_REGEX` from `domain/bundle/version.ts` / `identity-matcher.ts`.
- Produces: `logicalBundleKey(input: { sourceId: string; manifestId: string }): string`, `parseLogicalBundleKey(key: string): { sourceId: string; manifestId: string } | null`, `logicalKeyFromLegacyId(legacyId: string, sourceId: string): string`, `InvalidLogicalBundleKeyError`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/domain/bundle/logical-key.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  InvalidLogicalBundleKeyError,
  logicalBundleKey,
  logicalKeyFromLegacyId,
  parseLogicalBundleKey,
} from '../../../src/domain/bundle/logical-key';

describe('logicalBundleKey', () => {
  it('is source-qualified and version-independent', () => {
    expect(logicalBundleKey({ sourceId: 'github-abc123def456', manifestId: 'web-dev' }))
      .toBe('github-abc123def456/web-dev');
  });

  it('is source-qualified even with a single source — adding a second rekeys nothing', () => {
    // The withdrawn shorthand would have written "web-dev" here (design 5.13).
    expect(logicalBundleKey({ sourceId: 'only-source', manifestId: 'web-dev' }))
      .toBe('only-source/web-dev');
  });

  it('keeps two sources offering the same manifest id as two keys', () => {
    const a = logicalBundleKey({ sourceId: 'src-a', manifestId: 'shared' });
    const b = logicalBundleKey({ sourceId: 'src-b', manifestId: 'shared' });

    expect(a).not.toBe(b);
  });

  it('rejects a sourceId containing a slash (Review Focus 4)', () => {
    expect(() => logicalBundleKey({ sourceId: 'owner/repo', manifestId: 'web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });

  it('rejects a manifestId containing a slash (Review Focus 4)', () => {
    expect(() => logicalBundleKey({ sourceId: 'src', manifestId: 'team/web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });

  it('rejects an empty half', () => {
    expect(() => logicalBundleKey({ sourceId: '', manifestId: 'web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
    expect(() => logicalBundleKey({ sourceId: 'src', manifestId: '' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });
});

describe('parseLogicalBundleKey', () => {
  it('round-trips a well-formed key', () => {
    expect(parseLogicalBundleKey('src/web-dev')).toEqual({ sourceId: 'src', manifestId: 'web-dev' });
  });

  it('returns null for a key with no separator or more than one', () => {
    expect(parseLogicalBundleKey('web-dev')).toBeNull();
    expect(parseLogicalBundleKey('a/b/c')).toBeNull();
  });
});

describe('logicalKeyFromLegacyId', () => {
  it('strips an extension version suffix so both layers reach one key', () => {
    // Extension runtime id (github-adapter.ts:214) vs the bare CLI manifest.id.
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-1.0.0', 'src'))
      .toBe(logicalKeyFromLegacyId('owner-repo-web-dev', 'src'));
  });

  it('strips a v-prefixed version suffix too', () => {
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-v1.0.0', 'src'))
      .toBe('src/owner-repo-web-dev');
  });

  it('leaves a bare id untouched', () => {
    expect(logicalKeyFromLegacyId('web-dev', 'src')).toBe('src/web-dev');
  });

  it('does not strip a trailing segment that is not a version', () => {
    expect(logicalKeyFromLegacyId('web-dev-next', 'src')).toBe('src/web-dev-next');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/core test -- logical-key`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/domain/bundle/logical-key.ts`:

```ts
/**
 * Domain layer — the one logical bundle key.
 *
 * `{sourceId}/{manifestId}`, version-independent and source-qualified,
 * **always, in every file and at every scope** (design 5.13). An earlier
 * draft allowed omitting the source half at user scope when the lockfile
 * had a single source; that is withdrawn, because the key would change
 * shape the moment a second source was added — a silent rekey of the one
 * identifier reconcile, removal and drift all join on.
 *
 * Both halves are therefore required to be slash-free: the separator is
 * the only structure the key has, so a slash in either half would make
 * `parseLogicalBundleKey` ambiguous.
 * @module domain/bundle/logical-key
 */
import {
  VERSION_SUFFIX_REGEX,
} from './identity-matcher';

const SEPARATOR = '/';

/** Thrown when a key's halves cannot form an unambiguous key. */
export class InvalidLogicalBundleKeyError extends Error {
  public readonly code = 'BUNDLE.INVALID_LOGICAL_KEY';

  /**
   * @param field - Which half was rejected.
   * @param value - The offending value.
   */
  public constructor(field: 'sourceId' | 'manifestId', value: string) {
    super(
      `${field} ${JSON.stringify(value)} cannot form a logical bundle key: `
      + 'it must be non-empty and must not contain "/"'
    );
    this.name = 'InvalidLogicalBundleKeyError';
  }
}

/** The two halves of a logical bundle key. */
export interface LogicalBundleKeyParts {
  sourceId: string;
  manifestId: string;
}

/**
 * Build the logical bundle key.
 * @param input - Source id and manifest id.
 * @returns `{sourceId}/{manifestId}`.
 * @throws {InvalidLogicalBundleKeyError} When either half is empty or contains `/`.
 */
export const logicalBundleKey = (input: LogicalBundleKeyParts): string => {
  for (const field of ['sourceId', 'manifestId'] as const) {
    const value = input[field];
    if (value.length === 0 || value.includes(SEPARATOR)) {
      throw new InvalidLogicalBundleKeyError(field, value);
    }
  }
  return `${input.sourceId}${SEPARATOR}${input.manifestId}`;
};

/**
 * Split a logical bundle key back into its halves.
 * @param key - A key previously produced by {@link logicalBundleKey}.
 * @returns The halves, or null when `key` is not exactly two segments.
 */
export const parseLogicalBundleKey = (key: string): LogicalBundleKeyParts | null => {
  const segments = key.split(SEPARATOR);
  if (segments.length !== 2 || segments[0].length === 0 || segments[1].length === 0) {
    return null;
  }
  return { sourceId: segments[0], manifestId: segments[1] };
};

/**
 * Map a legacy bundle id onto the logical key.
 *
 * The extension's runtime GitHub ids are namespaced *and* version-bearing
 * while the CLI stores a bare `manifest.id`; both must reach one key, so
 * the version suffix is stripped and nothing else is reinterpreted.
 * @param legacyId - Bundle id as recorded by either layer.
 * @param sourceId - Source id to qualify the key with.
 * @returns The logical bundle key.
 * @throws {InvalidLogicalBundleKeyError} When either half is unusable.
 */
export const logicalKeyFromLegacyId = (legacyId: string, sourceId: string): string =>
  logicalBundleKey({
    sourceId,
    manifestId: legacyId.replace(VERSION_SUFFIX_REGEX, '')
  });
```

Add to `packages/core/src/domain/index.ts`, after `export * from './bundle/identity-matcher';`:

```ts
export * from './bundle/logical-key';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/core test -- logical-key`
Expected: PASS (13 tests).

If the "does not strip a trailing segment that is not a version" case fails, read `VERSION_SUFFIX_REGEX` (`packages/core/src/domain/bundle/identity-matcher.ts:21`) and adjust the **test's** expectation to the regex's actual contract — the regex is production behavior shared with `bundleIdentitiesMatch`, and changing it here would change unrelated matching.

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/core test
git add packages/core/src/domain/bundle/logical-key.ts \
        packages/core/test/domain/bundle/logical-key.test.ts \
        packages/core/src/domain/index.ts
git commit -m "feat(core): add the logical bundle key

{sourceId}/{manifestId}, version-independent and source-qualified at
every scope, with legacy-alias resolution so a version-bearing extension
id and a bare CLI manifest.id reach one key (design 5.13)."
```

### Task 5: Link identity on the FileSystem port

§3.2's third port addition, and §4.8's precondition: shared `app` code cannot detect a symlinked destination — or, more importantly, a symlinked **parent** — through today's port, which has no `lstat` and no symlink flag on `stat`. Slice 5 needs the guard; Step 0 adds the capability.

**Files:**
- Modify: `packages/core/src/ports/filesystem.ts`
- Modify: `packages/infra/src/fs/node-filesystem.ts`
- Create: `packages/infra/test/fs/node-filesystem-lstat.test.ts`
- Modify: `packages/cli/src/framework/test-context.ts` (`STUB_FS` gains the new method so the stub stays exhaustive)
- Grep-and-fix: every other `FileSystem` implementation in the repo

**Interfaces:**
- Consumes: nothing.
- Produces: `interface LinkStat extends FileStat { isSymbolicLink: boolean }` and `FileSystem.lstat(path: string): Promise<LinkStat>`.

- [ ] **Step 1: Find every implementation that must grow the method**

Run:

```bash
grep -rln "implements FileSystem\|: FileSystem = \|FsAbstraction = {" --include="*.ts" packages apps | grep -v node_modules
```

Record the list in the task report. Every hit needs `lstat` or it will fail to compile — that compile error is the task's real coverage, and the test below only pins the semantics.

- [ ] **Step 2: Write the failing infra test**

Create `packages/infra/test/fs/node-filesystem-lstat.test.ts`:

```ts
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  NodeFileSystem,
} from '../../src/fs/node-filesystem';

describe('NodeFileSystem.lstat', () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'aph-lstat-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports a regular file as not a symlink', async () => {
    const file = path.join(root, 'real.md');
    await writeFile(file, 'x', 'utf8');

    const stat = await fs.lstat(file);

    expect(stat.isSymbolicLink).toBe(false);
    expect(stat.isFile).toBe(true);
  });

  it('reports a symlink as a symlink without following it', async () => {
    const target = path.join(root, 'real.md');
    const link = path.join(root, 'link.md');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, link);

    const stat = await fs.lstat(link);

    expect(stat.isSymbolicLink).toBe(true);
    // The distinction that matters: stat() follows, lstat() does not.
    expect((await fs.stat(link)).isFile).toBe(true);
  });

  it('reports a directory symlink as a symlink, not a directory', async () => {
    // This is the §4.8 case a per-file lstat misses: a child path under a
    // symlinked *directory* lstats as an ordinary file.
    const realDir = path.join(root, 'source');
    const linkDir = path.join(root, 'linked');
    await mkdir(realDir, { recursive: true });
    await writeFile(path.join(realDir, 'SKILL.md'), 'x', 'utf8');
    await symlink(realDir, linkDir, 'dir');

    expect((await fs.lstat(linkDir)).isSymbolicLink).toBe(true);
    expect((await fs.lstat(path.join(linkDir, 'SKILL.md'))).isSymbolicLink).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C packages/infra test -- node-filesystem-lstat`
Expected: FAIL — `fs.lstat is not a function`.

- [ ] **Step 4: Extend the port**

In `packages/core/src/ports/filesystem.ts`, after the `FileStat` interface:

```ts
/**
 * `FileStat` plus link identity. Produced only by `lstat`, which does
 * **not** follow symlinks — `stat` does, so it can never answer "is this
 * path itself a link?".
 *
 * Required, not optional: shared `app` code needs it to refuse writing
 * through a symlink into a cache or into a user's live source directory,
 * and that guard is unimplementable without it (design 3.2, 4.8).
 */
export interface LinkStat extends FileStat {
  isSymbolicLink: boolean;
}
```

And inside `interface FileSystem`, next to `stat`:

```ts
  /**
   * Stat a path without following a final symlink.
   *
   * Note the limit this does not remove: a child path under a symlinked
   * *directory* lstats as an ordinary file, so a caller guarding writes
   * must walk the ancestors it is about to write under, not just the
   * destination (design 4.8).
   * @param path - Path to stat.
   */
  lstat(path: string): Promise<LinkStat>;
```

- [ ] **Step 5: Implement it in the adapter**

In `packages/infra/src/fs/node-filesystem.ts`, add `lstat` to the `node:fs/promises` import, add `LinkStat` to the type import, and add the method next to `stat`:

```ts
  public async lstat(path: string): Promise<LinkStat> {
    const stats = await lstat(path);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
      size: stats.isDirectory() ? 0 : stats.size,
      mtimeMs: stats.mtimeMs
    };
  }
```

Match the existing `stat` method's shape exactly for the inherited fields — read it first and mirror it, including the directory-size convention.

- [ ] **Step 6: Fix every other implementation**

For each file from Step 1, add `lstat`. In `packages/cli/src/framework/test-context.ts`, add `lstat: rejectFsCall` to `STUB_FS` (keeping the stub exhaustive is the point — a missing key would silently become `undefined`).

For hand-written in-memory doubles in tests, the honest default is a method that throws `new Error('lstat not stubbed')`, so a test that silently depends on link identity fails loudly rather than reading `undefined`.

- [ ] **Step 7: Run the full package suite**

```bash
pnpm -C packages -r build
pnpm -C packages -r test
```

Expected: PASS. A compile failure here is the point of Step 1 — resolve it by adding the method, never by widening the port to optional.

- [ ] **Step 8: Lint and commit**

```bash
pnpm -C packages -r lint:fix
git add packages/core/src/ports/filesystem.ts \
        packages/infra/src/fs/node-filesystem.ts \
        packages/infra/test/fs/node-filesystem-lstat.test.ts \
        packages/cli/src/framework/test-context.ts
# plus every implementation Step 1 listed
git commit -m "feat(core): add link identity to the FileSystem port

Adds lstat returning isSymbolicLink. stat() follows links, so it can
never answer whether a path is itself a link — which makes the symlink
write guard unimplementable through the current port (design 3.2, 4.8).

Non-optional by design: every implementation grows the method."
```

**Step 0 is complete when** all five tasks are merged, `pnpm -C packages -r test` passes, and `pnpm -C packages -r build` is clean. No behavior has changed: no flag exists yet and nothing writes `3.0.0`.

---

## Slice 1 — CLI user-scope install and uninstall for `vscode`

One PR by the design's sequencing, but several independently reviewable tasks. Flag off, every byte of behavior is unchanged; flag on, `install`/`uninstall` at user scope go through `app/deploy` and the XDG lockfile becomes `3.0.0`.

### Task 6: The `unifiedDeploy` feature flag

**Files:**
- Create: `packages/infra/src/flags/unified-deploy.ts`
- Create: `packages/infra/test/flags/unified-deploy.test.ts`
- Modify: `packages/infra/src/index.ts` (barrel)

**Interfaces:**
- Consumes: nothing.
- Produces: `UNIFIED_DEPLOY_ENABLED = 'AI_PRIMITIVES_HUB_UNIFIED_DEPLOY'`, `parseUnifiedDeployEnabled(env): boolean`, `isUnifiedDeployEnabled(env): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/infra/test/flags/unified-deploy.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isUnifiedDeployEnabled,
  UNIFIED_DEPLOY_ENABLED,
} from '../../src/flags/unified-deploy';

describe('isUnifiedDeployEnabled', () => {
  it('defaults to off when unset or empty', () => {
    expect(isUnifiedDeployEnabled({})).toBe(false);
    expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: '' })).toBe(false);
  });

  it('accepts the three truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
      expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: value })).toBe(true);
    }
  });

  it('accepts the three falsy spellings', () => {
    for (const value of ['0', 'false', 'FALSE', 'no', 'No']) {
      expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: value })).toBe(false);
    }
  });

  it('throws on an unrecognized value rather than guessing', () => {
    expect(() => isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: 'maybe' }))
      .toThrow(/AI_PRIMITIVES_HUB_UNIFIED_DEPLOY/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/infra test -- unified-deploy`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/infra/src/flags/unified-deploy.ts`:

```ts
/**
 * `unifiedDeploy` feature flag — CLI surface.
 *
 * Gates the shared `app/deploy` path during the bundle-lifecycle
 * cutover. Default off: with the flag off, `main` stays releasable and
 * no code reads or writes lockfile 3.0.0 state (design 2, 5.12).
 *
 * Parsing follows `parseGitHubAppAuthEnabled` exactly — same accepted
 * spellings, same throw on anything else — so the two CLI flags cannot
 * disagree about what "1" means. The extension's surface is the
 * `promptregistry.unifiedDeploy` setting and is wired in slice 5.
 * @module flags/unified-deploy
 */

/** Environment variable name for the CLI flag surface. */
export const UNIFIED_DEPLOY_ENABLED = 'AI_PRIMITIVES_HUB_UNIFIED_DEPLOY';

/**
 * Parse the flag from an env bag.
 * @param env - Environment variables (typically `ctx.env`).
 * @returns Whether the shared deploy path is enabled.
 * @throws {Error} When the variable is set to an unrecognized value.
 */
export function parseUnifiedDeployEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const value = env[UNIFIED_DEPLOY_ENABLED];
  if (value === undefined || value.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  throw new Error(`Invalid ${UNIFIED_DEPLOY_ENABLED}: expected 1, true, yes, 0, false, or no.`);
}

/**
 * Return whether the shared deploy path is explicitly enabled.
 * @param env - Environment variables.
 */
export function isUnifiedDeployEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return parseUnifiedDeployEnabled(env);
}
```

Export it from `packages/infra/src/index.ts`, following the file's existing export style (read the surrounding lines and match them).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/infra test -- unified-deploy`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/infra test
git add packages/infra/src/flags/unified-deploy.ts \
        packages/infra/test/flags/unified-deploy.test.ts \
        packages/infra/src/index.ts
git commit -m "feat(infra): add the unifiedDeploy CLI feature flag

AI_PRIMITIVES_HUB_UNIFIED_DEPLOY, default off, parsed exactly like
AI_PRIMITIVES_HUB_GH_APP_AUTH_ENABLED (design 2)."
```

### Task 7: The v3 lockfile store — one implementation, two destinations

The role split from Scope Note 1, as **one** scope-agnostic store. Nothing in this module knows whether it is running at user or repository scope: the caller supplies a `LockfileV3Paths` pair and everything else is identical. Slice 3 adds a second caller, not a second store.

Four asymmetries between the scopes exist and none of them belong here:

| Asymmetry | Where it is handled instead |
|---|---|
| The local file must be git-excluded at repository scope | the `gitExclude` port, called by `deploy` only when `scope === 'repository'` |
| `commitMode` is meaningless at user scope | one optional field on the record; absent at user scope, never branched on |
| `path` is relative to the workspace root (repository) or the resolved `baseDir` (user) | the target record carries `baseDir`, so both scopes join against `record.baseDir` — the repository caller sets it to the workspace root |
| Legacy state is one same-named file (user) or two differently named ones (repository) | Task 8 takes `legacyFiles: string[]` — data, not a scope check |

Writes are temp-file-plus-rename with a **unique** temp name per write (§8.4): the existing v2 writer is a bare `writeFile`, and the extension's uses a fixed `.tmp` path guarded by a process-local mutex, which two processes do not share.

**Files:**
- Create: `packages/app/src/stores/lockfile-v3.ts`
- Create: `packages/app/test/stores/lockfile-v3.test.ts`
- Modify: `packages/app/src/stores/index.ts` (barrel)
- Modify: `packages/app/src/registry/user-config-paths.ts` (+ its test) — add `userLocalLockfile`

**Interfaces:**
- Consumes: `classifyLockfileVersion`, `UnsupportedLockfileVersionError` (Task 1); `LockfileFs` from `json-lockfile-store.ts:169`; `LockfileSourceEntry`, `LockfileHubEntry`, `LockfileProfileEntry` (reused unchanged from v2).
- Produces:
  - `LOCKFILE_V3_VERSION = '3.0.0'`
  - `interface LockfileV3Paths { desiredFile: string; localFile: string }`
  - `interface LockfileV3FileEntry { path: string; checksum?: string; installedChecksum?: string; adoptedAtMigration?: true }`
  - `interface LockfileV3BundleRecord { version: string; sourceId: string; installedAt: string; commitMode?: RepositoryCommitMode; state?: 'unmanaged'; unmanagedReason?: string; linked?: true; files: LockfileV3FileEntry[]; mcpConfigPath?: string; mcpServers?: string[]; complete?: true }`
  - `interface LockfileV3TargetRecord { targetType: TargetType; scope: InstallationScope; baseDir: string; commitMode?: RepositoryCommitMode; bundles: Record<string, LockfileV3BundleRecord> }`
  - `interface LockfileV3DesiredEntry { version: string; sourceId: string; archiveSha?: string }`
  - `interface DesiredLockfileV3 { $schema: string; version: string; bundles: Record<string, LockfileV3DesiredEntry>; sources: Record<string, LockfileSourceEntry>; hubs?: Record<string, LockfileHubEntry>; profiles?: Record<string, LockfileProfileEntry> }`
  - `interface LocalLockfileV3 { version: string; generatedAt: string; generatedBy: string; migration?: { lockfileV3?: 'complete' }; targets: Record<string, LockfileV3TargetRecord> }`
  - `interface LockfileV3Pair { desired: DesiredLockfileV3; local: LocalLockfileV3 }`
  - `emptyDesiredLockfileV3(): DesiredLockfileV3`
  - `emptyLocalLockfileV3(generatedBy: string, now: string): LocalLockfileV3`
  - `readLockfileV3Pair(paths: LockfileV3Paths, fs: LockfileFs, defaults: { generatedBy: string; now: string }): Promise<{ pair: LockfileV3Pair; desiredExists: boolean; localExists: boolean }>`
  - `writeLockfileV3Pair(paths: LockfileV3Paths, pair: LockfileV3Pair, fs: LockfileFsWithRename): Promise<void>` — local first, then desired, per §8.4
  - `upsertDesiredBundle`, `removeDesiredBundle` — pure over `DesiredLockfileV3`
  - `upsertMaterialization`, `removeMaterialization` — pure over `LocalLockfileV3`
  - `LockfileGenerationMismatchError`

Two deliberate choices, both stated so a reviewer can reject them:

- **`generatedAt` is a parameter, never `new Date()`.** Every v2 helper calls `new Date().toISOString()` inline (`json-lockfile-store.ts:162`, `:254`, `:269`), which makes them untestable without faking globals.
- **`rename` may be absent.** `LockfileFs` has no `rename`. Widen it locally with an optional `rename` and fall back to a plain `writeFile` when the adapter has none, so hand-written in-memory doubles keep working while production (`NodeFileSystem`) takes the atomic path. Check `grep -n "rename" packages/infra/src/fs/node-filesystem.ts packages/core/src/ports/filesystem.ts` first; if the port lacks it, add it exactly as Task 5 added `lstat`.

- [ ] **Step 1: Add `userLocalLockfile` and write its failing test**

Add to `UserConfigPaths` in `packages/app/src/registry/user-config-paths.ts`:

```ts
  /** {root}/ai-primitives-hub.local.lock.json (user-scope materialization) */
  userLocalLockfile: string;
```

and to the returned object:

```ts
    userLocalLockfile: path.join(root, 'ai-primitives-hub.local.lock.json'),
```

Test, in that module's existing test file:

```ts
it('resolves the user-scope lockfile pair under one XDG root', () => {
  const paths = resolveUserConfigPaths({ XDG_CONFIG_HOME: '/cfg' });

  expect(paths.userLockfile).toBe('/cfg/ai-primitives-hub/ai-primitives-hub.lock.json');
  expect(paths.userLocalLockfile).toBe('/cfg/ai-primitives-hub/ai-primitives-hub.local.lock.json');
});
```

- [ ] **Step 2: Write the failing store test**

Create `packages/app/test/stores/lockfile-v3.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  emptyDesiredLockfileV3,
  emptyLocalLockfileV3,
  LOCKFILE_V3_VERSION,
  LockfileGenerationMismatchError,
  readLockfileV3Pair,
  removeMaterialization,
  upsertDesiredBundle,
  upsertMaterialization,
  writeLockfileV3Pair,
} from '../../src/stores/lockfile-v3';

const NOW = '2026-10-09T12:00:00.000Z';
const DEFAULTS = { generatedBy: 'ai-primitives-hub-cli', now: NOW };

const fakeFs = () => {
  const files = new Map<string, string>();
  const order: string[] = [];
  const renames: [string, string][] = [];
  return {
    files,
    order,
    renames,
    readFile: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) {
        throw new Error(`ENOENT ${p}`);
      }
      return value;
    },
    writeFile: async (p: string, contents: string) => {
      files.set(p, contents);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => undefined,
    remove: async (p: string) => {
      files.delete(p);
    },
    rename: async (from: string, to: string) => {
      renames.push([from, to]);
      order.push(to);
      files.set(to, files.get(from) as string);
      files.delete(from);
    }
  };
};

/** The same pair shape at either scope; only these two strings differ. */
const userPaths = {
  desiredFile: '/cfg/ai-primitives-hub/ai-primitives-hub.lock.json',
  localFile: '/cfg/ai-primitives-hub/ai-primitives-hub.local.lock.json'
};
const repoPaths = {
  desiredFile: '/work/ai-primitives-hub.lock.json',
  localFile: '/work/ai-primitives-hub.local.lock.json'
};

const binding = {
  targetName: 'my-vscode',
  targetType: 'vscode' as const,
  scope: 'user' as const,
  baseDir: '/home/u/.copilot'
};

const record = () => ({
  version: '1.0.0',
  sourceId: 'src',
  installedAt: NOW,
  files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
});

describe('empty pair', () => {
  it('splits the roles: desired carries no generated metadata', () => {
    const desired = emptyDesiredLockfileV3();

    expect(desired.version).toBe(LOCKFILE_V3_VERSION);
    expect(desired.bundles).toEqual({});
    expect(desired.sources).toEqual({});
    expect('generatedAt' in desired).toBe(false);
    expect('generatedBy' in desired).toBe(false);
    expect('targets' in desired).toBe(false);
  });

  it('splits the roles: local carries materialization and the churn fields', () => {
    const local = emptyLocalLockfileV3('cli', NOW);

    expect(local.version).toBe(LOCKFILE_V3_VERSION);
    expect(local.generatedAt).toBe(NOW);
    expect(local.generatedBy).toBe('cli');
    expect(local.targets).toEqual({});
    expect('bundles' in local).toBe(false);
  });
});

describe('readLockfileV3Pair', () => {
  it('returns an empty pair when neither file exists, and reports that', async () => {
    const { pair, desiredExists, localExists } = await readLockfileV3Pair(userPaths, fakeFs(), DEFAULTS);

    expect(desiredExists).toBe(false);
    expect(localExists).toBe(false);
    expect(pair.desired.bundles).toEqual({});
    expect(pair.local.targets).toEqual({});
  });

  it('reads a half-present pair — local written, desired not yet (the §8.4 interruption)', async () => {
    const fs = fakeFs();
    fs.files.set(userPaths.localFile, JSON.stringify(
      upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record())
    ));

    const { pair, desiredExists, localExists } = await readLockfileV3Pair(userPaths, fs, DEFAULTS);

    expect(desiredExists).toBe(false);
    expect(localExists).toBe(true);
    expect(pair.local.targets['my-vscode'].bundles['src/web-dev']).toBeDefined();
  });

  it('refuses a v2 file so the caller migrates instead of misreading it', async () => {
    const fs = fakeFs();
    fs.files.set(userPaths.desiredFile, JSON.stringify({ version: '2.0.0', bundles: {}, sources: {} }));

    await expect(readLockfileV3Pair(userPaths, fs, DEFAULTS))
      .rejects.toThrow(LockfileGenerationMismatchError);
  });

  it('refuses an unknown major loudly', async () => {
    const fs = fakeFs();
    fs.files.set(userPaths.localFile, JSON.stringify({ version: '9.0.0' }));

    await expect(readLockfileV3Pair(userPaths, fs, DEFAULTS))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });

  it('round-trips a written pair', async () => {
    const fs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', { version: '1.0.0', sourceId: 'src' }),
      local: upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record())
    };
    await writeLockfileV3Pair(userPaths, pair, fs);

    expect((await readLockfileV3Pair(userPaths, fs, DEFAULTS)).pair).toEqual(pair);
  });
});

describe('writeLockfileV3Pair', () => {
  it('writes the local file before the desired file (§8.4 ordering)', async () => {
    const fs = fakeFs();

    await writeLockfileV3Pair(userPaths, {
      desired: emptyDesiredLockfileV3(),
      local: emptyLocalLockfileV3('cli', NOW)
    }, fs);

    expect(fs.order).toEqual([userPaths.localFile, userPaths.desiredFile]);
  });

  it('writes through a unique temp file per write', async () => {
    const fs = fakeFs();
    const pair = { desired: emptyDesiredLockfileV3(), local: emptyLocalLockfileV3('cli', NOW) };

    await writeLockfileV3Pair(userPaths, pair, fs);
    await writeLockfileV3Pair(userPaths, pair, fs);

    const temps = fs.renames.map(([from]) => from);
    expect(new Set(temps).size).toBe(temps.length);
    expect(temps[0]).toContain(`${userPaths.localFile}.`);
  });

  it('refuses a payload that is not 3.0.0, writing nothing', async () => {
    const fs = fakeFs();

    await expect(writeLockfileV3Pair(userPaths, {
      desired: { ...emptyDesiredLockfileV3(), version: '2.0.0' },
      local: emptyLocalLockfileV3('cli', NOW)
    }, fs)).rejects.toThrow();
    expect(fs.files.size).toBe(0);
  });

  it('ends each file with a trailing newline, like the v2 writer', async () => {
    const fs = fakeFs();

    await writeLockfileV3Pair(userPaths, {
      desired: emptyDesiredLockfileV3(),
      local: emptyLocalLockfileV3('cli', NOW)
    }, fs);

    expect(fs.files.get(userPaths.desiredFile)?.endsWith('}\n')).toBe(true);
    expect(fs.files.get(userPaths.localFile)?.endsWith('}\n')).toBe(true);
  });

  it('behaves identically at repository paths — only the destination differs', async () => {
    const userFs = fakeFs();
    const repoFs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', { version: '1.0.0', sourceId: 'src' }),
      local: upsertMaterialization(
        emptyLocalLockfileV3('cli', NOW),
        { ...binding, scope: 'repository', baseDir: '/work' },
        'src/web-dev',
        record()
      )
    };

    await writeLockfileV3Pair(userPaths, pair, userFs);
    await writeLockfileV3Pair(repoPaths, pair, repoFs);

    expect(repoFs.files.get(repoPaths.desiredFile)).toBe(userFs.files.get(userPaths.desiredFile));
    expect(repoFs.files.get(repoPaths.localFile)).toBe(userFs.files.get(userPaths.localFile));
  });
});

describe('pure record helpers', () => {
  it('upsertDesiredBundle does not mutate its input', () => {
    const before = emptyDesiredLockfileV3();

    const after = upsertDesiredBundle(before, 'src/web-dev', { version: '1.0.0', sourceId: 'src' });

    expect(before.bundles).toEqual({});
    expect(after.bundles['src/web-dev']).toEqual({ version: '1.0.0', sourceId: 'src' });
  });

  it('a desired entry carries only version, sourceId and optional archiveSha', () => {
    const lock = upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', {
      version: '1.0.0', sourceId: 'src', archiveSha: 'sha256:deadbeef'
    });

    expect(Object.keys(lock.bundles['src/web-dev']).toSorted())
      .toEqual(['archiveSha', 'sourceId', 'version']);
  });

  it('upsertMaterialization creates the target record on first use', () => {
    const local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record());

    expect(local.targets['my-vscode'].targetType).toBe('vscode');
    expect(local.targets['my-vscode'].baseDir).toBe('/home/u/.copilot');
    expect(local.targets['my-vscode'].bundles['src/web-dev'].files).toHaveLength(1);
  });

  it('carries commitMode only when the caller supplies it', () => {
    const withoutMode = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'k', record());
    const withMode = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      { ...binding, scope: 'repository', baseDir: '/work', commitMode: 'local-only' },
      'k',
      record()
    );

    expect('commitMode' in withoutMode.targets['my-vscode']).toBe(false);
    expect(withMode.targets['my-vscode'].commitMode).toBe('local-only');
  });

  it('removeMaterialization drops the bundle and prunes an emptied target', () => {
    const seeded = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record());

    expect(removeMaterialization(seeded, 'my-vscode', 'src/web-dev').targets['my-vscode']).toBeUndefined();
  });

  it('removeMaterialization keeps a target that still holds another bundle', () => {
    let local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/a', record());
    local = upsertMaterialization(local, binding, 'src/b', record());

    expect(Object.keys(removeMaterialization(local, 'my-vscode', 'src/a').targets['my-vscode'].bundles))
      .toEqual(['src/b']);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C packages/app test -- lockfile-v3`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `packages/app/src/stores/lockfile-v3.ts` with this module doc, then the types and functions from the Interfaces block:

```ts
/**
 * Lockfile schema 3.0.0 — the role-split pair, scope-agnostic.
 *
 * Desired state (`bundles`, `sources`, `hubs`, `profiles`) and
 * materialization (`targets`) live in two files. **This module does not
 * know which scope it is serving**: the caller passes `LockfileV3Paths`
 * and everything else — shapes, ordering, atomicity, record helpers —
 * is identical at user and repository scope. That is a requester
 * decision amending design §5.1, and it is why slice 3 adds a caller
 * rather than a second store.
 *
 * `generatedAt`/`generatedBy` are in the local file only, so the
 * desired file is byte-comparable: two developers migrating the same
 * state produce the same content (§8.1), and §10's parity assertion
 * needs no normalization step.
 *
 * Write order is local-then-desired and the pair is not one filesystem
 * transaction (§8.4). Every intermediate state is legal and the reader
 * reports which halves it found, so a caller can resume rather than
 * assume.
 * @module stores/lockfile-v3
 */
```

Key bodies:

```ts
export const LOCKFILE_V3_VERSION = '3.0.0';

const LOCKFILE_V3_SCHEMA_URL =
  'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json';

/** Thrown when a readable lockfile belongs to a different schema generation than the caller expected. */
export class LockfileGenerationMismatchError extends Error {
  public readonly code = 'LOCKFILE.GENERATION_MISMATCH';

  /**
   * @param file - Absolute lockfile path.
   * @param found - Major version found on disk.
   * @param expected - Major version the caller required.
   */
  public constructor(
    public readonly file: string,
    public readonly found: number,
    public readonly expected: number
  ) {
    super(
      `${file} is lockfile schema ${found}.x, but schema ${expected}.x was required here. `
      + 'Migrate it first (this is a wiring defect, not a user error).'
    );
    this.name = 'LockfileGenerationMismatchError';
  }
}

const readV3File = async <T>(
  file: string,
  fs: LockfileFs,
  fallback: () => T
): Promise<{ value: T; existed: boolean }> => {
  if (!(await fs.exists(file))) {
    return { value: fallback(), existed: false };
  }
  const parsed = JSON.parse(await fs.readFile(file)) as { version?: unknown };
  const verdict = classifyLockfileVersion(parsed.version);
  if (verdict.kind !== 'readable') {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  if (verdict.major !== 3) {
    throw new LockfileGenerationMismatchError(file, verdict.major, 3);
  }
  return { value: parsed as T, existed: true };
};

export const readLockfileV3Pair = async (
  paths: LockfileV3Paths,
  fs: LockfileFs,
  defaults: { generatedBy: string; now: string }
): Promise<{ pair: LockfileV3Pair; desiredExists: boolean; localExists: boolean }> => {
  const desired = await readV3File<DesiredLockfileV3>(
    paths.desiredFile, fs, emptyDesiredLockfileV3
  );
  const local = await readV3File<LocalLockfileV3>(
    paths.localFile, fs, () => emptyLocalLockfileV3(defaults.generatedBy, defaults.now)
  );
  return {
    pair: { desired: desired.value, local: local.value },
    desiredExists: desired.existed,
    localExists: local.existed
  };
};

const writeV3File = async (
  file: string,
  payload: { version: string },
  fs: LockfileFsWithRename
): Promise<void> => {
  const verdict = classifyLockfileVersion(payload.version);
  if (verdict.kind !== 'readable' || verdict.major !== 3) {
    throw new UnsupportedLockfileVersionError(file, verdict);
  }
  if (fs.mkdir !== undefined) {
    await fs.mkdir(path.dirname(file), { recursive: true });
  }
  const contents = JSON.stringify(payload, null, 2) + '\n';
  if (fs.rename === undefined) {
    await fs.writeFile(file, contents);
    return;
  }
  // Unique per write: two processes must not race on one fixed temp path.
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, contents);
  try {
    await fs.rename(temp, file);
  } catch (cause) {
    if (fs.remove !== undefined) {
      try {
        await fs.remove(temp);
      } catch {
        // Cleanup is best effort; preserve the rename failure.
      }
    }
    throw cause;
  }
};

export const writeLockfileV3Pair = async (
  paths: LockfileV3Paths,
  pair: LockfileV3Pair,
  fs: LockfileFsWithRename
): Promise<void> => {
  // Validate both halves before writing either, so a bad desired payload
  // cannot leave a written local file behind.
  for (const [file, payload] of [
    [paths.localFile, pair.local],
    [paths.desiredFile, pair.desired]
  ] as const) {
    const verdict = classifyLockfileVersion(payload.version);
    if (verdict.kind !== 'readable' || verdict.major !== 3) {
      throw new UnsupportedLockfileVersionError(file, verdict);
    }
  }
  // Local first (§8.4 step 1), then desired (step 2).
  await writeV3File(paths.localFile, pair.local, fs);
  await writeV3File(paths.desiredFile, pair.desired, fs);
};
```

`emptyDesiredLockfileV3` returns `{ $schema: LOCKFILE_V3_SCHEMA_URL, version: LOCKFILE_V3_VERSION, bundles: {}, sources: {} }` — no `hubs`/`profiles` keys until something populates them, because `additionalProperties: false` tolerates their absence but an empty object would be noise in a shared file.

`upsertMaterialization` / `removeMaterialization` follow `upsertBundleEntry`'s non-mutating spread style (`json-lockfile-store.ts:246`), take `TargetBinding` (`{ targetName, targetType, scope, baseDir, commitMode? }`), and spread `commitMode` conditionally so it is absent rather than `undefined` at user scope.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C packages/app test -- lockfile-v3 user-config-paths`
Expected: PASS (19 tests).

- [ ] **Step 6: Export and commit**

Add the module to `packages/app/src/stores/index.ts` following the file's existing style.

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/app test
git add packages/app/src/stores/lockfile-v3.ts \
        packages/app/test/stores/lockfile-v3.test.ts \
        packages/app/src/stores/index.ts \
        packages/app/src/registry/user-config-paths.ts \
        packages/app/test/registry/user-config-paths.test.ts
git commit -m "feat(app): add the 3.0.0 role-split lockfile store

One scope-agnostic store for both files: desired state carries no local
identifiers and no generated metadata, so it is byte-comparable;
materialization carries targets and the churn fields. The caller passes
the path pair, so user and repository scope differ only in destination
(amends design 5.1 per requester decision).

Writes local before desired, each through a unique temp file and
rename, and the reader reports which halves it found so an interrupted
pair write can be resumed rather than assumed (design 8.4)."
```

### Task 8: Migrate v2 lockfile state to the v3 pair

§8.3's last paragraph, §8.4's ordering, and §11's slice-1 row. One-way: v2 state is read, converted, and written as the v3 pair on the first flag-on write. Not a dual-format writer — converting forward once is explicitly not the same thing (§5.12).

Like the store, this is **one scope-agnostic implementation**. The only thing that differs between scopes is data: which files are read, written and deleted.

| Scope | `desiredFile` | `localFile` | `legacyFiles` |
|---|---|---|---|
| User (this plan) | `<xdg>/ai-primitives-hub/ai-primitives-hub.lock.json` | `<xdg>/…/ai-primitives-hub.local.lock.json` | `[]` — the legacy file *is* `desiredFile`, rewritten in place |
| Repository (slice 3) | `<repo>/ai-primitives-hub.lock.json` | `<repo>/ai-primitives-hub.local.lock.json` | `['<repo>/prompt-registry.lock.json', '<repo>/prompt-registry.local.lock.json']` |

Keeping `legacyFiles` a **list** is what stops §8.4's two deletion steps from becoming a scope branch: user scope passes an empty list and steps 3–4 are no-ops, which §8.4 already requires them to tolerate ("3 and 4 tolerate an already-absent file").

The hard part is not the conversion; it is what cannot be converted. A v2 CLI `files[].path` is **bundle-relative** with an archive-byte `checksum`, while v3's `path` is on-disk and `installedChecksum` baselines written bytes (§5.7, §5.8). §8.3's single rule applies: **if the destination is not proven, leave the files alone, retain the record marked unmanaged, and log it with the bundle name.** No old-rules locator is built. The one exception is the bundle whose own install triggered the migration — that one is being deployed now, so it gets fresh paths and both checksums.

**Files:**
- Create: `packages/app/src/stores/migrate-lockfile-v3.ts`
- Create: `packages/app/test/stores/migrate-lockfile-v3.test.ts`
- Modify: `packages/app/src/stores/index.ts`

**Interfaces:**
- Consumes: `Lockfile` / `LockfileBundleEntry` (v2, `json-lockfile-store.ts`); the Task 7 store; `logicalKeyFromLegacyId` (Task 4).
- Produces:
  - `UNMANAGED_TARGET_KEY = 'unmanaged'`
  - `interface MigrationReport { migrated: string[]; unmanaged: { key: string; reason: string }[] }`
  - `interface MigrationSources { desiredFile: string; localFile: string; legacyFiles: readonly string[] }`
  - `convertV2ToPair(v2: Lockfile, options: { generatedBy: string; now: string; triggeredByKey?: string }): { pair: LockfileV3Pair; report: MigrationReport }` — pure
  - `migrateLockfileIfNeeded(sources: MigrationSources, fs: LockfileFsWithRename, options: { generatedBy: string; now: string; triggeredByKey?: string }): Promise<{ pair: LockfileV3Pair; report: MigrationReport | null }>`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/stores/migrate-lockfile-v3.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  convertV2ToPair,
  migrateLockfileIfNeeded,
  UNMANAGED_TARGET_KEY,
} from '../../src/stores/migrate-lockfile-v3';

const NOW = '2026-10-09T12:00:00.000Z';
const OPTS = { generatedBy: 'ai-primitives-hub-cli', now: NOW };

const userSources = {
  desiredFile: '/cfg/ai-primitives-hub/ai-primitives-hub.lock.json',
  localFile: '/cfg/ai-primitives-hub/ai-primitives-hub.local.lock.json',
  legacyFiles: [] as const
};

const v2WithOneBundle = () => ({
  $schema: 'https://example.com/lockfile.schema.json',
  version: '2.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  generatedBy: 'ai-primitives-hub-cli',
  bundles: {
    'web-dev': {
      version: '1.0.0',
      sourceId: 'github-abc123',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      checksum: 'sha256:archivebytes',
      files: [{ path: 'prompts/hello.prompt.md', checksum: 'archivehash' }]
    }
  },
  sources: {
    'github-abc123': { type: 'github', url: 'https://github.com/owner/repo', branch: 'main' }
  }
});

const fakeFs = () => {
  const files = new Map<string, string>();
  const order: string[] = [];
  return {
    files,
    order,
    readFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error(`ENOENT ${p}`);
      }
      return v;
    },
    writeFile: async (p: string, c: string) => {
      files.set(p, c);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => undefined,
    remove: async (p: string) => {
      order.push(`delete:${p}`);
      files.delete(p);
    },
    rename: async (from: string, to: string) => {
      order.push(`write:${to}`);
      files.set(to, files.get(from) as string);
      files.delete(from);
    }
  };
};

describe('convertV2ToPair', () => {
  it('splits one v2 file into the two role halves', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle() as never, OPTS);

    expect(pair.desired.version).toBe('3.0.0');
    expect(pair.local.version).toBe('3.0.0');
    expect('targets' in pair.desired).toBe(false);
    expect('bundles' in pair.local).toBe(false);
  });

  it('carries desired state across with sourceType and installedAt dropped', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle() as never, OPTS);

    expect(pair.desired.bundles['github-abc123/web-dev'])
      .toEqual({ version: '1.0.0', sourceId: 'github-abc123', archiveSha: 'sha256:archivebytes' });
    expect(pair.desired.sources['github-abc123'].type).toBe('github');
  });

  it('keys both halves by the logical bundle key, not the legacy id', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle() as never, OPTS);

    expect(Object.keys(pair.desired.bundles)).toEqual(['github-abc123/web-dev']);
    expect(Object.keys(pair.local.targets[UNMANAGED_TARGET_KEY].bundles))
      .toEqual(['github-abc123/web-dev']);
  });

  it('retains a CLI record as unmanaged rather than inventing a destination', () => {
    const { pair, report } = convertV2ToPair(v2WithOneBundle() as never, OPTS);

    expect(report.unmanaged).toHaveLength(1);
    expect(report.unmanaged[0].key).toBe('github-abc123/web-dev');
    expect(report.unmanaged[0].reason).toContain('destination could not be proven');
    const rec = pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev'];
    expect(rec.state).toBe('unmanaged');
    expect(rec.files.map((f) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('never rebaselines: the archive hash survives as checksum, not installedChecksum', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle() as never, OPTS);

    const file = pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev'].files[0];
    expect(file.checksum).toBe('archivehash');
    expect(file.installedChecksum).toBeUndefined();
  });

  it('marks a bundle whose source descriptor is missing as unmanaged for that reason', () => {
    const broken = { ...v2WithOneBundle(), sources: {} };

    const { report } = convertV2ToPair(broken as never, OPTS);

    expect(report.unmanaged[0].reason).toContain('source descriptor');
  });

  it('omits the triggering bundle from materialization — the deploy records it fresh', () => {
    const { pair, report } = convertV2ToPair(v2WithOneBundle() as never, {
      ...OPTS, triggeredByKey: 'github-abc123/web-dev'
    });

    expect(report.unmanaged).toEqual([]);
    expect(report.migrated).toEqual(['github-abc123/web-dev']);
    expect(pair.local.targets[UNMANAGED_TARGET_KEY]).toBeUndefined();
    expect(pair.desired.bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('carries hubs and profiles into the desired half untouched', () => {
    const v2 = {
      ...v2WithOneBundle(),
      hubs: { h: { name: 'Hub', url: 'https://example.com/hub.yml' } },
      profiles: { p: { name: 'P', bundleIds: ['web-dev'] } }
    };

    const { pair } = convertV2ToPair(v2 as never, OPTS);

    expect(pair.desired.hubs).toEqual(v2.hubs);
    expect(pair.desired.profiles).toEqual(v2.profiles);
  });

  it('converts an empty v2 file into an empty pair', () => {
    const v2 = { ...v2WithOneBundle(), bundles: {}, sources: {} };

    const { pair, report } = convertV2ToPair(v2 as never, OPTS);

    expect(pair.desired.bundles).toEqual({});
    expect(pair.local.targets).toEqual({});
    expect(report).toEqual({ migrated: [], unmanaged: [] });
  });

  it('produces identical bytes for identical input — no wall-clock in the desired half', () => {
    const first = convertV2ToPair(v2WithOneBundle() as never, OPTS);
    const second = convertV2ToPair(v2WithOneBundle() as never, {
      ...OPTS, now: '2027-05-05T05:05:05.000Z'
    });

    expect(JSON.stringify(first.pair.desired)).toBe(JSON.stringify(second.pair.desired));
    expect(first.pair.local.generatedAt).not.toBe(second.pair.local.generatedAt);
  });
});

describe('migrateLockfileIfNeeded', () => {
  it('returns an empty pair when nothing exists, writing nothing', async () => {
    const fs = fakeFs();

    const { pair, report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(pair.desired.version).toBe('3.0.0');
    expect(report).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('migrates a v2 file in place on the first call', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));

    const { report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(report?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/web-dev']);
    expect(JSON.parse(fs.files.get(userSources.desiredFile) as string).version).toBe('3.0.0');
    expect(JSON.parse(fs.files.get(userSources.localFile) as string).version).toBe('3.0.0');
  });

  it('follows §8.4 order: local, desired, legacy deletions, then the marker', async () => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json', '/work/prompt-registry.local.lock.json']
    };
    fs.files.set('/work/prompt-registry.lock.json', JSON.stringify(v2WithOneBundle()));

    await migrateLockfileIfNeeded(repoSources, fs, OPTS);

    expect(fs.order).toEqual([
      'write:/work/ai-primitives-hub.local.lock.json',
      'write:/work/ai-primitives-hub.lock.json',
      'delete:/work/prompt-registry.lock.json',
      'write:/work/ai-primitives-hub.local.lock.json'
    ]);
  });

  it('writes the completion marker only after the legacy files are gone', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));

    await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(JSON.parse(fs.files.get(userSources.localFile) as string).migration)
      .toEqual({ lockfileV3: 'complete' });
  });

  it('is a no-op on the second call (Review Focus 5: converges)', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    await migrateLockfileIfNeeded(userSources, fs, OPTS);
    const afterFirst = [fs.files.get(userSources.desiredFile), fs.files.get(userSources.localFile)];

    const { report } = await migrateLockfileIfNeeded(userSources, fs, {
      ...OPTS, now: '2026-12-31T00:00:00.000Z'
    });

    expect(report).toBeNull();
    expect([fs.files.get(userSources.desiredFile), fs.files.get(userSources.localFile)])
      .toEqual(afterFirst);
  });

  it('resumes an interruption between the local and desired writes (Review Focus 5)', async () => {
    // §8.4: until the marker is set, materialization is the new local file
    // unioned with legacy, new winning per key — so a half-done migration
    // must not discard the legacy record.
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    const partial = convertV2ToPair(v2WithOneBundle() as never, OPTS);
    delete partial.pair.local.migration;
    fs.files.set(userSources.localFile, JSON.stringify(partial.pair.local));

    const { pair } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev']).toBeDefined();
    expect(JSON.parse(fs.files.get(userSources.localFile) as string).migration)
      .toEqual({ lockfileV3: 'complete' });
  });

  it('leaves the v2 file intact when the local write fails', async () => {
    const fs = fakeFs();
    const original = JSON.stringify(v2WithOneBundle());
    fs.files.set(userSources.desiredFile, original);
    fs.rename = async () => {
      throw new Error('disk full');
    };

    await expect(migrateLockfileIfNeeded(userSources, fs, OPTS)).rejects.toThrow('disk full');
    expect(fs.files.get(userSources.desiredFile)).toBe(original);
  });

  it('returns the existing pair untouched when already v3', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    await migrateLockfileIfNeeded(userSources, fs, OPTS);
    const before = fs.files.get(userSources.desiredFile);

    const { report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(report).toBeNull();
    expect(fs.files.get(userSources.desiredFile)).toBe(before);
  });

  it('refuses an unknown major instead of migrating it', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify({ version: '9.0.0' }));

    await expect(migrateLockfileIfNeeded(userSources, fs, OPTS))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/app test -- migrate-lockfile-v3`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/app/src/stores/migrate-lockfile-v3.ts`. The rules it implements, each traceable to the spec:

| Rule | Source |
|---|---|
| Key by `logicalKeyFromLegacyId(legacyId, entry.sourceId)` | §5.13 |
| Desired entry = `{ version, sourceId, archiveSha? }`; drop `sourceType` and `installedAt` | §5.2 |
| `checksum` (archive bytes) survives as `files[].checksum`; `installedChecksum` is **not** synthesized | §8.3 "never silently rebaseline" |
| Every carried materialization goes to the reserved `unmanaged` target record with `state: 'unmanaged'` and a human-readable `unmanagedReason` | §8.3's single fallback rule + "target assignment is load-bearing" |
| A bundle referencing a `sourceId` absent from `sources` gets the reason `unrecoverable source descriptor` | §8.3 |
| `triggeredByKey`'s materialization is omitted entirely — the deploy writes it fresh | §8.3 last paragraph |
| `hubs` and `profiles` carried verbatim into the desired half | §5.2 |
| No wall-clock in the desired half | §8.1, §5.2 |

The `unmanaged` target name is a reserved key, not a configured target: §8.3 binds to a configured target only when exactly one matches the resolved destination root, and a bundle-relative path resolves no root at all. Document that in the module doc and give the record `baseDir: ''` so it cannot be mistaken for a real binding.

```ts
/** Reserved target-record key for materializations with no provable binding (§8.3). */
export const UNMANAGED_TARGET_KEY = 'unmanaged';
```

`migrateLockfileIfNeeded` sequences as §8.4, with every step idempotent:

1. Read the raw v2 source — `legacyFiles[0]` if any exists, else `desiredFile`. Classify its version. Absent → return an empty pair, `report: null`, **no write**. Major 3 → read the pair through `readLockfileV3Pair` and return it with `report: null`. Major 2 → continue.
2. `convertV2ToPair`. Union the converted `local.targets` with any **existing** v3 local file's targets, new winning per key — §8.4's reading rule until the marker is set, which is what makes an interruption between steps 1 and 2 resumable.
3. Write the local file **without** the marker, then the desired file (`writeLockfileV3Pair` already does these two in order).
4. Delete each `legacyFiles` entry, tolerating absence. Empty list → no-op.
5. Write the local file again, now with `migration: { lockfileV3: 'complete' }`.

Step 5 is a second write of the same file by design: the marker — not the presence of the new desired file — is what makes legacy state non-authoritative (§8.4), and setting it in step 3 would claim completion before the deletions happened.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/app test -- migrate-lockfile-v3`
Expected: PASS (19 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/app test
git add packages/app/src/stores/migrate-lockfile-v3.ts \
        packages/app/test/stores/migrate-lockfile-v3.test.ts \
        packages/app/src/stores/index.ts
git commit -m "feat(app): migrate v2 lockfile state to the 3.0.0 pair

One scope-agnostic migration: the caller passes the destination pair and
the legacy file list, so user scope rewrites one same-named file in place
and repository scope (slice 3) deletes two differently named ones,
without a scope branch.

Desired state is carried and rekeyed by logical bundle key.
Materializations whose destination cannot be proven are retained as
unmanaged with a reason rather than rebaselined or deleted (design 8.3),
and the bundle whose own install triggered the migration is left for the
deploy to record fresh. Follows design 8.4's order, setting the
completion marker only after the legacy files are gone, and unions
legacy records in until it is set so an interruption resumes."
```

### Task 9: Placement normalization and `planDeploy`

Manifest-driven routing (§4.1) plus the read-only planner (§3.1). `planDeploy` performs **no writes through any port** — that is what makes it usable for `--dry-run`.

Slice 1 scope: user scope, `vscode`. MCP is slice 7, so `DeployPlan.mcp` is present in the type and always `{ servers: [], skipped: [] }` here. Repository-only fields (`conflict.kind === 'shared-destination'`, git-exclude) are likewise typed but unreachable.

**Files:**
- Create: `packages/core/src/domain/install/placement.ts`
- Create: `packages/core/test/domain/install/placement.test.ts`
- Create: `packages/app/src/deploy/types.ts`
- Create: `packages/app/src/deploy/plan.ts`
- Create: `packages/app/src/deploy/index.ts`
- Create: `packages/app/test/deploy/plan.test.ts`
- Modify: `packages/core/src/domain/index.ts`, `packages/app/src/index.ts`

**Interfaces:**
- Consumes: `invertKindRoutes` (Task 2), `destinationNameForKind`/`nameShapeForKind` (Task 3), `readLockfileV3Pair` (Task 7), `TargetLayout`, `expandPath`, `ValidatedManifest`, `isReleaseDeploymentManifest`, `normalizePrimitiveKind`, `determineFileType`.
- Produces (core):
  - `interface NormalizedPlacementItem { id: string; kind: PrimitiveKind; sourcePath: string }`
  - `type PlacementRejection = { sourcePath: string; reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered' }`
  - `normalizeManifestItems(manifest: ValidatedManifest): { items: NormalizedPlacementItem[]; rejected: PlacementRejection[] }`
  - `resolveDestinations(items, context): { destinations: PlacementDestination[]; skipped: PlacementRejection[]; duplicates: { to: string; ids: string[] }[] }`
- Produces (app): `planDeploy`, and the `DeployRequest` / `PlacementContext` / `DeployPlan` / `DeployPorts` types from §3.1.

- [ ] **Step 1: Write the failing core placement test**

Create `packages/core/test/domain/install/placement.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  normalizeManifestItems,
  resolveDestinations,
} from '../../../src/domain/install/placement';

const governed = {
  formatVersion: 1,
  id: 'web-dev',
  version: '1.0.0',
  name: 'Web Dev',
  items: [
    { id: 'hello', path: 'prompts/hello.prompt.md', kind: 'prompt' },
    { id: 'ts-standards', path: 'prompts/typescript-standards.instructions.md', kind: 'instruction' },
    { id: 'reviewer', path: 'agents/code-reviewer.agent.md', kind: 'agent' }
  ],
  files: [],
  provenance: {}
} as never;

const legacy = {
  id: 'web-dev',
  version: '1.0.0',
  name: 'Web Dev',
  prompts: [
    { id: 'hello', file: 'prompts/hello.prompt.md', type: 'prompt' },
    { id: 'ts-standards', file: 'prompts/typescript-standards.instructions.md', type: 'instructions' }
  ]
} as never;

const vscodeUserContext = {
  baseRoot: '/home/u/.copilot',
  kindRoutes: {
    'prompts/': 'prompts/',
    'instructions/': 'instructions/',
    'chat-modes/': 'agents/',
    'agents/': 'agents/',
    'skills/': 'skills/',
    'hooks/': 'hooks/',
    'plugins/': 'plugins/'
  }
};

describe('normalizeManifestItems', () => {
  it('reads canonical items[] with their declared kind', () => {
    const { items, rejected } = normalizeManifestItems(governed);

    expect(rejected).toEqual([]);
    expect(items).toEqual([
      { id: 'hello', kind: 'prompt', sourcePath: 'prompts/hello.prompt.md' },
      { id: 'ts-standards', kind: 'instruction', sourcePath: 'prompts/typescript-standards.instructions.md' },
      { id: 'reviewer', kind: 'agent', sourcePath: 'agents/code-reviewer.agent.md' }
    ]);
  });

  it('reads legacy prompts[] through type and filename detection', () => {
    const { items } = normalizeManifestItems(legacy);

    expect(items).toEqual([
      { id: 'hello', kind: 'prompt', sourcePath: 'prompts/hello.prompt.md' },
      { id: 'ts-standards', kind: 'instruction', sourcePath: 'prompts/typescript-standards.instructions.md' }
    ]);
  });

  it('rejects an item whose kind is not in the vocabulary as invalid-kind', () => {
    const bad = { ...(governed as object), items: [{ id: 'x', path: 'p/x.md', kind: 'nonsense' }] } as never;

    const { items, rejected } = normalizeManifestItems(bad);

    expect(items).toEqual([]);
    expect(rejected).toEqual([{ sourcePath: 'p/x.md', reason: 'invalid-kind' }]);
  });

  it('prefers items[] when a governed manifest also carries the legacy projection', () => {
    const both = { ...(governed as object), prompts: [{ id: 'other', file: 'p/other.md', type: 'prompt' }] } as never;

    const { items } = normalizeManifestItems(both);

    expect(items.map((i) => i.id)).toEqual(['hello', 'ts-standards', 'reviewer']);
  });
});

describe('resolveDestinations', () => {
  it('routes by manifest kind, not by source path prefix', () => {
    // The §4.5 mismatch case: declared under prompts/ but typed instruction.
    const { items } = normalizeManifestItems(governed);

    const { destinations } = resolveDestinations(items, vscodeUserContext);

    expect(destinations).toEqual([
      { kind: 'prompt', from: 'prompts/hello.prompt.md', to: '/home/u/.copilot/prompts/hello.prompt.md' },
      {
        kind: 'instruction',
        from: 'prompts/typescript-standards.instructions.md',
        to: '/home/u/.copilot/instructions/ts-standards.instructions.md'
      },
      { kind: 'agent', from: 'agents/code-reviewer.agent.md', to: '/home/u/.copilot/agents/reviewer.agent.md' }
    ]);
  });

  it('renames from the normalized id when id and filename stem disagree', () => {
    const { destinations } = resolveDestinations(
      [{ id: 'My Agent/v2', kind: 'agent', sourcePath: 'agents/whatever.agent.md' }],
      vscodeUserContext
    );

    expect(destinations[0].to).toBe('/home/u/.copilot/agents/My-Agent-v2.agent.md');
  });

  it('skips a kind the target layout has no route for', () => {
    const { destinations, skipped } = resolveDestinations(
      [{ id: 's', kind: 'steering', sourcePath: 'steering/style.md' }],
      vscodeUserContext
    );

    expect(destinations).toEqual([]);
    expect(skipped).toEqual([{ sourcePath: 'steering/style.md', reason: 'unsupported-by-target' }]);
  });

  it('honors allowedKinds by canonical kind, with no alias round-trip', () => {
    const { items } = normalizeManifestItems(governed);

    const { destinations, skipped } = resolveDestinations(items, {
      ...vscodeUserContext,
      allowedKinds: ['prompt']
    });

    expect(destinations.map((d) => d.kind)).toEqual(['prompt']);
    expect(skipped.map((s) => s.reason)).toEqual(['filtered', 'filtered']);
  });

  it('reports two ids that normalize to one destination (Review Focus 3)', () => {
    const { duplicates } = resolveDestinations(
      [
        { id: 'foo.bar', kind: 'prompt', sourcePath: 'prompts/a.md' },
        { id: 'foo-bar', kind: 'prompt', sourcePath: 'prompts/b.md' }
      ],
      vscodeUserContext
    );

    expect(duplicates).toEqual([{
      to: '/home/u/.copilot/prompts/foo-bar.prompt.md',
      ids: ['foo.bar', 'foo-bar']
    }]);
  });

  it('reports an unrecognized custom layout key (Review Focus 2)', () => {
    const { unknownLayoutKeys } = resolveDestinations([], {
      ...vscodeUserContext,
      kindRoutes: { ...vscodeUserContext.kindRoutes, 'team-stuff/': 'team/' }
    });

    expect(unknownLayoutKeys).toEqual(['team-stuff/']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/core test -- placement`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core`'s placement module**

Create `packages/core/src/domain/install/placement.ts`. Shape:

```ts
/**
 * Domain layer — manifest-driven placement.
 *
 * Routing is manifest-driven, always; source-path-prefix routing is
 * retired (design 4.1). Both manifest formats are reached in production
 * — governed release manifests express `items[]` with canonical `kind`
 * and `path`, legacy manifests express `prompts[]` with `type` and
 * `file` plus filename detection — so the shared contract is a
 * **normalized placement item**, not `item.type`: making the legacy
 * shape the contract would bake one of the two formats into the new
 * writer.
 *
 * Destination resolution is pure over an explicit context (design 4.6),
 * which is what lets verification re-derive it rather than re-reading
 * mutable configuration.
 *
 * Three rejection reasons are kept distinct because the writer must
 * treat them differently (design 4.7): `unsupported-by-target` (the
 * layout has no route for this kind), `invalid-kind` (the manifest
 * declared something outside the vocabulary), `filtered` (excluded by
 * `allowedKinds`).
 * @module domain/install/placement
 */
```

`normalizeManifestItems` branches on `isReleaseDeploymentManifest(manifest)`: canonical items map `{ id, path, kind }` through `normalizePrimitiveKind`, rejecting an unresolvable kind as `invalid-kind`; the legacy branch maps `prompts[]` through `determineFileType(file, tags)` when `type` is absent, then `normalizePrimitiveKind` on the result (`instructions` → `instruction`, `chatmode` → `chat-mode` — both already in the alias table).

`resolveDestinations(items, context)` takes `{ baseRoot, kindRoutes, allowedKinds? }`, calls `invertKindRoutes` once, and for each item:
1. `allowedKinds` present and the kind absent → `filtered`.
2. No entry in `byKind` → `unsupported-by-target`.
3. `nameShapeForKind(kind) === 'not-placed'` → `unsupported-by-target` (slice 7 routes `mcp-server` elsewhere).
4. Otherwise `to = posix.join(baseRoot, outputDir, destinationNameForKind(kind, id, basename(sourcePath)))`.

It returns `{ destinations, skipped, duplicates, unknownLayoutKeys }` — `duplicates` groups destinations claimed by more than one id (Review Focus 3), `unknownLayoutKeys` is `invertKindRoutes`'s `unknownKeys` passed straight through (Review Focus 2). Use `node:path`'s `posix` member only; this module must not touch the filesystem and must produce the same strings on Windows.

Order matters for the `allowedKinds` test above: filter before the route lookup, so a kind excluded by configuration is reported as `filtered` rather than `unsupported-by-target`.

- [ ] **Step 4: Run the core test to verify it passes**

Run: `pnpm -C packages/core test -- placement`
Expected: PASS (11 tests).

- [ ] **Step 5: Write the failing `planDeploy` test**

Create `packages/app/test/deploy/plan.test.ts`. It drives `planDeploy` with hand-written in-memory ports, and the central assertion is the one §10 demands: **no writes through any port**.

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  planDeploy,
} from '../../src/deploy/plan';
import {
  createGovernedReleaseArchive,
} from '../../../core/test/fixtures/release-archives';

const rejectOnWrite = (label: string) => () => {
  throw new Error(`planDeploy must not write (${label})`);
};

/**
 * Ports that reject every mutation, per §10: a dry-run guarantee is
 * asserted by injecting ports that refuse to mutate, not by checking
 * that an output file is absent.
 */
const readOnlyPorts = (files: Map<string, string>) => ({
  fs: {
    readFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error(`ENOENT ${p}`);
      }
      return v;
    },
    readFileBytes: async (p: string) => new TextEncoder().encode(files.get(p) ?? ''),
    exists: async (p: string) => files.has(p),
    lstat: async () => ({ isDirectory: false, isFile: true, isSymbolicLink: false, size: 0, mtimeMs: 0 }),
    stat: async () => ({ isDirectory: false, isFile: true, size: 0, mtimeMs: 0 }),
    writeFile: rejectOnWrite('writeFile'),
    writeFileBytes: rejectOnWrite('writeFileBytes'),
    writeJson: rejectOnWrite('writeJson'),
    mkdir: rejectOnWrite('mkdir'),
    remove: rejectOnWrite('remove'),
    rename: rejectOnWrite('rename'),
    readJson: async (p: string) => JSON.parse(files.get(p) ?? 'null'),
    readDir: async () => [],
    readDirEntries: async () => []
  },
  env: { HOME: '/home/u' },
  appStorage: {
    getPaths: () => {
      throw new Error('planDeploy must not resolve storage roots');
    },
    getState: rejectOnWrite('getState'),
    setState: rejectOnWrite('setState')
  },
  // The pair, not a single file. Only these two strings change at
  // repository scope — everything else about the store is identical.
  lockfileStore: {
    desiredFile: '/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json',
    localFile: '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json'
  }
});

const LOCAL_FILE = '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json';

/** Seed a v3 local file holding one materialization record. */
const seedLocal = (files: { path: string; installedChecksum: string }[]): string => JSON.stringify({
  version: '3.0.0',
  generatedAt: '2026-10-09T12:00:00.000Z',
  generatedBy: 'ai-primitives-hub-cli',
  migration: { lockfileV3: 'complete' },
  targets: {
    'my-vscode': {
      targetType: 'vscode',
      scope: 'user',
      baseDir: '/home/u/.copilot',
      bundles: {
        'github-abc123/web-dev': {
          version: '1.0.0',
          sourceId: 'github-abc123',
          installedAt: '2026-10-09T12:00:00.000Z',
          files
        }
      }
    }
  }
});

const request = () => ({
  files: createGovernedReleaseArchive({ id: 'web-dev', version: '1.0.0' }),
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/repo' },
  targetName: 'my-vscode',
  runtimeAssetRoot: '/home/u/.config/ai-primitives-hub/runtime',
  placement: {
    scope: 'user' as const,
    targetType: 'vscode' as const,
    resolvedLayout: {
      baseDir: '${HOME}/.copilot',
      kindRoutes: { 'prompts/': 'prompts/', 'instructions/': 'instructions/', 'agents/': 'agents/' },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    },
    baseRoot: '/home/u/.copilot',
    env: { HOME: '/home/u' }
  }
});

describe('planDeploy', () => {
  it('plans destinations without writing through any port', async () => {
    const plan = await planDeploy(request(), readOnlyPorts(new Map()) as never);

    expect(plan.destinations).toEqual([
      { kind: 'prompt', from: 'prompts/hello.prompt.md', to: '/home/u/.copilot/prompts/hello.prompt.md' }
    ]);
    expect(plan.collisions).toEqual([]);
    expect(plan.satisfied).toEqual([]);
  });

  it('reports an untracked pre-existing destination as a collision, not drift', async () => {
    const files = new Map([['/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n']]);

    const plan = await planDeploy(request(), readOnlyPorts(files) as never);

    expect(plan.collisions).toEqual([
      { to: '/home/u/.copilot/prompts/hello.prompt.md', reason: 'untracked-existing' }
    ]);
    expect(plan.drifted).toEqual([]);
  });

  it('reports an untracked but byte-identical destination as satisfied, not a collision', async () => {
    // §9.3: the retry-after-a-failed-state-write case is a no-op.
    const files = new Map([['/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n']]);

    const plan = await planDeploy(request(), readOnlyPorts(files) as never);

    expect(plan.satisfied).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(plan.collisions).toEqual([]);
  });

  it('reports drift when a tracked file no longer matches its installedChecksum', async () => {
    // Drift is a materialization fact, so it is read from the local file
    // only — the planner never needs the desired half to answer this.
    const files = new Map([
      ['/home/u/.copilot/prompts/hello.prompt.md', '# edited by the user\n'],
      [LOCAL_FILE, seedLocal([{ path: 'prompts/hello.prompt.md', installedChecksum: 'notthehash' }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files) as never);

    expect(plan.drifted).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(plan.collisions).toEqual([]);
  });

  it('reports a tracked file that has disappeared as missing', async () => {
    const files = new Map([
      [LOCAL_FILE, seedLocal([{ path: 'prompts/gone.prompt.md', installedChecksum: 'a'.repeat(64) }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files) as never);

    expect(plan.missing).toEqual(['/home/u/.copilot/prompts/gone.prompt.md']);
  });

  it('plans from the local file alone when the desired half is absent', async () => {
    // §8.4's legal intermediate state: local written, desired not yet.
    const files = new Map([
      ['/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n'],
      [LOCAL_FILE, seedLocal([{ path: 'prompts/hello.prompt.md', installedChecksum: 'notthehash' }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files) as never);

    expect(plan.drifted).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
  });

  it('carries an empty MCP section — MCP joins shared deploy in slice 7', async () => {
    const plan = await planDeploy(request(), readOnlyPorts(new Map()) as never);

    expect(plan.mcp).toEqual({ servers: [], skipped: [] });
  });

  it('refuses a request carrying neither bytes nor files', async () => {
    const bad = { ...request(), files: undefined };

    await expect(planDeploy(bad as never, readOnlyPorts(new Map()) as never))
      .rejects.toThrow(/exactly one of/);
  });

  it('compares expectedArchiveSha before planning any effect', async () => {
    const bad = { ...request(), expectedArchiveSha: 'sha256:wrong' };

    await expect(planDeploy(bad as never, readOnlyPorts(new Map()) as never))
      .rejects.toThrow(/archive/i);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm -C packages/app test -- deploy/plan`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `deploy/types.ts` and `deploy/plan.ts`**

`types.ts` is §3.1's interfaces verbatim, with slice-1 scope noted in the doc comment of each field that is typed but unreachable (`conflict.kind === 'shared-destination'`, `commitMode`, `mcp`). `DeployPorts` is `{ fs, env, appStorage, layoutLoader, lockfileStore, mcpConfigStore, gitExclude, onEvent? }` — declare all eight so slices 3–7 add behavior rather than signature, and mark `mcpConfigStore`/`gitExclude` optional for now with a comment naming the slice that makes them required.

`plan.ts`'s `planDeploy`:
1. Validate `exactly one of bytes/files`; throw a `RegistryError`-shaped error with code `DEPLOY.INVALID_REQUEST`.
2. If `expectedArchiveSha` is present and `bytes` is present, compare SHA-256 **before anything else** (§5.2: "compare it before any deployment effect"); mismatch throws `DEPLOY.ARCHIVE_MISMATCH`.
3. Extract (`files` given) or decode `bytes` via the injected extractor; validate the manifest with `validateManifest`; narrow with `getInstallableBundleFiles`.
4. `normalizeManifestItems` → `resolveDestinations` using `{ baseRoot: expandPath(resolvedLayout.baseDir, placement.env), kindRoutes: resolvedLayout.kindRoutes, allowedKinds: placement.allowedKinds }`.
5. Read the pair through `readLockfileV3Pair` (either half absent → that half is empty) and index the current bundle's recorded files by absolute path, joining each `files[].path` to its target record's `baseDir`. Only the **local** half answers drift, missing and tracked-ness; the planner must not require the desired half to exist, because §8.4 makes "local written, desired not yet" a legal state.
6. For each destination: tracked + on-disk hash ≠ `installedChecksum` → `drifted`; untracked + exists + bytes identical → `satisfied`; untracked + exists + different → `collisions`. For each tracked path not in the destination set and absent on disk → `missing`.
7. Return the plan. Never call a mutating port — not `mkdir`, not `appStorage.getPaths()`.

Hashing uses `node:crypto`'s `createHash('sha256')`, matching `checksumFiles` (`json-lockfile-store.ts:366`), so the two agree byte-for-byte.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm -C packages/app test -- deploy/plan`
Expected: PASS (8 tests).

- [ ] **Step 9: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/core test && pnpm -C packages/app test
git add packages/core/src/domain/install/placement.ts \
        packages/core/test/domain/install/placement.test.ts \
        packages/core/src/domain/index.ts \
        packages/app/src/deploy/ \
        packages/app/test/deploy/plan.test.ts \
        packages/app/src/index.ts
git commit -m "feat(app): add manifest-driven placement and planDeploy

Normalizes both manifest formats into one placement contract, resolves
destinations purely over an explicit context, and adds the read-only
planner: drift, missing, untracked collisions and already-satisfied
destinations, with no writes through any port (design 3.1, 4.1, 4.6)."
```

### Task 10: `deployBundle` — place, then record

§3's pipeline: `extract → validate → place → record → MCP → git-exclude`. The **record → MCP** order is load-bearing (§3, §6.7, §9.2); MCP and git-exclude are no-ops in slice 1, but the call order is established now so slice 7 inserts rather than reorders.

No rollback of overwritten bytes (§9.2): a failure mid-write removes files this deploy created and reports what was applied. Re-running the same command converges because the planner reports byte-identical untracked files as `satisfied` (§9.3).

**Files:**
- Create: `packages/app/src/deploy/deploy.ts`
- Create: `packages/app/test/deploy/deploy.test.ts`
- Modify: `packages/app/src/deploy/index.ts`

**Interfaces:**
- Consumes: `planDeploy` (Task 9), `upsertDesiredBundle`/`upsertMaterialization`/`writeLockfileV3Pair` (Task 7), `migrateLockfileIfNeeded` (Task 8), `logicalBundleKey` (Task 4).
- Produces:
  - `interface DeployResult { key: string; written: string[]; skipped: PlacementRejection[]; collisions: { to: string; reason: 'untracked-existing' }[]; satisfied: string[]; lockfiles: LockfileV3Paths; migration: MigrationReport | null }`
  - `deployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult>`
  - `redeployBundle(req: DeployRequest, ports: DeployPorts): Promise<DeployResult>` — `deployBundle` with `force` semantics applied to drift

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/deploy/deploy.test.ts`. First extract the shared harness into `packages/app/test/deploy/fixtures.ts`: the `request()` builder, `LOCAL_FILE`/`seedLocal` from `plan.test.ts`, a `recordingPorts()` whose `fs` writes into a `Map` and appends to a `calls` array on `writeFileBytes` / `writeFile` / `rename` / `remove`, and:

```ts
/** Read both halves of the pair a test's ports wrote. */
export const readPair = (ports: RecordingPorts): { desired: DesiredLockfileV3; local: LocalLockfileV3 } => ({
  desired: JSON.parse(ports.files.get(ports.lockfileStore.desiredFile) ?? 'null'),
  local: JSON.parse(ports.files.get(ports.lockfileStore.localFile) ?? 'null')
});
```

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  readPair,
  recordingPorts,
  request,
} from './fixtures';

describe('deployBundle', () => {
  it('writes real files at the manifest-driven destinations', async () => {
    const ports = recordingPorts();

    const result = await deployBundle(request(), ports);

    expect(result.written).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('keys the records by logical bundle key', async () => {
    const ports = recordingPorts();

    const result = await deployBundle(request(), ports);

    expect(result.key).toBe('github-abc123/web-dev');
    const { desired, local } = readPair(ports);
    expect(Object.keys(desired.bundles)).toEqual(['github-abc123/web-dev']);
    expect(Object.keys(local.targets['my-vscode'].bundles)).toEqual(['github-abc123/web-dev']);
  });

  it('records on-disk paths relative to the resolved baseDir, not bundle-relative ones', async () => {
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/web-dev'];
    expect(record.files.map((f: { path: string }) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('records both checksums, with installedChecksum over the written bytes', async () => {
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    const file = local.targets['my-vscode'].bundles['github-abc123/web-dev'].files[0];
    expect(file.installedChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('writes the materialization record before any MCP effect', async () => {
    // §6.7, §9.2: a crash between them must leave a tracked entry with no
    // server, never a live server with no owner. MCP is a no-op in slice 1,
    // so the assertion is on the recorded call order.
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    // The record is complete once *both* halves have landed, so the
    // ordering claim is about the second of the two writes.
    const recordIndex = ports.calls.indexOf(`rename:${ports.lockfileStore.desiredFile}`);
    const localIndex = ports.calls.indexOf(`rename:${ports.lockfileStore.localFile}`);
    const mcpIndex = ports.calls.findIndex((c) => c.startsWith('mcp:'));
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeGreaterThan(localIndex);
    expect(mcpIndex === -1 || recordIndex < mcpIndex).toBe(true);
  });

  it('skips an untracked pre-existing destination and reports it', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n');

    const result = await deployBundle(request(), ports);

    expect(result.written).toEqual([]);
    expect(result.collisions).toEqual([
      { to: '/home/u/.copilot/prompts/hello.prompt.md', reason: 'untracked-existing' }
    ]);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# hand-written\n');
  });

  it('overwrites an untracked pre-existing destination with force', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n');

    const result = await deployBundle({ ...request(), force: true }, ports);

    expect(result.written).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('records state even when every destination was already satisfied', async () => {
    // §9.3: the retry case. The first run wrote bytes and died before the
    // state write; the second run must converge, not refuse.
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n');

    const result = await deployBundle(request(), ports);

    expect(result.satisfied).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(result.collisions).toEqual([]);
    const { desired, local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev'].files).toHaveLength(1);
  });

  it('is idempotent: running the same deploy twice converges', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const afterFirst = ports.files.get('/home/u/.copilot/prompts/hello.prompt.md');

    const second = await deployBundle(request(), ports);

    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe(afterFirst);
    expect(second.written.length + second.satisfied.length).toBe(1);
  });

  it('refuses to clobber a tracked drifted file without force', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# user edit\n');

    await expect(deployBundle(request(), ports)).rejects.toThrow(/DEPLOY\.DRIFT|locally modified/i);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# user edit\n');
  });

  it('removes the files it created when a later write fails, and reports what was applied', async () => {
    const ports = recordingPorts();
    const archive = request();
    ports.failWriteAt = 2; // succeed on the first file, fail on the second

    await expect(deployBundle({
      ...archive,
      files: new Map([
        ...archive.files,
        ['prompts/second.prompt.md', new TextEncoder().encode('# Second\n')]
      ])
    }, ports)).rejects.toThrow();

    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
  });

  it('migrates a v2 lockfile on the first flag-on write and reports it', async () => {
    const ports = recordingPorts();
    // The legacy user file sits at the path the v3 desired file will take.
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        other: {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: 'x', files: [{ path: 'prompts/other.prompt.md', checksum: 'h' }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    }));

    const result = await deployBundle(request(), ports);

    expect(result.migration?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/other']);
    const { desired, local } = readPair(ports);
    expect(desired.version).toBe('3.0.0');
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
    expect(local.targets.unmanaged.bundles['github-abc123/other'].state).toBe('unmanaged');
  });

  it('writes no generated metadata into the desired half', async () => {
    // Byte-comparability at every scope (§5.2, §8.1), now including user scope.
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    expect('generatedAt' in desired).toBe(false);
    expect('generatedBy' in desired).toBe(false);
    expect(local.generatedAt).toBeDefined();
  });

  it('produces an identical desired half for two deploys an hour apart', async () => {
    const first = recordingPorts();
    const second = recordingPorts({ now: '2026-10-09T13:00:00.000Z' });

    await deployBundle(request(), first);
    await deployBundle(request(), second);

    expect(second.files.get(second.lockfileStore.desiredFile))
      .toBe(first.files.get(first.lockfileStore.desiredFile));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/app test -- deploy/deploy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deployBundle`**

Sequence, in exactly this order:

1. `planDeploy(req, ports)` — reuse it rather than re-deriving; the plan is what the extension's dialog and the CLI's `--dry-run` already saw.
2. `plan.drifted.length > 0 && req.force !== true` → throw `DEPLOY.DRIFT` naming the drifted paths. (§5.11: the CLI refuses unless `--force`; the extension's dialog is slice 5.)
3. `migrateLockfileIfNeeded(ports.lockfileStore, ports.fs, { generatedBy, now, triggeredByKey: key })` — before the first write, so the files are never a v2/v3 hybrid. `ports.lockfileStore` already **is** the `MigrationSources` shape (`desiredFile`, `localFile`, `legacyFiles`), which is why `deploy` needs no scope check: at user scope `legacyFiles` is empty, at repository scope it names the two `prompt-registry.*` files, and this call site does not change. Keep the returned pair in memory; do not re-read.
4. **Place.** For each destination not in `satisfied`, and not in `collisions` unless `force`: `mkdir` the parent, write bytes (`writeFileBytes` for a binary payload, `writeFile` for strict UTF-8 text through the transformer), then verify by read-back exactly as `FileTreeTargetWriter.writeContent` does (`file-tree-writer.ts:327`). Track written paths. On failure, remove only the paths this call created, then rethrow — **no attempt to restore overwritten bytes** (§9.2).
5. **Record.** `upsertDesiredBundle` on the desired half, `upsertMaterialization` on the local half, then **one** `writeLockfileV3Pair` — which writes local before desired (§8.4). The desired entry carries `archiveSha` only when the bytes came from an immutable remote artifact — i.e. when `req.bytes` was supplied *and* `req.source.type` is not a local family; omit it otherwise (§5.2's `archiver` non-determinism). Nothing in this step mentions scope: the `TargetBinding` passed to `upsertMaterialization` carries `scope` and `baseDir` as data, and `commitMode` is spread in only when the request supplies one.
6. **MCP.** No-op in slice 1. Leave a single comment naming slice 7 and the ordering contract; do not add a stub call that a later reorder could hide behind.
7. **git-exclude.** No-op at user scope. Same treatment.

`redeployBundle(req, ports)` = `deployBundle({ ...req, force: true }, ports)`. Keep it a named export rather than asking callers to pass `force`, so §3.1's surface matches.

The one subtlety: `satisfied` destinations still get a materialization record (the §9.3 retry case is exactly "bytes landed, state did not"), so build the record from `destinations`, not from `written`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/app test -- deploy/deploy`
Expected: PASS (12 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/app test
git add packages/app/src/deploy/deploy.ts \
        packages/app/test/deploy/deploy.test.ts \
        packages/app/test/deploy/fixtures.ts \
        packages/app/test/deploy/plan.test.ts \
        packages/app/src/deploy/index.ts
git commit -m "feat(app): add deployBundle

Places real files at manifest-driven destinations, then records desired
state and materialization in one 3.0.0 write, migrating a v2 user
lockfile first. Records before any MCP effect (design 6.7, 9.2), skips
untracked pre-existing destinations unless forced, refuses tracked
drift unless forced, and converges on re-run (design 9.3)."
```

### Task 11: `undeployBundle`

Removal iterates `targets[].bundles[].files[].path` joined to the record's root; **nothing is recomputed** (§5.7). That is the whole point of recording on-disk paths: manifest-driven renaming makes recomputation impossible.

**Files:**
- Create: `packages/app/src/deploy/undeploy.ts`
- Create: `packages/app/test/deploy/undeploy.test.ts`
- Modify: `packages/app/src/deploy/index.ts`

**Interfaces:**
- Consumes: `readLockfileV3Pair`, `removeDesiredBundle`, `removeMaterialization`, `writeLockfileV3Pair`, `migrateLockfileIfNeeded`.
- Produces: `interface UndeployResult { key: string; removed: string[]; skipped: string[]; lockfile: string; migration: MigrationReport | null }`, `undeployBundle(req: UndeployRequest & { key: string }, ports: DeployPorts): Promise<UndeployResult>`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/deploy/undeploy.test.ts`:

```ts
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  recordingPorts,
  request,
} from './fixtures';

const undeployRequest = () => ({
  key: 'github-abc123/web-dev',
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  scope: 'user' as const,
  targetName: 'my-vscode'
});

describe('undeployBundle', () => {
  it('removes exactly the recorded paths and nothing else', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/unrelated.prompt.md', '# mine\n');
    await deployBundle(request(), ports);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.get('/home/u/.copilot/prompts/unrelated.prompt.md')).toBe('# mine\n');
  });

  it('drops both the desired entry and the materialization', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);

    await undeployBundle(undeployRequest(), ports);

    const { desired, local } = readPair(ports);
    expect(desired.bundles['github-abc123/web-dev']).toBeUndefined();
    expect(local.targets['my-vscode']).toBeUndefined();
  });

  it('does not recompute destinations from the manifest', async () => {
    // The record is the only source of truth for removal (§5.7). An
    // undeploy with no bundle bytes in hand must still remove the files.
    const ports = recordingPorts();
    await deployBundle(request(), ports);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toHaveLength(1);
    expect(ports.calls.some((c) => c.startsWith('extract:'))).toBe(false);
  });

  it('reports a recorded path that is already gone as skipped, not an error', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    ports.files.delete('/home/u/.copilot/prompts/hello.prompt.md');

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
  });

  it('is a no-op for a bundle that is not recorded', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);

    const result = await undeployBundle({ ...undeployRequest(), key: 'github-abc123/absent' }, ports);

    expect(result.removed).toEqual([]);
    const { desired, local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('leaves another target holding the same bundle untouched', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { desired, local } = readPair(ports);
    expect(local.targets['other-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('keeps the desired entry while another target still materializes the bundle', async () => {
    // Desired state is per repository/machine, not per target; dropping it
    // while a second target still holds files would orphan that record.
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { desired, local } = readPair(ports);
    expect(desired.bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('migrates a v2 lockfile before an uninstall, since uninstall is a migration trigger', async () => {
    // FR-16 permits migration on install, update *and* uninstall; a flag-on
    // uninstall must be able to find records a v2 install left behind.
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        'web-dev': {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: 'x', files: [{ path: 'prompts/hello.prompt.md', checksum: 'h' }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    }));

    const result = await undeployBundle(undeployRequest(), ports);

    const { desired, local } = readPair(ports);
    expect(desired.version).toBe('3.0.0');
    // The record went unmanaged (bundle-relative path, unprovable), so the
    // files are left alone and reported rather than guessed at.
    expect(result.removed).toEqual([]);
    expect(result.migration?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/web-dev']);
  });

  it('does not remove files for an unmanaged record', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# pre-existing\n');
    ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        unmanaged: {
          targetType: 'vscode', scope: 'user', baseDir: '/home/u/.copilot',
          bundles: {
            'github-abc123/web-dev': {
              version: '1.0.0', sourceId: 'github-abc123', installedAt: 'x',
              state: 'unmanaged', unmanagedReason: 'destination could not be proven',
              files: [{ path: 'prompts/hello.prompt.md' }]
            }
          }
        }
      }
    }));

    const result = await undeployBundle({ ...undeployRequest(), targetName: 'unmanaged' }, ports);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# pre-existing\n');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/app test -- deploy/undeploy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `undeployBundle`**

Sequence:

1. `migrateLockfileIfNeeded` with **no** `triggeredByKey` — an uninstall has no bundle being deployed, so nothing gets fresh paths.
2. Look up `local.targets[targetName]?.bundles[key]`; absent → return an empty result without writing.
3. `record.state === 'unmanaged'` → remove nothing, report every recorded path as `skipped`, and still drop the record (§8.3 retains the record for *cleanup and refcounting*; the user asked to uninstall, so the record goes while the files stay). Surface the `unmanagedReason` in the result so the CLI can print it.
4. Otherwise, for each `files[].path`: join to the **target record's** `baseDir` and `remove`; absent → `skipped`. That join is scope-free by construction — §5.7's "relative to the record's root" is satisfied because the record stores its own root, so the repository caller sets `baseDir` to the workspace root and nothing here branches.
5. `removeMaterialization`; then `removeDesiredBundle` **only if no other target still materializes the key**.
6. One `writeLockfileV3Pair`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/app test -- deploy/undeploy`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/app test
git add packages/app/src/deploy/undeploy.ts \
        packages/app/test/deploy/undeploy.test.ts \
        packages/app/src/deploy/index.ts
git commit -m "feat(app): add undeployBundle

Removes exactly the recorded on-disk paths without recomputing them
(design 5.7), migrates first because uninstall is a permitted migration
trigger, leaves an unmanaged record's files alone, and keeps desired
state while another target still materializes the bundle."
```

### Task 12: CLI wiring — `install` at user scope

One place builds `DeployPorts` and `PlacementContext`, so `install` and `uninstall` cannot drift the way `createWriterFactory` is duplicated across `install.ts:559` and `uninstall.ts:228` today.

Flag-on scope: `--from` (local) and remote, user scope, any target type whose layout resolves — the slice's *supported* cell is `vscode`, and the E2E test in Task 15 asserts that cell. Repository scope with the flag on **refuses** with a message naming slice 3, rather than silently falling through to the legacy writer: a half-migrated repository is the one state §8.4 cannot converge from.

**Files:**
- Create: `packages/cli/src/deploy-wiring.ts`
- Create: `packages/cli/test/deploy-wiring.test.ts`
- Modify: `packages/cli/src/commands/install.ts` (`performLocalInstall` `:853`, `performRemoteInstall` `:1029`)
- Modify: `packages/cli/src/framework/index.ts` (export the wiring)

**Interfaces:**
- Consumes: `isUnifiedDeployEnabled` (Task 6), `deployBundle`/`planDeploy` (Tasks 9–10), `resolveLayoutAsync`, `FileSystemLayoutConfigLoader`, `TransformerRegistry`, `resolveUserConfigPaths`, `XdgAppStorage`.
- Produces:
  - `buildDeployPorts(ctx: Context): DeployPorts`
  - `buildPlacementContext(ctx: Context, target: Target): Promise<PlacementContext>`
  - `assertUnifiedDeploySupported(target: Target): void` — throws `RegistryError` for repository scope
  - `unifiedDeployRequested(ctx: Context): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/deploy-wiring.test.ts`:

```ts
import * as path from 'node:path';
import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  assertUnifiedDeploySupported,
  buildDeployPorts,
  buildPlacementContext,
  unifiedDeployRequested,
} from '../src/deploy-wiring';
import {
  createTestContext,
} from '../src/framework';

const ctxWith = (env: Record<string, string>) => ({
  ...createTestContext({ cwd: '/work', env }),
  fs: new NodeFileSystem()
});

const userTarget = {
  name: 'my-vscode',
  type: 'vscode' as const,
  scope: 'user' as const
};

describe('unifiedDeployRequested', () => {
  it('is false by default', () => {
    expect(unifiedDeployRequested(ctxWith({}))).toBe(false);
  });

  it('is true when the env flag is set', () => {
    expect(unifiedDeployRequested(ctxWith({ AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' }))).toBe(true);
  });
});

describe('buildPlacementContext', () => {
  it('resolves the vscode user layout and expands the base root', async () => {
    const ctx = ctxWith({ HOME: '/home/u', XDG_CONFIG_HOME: '/home/u/.config' });

    const placement = await buildPlacementContext(ctx, userTarget);

    expect(placement.scope).toBe('user');
    expect(placement.targetType).toBe('vscode');
    expect(placement.baseRoot).toBe(path.join('/home/u', '.copilot'));
    expect(placement.resolvedLayout.kindRoutes['prompts/']).toBe('prompts/');
  });

  it('carries allowedKinds through untouched', async () => {
    const ctx = ctxWith({ HOME: '/home/u' });

    const placement = await buildPlacementContext(ctx, { ...userTarget, allowedKinds: ['prompt'] });

    expect(placement.allowedKinds).toEqual(['prompt']);
  });
});

describe('buildDeployPorts', () => {
  it('points the lockfile store at the XDG user pair', () => {
    const ctx = ctxWith({ HOME: '/home/u', XDG_CONFIG_HOME: '/home/u/.config' });
    const root = path.join('/home/u/.config', 'ai-primitives-hub');

    const ports = buildDeployPorts(ctx, { scope: 'user' });

    expect(ports.lockfileStore.desiredFile).toBe(path.join(root, 'ai-primitives-hub.lock.json'));
    expect(ports.lockfileStore.localFile).toBe(path.join(root, 'ai-primitives-hub.local.lock.json'));
  });

  it('has no legacy files to delete at user scope', () => {
    // The legacy user file keeps its name and becomes the desired file,
    // so it is rewritten in place rather than deleted (Task 8's table).
    const ctx = ctxWith({ HOME: '/home/u', XDG_CONFIG_HOME: '/home/u/.config' });

    expect(buildDeployPorts(ctx, { scope: 'user' }).lockfileStore.legacyFiles).toEqual([]);
  });
});

describe('assertUnifiedDeploySupported', () => {
  it('accepts a user-scope target', () => {
    expect(() => assertUnifiedDeploySupported(userTarget)).not.toThrow();
  });

  it('refuses repository scope with a message naming the next slice', () => {
    expect(() => assertUnifiedDeploySupported({ ...userTarget, scope: 'repository', rootPath: '/work' }))
      .toThrow(/repository scope .*not yet supported|unifiedDeploy/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/cli test -- deploy-wiring`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wiring**

Create `packages/cli/src/deploy-wiring.ts`:

```ts
/**
 * CLI → `app/deploy` wiring.
 *
 * One place builds `DeployPorts` and `PlacementContext`, because the
 * legacy `createWriterFactory` is duplicated in `install.ts` and
 * `uninstall.ts` and the two have to agree about layout resolution or
 * `remove()` computes a different path than `write()` did. Keeping the
 * flag-on construction single-sourced removes that failure mode by
 * construction rather than by comment.
 *
 * `PlacementContext` carries the *resolved* layout and the environment
 * used for `${...}` expansion (design 4.6): planning and writing share
 * one instance, so verification reproduces the original placement input
 * instead of re-reading mutable configuration.
 * @module deploy-wiring
 */
```

- `buildPlacementContext` uses the same `FileSystemLayoutConfigLoader` construction as `createWriterFactory` (`install.ts:565`) so hierarchical user and project overrides apply identically, then `resolveLayoutAsync(target, loader)`, then `expandPath(layout.baseDir, ctx.env)` for `baseRoot`. It records `transformer: TransformerRegistry.withBuiltIns().getTransformer(target.type)`'s id (not the instance) so the context stays serializable; pass the instance itself through `DeployPorts` instead.
- `buildDeployPorts(ctx, { scope })` wires `fs: ctx.fs`, `env: ctx.env`, `appStorage: new XdgAppStorage(ctx.env)` (check the exact constructor in `packages/infra/src/storage/` and match it), `layoutLoader`, and the store:

  ```ts
    lockfileStore: {
      desiredFile: userPaths.userLockfile,
      localFile: userPaths.userLocalLockfile,
      // The legacy user file keeps its name and becomes desiredFile, so it
      // is rewritten in place. Slice 3 passes the two prompt-registry.*
      // paths here for repository scope; the store and the migration do not
      // change, only this list does.
      legacyFiles: []
    }
  ```

  `scope` is a parameter today only so slice 3 has one obvious place to add its branch — **and that branch belongs here, in the wiring, not in the store**. `mcpConfigStore` and `gitExclude` stay undefined with a comment naming slices 7 and 3.
- `assertUnifiedDeploySupported` throws `new RegistryError({ code: 'DEPLOY.UNSUPPORTED_SCOPE', message: ..., hint: 'Unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to use the current repository-scope path.' })`.

- [ ] **Step 4: Route the two install branches**

In `performLocalInstall` (`install.ts:853`), after `resolveEffectiveTarget` and the existing `dryRun` block, insert the flag-on branch. Keep the legacy block below it completely untouched:

```ts
    if (unifiedDeployRequested(ctx)) {
      assertUnifiedDeploySupported(effectiveTarget);
      return await runUnifiedInstall({
        ctx,
        fmt,
        target: effectiveTarget,
        dryRun: opts.dryRun === true,
        force: opts.force === true,
        request: {
          files,
          bundle: { bundleId: manifest.id, version: manifest.version },
          source: {
            sourceId: `local-${path.basename(opts.from as string)}`,
            type: 'local',
            url: path.resolve(ctx.cwd(), opts.from as string)
          },
          targetName: effectiveTarget.name,
          runtimeAssetRoot: path.join(resolveUserConfigPaths(ctx.env).root, 'runtime'),
          placement: await buildPlacementContext(ctx, effectiveTarget)
        }
      });
    }
```

In `performRemoteInstall` (`install.ts:1029`), the same shape with `bytes: dl.bytes`, `expectedArchiveSha: undefined` (nothing to compare against on a first install), `source: { sourceId: installable.ref.sourceId, type: opts.sourceConfig?.type ?? 'github', url: `https://github.com/${repoSlug}` , branch, collectionsPath }`.

`runUnifiedInstall` is a small local helper in `install.ts` that calls `planDeploy` when `dryRun`, `deployBundle` otherwise, and renders through the existing `formatOutput` envelope — the JSON `data` keys must stay the ones the legacy branch emits (`target`, `bundle`, `written`, `skipped`, `lockfile`) so no consumer breaks, plus the new `collisions`, `satisfied` and `migration` keys.

`--force` does not exist on `install` today. Add `public force = Option.Boolean('--force');` to `InstallCommand`, thread it into `InstallOptions.force`, document it in the command's `usage.details` block, and leave it inert on the legacy path (§4.10's `--force` is a flag-on behavior).

- [ ] **Step 5: Run the CLI suite**

```bash
pnpm -C packages/cli test
```

Expected: PASS, including every existing `install.test.ts` case — they run with the flag unset, which is the regression check §10 requires ("the existing behavior with `unifiedDeploy` off, proving no regression on the legacy path").

- [ ] **Step 6: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/cli test
git add packages/cli/src/deploy-wiring.ts \
        packages/cli/test/deploy-wiring.test.ts \
        packages/cli/src/commands/install.ts \
        packages/cli/src/framework/index.ts
git commit -m "feat(cli): route flag-on user-scope install through app/deploy

Adds single-sourced DeployPorts/PlacementContext construction and wires
the local and remote install branches to it behind
AI_PRIMITIVES_HUB_UNIFIED_DEPLOY. Repository scope refuses rather than
falling back, since a half-migrated repository cannot converge.

Adds --force (inert on the legacy path)."
```

### Task 13: v3-aware `install --lockfile` replay

Scope Note 3's addition. `detectInstallContext` auto-selects this branch when no bundle is named, and it would otherwise hit the version gate once slice 1 has written v3.

Two defects §10 names explicitly are fixed here rather than worked around: `performLockfileInstall` (`install.ts:952`) is reached **without any `dryRun` check** while the local and remote branches do check it (`:866`, `:1097`).

**Files:**
- Modify: `packages/cli/src/commands/install.ts` (`performLockfileInstall` `:952`)
- Modify: `packages/cli/test/commands/install.test.ts`

**Interfaces:**
- Consumes: `readLockfileV3Pair`, `deployBundle`, `planDeploy`, `fetchFilesForSource` (`install.ts:1517`, unchanged).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/commands/install.test.ts`:

```ts
describe('install --lockfile with unifiedDeploy', () => {
  it('replays desired state from a 3.0.0 lockfile', async () => {
    // Written by a prior flag-on install; the replay must read it, not
    // fail the version gate.
    // (Full wiring — target config, local source dir, env flag — mirrors
    // the existing local-install cases above.)
    const result = await runFlagOn(['install', '--lockfile', desiredLockfile, '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(parseJson<{ replayed: string[] }>(result.stdout).data.replayed).toEqual(['local-bundle/web-dev']);
  });

  it('honors --dry-run on the lockfile branch and writes nothing', async () => {
    // install.ts:952 reached without a dryRun check today (design §10).
    const before = await readFile(desiredLockfile, 'utf8');

    const result = await runFlagOn([
      'install', '--lockfile', desiredLockfile, '--target', 'my-vscode', '--dry-run'
    ]);

    expect(result.code).toBe(0);
    expect(await readFile(desiredLockfile, 'utf8')).toBe(before);
  });

  it('fails closed when a pinned version is absent from the source', async () => {
    // §3.2: an explicit pin must never silently install latest.
    const result = await runFlagOn([
      'install', '--lockfile', pinnedToMissingVersionPath, '--target', 'my-vscode'
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/9\.9\.9/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/cli test -- install`
Expected: FAIL — the replay throws on the version gate; `--dry-run` rewrites the file.

- [ ] **Step 3: Implement**

In `performLockfileInstall`, before anything else:

```ts
  if (opts.dryRun === true) {
    // Parity with the local (:866) and remote (:1097) branches, which
    // have always checked this. Reported by the design's §10 audit.
    return await reportLockfileReplayPlan(opts, effectiveTarget, ctx, fmt);
  }
```

Then branch on `unifiedDeployRequested(ctx)`: read through `readLockfileV3Pair`, iterate `Object.entries(pair.desired.bundles)`, resolve each `sourceId` through `pair.desired.sources`, fetch bytes with the existing `fetchFilesForSource`, and call `deployBundle` once per entry. An entry whose exact version is absent from the source **fails** that entry (§3.2 "explicit pins must fail closed") and is reported in `failures`; it must never fall back to latest. Leave the v2 path below untouched for the flag-off case.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/cli test -- install`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/cli test
git add packages/cli/src/commands/install.ts packages/cli/test/commands/install.test.ts
git commit -m "feat(cli): replay 3.0.0 desired state, and honor --dry-run on that branch

Keeps a flag-on bare \`install\` working once the XDG lockfile is 3.0.0,
which §2's bridge rule requires. Also fixes the lockfile branch
reaching writes without a --dry-run check, which the design's §10 audit
flagged, and makes an absent pinned version fail instead of installing
latest (design 3.2)."
```

### Task 14: CLI wiring — user-scope `uninstall`

**Files:**
- Modify: `packages/cli/src/commands/uninstall.ts` (`performBundleUninstall` `:409`, `performAllUninstall` `:605`)
- Modify: `packages/cli/test/commands/uninstall.test.ts`

**Interfaces:**
- Consumes: `undeployBundle`, `buildDeployPorts`, `unifiedDeployRequested`, `assertUnifiedDeploySupported`, `logicalKeyFromLegacyId`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/commands/uninstall.test.ts`:

```ts
describe('uninstall with unifiedDeploy', () => {
  it('removes exactly the files the flag-on install wrote', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    const before = await listTree(path.join(home, '.copilot'));

    const result = await runFlagOn(['uninstall', 'web-dev', '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(await listTree(path.join(home, '.copilot'))).toEqual([]);
    expect(before.length).toBeGreaterThan(0);
  });

  it('accepts a bare bundle id and resolves it to the logical key', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    const result = await runFlagOn(['uninstall', 'web-dev', '--target', 'my-vscode', '-o', 'json']);

    expect(parseJson<{ bundle: string }>(result.stdout).data.bundle).toBe('web-dev');
  });

  it('leaves a hand-written neighbour file alone', async () => {
    const mine = path.join(home, '.copilot', 'prompts', 'mine.prompt.md');
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    await mkdir(path.dirname(mine), { recursive: true });
    await writeFile(mine, '# mine\n', 'utf8');

    await runFlagOn(['uninstall', 'web-dev', '--target', 'my-vscode']);

    expect(await readFile(mine, 'utf8')).toBe('# mine\n');
  });

  it('warns rather than failing for a bundle that was never installed', async () => {
    const result = await runFlagOn(['uninstall', 'absent', '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/not installed|Nothing to uninstall/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/cli test -- uninstall`
Expected: FAIL — the flag-on uninstall reads the v3 file through `readLockfile` and hits the generation mismatch, or removes nothing.

- [ ] **Step 3: Implement**

In `performBundleUninstall`, after `resolveEffectiveTarget` and before `findBundleEntry`:

```ts
  if (unifiedDeployRequested(ctx)) {
    assertUnifiedDeploySupported(target);
    return await runUnifiedUninstall(opts, target, ctx, fmt);
  }
```

`runUnifiedUninstall` resolves the user's bare bundle id to a logical key: read the v3 lock, find the single `targets[target.name].bundles` key whose `manifestId` half matches `opts.bundle` after legacy-alias stripping (`logicalKeyFromLegacyId` with each candidate `sourceId`). More than one match → refuse, naming both keys and telling the user to pass the full `sourceId/manifestId`; zero matches → the existing "not installed" warning path, unchanged. Then call `undeployBundle` and render through `formatOutput`, keeping the existing `data` keys (`target`, `bundle`, `removed`, `lockfile`) and adding `skipped` and `unmanagedReason` when present.

Apply the same branch in `performAllUninstall`, iterating every key under the target.

`performLockfileUninstall` stays on the legacy path: it operates on an explicitly named file, which under the flag may be a repository lockfile, and repository scope is slice 3.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/cli test -- uninstall`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages/cli test
git add packages/cli/src/commands/uninstall.ts packages/cli/test/commands/uninstall.test.ts
git commit -m "feat(cli): route flag-on user-scope uninstall through app/deploy

Resolves a bare bundle id to the logical key, removes exactly the
recorded paths, and refuses ambiguously rather than guessing when two
sources offer the same manifest id."
```

### Task 15: The slice's E2E test and the golden matrix's first column

§11's hand-verification recipe, automated. Driven through the **registered command classes** with `runCommand`, a real `NodeFileSystem` and a real temp directory — §10 is explicit that asserting "both wirings call `deploy`" proves neither registered reachability nor reader compatibility, and that a test faking every IO stage proves nothing end to end.

It also lands the richer fixture §10 calls a prerequisite: the existing one covers prompts and instructions only.

**Files:**
- Create: `packages/cli/test/fixtures/slice1-bundle.ts`
- Create: `packages/cli/test/commands/unified-deploy-user-scope.test.ts`
- Create: `packages/cli/test/commands/golden-placement-matrix.test.ts`

**Interfaces:**
- Consumes: `InstallCommand`, `UninstallCommand`, `TargetAddCommand`, `StatusCommand`, `UpdateCommand`, `runCommand`, `writeReleaseArchive`.
- Produces: `createSlice1Bundle(): ExtractedFiles` — one prompt, one instruction and one agent whose `id` differs from its filename stem, plus a deliberate path-prefix/manifest-kind mismatch and a `README.md` that must not be installed.

- [ ] **Step 1: Write the fixture**

Create `packages/cli/test/fixtures/slice1-bundle.ts`:

```ts
/**
 * Slice 1's placement fixture.
 *
 * §10 calls the existing fixture insufficient: it covers prompts and
 * instructions only. This one carries the three cases slice 1's
 * placement claims rest on:
 *
 *  - an id that differs from its filename stem (`reviewer` declared for
 *    `agents/code-reviewer.agent.md`), which is the only case where
 *    manifest-driven renaming is observable;
 *  - a path-prefix/manifest-kind mismatch (`prompts/typescript-standards
 *    .instructions.md` typed `instruction`), which prefix routing would
 *    place in `prompts/` and manifest routing places in `instructions/`;
 *  - a `README.md` the layout's skipPaths must keep out of the target.
 */
import {
  dump as dumpYaml,
} from 'js-yaml';
import type {
  ExtractedFiles,
} from '@ai-primitives-hub/core';

const bytes = (content: string): Uint8Array => new TextEncoder().encode(content);

export const createSlice1Bundle = (
  options: { id?: string; version?: string } = {}
): ExtractedFiles => {
  const id = options.id ?? 'web-dev';
  const version = options.version ?? '1.0.0';
  const manifest = {
    id,
    version,
    name: 'Web Dev',
    prompts: [
      { id: 'hello', file: 'prompts/hello.prompt.md', type: 'prompt' },
      { id: 'ts-standards', file: 'prompts/typescript-standards.instructions.md', type: 'instructions' },
      { id: 'reviewer', file: 'agents/code-reviewer.agent.md', type: 'agent' }
    ]
  };

  return new Map([
    ['deployment-manifest.yml', bytes(dumpYaml(manifest))],
    ['prompts/hello.prompt.md', bytes('# Hello\n')],
    ['prompts/typescript-standards.instructions.md', bytes('# TS Standards\n')],
    ['agents/code-reviewer.agent.md', bytes('# Reviewer\n')],
    ['README.md', bytes('# Not installed\n')]
  ]);
};
```

- [ ] **Step 2: Write the failing E2E test**

Create `packages/cli/test/commands/unified-deploy-user-scope.test.ts`. Mirror `install.test.ts`'s harness (real `NodeFileSystem`, `mkdtemp`, `HOME`/`XDG_CONFIG_HOME` pointed inside the temp dir) and add a `runFlagOn` / `runFlagOff` pair differing only in `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`, plus:

```ts
const xdgRoot = path.join(workspace, 'xdg-config', 'ai-primitives-hub');
const desiredLockfile = path.join(xdgRoot, 'ai-primitives-hub.lock.json');
const localLockfile = path.join(xdgRoot, 'ai-primitives-hub.local.lock.json');
const copilotDir = path.join(home, '.copilot');

const readUserPair = async () => ({
  desired: JSON.parse(await readFile(desiredLockfile, 'utf8')),
  local: JSON.parse(await readFile(localLockfile, 'utf8'))
});

/** Recursive, sorted, baseDir-relative POSIX paths. Equality, not containment. */
const listTree = async (root: string): Promise<string[]> => { /* readdir recursive */ };
```

```ts
describe('unified deploy, CLI user scope, vscode', () => {
  it('installs real files named from the normalized id, by manifest kind', async () => {
    const result = await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(await listTree(copilotDir)).toEqual([
      'agents/reviewer.agent.md',
      'instructions/ts-standards.instructions.md',
      'prompts/hello.prompt.md'
    ]);
  });

  it('writes regular files, not links', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    const stat = await lstat(path.join(copilotDir, 'prompts', 'hello.prompt.md'));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isFile()).toBe(true);
  });

  it('keeps README.md out of the target', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    expect(await listTree(copilotDir)).not.toContain('README.md');
  });

  it('records one desired entry and one materialization record', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    const { desired, local } = await readUserPair();
    expect(desired.version).toBe('3.0.0');
    expect(local.version).toBe('3.0.0');
    expect(Object.keys(desired.bundles)).toHaveLength(1);
    // The desired half is shareable: no local identifiers, no timestamps.
    expect('generatedAt' in desired).toBe(false);
    expect('targets' in desired).toBe(false);
    const record = local.targets['my-vscode'].bundles[Object.keys(desired.bundles)[0]];
    expect(record.files.map((f: { path: string }) => f.path).toSorted()).toEqual([
      'agents/reviewer.agent.md',
      'instructions/ts-standards.instructions.md',
      'prompts/hello.prompt.md'
    ]);
    expect(record.files.every((f: { installedChecksum?: string }) => f.installedChecksum !== undefined)).toBe(true);
  });

  it('uninstall removes exactly those paths and nothing else', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    await mkdir(path.join(copilotDir, 'prompts'), { recursive: true });
    await writeFile(path.join(copilotDir, 'prompts', 'mine.prompt.md'), '# mine\n', 'utf8');

    const result = await runFlagOn(['uninstall', 'web-dev', '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(await listTree(copilotDir)).toEqual(['prompts/mine.prompt.md']);
  });

  it('migrates an existing v2 XDG lockfile into the pair on that first write', async () => {
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, JSON.stringify({
      $schema: 'https://example.com/lockfile.schema.json',
      version: '2.0.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      bundles: {
        legacy: {
          version: '0.9.0', sourceId: 'local-old', sourceType: 'local',
          installedAt: '2026-01-01T00:00:00.000Z',
          files: [{ path: 'prompts/old.prompt.md', checksum: 'archivehash' }]
        }
      },
      sources: { 'local-old': { type: 'local', url: '/tmp/old' } }
    }, null, 2) + '\n', 'utf8');

    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    const { desired, local } = await readUserPair();
    expect(desired.version).toBe('3.0.0');
    expect(desired.bundles['local-old/legacy']).toBeDefined();
    expect(local.targets.unmanaged.bundles['local-old/legacy'].state).toBe('unmanaged');
    expect(local.migration).toEqual({ lockfileV3: 'complete' });
  });

  it('is idempotent: the same install twice leaves one record and the same bytes', async () => {
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    const firstDesired = await readFile(desiredLockfile, 'utf8');
    const firstTree = await listTree(copilotDir);

    const second = await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    expect(second.code).toBe(0);
    expect(await listTree(copilotDir)).toEqual(firstTree);
    // Byte-identical, not merely equivalent: the desired half has no churn.
    expect(await readFile(desiredLockfile, 'utf8')).toBe(firstDesired);
  });

  it('skips a hand-written destination and summarizes it; --force overwrites', async () => {
    const collision = path.join(copilotDir, 'prompts', 'hello.prompt.md');
    await mkdir(path.dirname(collision), { recursive: true });
    await writeFile(collision, '# hand-written\n', 'utf8');

    const skipped = await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode', '-o', 'json']);
    expect(await readFile(collision, 'utf8')).toBe('# hand-written\n');
    expect(parseJson<{ collisions: unknown[] }>(skipped.stdout).data.collisions).toHaveLength(1);

    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode', '--force']);
    expect(await readFile(collision, 'utf8')).toBe('# Hello\n');
  });

  it('converges after a state-write failure, with no flag, because the bytes match', async () => {
    // §9.3's idempotent-redeploy contract: injected failure at the state
    // write, then the identical command re-run.
    await runFlagOnWithFailure({ failAt: 'state-write' },
      ['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    expect(await listTree(copilotDir)).not.toEqual([]);

    const retry = await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode', '-o', 'json']);

    expect(retry.code).toBe(0);
    expect(parseJson<{ collisions: unknown[] }>(retry.stdout).data.collisions).toEqual([]);
    expect((await readUserPair()).local.version).toBe('3.0.0');
  });

  it('flag-off commands against 3.0.0 state fail loudly and write nothing', async () => {
    // §5.12 and §10's "Schema version gate" row.
    await runFlagOn(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);
    const before = [
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ];

    for (const argv of [
      ['status'],
      ['update', '--target', 'my-vscode'],
      ['uninstall', 'web-dev', '--target', 'my-vscode']
    ]) {
      const result = await runFlagOff(argv);

      expect(result.code, `${argv[0]} should fail`).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/newer version of AI Primitives Hub/);
    }
    expect([
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ]).toEqual(before);
  });

  it('leaves the legacy path byte-identical with the flag off', async () => {
    const result = await runFlagOff(['install', '--from', bundleDir, 'web-dev', '--target', 'my-vscode']);

    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(desiredLockfile, 'utf8')).version).toBe('2.0.0');
    // The legacy path writes one file and never creates the local half.
    expect(existsSync(localLockfile)).toBe(false);
  });
});
```

`runFlagOnWithFailure` needs a seam. Add one rather than monkey-patching: give `DeployPorts` an optional `onEvent` (already in §3.1's port list) that `deployBundle` calls with `{ stage: 'state-write' }` **before** the state write, and let the test's port throw from it. That is a production-shaped seam — slice 5's progress UI needs the same events — not test-only scaffolding.

- [ ] **Step 3: Run it to verify it fails, then make it pass**

Run: `pnpm -C packages/cli test -- unified-deploy-user-scope`
Expected: FAIL first; then PASS once the wiring from Tasks 12–14 and the `onEvent` seam are complete. Fix production code, not the assertions — each one restates a numbered spec rule.

- [ ] **Step 4: Start the golden placement matrix**

Create `packages/cli/test/commands/golden-placement-matrix.test.ts` with slice 1's single column — `vscode` × user scope — and a table structure that grows one column per slice (slice 2 widens to all 11 targets, slice 3 adds repository scope):

```ts
/**
 * Golden placement matrix — the highest-value test in the plan (§10).
 *
 * Slice 1 fills one cell: vscode × user. Each later slice adds columns
 * rather than rewriting this table, and by slice 6 the same expectations
 * are asserted against the extension's output too, which is when this
 * becomes the CLI-vs-extension parity assertion.
 */
const MATRIX: { targetType: string; scope: 'user'; expected: string[] }[] = [
  {
    targetType: 'vscode',
    scope: 'user',
    expected: [
      'agents/reviewer.agent.md',
      'instructions/ts-standards.instructions.md',
      'prompts/hello.prompt.md'
    ]
  }
];
```

Each row installs `createSlice1Bundle()` through the registered `InstallCommand` into a fresh temp `HOME` and asserts the full recursive file list — equality, not containment, so an extra file fails.

- [ ] **Step 5: Lint and commit**

```bash
pnpm -C packages -r lint:fix
pnpm -C packages -r test
git add packages/cli/test/fixtures/slice1-bundle.ts \
        packages/cli/test/commands/unified-deploy-user-scope.test.ts \
        packages/cli/test/commands/golden-placement-matrix.test.ts \
        packages/app/src/deploy/deploy.ts
git commit -m "test(cli): cover flag-on user-scope install and uninstall end to end

Drives the registered commands against a real temp HOME: manifest-driven
placement with id renaming, real files not links, 3.0.0 records, exact
uninstall, in-place v2 migration, idempotence, untracked collisions and
--force, convergence after an injected state-write failure, and flag-off
commands refusing 3.0.0 state without writing.

Starts the golden placement matrix with its vscode/user column."
```

### Task 16: Documentation and the ADR

§12's obligation, scoped to what slice 1 changes. The repo rule is that behavior, command, setting, schema or workflow changes travel with their documentation.

**Files:**
- Create: `docs/contributor-guide/architecture/adr/0008-unified-bundle-deploy-and-lockfile-v3.md`
- Modify: `docs/contributor-guide/architecture/adr/adr-index.md`
- Modify: `docs/contributor-guide/architecture/installation-flow.md`
- Modify: `docs/reference/commands.md` (the new `install --force`)
- Modify: `docs/user-guide/troubleshooting.md` (the version-gate message a user may hit)
- Modify: `docs/user-guide/sources.md` or the nearest page documenting on-disk state — name both user-scope files and what each is for
- Modify: `packages/AGENTS.md` (its dual-naming rule cites the lockfile filename)
- Modify: `docs/README.md` only if a page is added

- [ ] **Step 1: Write the ADR**

Follow the existing ADRs' structure — read `0007-source-aware-github-app-authentication.md` first and match its headings exactly. Content:

- **Context.** Two delivery layers diverged on placement, state and naming; §1.1 of the design enumerates it. Incremental delivery is a requirement, not a preference.
- **Decision.** One shared `app/deploy` module; lockfile schema `3.0.0` with desired state and materialization split by role **into two files at every scope**, user and repository alike, differing only in where they are rooted; `{sourceId}/{manifestId}` as the one logical bundle key; a dual-surfaced `unifiedDeploy` flag, default off, with a read-time schema version gate so flag-off code can never misread or clobber flag-on state.
- **Alternative considered and rejected.** A single merged file at user scope, on the grounds that a machine-local file gains nothing from the split. Rejected because it buys one fewer file at the cost of two code paths, two migration shapes and two test sets for the rest of the cutover — and because it would leave the desired-state file byte-comparable only in a repository, weakening §8.1's determinism promise for no reason. The design's §5.1 said otherwise and is amended by this ADR.
- **Consequences.** Both paths coexist for the cutover: double maintenance and a doubled test matrix for flagged surfaces (§2's accepted cost). The gate turns a mixed-version read into a loud failure rather than silent corruption. A two-file write is not one filesystem transaction, so §8.4's ordering and resume rules now apply at user scope too. `prompt-registry.lock.json` keeps its name at repository scope until slice 3 (ADR-0004 stays in force until then).
- **Status.** Accepted; superseded in part by whatever slice 3 decides about the committed-file rename.

Add the row to `adr-index.md` in its existing format.

- [ ] **Step 2: Update `installation-flow.md`**

Add a section describing the flag-on user-scope path: `extract → validate → place → record`, with the record-before-MCP note and a Mermaid diagram (the docs rule is Mermaid for flow diagrams, ASCII only for directory trees). State explicitly that the flag is off by default and that the legacy path is unchanged.

- [ ] **Step 3: Document the flag and `--force`**

In `docs/reference/commands.md`, add `--force` to `install`'s option table with the §4.10 semantics ("overwrite a pre-existing untracked destination file"). Add `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` where `authentication.md` documents its sibling env vars — or a new "Feature flags" section if none fits; check first and reuse rather than inventing a second home for env vars.

In `docs/user-guide/troubleshooting.md`, add the gate message verbatim with the two remedies (upgrade, or unset the flag), so the string a user pastes into a search box lands on the page.

- [ ] **Step 4: Fix `packages/AGENTS.md`**

Its dual-naming rule cites the lockfile filename. Clarify that the CLI's **user-scope** XDG file is `ai-primitives-hub.lock.json` and is now schema `3.0.0` behind the flag, while the **repository** file keeps its `prompt-registry.*` names until slice 3. Do not loosen the rule — the point is that the two are deliberately different.

- [ ] **Step 5: Build the docs site**

Run: `pnpm -C website run build`
Expected: clean build. This catches broken relative links and MDX problems, and the docs guide requires it after navigation or link changes.

- [ ] **Step 6: Commit**

```bash
git add docs/ packages/AGENTS.md
git commit -m "docs: record the unified deploy decision and the flag-on user-scope path

Adds ADR-0008, documents the install --force flag and the
AI_PRIMITIVES_HUB_UNIFIED_DEPLOY switch, describes the shared deploy
pipeline in the installation-flow guide, and clarifies in packages
AGENTS.md that the user-scope XDG lockfile and the repository lockfile
deliberately differ in both name and schema until slice 3."
```

---

## Slice 1 Definition of Done

- [ ] `pnpm -C packages -r build` clean; `pnpm -C packages -r test` green; `pnpm -C packages -r lint:fix` leaves nothing.
- [ ] `pnpm run compile && pnpm run test:unit` green — the extension is untouched by this slice, so a failure there is a regression from a `core`/`app` signature change.
- [ ] `pnpm -C website run build` clean.
- [ ] Both suites pass, as §10 requires: the existing CLI tests with the flag unset, and the new flag-on suite.
- [ ] **Hand-verified by someone who did not write it**, per §11 (NFR-6 means little otherwise). The recipe, verbatim from the design: configure one `vscode` user-scope target, enable `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`, install a fixture bundle declaring one prompt, one instruction and one agent with an id that differs from its filename stem, inspect `~/.copilot/{prompts,instructions,agents}` for real files (not links) named from the normalized id, inspect `ai-primitives-hub.lock.json` under the XDG root for one desired entry and **no** `targets`/`generatedAt`, and `ai-primitives-hub.local.lock.json` for one materialization record with `installedChecksum` on every file, then `uninstall` and confirm those exact paths are gone and nothing else is, then re-run the same command with the flag **off** and confirm it refuses with the §5.12 message and writes nothing.

## Self-Review Record

Run before handoff; findings fixed inline.

**Spec coverage.** Every §11 slice-1 and Step-0 obligation maps to a task: `app/deploy` → 9–11; `PrimitiveKind` routing → 2; lockfile `3.0.0` read/write behind the version gate → 1, 7; CLI user-scope install and uninstall for `vscode` → 12, 14; the XDG v2→v3 shape migration → 8; Step 0's `routeToKind` export → 2, canonical→alias naming and id normalization → 3, version gate → 1, logical bundle key → 4, `FileSystem` link identity → 5. Deliberately **out** of this plan, with the slice that owns each: all 11 targets (2), repository scope and the committed lockfile pair (3), update/profile/apply (4), everything extension-side (5–6), MCP (7), `SourceAdapter` download unification (8), source identity P1–P3 (9), flipping the default (10), deletions (11+), APM retirement (independent PR). The schema *enum* step from §11's Step 0 is replaced by Task 1 Step 9 for the reason in Scope Note 2.

**Type consistency.** `logicalBundleKey` is used as the `bundles`/`targets[].bundles` key in Tasks 7, 8, 10, 11, 13 and 14. `LockfileV3Paths` (`desiredFile`/`localFile`, widened by Task 8 to `MigrationSources` with `legacyFiles`) is the single shape flowing through `DeployPorts.lockfileStore` in Tasks 9–14, so the CLI wiring is the only place that knows a scope. `LockfileV3FileEntry.installedChecksum` is optional in the type (Task 7) and required by policy for managed records (Task 8's unmanaged path is the only producer that omits it; Task 10 always sets it) — matching §5.3's "optional for exactly one reason". `PlacementRejection.reason` uses the same three values in `core` (Task 9) and in `DeployPlan.skipped` (Tasks 9–10). `DeployPorts` is declared once with all eight members in Task 9 and only populated further in later slices.

**Scope symmetry.** The requester's decision is that the two scopes differ only in destination, so this is checked explicitly rather than assumed. Scope appears in exactly three places: `PlacementContext.scope` and `LockfileV3TargetRecord.scope` (recorded data, never branched on), `assertUnifiedDeploySupported` (Task 12, which refuses repository scope until slice 3), and `buildDeployPorts`' path selection (Task 12). The store (Task 7) and the migration (Task 8) take no scope argument at all, and Task 7's "behaves identically at repository paths" test plus Task 8's §8.4-ordering test at repository paths are what keep it that way. If a later slice needs an `if (scope)` inside either module, that is a design change worth re-opening, not an implementation detail.

**Review Focus coverage.** #1 → Task 1 Steps 5–6 and Task 15's flag-off loop. #2 → Task 2's unknown-key test and Task 9's `unknownLayoutKeys`. #3 → Task 3 Step 5 and Task 9's `duplicates`. #4 → Task 4's two slash tests. #5 → Task 8's convergence and untouched-v2 tests, plus Task 15's injected state-write failure.

**Known gap, stated rather than hidden.** §4.4's Copilot-suffix rule is not target-aware, and §4.4/§13 treat host *discovery* of `.prompt.md`/`.agent.md` on Kiro and Claude Code as an external premise to validate manually per host before the flag flips. Slice 1 only touches `vscode`, where the convention is native, so nothing here depends on that premise — but it must be validated before slice 2 widens to the other ten targets, and it is not this plan's to close.

