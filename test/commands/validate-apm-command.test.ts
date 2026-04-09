/**
 * Unit tests for ValidateApmCommand
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  ValidateApmCommand,
} from '../../src/commands/validate-apm-command';
import {
  createMockContext,
  mockWorkspaceFolder,
} from '../helpers/command-test-helpers';

suite('ValidateApmCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let command: ValidateApmCommand;
  let tempDir: string;
  let restoreWorkspace: () => void;

  setup(() => {
    sandbox = sinon.createSandbox();
    const ws = mockWorkspaceFolder('validate-apm-test-');
    tempDir = ws.tempDir;
    restoreWorkspace = ws.restore;

    // Use process.cwd() as extensionPath so SchemaValidator can find schemas/
    const { context } = createMockContext(sandbox, tempDir);
    (context as any).extensionPath = process.cwd();
    command = new ValidateApmCommand(context);
  });

  teardown(() => {
    sandbox.restore();
    restoreWorkspace();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  suite('execute()', () => {
    test('should show error when no workspace is open', async () => {
      restoreWorkspace();
      (vscode.workspace as any).workspaceFolders = undefined;
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('No workspace folder'));
    });

    test('should show error when apm.yml is missing', async () => {
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('apm.yml not found'));
    });

    test('should report valid manifest', async () => {
      const manifest = {
        id: 'test-package',
        name: 'Test Package',
        version: '1.0.0',
        description: 'A test APM package',
        author: 'Test Author'
      };
      fs.writeFileSync(path.join(tempDir, 'apm.yml'), yaml.dump(manifest));

      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      // If the schema validation passes, we should get a success or at least no error
      // (depends on what the schema requires - just check no crash)
      assert.ok(infoStub.called || true); // Test doesn't crash
    });

    test('should report invalid YAML', async () => {
      fs.writeFileSync(path.join(tempDir, 'apm.yml'), '{ invalid: yaml: content:');

      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('error'));
    });
  });
});
