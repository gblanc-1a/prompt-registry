/**
 * Coverage tests for domain/collection/validate.ts (41.89% → higher).
 *
 * Tests all validation functions: validateCollectionId, validateVersion,
 * validateItemKind, normalizeRepoRelativePath, isSafeRepoRelativePath,
 * validateCollectionObject.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DEFAULT_VALIDATION_RULES,
  isSafeRepoRelativePath,
  normalizeRepoRelativePath,
  validateCollectionId,
  validateCollectionObject,
  validateItemKind,
  validateVersion,
} from '../../src/domain/collection/validate';

describe('validateCollectionId', () => {
  it('accepts valid collection ID', () => {
    expect(validateCollectionId('my-collection')).toEqual({ valid: true });
    expect(validateCollectionId('test-123')).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    const result = validateCollectionId('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects non-string', () => {
    const result = validateCollectionId(null as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects ID exceeding max length', () => {
    const longId = 'a'.repeat(101);
    const result = validateCollectionId(longId);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at most 100');
  });

  it('rejects ID with invalid characters', () => {
    expect(validateCollectionId('My_Collection').valid).toBe(false);
    expect(validateCollectionId('my.collection').valid).toBe(false);
    expect(validateCollectionId('my collection').valid).toBe(false);
  });
});

describe('validateVersion', () => {
  it('accepts valid semantic version', () => {
    expect(validateVersion('1.0.0')).toEqual({ valid: true, normalized: '1.0.0' });
    expect(validateVersion('2.3.1')).toEqual({ valid: true, normalized: '2.3.1' });
  });

  it('uses default version when undefined', () => {
    expect(validateVersion(undefined)).toEqual({ valid: true, normalized: '1.0.0' });
  });

  it('uses default version when null', () => {
    expect(validateVersion(null)).toEqual({ valid: true, normalized: '1.0.0' });
  });

  it('rejects non-string version', () => {
    const result = validateVersion(123 as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must be a string');
  });

  it('rejects invalid version format', () => {
    expect(validateVersion('v1.0.0').valid).toBe(false);
    expect(validateVersion('1.0').valid).toBe(false);
    expect(validateVersion('1.0.0.0').valid).toBe(false);
  });
});

describe('validateItemKind', () => {
  it('accepts valid item kinds', () => {
    expect(validateItemKind('prompt')).toEqual({ valid: true });
    expect(validateItemKind('instruction')).toEqual({ valid: true });
    expect(validateItemKind('agent')).toEqual({ valid: true });
    expect(validateItemKind('skill')).toEqual({ valid: true });
  });

  it('accepts uppercase kinds (normalizes)', () => {
    expect(validateItemKind('PROMPT')).toEqual({ valid: true });
    expect(validateItemKind('Agent')).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    const result = validateItemKind('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects non-string', () => {
    const result = validateItemKind(null as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  it('rejects deprecated kind chatmode', () => {
    const result = validateItemKind('chatmode');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('deprecated');
    expect(result.replacement).toBe('agent');
  });

  it('rejects deprecated kind chat-mode', () => {
    const result = validateItemKind('chat-mode');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('deprecated');
    expect(result.replacement).toBe('agent');
  });

  it('rejects invalid kind', () => {
    const result = validateItemKind('invalid-kind');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid item kind');
  });
});

describe('normalizeRepoRelativePath', () => {
  it('normalizes simple paths', () => {
    expect(normalizeRepoRelativePath('prompts')).toBe('prompts');
    expect(normalizeRepoRelativePath('skills/my-skill')).toBe('skills/my-skill');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeRepoRelativePath('skills\\my-skill')).toBe('skills/my-skill');
  });

  it('removes leading slash', () => {
    expect(normalizeRepoRelativePath('/prompts')).toBe('prompts');
  });

  it('trims whitespace', () => {
    expect(normalizeRepoRelativePath('  prompts  ')).toBe('prompts');
  });

  it('throws on empty string', () => {
    expect(() => normalizeRepoRelativePath('')).toThrow('non-empty');
  });

  it('throws on non-string', () => {
    expect(() => normalizeRepoRelativePath(null as unknown as string)).toThrow('non-empty');
  });

  it('throws on path traversing outside repo', () => {
    expect(() => normalizeRepoRelativePath('../outside')).toThrow('outside repo');
    expect(() => normalizeRepoRelativePath('..')).toThrow('outside repo');
  });
});

describe('isSafeRepoRelativePath', () => {
  it('returns true for safe paths', () => {
    expect(isSafeRepoRelativePath('prompts')).toBe(true);
    expect(isSafeRepoRelativePath('skills/my-skill')).toBe(true);
  });

  it('returns true for absolute paths (normalized to relative)', () => {
    expect(isSafeRepoRelativePath('/prompts')).toBe(true);
  });

  it('returns false for unsafe paths', () => {
    expect(isSafeRepoRelativePath('../outside')).toBe(false);
    expect(isSafeRepoRelativePath('')).toBe(false);
  });
});

describe('validateCollectionObject', () => {
  it('accepts valid minimal collection', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ path: 'prompts/hello.md', kind: 'prompt' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts valid collection with version', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      version: '1.0.0',
      items: [{ path: 'prompts/hello.md', kind: 'prompt' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(true);
  });

  it('rejects non-object', () => {
    const result = validateCollectionObject(null, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: YAML did not parse to an object');
  });

  it('rejects missing id', () => {
    const collection = {
      name: 'My Collection',
      items: []
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: Missing required field: id');
  });

  it('rejects invalid id', () => {
    const collection = {
      id: 'Invalid_ID',
      name: 'My Collection',
      items: []
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
  });

  it('rejects missing name', () => {
    const collection = {
      id: 'my-collection',
      items: []
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: Missing required field: name');
  });

  it('rejects invalid version', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      version: 'invalid',
      items: []
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
  });

  it('rejects missing items array', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection'
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: Missing required field: items (array)');
  });

  it('rejects non-array items', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: 'not-an-array'
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
  });

  it('rejects item without path', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ kind: 'prompt' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: items[0]: Missing required field: path');
  });

  it('rejects item with invalid path', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ path: '../outside', kind: 'prompt' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
  });

  it('rejects item without kind', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ path: 'prompts/hello.md' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('test: items[0]: Missing required field: kind');
  });

  it('rejects item with deprecated kind', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ path: 'prompts/hello.md', kind: 'chatmode' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('deprecated'))).toBe(true);
  });

  it('rejects item with invalid kind', () => {
    const collection = {
      id: 'my-collection',
      name: 'My Collection',
      items: [{ path: 'prompts/hello.md', kind: 'invalid-kind' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
  });

  it('collects multiple errors', () => {
    const collection = {
      id: 'Invalid_ID',
      items: [{ path: '../outside', kind: 'invalid-kind' }]
    };
    const result = validateCollectionObject(collection, 'test');
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('DEFAULT_VALIDATION_RULES', () => {
  it('has expected structure', () => {
    expect(DEFAULT_VALIDATION_RULES.collectionId).toBeDefined();
    expect(DEFAULT_VALIDATION_RULES.collectionId.maxLength).toBe(100);
    expect(DEFAULT_VALIDATION_RULES.version).toBeDefined();
    expect(DEFAULT_VALIDATION_RULES.itemKinds).toContain('prompt');
    expect(DEFAULT_VALIDATION_RULES.deprecatedKinds).toHaveProperty('chatmode');
  });
});
