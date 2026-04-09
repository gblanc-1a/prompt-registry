/**
 * Unit tests for UpdateCache
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  CachedUpdateResult,
  UpdateCache,
  UpdateCheckResult,
} from '../../src/services/update-cache';

suite('UpdateCache', () => {
  let sandbox: sinon.SinonSandbox;
  let storageData: Map<string, any>;
  let mockStorage: vscode.Memento;
  let cache: UpdateCache;

  const createResult = (bundleId = 'test-bundle'): UpdateCheckResult => ({
    bundleId,
    currentVersion: '1.0.0',
    latestVersion: '2.0.0',
    releaseDate: '2024-01-01',
    downloadUrl: 'https://example.com/download',
    autoUpdateEnabled: false,
  });

  setup(() => {
    sandbox = sinon.createSandbox();
    storageData = new Map();

    mockStorage = {
      get: (key: string, defaultValue?: any) => storageData.get(key) ?? defaultValue,
      update: async (key: string, value: any) => { storageData.set(key, value); },
      keys: () => Array.from(storageData.keys()),
      setKeysForSync: sandbox.stub()
    } as any;

    cache = new UpdateCache(mockStorage);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('set()', () => {
    test('should store results with timestamp and default TTL', async () => {
      const results = [createResult()];
      await cache.set(results);

      const stored = storageData.get('bundleUpdateCache') as CachedUpdateResult;
      assert.ok(stored);
      assert.deepStrictEqual(stored.results, results);
      assert.ok(stored.timestamp instanceof Date);
      assert.strictEqual(stored.ttl, 300000); // from mock config
    });

    test('should use custom TTL when provided', async () => {
      await cache.set([], 60000);

      const stored = storageData.get('bundleUpdateCache') as CachedUpdateResult;
      assert.strictEqual(stored.ttl, 60000);
    });

    test('should store multiple results', async () => {
      const results = [createResult('bundle-a'), createResult('bundle-b')];
      await cache.set(results);

      const stored = storageData.get('bundleUpdateCache') as CachedUpdateResult;
      assert.strictEqual(stored.results.length, 2);
    });
  });

  suite('get()', () => {
    test('should return null when cache is empty', async () => {
      const result = await cache.get();
      assert.strictEqual(result, null);
    });

    test('should return cached results when valid', async () => {
      const results = [createResult()];
      await cache.set(results);

      const retrieved = await cache.get();
      assert.deepStrictEqual(retrieved, results);
    });

    test('should return null and clear when cache is expired', async () => {
      storageData.set('bundleUpdateCache', {
        results: [createResult()],
        timestamp: new Date(Date.now() - 600000), // 10 minutes ago
        ttl: 300000 // 5 minutes
      });

      const result = await cache.get();
      assert.strictEqual(result, null);
      assert.strictEqual(storageData.get('bundleUpdateCache'), undefined);
    });
  });

  suite('isValid()', () => {
    test('should return false when no cached data exists', () => {
      assert.strictEqual(cache.isValid(), false);
    });

    test('should return true for fresh cache', async () => {
      await cache.set([createResult()]);
      assert.strictEqual(cache.isValid(), true);
    });

    test('should return false for expired cache', () => {
      storageData.set('bundleUpdateCache', {
        results: [],
        timestamp: new Date(Date.now() - 600000),
        ttl: 300000
      });
      assert.strictEqual(cache.isValid(), false);
    });

    test('should accept CachedUpdateResult parameter directly', () => {
      const cached: CachedUpdateResult = {
        results: [],
        timestamp: new Date(),
        ttl: 300000
      };
      assert.strictEqual(cache.isValid(cached), true);
    });

    test('should handle numeric timestamp from deserialized JSON', () => {
      storageData.set('bundleUpdateCache', {
        results: [],
        timestamp: Date.now(),
        ttl: 300000
      });
      assert.strictEqual(cache.isValid(), true);
    });
  });

  suite('clear()', () => {
    test('should remove cached data', async () => {
      await cache.set([createResult()]);
      assert.ok(storageData.has('bundleUpdateCache'));

      await cache.clear();
      assert.strictEqual(storageData.get('bundleUpdateCache'), undefined);
    });
  });

  suite('getCacheAge()', () => {
    test('should return -1 when no cache exists', () => {
      assert.strictEqual(cache.getCacheAge(), -1);
    });

    test('should return approximate age in milliseconds', () => {
      const pastTime = Date.now() - 5000;
      storageData.set('bundleUpdateCache', {
        results: [],
        timestamp: new Date(pastTime),
        ttl: 300000
      });

      const age = cache.getCacheAge();
      assert.ok(age >= 4900 && age < 6000, `Expected age ~5000ms but got ${age}`);
    });

    test('should handle numeric timestamp', () => {
      const pastTime = Date.now() - 3000;
      storageData.set('bundleUpdateCache', {
        results: [],
        timestamp: pastTime,
        ttl: 300000
      });

      const age = cache.getCacheAge();
      assert.ok(age >= 2900 && age < 4000, `Expected age ~3000ms but got ${age}`);
    });
  });
});
