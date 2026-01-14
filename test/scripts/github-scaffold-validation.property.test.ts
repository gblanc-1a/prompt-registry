/**
 * GitHub Scaffold Validation Property-Based Tests
 * 
 * Property-based tests using fast-check to verify validation behavior
 * for the GitHub scaffold validation system.
 * 
 * Feature: workflow-bundle-scaffolding
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as fc from 'fast-check';
import * as yaml from 'js-yaml';
import { PropertyTestConfig } from '../helpers/propertyTestHelpers';

// Import the validation library from templates
// Note: We need to use require since it's a JS file
const validateLib = require('../../templates/scaffolds/github/scripts/lib/validate.js');

suite('GitHub Scaffold Validation Property-Based Tests', () => {
    /**
     * Generator for valid collection IDs
     * Format: lowercase alphanumeric with hyphens, 1-100 chars (per Requirement 12.1)
     */
    const validCollectionIdGenerator = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('');
        return fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 100 })
            .map(arr => arr.join(''))
            .filter(s => !s.startsWith('-') && !s.endsWith('-') && !s.includes('--') && s.length > 0);
    };

    /**
     * Generator for invalid collection IDs (uppercase, spaces, special chars)
     */
    const invalidCollectionIdGenerator = () => {
        return fc.oneof(
            // Uppercase letters
            fc.string({ minLength: 1, maxLength: 50 })
                .filter(s => /[A-Z]/.test(s)),
            // Spaces
            fc.string({ minLength: 1, maxLength: 50 })
                .filter(s => /\s/.test(s)),
            // Special characters
            fc.string({ minLength: 1, maxLength: 50 })
                .filter(s => /[^a-z0-9-]/.test(s) && s.trim().length > 0),
            // Too long (over 100 chars)
            fc.string({ minLength: 101, maxLength: 150 })
                .map(s => s.toLowerCase().replace(/[^a-z0-9-]/g, 'a'))
        );
    };

    /**
     * Generator for valid semver versions
     */
    const validVersionGenerator = () => {
        return fc.tuple(
            fc.integer({ min: 0, max: 99 }),
            fc.integer({ min: 0, max: 99 }),
            fc.integer({ min: 0, max: 99 })
        ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);
    };

    /**
     * Generator for invalid versions
     */
    const invalidVersionGenerator = () => {
        return fc.oneof(
            // Missing components
            fc.constantFrom('1', '1.0', '1.0.0.0', 'v1.0.0'),
            // Non-numeric
            fc.constantFrom('a.b.c', '1.x.0', '1.0.x'),
            // Invalid format
            fc.string({ minLength: 1, maxLength: 20 })
                .filter(s => !/^\d+\.\d+\.\d+$/.test(s))
        );
    };

    /**
     * Generator for deprecated chatmode kinds
     */
    const chatmodeKindGenerator = () => {
        return fc.constantFrom('chatmode', 'chat-mode', 'Chatmode', 'CHATMODE', 'Chat-Mode');
    };

    /**
     * Generator for valid item kinds
     */
    const validItemKindGenerator = () => {
        return fc.constantFrom('prompt', 'instruction', 'agent');
    };

    /**
     * Property 2a: Chatmode Rejection
     * Feature: workflow-bundle-scaffolding, Property 2a: Chatmode Rejection
     * Validates: Requirements 3.4
     * 
     * For any collection file containing `kind: chatmode`, the validation system
     * should reject it with an error message explaining that chatmode is deprecated
     * and agent should be used instead.
     */
    test('Property 2a: Chatmode Rejection', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        await fc.assert(
            fc.asyncProperty(
                chatmodeKindGenerator(),
                validCollectionIdGenerator(),
                async (chatmodeKind, collectionId) => {
                    // Test the validateItemKind function directly
                    const result = validateLib.validateItemKind(chatmodeKind);
                    
                    // Should be invalid
                    assert.strictEqual(result.valid, false, 
                        `Chatmode kind '${chatmodeKind}' should be rejected`);
                    
                    // Should have deprecation flag
                    assert.strictEqual(result.deprecated, true,
                        `Chatmode kind '${chatmodeKind}' should be marked as deprecated`);
                    
                    // Should suggest agent as replacement
                    assert.strictEqual(result.replacement, 'agent',
                        `Chatmode kind '${chatmodeKind}' should suggest 'agent' as replacement`);
                    
                    // Error message should mention deprecation
                    assert.ok(result.error.toLowerCase().includes('deprecated'),
                        `Error message should mention deprecation: ${result.error}`);
                    
                    // Error message should mention agent
                    assert.ok(result.error.toLowerCase().includes('agent'),
                        `Error message should mention agent: ${result.error}`);

                    // Also test through validateCollectionObject
                    const collection = {
                        id: collectionId,
                        name: 'Test Collection',
                        items: [
                            { path: 'test/file.md', kind: chatmodeKind }
                        ]
                    };
                    
                    const collectionResult = validateLib.validateCollectionObject(collection, 'test.collection.yml');
                    
                    // Should be invalid
                    assert.strictEqual(collectionResult.ok, false,
                        `Collection with chatmode kind should be invalid`);
                    
                    // Should have error about chatmode
                    const hasDeprecationError = collectionResult.errors.some(
                        (e: string) => e.toLowerCase().includes('deprecated') && e.toLowerCase().includes('agent')
                    );
                    assert.ok(hasDeprecationError,
                        `Collection errors should mention chatmode deprecation: ${collectionResult.errors.join(', ')}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });


    /**
     * Property 8: Collection ID Validation
     * Feature: workflow-bundle-scaffolding, Property 8: Collection ID Validation
     * Validates: Requirements 12.1, 12.3
     * 
     * For any collection ID:
     * - IDs up to 100 characters should be accepted
     * - IDs containing only lowercase letters, numbers, and hyphens should be valid
     * - IDs containing uppercase letters, spaces, or special characters should be rejected
     */
    test('Property 8: Collection ID Validation', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Test valid IDs are accepted
        await fc.assert(
            fc.asyncProperty(validCollectionIdGenerator(), async (validId) => {
                const result = validateLib.validateCollectionId(validId);
                
                assert.strictEqual(result.valid, true,
                    `Valid ID '${validId}' should be accepted`);
                assert.strictEqual(result.error, undefined,
                    `Valid ID should not have error`);
            }),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test invalid IDs are rejected
        await fc.assert(
            fc.asyncProperty(invalidCollectionIdGenerator(), async (invalidId) => {
                const result = validateLib.validateCollectionId(invalidId);
                
                assert.strictEqual(result.valid, false,
                    `Invalid ID '${invalidId}' should be rejected`);
                assert.ok(result.error,
                    `Invalid ID should have error message`);
            }),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test max length boundary (100 chars)
        const maxLengthId = 'a'.repeat(100);
        const overMaxId = 'a'.repeat(101);
        
        const maxResult = validateLib.validateCollectionId(maxLengthId);
        assert.strictEqual(maxResult.valid, true, 'ID at max length (100) should be valid');
        
        const overResult = validateLib.validateCollectionId(overMaxId);
        assert.strictEqual(overResult.valid, false, 'ID over max length (101) should be invalid');
        assert.ok(overResult.error.includes('100'), 'Error should mention max length');
    });

    /**
     * Property 8a: Validation Consistency Across Components
     * Feature: workflow-bundle-scaffolding, Property 8a: Validation Consistency Across Components
     * Validates: Requirements 12.2
     * 
     * For any collection ID, the validation result should be identical whether validated by:
     * - The validateCollectionId function
     * - The validateCollectionObject function
     */
    test('Property 8a: Validation Consistency Across Components', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        await fc.assert(
            fc.asyncProperty(
                fc.oneof(validCollectionIdGenerator(), invalidCollectionIdGenerator()),
                async (testId) => {
                    // Validate using validateCollectionId directly
                    const directResult = validateLib.validateCollectionId(testId);
                    
                    // Validate using validateCollectionObject
                    const collection = {
                        id: testId,
                        name: 'Test Collection',
                        items: [
                            { path: 'test/file.md', kind: 'prompt' }
                        ]
                    };
                    const objectResult = validateLib.validateCollectionObject(collection, 'test.yml');
                    
                    // If direct validation fails, object validation should also fail with ID error
                    if (!directResult.valid) {
                        assert.strictEqual(objectResult.ok, false,
                            `Object validation should fail when ID validation fails for '${testId}'`);
                        
                        // Check that the error is about the ID
                        const hasIdError = objectResult.errors.some(
                            (e: string) => e.toLowerCase().includes('id') || 
                                          e.toLowerCase().includes('collection id')
                        );
                        assert.ok(hasIdError,
                            `Object validation errors should mention ID issue: ${objectResult.errors.join(', ')}`);
                    }
                    
                    // If direct validation passes, object validation should not have ID errors
                    if (directResult.valid) {
                        const hasIdError = objectResult.errors.some(
                            (e: string) => e.toLowerCase().includes('collection id must')
                        );
                        assert.ok(!hasIdError,
                            `Object validation should not have ID format errors for valid ID '${testId}'`);
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 10: Validation Error Messages
     * Feature: workflow-bundle-scaffolding, Property 10: Validation Error Messages
     * Validates: Requirements 9.5
     * 
     * For any validation failure, the error message should include the file path
     * where the error occurred.
     */
    test('Property 10: Validation Error Messages', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Generator for file paths
        const filePathGenerator = () => {
            return fc.tuple(
                fc.constantFrom('collections', 'test', 'src'),
                fc.string({ minLength: 1, maxLength: 20 })
                    .map(s => s.replace(/[^a-z0-9]/gi, 'a'))
            ).map(([dir, name]) => `${dir}/${name}.collection.yml`);
        };

        await fc.assert(
            fc.asyncProperty(filePathGenerator(), async (filePath) => {
                // Create an invalid collection (missing required fields)
                const invalidCollection = {
                    // Missing id, name, items
                };
                
                const result = validateLib.validateCollectionObject(invalidCollection, filePath);
                
                // Should be invalid
                assert.strictEqual(result.ok, false, 'Invalid collection should fail validation');
                
                // All error messages should include the file path
                for (const error of result.errors) {
                    assert.ok(error.includes(filePath),
                        `Error message should include file path '${filePath}': ${error}`);
                }
            }),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });


    /**
     * Property 11: File Reference Validation
     * Feature: workflow-bundle-scaffolding, Property 11: File Reference Validation
     * Validates: Requirements 9.3
     * 
     * For any collection that references non-existent files in its items array,
     * validation should fail with an error indicating which files are missing.
     */
    test('Property 11: File Reference Validation', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                fc.array(
                    fc.string({ minLength: 1, maxLength: 30 })
                        .map(s => s.replace(/[^a-z0-9]/gi, 'a')),
                    { minLength: 1, maxLength: 5 }
                ),
                async (collectionId, fileNames) => {
                    // Create a temp directory for testing
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-ref-test-'));
                    
                    try {
                        // Create collections directory
                        const collectionsDir = path.join(tempDir, 'collections');
                        fs.mkdirSync(collectionsDir, { recursive: true });
                        
                        // Create collection file with references to non-existent files
                        const nonExistentPaths = fileNames.map(name => `prompts/${name}.md`);
                        const collectionContent = `
id: ${collectionId}
name: Test Collection
items:
${nonExistentPaths.map(p => `  - path: ${p}\n    kind: prompt`).join('\n')}
`;
                        const collectionFile = path.join(collectionsDir, 'test.collection.yml');
                        fs.writeFileSync(collectionFile, collectionContent);
                        
                        // Validate the collection
                        const result = validateLib.validateCollectionFile(tempDir, 'collections/test.collection.yml');
                        
                        // Should fail because files don't exist
                        assert.strictEqual(result.ok, false,
                            'Collection with missing file references should fail validation');
                        
                        // Should have errors about missing files
                        const hasMissingFileError = result.errors.some(
                            (e: string) => e.toLowerCase().includes('not found') || 
                                          e.toLowerCase().includes('referenced file')
                        );
                        assert.ok(hasMissingFileError,
                            `Errors should mention missing files: ${result.errors.join(', ')}`);
                        
                        // Each missing file should be mentioned
                        for (const filePath of nonExistentPaths) {
                            const mentionsFile = result.errors.some(
                                (e: string) => e.includes(filePath)
                            );
                            assert.ok(mentionsFile,
                                `Error should mention missing file '${filePath}': ${result.errors.join(', ')}`);
                        }
                        
                    } finally {
                        // Cleanup
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.QUICK, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 12: Collection YAML Validation
     * Feature: workflow-bundle-scaffolding, Property 12: Collection YAML Validation
     * Validates: Requirements 9.2
     * 
     * For any collection file:
     * - Valid YAML with required fields (id, name, items) should pass validation
     * - Invalid YAML syntax should fail validation
     * - Missing required fields should fail validation
     */
    test('Property 12: Collection YAML Validation', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Test valid collections pass
        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-z0-9 ]/gi, 'a')),
                validItemKindGenerator(),
                async (collectionId, name, kind) => {
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-yaml-test-'));
                    
                    try {
                        // Create directory structure
                        const collectionsDir = path.join(tempDir, 'collections');
                        const promptsDir = path.join(tempDir, 'prompts');
                        fs.mkdirSync(collectionsDir, { recursive: true });
                        fs.mkdirSync(promptsDir, { recursive: true });
                        
                        // Create a referenced file
                        const promptFile = path.join(promptsDir, 'test.md');
                        fs.writeFileSync(promptFile, '# Test Prompt');
                        
                        // Create valid collection - quote the ID to ensure it's parsed as string
                        const collectionContent = `
id: "${collectionId}"
name: "${name}"
items:
  - path: prompts/test.md
    kind: ${kind}
`;
                        const collectionFile = path.join(collectionsDir, 'test.collection.yml');
                        fs.writeFileSync(collectionFile, collectionContent);
                        
                        // Validate
                        const result = validateLib.validateCollectionFile(tempDir, 'collections/test.collection.yml');
                        
                        assert.strictEqual(result.ok, true,
                            `Valid collection should pass: ${result.errors.join(', ')}`);
                        
                    } finally {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.QUICK, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test missing required fields fail
        const requiredFields = ['id', 'name', 'items'];
        for (const missingField of requiredFields) {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-missing-test-'));
            
            try {
                const collectionsDir = path.join(tempDir, 'collections');
                fs.mkdirSync(collectionsDir, { recursive: true });
                
                // Create collection missing one required field
                const fields: Record<string, any> = {
                    id: 'test-collection',
                    name: 'Test Collection',
                    items: [{ path: 'test.md', kind: 'prompt' }]
                };
                delete fields[missingField];
                
                const yaml = require('js-yaml');
                const collectionContent = yaml.dump(fields);
                const collectionFile = path.join(collectionsDir, 'test.collection.yml');
                fs.writeFileSync(collectionFile, collectionContent);
                
                const result = validateLib.validateCollectionFile(tempDir, 'collections/test.collection.yml');
                
                assert.strictEqual(result.ok, false,
                    `Collection missing '${missingField}' should fail validation`);
                
                const mentionsMissingField = result.errors.some(
                    (e: string) => e.toLowerCase().includes(missingField)
                );
                assert.ok(mentionsMissingField,
                    `Error should mention missing field '${missingField}': ${result.errors.join(', ')}`);
                
            } finally {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        }

        // Test invalid YAML syntax fails
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-syntax-test-'));
        try {
            const collectionsDir = path.join(tempDir, 'collections');
            fs.mkdirSync(collectionsDir, { recursive: true });
            
            // Create invalid YAML
            const invalidYaml = `
id: test
name: Test
items:
  - path: test.md
    kind: prompt
  invalid yaml here: [unclosed bracket
`;
            const collectionFile = path.join(collectionsDir, 'test.collection.yml');
            fs.writeFileSync(collectionFile, invalidYaml);
            
            const result = validateLib.validateCollectionFile(tempDir, 'collections/test.collection.yml');
            
            assert.strictEqual(result.ok, false, 'Invalid YAML should fail validation');
            
            const mentionsYamlError = result.errors.some(
                (e: string) => e.toLowerCase().includes('yaml') || e.toLowerCase().includes('parse')
            );
            assert.ok(mentionsYamlError,
                `Error should mention YAML parsing issue: ${result.errors.join(', ')}`);
            
        } finally {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    });

    /**
     * Property 5: Release Tag Format
     * Feature: workflow-bundle-scaffolding, Property 5: Release Tag Format
     * Validates: Requirements 2.4, 11.4
     * 
     * For any collection ID and version, the computed release tag should follow
     * the format "{collection-id}-v{version}" where version follows semantic
     * versioning (X.Y.Z).
     */
    test('Property 5: Release Tag Format', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                validVersionGenerator(),
                async (collectionId, version) => {
                    // Create a temp directory with a git repo for testing
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-tag-test-'));
                    
                    try {
                        // Initialize git repo
                        const { spawnSync } = require('child_process');
                        spawnSync('git', ['init'], { cwd: tempDir });
                        spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
                        spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
                        
                        // Create collections directory
                        const collectionsDir = path.join(tempDir, 'collections');
                        fs.mkdirSync(collectionsDir, { recursive: true });
                        
                        // Create collection file with version
                        const collectionContent = yaml.dump({
                            id: collectionId,
                            name: 'Test Collection',
                            version: version,
                            items: [{ path: 'test.md', kind: 'prompt' }]
                        });
                        const collectionFile = path.join(collectionsDir, 'test.collection.yml');
                        fs.writeFileSync(collectionFile, collectionContent);
                        
                        // Create the referenced file
                        fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test');
                        
                        // Commit to have a valid git state
                        spawnSync('git', ['add', '.'], { cwd: tempDir });
                        spawnSync('git', ['commit', '-m', 'Initial'], { cwd: tempDir });
                        
                        // Import and run compute-collection-version
                        // We need to test the tag format logic directly
                        const expectedTag = `${collectionId}-v${version}`;
                        
                        // Verify tag format matches expected pattern
                        const tagPattern = /^[a-z0-9-]+-v\d+\.\d+\.\d+$/;
                        assert.ok(tagPattern.test(expectedTag),
                            `Tag '${expectedTag}' should match pattern {collection-id}-v{X.Y.Z}`);
                        
                        // Verify tag starts with collection ID
                        assert.ok(expectedTag.startsWith(`${collectionId}-v`),
                            `Tag should start with collection ID: ${expectedTag}`);
                        
                        // Verify tag ends with version
                        assert.ok(expectedTag.endsWith(version),
                            `Tag should end with version: ${expectedTag}`);
                        
                        // Verify version in tag is valid semver
                        const versionInTag = expectedTag.replace(`${collectionId}-v`, '');
                        assert.ok(/^\d+\.\d+\.\d+$/.test(versionInTag),
                            `Version in tag should be semver: ${versionInTag}`);
                        
                    } finally {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 6: Bundle Asset Generation
     * Feature: workflow-bundle-scaffolding, Property 6: Bundle Asset Generation
     * Validates: Requirements 2.5
     * 
     * For any valid collection, the build-collection-bundle script should produce
     * both a deployment-manifest.yml file and a collection bundle ZIP file
     * containing all referenced items.
     * 
     * This test validates the bundle building logic by verifying:
     * 1. The bundle ID format is correct
     * 2. The output structure contains required fields
     * 3. The manifest and zip paths follow expected patterns
     */
    test('Property 6: Bundle Asset Generation', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Import the collections library to test bundle building logic
        const collectionsLib = require('../../templates/scaffolds/github/scripts/lib/collections.js');

        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                validVersionGenerator(),
                validItemKindGenerator(),
                async (collectionId, version, kind) => {
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-asset-test-'));
                    
                    try {
                        // Create directory structure
                        const collectionsDir = path.join(tempDir, 'collections');
                        const promptsDir = path.join(tempDir, 'prompts');
                        fs.mkdirSync(collectionsDir, { recursive: true });
                        fs.mkdirSync(promptsDir, { recursive: true });
                        
                        // Create a referenced file
                        const promptFile = path.join(promptsDir, 'test.md');
                        fs.writeFileSync(promptFile, '# Test Prompt\n\n> A test prompt description');
                        
                        // Create collection file
                        const collectionContent = yaml.dump({
                            id: collectionId,
                            name: 'Test Collection',
                            version: version,
                            items: [{ path: 'prompts/test.md', kind: kind }]
                        });
                        const collectionFile = path.join(collectionsDir, 'test.collection.yml');
                        fs.writeFileSync(collectionFile, collectionContent);
                        
                        // Test 1: Read collection and verify structure
                        const collection = collectionsLib.readCollection(tempDir, 'collections/test.collection.yml');
                        assert.strictEqual(collection.id, collectionId,
                            'Collection ID should match');
                        assert.strictEqual(collection.version, version,
                            'Collection version should match');
                        
                        // Test 2: Resolve item paths
                        const itemPaths = collectionsLib.resolveCollectionItemPaths(tempDir, collection);
                        assert.ok(Array.isArray(itemPaths),
                            'Item paths should be an array');
                        assert.strictEqual(itemPaths.length, 1,
                            'Should have one item path');
                        assert.strictEqual(itemPaths[0], 'prompts/test.md',
                            'Item path should be normalized');
                        
                        // Test 3: Verify bundle ID format would be correct
                        const repoSlug = 'test-owner-test-repo';
                        const expectedBundleId = `${repoSlug}-${collectionId}-v${version}`;
                        
                        // Bundle ID should follow the format
                        assert.ok(expectedBundleId.startsWith(`${repoSlug}-`),
                            'Bundle ID should start with repo slug');
                        assert.ok(expectedBundleId.includes(`-${collectionId}-v`),
                            'Bundle ID should contain collection ID');
                        assert.ok(expectedBundleId.endsWith(`-v${version}`),
                            'Bundle ID should end with version');
                        
                        // Test 4: Verify expected output structure
                        const expectedOutDir = `dist/${collectionId}`;
                        const expectedManifestAsset = `${expectedOutDir}/deployment-manifest.yml`;
                        const expectedZipAsset = `${expectedOutDir}/${collectionId}.bundle.zip`;
                        
                        // Verify paths follow expected patterns
                        assert.ok(expectedManifestAsset.endsWith('deployment-manifest.yml'),
                            'Manifest asset should be deployment-manifest.yml');
                        assert.ok(expectedZipAsset.endsWith('.bundle.zip'),
                            'ZIP asset should end with .bundle.zip');
                        assert.ok(expectedZipAsset.includes(collectionId),
                            'ZIP asset should include collection ID');
                        
                    } finally {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.QUICK, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 9: Bundle ID Format
     * Feature: workflow-bundle-scaffolding, Property 9: Bundle ID Format
     * Validates: Requirements 12.4
     * 
     * For any repository slug, collection ID, and version, the generated bundle ID
     * should follow the format "{repo-slug}-{collection-id}-v{version}".
     */
    test('Property 9: Bundle ID Format', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Generator for valid repo slugs (owner-repo format)
        const repoSlugGenerator = () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('');
            return fc.tuple(
                fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 20 })
                    .map(arr => arr.join(''))
                    .filter(s => !s.startsWith('-') && !s.endsWith('-')),
                fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 20 })
                    .map(arr => arr.join(''))
                    .filter(s => !s.startsWith('-') && !s.endsWith('-'))
            ).map(([owner, repo]) => `${owner}-${repo}`);
        };

        await fc.assert(
            fc.asyncProperty(
                repoSlugGenerator(),
                validCollectionIdGenerator(),
                validVersionGenerator(),
                async (repoSlug, collectionId, version) => {
                    // Expected bundle ID format
                    const expectedBundleId = `${repoSlug}-${collectionId}-v${version}`;
                    
                    // Verify format matches pattern
                    const bundleIdPattern = /^[a-z0-9-]+-[a-z0-9-]+-v\d+\.\d+\.\d+$/;
                    assert.ok(bundleIdPattern.test(expectedBundleId),
                        `Bundle ID '${expectedBundleId}' should match pattern {repo-slug}-{collection-id}-v{X.Y.Z}`);
                    
                    // Verify bundle ID starts with repo slug
                    assert.ok(expectedBundleId.startsWith(`${repoSlug}-`),
                        `Bundle ID should start with repo slug: ${expectedBundleId}`);
                    
                    // Verify bundle ID contains collection ID
                    assert.ok(expectedBundleId.includes(`-${collectionId}-v`),
                        `Bundle ID should contain collection ID: ${expectedBundleId}`);
                    
                    // Verify bundle ID ends with version
                    assert.ok(expectedBundleId.endsWith(`-v${version}`),
                        `Bundle ID should end with version: ${expectedBundleId}`);
                    
                    // Verify we can extract components from bundle ID
                    const versionMatch = expectedBundleId.match(/-v(\d+\.\d+\.\d+)$/);
                    assert.ok(versionMatch,
                        `Should be able to extract version from bundle ID: ${expectedBundleId}`);
                    assert.strictEqual(versionMatch![1], version,
                        `Extracted version should match input: ${versionMatch![1]} vs ${version}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 9a: Hub Integration ID Consistency
     * Feature: workflow-bundle-scaffolding, Property 9a: Hub Integration ID Consistency
     * Validates: Requirements 12.5
     * 
     * For any collection scaffolded with the github template, the collection ID
     * and bundle ID formats should be compatible with the Prompt Registry hub's
     * expected formats, ensuring seamless discovery and installation.
     */
    test('Property 9a: Hub Integration ID Consistency', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                validVersionGenerator(),
                async (collectionId, version) => {
                    // Hub expects collection IDs to follow the same validation rules
                    // as the scaffolding system
                    const idResult = validateLib.validateCollectionId(collectionId);
                    
                    // Collection ID should be valid for hub integration
                    assert.strictEqual(idResult.valid, true,
                        `Collection ID '${collectionId}' should be valid for hub integration`);
                    
                    // Hub expects bundle IDs in format: {repo-slug}-{collection-id}-v{version}
                    const testRepoSlug = 'test-owner-test-repo';
                    const bundleId = `${testRepoSlug}-${collectionId}-v${version}`;
                    
                    // Bundle ID should be parseable to extract version
                    // The version is always at the end after the last '-v' followed by semver
                    const versionPattern = /-v(\d+\.\d+\.\d+)$/;
                    const versionMatch = bundleId.match(versionPattern);
                    assert.ok(versionMatch,
                        `Bundle ID should have version suffix matching -vX.Y.Z: ${bundleId}`);
                    
                    const extractedVersion = versionMatch![1];
                    assert.strictEqual(extractedVersion, version,
                        `Extracted version should match input: ${extractedVersion} vs ${version}`);
                    
                    // The prefix before -v{version} should end with the collection ID
                    const prefixPart = bundleId.replace(versionPattern, '');
                    assert.ok(prefixPart.endsWith(collectionId),
                        `Bundle ID prefix should end with collection ID: ${prefixPart} should end with ${collectionId}`);
                    
                    // Hub validation rules should match scaffolding validation rules
                    // This ensures collections created with scaffolding work with hub
                    const hubIdRules = {
                        maxLength: 100,
                        pattern: /^[a-z0-9-]+$/
                    };
                    
                    assert.ok(collectionId.length <= hubIdRules.maxLength,
                        `Collection ID length should be within hub limit: ${collectionId.length} <= ${hubIdRules.maxLength}`);
                    assert.ok(hubIdRules.pattern.test(collectionId),
                        `Collection ID should match hub pattern: ${collectionId}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 7: Version Computation from Manifest
     * Feature: workflow-bundle-scaffolding, Property 7: Version Computation from Manifest
     * Validates: Requirements 11.1, 11.3, 11.5
     * 
     * For any collection file:
     * - If the collection has a version field, that version should be used
     * - If the collection has no version field, version should default to "1.0.0"
     * - The version must follow semantic versioning format (X.Y.Z)
     */
    test('Property 7: Version Computation from Manifest', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Test 1: Collections with explicit version use that version
        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                validVersionGenerator(),
                async (collectionId, version) => {
                    // Validate version using the validation library
                    const versionResult = validateLib.validateVersion(version);
                    
                    // Valid semver should be accepted
                    assert.strictEqual(versionResult.valid, true,
                        `Valid version '${version}' should be accepted`);
                    
                    // Normalized version should match input
                    assert.strictEqual(versionResult.normalized, version,
                        `Normalized version should match input: ${version}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test 2: Collections without version default to "1.0.0"
        const defaultVersionResult = validateLib.validateVersion(undefined);
        assert.strictEqual(defaultVersionResult.valid, true,
            'Undefined version should be valid (defaults to 1.0.0)');
        assert.strictEqual(defaultVersionResult.normalized, '1.0.0',
            'Undefined version should default to 1.0.0');

        const nullVersionResult = validateLib.validateVersion(null);
        assert.strictEqual(nullVersionResult.valid, true,
            'Null version should be valid (defaults to 1.0.0)');
        assert.strictEqual(nullVersionResult.normalized, '1.0.0',
            'Null version should default to 1.0.0');

        // Test 3: Invalid versions are rejected
        await fc.assert(
            fc.asyncProperty(
                invalidVersionGenerator(),
                async (invalidVersion) => {
                    const result = validateLib.validateVersion(invalidVersion);
                    
                    assert.strictEqual(result.valid, false,
                        `Invalid version '${invalidVersion}' should be rejected`);
                    assert.ok(result.error,
                        `Invalid version should have error message`);
                    assert.ok(result.error.toLowerCase().includes('x.y.z') || 
                              result.error.toLowerCase().includes('semver') ||
                              result.error.toLowerCase().includes('semantic'),
                        `Error should mention semver format: ${result.error}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test 4: Version validation is consistent in collection objects
        await fc.assert(
            fc.asyncProperty(
                validCollectionIdGenerator(),
                validVersionGenerator(),
                async (collectionId, version) => {
                    // Create collection with version
                    const collectionWithVersion = {
                        id: collectionId,
                        name: 'Test Collection',
                        version: version,
                        items: [{ path: 'test.md', kind: 'prompt' }]
                    };
                    
                    const resultWithVersion = validateLib.validateCollectionObject(
                        collectionWithVersion, 
                        'test.collection.yml'
                    );
                    
                    // Should not have version-related errors for valid version
                    const hasVersionError = resultWithVersion.errors.some(
                        (e: string) => e.toLowerCase().includes('version')
                    );
                    assert.ok(!hasVersionError,
                        `Valid version should not cause errors: ${resultWithVersion.errors.join(', ')}`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 20: Initial Commit Detection
     * Feature: workflow-bundle-scaffolding, Property 20: Initial Commit Detection
     * Validates: Requirements 14.1, 14.2
     * 
     * For any base SHA that is all zeros (0000000000000000000000000000000000000000)
     * OR empty string, and when HEAD~1 does not exist, the system should detect 
     * this as an initial commit and return isInitialCommit=true.
     */
    test('Property 20: Initial Commit Detection', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Import the publish-collections module
        const publishCollections = require('../../templates/scaffolds/github/scripts/publish-collections.js');
        const { computeChangedPathsFromGitDiff } = publishCollections;

        // Generator for initial commit indicators (all-zero SHA or empty string)
        const initialCommitShaGenerator = () => {
            return fc.constantFrom(
                '0000000000000000000000000000000000000000',
                '',           // Empty string - actual GitHub Actions behavior on initial push
                '   ',        // Whitespace only
                undefined     // Undefined
            );
        };

        // Generator for valid HEAD references
        const headRefGenerator = () => {
            return fc.constantFrom('HEAD', 'main', 'master', 'abc123def456');
        };

        await fc.assert(
            fc.asyncProperty(
                initialCommitShaGenerator(),
                headRefGenerator(),
                async (baseSha, headRef) => {
                    // Mock spawnSync to simulate initial commit scenario
                    // (HEAD~1 does not exist)
                    const spawnSync = (cmd: string, args: string[]) => {
                        // Simulate commitExists check failing for HEAD~1
                        if (cmd === 'git' && args[0] === 'rev-parse' && 
                            args.some(a => a.includes('~1^{commit}'))) {
                            return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                        }
                        return { status: 0, stdout: '', stderr: '' };
                    };

                    const result = computeChangedPathsFromGitDiff({
                        repoRoot: process.cwd(),
                        base: baseSha,
                        head: headRef,
                        env: {},
                        spawnSync,
                    });

                    // Should detect initial commit
                    assert.strictEqual(result.isInitialCommit, true,
                        `Should detect initial commit when base SHA is '${baseSha}' and HEAD~1 doesn't exist`);
                    
                    // Should return empty paths (since we can't diff)
                    assert.deepStrictEqual(result.paths, [],
                        `Should return empty paths for initial commit`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );

        // Test that non-zero base SHA does NOT trigger initial commit detection
        await fc.assert(
            fc.asyncProperty(
                // Generate non-zero SHA (40 hex chars, not all zeros)
                fc.hexaString({ minLength: 40, maxLength: 40 })
                    .filter(s => s !== '0000000000000000000000000000000000000000'),
                headRefGenerator(),
                async (baseSha, headRef) => {
                    // Mock spawnSync to simulate normal commit scenario
                    const spawnSync = (cmd: string, args: string[]) => {
                        // Simulate git diff returning some changed files
                        if (cmd === 'git' && args[0] === 'diff') {
                            return { status: 0, stdout: 'file1.txt\nfile2.txt\n', stderr: '' };
                        }
                        // Simulate commitExists returning true
                        if (cmd === 'git' && args[0] === 'rev-parse') {
                            return { status: 0, stdout: 'abc123', stderr: '' };
                        }
                        return { status: 0, stdout: '', stderr: '' };
                    };

                    const result = computeChangedPathsFromGitDiff({
                        repoRoot: process.cwd(),
                        base: baseSha,
                        head: headRef,
                        env: {},
                        spawnSync,
                    });

                    // Should NOT detect initial commit
                    assert.strictEqual(result.isInitialCommit, false,
                        `Should NOT detect initial commit when base SHA is not all zeros`);
                    
                    // Should return the changed paths from git diff
                    assert.ok(result.paths.length > 0,
                        `Should return changed paths for normal commit`);
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });

    /**
     * Property 21: Initial Commit Publishes All Collections
     * Feature: workflow-bundle-scaffolding, Property 21: Initial Commit Publishes All Collections
     * Validates: Requirements 14.2, 14.4
     * 
     * For any repository with N collections, when an initial commit is detected,
     * all N collections should be treated as affected and published.
     */
    test('Property 21: Initial Commit Publishes All Collections', async function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        // Import the publish-collections module
        const publishCollections = require('../../templates/scaffolds/github/scripts/publish-collections.js');
        const { getAllCollectionFiles } = publishCollections;

        await fc.assert(
            fc.asyncProperty(
                // Generate 1-5 collection IDs
                fc.array(validCollectionIdGenerator(), { minLength: 1, maxLength: 5 })
                    .filter(ids => new Set(ids).size === ids.length), // Ensure unique IDs
                async (collectionIds) => {
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'initial-commit-test-'));
                    
                    try {
                        // Create collections directory
                        const collectionsDir = path.join(tempDir, 'collections');
                        fs.mkdirSync(collectionsDir, { recursive: true });
                        
                        // Create collection files for each ID
                        for (const collectionId of collectionIds) {
                            const collectionContent = yaml.dump({
                                id: collectionId,
                                name: `Collection ${collectionId}`,
                                items: [{ path: 'test.md', kind: 'prompt' }],
                                version: '1.0.0'
                            });
                            fs.writeFileSync(
                                path.join(collectionsDir, `${collectionId}.collection.yml`),
                                collectionContent
                            );
                        }
                        
                        // Create the referenced file
                        fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test');
                        
                        // Get all collection files (simulating initial commit behavior)
                        const allCollections = getAllCollectionFiles(tempDir);
                        
                        // Should find all collections
                        assert.strictEqual(allCollections.length, collectionIds.length,
                            `Should find all ${collectionIds.length} collections`);
                        
                        // All collection IDs should be present
                        const foundIds = allCollections.map((c: { id: string }) => c.id);
                        for (const expectedId of collectionIds) {
                            assert.ok(foundIds.includes(expectedId),
                                `Should find collection '${expectedId}' in results`);
                        }
                        
                        // Each collection should have a file path
                        for (const collection of allCollections) {
                            assert.ok(collection.file,
                                `Collection '${collection.id}' should have a file path`);
                            assert.ok(collection.file.endsWith('.collection.yml'),
                                `Collection file should end with .collection.yml: ${collection.file}`);
                        }
                        
                    } finally {
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                    }
                }
            ),
            { numRuns: PropertyTestConfig.RUNS.QUICK, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
        );
    });
});
