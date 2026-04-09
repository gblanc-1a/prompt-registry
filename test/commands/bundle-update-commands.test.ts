/**
 * Unit tests for BundleUpdateCommands
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  BundleUpdateCommands,
} from '../../src/commands/bundle-update-commands';
import {
  stubWithProgress,
} from '../helpers/command-test-helpers';

suite('BundleUpdateCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let mockRegistryManager: any;
  let commands: BundleUpdateCommands;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockRegistryManager = {
      checkUpdates: sandbox.stub().resolves([]),
      updateBundle: sandbox.stub().resolves(),
      getBundleDetails: sandbox.stub().resolves({ id: 'test', name: 'Test Bundle' }),
      listInstalledBundles: sandbox.stub().resolves([]),
      isAutoUpdateEnabled: sandbox.stub().resolves(false),
      enableAutoUpdate: sandbox.stub().resolves(),
      disableAutoUpdate: sandbox.stub().resolves(),
    };
    commands = new BundleUpdateCommands(mockRegistryManager);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('updateBundle()', () => {
    test('should update bundle with progress notification', async () => {
      const progressStub = stubWithProgress(sandbox);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.updateBundle('my-bundle');

      assert.ok(progressStub.calledOnce);
      assert.ok(mockRegistryManager.updateBundle.calledWith('my-bundle'));
      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('updated successfully'));
    });

    test('should use bundle name in progress title when available', async () => {
      mockRegistryManager.getBundleDetails.resolves({ id: 'my-bundle', name: 'My Bundle' });
      const progressStub = stubWithProgress(sandbox);
      sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.updateBundle('my-bundle');

      const opts = progressStub.firstCall.args[0] as any;
      assert.ok(opts.title.includes('My Bundle'));
    });

    test('should fall back to bundleId when details unavailable', async () => {
      mockRegistryManager.getBundleDetails.rejects(new Error('Not found'));
      const progressStub = stubWithProgress(sandbox);
      sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.updateBundle('unknown-id');

      const opts = progressStub.firstCall.args[0] as any;
      assert.ok(opts.title.includes('unknown-id'));
    });
  });

  suite('checkSingleBundleUpdate()', () => {
    test('should show up-to-date message when no update available', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.checkSingleBundleUpdate('my-bundle');

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('up to date'));
    });

    test('should show update dialog when update is available', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([
        { bundleId: 'my-bundle', currentVersion: '1.0.0', latestVersion: '2.0.0' }
      ]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await commands.checkSingleBundleUpdate('my-bundle');

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('Update available'));
    });
  });

  suite('checkAllUpdates()', () => {
    test('should show all-up-to-date message when no updates', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.checkAllUpdates();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('up to date'));
    });

    test('should show QuickPick with available updates', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([
        { bundleId: 'a', currentVersion: '1.0.0', latestVersion: '2.0.0' },
        { bundleId: 'b', currentVersion: '1.0.0', latestVersion: '1.1.0' }
      ]);
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.checkAllUpdates();

      assert.ok(quickPickStub.calledOnce);
    });
  });

  suite('updateAllBundles()', () => {
    test('should show up-to-date when no updates available', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.updateAllBundles();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('up to date'));
    });

    test('should ask for confirmation before batch update', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([
        { bundleId: 'a', currentVersion: '1.0.0', latestVersion: '2.0.0' }
      ]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves('Cancel' as any);

      await commands.updateAllBundles();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('update(s) available'));
    });

    test('should perform batch update when confirmed', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.checkUpdates.resolves([
        { bundleId: 'a', currentVersion: '1.0.0', latestVersion: '2.0.0' }
      ]);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves('Update All' as any);

      await commands.updateAllBundles();

      assert.ok(mockRegistryManager.updateBundle.called);
    });
  });

  suite('enableAutoUpdate()', () => {
    test('should show error when no bundleId', async () => {
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await commands.enableAutoUpdate(undefined);

      assert.ok(errorStub.calledOnce);
    });

    test('should show already-enabled message', async () => {
      mockRegistryManager.isAutoUpdateEnabled.resolves(true);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.enableAutoUpdate('my-bundle');

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('already enabled'));
    });

    test('should enable auto-update and confirm', async () => {
      mockRegistryManager.isAutoUpdateEnabled.resolves(false);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.enableAutoUpdate('my-bundle');

      assert.ok(mockRegistryManager.enableAutoUpdate.calledWith('my-bundle'));
      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('enabled'));
    });
  });

  suite('disableAutoUpdate()', () => {
    test('should show error when no bundleId', async () => {
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await commands.disableAutoUpdate(undefined);

      assert.ok(errorStub.calledOnce);
    });

    test('should show already-disabled message', async () => {
      mockRegistryManager.isAutoUpdateEnabled.resolves(false);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.disableAutoUpdate('my-bundle');

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('already disabled'));
    });

    test('should disable auto-update and confirm', async () => {
      mockRegistryManager.isAutoUpdateEnabled.resolves(true);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.disableAutoUpdate('my-bundle');

      assert.ok(mockRegistryManager.disableAutoUpdate.calledWith('my-bundle'));
      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('disabled'));
    });
  });
});
