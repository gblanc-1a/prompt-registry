# Portable Source Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active v3 registry IDs with portable adapter-specific source identity, preserve upgrade-stable bundle keys, and enforce exact artifact resolution without breaking offline cleanup or migration.

**Architecture:** Core owns identity, resolution and migration decisions; infra acquires provider metadata and source bytes; app composes those results with the existing paired store and deploy pipeline. CLI and extension translate their local source configuration at the shared boundary, never persist registry handles as active v3 keys, and keep legacy flag-off paths intact.

**Tech Stack:** TypeScript, Node 24+, pnpm 11+, Vitest, existing HTTP/filesystem ports, Ajv and SHA-256; Mocha for the later extension integration. No new runtime dependency.

**Spec:** [Amended lifecycle design](../specs/2026-10-09-unify-bundle-lifecycle-design.md), especially §§3.1–3.2, 5.2–5.6, 5.10–5.13, 8.3–8.4, 10–11 and §14 decisions 13–18; [requirements](../specs/2026-10-09-unify-bundle-lifecycle-requirements.md). Approved amendment baseline: `a47164a3`. This plan supersedes the source-ID, logical-key and migration instructions in [the original Step 0/Slice 1 plan](2026-10-09-unify-bundle-lifecycle-step0-slice1.md), not its unrelated placement/safety work.

## Global Constraints

