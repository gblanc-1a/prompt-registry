/**
 * Unit tests for HubHistoryCommands
 *
 * Tests VS Code commands for viewing sync history, rollback, and clearing history.
 * Focuses on user-facing behavior: info/error messages and QuickPick interactions.
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  HubHistoryCommands,
} from '../../src/commands/hub-history-commands';
import {
  createMockContext,
} from '../helpers/command-test-helpers';

suite('HubHistoryCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let mockHubManager: any;
  let context: vscode.ExtensionContext;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockHubManager = {
      listAllActiveProfiles: sandbox.stub().resolves([]),
    };
    ({ context } = createMockContext(sandbox));
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('viewSyncHistory()', () => {
    test('should show info message when no active profiles', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      mockHubManager.listAllActiveProfiles.resolves([]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.viewSyncHistory();

      assert.ok(infoStub.calledOnce);
      assert.ok(
        (infoStub.firstCall.args[0] as string).includes('No active profiles'),
        `Expected info message about no active profiles, got: "${infoStub.firstCall.args[0]}"`
      );
    });

    test('should return early when user cancels profile selection', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage');
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      mockHubManager.listAllActiveProfiles.resolves([
        { hubId: 'hub-1', profileId: 'profile-1', activatedAt: new Date().toISOString(), syncedBundles: [] }
      ]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.viewSyncHistory();

      assert.ok(quickPickStub.calledOnce, 'QuickPick should be shown for profile selection');
    });
  });

  suite('rollbackProfile()', () => {
    test('should show info message when no active profiles', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      mockHubManager.listAllActiveProfiles.resolves([]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.rollbackProfile();

      assert.ok(infoStub.calledOnce);
      assert.ok(
        (infoStub.firstCall.args[0] as string).includes('No active profiles'),
        `Expected info message about no active profiles, got: "${infoStub.firstCall.args[0]}"`
      );
    });

    test('should return early when user cancels profile selection', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage');
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      mockHubManager.listAllActiveProfiles.resolves([
        { hubId: 'hub-1', profileId: 'profile-1', activatedAt: new Date().toISOString(), syncedBundles: [] }
      ]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.rollbackProfile();

      assert.ok(quickPickStub.calledOnce, 'QuickPick should be shown for profile selection');
    });
  });

  suite('clearSyncHistory()', () => {
    test('should show info message when no active profiles', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      mockHubManager.listAllActiveProfiles.resolves([]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.clearSyncHistory();

      assert.ok(infoStub.calledOnce);
      assert.ok(
        (infoStub.firstCall.args[0] as string).includes('No active profiles'),
        `Expected info message about no active profiles, got: "${infoStub.firstCall.args[0]}"`
      );
    });

    test('should return early when user cancels profile selection', async () => {
      sandbox.stub(vscode.window, 'showInformationMessage');
      const quickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);

      mockHubManager.listAllActiveProfiles.resolves([
        { hubId: 'hub-1', profileId: 'profile-1', activatedAt: new Date().toISOString(), syncedBundles: [] }
      ]);

      const commands = new HubHistoryCommands(mockHubManager, context);
      await commands.clearSyncHistory();

      assert.ok(quickPickStub.calledOnce, 'QuickPick should be shown for profile selection');
    });
  });
});
