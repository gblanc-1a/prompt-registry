/**
 * Build Collection Bundle Tests
 * 
 * Transposed from workflow-bundle/test/build-collection-bundle.test.js
 * Tests the bundle building functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.4
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    createTestProject,
    writeFile,
    run,
    unzipFile,
    unzipList,
    getBasicScriptEnv,
    TestProject
} from '../helpers/scriptTestHelpers';

suite('Build Collection Bundle Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    test('outputs manifest asset and zip with only referenced files', function() {
        this.timeout(30000);

        project = createTestProject('wf-bundle-', { initGit: false });
        const { root, scriptsDir } = project;

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

        const buildScript = path.join(scriptsDir, 'build-collection-bundle.js');
        const res = run(
            'node',
            [
                buildScript,
                '--collection-file', 'collections/a.collection.yml',
                '--version', '1.2.3',
                '--repo-slug', 'repo',
                '--out-dir', 'dist',
            ],
            root,
            getBasicScriptEnv(),
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const out = JSON.parse(res.stdout);
        
        // Check manifest asset exists
        assert.ok(
            fs.existsSync(path.join(root, out.manifestAsset)),
            `Manifest asset should exist at ${out.manifestAsset}`
        );
        
        // Check zip asset exists
        assert.ok(
            fs.existsSync(path.join(root, out.zipAsset)),
            `Zip asset should exist at ${out.zipAsset}`
        );

        // Check standalone manifest content
        const standaloneManifest = yaml.load(
            fs.readFileSync(path.join(root, out.manifestAsset), 'utf8')
        ) as any;
        assert.strictEqual(standaloneManifest.version, '1.2.3', 'Manifest version should match');
        assert.strictEqual(standaloneManifest.id, 'a', 'Manifest ID should be the collection ID');

        // Check zipped manifest content
        const zippedManifestContent = unzipFile(
            path.join(root, out.zipAsset),
            'deployment-manifest.yml',
            root
        );
        const zippedManifest = yaml.load(zippedManifestContent) as any;
        assert.strictEqual(zippedManifest.id, standaloneManifest.id, 'Zipped manifest ID should match standalone');
        assert.strictEqual(zippedManifest.version, standaloneManifest.version, 'Zipped manifest version should match standalone');

        // Check zip contents
        const listing = unzipList(path.join(root, out.zipAsset), root);
        assert.match(listing, /deployment-manifest\.yml/, 'Zip should contain deployment-manifest.yml');
        assert.match(listing, /prompts\/a\.md/, 'Zip should contain referenced prompt file');
        assert.doesNotMatch(listing, /collections\/a\.collection\.yml/, 'Zip should not contain collection file itself');
    });

    test('includes all referenced files in zip', function() {
        this.timeout(30000);

        project = createTestProject('wf-bundle-', { initGit: false });
        const { root, scriptsDir } = project;

        // Create multiple files
        writeFile(root, 'prompts/prompt1.md', '# Prompt 1\n');
        writeFile(root, 'prompts/prompt2.md', '# Prompt 2\n');
        writeFile(root, 'instructions/inst1.md', '# Instruction 1\n');
        writeFile(root, 'agents/agent1.md', '# Agent 1\n');

        // Create collection with multiple items
        writeFile(
            root,
            'collections/multi.collection.yml',
            [
                'id: multi',
                'name: Multi',
                'description: Multiple items',
                'items:',
                '  - path: prompts/prompt1.md',
                '    kind: prompt',
                '  - path: prompts/prompt2.md',
                '    kind: prompt',
                '  - path: instructions/inst1.md',
                '    kind: instruction',
                '  - path: agents/agent1.md',
                '    kind: agent',
                'version: "1.0.0"',
            ].join('\n'),
        );

        const buildScript = path.join(scriptsDir, 'build-collection-bundle.js');
        const res = run(
            'node',
            [
                buildScript,
                '--collection-file', 'collections/multi.collection.yml',
                '--version', '1.0.0',
                '--repo-slug', 'test-repo',
                '--out-dir', 'dist',
            ],
            root,
            getBasicScriptEnv(),
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const out = JSON.parse(res.stdout);
        const listing = unzipList(path.join(root, out.zipAsset), root);

        // All referenced files should be in the zip
        assert.match(listing, /prompts\/prompt1\.md/, 'Zip should contain prompt1');
        assert.match(listing, /prompts\/prompt2\.md/, 'Zip should contain prompt2');
        assert.match(listing, /instructions\/inst1\.md/, 'Zip should contain instruction');
        assert.match(listing, /agents\/agent1\.md/, 'Zip should contain agent');
    });

    test('bundle ID format is correct', function() {
        this.timeout(30000);

        project = createTestProject('wf-bundle-', { initGit: false });
        const { root, scriptsDir } = project;

        writeFile(root, 'prompts/test.md', '# Test\n');

        writeFile(
            root,
            'collections/my-collection.collection.yml',
            [
                'id: my-collection',
                'name: My Collection',
                'description: Test',
                'items:',
                '  - path: prompts/test.md',
                '    kind: prompt',
                'version: "2.1.0"',
            ].join('\n'),
        );

        const buildScript = path.join(scriptsDir, 'build-collection-bundle.js');
        const res = run(
            'node',
            [
                buildScript,
                '--collection-file', 'collections/my-collection.collection.yml',
                '--version', '2.1.0',
                '--repo-slug', 'my-repo',
                '--out-dir', 'dist',
            ],
            root,
            getBasicScriptEnv(),
        );

        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        
        const out = JSON.parse(res.stdout);
        assert.strictEqual(
            out.bundleId,
            'my-repo-my-collection-v2.1.0',
            'Bundle ID should follow {repo-slug}-{collection-id}-v{version} format'
        );
    });

    test('fails when collection file is missing', function() {
        this.timeout(30000);

        project = createTestProject('wf-bundle-', { initGit: false });
        const { root, scriptsDir } = project;

        const buildScript = path.join(scriptsDir, 'build-collection-bundle.js');
        const res = run(
            'node',
            [
                buildScript,
                '--collection-file', 'collections/nonexistent.collection.yml',
                '--version', '1.0.0',
                '--repo-slug', 'repo',
                '--out-dir', 'dist',
            ],
            root,
            getBasicScriptEnv(),
        );

        assert.notStrictEqual(res.code, 0, 'Should fail when collection file is missing');
    });

    test('fails when referenced file is missing', function() {
        this.timeout(30000);

        project = createTestProject('wf-bundle-', { initGit: false });
        const { root, scriptsDir } = project;

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

        const buildScript = path.join(scriptsDir, 'build-collection-bundle.js');
        const res = run(
            'node',
            [
                buildScript,
                '--collection-file', 'collections/broken.collection.yml',
                '--version', '1.0.0',
                '--repo-slug', 'repo',
                '--out-dir', 'dist',
            ],
            root,
            getBasicScriptEnv(),
        );

        assert.notStrictEqual(res.code, 0, 'Should fail when referenced file is missing');
        assert.ok(
            res.stderr.toLowerCase().includes('not found') || res.stderr.toLowerCase().includes('missing'),
            `Error should mention missing file: ${res.stderr}`
        );
    });
});
