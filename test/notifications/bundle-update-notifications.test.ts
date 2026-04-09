/**
 * Unit tests for BundleUpdateNotifications
 * Complements existing property tests — focuses on specific edge cases and action handling.
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  UpdateCheckResult,
} from '../../src/services/update-cache';
import {
  BundleUpdateNotifications,
} from '../../src/notifications/bundle-update-notifications';

suite('BundleUpdateNotifications', () => {
  let sandbox: sinon.SinonSandbox;
  let notifications: BundleUpdateNotifications;

  const createUpdate = (overrides?: Partial<UpdateCheckResult>): UpdateCheckResult => ({
    bundleId: 'test-bundle',
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    releaseDate: '2024-01-01',
    downloadUrl: 'https://example.com/download',
    autoUpdateEnabled: false,
    ...overrides,
  });

  setup(() => {
    sandbox = sinon.createSandbox();
    notifications = new BundleUpdateNotifications();
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('showUpdateNotification()', () => {
    test('should skip notification when preference is "none"', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await notifications.showUpdateNotification({
        updates: [createUpdate()],
        notificationPreference: 'none',
      });

      assert.ok(infoStub.notCalled, 'Should not show notification');
    });

    test('should skip notification when preference is "critical" and no critical updates', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await notifications.showUpdateNotification({
        updates: [createUpdate({ currentVersion: '1.0.0', latestVersion: '1.1.0' })], // minor, not critical
        notificationPreference: 'critical',
      });

      assert.ok(infoStub.notCalled, 'Should not show notification for non-critical update');
    });

    test('should show notification for critical update when preference is "critical"', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notifications.showUpdateNotification({
        updates: [createUpdate({ currentVersion: '1.0.0', latestVersion: '2.0.0' })], // major = critical
        notificationPreference: 'critical',
      });

      assert.ok(infoStub.calledOnce);
    });

    test('should show notification for all updates when preference is "all"', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notifications.showUpdateNotification({
        updates: [createUpdate()],
        notificationPreference: 'all',
      });

      assert.ok(infoStub.calledOnce);
      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('Update available'));
    });

    test('should show multi-update message for multiple updates', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notifications.showUpdateNotification({
        updates: [
          createUpdate({ bundleId: 'bundle-a' }),
          createUpdate({ bundleId: 'bundle-b' }),
        ],
        notificationPreference: 'all',
      });

      assert.ok(infoStub.calledOnce);
      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('2 bundle updates available'));
    });

    test('should execute update command when "Update Now" clicked for single update', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('Update Now' as any);
      const execStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

      await notifications.showUpdateNotification({
        updates: [createUpdate({ bundleId: 'my-bundle' })],
        notificationPreference: 'all',
      });

      assert.ok(execStub.calledWith('promptRegistry.updateBundle', 'my-bundle'));
    });

    test('should execute updateAll command when "Update Now" clicked for multiple updates', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('Update Now' as any);
      const execStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

      await notifications.showUpdateNotification({
        updates: [createUpdate({ bundleId: 'a' }), createUpdate({ bundleId: 'b' })],
        notificationPreference: 'all',
      });

      assert.ok(execStub.calledWith('promptRegistry.updateAllBundles'));
    });

    test('should open release notes when "View Changes" clicked', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('View Changes' as any);
      const openStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);

      await notifications.showUpdateNotification({
        updates: [createUpdate({ releaseNotes: 'https://example.com/notes' })],
        notificationPreference: 'all',
      });

      assert.ok(openStub.calledOnce);
    });
  });

  suite('showAutoUpdateComplete()', () => {
    test('should show success message with version info', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notifications.showAutoUpdateComplete('my-bundle', '1.0.0', '2.0.0');

      assert.ok(infoStub.calledOnce);
      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('auto-updated'));
      assert.ok(message.includes('1.0.0'));
      assert.ok(message.includes('2.0.0'));
    });
  });

  suite('showUpdateFailure()', () => {
    test('should show error message with bundle name and error', async () => {
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      await notifications.showUpdateFailure('my-bundle', 'Network timeout');

      assert.ok(errorStub.calledOnce);
      const message = errorStub.firstCall.args[0] as string;
      assert.ok(message.includes('Failed to update'));
      assert.ok(message.includes('Network timeout'));
    });
  });

  suite('showBatchUpdateSummary()', () => {
    test('should show success message when all succeed', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notifications.showBatchUpdateSummary(['bundle-a', 'bundle-b'], []);

      assert.ok(infoStub.calledOnce);
      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('2 updated'));
    });

    test('should show warning message when some fail', async () => {
      const warnStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);

      await notifications.showBatchUpdateSummary(
        ['bundle-a'],
        [{ bundleId: 'bundle-b', error: 'timeout' }]
      );

      assert.ok(warnStub.calledOnce);
      const message = warnStub.firstCall.args[0] as string;
      assert.ok(message.includes('1 updated'));
      assert.ok(message.includes('1 failed'));
    });
  });

  suite('bundle name resolution', () => {
    test('should use custom name resolver when provided', async () => {
      const resolver = sandbox.stub().resolves('Custom Name');
      const notif = new BundleUpdateNotifications(resolver);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notif.showAutoUpdateComplete('my-id', '1.0.0', '2.0.0');

      assert.ok(resolver.calledWith('my-id'));
      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('Custom Name'));
    });

    test('should fall back to bundleId when resolver fails', async () => {
      const resolver = sandbox.stub().rejects(new Error('fail'));
      const notif = new BundleUpdateNotifications(resolver);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await notif.showAutoUpdateComplete('fallback-id', '1.0.0', '2.0.0');

      const message = infoStub.firstCall.args[0] as string;
      assert.ok(message.includes('fallback-id'));
    });
  });
});
