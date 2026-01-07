# Copilot Instructions for Contributors and AI Agents

These are short, actionable notes to help an AI coding assistant be productive in this repository.

**🚨 FIRST STEP: Read Folder-Specific Guidance 🚨**

Before working in any folder, **MUST READ** the corresponding AGENTS.md file:
- Working with tests? → Read `test/AGENTS.md` first
- Writing E2E tests? → Read `test/e2e/AGENTS.md` first  
- Creating adapters? → Read `src/adapters/AGENTS.md` first
- Building services? → Read `src/services/AGENTS.md` first

**Failure to read these guides will result in:**
- Broken tests due to incorrect VS Code mocking
- Duplicated utilities that already exist
- Missing critical debugging strategies
- Wasted time on solved problems

---

## Development Methodology

### Bug Fixes: Test First

1. **Reproduce first**: Create a failing test that demonstrates the bug
2. **Confirm failure**: Run the test, verify it fails as expected
3. **Fix the code**: Make the minimal change to fix the issue
4. **Confirm fix**: Run the test, verify it passes
5. **No regression**: Run related tests to ensure nothing broke

### Debugging: Isolate the Fault Location

When tests fail, determine whether the bug is in **test code** or **production code** BEFORE iterating:

1. **Read error messages carefully**: `expected X, got Y` tells you what the code produced vs what was expected
2. **Add debug logging to production code first**: If the test setup looks correct, the bug is likely in production code
3. **Trace data transformations**: When IDs or values change unexpectedly, log at each transformation point
4. **Check for inconsistent code paths**: Different entry points (e.g., `installBundle` vs `updateBundle`) may use different logic
5. **Validate assumptions with real-world testing**: If possible, reproduce the issue in the actual extension before fixing

**Red flags that the bug is in production code:**
- Test fixtures match documented formats but validation fails
- Multiple test approaches fail with the same error pattern
- Error shows data transformation (e.g., `v1.0.0` → `1.0.0`) not present in test code

**Anti-pattern**: Repeatedly modifying test fixtures when the error message shows production code is transforming data incorrectly.

### Test-Driven Development (TDD)

Use TDD when it makes sense (most new functionality):
1. Write a failing test for the expected behavior
2. Write the minimum code to make it pass
3. Refactor if needed, keeping tests green

### Minimal Code Principle

- Write the **absolute minimum** code to solve the requirement
- No extras, no abstractions, no "nice-to-haves"
- Every line must directly contribute to the solution—if it doesn't, delete it
- Prefer simple, direct implementations over clever ones

### Backward Compatibility

- **Do NOT** try to be backward compatible with changes just introduced in the same session or in the current changed files
- **For new features**: Ask the user if backward compatibility is required before proposing a design
- If backward compatibility is needed, document the migration path

### Discovery Before Design

Before implementing anything new:
1. Search for existing similar functionality (`grep -r "class.*Manager" src/`)
2. Check if utilities already exist in `src/utils/` or `test/helpers/`
3. Review tests for established patterns
4. Reuse before rewriting, consolidate before duplicating

---

## Big Picture

This is a VS Code extension (Prompt Registry) that provides a marketplace and registry for Copilot prompt bundles.

### Architecture Overview

```
src/
├── adapters/     → Source-specific implementations (GitHub, GitLab, Local, etc.)
├── commands/     → VS Code command handlers
├── services/     → Core business logic (RegistryManager, BundleInstaller, etc.)
├── storage/      → Persistent state management
├── types/        → TypeScript type definitions
├── ui/           → UI providers (Marketplace WebView, Tree View)
├── utils/        → Shared utilities
└── extension.ts  → Entry point
```

### Key Components

- **UI surface**: `src/ui/*` (Marketplace and `RegistryTreeProvider`)
- **Orchestration**: `src/services/RegistryManager.ts` (singleton) coordinates adapters, storage, and installer
- **Installation flow**: adapters produce bundle metadata/URLs → `BundleInstaller` downloads/extracts/validates → `CopilotSyncService` syncs to Copilot folders

