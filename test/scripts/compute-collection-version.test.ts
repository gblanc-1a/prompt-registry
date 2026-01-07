/**
 * Compute Collection Version Tests
 * 
 * Transposed from workflow-bundle/test/compute-collection-version.test.js
 * Tests the version computation functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.3
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    createTestProject,
    gitCommitAll,
    gitTag,
    run,
    getBasicScriptEnv,
    TestProject
} from '../helpers/scriptTestHelpers';

suite('Compute Collection Version Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    test('version uses collection.version if greater than last tag, else patch bumps', function() {
        this.timeout(30000);

        project = createTestProject('wf-version-', { initGit: true });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create collection file with version 1.0.0
        const collectionFile = path.join(root, 'collections', 'a.collection.yml');
        fs.mkdirSync(path.dirname(collectionFile), { recursive: true });
        fs.writeFileSync(collectionFile, [
            'id: a',
            'name: A',
            'version: "1.0.0"',
            'items: []',
        ].join('\n'));

        gitCommitAll(root, 'init');

        const versionScript = path.join(scriptsDir, 'compute-collection-version.js');

        // No tags: next is collection.version
        let res = run('node', [
            versionScript,
            '--collection-file',
            'collections/a.collection.yml',
        ], root, env);
        
        assert.strictEqual(res.code, 0, res.stderr);
        const out1 = JSON.parse(res.stdout);
        assert.strictEqual(out1.nextVersion, '1.0.0', 'Without tags, should use collection.version');

        // Add tag a-v1.0.0
        gitTag(root, 'a-v1.0.0');

        // collection.version <= last => patch bump
        res = run('node', [
            versionScript,
            '--collection-file',
            'collections/a.collection.yml',
        ], root, env);
        
        assert.strictEqual(res.code, 0, res.stderr);
        const out2 = JSON.parse(res.stdout);
        assert.strictEqual(out2.nextVersion, '1.0.1', 'When version <= last tag, should patch bump');

        // Manual major bump should be respected
        fs.writeFileSync(collectionFile, [
            'id: a',
            'name: A',
            'version: "2.0.0"',
            'items: []',
        ].join('\n'));

        res = run('node', [
            versionScript,
            '--collection-file',
            'collections/a.collection.yml',
        ], root, env);
        
        assert.strictEqual(res.code, 0, res.stderr);
        const out3 = JSON.parse(res.stdout);
        assert.strictEqual(out3.nextVersion, '2.0.0', 'Manual major bump should be respected');
    });

    test('defaults to 1.0.0 when version field is missing', function() {
        this.timeout(30000);

        project = createTestProject('wf-version-', { initGit: true });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create collection file without version
        const collectionFile = path.join(root, 'collections', 'b.collection.yml');
        fs.mkdirSync(path.dirname(collectionFile), { recursive: true });
        fs.writeFileSync(collectionFile, [
            'id: b',
            'name: B',
            'items: []',
        ].join('\n'));

        gitCommitAll(root, 'init');

        const versionScript = path.join(scriptsDir, 'compute-collection-version.js');

        const res = run('node', [
            versionScript,
            '--collection-file',
            'collections/b.collection.yml',
        ], root, env);
        
        assert.strictEqual(res.code, 0, res.stderr);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.nextVersion, '1.0.0', 'Should default to 1.0.0 when version is missing');
    });

    test('generates correct tag format', function() {
        this.timeout(30000);

        project = createTestProject('wf-version-', { initGit: true });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create collection file
        const collectionFile = path.join(root, 'collections', 'my-collection.collection.yml');
        fs.mkdirSync(path.dirname(collectionFile), { recursive: true });
        fs.writeFileSync(collectionFile, [
            'id: my-collection',
            'name: My Collection',
            'version: "1.2.3"',
            'items: []',
        ].join('\n'));

        gitCommitAll(root, 'init');

        const versionScript = path.join(scriptsDir, 'compute-collection-version.js');

        const res = run('node', [
            versionScript,
            '--collection-file',
            'collections/my-collection.collection.yml',
        ], root, env);
        
        assert.strictEqual(res.code, 0, res.stderr);
        const out = JSON.parse(res.stdout);
        assert.strictEqual(out.tag, 'my-collection-v1.2.3', 'Tag should follow {collection-id}-v{version} format');
    });

    test('fails for invalid semver version', function() {
        this.timeout(30000);

        project = createTestProject('wf-version-', { initGit: true });
        const { root, scriptsDir } = project;
        const env = getBasicScriptEnv();

        // Create collection file with invalid version
        const collectionFile = path.join(root, 'collections', 'c.collection.yml');
        fs.mkdirSync(path.dirname(collectionFile), { recursive: true });
        fs.writeFileSync(collectionFile, [
            'id: c',
            'name: C',
            'version: "invalid"',
            'items: []',
        ].join('\n'));

        gitCommitAll(root, 'init');

        const versionScript = path.join(scriptsDir, 'compute-collection-version.js');

        const res = run('node', [
            versionScript,
            '--collection-file',
            'collections/c.collection.yml',
        ], root, env);
        
        assert.notStrictEqual(res.code, 0, 'Should fail for invalid semver');
        assert.ok(
            res.stderr.toLowerCase().includes('semver') || res.stderr.toLowerCase().includes('version'),
            `Error should mention version issue: ${res.stderr}`
        );
    });
});
