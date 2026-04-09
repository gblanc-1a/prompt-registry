import * as assert from 'node:assert';
import * as path from 'node:path';

// The analyzer uses CommonJS (it's a Node.js script).

const { analyzeMethods } = require(path.join(process.cwd(), 'scripts', 'dead-methods-analyzer.ts'));

interface Finding {
  name: string;
  className?: string;
  interfaceName?: string;
  callerCount: number;
  selfCallOnly: boolean;
}

interface DeadType {
  name: string;
  filePath: string;
  kind: string;
  reason: string;
}

interface AnalysisResult {
  findings: Finding[];
  suppressedFindings: Finding[];
  deadTypes: DeadType[];
  stats: Record<string, number>;
}

const MINIMAL_CONFIG = {
  frameworkMethods: ['dispose', 'constructor'],
  suppressions: [],
  ignorePatterns: []
};

function findingKey(f: Finding): string {
  const owner = f.className || f.interfaceName || '';
  return `${owner}.${f.name}`;
}

suite('Dead Methods Analyzer', () => {
  const fixturesDir = path.join(process.cwd(), 'test', 'scripts', 'fixtures');

  suite('Optional chaining detection', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'fp-optional-chaining');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag methods called via optional chaining as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('Manager.deleteAllData'),
        'deleteAllData is called via ?. and should not be flagged');
      assert.ok(!deadNames.includes('Manager.setActive'),
        'setActive is called via ?. and should not be flagged');
    });

    test('should still flag truly dead methods as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('Manager.neverCalled'),
        'neverCalled is never called and should be flagged');
    });
  });

  suite('Duck-type cast detection', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'fp-duck-type-cast');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag methods called after as-any cast with typeof guard as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('SpecialAdapter.getSpecialName'),
        'getSpecialName is called via as-any cast and should not be flagged');
      assert.ok(!deadNames.includes('SpecialAdapter.getSpecialPath'),
        'getSpecialPath is called via as-any cast and should not be flagged');
    });

    test('should still flag truly dead methods on the same class as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('SpecialAdapter.trulyDead'),
        'trulyDead is never called and should be flagged');
    });
  });

  // ── Real-world dead code patterns ──────────────────────────────────────

  suite('Dead interface methods with implementations (models getStatus/ScopeStatus)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'tp-dead-interface-methods');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should flag interface method getStatus() as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('IScopeService.getStatus'),
        'IScopeService.getStatus is never called and should be flagged');
    });

    test('should flag UserScopeService.getStatus() implementation as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('UserScopeService.getStatus'),
        'UserScopeService.getStatus is never called and should be flagged');
    });

    test('should flag RepositoryScopeService.getStatus() implementation as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('RepositoryScopeService.getStatus'),
        'RepositoryScopeService.getStatus is never called and should be flagged');
    });

    test('should NOT flag live interface method syncBundle()', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('IScopeService.syncBundle'),
        'syncBundle is called via interface and should not be flagged');
    });

    test('should flag ScopeStatus type as dead (only consumed by dead getStatus)', () => {
      const deadTypeNames = result.deadTypes.map((t: DeadType) => t.name);
      assert.ok(deadTypeNames.includes('ScopeStatus'),
        'ScopeStatus is only used in dead getStatus() and should be flagged');
    });
  });

  suite('Dead standalone class methods (models syncAllBundles/cleanAll/etc.)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'tp-dead-class-methods');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should flag syncAllBundles() as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('UserScopeService.syncAllBundles'),
        'syncAllBundles is never called externally and should be flagged');
    });

    test('should flag cleanAll() as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('UserScopeService.cleanAll'),
        'cleanAll is never called externally and should be flagged');
    });

    test('should flag getSkillsStatus() as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('UserScopeService.getSkillsStatus'),
        'getSkillsStatus is never called and should be flagged');
    });

    test('should flag addLocalLockfileToGitExclude() as dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('RepositoryScopeService.addLocalLockfileToGitExclude'),
        'addLocalLockfileToGitExclude is never called and should be flagged');
    });

    test('should NOT flag live methods syncBundle() and unsyncBundle()', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('UserScopeService.syncBundle'),
        'syncBundle is called by consumer and should not be flagged');
      assert.ok(!deadNames.includes('UserScopeService.unsyncBundle'),
        'unsyncBundle is called by consumer and should not be flagged');
      assert.ok(!deadNames.includes('RepositoryScopeService.syncBundle'),
        'syncBundle is called by consumer and should not be flagged');
    });

    test('should flag dead methods as zero-callers even if they call other methods internally', () => {
      // syncAllBundles calls this.syncBundle and cleanAll calls this.unsyncBundle,
      // but syncAllBundles/cleanAll themselves are never called from anywhere.
      // The analyzer tracks callers OF the method, not calls FROM the method.
      const zeroCaller = result.findings.filter((f: Finding) => !f.selfCallOnly && f.callerCount === 0);
      const zeroCallerNames = zeroCaller.map((f) => findingKey(f));
      assert.ok(zeroCallerNames.includes('UserScopeService.syncAllBundles'),
        'syncAllBundles is never called and should be zero-callers');
      assert.ok(zeroCallerNames.includes('UserScopeService.cleanAll'),
        'cleanAll is never called and should be zero-callers');
    });
  });

  suite('Effectively dead via default parameters (models getClaudeSkillsDirectory)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'tp-effectively-dead-defaults');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag getClaudeSkillsDirectory — reachable via syncSkill/unsyncSkill callers', () => {
      // getClaudeSkillsDirectory() is called inside syncSkill/unsyncSkill in the same file.
      // syncSkill/unsyncSkill are called externally from consumer.ts, so
      // getClaudeSkillsDirectory is reachable through the self-call chain.
      // Note: in practice, the code path is never taken (syncToClaude defaults to false),
      // but detecting that would require data-flow analysis, not just call-graph analysis.
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('UserScopeService.getClaudeSkillsDirectory'),
        'getClaudeSkillsDirectory is reachable via externally-called syncSkill/unsyncSkill');
    });

    test('should flag syncSkill and unsyncSkill as self-call-only since no external callers in src/', () => {
      // syncSkill and unsyncSkill are called from consumer.ts (a different file),
      // so they should NOT be flagged
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('UserScopeService.syncSkill'),
        'syncSkill is called from consumer.ts and should not be flagged');
      assert.ok(!deadNames.includes('UserScopeService.unsyncSkill'),
        'unsyncSkill is called from consumer.ts and should not be flagged');
    });

    test('should NOT flag getCopilotSkillsDirectory (has external callers)', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('UserScopeService.getCopilotSkillsDirectory'),
        'getCopilotSkillsDirectory is called from consumer and should not be flagged');
    });
  });

  suite('Unrelated method name collision (models getStatus vs ApmRuntimeManager)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'tp-unrelated-method-name-collision');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should flag IScopeService.getStatus() as dead despite unrelated RuntimeManager.getStatus() calls', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('IScopeService.getStatus'),
        'IScopeService.getStatus is never called via scope types and should be flagged');
    });

    test('should flag UserScopeService.getStatus() despite unrelated getStatus() calls elsewhere', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('UserScopeService.getStatus'),
        'UserScopeService.getStatus is never called — RuntimeManager.getStatus() is unrelated');
    });

    test('should flag RepositoryScopeService.getStatus() despite unrelated getStatus() calls elsewhere', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('RepositoryScopeService.getStatus'),
        'RepositoryScopeService.getStatus is never called — RuntimeManager.getStatus() is unrelated');
    });

    test('should NOT flag RuntimeManager.getStatus() (has real callers)', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('RuntimeManager.getStatus'),
        'RuntimeManager.getStatus is called from consumer and should not be flagged');
    });

    test('should NOT flag live syncBundle() methods', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('IScopeService.syncBundle'),
        'syncBundle is called via interface and should not be flagged');
      assert.ok(!deadNames.includes('UserScopeService.syncBundle'),
        'syncBundle is called and should not be flagged');
      assert.ok(!deadNames.includes('RepositoryScopeService.syncBundle'),
        'syncBundle is called and should not be flagged');
    });

    test('should flag ScopeStatus type as dead (only consumed by dead getStatus)', () => {
      const deadTypeNames = result.deadTypes.map((t: DeadType) => t.name);
      assert.ok(deadTypeNames.includes('ScopeStatus'),
        'ScopeStatus is only used in dead getStatus() and should be flagged');
    });
  });

  // ── False positive: Inheritance call ─────────────────────────────────────

  suite('Inheritance call detection (method on parent, called via subclass)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'fp-inheritance-call');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag installWithProgress — called via subclass NpmCliWrapper', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('CliWrapper.installWithProgress'),
        'installWithProgress is called via NpmCliWrapper (subclass) and should not be flagged');
    });

    test('should still flag installInTerminal — never called via any path', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('CliWrapper.installInTerminal'),
        'installInTerminal is never called and should be flagged');
    });
  });

  // ── False positive: Self-call reachability ───────────────────────────────

  suite('Self-call reachability (internal helper called by externally-reachable method)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'fp-self-call-reachable');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag validate — called by process() which has external callers', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('Manager.validate'),
        'validate is called by externally-reachable process() and should not be flagged');
    });

    test('should NOT flag transform — called by process() which has external callers', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('Manager.transform'),
        'transform is called by externally-reachable process() and should not be flagged');
    });

    test('should NOT flag formatOutput — transitively reachable via transform() → process()', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('Manager.formatOutput'),
        'formatOutput is transitively reachable via transform() → process() and should not be flagged');
    });

    test('should still flag trulyDeadMethod — no callers at all', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('Manager.trulyDeadMethod'),
        'trulyDeadMethod is never called and should be flagged');
    });

    test('should still flag deadHelper — caller is also dead (transitively dead)', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('Manager.deadHelper'),
        'deadHelper is called only by dead trulyDeadMethod and should still be flagged');
    });
  });

  // ── False positive: Constructor call ─────────────────────────────────────

  suite('Constructor call detection (method called from constructor)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'fp-constructor-call');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should NOT flag registerCommands — called from constructor of externally-instantiated class', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('HubCommands.registerCommands'),
        'registerCommands is called from constructor and class is externally instantiated');
    });

    test('should still flag trulyDeadMethod — not called from constructor or anywhere', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('HubCommands.trulyDeadMethod'),
        'trulyDeadMethod is never called and should be flagged');
    });
  });

  // ── True positive: Transitively dead ─────────────────────────────────────

  suite('Transitively dead methods (self-call-only where caller is also dead)', () => {
    let result: AnalysisResult;

    suiteSetup(() => {
      const fixturePath = path.join(fixturesDir, 'tp-transitively-dead');
      result = analyzeMethods(MINIMAL_CONFIG, fixturePath);
    });

    test('should flag isDirectory as dead (zero external callers)', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('FileUtils.isDirectory'),
        'isDirectory has zero external callers and should be flagged');
    });

    test('should flag ensureDirectory as dead (zero external callers)', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('FileUtils.ensureDirectory'),
        'ensureDirectory has zero external callers and should be flagged');
    });

    test('should flag exists as dead — all callers (isDirectory, ensureDirectory) are also dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('FileUtils.exists'),
        'exists is transitively dead — all its callers are also dead');
    });

    test('should flag getStats as dead — caller (isDirectory) is also dead', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(deadNames.includes('FileUtils.getStats'),
        'getStats is transitively dead — its caller isDirectory is also dead');
    });

    test('should NOT flag readJson — has external callers', () => {
      const deadNames = result.findings.map((f) => findingKey(f));
      assert.ok(!deadNames.includes('FileUtils.readJson'),
        'readJson is called from consumer and should not be flagged');
    });
  });
});
