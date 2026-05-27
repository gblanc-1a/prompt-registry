/**
 * Coverage tests for domain/bundle/id.ts.
 *
 * Tests the generateBundleId function.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  generateBundleId,
} from '../../src/domain/bundle/id';

describe('generateBundleId', () => {
  it('generates canonical bundle ID with slash separator', () => {
    const result = generateBundleId('owner/repo', 'my-collection', '1.0.0');
    expect(result).toBe('owner-repo-my-collection-v1.0.0');
  });

  it('generates canonical bundle ID with hyphen separator', () => {
    const result = generateBundleId('owner-repo', 'my-collection', '1.0.0');
    expect(result).toBe('owner-repo-my-collection-v1.0.0');
  });

  it('preserves version format', () => {
    const result = generateBundleId('owner/repo', 'my-collection', '2.3.1');
    expect(result).toBe('owner-repo-my-collection-v2.3.1');
  });

  it('handles complex collection IDs', () => {
    const result = generateBundleId('owner/repo', 'my-awesome-collection', '1.0.0');
    expect(result).toBe('owner-repo-my-awesome-collection-v1.0.0');
  });

  it('handles multi-slug repos', () => {
    const result = generateBundleId('org/sub-org/repo', 'collection', '1.0.0');
    expect(result).toBe('org-sub-org-repo-collection-v1.0.0');
  });
});
