---
name: dead-code-audit
description: 'Run dead code analysis, separate true dead code from false positives, improve the analyzer with TDD, and produce a cleanup plan. Use when: dead code detection, unused methods, dead method analysis, code cleanup audit, remove unused code, find unreachable code, dead code report, false positive analysis, analyzer improvement.'
argument-hint: 'Provide the dead-code command or script path, e.g. npm run dead-code:methods'
---

# Dead Code Audit

End-to-end workflow for finding, verifying, and planning removal of dead code in a TypeScript codebase.

## When to Use

- Periodic codebase hygiene audits
- Before major refactors to reduce surface area
- After feature removal to find orphaned code
- When `dead-code:methods` (or similar) reports findings that need human-level verification

## Prerequisites

- A dead code detection script (e.g., `npm run dead-code:methods` using ts-morph)
- TypeScript project with `tsconfig.json`
- Test suite with `npm test` or equivalent

## Procedure

### Phase 1 — Run the Analyzer

1. Run the dead code detection command with JSON output and save raw results:
   ```bash
   npm run dead-code:methods -- --json --show-suppressed 2>&1 | tee dead-code-analysis/raw-output.json
   ```
2. Extract clean JSON (strip npm banner lines):
   ```bash
   sed -n '/^{/,$ p' dead-code-analysis/raw-output.json > dead-code-analysis/results.json
   ```
3. Summarize: count active findings, suppressed findings, dead types, and stats.

### Phase 2 — Classify Findings (True Dead Code vs False Positives)

Split findings into batches and dispatch parallel subagents (use `Explore` agent) to verify each one.

For **zero-caller** methods, check:
- `grep -rn "\.methodName(" src/` — any production call sites?
- `grep -rn "\.methodName(" test/` — test-only usage?
- Is it called dynamically (bracket notation, string interpolation)?
- Does it implement an interface method called polymorphically?
- Is it wired via `registerCommand`, event handlers, or timers?
- Is it called through a subclass instance (inheritance)?

For **self-call-only** methods, trace the call chain:
- Find the same-file caller → is THAT caller externally reachable?
- Continue tracing upward to a production entry point or dead end.
- Check if the caller is a constructor (constructors call `this.registerX()` patterns).

Classification rules:
| Condition | Verdict |
|-----------|---------|
| Zero callers in both `src/` and `test/` | **TRUE DEAD CODE** |
| Zero callers in `src/`, has callers in `test/` | **TRUE DEAD CODE** (test-only) |
| Self-call-only but caller has external callers | **FALSE POSITIVE** |
| Self-call-only and caller is also dead | **TRUE DEAD CODE** (transitively dead) |
| Called via subclass instance (inheritance) | **FALSE POSITIVE** |
| Called from constructor of externally-instantiated class | **FALSE POSITIVE** |

Save results into two files:
- `dead-code-analysis/true-dead-code.md` — confirmed dead, with evidence
- `dead-code-analysis/false-positives.md` — false positives, with explanation of why the analyzer missed them

### Phase 3 — Improve the Analyzer (TDD)

For each category of false positive found, use Test-Driven Development:

1. **Create a minimal test fixture** in `test/scripts/fixtures/fp-<pattern-name>/`:
   - `tsconfig.json` — minimal compiler config
   - `src/<class>.ts` — the class with the method that should NOT be flagged
   - `src/consumer.ts` — an external caller that makes it reachable
   - Model after a real-world scenario found in Phase 2

2. **Write a failing test** (RED):
   ```typescript
   test('should NOT flag <method> — <reason>', () => {
     const deadNames = result.findings.map(f => findingKey(f));
     assert.ok(!deadNames.includes('ClassName.methodName'), '<explanation>');
   });
   ```

3. **Implement the fix** in the analyzer (GREEN):
   - **Inheritance**: Build child→parent class map, propagate call sites upward
   - **Self-call reachability**: After initial pass, BFS/DFS upward through same-file callers
   - **Constructor calls**: Scan constructor bodies for method calls, treat as same-file callers

