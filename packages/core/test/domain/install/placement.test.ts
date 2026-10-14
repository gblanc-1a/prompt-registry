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
    // Filter by 'steering', which has no route in vscodeUserContext, so items
    // of other kinds are 'filtered' (not 'unsupported-by-target') only if
    // allowedKinds is checked before the route lookup.
    const { items } = normalizeManifestItems(governed);

    const { destinations, skipped } = resolveDestinations(items, {
      ...vscodeUserContext,
      allowedKinds: ['steering']
    });

    expect(destinations).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['filtered', 'filtered', 'filtered']);
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
