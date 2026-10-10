import * as path from 'node:path';
import type {
  Target,
} from '@ai-primitives-hub/core';
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

  it('records user scope explicitly when the target carries none', async () => {
    const { scope: _omitted, ...withoutScope } = userTarget;

    const placement = await buildPlacementContext(ctxWith({ HOME: '/home/u' }), withoutScope as Target);

    expect(placement.scope).toBe('user');
  });

  it.each(['repository', 'workspace', 'bogus'])('refuses to build a placement for scope "%s"', async (scope) => {
    const refused: string = scope;

    await expect(buildPlacementContext(ctxWith({ HOME: '/home/u' }), { ...userTarget, scope: refused } as Target))
      .rejects.toMatchObject({ code: 'BUNDLE.UNSUPPORTED_SCOPE' });
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
  it.each(['repository', 'workspace', 'bogus'])('refuses scope "%s" with BUNDLE.UNSUPPORTED_SCOPE naming the scope and slice 3', (scope) => {
    const refused: string = scope;
    const target = { ...userTarget, scope: refused, rootPath: '/work' } as Target;

    expect(() => assertUnifiedDeploySupported(target)).toThrow(expect.objectContaining({
      code: 'BUNDLE.UNSUPPORTED_SCOPE',
      message: expect.stringContaining(`scope "${scope}"`),
      hint: expect.stringContaining('AI_PRIMITIVES_HUB_UNIFIED_DEPLOY')
    }));
    expect(() => assertUnifiedDeploySupported(target)).toThrow(/slice 3/);
  });

  it('reads an absent scope as user, as the legacy path does', () => {
    const { scope: _omitted, ...withoutScope } = userTarget;

    expect(() => assertUnifiedDeploySupported(withoutScope as Target)).not.toThrow();
  });

  it('accepts a user-scope target', () => {
    expect(() => assertUnifiedDeploySupported(userTarget)).not.toThrow();
  });

  it('names the calling command in the refusal', () => {
    const target = { ...userTarget, scope: 'repository', rootPath: '/work' } as Target;

    expect(() => assertUnifiedDeploySupported(target, 'uninstall')).toThrow(/^uninstall: scope "repository"/);
    expect(() => assertUnifiedDeploySupported(target)).toThrow(/^install: scope "repository"/);
  });

  it('refuses repository scope with a message naming the next slice', () => {
    expect(() => assertUnifiedDeploySupported({ ...userTarget, scope: 'repository', rootPath: '/work' }))
      .toThrow(/repository scope .*not yet supported|unifiedDeploy/i);
  });
});
