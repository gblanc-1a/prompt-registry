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
        
        assert.strictEqual(result.ok, true, 'Should pass validation');
        assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        assert.ok(result.collection, 'Should return parsed collection');
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

    test('validateAllCollections detects duplicate collection IDs', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        // Create referenced files
        writeFile(root, 'prompts/test1.prompt.md', '# Test 1\n');
        writeFile(root, 'prompts/test2.prompt.md', '# Test 2\n');
        
        // Create two collections with the same ID
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'duplicate-id',
                name: 'Collection A',
                items: [{ path: 'prompts/test1.prompt.md', kind: 'prompt' }],
            })
        );
        
        writeFile(
            root,
            'collections/b.collection.yml',
            yaml.dump({
                id: 'duplicate-id',
                name: 'Collection B',
                items: [{ path: 'prompts/test2.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateAllCollections(root, [
            'collections/a.collection.yml',
            'collections/b.collection.yml'
        ]);
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('duplicate') && e.toLowerCase().includes('id')),
            `Error should mention duplicate ID: ${result.errors.join(', ')}`
        );
    });

    test('validateAllCollections detects duplicate collection names', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        // Create referenced files
        writeFile(root, 'prompts/test1.prompt.md', '# Test 1\n');
        writeFile(root, 'prompts/test2.prompt.md', '# Test 2\n');
        
        // Create two collections with the same name but different IDs
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'collection-a',
                name: 'Same Name',
                items: [{ path: 'prompts/test1.prompt.md', kind: 'prompt' }],
            })
        );
        
        writeFile(
            root,
            'collections/b.collection.yml',
            yaml.dump({
                id: 'collection-b',
                name: 'Same Name',
                items: [{ path: 'prompts/test2.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateAllCollections(root, [
            'collections/a.collection.yml',
            'collections/b.collection.yml'
        ]);
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        assert.ok(
            result.errors.some((e: string) => e.toLowerCase().includes('duplicate') && e.toLowerCase().includes('name')),
            `Error should mention duplicate name: ${result.errors.join(', ')}`
        );
    });

    test('validateAllCollections passes for unique IDs and names', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        // Create referenced files
        writeFile(root, 'prompts/test1.prompt.md', '# Test 1\n');
        writeFile(root, 'prompts/test2.prompt.md', '# Test 2\n');
        
        // Create two collections with unique IDs and names
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'collection-a',
                name: 'Collection A',
                items: [{ path: 'prompts/test1.prompt.md', kind: 'prompt' }],
            })
        );
        
        writeFile(
            root,
            'collections/b.collection.yml',
            yaml.dump({
                id: 'collection-b',
                name: 'Collection B',
                items: [{ path: 'prompts/test2.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateAllCollections(root, [
            'collections/a.collection.yml',
            'collections/b.collection.yml'
        ]);
        
        assert.strictEqual(result.ok, true, 'Should pass validation');
        assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        assert.strictEqual(result.fileResults.length, 2, 'Should have results for both files');
    });

    test('validateCollectionFile returns parsed collection for duplicate detection', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        writeFile(root, 'prompts/test.prompt.md', '# Test\n');
        
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'test-collection',
                name: 'Test Collection',
                items: [{ path: 'prompts/test.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateCollectionFile(root, 'collections/a.collection.yml');
        
        assert.strictEqual(result.ok, true, 'Should pass validation');
        assert.ok(result.collection, 'Should return parsed collection');
        assert.strictEqual(result.collection.id, 'test-collection');
        assert.strictEqual(result.collection.name, 'Test Collection');
    });

    test('validateAllCollections returns structured result for JSON output', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        // Create referenced files
        writeFile(root, 'prompts/test1.prompt.md', '# Test 1\n');
        writeFile(root, 'prompts/test2.prompt.md', '# Test 2\n');
        
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'collection-a',
                name: 'Collection A',
                items: [{ path: 'prompts/test1.prompt.md', kind: 'prompt' }],
            })
        );
        
        writeFile(
            root,
            'collections/b.collection.yml',
            yaml.dump({
                id: 'collection-b',
                name: 'Collection B',
                items: [{ path: 'prompts/test2.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateAllCollections(root, [
            'collections/a.collection.yml',
            'collections/b.collection.yml'
        ]);
        
        // Verify structure needed for markdown generation
        assert.ok('ok' in result, 'Result should have ok property');
        assert.ok('errors' in result, 'Result should have errors property');
        assert.ok('fileResults' in result, 'Result should have fileResults property');
        assert.ok(Array.isArray(result.errors), 'errors should be an array');
        assert.ok(Array.isArray(result.fileResults), 'fileResults should be an array');
        
        // Each fileResult should have file, ok, errors, and collection
        result.fileResults.forEach((fr: any) => {
            assert.ok('file' in fr, 'fileResult should have file property');
            assert.ok('ok' in fr, 'fileResult should have ok property');
            assert.ok('errors' in fr, 'fileResult should have errors property');
        });
    });

    test('generateMarkdown produces success message for valid collections', function() {
        const result = {
            ok: true,
            errors: [],
            fileResults: []
        };
        
        const markdown = validateLib.generateMarkdown(result, 3);
        
        assert.ok(markdown.includes('Collection Validation Results'), 'Should have title');
        assert.ok(markdown.includes('✅'), 'Should have success emoji');
        assert.ok(markdown.includes('3 collection(s) validated successfully'), 'Should mention count');
        assert.ok(!markdown.includes('❌'), 'Should not have error emoji');
    });

    test('generateMarkdown produces error message with details for invalid collections', function() {
        const result = {
            ok: false,
            errors: [
                'collections/a.collection.yml: Missing required field: name',
                'collections/b.collection.yml: Duplicate collection ID \'test-id\' (also in collections/a.collection.yml)'
            ],
            fileResults: []
        };
        
        const markdown = validateLib.generateMarkdown(result, 2);
        
        assert.ok(markdown.includes('Collection Validation Results'), 'Should have title');
        assert.ok(markdown.includes('❌'), 'Should have error emoji');
        assert.ok(markdown.includes('2 error(s)'), 'Should mention error count');
        assert.ok(markdown.includes('### Errors'), 'Should have errors section');
        assert.ok(markdown.includes('Missing required field: name'), 'Should include first error');
        assert.ok(markdown.includes('Duplicate collection ID'), 'Should include second error');
    });

    test('validateAllCollections aggregates all errors including duplicates', function() {
        project = createTestProject('wf-validate-', { copyScripts: false, initGit: false });
        const { root } = project;

        writeFile(root, 'prompts/test.prompt.md', '# Test\n');
        
        // Collection with duplicate ID
        writeFile(
            root,
            'collections/a.collection.yml',
            yaml.dump({
                id: 'same-id',
                name: 'Collection A',
                items: [{ path: 'prompts/test.prompt.md', kind: 'prompt' }],
            })
        );
        
        // Another collection with same ID and missing file
        writeFile(
            root,
            'collections/b.collection.yml',
            yaml.dump({
                id: 'same-id',
                name: 'Collection B',
                items: [{ path: 'prompts/missing.prompt.md', kind: 'prompt' }],
            })
        );

        const result = validateLib.validateAllCollections(root, [
            'collections/a.collection.yml',
            'collections/b.collection.yml'
        ]);
        
        assert.strictEqual(result.ok, false, 'Should fail validation');
        
        // Should have both file-level errors and cross-collection errors
        const hasFileNotFound = result.errors.some((e: string) => e.includes('not found'));
        const hasDuplicateId = result.errors.some((e: string) => e.includes('Duplicate collection ID'));
        
        assert.ok(hasFileNotFound, `Should have file not found error: ${result.errors.join(', ')}`);
        assert.ok(hasDuplicateId, `Should have duplicate ID error: ${result.errors.join(', ')}`);
    });
});