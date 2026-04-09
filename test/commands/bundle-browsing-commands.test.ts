/**
 * Unit tests for BundleBrowsingCommands
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  BundleBrowsingCommands,
} from '../../src/commands/bundle-browsing-commands';
import {
  stubWithProgress,
} from '../helpers/command-test-helpers';

suite('BundleBrowsingCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let mockRegistryManager: any;
  let commands: BundleBrowsingCommands;

  const createBundle = (id: string, name: string) => ({
    id,
    name,
    version: '1.0.0',
    author: 'author',
    description: 'A bundle',
    tags: ['test'],
    sourceId: 'source-1'
  });

  setup(() => {
    sandbox = sinon.createSandbox();
    mockRegistryManager = {
      searchBundles: sandbox.stub().resolves([]),
      getBundleDetails: sandbox.stub().resolves(createBundle('test', 'Test')),
      listInstalledBundles: sandbox.stub().resolves([]),
      checkUpdates: sandbox.stub().resolves([]),
    };
    commands = new BundleBrowsingCommands(mockRegistryManager);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('viewBundle()', () => {
    test('should prompt for search when no bundleId provided', async () => {
      const inputStub = sandbox.stub(vscode.window, 'showInputBox').resolves(undefined);

      await commands.viewBundle();

      assert.ok(inputStub.calledOnce);
    });

    test('should show message when no bundles found for search', async () => {
      sandbox.stub(vscode.window, 'showInputBox').resolves('nonexistent');
      mockRegistryManager.searchBundles.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.viewBundle();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('No bundles found'));
    });

    test('should show bundle details when bundleId provided', async () => {
      mockRegistryManager.getBundleDetails.resolves(createBundle('my-bundle', 'My Bundle'));
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.viewBundle('my-bundle');

      assert.ok(quickPickStub.calledOnce);
    });

    test('should show error when bundle not found', async () => {
      mockRegistryManager.getBundleDetails.rejects(new Error('Not found'));
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await commands.viewBundle('missing-bundle');

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('not found'));
    });

    test('should show install option for non-installed bundles', async () => {
      mockRegistryManager.getBundleDetails.resolves(createBundle('new-bundle', 'New'));
      mockRegistryManager.listInstalledBundles.resolves([]);
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.viewBundle('new-bundle');

      assert.ok(quickPickStub.calledOnce);
      const items = quickPickStub.firstCall.args[0] as any[];
      assert.ok(items.some(i => i.label?.includes('Install')));
    });
  });

  suite('browseByCategory()', () => {
    test('should return early when user cancels category selection', async () => {
      sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.browseByCategory();

      assert.ok(mockRegistryManager.searchBundles.notCalled);
    });

    test('should search bundles by selected category tag', async () => {
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
      quickPickStub.onFirstCall().resolves({ label: '🧪 Testing', value: 'testing' } as any);
      quickPickStub.onSecondCall().resolves(undefined);
      stubWithProgress(sandbox);
      mockRegistryManager.searchBundles.resolves([createBundle('test-bundle', 'Test Bundle')]);

      await commands.browseByCategory();

      assert.ok(mockRegistryManager.searchBundles.calledWith({ tags: ['testing'] }));
    });

    test('should show message when no bundles in category', async () => {
      sandbox.stub(vscode.window, 'showQuickPick').resolves({ label: '🧪 Testing', value: 'testing' } as any);
      stubWithProgress(sandbox);
      mockRegistryManager.searchBundles.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.browseByCategory();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('No bundles found'));
    });
  });

  suite('showPopular()', () => {
    test('should show message when no bundles available', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.searchBundles.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.showPopular();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('No bundles available'));
    });

    test('should search with sortBy downloads', async () => {
      stubWithProgress(sandbox);
      mockRegistryManager.searchBundles.resolves([createBundle('popular', 'Popular Bundle')]);
      sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.showPopular();

      assert.ok(mockRegistryManager.searchBundles.calledWith({ sortBy: 'downloads' }));
    });
  });

  suite('listInstalled()', () => {
    test('should show message when no bundles installed', async () => {
      mockRegistryManager.listInstalledBundles.resolves([]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await commands.listInstalled();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('No bundles installed'));
    });

    test('should show installed bundles in QuickPick', async () => {
      mockRegistryManager.listInstalledBundles.resolves([
        { bundleId: 'bundle-a', version: '1.0.0', scope: 'user', installedAt: new Date().toISOString() }
      ]);
      mockRegistryManager.getBundleDetails.resolves(createBundle('bundle-a', 'Bundle A'));
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await commands.listInstalled();

      assert.ok(quickPickStub.calledOnce);
      const items = await quickPickStub.firstCall.args[0];
      assert.ok(Array.isArray(items));
      assert.strictEqual(items.length, 1);
    });
  });
});
