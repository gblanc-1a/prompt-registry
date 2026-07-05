/**
 * InventoryScheduler Unit Tests
 * Tests for startup and periodic installed-bundle inventory snapshots
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  InventoryScheduler,
} from '../../src/services/inventory-scheduler';
import {
  RegistryManager,
} from '../../src/services/registry-manager';
import {
  TelemetryService,
} from '../../src/services/telemetry-service';
import {
  createMockInstalledBundle,
} from '../helpers/bundle-test-helpers';

suite('InventoryScheduler', () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let mockContext: vscode.ExtensionContext;
  let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
  let mockTelemetryService: sinon.SinonStubbedInstance<TelemetryService>;
  let scheduler: InventoryScheduler;
  let disposables: vscode.Disposable[];

  const STARTUP_DELAY_MS = 5000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const originalEnv = process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS;

  setup(() => {
    sandbox = sinon.createSandbox();
    clock = sinon.useFakeTimers();

    // Allow timers in tests so we can exercise the scheduling logic
    process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS = 'true';

    disposables = [];
    mockContext = {
      subscriptions: disposables,
      globalState: {} as any,
      extensionPath: '/mock/path'
    } as any;

    mockRegistryManager = sandbox.createStubInstance(RegistryManager);
    mockRegistryManager.listInstalledBundles.resolves([]);

    mockTelemetryService = sandbox.createStubInstance(TelemetryService);
  });

  teardown(() => {
    scheduler?.dispose();
    clock.restore();
    sandbox.restore();

    if (originalEnv === undefined) {
      delete process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS;
    } else {
      process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS = originalEnv;
    }
  });

  suite('initialize()', () => {
    test('should capture a startup snapshot after the startup delay', async () => {
      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 0);

      await clock.tickAsync(STARTUP_DELAY_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 1);
    });

    test('should not schedule if already initialized', async () => {
      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();
      scheduler.initialize(); // second call is a no-op

      await clock.tickAsync(STARTUP_DELAY_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 1);
    });
  });

  suite('snapshot aggregation', () => {
    test('should aggregate totals, scope counts and source types', async () => {
      mockRegistryManager.listInstalledBundles.resolves([
        createMockInstalledBundle('a', '1.0.0', { scope: 'user', sourceType: 'github' }),
        createMockInstalledBundle('b', '1.0.0', { scope: 'user', sourceType: 'github' }),
        createMockInstalledBundle('c', '1.0.0', { scope: 'workspace', sourceType: 'local' }),
        createMockInstalledBundle('d', '1.0.0', { scope: 'repository', sourceType: 'github' })
      ]);

      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();
      await clock.tickAsync(STARTUP_DELAY_MS);

      const payload = mockTelemetryService.trackInventorySnapshot.firstCall.args[0];
      assert.strictEqual(payload.total, 4);
      assert.deepStrictEqual(payload.byScope, { user: 2, workspace: 1, repository: 1 });
      assert.deepStrictEqual(payload.bySourceType, { github: 3, local: 1 });
    });

    test('should default missing sourceType to "unknown"', async () => {
      mockRegistryManager.listInstalledBundles.resolves([
        createMockInstalledBundle('a', '1.0.0', { scope: 'user' })
      ]);

      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();
      await clock.tickAsync(STARTUP_DELAY_MS);

      const payload = mockTelemetryService.trackInventorySnapshot.firstCall.args[0];
      assert.deepStrictEqual(payload.bySourceType, { unknown: 1 });
    });
  });

  suite('periodic snapshot', () => {
    test('should capture a snapshot on each 24h tick after startup', async () => {
      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      // Startup snapshot
      await clock.tickAsync(STARTUP_DELAY_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 1);

      // First periodic tick (remaining time to 24h)
      await clock.tickAsync(TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 2);

      // Second periodic tick
      await clock.tickAsync(TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 3);
    });

    test('should skip cycle if previous snapshot is still in progress', async () => {
      let resolveList: (value: any[]) => void;
      mockRegistryManager.listInstalledBundles.callsFake(() => new Promise((resolve) => {
        resolveList = resolve;
      }));

      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      // Startup snapshot hangs (listInstalledBundles pending)
      clock.tick(STARTUP_DELAY_MS);
      // Periodic tick while startup snapshot is still resolving — guard skips it
      clock.tick(TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 0);

      // Resolve the pending listing
      resolveList!([]);
      await clock.tickAsync(0);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 1);
    });

    test('should continue scheduling after a snapshot error', async () => {
      mockRegistryManager.listInstalledBundles
        .onFirstCall().rejects(new Error('storage error'))
        .onSecondCall().resolves([]);

      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      // Startup snapshot fails — no telemetry, but must not throw
      await clock.tickAsync(STARTUP_DELAY_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 0);

      // Periodic tick still fires
      await clock.tickAsync(TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 1);
    });
  });

  suite('dispose()', () => {
    test('should clear scheduled timers', async () => {
      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      scheduler.dispose();

      await clock.tickAsync(STARTUP_DELAY_MS + TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 0);
    });

    test('should register on context.subscriptions for auto-disposal', () => {
      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      assert.strictEqual(disposables.length, 1);
    });
  });

  suite('test environment', () => {
    test('should skip timers in test environment', async () => {
      delete process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS;

      scheduler = new InventoryScheduler(mockContext, mockRegistryManager, mockTelemetryService);
      scheduler.initialize();

      await clock.tickAsync(STARTUP_DELAY_MS + TWENTY_FOUR_HOURS_MS);
      assert.strictEqual(mockTelemetryService.trackInventorySnapshot.callCount, 0);
    });
  });
});