### Key Files

| File | Purpose |
|------|---------|
| `src/services/RegistryManager.ts` | Main entrypoint, event emitters |
| `src/services/BundleInstaller.ts` | Download/extract/validate/install logic |
| `src/adapters/*` | Source implementations (github, gitlab, http, local, awesome-copilot) |
| `src/storage/RegistryStorage.ts` | Persistent paths and JSON layout |
| `src/commands/*` | Command handlers wiring UI to services |

---

## Development Workflows

### Commands

```bash
npm install                    # Install dependencies
npm run compile                # Production webpack bundle
npm run watch                  # Dev watch mode

# Testing (always prefix with LOG_LEVEL=ERROR unless debugging)
npm run test:one -- test/services/MyService.test.ts
LOG_LEVEL=ERROR npm run test:unit
LOG_LEVEL=ERROR npm test

# Capture test output for analysis
LOG_LEVEL=ERROR npm test 2>&1 | tee test.log | tail -20

npm run lint                   # ESLint
npm run package:vsix           # Create .vsix package
```

### Log Management

- Minimize context pollution: pipe long output through `tee <name>.log | tail -20`
- Analyze existing logs with `grep` before re-running tests
- When a command fails, summarize from tail output, refer to stored log for details

---

## Project Conventions

### Singletons
`RegistryManager.getInstance(context?)` requires ExtensionContext on first call. Pass `context` from `extension.ts`.

### Storage
Persistent data lives under `context.globalStorageUri.fsPath`. Use `RegistryStorage.getPaths()`.

### Bundles
Valid bundles require `deployment-manifest.yml` at root. `BundleInstaller.validateBundle` enforces id/version/name.

### Adapters
Register via `RepositoryAdapterFactory.register('type', AdapterClass)`. Implement `IRepositoryAdapter`.

### Scopes
Installs support `user` and `workspace` scopes.

### Error Handling
Use `Logger.getInstance()`. Throw errors with clear messages. Commands catch and show via VS Code notifications.

---

## Integration Points

- **Network**: Adapters use `axios`. Unit tests use `nock` for HTTP mocking.
- **File I/O**: Bundle extraction uses `adm-zip`. Clean temp directories in tests.
- **VS Code API**: Activation lifecycle, `ExtensionContext` storage URIs, event emitters.

---

## Quick Examples

### Add a new adapter
Copy `src/adapters/HttpAdapter.ts`, implement `fetchBundles()`/`getDownloadUrl()`/`validate()`, register in `RegistryManager`.

### Fix bundle validation
Update `BundleInstaller.validateBundle()` — manifest version must match bundle.version unless `'latest'`.

### Inspect installed bundles
Open extension global storage path (see `RegistryStorage.getPaths().installed`) or enable `promptregistry.enableLogging`.

---

## What to Avoid

- Don't assume OS-specific Copilot paths—use `CopilotSyncService` and `platformDetector.ts`
- Don't change activation events without updating `package.json` and tests
- Don't duplicate utilities—check `src/utils/` and `test/helpers/` first
- Don't over-engineer—solve the immediate problem only

---

## Documentation Updates

After implementing features or fixing bugs:
1. **Check if documentation needs updating** — New commands, settings, or user-facing changes require doc updates
2. **Keep documentation concise** — One clear sentence beats three vague ones
3. **Update the right file** — See [docs/AGENTS.md](docs/AGENTS.md) for file placement guidance

---

## **MANDATORY** Folder-Specific Guidance

**MANDATORY** When you plan to work in one of those folders you **MUST** read the related AGENTS.md files exist in:
- `.kiro/spec/AGENTS.md` — Guidance for creation of specifications design and tasks
- `docs/AGENTS.md` — Documentation structure and update guidelines
- `test/AGENTS.md` — Test writing patterns and helpers
- `test/e2e/AGENTS.md` — Guidance for writing e2e tests
- `src/adapters/AGENTS.md` — Adapter implementation guide
- `src/services/AGENTS.md` — Service layer patterns