- Node 24+, pnpm 11+; keep Clipanion exactly `4.0.0-rc.4`.
- Dependencies point inward: CLI/extension → app → infra → core. Domain rules in core; no direct filesystem/HTTP or `vscode` dependency there.
- `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` and `promptregistry.unifiedDeploy` remain default off; do not flip the flag or migrate flag-off writes.
- The amended, unshipped v3 format still writes `"3.0.0"`; v2 remains `"2.0.0"`. Validate shapes after classifying versions.
- Active logical keys are `{sourceKey}/{logicalBundleId}`; both components are non-empty and slash-free. `sourceKey` is `src-` plus 64 lowercase SHA-256 hex characters from canonical identity JSON.
- GitHub release sources have no artificial branch/path selectors. Tree adapters preserve effective ref and relevant content selectors; `main` and `master` remain distinct.
- Source identity excludes local registry IDs, hub membership, display names, credentials and targets. URL normalization preserves scheme/effective port and provider-sensitive path case.
- Keep the desired/local role split, injected `AppStorage`, recorded paths, transformed-byte baselines and per-file/MCP ownership.
- Never invent historical provider IDs or pins. Retain unresolved intent/unmanaged records, and preserve any known digest.
- Repository writes remain lazy on explicit install/update/uninstall. Reads, workspace open, source sync and dry-run must not rewrite identity, locators, bindings or pins.
- Uninstall and local-state status/doctor remain offline. Provider lookup belongs in source resolution, not deployment or cleanup.
- No new local desired-state map, journal, cross-process lock, rollback, backup or configuration fingerprint.
- APM retirement is unchanged. Artifactory stays an explicit channel; no automatic GitHub fallback or identity merge.
- Preserve `prompt-registry.lock.json` repository filenames until lifecycle slice 3, extension publisher/name and `promptregistry.*` IDs.
- Always use `lint:fix`, not a subsequent non-fixing lint run. Start behavior changes with failing tests and mock external boundaries.
- Each implementation task ends in a scoped conventional commit with `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. Never commit on `main` or include unrelated generated output.

## Review Focus

1. **Reused repository URL:** a successful response with a different repository ID must fail before placement; Task 4.
2. **Version-only hand edit:** an inconsistent version/artifact pin must fail, not silently select a replacement; Tasks 2 and 6.
3. **Legacy same-basename roots/conflicting aliases:** retention must not collapse unrelated ownership or disclose absolute roots in shared state; Tasks 1 and 3.
4. **Interrupted rekey with an old completion marker:** local-first progress must resume offline without duplicating keys or forgetting desired intent; Task 3.
5. **Changing Artifactory index and unavailable upstream:** replay must use recorded published objects without GitHub access; Task 8.

---

## Delivery Boundaries and Dependencies

**Corrective slice A, Tasks 1–7:** amend this branch's current CLI user-scope v3 path and its retained source types. Contracts for Azure DevOps and Artifactory exist from Task 1, but no unsupported runtime capability is claimed. Do not release the amended writer until these tasks pass together.

**Later integration B, Tasks 8–9:** attach to the relevant lifecycle slices. Task 8's Artifactory execution depends on the integration of [AmadeusITGroup/ai-primitives-hub#437](https://github.com/AmadeusITGroup/ai-primitives-hub/pull/437); do not copy that PR's implementation into this branch. Task 9 depends on extension lifecycle slices 5/6 and the actual reader/reconcile integration, rather than introducing another extension deploy path here.

Dependencies: Task 2 consumes Task 1; Task 3 consumes Tasks 1–2; Task 4 consumes Task 1; Task 5 consumes Task 1; Task 6 consumes Tasks 2–5; Task 7 consumes Task 6. Task 8 consumes Tasks 1–2 and 6's boundary; Task 9 consumes Tasks 1–3, 6 and the providers it wires. Do not execute later integration tasks simply because the corrective slice is ready.

The original lifecycle spec remains authoritative for placement, scope moves, MCP mutation, target breadth, repository filename migration and APM deletion. This plan supplies their identity seam, not implementations of those independent slices.

## File Structure

All paths below are repository-relative. New files are narrowly responsible for the amended contract; existing public barrels export their types/functions.

| Area | Files and responsibility |
|---|---|
| Core identity | Create `packages/core/src/domain/source/portable-identity.ts`; canonical structured identities, keys and equivalence. Modify `domain/bundle/logical-key.ts` for portable key components; preserve a separate legacy decoder for flag-off callers. |
| Core resolution | Create `packages/core/src/domain/bundle/resolution.ts`; pin/live/unpinned variants and normalized comparisons. Create `packages/core/src/domain/install/source-content-digest.ts`; stable raw-byte inventory digest. |
| Core migration | Create `packages/core/src/domain/install/portable-identity-migration.ts`; pure evidence classification, mapping and conflict policy. |
| Provider boundary | Modify `packages/core/src/ports/source-adapter.ts`; add optional portable-resolution capability, keeping legacy methods intact. Create `packages/app/src/registry/resolve-portable-bundle.ts`; shared orchestration. |
| Paired storage | Modify `packages/app/src/stores/lockfile-v3.ts` and `migrate-lockfile-v3.ts`; typed amended shapes and resumable conversion. Modify only `lockfile-v3.schema.json`; retain the v2 schema. |
| Providers | Create `packages/infra/src/adapters/github-portable-resolution.ts` and `local-portable-resolution.ts`; shared helpers used by retained adapters. Modify `github-adapter.ts`, `skills-adapter.ts`, `awesome-copilot-adapter.ts`, `local-adapter.ts`, `local-skills-adapter.ts`, `local-awesome-copilot-adapter.ts`. |
| Lifecycle | Modify `packages/app/src/deploy/{types,plan,deploy,undeploy,resolve-undeploy-key,ownership}.ts`; portable requests, actual installed pins and record-based cleanup. Add `packages/app/src/deploy/compare-materialization.ts` for artifact-aware comparison. |
| CLI | Modify `packages/cli/src/commands/{install,uninstall}.ts` and `packages/cli/src/deploy-wiring.ts`; delegate resolution/replay and render diagnostics. Legacy commands still use their existing resolver stack. |
| Later adapters | Modify `packages/infra/src/adapters/azure-devops-adapter.ts`; Artifactory files come from the referenced PR, not from scaffolding a second backend. |
| Later extension | Integrate through `apps/vscode-extension/src/services/{bundle-installer,registry-manager,repository-activation-service,lockfile-manager}.ts`, activation migrations, commands and dependent readers when their lifecycle slice exists. |

### Task 1: Define portable identity and artifact contracts

**Files:** Create the three identity/resolution/digest core files above and the evidence types in `packages/core/src/domain/install/portable-identity-migration.ts`; add tests `packages/core/test/domain/source/portable-identity.test.ts`, `packages/core/test/domain/bundle/resolution.test.ts`, `packages/core/test/domain/install/source-content-digest.test.ts`. Modify `packages/core/src/domain/bundle/logical-key.ts`, `packages/core/test/domain/bundle/logical-key.test.ts`, public barrels and `packages/core/src/ports/source-adapter.ts`.

**Interfaces:**

- `PortableSourceDescriptor = { type: RetainedSourceType; identity: SourceIdentity; locator: string; config?: PortableSourceConfig }`.
- `PortableSourceConfig` has only optional `ref`, `collectionsPath`, `skillsPath`, `indexFile`, `authMode: 'anonymous' | 'bearer'`, and `credentialRef` fields; all except authMode are strings. Adapter identity includes only the selectors it consumes, never authentication fields.
- `RetainedSourceType` excludes `apm`/`local-apm` and includes `artifactory`; do not delete the existing legacy `SourceType` members as part of this task.
- `SourceIdentity` is discriminated by `kind`: `github-releases`, `github-tree`, `azure-devops-tree`, `artifactory-index`, `workspace-local`, `external-local`. Fields follow spec §5.10: origin/provider repository ID where available, ref/content selectors for tree sources, root/indexFile for Artifactory, relative root or binding name for local sources. Use string representations of validated provider IDs.
- `sourceKey(identity: SourceIdentity, type: RetainedSourceType): string`; `sameSourceIdentity(a: PortableSourceDescriptor, b: PortableSourceDescriptor): boolean`; `assertSourceKey(key: string, source: PortableSourceDescriptor): void`.
- `logicalBundleKey({ sourceKey, logicalBundleId }): string`; `parseLogicalBundleKey(key): { sourceKey: string; logicalBundleId: string } | null`. The active parser rejects the reserved `unresolved/` prefix.
- `BundleResolution` discriminated by `kind`: `pinned`, `unpinned`, `live`. Pinned payloads have `version: string` from the verified manifest and discriminate `provider`: `github-release`, `github-tree`, `azure-devops-tree`, `artifactory-object`, `local-snapshot`; use exactly the coordinates/digests from spec §5.2. `unpinned` has `reason` and optional `evidence` containing known pins/digests, known manifest version and external-input limitations. `live` contains its local bundle selector. `assertResolutionVersion` rejects disagreement with recorded manifest-version evidence; it never invents that evidence for historical unpinned records.
- Evidence types are core exports from this task, before the store depends on them: `LegacyDesiredIntent = { originalKey: string; sourceRef?: string; descriptor?: { type?: string; locator?: string; selectors?: Readonly<Record<string, string>> }; version: string; knownResolution?: BundleResolution; reason: string }`; `LegacyIdentityEvidence = { originalKey: string; sourceRef?: string; descriptor?: LegacyDesiredIntent['descriptor']; version: string; knownResolution?: BundleResolution; originalLocalRoot?: string; portableDescriptor?: PortableSourceDescriptor }`. The original local root is machine-local retention evidence only; never serialize it into shared desired evidence.
- `sameArtifactResolution(a: BundleResolution, b: BundleResolution): boolean`; `assertResolutionVersion(resolution: BundleResolution, version: string): void`.
- `sourceContentDigest(files: ExtractedFiles): string` returns lowercase SHA-256 hex. Reject absolute/traversing/noncanonical POSIX paths, sort paths by UTF-8 byte order, then hash each entry as an eight-byte unsigned big-endian path-byte length, UTF-8 path bytes, an eight-byte unsigned big-endian content length, and raw content bytes. No timestamps, locale collation, ZIP metadata or absolute roots enter this encoding.
- `PortableBundlePayload = { source: PortableSourceDescriptor; logicalBundleId: string; manifestId: string; version: string; resolution: BundleResolution; files: ExtractedFiles; bytes?: Uint8Array }`. Archive-backed pins also return their original archive bytes for the existing deploy checksum preflight; tree/local snapshots return files directly.
- `PortableBundleSelection = { bundleId: string; version?: string; expectedSource?: PortableSourceDescriptor; resolution?: BundleResolution; localLocation?: LocalSourceLocation }`. `LocalSourceLocation` is either `{ kind: 'workspace'; root: string }` or `{ kind: 'binding'; name: string; root: string }`; `root` is runtime-only, never serialized.
- Add `SourceAdapter.resolvePortableBundle?(selection: PortableBundleSelection): Promise<PortableBundlePayload | null>`. It is optional during migration; absence means an explicit unsupported-capability error, not an unpinned success.

- [ ] **Step 1: Add failing identity/resolution/digest tests.**

```ts
it('keeps repository renames and display configuration out of identity', () => {
  expect(sourceKey(releaseIdentity('https://github.com', '42'), 'github'))
    .toMatch(/^src-[a-f0-9]{64}$/);
  expect(sameSourceIdentity(sourceAt('old/repo'), sourceAt('new/repo'))).toBe(true);
});
it('does not equate different refs or adapters', () => {
  expect(sourceKey(treeIdentity('main'), 'skills')).not.toBe(sourceKey(treeIdentity('master'), 'skills'));
  expect(sourceKey(treeIdentity('main'), 'skills')).not.toBe(sourceKey(treeIdentity('main'), 'awesome-copilot'));
});
it('hashes raw inventory independently of insertion order', () => {
  expect(sourceContentDigest(filesInOrder('a', 'b'))).toBe(sourceContentDigest(filesInOrder('b', 'a')));
  expect(sourceContentDigest(binaryFiles(0))).not.toBe(sourceContentDigest(binaryFiles(1)));
});
```

Fixture builders live in the owning test file; `sourceAt` uses the same repository ID.
Also assert the exact `^src-[a-f0-9]{64}$` shape, origin effective-port distinctions,
case-sensitive paths, invalid/credential-bearing locator refusal, canonical property
order, slash rejection, same-version changed asset/digest inequality, and display-only
tag changes being equal. Preserve registry `generateSourceId()` tests for legacy callers.

- [ ] **Step 2: Run the failing tests.** Run `pnpm -C packages/core exec vitest run test/domain/source/portable-identity.test.ts test/domain/bundle/resolution.test.ts test/domain/install/source-content-digest.test.ts test/domain/bundle/logical-key.test.ts`; expect assertion/import failures for the new contract, not missing tools.
- [ ] **Step 3: Implement the interfaces and pure policies.** Keep URL/selector validation provider-specific. Do not globally rewrite existing source IDs. Make invalid identities throw actionable `RegistryError` codes in the existing `BUNDLE`/`CONFIG` namespaces.
- [ ] **Step 4: Re-run that selector, then `pnpm -C packages/core test` and `pnpm -C packages/core run build`.** Expect no failures or type errors.
- [ ] **Step 5: Commit only Task 1 files:** `feat(core): define portable source identities and artifact resolutions`.

### Task 2: Amend and validate the v3 wire contract

**Files:** Modify `packages/core/src/public/schemas/lockfile-v3.schema.json`, `packages/app/src/stores/lockfile-v3.ts`, `packages/app/test/stores/lockfile-v3.test.ts`. Create `packages/app/test/stores/lockfile-v3-schema.test.ts`; update public exports.

**Consumes:** Task 1 descriptors, keys and resolutions.

**Produces:** `LockfileV3DesiredEntry = { version: string; sourceKey: string; resolution: BundleResolution }`, `DesiredLockfileV3.unresolved?: LegacyDesiredIntent[]`, and managed/unmanaged materialization unions. Export `ManagedMaterialization` as the existing local bundle-record fields with required `sourceKey`/`resolution`, no active `sourceId`, and `state` absent. Unmanaged records require `state: 'unmanaged'`/reason and may retain identity evidence instead of those two required fields. Keep existing read/write function names and filesystem ports. `readLockfileV3Pair()` is the strict amended-shape reader; migration reads old shapes through `planLockfileMigration()`.

- [ ] **Step 1: Add failing schema/store tests.** Accept each pinned/live/unpinned shape, reject active `sourceId`, mismatched key/descriptor, invalid pin digests and version/pin disagreement. Reject unknown source/resolution variants. Allow legacy references only in migration evidence. Confirm neither v2 nor unknown-major payloads can be re-stamped by a new writer.
- [ ] **Step 2: Run `pnpm -C packages/app exec vitest run test/stores/lockfile-v3.test.ts test/stores/lockfile-v3-schema.test.ts`.** Expect the current sourceId shape/defaulting reader to fail the new assertions.
- [ ] **Step 3: Implement strict amended readers/writers and schema unions.** Validate before writing either half. An unmanaged record may omit sourceKey/resolution only with legacy evidence and a reason. Keep unique-temp atomic writes and local-before-desired ordering. Preserve Artifactory `indexFile`, auth mode and credential reference as non-identity configuration; never accept secret values.
- [ ] **Step 4: Re-run the selector and `pnpm -C packages/app run build`.** The build may identify request/fixture call sites to adapt in Task 6; record them rather than weakening the new types. Intermediate task commits are not release boundaries.
- [ ] **Step 5: Commit Task 2:** `feat(app): define portable v3 lockfile shapes`.

### Task 3: Convert v2 and branch-era v3 without losing evidence

**Files:** Extend `packages/core/src/domain/install/portable-identity-migration.ts`, create `packages/core/test/domain/install/portable-identity-migration.test.ts`. Modify `packages/app/src/stores/migrate-lockfile-v3.ts`, `packages/app/test/stores/migrate-lockfile-v3.test.ts`, public exports.

**Consumes:** Tasks 1–2; existing stored checksums/paths, optional cached identity/manifests, and verified resolution evidence supplied by the operation.

**Produces:**
- Consume Task 1's `LegacyDesiredIntent` and `LegacyIdentityEvidence` without defining competing app-layer types.
- `classifyLegacyIdentity(input: LegacyIdentityInput): LegacyIdentityDecision` returns a proven mapping or retained evidence; this is core policy with no IO.
- `LegacyIdentityInput = { legacyKey: string; sourceId?: string; descriptor?: Readonly<Record<string, unknown>>; originalLocalRoot?: string; version: string; knownResolution?: BundleResolution; proven?: { source: PortableSourceDescriptor; logicalBundleId: string }; materializations?: readonly LegacyMaterializationEvidence[] }`. `proven` is supplied only from verified operation metadata or validated cached evidence, never a guessed URL/ID conversion.
- `LegacyMaterializationEvidence = { targetName: string; targetType?: TargetType; baseDir: string; files: readonly { path: string; checksum?: string; installedChecksum?: string }[]; mcp?: { configPath: string; servers: readonly string[] } }`. Batch classification receives this evidence to detect incompatible target bindings and baselines; app retains and writes the complete original records, not a reconstruction from this comparison projection.
- `LegacyIdentityDecision` is `{ kind: 'mapped'; key: string; source: PortableSourceDescriptor; resolution: BundleResolution } | { kind: 'unresolved'; desired: LegacyDesiredIntent; evidence: LegacyIdentityEvidence }`. Batch conflict classification uses `planIdentityMappings(inputs: readonly LegacyIdentityInput[]): readonly LegacyIdentityDecision[]`; include the original evidence on conflicting mapped candidates rather than choosing a winner.
- Existing `convertV2ToPair`, `planLockfileMigration`, `readLockfilePair`, `migrateLockfileIfNeeded` extended for old-v3 shapes and optional supplied evidence; their filesystem ordering remains in app.

- [ ] **Step 1: Add failing migration tests.** Cover proven source/manifest mappings, missing provider IDs, namespaced runtime IDs without a manifest, partial historical pins, different versions collapsing toward one portable key, conflicting baselines and same-basename local roots. Assert all original intent/ownership survives, known digests/baselines stay unchanged, shared evidence has no secrets/absolute local roots, and unmanaged retention keys do not collide.
- [ ] **Step 2: Add interruption tests.** Inject failure after each write/deletion. Seed branch-era v3 with `lockfileV3: 'complete'`; fail after the new local write while desired still uses old IDs. Restart with no provider/cache lookup available and assert one retained ownership record, preserved intent and eventual completion. Read-only preview and no-match uninstall lookup must perform zero writes.
- [ ] **Step 3: Run `pnpm -C packages/core exec vitest run test/domain/install/portable-identity-migration.test.ts` and `pnpm -C packages/app exec vitest run test/stores/migrate-lockfile-v3.test.ts`.** Expect failures in classification/shape detection/resume.
- [ ] **Step 4: Implement pure classification and resumable application.** Sorted maps/evidence yield deterministic desired output. A temporary managed-record legacy mapping survives local-first conversion; remove it only after desired is safe. Inspect shapes even with an old completion marker. Never fetch solely for migration, strip version suffixes as proof of manifest identity, overwrite new pins with unpinned legacy rows, or drop unresolved records from ownership/refcount checks.
- [ ] **Step 5: Re-run both selectors.** Assert two runs with identical evidence but different clocks produce identical desired bytes, and explicit uninstall needs only recorded paths. Ambiguous unproven destinations remain untouched and reported.
- [ ] **Step 6: Commit Task 3:** `fix(app): preserve identity evidence across resumable v3 migration`.

### Task 4: Resolve GitHub identity and exact remote pins in shared adapters

**Files:** Create `packages/infra/src/adapters/github-portable-resolution.ts`, `packages/infra/test/adapters/github-portable-resolution.test.ts`; modify `github-adapter.ts`, `skills-adapter.ts`, `awesome-copilot-adapter.ts` and their existing tests.

**Consumes:** Task 1 port/payload; injected `GitHubApi`, existing archive extractor and byte retrieval. Legacy `fetchBundles`/download calls and CLI resolver behavior stay intact.

**Produces:** Implement `resolvePortableBundle(selection)` on the three retained remote adapters. Shared helper `resolveGitHubSourceIdentity(source: RegistrySource, api: GitHubApi, expected?: PortableSourceDescriptor): Promise<PortableSourceDescriptor>` obtains repository ID/current locator and effective selectors. A per-operation metadata result is reused, not persisted through read-only commands.

- [ ] **Step 1: Add failing GitHub tests.** A rename returns the same repository ID and preserves the key; reuse of the old URL returns a different ID and fails. A first resolution fetches metadata once; known-source direct release lookup does not walk the catalog. Release versions share a manifest logical ID but have different release/asset/digest pins.
- [ ] **Step 2: Add exact-content tests.** Replay addresses recorded release/asset IDs, verifies SHA-256 and manifest version, and refuses missing/replaced IDs without another tag/latest lookup. Tree requests resolve a ref to a commit, then read all files at that SHA even if the branch moves. Omitted skills ref follows actual effective default behavior, rather than forced `main`. `master` remains distinct. External collection inputs are verified/pinned or explicitly reported unpinned.
- [ ] **Step 3: Run `pnpm -C packages/infra exec vitest run test/adapters/github-portable-resolution.test.ts test/adapters/github-adapter.test.ts test/adapters/skills-adapter.test.ts test/adapters/awesome-copilot-adapter.test.ts`.** Expect new capability/pin failures.
- [ ] **Step 4: Implement shared acquisition with existing provider/auth/HTTP boundaries.** Read release and asset IDs from API responses. Verify archive bytes before returning extracted files. Reuse existing extraction/manifest helpers; preserve public catalog IDs for browsing, while portable payloads carry validated manifest/logical identity separately. Do not duplicate auth, retries or redirect credential policy in adapters.
- [ ] **Step 5: Re-run the selector plus legacy resolver tests:** `pnpm -C packages/infra exec vitest run test/resolvers/github-resolver.test.ts test/resolvers/skills-resolver.test.ts test/resolvers/awesome-copilot-resolver.test.ts`; expect both paths pass.
- [ ] **Step 6: Commit Task 4:** `feat(infra): resolve portable GitHub sources and pinned artifacts`.

### Task 5: Resolve local snapshots and explicit bindings

**Files:** Create `packages/infra/src/adapters/local-portable-resolution.ts`, `packages/infra/test/adapters/local-portable-resolution.test.ts`; modify retained local adapters and their tests. Do not change `local-apm-adapter.ts`.

**Consumes:** Task 1 inventory digest and runtime `LocalSourceLocation`; existing injected filesystem.

**Produces:** Local adapters implement `resolvePortableBundle(selection)`. Helper `resolveLocalSourceIdentity(source: RegistrySource, location: LocalSourceLocation): PortableSourceDescriptor` records a workspace-relative root or binding name, never the runtime absolute source root.

- [ ] **Step 1: Add failing tests.** Two clone roots produce the same workspace-relative identity/content digest. Different relative roots and relevant collection selectors remain distinct. External same-basename directories require explicit bindings, never basename matching. Missing/out-of-scope bindings fail actionably. Binary bytes survive direct reads and enumeration order does not affect snapshot digest.
- [ ] **Step 2: Add the live-link case.** `local-skills` remains `kind: 'live'`; resolving/replaying must not write into or copy over the linked source. Identical binding names from different owning lockfiles cannot establish cross-scope equality.
- [ ] **Step 3: Run `pnpm -C packages/infra exec vitest run test/adapters/local-portable-resolution.test.ts test/adapters/local-adapter.test.ts test/adapters/local-skills-adapter.test.ts test/adapters/local-awesome-copilot-adapter.test.ts`.** Expect portable-location/digest failures.
- [ ] **Step 4: Implement direct raw-byte inventory resolution.** Anchor relative roots to the supplied workspace, not CWD. Runtime bindings come from delivery source configuration; there is no persisted local override/source map. Local-snapshot replay verifies the recorded digest. Preserve existing link safety rules; this task does not add general symlink-following behavior.
- [ ] **Step 5: Re-run the selector and `pnpm -C packages/infra run build`.** Expect no failures/type errors.
- [ ] **Step 6: Commit Task 5:** `feat(infra): resolve portable local snapshots and bindings`.

### Task 6: Carry portable resolution through shared deploy and CLI replay

**Files:** Create `packages/app/src/registry/resolve-portable-bundle.ts`, `packages/app/test/registry/resolve-portable-bundle.test.ts`, `packages/app/src/deploy/compare-materialization.ts`, `packages/app/test/deploy/compare-materialization.test.ts`. Modify deploy files/fixtures, `packages/cli/src/commands/{install,uninstall}.ts`, `packages/cli/src/deploy-wiring.ts`, their existing unified tests, and public barrels.

**Consumes:** Tasks 1–5 and `createSourceAdapter()` with existing source-aware dependency injection.

**Produces:**
- `resolvePortableBundle(source: RegistrySource, selection: PortableBundleSelection, deps: SourceAdapterFactoryDeps): Promise<PortableBundlePayload>` in app; missing capability/null selection becomes an actionable unsupported/not-found `RegistryError`.
- `DeployRequest.source = { sourceKey: string; descriptor: PortableSourceDescriptor }`; add `resolution: BundleResolution` and `manifestId: string`; keep existing bundle/placement/force fields. `bundle.bundleId` is the logical ID; manifest validation uses `manifestId`. For archive pins, supply payload `bytes` and set `expectedArchiveSha` from the recorded digest in the existing `sha256:hex` form, preserving the planner's pre-mutation verification. For tree/local pins, recompute the source-content digest from payload files before effects.
- `sameMaterialization(input: { key: string; desired: LockfileV3DesiredEntry; targetType: TargetType; actual?: { key: string; targetType: TargetType; record: ManagedMaterialization } }): boolean`; assemble the comparison using core's equality policies for key/source/version/resolution/target, not locator display fields or layout fingerprints. This app helper does not define its own normalization or identity rules.
- Existing `deployBundle`, `planDeploy`, `undeployBundle`, `resolveUndeployKey` and `listTargetBundles` names remain. Key lookup joins proven portable mappings or explicit unmanaged evidence, not stripped runtime-ID guesses.

- [ ] **Step 1: Add failing public-path tests.** A new install and its replay record the same sourceKey/pin despite a differently named registry source. Actual local pin remains the old pin until successful deployment. Same-version changed asset/hash requires reconciliation; display-only locator/tag changes do not. Invalid sourceKey/version/pin or digest mismatch fails before migration/placement.
- [ ] **Step 2: Add cleanup/retry tests.** Uninstall works when provider ports would throw on any call. Retained unresolved ownership protects shared files/MCP records. Partial local-before-desired rekeys resume; repeated deploy preserves collision/drift/created-file cleanup and target-rebound behavior. No-match/ambiguous uninstall lookup remains read-only.
- [ ] **Step 3: Run `pnpm -C packages/app exec vitest run test/registry/resolve-portable-bundle.test.ts test/deploy` and `pnpm -C packages/cli exec vitest run test/commands/install-unified.test.ts test/commands/uninstall-unified.test.ts test/deploy-wiring.test.ts`.** Expect existing request/store code to fail the new assertions until wired.
- [ ] **Step 4: Implement shared request construction and recording.** CLI flag-on paths use the shared adapter capability; do not leave identity rules in command methods. Validate resolved source/pin before any write. Preserve byte-only checksum preflight, satisfied-file convergence, old-only inventory retirement, state-effect reporting and local-first writes.

The current copy-only CLI deployment cannot silently accept `kind: 'live'`.
Until the lifecycle link-identity slice supplies safe placement, reject a flag-on
live install/replay before migration or filesystem mutation with an explicit
unsupported-capability diagnostic. Resolution and offline cleanup remain supported;
this corrective slice does not implement a new live-link installer.
- [ ] **Step 5: Implement replay/reporting.** Pinned replay uses recorded coordinates and never reselects from version/latest. Unpinned explicit install/update reports a new resolution and enforces known digests; unresolved intent is reported and yields a nonzero overall replay result while independent entries may run. Keep foreign/repository lockfile refusal until slice 3. Do not make doctor/status network-dependent or bypass their version gate.
- [ ] **Step 6: Adapt all current deploy fixtures and build consumers.** Run `pnpm -C packages -r build`, then re-run the Task 6 selectors and affected store tests; expect no type errors/failures. Tests use production entry points, not mocks of `deployBundle` or the unit under test.
- [ ] **Step 7: Commit Task 6:** `feat(app): deploy and replay portable bundle resolutions`.

### Task 7: Close the corrective slice with registered-command coverage

**Files:** Modify `packages/cli/test/commands/unified-deploy-user-scope.test.ts`, relevant release fixtures, `packages/app/test/stores/migrate-lockfile-v3.test.ts`, `docs/user-guide/sources.md`, `docs/contributor-guide/architecture/installation-flow.md`, and `docs/reference/adapter-api.md`. Preserve the original plan's source-identity supersession notice.

**Consumes:** Task 6's production commands, real temporary filesystem and existing bounded/recording helpers.

**Produces:** A release gate for amended CLI user-scope v3, not a claim that all lifecycle slices are implemented.

- [ ] **Step 1: Add failing registered-command cases.** Install → inspect desired/local → replay → uninstall through `runCommand`, with real files and mocked external providers. Assert active state contains no sourceId/local roots, both halves share logical keys, remote pins are exact, local digests are stable and flag-off commands cannot re-stamp amended state.
- [ ] **Step 2: Add v2/old-v3 negative cases.** Metadata unavailable, prior completion marker, conflicting aliases, changing release asset, changed tree branch, missing external binding, unsupported live placement and dry-run with rejecting mutation ports. Assert retained ownership/intent, actionable diagnostics, zero dry-run/live-refusal effects and no latest fallback.
- [ ] **Step 3: Run `pnpm -C packages/cli exec vitest run test/commands/unified-deploy-user-scope.test.ts`.** Expect the new E2E assertions to fail before any required finishing adjustments.
- [ ] **Step 4: Fix only discrepancies revealed through the shared production path and update the three directly related documentation pages.** Do not weaken fixtures, hide failures with defaults or introduce a second migration mechanism.
- [ ] **Step 5: Run `pnpm -C packages -r lint:fix`, `pnpm -C packages -r build`, and `pnpm -C packages -r test`.** Inspect formatter side effects; retain only task-owned edits. Run `pnpm -C website run build` for documentation links. Expect zero failed tests/build errors; record exact command outcomes and any environmental blockers.
- [ ] **Step 6: Commit Task 7:** `test(cli): verify portable v3 lifecycle across machine configurations`.

**Stop here for corrective-slice review.** Tasks 8–9 are integration obligations, not authorization to implement the remaining lifecycle refactor in this branch.

### Task 8: Integrate Azure DevOps and Artifactory pins with their supported lifecycle surface

**Prerequisites:** the matching source's shared writer is supported; Artifactory additionally requires the referenced PR's types/client/resolver/replication implementation to be integrated. Refresh its actual file names at that point. Do not recreate absent backend files or change `index-v1.json` merely to add identity.

**Files:** Modify `packages/infra/src/adapters/azure-devops-adapter.ts`, `packages/infra/test/adapters/azure-devops-adapter.test.ts`; for the Artifactory PR, modify `packages/infra/src/adapters/artifactory-adapter.ts`, `packages/infra/src/resolvers/artifactory-resolver.ts`, `packages/infra/test/artifactory-infra.test.ts`, app/CLI integration tests and `docs/user-guide/sources.md`.

**Consumes:** Task 1 adapter port/payload and Task 6 orchestration.

**Produces:** `resolvePortableBundle(selection)` for Azure DevOps and Artifactory, using the same `PortableBundlePayload`. No new identity variants or provider fallback.

- [ ] **Step 1: Add failing Azure tests.** Repository ID plus namespace/ref/collectionsPath determines source identity; repository name changes with the same ID preserve it. Resolve a commit, fetch selected collection/files at that commit and verify deterministic content digest. Missing pinned commit fails, not branch fallback.
- [ ] **Step 2: Run `pnpm -C packages/infra exec vitest run test/adapters/azure-devops-adapter.test.ts`, implement the capability using the existing `AzureDevOpsApi`, then rerun it.** Expect all retained/portable cases pass.
- [ ] **Step 3: Add failing Artifactory tests.** Published catalog ID differs from archive manifest ID; retain both without prefix stripping. Root path case, effective port and indexFile distinguish sources; credentials/hub aliases do not. Pin manifest/archive paths, sizes and hashes, change/remove the index selection, deny all GitHub calls and replay the recorded objects. Digest/path/auth failures never trigger GitHub fallback. Root moves require explicit remapping.
- [ ] **Step 4: Run `pnpm -C packages/infra exec vitest run test/artifactory-infra.test.ts`, implement the capability with the PR's existing confined-object client and `PublishedObject` contract, then rerun it.** The index's unnamespaced source.id remains an alias. Do not require upstream repository/release IDs.
- [ ] **Step 5: Add/run a registered CLI replay case for each newly supported source in `test/commands/unified-deploy-user-scope.test.ts`, then run the affected package suites/builds.** Expect exact artifact restoration without adding a provider-specific command lifecycle.
- [ ] **Step 6: Commit each independently supported provider integration separately:** `feat(infra): pin portable Azure DevOps collections` and `feat(infra): replay portable Artifactory published objects`.

### Task 9: Wire extension readers, migration and reconcile when their lifecycle slices arrive

**Prerequisites:** lifecycle slices 5/6 have provided the actual extension shared writer, user-record migration and paired readers. Repository placement/naming migration remains slice 3; this task adds no second lifecycle path.

**Files:** Modify the extension services listed in File Structure, `apps/vscode-extension/src/migrations/` through its existing activation runner, and corresponding `test/services/{registry-manager,bundle-installer,repository-activation-service,lockfile-manager}.test.ts`. Modify `packages/app/src/registry/load-hub-sources.ts` and its test only for portable binding/alias translation, not wholesale hub-management unification.

**Consumes:** Task 6 public app functions, Task 3 migration evidence and the providers actually supported by that slice.

**Produces:** Thin extension wiring of `resolvePortableBundle`, portable active records and `sameMaterialization`, with aliases/bindings supplied from existing configuration models.

- [ ] **Step 1: Add failing registered extension workflow tests.** Hub/direct source names differ but CLI/extension output agrees for identical evidence. Missing-source offer actually adds/binds its descriptor. Opening a repository, auto-update/source sync and declined reconcile do not write identity/locator/pins. Same-version changed pin is offered, not silently deployed. Unknown/retired APM sources are retained/reported rather than installed.
- [ ] **Step 2: Add migration/offline tests.** Activation adopts proven user records while preserving baselines and live links. Missing origin/provider evidence stays unmanaged. Repository records remain untouched until permitted commands; uninstall/doctor do not acquire provider identity. Test the old-v3 local-first interruption through the delivery entry point.
- [ ] **Step 3: Run `pnpm -C apps/vscode-extension run compile-tests`, then `pnpm -C apps/vscode-extension run test:unit`.** Expect the added behavioral assertions to fail before the wiring exists, not skip unsupported fixture outcomes.
- [ ] **Step 4: Implement thin delegators and dependent-reader mapping.** Use `Logger.getInstance()`, context-aware singleton setup and activation migration tags `@migration-cleanup(portable-source-identity)`. Keep identity rules in core/app. Retain the legacy MCP step until lifecycle slice 7 replaces it; no server capability regression.
- [ ] **Step 5: Re-run compile-tests/unit, extension compile and the shared package tests.** Assert tree/marketplace/profile/update readers see the portable installations, not only that a deploy function was called.
- [ ] **Step 6: Commit with the relevant lifecycle slice:** `feat(extension): consume portable lifecycle identity and resolutions`.

## Plan Self-Review and Execution Gate

Coverage: Tasks 1–2 implement §§5.2/5.10/5.13 contracts; Task 3 implements §§8.3–8.4;
Tasks 4–5 implement current retained-source acquisition; Task 6 integrates §§3/5.6
without altering placement; Task 7 implements §10's current-slice acceptance;
Tasks 8–9 attach the remaining adapter/delivery obligations to §11's existing slices.
APM deletion, repository filename migration, shared MCP mutation and full target/scope
expansion deliberately remain in the lifecycle plan, not hidden omissions here.

The five Review Focus cases have explicit owning tests. New interface names are shared
through core/app public barrels; raw provider IDs, local handles and manifest/catalog
IDs are not interchangeable. Intermediate task commits can require downstream fixture
adaptation, but no affected writer ships until its whole vertical slice builds and passes.

Before executing, review this written plan and choose Native or Subagent-driven.
Recommended: **Native for corrective slice A**, because identity → wire shape →
migration → deploy are closely coupled and can be checked through one focused
production-path regression suite. Later integrations remain gated on their prerequisites.
Approval of this plan does not make Artifactory or extension prerequisites exist.
