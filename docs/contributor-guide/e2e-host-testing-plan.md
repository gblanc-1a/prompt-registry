# Plan: Real Extension-Host E2E Tests with Mocked External Calls

Status: Proposal — not yet implemented.

## Context

Today the repository has three test tiers:

| Tier | Location | Runs in | External calls |
|------|----------|---------|----------------|
| Unit | `test/{services,adapters,…}/*.test.ts` | Node + mocked `vscode` | Mocked (`nock`) |
| E2E (mocked VS Code) | `test/e2e/*.test.ts` | Node + mocked `vscode` | Mocked (`nock`) |
| Integration (real VS Code) | `test/suite/*.test.ts` | `@vscode/test-electron` | **Not mocked** — only command-registration smoke tests |

The integration tier cannot today exercise the critical user path
**activate → GitHub login → add hub → install bundle** because:

1. `vscode.authentication.getSession('github', …)` would require a real GitHub login.
2. The GitHub adapters call real `https://api.github.com` / `https://raw.githubusercontent.com`.
3. The first-run setup dialog blocks activation in CI.

This plan introduces a fourth tier — **real extension-host E2E with in-process
mocks** — following the env-flag DI pattern from
`vscode-extension-e2e-testing.md`.

---

## Phase 1 — Production seams (gated on `isE2E()`)

All seams are net-new and inert when `process.env.VSCODE_E2E !== 'true'`.
Production behaviour is unchanged when the flag is unset.

1. **New module** `src/e2e/e2e-bootstrap.ts`
   - `isE2E(): boolean`
   - `applyE2EOverrides(context: vscode.ExtensionContext): void`
   - Stub `AuthenticationProvider` returning a fake session
     (`accessToken = 'e2e-token'`).
   - Reads config from env: `VSCODE_E2E_HTTP_BASE`, `VSCODE_E2E_HUB_URL`,
     `VSCODE_E2E_AUTH_TOKEN`, `VSCODE_E2E_WORKSPACE`.

