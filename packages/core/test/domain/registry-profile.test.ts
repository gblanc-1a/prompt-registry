import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isProfile,
  isProfileBundle,
} from '../../src/domain/registry/profile';

describe('profile domain', () => {
  describe('isProfileBundle', () => {
    it('accepts a complete bundle ref', () => {
      expect(isProfileBundle({
        id: 'foo', version: '1.0.0', source: 'github-abc', required: true
      })).toBe(true);
    });
    it('rejects missing required fields', () => {
      expect(isProfileBundle({ id: 'foo', version: '1.0.0', source: 'x' })).toBe(false);
      expect(isProfileBundle({ id: 'foo', source: 'x', required: false })).toBe(false);
    });
    it('rejects empty strings', () => {
      expect(isProfileBundle({
        id: '', version: '1.0.0', source: 'x', required: false
      })).toBe(false);
    });
  });

  describe('isProfile', () => {
    it('accepts a profile with zero bundles', () => {
      expect(isProfile({ id: 'p', name: 'P', bundles: [] })).toBe(true);
    });
    it('accepts a profile with valid bundles', () => {
      expect(isProfile({
        id: 'backend',
        name: 'Backend Developer',
        bundles: [
          { id: 'foo', version: '1.0.0', source: 'github-abc', required: true },
          { id: 'bar', version: 'latest', source: 'github-def', required: false }
        ]
      })).toBe(true);
    });
    it('rejects on a bad nested bundle', () => {
      expect(isProfile({
        id: 'p', name: 'P',
        bundles: [{ id: 'foo' } as any]
      })).toBe(false);
    });
    it('rejects empty id/name', () => {
      expect(isProfile({ id: '', name: 'P', bundles: [] })).toBe(false);
      expect(isProfile({ id: 'p', name: '', bundles: [] })).toBe(false);
    });
  });
});
