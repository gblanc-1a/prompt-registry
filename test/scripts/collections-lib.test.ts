/**
 * Collections Library Tests
 * 
 * Transposed from workflow-bundle/test/collections-lib.test.js
 * Tests the collections library functions.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.6
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    createTestProject,
    writeFile,
    TestProject
} from '../helpers/scriptTestHelpers';

// Import the collections library from templates
const collectionsLib = require('../../templates/scaffolds/github/scripts/lib/collections.js');

suite('Collections Library Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    suite('listCollectionFiles()', () => {
        test('finds .collection.yml files', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create collection files
            writeFile(root, 'collections/first.collection.yml', 'id: first\nname: First\nitems: []');
            writeFile(root, 'collections/second.collection.yml', 'id: second\nname: Second\nitems: []');
            
            // Create a non-collection file that should be ignored
            writeFile(root, 'collections/readme.md', '# Collections');

            const files = collectionsLib.listCollectionFiles(root);
            
            assert.ok(files.length >= 2, 'Should find at least 2 collection files');
            assert.ok(
                files.every((f: string) => f.endsWith('.collection.yml')),
                'All files should end with .collection.yml'
            );
            assert.ok(
                files.some((f: string) => f.includes('first.collection.yml')),
                'Should find first.collection.yml'
            );
            assert.ok(
                files.some((f: string) => f.includes('second.collection.yml')),
                'Should find second.collection.yml'
            );
        });

        test('returns empty array when no collections exist', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create collections directory but no collection files
            fs.mkdirSync(path.join(root, 'collections'), { recursive: true });
            writeFile(root, 'collections/readme.md', '# Collections');

            const files = collectionsLib.listCollectionFiles(root);
            
            assert.strictEqual(files.length, 0, 'Should return empty array when no collections');
        });
    });

    suite('readCollection()', () => {
        test('parses required fields', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/test.collection.yml', `
id: test-collection
name: Test Collection
description: A test collection
version: "1.0.0"
items:
  - path: prompts/test.md
    kind: prompt
`);

            const collection = collectionsLib.readCollection(root, 'collections/test.collection.yml');
            
            assert.strictEqual(typeof collection.id, 'string', 'id should be a string');
            assert.strictEqual(collection.id, 'test-collection');
            assert.strictEqual(typeof collection.name, 'string', 'name should be a string');
            assert.strictEqual(collection.name, 'Test Collection');
            assert.ok(Array.isArray(collection.items), 'items should be an array');
            assert.strictEqual(collection.items.length, 1);
        });

        test('handles optional fields', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/minimal.collection.yml', `
id: minimal
name: Minimal
items: []
`);

            const collection = collectionsLib.readCollection(root, 'collections/minimal.collection.yml');
            
            assert.strictEqual(collection.id, 'minimal');
            assert.strictEqual(collection.name, 'Minimal');
            assert.deepStrictEqual(collection.items, []);
            assert.strictEqual(collection.version, undefined, 'version should be undefined when not specified');
        });

        test('throws for invalid YAML', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/invalid.collection.yml', `
id: test
name: Test
items: [unclosed bracket
`);

            assert.throws(
                () => collectionsLib.readCollection(root, 'collections/invalid.collection.yml'),
                /yaml|parse/i,
                'Should throw for invalid YAML'
            );
        });
    });

    suite('resolveCollectionItemPaths()', () => {
        test('returns repo-root relative paths', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts/first.md', kind: 'prompt' },
                    { path: 'prompts/second.md', kind: 'prompt' },
                    { path: 'instructions/inst.md', kind: 'instruction' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 3, 'Should return 3 paths');
            assert.ok(
                paths.every((p: string) => !p.startsWith('..')),
                'Paths should not start with ..'
            );
            assert.ok(
                paths.every((p: string) => !p.startsWith('/')),
                'Paths should not be absolute'
            );
            assert.deepStrictEqual(paths, [
                'prompts/first.md',
                'prompts/second.md',
                'instructions/inst.md'
            ]);
        });

        test('handles empty items array', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'empty',
                name: 'Empty',
                items: []
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.deepStrictEqual(paths, [], 'Should return empty array for empty items');
        });

        test('normalizes Windows-style paths', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts\\windows\\style.md', kind: 'prompt' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 1);
            assert.ok(
                !paths[0].includes('\\'),
                'Paths should use forward slashes'
            );
        });

        test('filters out items without path', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts/valid.md', kind: 'prompt' },
                    { kind: 'prompt' }, // Missing path
                    { path: '', kind: 'prompt' }, // Empty path
                    { path: 'prompts/another.md', kind: 'prompt' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 2, 'Should only return items with valid paths');
            assert.deepStrictEqual(paths, [
                'prompts/valid.md',
                'prompts/another.md'
            ]);
        });
    });
});
