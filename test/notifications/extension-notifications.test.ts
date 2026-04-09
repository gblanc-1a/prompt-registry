/**
 * Unit tests for ExtensionNotifications
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  ExtensionNotifications,
} from '../../src/notifications/extension-notifications';
import {
  NotificationManager,
} from '../../src/services/notification-manager';

suite('ExtensionNotifications', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    // Reset singletons
    (ExtensionNotifications as any).instance = undefined;
    (NotificationManager as any).instance = undefined;
  });

  teardown(() => {
    sandbox.restore();
    (ExtensionNotifications as any).instance = undefined;
    (NotificationManager as any).instance = undefined;
  });

  suite('getInstance()', () => {
    test('should return singleton instance', () => {
      const instance1 = ExtensionNotifications.getInstance();
      const instance2 = ExtensionNotifications.getInstance();
      assert.strictEqual(instance1, instance2);
    });
  });

  suite('showWelcomeNotification()', () => {
    test('should return "marketplace" and execute openView when user clicks Open Marketplace', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('Open Marketplace' as any);
      const execStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

      const result = await ExtensionNotifications.getInstance().showWelcomeNotification();

      assert.strictEqual(result, 'marketplace');
      assert.ok(execStub.calledWith('vscode.openView', 'promptregistry.marketplace'));
    });

    test('should return "dismiss" when user clicks Dismiss', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('Dismiss' as any);

      const result = await ExtensionNotifications.getInstance().showWelcomeNotification();
      assert.strictEqual(result, 'dismiss');
    });

    test('should return undefined when user closes notification', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const result = await ExtensionNotifications.getInstance().showWelcomeNotification();
      assert.strictEqual(result, undefined);
    });
  });

  suite('showError()', () => {
    test('should delegate to NotificationManager.showError', async () => {
      sandbox.stub(vscode.window, 'showErrorMessage').resolves('Retry' as any);

      const result = await ExtensionNotifications.getInstance().showError('Something broke', 'Retry');
      assert.strictEqual(result, 'Retry');
    });

    test('should return undefined when dismissed', async () => {
      sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

      const result = await ExtensionNotifications.getInstance().showError('Error');
      assert.strictEqual(result, undefined);
    });
  });
});
