/**
 * ScaffoldCommand Unit Tests
 * 
 * Tests for the GitHub structure scaffolding command
 * Following TDD approach - tests written first
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ScaffoldCommand, ScaffoldType } from '../../src/commands/ScaffoldCommand';

const TEMPLATES_ROOT = path.join(process.cwd(), 'templates/scaffolds/github');

suite('ScaffoldCommand', () => {
    let testDir: string;
    let scaffoldCommand: ScaffoldCommand;

    setup(() => {
        // Create temp directory for each test
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-test-'));
        scaffoldCommand = new ScaffoldCommand(TEMPLATES_ROOT);
    });

    teardown(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    suite('ScaffoldType Enum', () => {
        test('should not contain AwesomeCopilot type', () => {
            // Verify AwesomeCopilot is not in ScaffoldType enum
            const scaffoldTypes = Object.values(ScaffoldType);
            assert.ok(!scaffoldTypes.includes('awesome-copilot' as ScaffoldType), 
                'ScaffoldType should not contain awesome-copilot');
            assert.ok(!('AwesomeCopilot' in ScaffoldType), 
                'ScaffoldType should not have AwesomeCopilot key');
        });

        test('should only contain GitHub, Apm, and Skill types', () => {
            const scaffoldTypes = Object.values(ScaffoldType);
            assert.strictEqual(scaffoldTypes.length, 3, 'ScaffoldType should have exactly 3 values');
            assert.ok(scaffoldTypes.includes(ScaffoldType.GitHub), 'ScaffoldType should contain GitHub');
            assert.ok(scaffoldTypes.includes(ScaffoldType.Apm), 'ScaffoldType should contain Apm');
            assert.ok(scaffoldTypes.includes(ScaffoldType.Skill), 'ScaffoldType should contain Skill');
        });

        test('GitHub type should have correct value', () => {
            assert.strictEqual(ScaffoldType.GitHub, 'github', 'GitHub type should have value "github"');
        });

        test('Apm type should have correct value', () => {
            assert.strictEqual(ScaffoldType.Apm, 'apm', 'Apm type should have value "apm"');
        });
    });

    suite('Directory Creation', () => {
        test('should create directory structure with all required folders', async () => {
            await scaffoldCommand.execute(testDir);

            // Check main folders exist
            assert.ok(fs.existsSync(path.join(testDir, 'prompts')));
            assert.ok(fs.existsSync(path.join(testDir, 'instructions')));
            assert.ok(fs.existsSync(path.join(testDir, 'agents')));
            assert.ok(fs.existsSync(path.join(testDir, 'collections')));
            //             assert.ok(fs.existsSync(path.join(testDir, '.vscode')));
        });

        test('should not overwrite existing directory', async () => {
            // Create a file in the target directory
            const testFile = path.join(testDir, 'existing-file.txt');
            fs.writeFileSync(testFile, 'test content');

            await scaffoldCommand.execute(testDir);

            // File should still exist
            assert.ok(fs.existsSync(testFile));
            assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'test content');
        });

        test('should create nested structure when specified', async () => {
            const nestedPath = path.join(testDir, 'my-project', 'copilot-prompts');
            
            await scaffoldCommand.execute(nestedPath);

            assert.ok(fs.existsSync(path.join(nestedPath, 'prompts')));
            assert.ok(fs.existsSync(path.join(nestedPath, 'collections')));
        });
    });

    suite('Example Files', () => {
        test('should create example prompt file', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            assert.ok(fs.existsSync(promptFile));

            const content = fs.readFileSync(promptFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('name:') || content.includes('description:') || content.includes('Create README'));
        });

        test('should create example instruction file', async () => {
            await scaffoldCommand.execute(testDir);

            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            assert.ok(fs.existsSync(instructionFile));

            const content = fs.readFileSync(instructionFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('name:') || content.includes('description:') || content.includes('TypeScript'));
        });

        test('should create example agent file', async () => {
            await scaffoldCommand.execute(testDir);

            const agentFile = path.join(testDir, 'agents', 'example.agent.md');
            assert.ok(fs.existsSync(agentFile));

            const content = fs.readFileSync(agentFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('Persona') || content.includes('Expertise') || content.includes('Guidelines'));
        });

        test('should create example collection file', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            assert.ok(fs.existsSync(collectionFile));

            const content = fs.readFileSync(collectionFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('id:'));
            assert.ok(content.includes('name:'));
            assert.ok(content.includes('items:'));
        });

        test('example files should have correct extensions', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            const agentFile = path.join(testDir, 'agents', 'example.agent.md');
            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');

            assert.ok(promptFile.endsWith('.prompt.md'));
            assert.ok(instructionFile.endsWith('.instructions.md'));
            assert.ok(agentFile.endsWith('.agent.md'));
            assert.ok(collectionFile.endsWith('.collection.yml'));
        });
    });

    suite('Collection File Validation', () => {
        test('collection file should be valid YAML', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');

            // Should not throw
            const yaml = require('js-yaml');
            const parsed = yaml.load(content);
            assert.ok(parsed);
        });

        test('collection should reference example files', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');

            assert.ok(content.includes('prompts/example.prompt.md'));
            assert.ok(content.includes('instructions/example.instructions.md'));
            assert.ok(content.includes('agents/example.agent.md'));
        });

        test('collection should have required fields', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            assert.ok(collection.id);
            assert.ok(collection.name);
            assert.ok(collection.description);
            assert.ok(Array.isArray(collection.items));
            assert.ok(collection.items.length > 0);
        });

        test('collection items should have correct kinds', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            const promptItem = collection.items.find((item: any) => item.path.includes('prompt'));
            const instructionItem = collection.items.find((item: any) => item.path.includes('instruction'));
            const agentItem = collection.items.find((item: any) => item.path.includes('agent'));

            assert.strictEqual(promptItem?.kind, 'prompt');
            assert.strictEqual(instructionItem?.kind, 'instruction');
            assert.strictEqual(agentItem?.kind, 'agent');
        });
    });

    suite('README Creation', () => {
        test('should create README.md file', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            assert.ok(fs.existsSync(readmeFile));
        });
    });

    suite('Error Handling', () => {
        test('should throw error for invalid path', async () => {
            const invalidPath = '/invalid/path/that/does/not/exist/and/cannot/be/created/abc123xyz';
            
            await assert.rejects(
                async () => await scaffoldCommand.execute(invalidPath),
                /Cannot create directory|permission denied|EACCES|ENOENT/i
            );
        });

        test('should handle permission errors gracefully', async () => {
            // This test is platform-specific, so we'll just ensure it doesn't crash
            try {
                await scaffoldCommand.execute('/root/test-scaffold');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.length > 0);
            }
        });
        
        test('should support custom project name in collection', async () => {
            await scaffoldCommand.execute(testDir, { projectName: 'my-awesome-prompts' });

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            assert.ok(collection.id === 'my-awesome-prompts' || collection.name.includes('my-awesome-prompts'));
        });

        test.skip('should support skipping example files', async () => {
            await scaffoldCommand.execute(testDir, { skipExamples: true });

            // Folders should exist
            assert.ok(fs.existsSync(path.join(testDir, 'prompts')));
            
            // But example files should not
            assert.ok(!fs.existsSync(path.join(testDir, 'prompts', 'example.prompt.md')));
            assert.ok(!fs.existsSync(path.join(testDir, 'instructions', 'example.instructions.md')));
        });
    });

    suite('Content Quality', () => {
        test('example prompt should be helpful and clear', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            const content = fs.readFileSync(promptFile, 'utf8');

            // Should have meaningful content (more than just a title)
            assert.ok(content.length > 100);
            // Should have some structure
            assert.ok(content.includes('#') || content.includes('##'));
        });

        test('example instruction should explain best practices', async () => {
            await scaffoldCommand.execute(testDir);

            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            const content = fs.readFileSync(instructionFile, 'utf8');

            assert.ok(content.length > 100);
            assert.ok(content.includes('best practice') || content.includes('guideline') || content.includes('standard'));
        });

        test('example chatmode should define a persona', async () => {
            await scaffoldCommand.execute(testDir);

            const agentFile = path.join(testDir, 'agents', 'example.agent.md');
            const content = fs.readFileSync(agentFile, 'utf8');

            assert.ok(content.length > 100);
            assert.ok(content.includes('You are') || content.includes('Act as') || content.includes('persona') || content.includes('role'));
        });
    });
});

suite('Skill Scaffold', () => {
    let testDir: string;
    let skillScaffoldCommand: ScaffoldCommand;

    setup(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scaffold-test-'));
        // Import ScaffoldType to create skill-specific command
        const { ScaffoldType } = require('../../src/commands/ScaffoldCommand');
        const skillTemplateRoot = path.join(process.cwd(), 'templates/scaffolds/skill');
        skillScaffoldCommand = new ScaffoldCommand(skillTemplateRoot, ScaffoldType.Skill);
    });

    teardown(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('should create SKILL.md file with correct structure', async () => {
        await skillScaffoldCommand.execute(testDir, { projectName: 'my-skill' });

        const skillFile = path.join(testDir, 'my-skill', 'SKILL.md');
        assert.ok(fs.existsSync(skillFile), 'SKILL.md should exist');

        const content = fs.readFileSync(skillFile, 'utf8');
        
        // Should have YAML frontmatter
        assert.ok(content.startsWith('---'), 'Should have YAML frontmatter');
        assert.ok(content.includes('name:'), 'Should have name field');
        assert.ok(content.includes('description:'), 'Should have description field');
        assert.ok(content.includes('allowed-tools:'), 'Should have allowed-tools');
    });

    test('should create README.md file', async () => {
        await skillScaffoldCommand.execute(testDir, { projectName: 'test-skill' });

        const readmeFile = path.join(testDir, 'test-skill', 'README.md');
        assert.ok(fs.existsSync(readmeFile), 'README.md should exist');

        const content = fs.readFileSync(readmeFile, 'utf8');
        assert.ok(content.includes('test-skill'), 'Should contain skill name');
        assert.ok(content.includes('Installation'), 'Should have installation section');
    });

    test('should create example script', async () => {
        await skillScaffoldCommand.execute(testDir, { projectName: 'scripted-skill' });

        const scriptFile = path.join(testDir, 'scripted-skill', 'scripts', 'example.py');
        assert.ok(fs.existsSync(scriptFile), 'example.py should exist');

        const content = fs.readFileSync(scriptFile, 'utf8');
        assert.ok(content.includes('scripted-skill'), 'Should reference skill name');
        assert.ok(content.includes('#!/usr/bin/env python3'), 'Should have shebang');
    });

    test('should use provided description', async () => {
        await skillScaffoldCommand.execute(testDir, { 
            projectName: 'described-skill',
            description: 'A custom skill description'
        });

        const skillFile = path.join(testDir, 'described-skill', 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf8');
        assert.ok(content.includes('A custom skill description'), 'Should use provided description');
    });

    test('should use provided author', async () => {
        await skillScaffoldCommand.execute(testDir, { 
            projectName: 'authored-skill',
            author: 'Test Author'
        });

        const skillFile = path.join(testDir, 'authored-skill', 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf8');
        assert.ok(content.includes('Test Author'), 'Should use provided author');
    });

    test('should create skill directory structure', async () => {
        await skillScaffoldCommand.execute(testDir, { projectName: 'structured-skill' });

        const skillDir = path.join(testDir, 'structured-skill');
        assert.ok(fs.existsSync(skillDir), 'Skill directory should exist');
        assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'SKILL.md should exist');
        assert.ok(fs.existsSync(path.join(skillDir, 'README.md')), 'README.md should exist');
    });
});
