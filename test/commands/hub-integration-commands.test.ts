/**
 * Unit tests for HubIntegrationCommands
 *
 * Tests command registration wiring and selectActiveProfile edge cases.
 * HubIntegrationCommands is primarily a wiring class that delegates to
 * HubHistoryCommands, HubSyncCommands, and activation command functions.
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  HubIntegrationCommands,
} from '../../src/commands/hub-integration-commands';
import {
  createMockContext,
} from '../helpers/command-test-helpers';

suite('HubIntegrationCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let mockHubManager: any;
  let context: vscode.ExtensionContext;
  let registeredCallbacks: Map<string, (...args: any[]) => any>;

  setup(() => {
    sandbox = sinon.createSandbox();
    registeredCallbacks = new Map();

    mockHubManager = {
      listAllActiveProfiles: sandbox.stub().resolves([]),
      getHubInfo: sandbox.stub().resolves({
        id: 'hub-1',
        config: { metadata: { name: 'Test Hub' } },
        reference: { type: 'github', location: 'test/repo' },
        metadata: { name: 'Test Hub', description: 'desc', lastModified: new Date(), size: 0 }
      }),
      getHubProfile: sandbox.stub().resolves({
        id: 'profile-1',
        name: 'Test Profile',
        description: 'A test profile',
        bundles: [],
        icon: 'test',
        active: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
    };
    ({ context } = createMockContext(sandbox));

    // Capture registered command callbacks so we can invoke them directly
    sandbox.stub(vscode.commands, 'registerCommand').callsFake((command: string, callback: (...args: any[]) => any) => {
      registeredCallbacks.set(command, callback);
      return { dispose: () => {} };
    });
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('constructor', () => {
    test('should register commands into context subscriptions', () => {
      const initialLength = context.subscriptions.length;

      new HubIntegrationCommands(mockHubManager, context);

      // HubHistoryCommands registers 3 (viewSyncHistory, rollbackProfile, clearSyncHistory)
      // registerActivationCommands registers 3 (activate, deactivate, showActive)
      // registerSyncCommands registers 4 (checkForUpdates, viewProfileChanges, syncProfileNow, reviewAndSync)
      assert.ok(
        context.subscriptions.length > initialLength,
        `Expected subscriptions to increase from ${initialLength}, got ${context.subscriptions.length}`
      );
      assert.strictEqual(context.subscriptions.length, 10);
    });
  });

  suite('selectActiveProfile (via sync commands)', () => {
    test('should show info message when no active profiles and checkForUpdates is invoked without args', async () => {
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      mockHubManager.listAllActiveProfiles.resolves([]);

      new HubIntegrationCommands(mockHubManager, context);

      // Invoke the registered checkForUpdates callback without hubId/profileId
      // This triggers selectActiveProfile internally
      const checkForUpdates = registeredCallbacks.get('promptregistry.checkForUpdates');
      assert.ok(checkForUpdates, 'checkForUpdates command should be registered');
      await checkForUpdates();

      assert.ok(
        infoStub.called,
        'Should show info message when no active profiles'
      );
      assert.ok(
        (infoStub.firstCall.args[0] as string).includes('No active hub profiles'),
        `Expected message about no active hub profiles, got: "${infoStub.firstCall.args[0]}"`
      );
    });
  });
});
