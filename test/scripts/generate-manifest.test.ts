/**
 * Generate Manifest Tests
 * 
 * Transposed from workflow-bundle/test/generate-manifest-cli.test.js
 * Tests the manifest generation functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.7
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    createTestProject,
    writeFile,
    run,
    getBasicScriptEnv,
    TestProject
} from '../helpers/scriptTestHelpers';

suite('Generate Manifest Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    test('supports --collection-file and --out arguments', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create prompt file
        writeFile(root, 'prompts/a.md', '# A\n');

        // Create collection file
        writeFile(
            root,
            'collections/a.collection.yml',
            [
                'id: a',
                'name: A',
                'description: A',
                'items:',
                '  - path: prompts/a.md',
                '    kind: prompt',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '1.2.3',
                '--collection-file', path.join(root, 'collections', 'a.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        assert.ok(fs.existsSync(outPath), 'Output file should exist');
        
        const manifest = fs.readFileSync(outPath, 'utf8');
        assert.match(manifest, /^id: a/m, 'Manifest should have collection id');
        assert.match(manifest, /^version: 1\.2\.3/m, 'Manifest should have correct version');
    });

    test('generates manifest with correct structure', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create files
        writeFile(root, 'prompts/test.md', '# Test Prompt\n\n> A test prompt description');
        writeFile(root, 'instructions/guide.md', '# Guide\n\n> Instruction description');
        writeFile(root, 'agents/helper.md', '# Helper Agent\n\n> Agent description');

        // Create collection file
        writeFile(
            root,
            'collections/full.collection.yml',
            [
                'id: full-collection',
                'name: Full Collection',
                'description: A complete collection',
                'tags:',
                '  - test',
                '  - example',
                'items:',
                '  - path: prompts/test.md',
                '    kind: prompt',
                '  - path: instructions/guide.md',
                '    kind: instruction',
                '  - path: agents/helper.md',
                '    kind: agent',
                'version: "2.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'deployment-manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '2.0.0',
                '--collection-file', path.join(root, 'collections', 'full.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const manifestContent = fs.readFileSync(outPath, 'utf8');
        const manifest = yaml.load(manifestContent) as any;

        // Check required fields - manifest ID is the collection ID, not the bundle ID
        assert.strictEqual(manifest.id, 'full-collection');
        assert.strictEqual(manifest.version, '2.0.0');
        assert.strictEqual(manifest.name, 'Full Collection');
        assert.strictEqual(manifest.description, 'A complete collection');
        
        // Check prompts array
        assert.ok(Array.isArray(manifest.prompts), 'prompts should be an array');
        assert.strictEqual(manifest.prompts.length, 3, 'Should have 3 items');
        
        // Check item types
        const types = manifest.prompts.map((p: any) => p.type);
        assert.ok(types.includes('prompt'), 'Should have prompt type');
        assert.ok(types.includes('instructions'), 'Should have instructions type (mapped from instruction)');
        assert.ok(types.includes('agent'), 'Should have agent type');
    });

    test('extracts name and description from markdown files', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create prompt with title and description
        writeFile(root, 'prompts/documented.md', '# My Documented Prompt\n\n> This is the description from the file');

        // Create collection
        writeFile(
            root,
            'collections/doc.collection.yml',
            [
                'id: doc',
                'name: Doc',
                'description: Documentation test',
                'items:',
                '  - path: prompts/documented.md',
                '    kind: prompt',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '1.0.0',
                '--collection-file', path.join(root, 'collections', 'doc.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const manifest = yaml.load(fs.readFileSync(outPath, 'utf8')) as any;
        const prompt = manifest.prompts[0];
        
        assert.strictEqual(prompt.name, 'My Documented Prompt', 'Should extract name from markdown heading');
        assert.strictEqual(prompt.description, 'This is the description from the file', 'Should extract description from blockquote');
    });

    test('uses filename as fallback for name', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create prompt without heading
        writeFile(root, 'prompts/no-heading.md', 'Just some content without a heading');

        // Create collection
        writeFile(
            root,
            'collections/fallback.collection.yml',
            [
                'id: fallback',
                'name: Fallback',
                'description: Fallback test',
                'items:',
                '  - path: prompts/no-heading.md',
                '    kind: prompt',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '1.0.0',
                '--collection-file', path.join(root, 'collections', 'fallback.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const manifest = yaml.load(fs.readFileSync(outPath, 'utf8')) as any;
        const prompt = manifest.prompts[0];
        
        assert.strictEqual(prompt.name, 'no-heading', 'Should use filename as fallback name');
        assert.strictEqual(prompt.id, 'no-heading', 'Should use filename as id');
    });

    test('fails when referenced file is missing', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create collection referencing non-existent file
        writeFile(
            root,
            'collections/broken.collection.yml',
            [
                'id: broken',
                'name: Broken',
                'description: Missing file',
                'items:',
                '  - path: prompts/missing.md',
                '    kind: prompt',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '1.0.0',
                '--collection-file', path.join(root, 'collections', 'broken.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.notStrictEqual(res.code, 0, 'Should fail when referenced file is missing');
        assert.ok(
            res.stderr.toLowerCase().includes('not found') || res.stdout.toLowerCase().includes('not found'),
            `Error should mention file not found: ${res.stderr || res.stdout}`
        );
    });

    test('uses parent folder name as id for skills', function() {
        this.timeout(30000);

        project = createTestProject('wf-manifest-', { initGit: false });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create skill file in a folder (skills/example-skill/SKILL.md)
        writeFile(root, 'skills/example-skill/SKILL.md', '# Example Skill\n\n> A skill for testing');

        // Create collection with skill
        writeFile(
            root,
            'collections/skill-test.collection.yml',
            [
                'id: skill-test',
                'name: Skill Test',
                'description: Test skill ID generation',
                'items:',
                '  - path: skills/example-skill/SKILL.md',
                '    kind: skill',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const outPath = path.join(root, 'dist', 'manifest.yml');
        const generateScript = path.join(scriptsDir, 'generate-manifest.js');

        const res = run(
            'node',
            [
                generateScript,
                '1.0.0',
                '--collection-file', path.join(root, 'collections', 'skill-test.collection.yml'),
                '--out', outPath,
            ],
            root,
            env,
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const manifest = yaml.load(fs.readFileSync(outPath, 'utf8')) as any;
        const skill = manifest.prompts[0];
        
        assert.strictEqual(skill.type, 'skill', 'Should have skill type');
        assert.strictEqual(skill.id, 'example-skill', 'Skill ID should be parent folder name, not filename');
        assert.strictEqual(skill.name, 'Example Skill', 'Should extract name from markdown heading');
    });

});
