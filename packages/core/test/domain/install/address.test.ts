/**
 * Tests for domain/install/address.ts — kind-driven routing and lexical
 * containment (BR2.1, BR2.2).
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  containedJoin,
  destinationTail,
  isContainedPath,
  layoutScopeFor,
  routeForKind,
} from '../../../src/domain/install/address';

const ROUTES = {
  'prompts/': 'prompts/',
  'chat-modes/': 'agents/',
  'instructions/': 'instructions/',
  'skills/': 'skills/'
};

describe('layoutScopeFor', () => {
  it('routes repository scope through the repository layout', () => {
    expect(layoutScopeFor('repository', true)).toBe('repository');
    expect(layoutScopeFor('repository', false)).toBe('repository');
  });

  it('routes workspace scope through the repository layout when a root path exists', () => {
    expect(layoutScopeFor('workspace', true)).toBe('repository');
    expect(layoutScopeFor('workspace', false)).toBe('user');
  });

  it('routes user scope through the user layout', () => {
    expect(layoutScopeFor('user', true)).toBe('user');
  });
});

describe('routeForKind', () => {
  it('resolves a destination sub-path from the kind, not the archive directory', () => {
    expect(routeForKind('prompt', ROUTES)).toBe('prompts/');
    expect(routeForKind('chat-mode', ROUTES)).toBe('agents/');
  });

  it('returns null for a kind this target routes nowhere', () => {
    expect(routeForKind('mcp-server', ROUTES)).toBeNull();
    expect(routeForKind('playbook', ROUTES)).toBeNull();
  });

  it('matches a route key in either singular or plural directory form', () => {
    expect(routeForKind('agent', { 'agent/': 'agents/' })).toBe('agents/');
    expect(routeForKind('agent', { 'agents/': 'agents/' })).toBe('agents/');
  });
});

describe('destinationTail', () => {
  it('keeps the tree of a nested primitive under its own kind directory', () => {
    expect(destinationTail('skills/my-skill/SKILL.md', 'skill')).toBe('my-skill/SKILL.md');
  });

  it('takes only the file name when the archive nests an item elsewhere', () => {
    expect(destinationTail('vendor/third-party/review.prompt.md', 'prompt'))
      .toBe('review.prompt.md');
  });

  it('handles a root-level item', () => {
    expect(destinationTail('review.prompt.md', 'prompt')).toBe('review.prompt.md');
  });
});

describe('isContainedPath', () => {
  it('accepts a path under the root and rejects the root itself', () => {
    expect(isContainedPath('/home/u/.copilot', '/home/u/.copilot/prompts/a.md')).toBe(true);
    expect(isContainedPath('/home/u/.copilot', '/home/u/.copilot')).toBe(false);
  });

  it('rejects a sibling root that merely shares a prefix', () => {
    expect(isContainedPath('/home/u/.copilot', '/home/u/.copilot-evil/a.md')).toBe(false);
  });

  it('rejects traversal out of the root and an empty root', () => {
    expect(isContainedPath('/home/u/.copilot', '/home/u/.copilot/../../etc/passwd')).toBe(false);
    expect(isContainedPath('', '/home/u/.copilot/a.md')).toBe(false);
  });

  it('compares backslash-separated paths through the same rule', () => {
    expect(isContainedPath('C:\\Users\\u\\.copilot', 'C:\\Users\\u\\.copilot\\prompts\\a.md'))
      .toBe(true);
    expect(isContainedPath('C:\\Users\\u\\.copilot', 'C:\\Users\\u\\other\\a.md')).toBe(false);
  });
});

describe('containedJoin', () => {
  it('composes a contained destination path', () => {
    expect(containedJoin('/home/u/.copilot', 'prompts/a.md'))
      .toBe('/home/u/.copilot/prompts/a.md');
  });

  it('refuses an absolute or empty fragment', () => {
    expect(containedJoin('/home/u/.copilot', '/etc/passwd')).toBeNull();
    expect(containedJoin('/home/u/.copilot', '')).toBeNull();
    expect(containedJoin('/home/u/.copilot', 'C:/Windows/system32')).toBeNull();
  });

  it('refuses a fragment that climbs out of the root', () => {
    expect(containedJoin('/home/u/.copilot', '../evil.md')).toBeNull();
    expect(containedJoin('/home/u/.copilot', 'prompts/../../evil.md')).toBeNull();
  });

  it('resolves harmless interior traversal that stays inside the root', () => {
    expect(containedJoin('/home/u/.copilot', 'prompts/./nested/../a.md'))
      .toBe('/home/u/.copilot/prompts/a.md');
  });
});