2. **Auth seam** in [src/extension.ts](../../src/extension.ts) activation:
   when `isE2E()`, register the stub provider with id **`github-e2e`**
   (distinct id avoids clashing with VS Code's built-in `github` provider).
   Route the existing `getSession('github', …)` call sites through a small
   helper that swaps the id in E2E mode:
   - [src/services/hub-manager.ts#L298](../../src/services/hub-manager.ts#L298)
   - [src/adapters/github-adapter.ts#L195](../../src/adapters/github-adapter.ts#L195)
   - [src/adapters/apm-adapter.ts#L155](../../src/adapters/apm-adapter.ts#L155)
   - [src/adapters/awesome-copilot-adapter.ts#L518](../../src/adapters/awesome-copilot-adapter.ts#L518)
   - [src/adapters/skills-adapter.ts#L599](../../src/adapters/skills-adapter.ts#L599)
   - [src/utils/github-account-prompt.ts#L25](../../src/utils/github-account-prompt.ts#L25)

3. **HTTP seam**: new `src/utils/github-endpoints.ts` returns
   `{ apiBase, rawBase }` from env (defaults: real URLs). Replace hard-coded
   `https://api.github.com` and `https://raw.githubusercontent.com` in:
   - `src/adapters/github-adapter.ts`
   - `src/adapters/awesome-copilot-adapter.ts`
   - `src/adapters/apm-adapter.ts`
   - `src/adapters/skills-adapter.ts`

4. **First-run + background work suppression** in E2E mode:
   - Register E2E-only command `promptRegistry._e2eSeedSetupState` that sets
     `globalState['promptregistry.setupState'] = 'complete'`.
   - Early-return / no-op `AutoUpdateService`, `UpdateScheduler`, and the
     `syncAllSources()` activation call.

5. Mark every touchpoint with a `// @e2e-seam` comment so all seams are
   greppable for future cleanup.

---

## Phase 2 — E2E test infrastructure

1. **Workspace fixture** `test/e2e-host/fixtures/workspace/`
   - Pre-populated with `.git/info/`, `.github/prompts/`, `package.json`.
   - Copied to a tmp dir per test run by the bootstrap.

2. **Mock HTTP server** `test/e2e-host/mock-github-server.ts`
   - `127.0.0.1:0` (random port).
   - Reuses payload builders from
     [test/helpers/repository-fixture-helpers.ts](../../test/helpers/repository-fixture-helpers.ts)
     (`setupReleaseMocks`, `createMockGitHubSource`).
   - Serves: `/repos/{owner}/{repo}/releases/latest`, release zip artifacts,
     `/repos/{owner}/{repo}/contents/...`, raw paths under `/raw/...`.

3. **Runner** `test/e2e-host/run-e2e.js`
   - Mirrors [test/runExtensionTests.js](../../test/runExtensionTests.js) but:
     - Sets `VSCODE_E2E=true` and the `VSCODE_E2E_*` URLs **before** calling
       `runTests()`.
     - Starts the mock server before launch, tears it down after.
     - Per-run isolated `--user-data-dir`, `--extensions-dir`, and
       `--folder-uri` to the workspace fixture copy.
     - `extensionTestsPath` → `test-dist/test/e2e-host/index.js`.

4. **Mocha loader** `test/e2e-host/index.ts` — same shape as
   [test/suite/index.js](../../test/suite/index.js); loads
   `*.e2e-host.test.ts`.

5. **Helpers** `test/e2e-host/helpers/`
   - `seed-setup-state.ts` — invokes `promptRegistry._e2eSeedSetupState`.
   - `wait-for.ts` — poll for bundle file present, lockfile entry, etc.
   - `assertions.ts` — `assertBundleInstalled(scope, bundleId)`.

---

## Phase 3 — Critical-path scenarios

Two scenarios in two files (one suite per scope, isolated state):

1. **`test/e2e-host/install-user-scope.e2e-host.test.ts`**
   - Activate extension, seed setup state.
   - `vscode.commands.executeCommand('promptRegistry.addHub', { url: <mockUrl> })`.
   - Assert hub registered via `HubManager.listHubs()`.
   - `vscode.commands.executeCommand('promptRegistry.installBundle', 'test-bundle', { scope: 'user', version: '1.0.0' })`.
   - Assert: bundle files present in user Copilot dir (paths from
     `UserScopeService`), `RegistryStorage.getInstalledBundles('user')`
     contains entry, stub auth `getSession` was invoked at least once
     (verifies login wiring via a counter on the stub).

2. **`test/e2e-host/install-repository-scope.e2e-host.test.ts`**
   - Same setup, `scope: 'repository'`.
   - Assert: files in `<workspace>/.github/prompts/`,
     `prompt-registry.lock.json` written and parses, lockfile contains entry,
     `.git/info/exclude` updated.

Both scenarios run in parallel-safe isolated workspace copies.

---

## Phase 4 — Wiring & docs

- `package.json` scripts:
  ```json
  "test:e2e-host": "npm run compile-tests && node ./test/e2e-host/run-e2e.js"
  ```
  Chain into `npm test` after `test:integration`.
- New `test/e2e-host/AGENTS.md` explaining the four test tiers (unit,
  property, mocked-vscode E2E, real-host E2E) and when to use which.
- Update [test/e2e/AGENTS.md](../../test/e2e/AGENTS.md) with a pointer to the
  new tier.
- CI: add a step running `test:e2e-host` (xvfb already present for
  `test:integration`).

---

## Verification

1. `npm run test:unit` — green after seam refactor (no behaviour change when
   env flag unset).
2. `npm run test:integration` — existing smoke suite still green.
3. `npm run test:e2e-host` — both scenarios green; mock-server log shows it
   served *every* network request (no escapes to real GitHub). Add a strict
   `disableNetConnect()` guard to assert this.
4. Manual: launch dev host without `VSCODE_E2E`; real GitHub login + sync
   still work.
5. Run e2e-host suite 3× consecutively → deterministic (isolated
   `--user-data-dir` per run).

---

## Decisions

- **Mock strategy**: env-flag DI + local HTTP server.
- **Scenarios**: user-scope install + repository-scope install.
- **First-run**: pre-seed `SETUP_STATE_KEY = COMPLETE` via E2E-only command
  (no production setting change).
- **No back-compat shims**: all seams are net-new and gated on `isE2E()`.

### Out of scope (Phase 5+)

- Bundle update flow.
- Uninstall flow.
- Profile activation pulling a hub-defined bundle.
- Webview-driven UI (would need `vscode-extension-tester` / ExTester).

---

## Further considerations

1. **Auth provider id collision** with VS Code's built-in `github` provider.
   Chosen approach: distinct id `github-e2e` + helper that swaps the id in
   E2E mode (touches the 6 call sites listed in Phase 1). Alternative —
   stubbing the entire `vscode.authentication` namespace via a companion test
   extension — is heavier and rejected.
2. **Webview not exercised**: the install command is invoked directly (same
   handler the webview posts to). To drive the webview itself, add ExTester
   later.
3. **Transport scheme**: the mock server is `http://`, so adapters must honour
   the helper's base verbatim (no hard-coded `https://`). Confirm during the
   Phase 1 refactor.
