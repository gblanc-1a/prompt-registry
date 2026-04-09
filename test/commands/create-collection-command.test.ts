/**
 * Unit tests for CreateCollectionCommand
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  CreateCollectionCommand,
} from '../../src/commands/create-collection-command';
import {
  mockWorkspaceFolder,
  stubInputSequence,
} from '../helpers/command-test-helpers';

suite('CreateCollectionCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let command: CreateCollectionCommand;
  let tempDir: string;
  let restoreWorkspace: () => void;

  setup(() => {
    sandbox = sinon.createSandbox();
    const ws = mockWorkspaceFolder('create-collection-test-');
    tempDir = ws.tempDir;
    restoreWorkspace = ws.restore;
    command = new CreateCollectionCommand();
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

    test('should return early when user cancels ID input', async () => {
      stubInputSequence(sandbox, [undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();

      assert.ok(infoStub.notCalled);
    });

    test('should create collections directory if it does not exist', async () => {
      stubInputSequence(sandbox, [undefined]);

      await command.execute();

      assert.ok(fs.existsSync(path.join(tempDir, 'collections')));
    });

    test('should create collection YAML file with correct content', async () => {
      stubInputSequence(sandbox, [
        'my-test-collection',   // ID
        'My Test Collection',   // Name
        'A test collection',    // Description
        'test,demo',            // Tags
      ]);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await command.execute();

      const collectionFile = path.join(tempDir, 'collections', 'my-test-collection.collection.yml');
      assert.ok(fs.existsSync(collectionFile));

      const content = yaml.load(fs.readFileSync(collectionFile, 'utf8')) as any;
      assert.strictEqual(content.id, 'my-test-collection');
      assert.strictEqual(content.name, 'My Test Collection');
      assert.strictEqual(content.description, 'A test collection');
      assert.deepStrictEqual(content.tags, ['test', 'demo']);
    });

    test('should detect duplicate collection and ask to overwrite', async () => {
      const collectionsDir = path.join(tempDir, 'collections');
      fs.mkdirSync(collectionsDir, { recursive: true });
      fs.writeFileSync(path.join(collectionsDir, 'existing.collection.yml'), 'id: existing');

      stubInputSequence(sandbox, ['existing']);
      const warnStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves('No' as any);

      await command.execute();

      assert.ok(warnStub.calledOnce);
      assert.ok((warnStub.firstCall.args[0] as string).includes('already exists'));
    });

    test('should return early when user cancels at name step', async () => {
      stubInputSequence(sandbox, ['my-collection', undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should return early when user cancels at description step', async () => {
      stubInputSequence(sandbox, ['my-collection', 'My Collection', undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should return early when user cancels at tags step', async () => {
      stubInputSequence(sandbox, ['my-collection', 'My Collection', 'Description', undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });
  });
});
