import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  generateBundleId,
} from '../../src/domain/bundle/id';

describe('generateBundleId', () => {
  it('should generate bundle ID with slash-separated repo slug', () => {
    const result = generateBundleId('owner/repo', 'my-collection', '1.0.0');
    expect(result).toBe('owner-repo-my-collection-v1.0.0');
  });

  it('should generate bundle ID with hyphen-separated repo slug', () => {
    const result = generateBundleId('owner-repo', 'my-collection', '1.0.0');
    expect(result).toBe('owner-repo-my-collection-v1.0.0');
  });

  it('should handle different versions', () => {
    expect(generateBundleId('owner/repo', 'collection', '2.0.0')).toBe('owner-repo-collection-v2.0.0');
    expect(generateBundleId('owner/repo', 'collection', '0.1.0')).toBe('owner-repo-collection-v0.1.0');
  });

  it('should handle complex collection IDs', () => {
    const result = generateBundleId('org/my-repo', 'my-awesome-collection', '1.2.3');
    expect(result).toBe('org-my-repo-my-awesome-collection-v1.2.3');
  });
});
