import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DEFAULT_LOCAL_HUB_ID,
  isHubConfig,
  isHubReference,
  sanitizeHubId,
} from '../../src/domain/registry/hub-config';

describe('hub-config domain', () => {
  describe('sanitizeHubId', () => {
    it('lowercases and replaces non-alnum with single dash', () => {
      expect(sanitizeHubId('My_Hub Name!')).toBe('my-hub-name');
    });
    it('strips leading/trailing dashes', () => {
      expect(sanitizeHubId('---abc---')).toBe('abc');
    });
    it('throws on empty-after-sanitize', () => {
      expect(() => sanitizeHubId('!!!')).toThrow(/empty after sanitization/);
    });
    it('throws on >64 chars', () => {
      expect(() => sanitizeHubId('a'.repeat(65))).toThrow(/>64 chars/);
    });
  });

  describe('DEFAULT_LOCAL_HUB_ID', () => {
    it('is the literal "default-local"', () => {
      expect(DEFAULT_LOCAL_HUB_ID).toBe('default-local');
    });
    it('survives sanitizeHubId round-trip', () => {
      expect(sanitizeHubId(DEFAULT_LOCAL_HUB_ID)).toBe(DEFAULT_LOCAL_HUB_ID);
    });
  });

  describe('isHubReference', () => {
    it('accepts the three reserved types', () => {
      for (const type of ['github', 'local', 'url'] as const) {
        expect(isHubReference({ type, location: 'x' })).toBe(true);
      }
    });
    it('rejects unknown type', () => {
      expect(isHubReference({ type: 'ftp', location: 'x' })).toBe(false);
    });
    it('rejects empty location', () => {
      expect(isHubReference({ type: 'github', location: '' })).toBe(false);
    });
    it('rejects non-objects', () => {
      expect(isHubReference(null)).toBe(false);
      expect(isHubReference('github://x')).toBe(false);
    });
  });

  describe('isHubConfig', () => {
    const minimal = {
      version: '1.0.0',
      metadata: { name: 'h', description: 'd', maintainer: 'm', updatedAt: 'now' },
      sources: [],
      profiles: []
    };
    it('accepts a minimal valid config', () => {
      expect(isHubConfig(minimal)).toBe(true);
    });
    it('rejects missing arrays', () => {
      expect(isHubConfig({ ...minimal, sources: undefined })).toBe(false);
      expect(isHubConfig({ ...minimal, profiles: 'oops' })).toBe(false);
    });
    it('rejects missing version/metadata', () => {
      expect(isHubConfig({ ...minimal, version: 1 as unknown as string })).toBe(false);
      expect(isHubConfig({ ...minimal, metadata: null })).toBe(false);
    });
  });
});
