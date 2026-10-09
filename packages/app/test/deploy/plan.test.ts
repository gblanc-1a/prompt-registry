import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createGovernedReleaseArchive,
} from '../../../core/test/fixtures/release-archives';
import {
  planDeploy,
} from '../../src/deploy/plan';

const rejectOnWrite = (label: string) => () => {
  throw new Error(`planDeploy must not write (${label})`);
};

/**
 * Ports that reject every mutation, per §10: a dry-run guarantee is
 * asserted by injecting ports that refuse to mutate, not by checking
 * that an output file is absent.
 * @param files
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
    localFile: '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json',
    legacyFiles: []
  }
});

const LOCAL_FILE = '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json';

/**
 * Seed a v3 local file holding one materialization record.
 * @param files
 */
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
    const plan = await planDeploy(request(), readOnlyPorts(new Map()));

    expect(plan.destinations).toEqual([
      { kind: 'prompt', from: 'prompts/hello.prompt.md', to: '/home/u/.copilot/prompts/hello.prompt.md' }
    ]);
    expect(plan.collisions).toEqual([]);
    expect(plan.satisfied).toEqual([]);
  });

  it('reports an untracked pre-existing destination as a collision, not drift', async () => {
    const files = new Map([['/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n']]);

    const plan = await planDeploy(request(), readOnlyPorts(files));

    expect(plan.collisions).toEqual([
      { to: '/home/u/.copilot/prompts/hello.prompt.md', reason: 'untracked-existing' }
    ]);
    expect(plan.drifted).toEqual([]);
  });

  it('reports an untracked but byte-identical destination as satisfied, not a collision', async () => {
    // §9.3: the retry-after-a-failed-state-write case is a no-op.
    const files = new Map([['/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n']]);

    const plan = await planDeploy(request(), readOnlyPorts(files));

    expect(plan.satisfied).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(plan.collisions).toEqual([]);
  });

  it('classifies directory-shaped kinds using existence only', async () => {
    // skill/plugin/power are directory kinds; planDeploy must not call
    // readFileBytes on them (which would be EISDIR).
    // Use legacy manifest format to avoid full governed validation.
    const skillManifest = `id: skills
version: 1.0.0
name: Skills
prompts:
  - id: my-skill
    file: skills/my-skill/SKILL.md
    tags: [skill]`;
    const skillArchive = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode(skillManifest)],
      ['skills/my-skill/SKILL.md', new TextEncoder().encode('# My Skill\n')]
    ]);
    const skillRequest = {
      ...request(),
      files: skillArchive,
      placement: {
        ...request().placement,
        resolvedLayout: {
          baseDir: '${HOME}/.copilot',
          kindRoutes: { 'skills/': 'skills/' },
          skipPaths: ['deployment-manifest.yml']
        }
      }
    };
    const files = new Map();

    const plan = await planDeploy(skillRequest, readOnlyPorts(files));

    expect(plan.destinations).toEqual([
      { kind: 'skill', from: 'skills/my-skill/SKILL.md', to: '/home/u/.copilot/skills/my-skill' }
    ]);
    expect(plan.collisions).toEqual([]);
  });

  it('reports drift when a tracked file no longer matches its installedChecksum', async () => {
    // Drift is a materialization fact, so it is read from the local file
    // only — the planner never needs the desired half to answer this.
    // Use the hash of the source bytes so only the correct comparison passes.
    const sourceHash = '4dd400c307f4ce1d359cd24c3af26d5ac348a7c3fe0f3fd0beabdf4d582ce67a';
    const files = new Map([
      ['/home/u/.copilot/prompts/hello.prompt.md', '# edited by the user\n'],
      [LOCAL_FILE, seedLocal([{ path: 'prompts/hello.prompt.md', installedChecksum: sourceHash }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files));

    expect(plan.drifted).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(plan.collisions).toEqual([]);
  });

  it('reports a tracked file that has disappeared as missing', async () => {
    const files = new Map([
      [LOCAL_FILE, seedLocal([{ path: 'prompts/gone.prompt.md', installedChecksum: 'a'.repeat(64) }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files));

    expect(plan.missing).toEqual(['/home/u/.copilot/prompts/gone.prompt.md']);
  });

  it('plans from the local file alone when the desired half is absent', async () => {
    // §8.4's legal intermediate state: local written, desired not yet.
    const files = new Map([
      ['/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n'],
      [LOCAL_FILE, seedLocal([{ path: 'prompts/hello.prompt.md', installedChecksum: 'notthehash' }])]
    ]);

    const plan = await planDeploy(request(), readOnlyPorts(files));

    expect(plan.drifted).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
  });

  it('carries an empty MCP section — MCP joins shared deploy in slice 7', async () => {
    const plan = await planDeploy(request(), readOnlyPorts(new Map()));

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
