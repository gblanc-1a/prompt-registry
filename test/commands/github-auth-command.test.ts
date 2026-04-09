/**
 * Unit tests for GitHubAuthCommand
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  GitHubAuthCommand,
} from '../../src/commands/github-auth-command';
import {
  stubWithProgress,
} from '../helpers/command-test-helpers';

suite('GitHubAuthCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let mockRegistryManager: any;
  let command: GitHubAuthCommand;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockRegistryManager = {
      forceAuthentication: sandbox.stub().resolves(),
    };
    command = new GitHubAuthCommand(mockRegistryManager);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('execute()', () => {
    test('should show progress notification during authentication', async () => {
      const progressStub = stubWithProgress(sandbox);
      sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();

      assert.ok(progressStub.calledOnce);
      const opts = progressStub.firstCall.args[0] as any;
      assert.strictEqual(opts.location, vscode.ProgressLocation.Notification);
    });

    test('should call forceAuthentication on registry manager', async () => {
      stubWithProgress(sandbox);
      sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();

      assert.ok(mockRegistryManager.forceAuthentication.calledOnce);
    });

    test('should show success message on completion', async () => {
      stubWithProgress(sandbox);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();

      assert.ok(infoStub.calledOnce);
      assert.ok((infoStub.firstCall.args[0] as string).includes('refreshed successfully'));
    });

    test('should show error message on failure', async () => {
      mockRegistryManager.forceAuthentication.rejects(new Error('Token expired'));
      stubWithProgress(sandbox);
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('Token expired'));
    });
  });
});