4. **Verify no regressions**: Run existing tests + new tests.

Common false positive patterns and their fixes:

| Pattern | Fixture name | Fix |
|---------|-------------|-----|
| Method on parent class, called via subclass | `fp-inheritance-call` | Propagate typed call sites through `classParentMap` |
| Internal helper called by externally-reachable method | `fp-self-call-reachable` | Post-pass: BFS through `sameFileCallers` to find external reachability |
| Method called from constructor | `fp-constructor-call` | Include constructors in same-file caller scan |
| Transitively dead (caller also dead) | `tp-transitively-dead` | Reachability check returns false when all callers are in findings |

### Phase 4 — Validate

1. Re-run the analyzer: `npm run dead-code:methods`
2. Compare new findings count against Phase 2 confirmed dead count
3. Verify eliminated false positives no longer appear
4. Run full test suite: `LOG_LEVEL=ERROR npm test`

### Phase 5 — Produce Cleanup Plan

Create `dead-code-analysis/CLEANUP-PLAN.md` with:

**Priority 1 — Zero risk** (no callers anywhere):
- List each method, file, and reason
- These can be deleted with no test changes

**Priority 2 — Test-only** (callers only in test files):
- List each method, file, reason, AND which test files need updating
- Remove the method AND update/remove the corresponding tests

**Priority 3 — Broader cleanup** (entire classes/abstractions unused):
- Note cases where an entire abstraction layer is dead

Include a checklist:
- [ ] Remove Priority 1 methods
- [ ] Remove Priority 2 methods + update tests
- [ ] Remove dead types
- [ ] Remove unused imports (`npm run lint:fix`)
- [ ] Run `npm test` — verify no regressions
- [ ] Run `npm run dead-code:methods` — verify findings drop to 0

### Phase 6 — Execute Cleanup and Verify (Loop)

After producing the cleanup plan, execute the cleanup and verify no new dead code has surfaced.

1. **Dispatch a subagent** (use `Claude Haiku` agent) to execute the cleanup plan:
   - The subagent prompt MUST include the full contents of `dead-code-analysis/CLEANUP-PLAN.md`
   - Instruct the subagent to:
     - Delete all Priority 1 methods (zero callers)
     - Delete all Priority 2 methods and update/remove corresponding tests
     - Remove dead types and unused imports
     - **Delete files that have lost their purpose entirely** (e.g., a test file where all tested methods were removed, a source file where all public methods are dead). Check each modified file: if removing dead code leaves only boilerplate (imports, empty class shell, describe block with no tests), delete the whole file
     - Run `npm run lint:fix` to clean up imports and fix linting errors
     - Run `LOG_LEVEL=ERROR npm test` to verify no regressions
   - The subagent MUST report back: number of methods removed, files changed, and test results (pass/fail)

2. **Re-run the dead code analyzer**:
   ```bash
   npm run dead-code:methods -- --json --show-suppressed 2>&1 | tee dead-code-analysis/raw-output.json
   sed -n '/^{/,$ p' dead-code-analysis/raw-output.json > dead-code-analysis/results.json
   ```

3. **Evaluate results**:
   - If **new dead code is found** (removing dead methods may expose transitively dead callers that were previously reachable only through the now-removed code): **restart the entire process from Phase 1**
   - If **no dead code is found** (zero active findings): **stop — the codebase is clean**

4. **Loop constraint**: This loop runs until the analyzer reports zero active findings. Each iteration goes through the full Phase 1→6 cycle to ensure proper classification and safe removal.

## Quality Criteria

- Every "true dead code" finding has grep evidence showing zero production callers
- Every "false positive" has a clear explanation of the missed pattern
- Analyzer improvements have test fixtures modeling real-world scenarios
- All tests pass after changes (no regressions)
- Cleanup plan is actionable in a single session
- After the cleanup loop completes, the analyzer reports zero active findings
