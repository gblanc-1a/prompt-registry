/**
 * Validate Collections Tests
 * 
 * Transposed from workflow-bundle/test/validate-collections.test.js
 * Tests the collection validation functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.5
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
    createTestProject,
    writeFile,
    TestProject
} from '../helpers/scriptTestHelpers';

// Import the validation library from templates
const validateLib = require('../../templates/scaffolds/github/scripts/lib/validate.js');

suite('Validate Collections Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    test('validateCollectionFile fails when required fields are missing', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'a',
                // name missing
                items: [],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.join('\n').toLowerCase().includes('name'),
            `Error should mention missing 'name' field: ${result.errors.join(', ')}`
        );
    });

    test('validateCollectionFile fails when referenced file is missing', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'a',
                name: 'A',
                items: [{ path: 'prompts/missing.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.join('\n').toLowerCase().includes('not found'),
            `Error should mention file not found: ${result.errors.join(', ')}`
        );
    });

    test('validateCollectionFile passes for minimal valid collection', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        // Create the referenced file
        writeFile(root, 'prompts/ok.prompt.md', '# OK\n');
        
        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'a',
                name: 'A',
                items: [{ path: 'prompts/ok.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.deepStrictEqual(result, { ok: true, errors: [] });
    });

    test('validateCollectionFile fails for invalid item kind', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        writeFile(root, 'prompts/test.md', '# Test\n');
        
        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'a',
                name: 'A',
                items: [{ path: 'prompts/test.md', kind: 'invalid-kind' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('invalid') && e.toLowerCase().includes('kind')),
            `Error should mention invalid kind: ${result.errors.join(', ')}`
        );
    });

    test('validateCollectionFile fails for chatmode kind (deprecated)', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        writeFile(root, 'agents/test.md', '# Test\n');
        
        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'a',
                name: 'A',
                items: [{ path: 'agents/test.md', kind: 'chatmode' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('deprecated')),
            `Error should mention deprecation: ${result.errors.join(', ')}`
        );
    });

    test('validateCollectionFile fails for invalid collection ID', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        writeFile(root, 'prompts/test.md', '# Test\n');
        
        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'Invalid ID With Spaces',
                name: 'A',
                items: [{ path: 'prompts/test.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('id')),
            `Error should mention ID issue: ${result.errors.join(', ')}`
        );
    });

    test('validateCollectionFile fails for invalid YAML syntax', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        const collectionPath = writeFile(
            root,
            'collections/a.collection.yml',
            `
id: test
name: Test
items:
  - path: test.md
    kind: prompt
  invalid yaml here: [unclosed bracket
`
        );

        const result = validateLib.validateCollectionFile(root, path.relative(root, collectionPath));
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('yaml') || e.toLowerCase().includes('parse')),
            `Error should mention YAML parsing issue: ${result.errors.join(', ')}`
        );
    });
});
