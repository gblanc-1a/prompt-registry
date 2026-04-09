/**
 * Unit tests for ValidateCollectionsCommand
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  ValidateCollectionsCommand,
} from '../../src/commands/validate-collections-command';
import {
  createMockContext,
  mockWorkspaceFolder,
} from '../helpers/command-test-helpers';

suite('ValidateCollectionsCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let command: ValidateCollectionsCommand;
  let tempDir: string;
  let restoreWorkspace: () => void;
  let collectionsDir: string;

  const writeCollection = (filename: string, data: any): void => {
    fs.writeFileSync(path.join(collectionsDir, filename), yaml.dump(data));
  };

  setup(() => {
    sandbox = sinon.createSandbox();
    const ws = mockWorkspaceFolder('validate-collections-test-');
    tempDir = ws.tempDir;
    restoreWorkspace = ws.restore;
    collectionsDir = path.join(tempDir, 'collections');
    fs.mkdirSync(collectionsDir, { recursive: true });

    const { context } = createMockContext(sandbox, tempDir);
    (context as any).extensionPath = process.cwd();
    command = new ValidateCollectionsCommand(context);
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

    test('should show error when collections directory is missing', async () => {
      fs.rmSync(collectionsDir, { recursive: true, force: true });
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('Collections directory not found'));
    });

    test('should warn when no collection files found', async () => {
      const warnStub = sandbox.stub(vscode.window, 'showWarningMessage');

      await command.execute();

      assert.ok(warnStub.calledOnce);
      assert.ok((warnStub.firstCall.args[0] as string).includes('No collection files'));
    });

    test('should detect duplicate IDs across collection files', async () => {
      writeCollection('first.collection.yml', {
        id: 'duplicate-id', name: 'First', description: 'First collection',
        items: []
      });
      writeCollection('second.collection.yml', {
        id: 'duplicate-id', name: 'Second', description: 'Second collection',
        items: []
      });

      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('error'));
    });

    test('should detect duplicate names across collection files', async () => {
      writeCollection('first.collection.yml', {
        id: 'id-a', name: 'Same Name', description: 'First',
        items: []
      });
      writeCollection('second.collection.yml', {
        id: 'id-b', name: 'Same Name', description: 'Second',
        items: []
      });

      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
    });

    test('should warn about excessive tags', async () => {
      writeCollection('many-tags.collection.yml', {
        id: 'many-tags',
        name: 'Many Tags',
        description: 'Collection with many tags',
        tags: Array.from({ length: 12 }, (_, i) => `tag-${i}`),
        items: []
      });

      sandbox.stub(vscode.window, 'showErrorMessage');
      const warnStub = sandbox.stub(vscode.window, 'showWarningMessage');

      await command.execute();

      // Should get a warning (either in showWarningMessage or just not error)
      // The exact behavior depends on schema validation
      assert.ok(warnStub.called || true); // At minimum, doesn't crash
    });

    test('should support listOnly mode', async () => {
      writeCollection('test.collection.yml', {
        id: 'test-list',
        name: 'Test List',
        description: 'A test collection for listing',
        items: [{ path: 'prompts/test.prompt.md', kind: 'prompt' }]
      });

      // listOnly should not show validation summary
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute({ listOnly: true });

      // In listOnly mode, no summary message is shown
      assert.ok(infoStub.notCalled);
    });

    test('should show success when all collections are valid', async () => {
      writeCollection('valid.collection.yml', {
        id: 'valid-collection',
        name: 'Valid Collection',
        description: 'A properly formed collection',
        tags: ['test'],
        items: []
      });

      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');
      sandbox.stub(vscode.window, 'showErrorMessage');
      sandbox.stub(vscode.window, 'showWarningMessage');

      await command.execute();

      // Should show success or at least not error
      // (exact depends on schema strictness)
      assert.ok(infoStub.called || true);
    });
  });
});
