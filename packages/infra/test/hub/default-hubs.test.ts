/**
 * Tests for infra/hub/default-hubs.ts — the single source of truth for the
 * default hubs offered to both delivery layers.
 */
import type {
  HubReference,
  LogEvent,
} from '@ai-primitives-hub/core';
import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  clearCache,
  getDefaultHubs,
  getEnabledDefaultHubs,
  getRecommendedHub,
  isDefaultHub,
  isRecommendedDefaultHub,
} from '../../src/hub/default-hubs';
import {
  resolveDefaultHubs,
} from '../../src/hub/default-hubs-config';

function reference(overrides: Partial<HubReference> = {}): HubReference {
  return {
    type: 'github',
    location: 'Amadeus-xDLC/genai.prompt-registry-config',
    ref: 'main',
    ...overrides
  };
}

describe('default hubs configuration', () => {
  beforeEach(() => {
    clearCache();
  });

  it('offers at least one enabled hub', () => {
    expect(getEnabledDefaultHubs().length).toBeGreaterThan(0);
  });

  it('reports the selected source once when initializing the cache', () => {
    const logs: LogEvent[] = [];

    getDefaultHubs((event) => logs.push(event));
    getDefaultHubs((event) => logs.push(event));

    expect(logs).toEqual([{
      level: 'debug',
      message: 'Loaded 2 default hub(s) from bundled default-hubs.json.'
    }]);
  });

  it('prefers the bundled configuration over the hardcoded fallback', () => {
    const logs: LogEvent[] = [];
    const configuredHubs = [{
      name: 'Configured Hub',
      description: 'Configured description',
      icon: 'configured',
      reference: reference()
    }];
    const fallbackHubs = [{
      name: 'Fallback Hub',
      description: 'Fallback description',
      icon: 'fallback',
      reference: reference()
    }];

    expect(resolveDefaultHubs(configuredHubs, fallbackHubs, (event) => logs.push(event))).toBe(configuredHubs);
    expect(logs).toEqual([{
      level: 'debug',
      message: 'Loaded 1 default hub(s) from bundled default-hubs.json.'
    }]);
  });

  it('uses the hardcoded defaults when the bundled configuration is empty', () => {
    const logs: LogEvent[] = [];
    const fallbackHubs = [{
      name: 'Fallback Hub',
      description: 'Fallback description',
      icon: 'fallback',
      reference: reference()
    }];

    expect(resolveDefaultHubs([], fallbackHubs, (event) => logs.push(event))).toBe(fallbackHubs);
    expect(logs).toEqual([{
      level: 'warn',
      message: 'Bundled default-hubs.json is empty; loaded 1 hardcoded default hub(s).'
    }]);
  });

  it('provides all required fields for every bundled hub', () => {
    for (const hub of getDefaultHubs()) {
      expect(hub.name).toBeTruthy();
      expect(hub.description).toBeTruthy();
      expect(hub.icon).toBeTruthy();
      expect(hub.reference.type).toBeTruthy();
      expect(hub.reference.location).toBeTruthy();
    }
  });

  it('marks exactly one hub as recommended so the selection is not order-dependent', () => {
    const recommended = getDefaultHubs().filter((hub) => hub.recommended);
    expect(recommended).toHaveLength(1);
    expect(getRecommendedHub()).toBe(recommended[0]);
  });

  it('gives every hub a plain-text icon and a VS Code codicon', () => {
    for (const hub of getDefaultHubs()) {
      expect(hub.icon).toBeTruthy();
      expect(hub.codicon).toBeTruthy();
    }
  });
});

describe('isDefaultHub', () => {
  beforeEach(() => {
    clearCache();
  });

  it('recognises every shipped default hub by its own reference', () => {
    for (const hub of getDefaultHubs()) {
      expect(isDefaultHub(hub.reference)).toBe(true);
    }
  });

  it('ignores the git ref, because a default hub on another branch is the same hub', () => {
    expect(isDefaultHub(reference({ ref: 'next' }))).toBe(true);
  });

  it('matches GitHub locations case-insensitively', () => {
    expect(isDefaultHub(reference({ location: 'amadeus-xdlc/GENAI.prompt-registry-config' }))).toBe(true);
  });

  it('rejects an unrelated hub', () => {
    expect(isDefaultHub(reference({ location: 'someone/private-hub' }))).toBe(false);
  });

  it('rejects a matching location under a different hub type', () => {
    const recommended = getRecommendedHub()!;
    expect(isDefaultHub({ type: 'local', location: recommended.reference.location })).toBe(false);
  });
});

describe('isRecommendedDefaultHub', () => {
  beforeEach(() => {
    clearCache();
  });

  it('accepts the recommended hub', () => {
    expect(isRecommendedDefaultHub(getRecommendedHub()!.reference)).toBe(true);
  });

  it('rejects a non-recommended default hub', () => {
    const other = getDefaultHubs().find((hub) => !hub.recommended);
    expect(other).toBeDefined();
    expect(isRecommendedDefaultHub(other!.reference)).toBe(false);
  });

  it('rejects an unrelated hub', () => {
    expect(isRecommendedDefaultHub(reference({ location: 'someone/private-hub' }))).toBe(false);
  });
});
