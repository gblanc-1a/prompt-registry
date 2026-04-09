/**
 * Unit tests for SkillWizard
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  SkillWizard,
} from '../../src/commands/skill-wizard';
import {
  mockWorkspaceFolder,
  stubInputSequence,
  stubWithProgress,
} from '../helpers/command-test-helpers';

suite('SkillWizard', () => {
  let sandbox: sinon.SinonSandbox;
  let wizard: SkillWizard;
  let tempDir: string;
  let restoreWorkspace: () => void;

  setup(() => {
    sandbox = sinon.createSandbox();
    const ws = mockWorkspaceFolder('skill-wizard-test-');
    tempDir = ws.tempDir;
    restoreWorkspace = ws.restore;
    wizard = new SkillWizard();
  });

  teardown(() => {
    sandbox.restore();
    restoreWorkspace();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  suite('isAwesomeCopilotProject()', () => {
    test('should return true when collections dir has .collection.yml files', () => {
      const collectionsDir = path.join(tempDir, 'collections');
      fs.mkdirSync(collectionsDir, { recursive: true });
      fs.writeFileSync(path.join(collectionsDir, 'test.collection.yml'), 'id: test');

      assert.strictEqual(wizard.isAwesomeCopilotProject(tempDir), true);
    });

    test('should return true when skills directory exists', () => {
      fs.mkdirSync(path.join(tempDir, 'skills'), { recursive: true });

      assert.strictEqual(wizard.isAwesomeCopilotProject(tempDir), true);
    });

    test('should return false when neither collections nor skills exist', () => {
      assert.strictEqual(wizard.isAwesomeCopilotProject(tempDir), false);
    });

    test('should return false when collections dir exists but has no .collection.yml files', () => {
      const collectionsDir = path.join(tempDir, 'collections');
      fs.mkdirSync(collectionsDir, { recursive: true });
      fs.writeFileSync(path.join(collectionsDir, 'readme.md'), 'notes');

      assert.strictEqual(wizard.isAwesomeCopilotProject(tempDir), false);
    });
  });

  suite('validateSkillName()', () => {
    test('should accept valid names', () => {
      assert.strictEqual(wizard.validateSkillName('my-skill'), undefined);
      assert.strictEqual(wizard.validateSkillName('skill123'), undefined);
    });

    test('should reject empty name', () => {
      assert.ok(wizard.validateSkillName(''));
      assert.ok(wizard.validateSkillName('  '));
    });

    test('should reject uppercase letters', () => {
      assert.ok(wizard.validateSkillName('MySkill'));
    });

    test('should reject names longer than 64 characters', () => {
      assert.ok(wizard.validateSkillName('a'.repeat(65)));
    });
  });

  suite('validateDescription()', () => {
    test('should accept valid description', () => {
      assert.strictEqual(wizard.validateDescription('A valid description for a skill'), undefined);
    });

    test('should reject empty description', () => {
      assert.ok(wizard.validateDescription(''));
    });

    test('should reject description shorter than 10 characters', () => {
      assert.ok(wizard.validateDescription('short'));
    });

    test('should reject description longer than 1024 characters', () => {
      assert.ok(wizard.validateDescription('x'.repeat(1025)));
    });
  });

  suite('generateSkillContent()', () => {
    test('should generate valid SKILL.md content with frontmatter', () => {
      const content = wizard.generateSkillContent('my-skill', 'A test skill');

      assert.ok(content.includes('---'));
      assert.ok(content.includes('name: my-skill'));
      assert.ok(content.includes('description: "A test skill"'));
      assert.ok(content.includes('# my-skill'));
    });
  });

  suite('addSkillToCollection()', () => {
    test('should add skill entry to collection YAML', async () => {
      const collectionPath = path.join(tempDir, 'test.collection.yml');
      fs.writeFileSync(collectionPath, yaml.dump({ id: 'test', name: 'Test', items: [] }));

      await wizard.addSkillToCollection(collectionPath, 'new-skill');

      const updated = yaml.load(fs.readFileSync(collectionPath, 'utf8')) as any;
      assert.strictEqual(updated.items.length, 1);
      assert.strictEqual(updated.items[0].path, 'skills/new-skill/SKILL.md');
      assert.strictEqual(updated.items[0].kind, 'skill');
    });

    test('should not add duplicate skill', async () => {
      const collectionPath = path.join(tempDir, 'test.collection.yml');
      fs.writeFileSync(collectionPath, yaml.dump({
        id: 'test',
        items: [{ path: 'skills/existing/SKILL.md', kind: 'skill' }]
      }));

      await wizard.addSkillToCollection(collectionPath, 'existing');

      const updated = yaml.load(fs.readFileSync(collectionPath, 'utf8')) as any;
      assert.strictEqual(updated.items.length, 1); // Not duplicated
    });

    test('should create items array if missing', async () => {
      const collectionPath = path.join(tempDir, 'test.collection.yml');
      fs.writeFileSync(collectionPath, yaml.dump({ id: 'test', name: 'Test' }));

      await wizard.addSkillToCollection(collectionPath, 'new-skill');

      const updated = yaml.load(fs.readFileSync(collectionPath, 'utf8')) as any;
      assert.ok(Array.isArray(updated.items));
      assert.strictEqual(updated.items.length, 1);
    });
  });

  suite('execute()', () => {
    test('should return undefined when user cancels skill name', async () => {
      stubInputSequence(sandbox, [undefined]);

      const result = await wizard.execute(tempDir);
      assert.strictEqual(result, undefined);
    });

    test('should return undefined when skill already exists', async () => {
      fs.mkdirSync(path.join(tempDir, 'skills', 'existing'), { recursive: true });
      stubInputSequence(sandbox, ['existing']);
      sandbox.stub(vscode.window, 'showErrorMessage');

      const result = await wizard.execute(tempDir);
      assert.strictEqual(result, undefined);
    });

    test('should return undefined when user cancels description', async () => {
      stubInputSequence(sandbox, ['new-skill', undefined]);

      const result = await wizard.execute(tempDir);
      assert.strictEqual(result, undefined);
    });

    test('should create skill directory and SKILL.md', async () => {
      stubInputSequence(sandbox, ['my-new-skill', 'A description for the new skill']);
      // No collections exist, so no QuickPick for collections
      stubWithProgress(sandbox);
      sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);

      const result = await wizard.execute(tempDir);

      assert.ok(result);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.skillName, 'my-new-skill');

      const skillMdPath = path.join(tempDir, 'skills', 'my-new-skill', 'SKILL.md');
      assert.ok(fs.existsSync(skillMdPath));

      const content = fs.readFileSync(skillMdPath, 'utf8');
      assert.ok(content.includes('my-new-skill'));
    });
  });
});
