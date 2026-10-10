import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  AmbiguousKindRouteError,
  invertKindRoutes,
  routeToKind,
} from '../../../src/domain/primitive/route-kinds';

describe('routeToKind', () => {
  it('resolves a plural alias prefix through kind normalization', () => {
    expect(routeToKind('prompts/')).toBe('prompt');
    expect(routeToKind('instructions/')).toBe('instruction');
    expect(routeToKind('chat-modes/')).toBe('chat-mode');
  });

  it('resolves a host-specific prefix through the prefix table', () => {
    expect(routeToKind('.kiro/steering/')).toBe('steering');
    expect(routeToKind('.claude/output-styles/')).toBe('output-style');
    expect(routeToKind('.opencode/plugins/')).toBe('plugin');
  });

  it('tolerates a missing trailing slash', () => {
    expect(routeToKind('prompts')).toBe('prompt');
    expect(routeToKind('.cursor/rules')).toBe('rule');
  });

  it('returns null for a prefix it does not recognize', () => {
    expect(routeToKind('my-custom-dir/')).toBeNull();
  });
});

describe('invertKindRoutes', () => {
  it('maps each recognized key to its output directory', () => {
    const result = invertKindRoutes({
      'prompts/': 'prompts/',
      'instructions/': 'instructions/',
      'chat-modes/': 'agents/'
    });

    expect(result.byKind.get('prompt')).toBe('prompts/');
    expect(result.byKind.get('instruction')).toBe('instructions/');
    expect(result.byKind.get('chat-mode')).toBe('agents/');
    expect(result.unknownKeys).toEqual([]);
  });

  it('accepts two keys reaching one kind when they agree on the output', () => {
    // cursor's real layout: both `.cursor/agents/` and `agents/` yield `agents/`.
    const result = invertKindRoutes({ '.cursor/agents/': 'agents/', 'agents/': 'agents/' });

    expect(result.byKind.get('agent')).toBe('agents/');
  });

  it('throws when two keys reach one kind with different outputs', () => {
    expect(() => invertKindRoutes({ 'prompts/': 'prompts/', prompt: 'commands/' }))
      .toThrow(AmbiguousKindRouteError);
  });

  it('reports an unrecognized custom key instead of dropping it silently', () => {
    const result = invertKindRoutes({ 'prompts/': 'prompts/', 'team-stuff/': 'team/' });

    expect(result.byKind.get('prompt')).toBe('prompts/');
    expect(result.unknownKeys).toEqual(['team-stuff/']);
  });

  it('names the kind and both outputs in the ambiguity error', () => {
    try {
      invertKindRoutes({ 'prompts/': 'prompts/', prompt: 'commands/' });
      expect.unreachable('expected AmbiguousKindRouteError');
    } catch (error) {
      expect((error as Error).message).toContain('prompt');
      expect((error as Error).message).toContain('prompts/');
      expect((error as Error).message).toContain('commands/');
    }
  });
});
