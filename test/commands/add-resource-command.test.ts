/**
 * Unit tests for AddResourceCommand
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  AddResourceCommand,
  ResourceType,
} from '../../src/commands/add-resource-command';
import {
  mockWorkspaceFolder,
  stubInputSequence,
} from '../helpers/command-test-helpers';

suite('AddResourceCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let command: AddResourceCommand;
  let tempDir: string;
  let restoreWorkspace: () => void;

  const pickResourceType = (type: ResourceType, label: string) => {
    sandbox.stub(vscode.window, 'showQuickPick').resolves({
      label,
      type
    } as any);
  };

  setup(() => {
    sandbox = sinon.createSandbox();
    const ws = mockWorkspaceFolder('add-resource-test-');
    tempDir = ws.tempDir;
    restoreWorkspace = ws.restore;

    const templatesPath = path.join(process.cwd(), 'templates/resources');
    command = new AddResourceCommand(templatesPath);
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

    test('should return early when user cancels resource type selection', async () => {
      sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should return early when user cancels resource name input', async () => {
      pickResourceType(ResourceType.Prompt, '$(file-text) Prompt');
      stubInputSequence(sandbox, [undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should return early when user cancels description input', async () => {
      pickResourceType(ResourceType.Prompt, '$(file-text) Prompt');
      stubInputSequence(sandbox, ['My Prompt', undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should return early when user cancels author input', async () => {
      pickResourceType(ResourceType.Prompt, '$(file-text) Prompt');
      stubInputSequence(sandbox, ['My Prompt', 'Description', undefined]);
      const infoStub = sandbox.stub(vscode.window, 'showInformationMessage');

      await command.execute();
      assert.ok(infoStub.notCalled);
    });

    test('should create prompt file with rendered template', async () => {
      pickResourceType(ResourceType.Prompt, '$(file-text) Prompt');
      stubInputSequence(sandbox, ['Code Review Helper', 'Helps review code', 'Test Author']);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await command.execute();

      const promptDir = path.join(tempDir, 'prompts');
      assert.ok(fs.existsSync(promptDir), 'Should create prompts directory');
      const files = fs.readdirSync(promptDir);
      assert.ok(files.length > 0, 'Should create at least one file');
      assert.ok(files[0].endsWith('.prompt.md'), `Expected .prompt.md, got ${files[0]}`);
    });

    test('should create instruction file in correct folder', async () => {
      pickResourceType(ResourceType.Instruction, '$(book) Instruction');
      stubInputSequence(sandbox, ['Setup Guide', 'How to set up', 'Author']);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await command.execute();

      const instrDir = path.join(tempDir, 'instructions');
      assert.ok(fs.existsSync(instrDir));
      const files = fs.readdirSync(instrDir);
      assert.ok(files.some(f => f.endsWith('.instructions.md')));
    });

    test('should create agent file in correct folder', async () => {
      pickResourceType(ResourceType.Agent, '$(robot) Agent');
      stubInputSequence(sandbox, ['My Agent', 'An agent', 'Author']);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await command.execute();

      const agentDir = path.join(tempDir, 'agents');
      assert.ok(fs.existsSync(agentDir));
      assert.ok(fs.readdirSync(agentDir).some(f => f.endsWith('.agent.md')));
    });

    test('should create skill file in correct folder', async () => {
      pickResourceType(ResourceType.Skill, '$(lightbulb) Skill');
      stubInputSequence(sandbox, ['My Skill', 'A skill', 'Author']);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      await command.execute();

      const skillDir = path.join(tempDir, 'skills');
      assert.ok(fs.existsSync(skillDir));
      assert.ok(fs.readdirSync(skillDir).some(f => f.endsWith('.skill.md')));
    });

    test('should handle errors gracefully', async () => {
      pickResourceType(ResourceType.Prompt, '$(file-text) Prompt');
      stubInputSequence(sandbox, ['My Prompt', 'Description', 'Author']);
      sandbox.stub(vscode.workspace.fs, 'createDirectory').rejects(new Error('Disk full'));
      const errorStub = sandbox.stub(vscode.window, 'showErrorMessage');

      await command.execute();

      assert.ok(errorStub.calledOnce);
      assert.ok((errorStub.firstCall.args[0] as string).includes('Failed to add resource'));
    });
  });
});
