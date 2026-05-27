import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isRegistrySource,
  type RegistrySourceType,
} from '../../src/domain/registry/registry-source';

describe('registry-source domain', () => {
  it('accepts a complete github source', () => {
    expect(isRegistrySource({
      id: 'github-abc',
      name: 'My Repo',
      type: 'github',
      url: 'owner/repo',
      enabled: true,
      priority: 0,
      hubId: 'my-hub'
    })).toBe(true);
  });

  it('rejects missing required fields', () => {
    const base = {
      id: 'github-abc', name: 'x', type: 'github',
      url: 'owner/repo', enabled: true, priority: 0, hubId: 'h'
    };
    for (const k of ['id', 'name', 'type', 'url', 'hubId'] as const) {
      const broken = { ...base, [k]: undefined };
      expect(isRegistrySource(broken)).toBe(false);
    }
  });

  it('rejects empty hubId', () => {
    expect(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: 0, hubId: ''
    })).toBe(false);
  });

  it('rejects wrong types on numeric fields', () => {
    expect(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: '0' as unknown as number, hubId: 'h'
    })).toBe(false);
  });

  it('accepts source with optional fields', () => {
    expect(isRegistrySource({
      id: 'github-abc',
      name: 'My Repo',
      type: 'github',
      url: 'owner/repo',
      enabled: true,
      priority: 0,
      hubId: 'my-hub',
      private: true,
      token: 'secret',
      metadata: { icon: 'icon.png' },
      config: { branch: 'main' }
    })).toBe(true);
  });

  it('rejects null or undefined', () => {
    expect(isRegistrySource(null)).toBe(false);
    expect(isRegistrySource(undefined)).toBe(false);
  });

  it('rejects non-object types', () => {
    expect(isRegistrySource('string')).toBe(false);
    expect(isRegistrySource(123)).toBe(false);
    expect(isRegistrySource(true)).toBe(false);
    expect(isRegistrySource([])).toBe(false);
  });

  it('accepts all valid source types', () => {
    const validTypes: RegistrySourceType[] = [
      'github',
      'local',
      'awesome-copilot',
      'local-awesome-copilot',
      'apm',
      'local-apm',
      'skills',
      'local-skills'
    ];

    for (const type of validTypes) {
      expect(isRegistrySource({
        id: 'test-id',
        name: 'Test',
        type,
        url: 'test-url',
        enabled: true,
        priority: 0,
        hubId: 'test-hub'
      })).toBe(true);
    }
  });
});
