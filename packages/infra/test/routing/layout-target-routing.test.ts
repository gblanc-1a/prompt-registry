/**
 * Tests for routing/layout-target-routing.ts — the TargetRoutingPort.
 *
 * Containment and symbolic-link refusal are exercised against a fake path
 * inspector, so each case states exactly which filesystem shape it describes
 * (BR2.1, BR2.2, BR2.3, NFR1.1.1).
 */
import type {
  PathInspector,
  Target,
  TargetLayout,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  LayoutTargetRouting,
} from '../../src/routing/layout-target-routing';

const USER_LAYOUT: TargetLayout = {
  baseDir: '${HOME}/.copilot',
  kindRoutes: { 'prompts/': 'prompts/', 'chat-modes/': 'agents/', 'skills/': 'skills/' }
};

const REPOSITORY_LAYOUT: TargetLayout = {
  baseDir: '/repo/.github',
  kindRoutes: { 'prompts/': 'prompts/' }
};

const target = (overrides: Partial<Target> = {}): Target => ({
  name: 'copilot',
  type: 'vscode',
  scope: 'user',
  ...overrides
});

interface InspectorShape {
  readonly realPaths?: Record<string, string>;
  readonly symbolicLinks?: readonly string[];
}

const inspector = (shape: InspectorShape = {}): PathInspector => ({
  realPath: async (path) => shape.realPaths?.[path] ?? null,
  isSymbolicLink: async (path) => shape.symbolicLinks?.includes(path) ?? false
});

const routing = (
  layout: TargetLayout | null,
  shape: InspectorShape = {},
  layoutScopeSink?: string[]
): LayoutTargetRouting => new LayoutTargetRouting({
  resolveLayout: (_target, layoutScope) => {
    layoutScopeSink?.push(layoutScope);
    return layout;
  },
  pathInspector: inspector(shape),
  env: { HOME: '/home/u' }
});

describe('LayoutTargetRouting', () => {
  it('resolves a destination from target, scope, and kind (BR2.1)', async () => {
    const result = await routing(USER_LAYOUT).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/review.prompt.md'
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.address.destinationPath).toBe('/home/u/.copilot/prompts/review.prompt.md');
      expect(result.address.destinationRoot).toBe('/home/u/.copilot');
      expect(result.address.itemKind).toBe('prompt');
    }
  });

  it('routes by kind even when the archive puts the item somewhere else', async () => {
    const result = await routing(USER_LAYOUT).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'chat-mode',
      archivePath: 'vendor/legacy/reviewer.chatmode.md'
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.address.destinationPath).toBe('/home/u/.copilot/agents/reviewer.chatmode.md');
    }
  });

  it('keeps a nested primitive tree under its kind route', async () => {
    const result = await routing(USER_LAYOUT).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'skill',
      archivePath: 'skills/my-skill/SKILL.md'
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.address.destinationPath).toBe('/home/u/.copilot/skills/my-skill/SKILL.md');
    }
  });

  it('routes repository and workspace scope through the repository layout (BR2.3)', async () => {
    const scopes: string[] = [];
    const routingWithSink = routing(REPOSITORY_LAYOUT, {}, scopes);

    await routingWithSink.resolve({
      target: target({ scope: 'repository', rootPath: '/repo' }),
      scope: 'repository',
      itemKind: 'prompt',
      archivePath: 'prompts/a.prompt.md'
    });
    await routingWithSink.resolve({
      target: target({ scope: 'workspace', rootPath: '/repo' }),
      scope: 'workspace',
      itemKind: 'prompt',
      archivePath: 'prompts/a.prompt.md'
    });
    await routingWithSink.resolve({
      target: target({ scope: 'user' }),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/a.prompt.md'
    });

    expect(scopes).toStrictEqual(['repository', 'repository', 'user']);
  });

  it('reports an unrouted kind, a missing layout, and a disallowed kind as unsupported', async () => {
    const unrouted = await routing(REPOSITORY_LAYOUT).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'skill',
      archivePath: 'skills/a/SKILL.md'
    });
    const noLayout = await routing(null).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/a.prompt.md'
    });
    const disallowed = await routing(USER_LAYOUT).resolve({
      target: target({ allowedKinds: ['prompt'] }),
      scope: 'user',
      itemKind: 'skill',
      archivePath: 'skills/a/SKILL.md'
    });

    expect(unrouted.kind).toBe('unsupported');
    expect(noLayout.kind).toBe('unsupported');
    expect(disallowed.kind).toBe('unsupported');
  });

  it('refuses a destination root that still carries an unresolved token', async () => {
    const result = await routing({ baseDir: '${MISSING}/x', kindRoutes: { 'prompts/': 'prompts/' } })
      .resolve({
        target: target(),
        scope: 'user',
        itemKind: 'prompt',
        archivePath: 'prompts/a.prompt.md'
      });

    expect(result.kind).toBe('safety-blocked');
  });

  it('refuses a destination that would escape the root', async () => {
    const result = await routing({
      baseDir: '/home/u/.copilot',
      kindRoutes: { 'prompts/': '../../etc/' }
    }).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/passwd'
    });

    expect(result.kind).toBe('safety-blocked');
    if (result.kind === 'safety-blocked') {
      expect(result.detail).toContain('would escape');
    }
  });

  it('refuses a symbolic-link component under the root, even one resolving inside it', async () => {
    const result = await routing(USER_LAYOUT, {
      realPaths: { '/home/u/.copilot': '/home/u/.copilot' },
      symbolicLinks: ['/home/u/.copilot/prompts']
    }).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/review.prompt.md'
    });

    expect(result.kind).toBe('safety-blocked');
    if (result.kind === 'safety-blocked') {
      expect(result.detail).toContain('/home/u/.copilot/prompts');
      expect(result.detail).toContain('symbolic link');
    }
  });

  it('verifies the root through its real path so the boundary is the real directory', async () => {
    const result = await routing(USER_LAYOUT, {
      realPaths: { '/home/u/.copilot': '/private/home/u/.copilot' }
    }).resolve({
      target: target(),
      scope: 'user',
      itemKind: 'prompt',
      archivePath: 'prompts/review.prompt.md'
    });

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.address.destinationRoot).toBe('/private/home/u/.copilot');
      expect(result.address.destinationPath)
        .toBe('/private/home/u/.copilot/prompts/review.prompt.md');
    }
  });
});
