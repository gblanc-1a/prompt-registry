/**
 * Unit tests for BaseNotificationService
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  BaseNotificationService,
} from '../../src/notifications/base-notification-service';

/**
 * Concrete test subclass to exercise protected methods on BaseNotificationService.
 */
class TestNotificationService extends BaseNotificationService {
  public resolveResult = 'Resolved Name';

  protected async resolveBundleName(_bundleId: string): Promise<string> {
    return this.resolveResult;
  }

  // Expose protected methods for testing
  public testShowSuccessWithActions(message: string, actions: string[] = []) {
    return this.showSuccessWithActions(message, actions);
  }

  public testShowWarningWithActions(message: string, actions: string[] = []) {
    return this.showWarningWithActions(message, actions);
  }

  public testShowErrorWithActions(message: string, actions: string[] = []) {
    return this.showErrorWithActions(message, actions);
  }

  public testShowConfirmation(message: string, confirmText?: string, cancelText?: string) {
    return this.showConfirmation(message, confirmText, cancelText);
  }

  public testShowProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ) {
    return this.showProgress(title, task);
  }

  public testGetBundleDisplayName(bundleId: string) {
    return this.getBundleDisplayName(bundleId);
  }
}

suite('BaseNotificationService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: TestNotificationService;

  setup(() => {
    sandbox = sinon.createSandbox();
    service = new TestNotificationService();
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('showSuccessWithActions()', () => {
    test('should call showInformationMessage with message and actions', async () => {
      const stub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('OK' as any);
      const result = await service.testShowSuccessWithActions('Success!', ['OK']);
      assert.strictEqual(result, 'OK');
      assert.ok(stub.calledOnce);
      assert.strictEqual(stub.firstCall.args[0], 'Success!');
    });

    test('should work without actions', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
      const result = await service.testShowSuccessWithActions('Done');
      assert.strictEqual(result, undefined);
    });
  });

  suite('showWarningWithActions()', () => {
    test('should call showWarningMessage with message and actions', async () => {
      const stub = sandbox.stub(vscode.window, 'showWarningMessage').resolves('Retry' as any);
      const result = await service.testShowWarningWithActions('Warning!', ['Retry']);
      assert.strictEqual(result, 'Retry');
      assert.ok(stub.calledOnce);
    });
  });

  suite('showErrorWithActions()', () => {
    test('should call showErrorMessage with message and actions', async () => {
      const stub = sandbox.stub(vscode.window, 'showErrorMessage').resolves('Fix' as any);
      const result = await service.testShowErrorWithActions('Error!', ['Fix']);
      assert.strictEqual(result, 'Fix');
      assert.ok(stub.calledOnce);
    });
  });

  suite('showConfirmation()', () => {
    test('should return true when user clicks confirm', async () => {
      sandbox.stub(vscode.window, 'showWarningMessage').resolves('Confirm' as any);
      const result = await service.testShowConfirmation('Are you sure?');
      assert.strictEqual(result, true);
    });

    test('should return false when user clicks cancel', async () => {
      sandbox.stub(vscode.window, 'showWarningMessage').resolves('Cancel' as any);
      const result = await service.testShowConfirmation('Are you sure?');
      assert.strictEqual(result, false);
    });

    test('should return false when user dismisses', async () => {
      sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      const result = await service.testShowConfirmation('Are you sure?');
      assert.strictEqual(result, false);
    });

    test('should use custom confirm/cancel text', async () => {
      const stub = sandbox.stub(vscode.window, 'showWarningMessage').resolves('Yes' as any);
      await service.testShowConfirmation('Proceed?', 'Yes', 'No');
      // Verify custom button labels were passed
      assert.ok(stub.calledOnce);
      const args = stub.firstCall.args;
      assert.ok(args.includes('Yes'));
      assert.ok(args.includes('No'));
    });
  });

  suite('showProgress()', () => {
    test('should execute task with progress and return result', async () => {
      const result = await service.testShowProgress('Loading...', async (progress) => {
        progress.report({ message: 'Step 1' });
        return 42;
      });
      assert.strictEqual(result, 42);
    });
  });

  suite('getBundleDisplayName()', () => {
    test('should return resolved name from resolveBundleName', async () => {
      service.resolveResult = 'My Bundle';
      const name = await service.testGetBundleDisplayName('test-id');
      assert.strictEqual(name, 'My Bundle');
    });

    test('should fall back to bundleId when resolution fails', async () => {
      // Override to throw
      (service as any).resolveBundleName = async () => { throw new Error('fail'); };
      const name = await service.testGetBundleDisplayName('fallback-id');
      assert.strictEqual(name, 'fallback-id');
    });
  });
});
