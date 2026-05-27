/**
 * Coverage tests for domain/install/target.ts (10% → higher).
 *
 * Tests the isTarget type guard function.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isTarget,
  TARGET_TYPES,
} from '../../src/domain/install/target';

describe('isTarget type guard', () => {
  it('returns true for valid vscode target', () => {
    const target = {
      name: 'my-vscode',
      type: 'vscode' as const,
      scope: 'user' as const
    };
    expect(isTarget(target)).toBe(true);
  });

  it('returns true for valid copilot-cli target', () => {
    const target = {
      name: 'my-copilot',
      type: 'copilot-cli' as const,
      scope: 'user' as const
    };
    expect(isTarget(target)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isTarget(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isTarget('string')).toBe(false);
    expect(isTarget(123)).toBe(false);
    expect(isTarget(undefined)).toBe(false);
  });

  it('returns false for object without name', () => {
    expect(isTarget({ type: 'vscode' as const })).toBe(false);
  });

  it('returns false for object with empty name', () => {
    expect(isTarget({ name: '', type: 'vscode' as const })).toBe(false);
  });

  it('returns false for object without type', () => {
    expect(isTarget({ name: 'my-target' })).toBe(false);
  });

  it('returns false for object with invalid type', () => {
    expect(isTarget({ name: 'my-target', type: 'invalid-type' as const })).toBe(false);
  });

  it('returns false for object with invalid scope', () => {
    expect(isTarget({
      name: 'my-target',
      type: 'vscode' as const,
      scope: 'invalid-scope' as const
    })).toBe(false);
  });

  it('returns true for valid repository scope', () => {
    const target = {
      name: 'my-repo-target',
      type: 'vscode' as const,
      scope: 'repository' as const,
      workspaceRoot: '/path/to/repo'
    };
    expect(isTarget(target)).toBe(true);
  });

  it('returns false for invalid commitMode', () => {
    expect(isTarget({
      name: 'my-target',
      type: 'vscode' as const,
      scope: 'repository' as const,
      commitMode: 'invalid-mode' as const
    })).toBe(false);
  });

  it('returns true for valid commitMode', () => {
    const target = {
      name: 'my-target',
      type: 'vscode' as const,
      scope: 'repository' as const,
      commitMode: 'commit' as const
    };
    expect(isTarget(target)).toBe(true);
  });

  it('returns true for local-only commitMode', () => {
    const target = {
      name: 'my-target',
      type: 'vscode' as const,
      scope: 'repository' as const,
      commitMode: 'local-only' as const
    };
    expect(isTarget(target)).toBe(true);
  });

  it('accepts all TARGET_TYPES', () => {
    for (const type of TARGET_TYPES) {
      const target = {
        name: `test-${type}`,
        type: type,
        scope: 'user' as const
      };
      expect(isTarget(target)).toBe(true);
    }
  });
});
