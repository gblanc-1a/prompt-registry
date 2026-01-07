/**
 * Publish Collections Unit Tests
 * 
 * Transposed from workflow-bundle/test/publish-collections.dry-run.test.js
 * Tests the publish-collections script unit functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.1
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the publish-collections module
const publishCollections = require('../../templates/scaffolds/github/scripts/publish-collections.js');
const { main, computeChangedPathsFromGitDiff, listZipEntries } = publishCollections;

suite('Publish Collections Unit Tests', () => {
    /**
     * Create a mock logger that captures log lines
     */
    function makeLogger(): { lines: string[]; logger: { log: (...args: any[]) => void } } {
        const lines: string[] = [];
        return {
            lines,
            logger: {
                log: (...args: any[]) => lines.push(args.join(' ')),
            },
        };
    }

    /**
     * Create a zip file with given entries using archiver
     */
    async function makeZipWithEntries(options: { entries: Array<{ name: string; content: string }> }): Promise<{ tmpDir: string; zipPath: string }> {
        const archiver = require('archiver');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-collections-'));
        const zipPath = path.join(tmpDir, 'test.bundle.zip');

        await new Promise<void>((resolve, reject) => {
            const out = fs.createWriteStream(zipPath);
            const zip = archiver('zip', { zlib: { level: 9 } });

            out.on('close', resolve);
            out.on('error', reject);
            zip.on('error', reject);

            zip.pipe(out);
            for (const e of options.entries) {
                zip.append(e.content, { name: e.name });
            }
            zip.finalize();
        });

        return { tmpDir, zipPath };
    }

    suite('listZipEntries()', () => {
        test('returns entry names', async function() {
            this.timeout(10000);
            
            const { zipPath, tmpDir } = await makeZipWithEntries({
                entries: [
                    { name: 'a.txt', content: 'hello' },
                    { name: 'nested/b.txt', content: 'world' },
                ],
            });

            try {
                const { entries } = await listZipEntries(zipPath);
                assert.deepStrictEqual(entries.sort(), ['a.txt', 'nested/b.txt'].sort());
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    suite('main() --dry-run', () => {
        test('does not invoke gh release create and logs tag/version', async function() {
            this.timeout(30000);

            const { tmpDir, zipPath } = await makeZipWithEntries({
                entries: [{ name: 'bundle.txt', content: 'x' }],
            });

            try {
                const manifestPath = path.join(tmpDir, 'test.deployment-manifest.yml');
                fs.writeFileSync(manifestPath, 'name: test\n', 'utf8');

                const spawnCalls: string[] = [];
                const spawnSync = (cmd: string, args: string[] | undefined, opts: any) => {
                    spawnCalls.push([cmd, ...(args || [])].join(' '));

                    if (cmd === 'node' && args && args[0].endsWith('detect-affected-collections.js')) {
                        return { status: 0, stdout: JSON.stringify({ affected: [{ id: 't1', file: 'collections/t1.collection.yml' }] }), stderr: '' };
                    }

                    if (cmd === 'node' && args && args[0].endsWith('compute-collection-version.js')) {
                        return {
                            status: 0,
                            stdout: JSON.stringify({ nextVersion: '1.2.3', tag: 't1-v1.2.3' }),
                            stderr: '',
                        };
                    }

                    if (cmd === 'node' && args && args[0].endsWith('build-collection-bundle.js')) {
                        return {
                            status: 0,
                            stdout: JSON.stringify({ manifestAsset: manifestPath, zipAsset: zipPath }),
                            stderr: '',
                        };
                    }

                    // git fetch tags best-effort
                    if (cmd === 'git') {
                        return { status: 0, stdout: '', stderr: '' };
                    }

                    if (cmd === 'gh') {
                        throw new Error('gh invoked during --dry-run');
                    }

                    return { status: 0, stdout: '', stderr: '' };
                };

                const { logger, lines } = makeLogger();
                await main({
                    repoRoot: tmpDir,
                    argv: ['--dry-run', '--changed-path', 'collections/t1.collection.yml'],
                    env: { GITHUB_REPOSITORY: 'acme/repo' },
                    logger,
                    spawnSync,
                });

                assert.strictEqual(
                    spawnCalls.some(c => c.startsWith('gh release create')),
                    false,
                    'gh release create should not be called in dry-run mode'
                );
                assert.strictEqual(
                    lines.some(l => l.includes('release_tag: t1-v1.2.3')),
                    true,
                    'Should log release tag'
                );
                assert.strictEqual(
                    lines.some(l => l.includes('version: 1.2.3')),
                    true,
                    'Should log version'
                );
                assert.strictEqual(
                    lines.some(l => l.includes('zip_entries:')),
                    true,
                    'Should log zip entries'
                );
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    suite('computeChangedPathsFromGitDiff()', () => {
        test('parses and de-dupes git output', function() {
            const spawnSync = (cmd: string, args: string[]) => {
                if (cmd === 'git' && args[0] === 'diff') {
                    return { status: 0, stdout: 'a.txt\ncollections/x.collection.yml\ncollections/x.collection.yml\n', stderr: '' };
                }
                return { status: 0, stdout: '', stderr: '' };
            };

            const result = computeChangedPathsFromGitDiff({
                repoRoot: process.cwd(),
                base: 'origin/main',
                head: 'HEAD',
                env: {},
                spawnSync,
            });

            // The function now returns { paths, isInitialPush }
            const paths = Array.isArray(result) ? result : result.paths;
            assert.deepStrictEqual(paths, ['a.txt', 'collections/x.collection.yml']);
        });

        test('returns empty array and isInitialCommit=true when HEAD~1 does not exist (initial commit)', function() {
            const spawnSync = (cmd: string, args: string[]) => {
                // Simulate commitExists check failing for HEAD~1
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                    return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                }
                // Should not reach git diff since commitExists returns false
                if (cmd === 'git' && args[0] === 'diff') {
                    throw new Error('Should not call git diff when HEAD~1 does not exist');
                }
                return { status: 0, stdout: '', stderr: '' };
            };

            // Pass all-zero SHA to trigger fallback to HEAD~1 check
            const result = computeChangedPathsFromGitDiff({
                repoRoot: process.cwd(),
                base: '0000000000000000000000000000000000000000',
                head: 'HEAD',
                env: {},
                spawnSync,
            });

            // The function returns { paths, isInitialCommit }
            if (Array.isArray(result)) {
                assert.deepStrictEqual(result, [], 'Should return empty array when base commit does not exist');
            } else {
                assert.deepStrictEqual(result.paths, [], 'Should return empty paths when base commit does not exist');
                assert.strictEqual(result.isInitialCommit, true, 'Should indicate initial commit');
            }
        });
    });

    suite('main() with env base/head', () => {
        test('uses env base/head to compute changed paths when none provided', async function() {
            this.timeout(30000);

            const { tmpDir, zipPath } = await makeZipWithEntries({
                entries: [{ name: 'bundle.txt', content: 'x' }],
            });

            try {
                const manifestPath = path.join(tmpDir, 'test.deployment-manifest.yml');
                fs.writeFileSync(manifestPath, 'name: test\n', 'utf8');

                const spawnSync = (cmd: string, args: string[]) => {
                    if (cmd === 'git' && args[0] === 'diff') {
                        return { status: 0, stdout: 'collections/t1.collection.yml\n', stderr: '' };
                    }
                    // Handle rev-parse for commit existence check
                    if (cmd === 'git' && args[0] === 'rev-parse') {
                        return { status: 0, stdout: 'abc123', stderr: '' };
                    }
                    if (cmd === 'node' && args[0].endsWith('detect-affected-collections.js')) {
                        return { status: 0, stdout: JSON.stringify({ affected: [{ id: 't1', file: 'collections/t1.collection.yml' }] }), stderr: '' };
                    }
                    if (cmd === 'node' && args[0].endsWith('compute-collection-version.js')) {
                        return {
                            status: 0,
                            stdout: JSON.stringify({ nextVersion: '1.2.3', tag: 't1-v1.2.3' }),
                            stderr: '',
                        };
                    }
                    if (cmd === 'node' && args[0].endsWith('build-collection-bundle.js')) {
                        return {
                            status: 0,
                            stdout: JSON.stringify({ manifestAsset: manifestPath, zipAsset: zipPath }),
                            stderr: '',
                        };
                    }
                    if (cmd === 'git') {
                        return { status: 0, stdout: '', stderr: '' };
                    }
                    if (cmd === 'gh') {
                        return { status: 0, stdout: '', stderr: '' };
                    }
                    return { status: 0, stdout: '', stderr: '' };
                };

                const { logger, lines } = makeLogger();
                await main({
                    repoRoot: tmpDir,
                    argv: ['--dry-run'],
                    env: {
                        GITHUB_REPOSITORY: 'acme/repo',
                        GITHUB_BASE_SHA: 'origin/main',
                        GITHUB_HEAD_SHA: 'HEAD',
                    },
                    logger,
                    spawnSync,
                });

                assert.strictEqual(
                    lines.some(l => l.includes('release_tag: t1-v1.2.3')),
                    true,
                    'Should log release tag when using env vars'
                );
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    /**
     * Initial Commit Detection Tests
     * Feature: workflow-bundle-scaffolding
     * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
     */
    suite('Initial Commit Detection', () => {
        /**
         * Test that all-zero base SHA with no HEAD~1 triggers initial commit mode
         * and all collections are published.
         * Requirements: 14.1, 14.2, 14.5
         */
        test('publishes all collections when initial commit is detected (all-zero base SHA, no HEAD~1)', async function() {
            this.timeout(30000);

            const { tmpDir, zipPath } = await makeZipWithEntries({
                entries: [{ name: 'bundle.txt', content: 'x' }],
            });

            try {
                const manifestPath = path.join(tmpDir, 'test.deployment-manifest.yml');
                fs.writeFileSync(manifestPath, 'name: test\n', 'utf8');

                // Create collections directory with multiple collections
                const collectionsDir = path.join(tmpDir, 'collections');
                fs.mkdirSync(collectionsDir, { recursive: true });
                
                // Create collection files
                fs.writeFileSync(
                    path.join(collectionsDir, 'collection-a.collection.yml'),
                    'id: collection-a\nname: Collection A\nitems: []\nversion: "1.0.0"\n'
                );
                fs.writeFileSync(
                    path.join(collectionsDir, 'collection-b.collection.yml'),
                    'id: collection-b\nname: Collection B\nitems: []\nversion: "1.0.0"\n'
                );

                const publishedCollections: string[] = [];
                
                const spawnSync = (cmd: string, args: string[]) => {
                    // Simulate initial commit: all-zero base SHA and HEAD~1 doesn't exist
                    if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                        return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                    }
                    // git fetch tags
                    if (cmd === 'git' && args[0] === 'fetch') {
                        return { status: 0, stdout: '', stderr: '' };
                    }
                    // compute-collection-version
                    if (cmd === 'node' && args[0].endsWith('compute-collection-version.js')) {
                        const collectionFile = args[args.indexOf('--collection-file') + 1];
                        const collectionId = collectionFile.includes('collection-a') ? 'collection-a' : 'collection-b';
                        return {
                            status: 0,
                            stdout: JSON.stringify({ nextVersion: '1.0.0', tag: `${collectionId}-v1.0.0` }),
                            stderr: '',
                        };
                    }
                    // build-collection-bundle
                    if (cmd === 'node' && args[0].endsWith('build-collection-bundle.js')) {
                        const collectionFile = args[args.indexOf('--collection-file') + 1];
                        const collectionId = collectionFile.includes('collection-a') ? 'collection-a' : 'collection-b';
                        publishedCollections.push(collectionId);
                        return {
                            status: 0,
                            stdout: JSON.stringify({ manifestAsset: manifestPath, zipAsset: zipPath }),
                            stderr: '',
                        };
                    }
                    return { status: 0, stdout: '', stderr: '' };
                };

                const { logger, lines } = makeLogger();
                await main({
                    repoRoot: tmpDir,
                    argv: ['--dry-run'],
                    env: {
                        GITHUB_REPOSITORY: 'acme/repo',
                        GITHUB_BASE_SHA: '0000000000000000000000000000000000000000',
                        GITHUB_HEAD_SHA: 'HEAD',
                    },
                    logger,
                    spawnSync,
                });

                // Verify initial commit mode was detected
                assert.strictEqual(
                    lines.some(l => l.includes('Initial commit mode')),
                    true,
                    'Should log initial commit mode message'
                );

                // Verify all collections were published
                assert.strictEqual(publishedCollections.length, 2, 'Should publish all 2 collections');
                assert.ok(publishedCollections.includes('collection-a'), 'Should publish collection-a');
                assert.ok(publishedCollections.includes('collection-b'), 'Should publish collection-b');

                // Verify release tags were logged for both collections
                assert.strictEqual(
                    lines.some(l => l.includes('release_tag: collection-a-v1.0.0')),
                    true,
                    'Should log release tag for collection-a'
                );
                assert.strictEqual(
                    lines.some(l => l.includes('release_tag: collection-b-v1.0.0')),
                    true,
                    'Should log release tag for collection-b'
                );
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        /**
         * Test that empty string base SHA with no HEAD~1 triggers initial commit mode.
         * This is the actual behavior in GitHub Actions on initial push.
         * Requirements: 14.1, 14.2
         */
        test('publishes all collections when initial commit is detected (empty string base SHA, no HEAD~1)', async function() {
            this.timeout(30000);

            const { tmpDir, zipPath } = await makeZipWithEntries({
                entries: [{ name: 'bundle.txt', content: 'x' }],
            });

            try {
                const manifestPath = path.join(tmpDir, 'test.deployment-manifest.yml');
                fs.writeFileSync(manifestPath, 'name: test\n', 'utf8');

                // Create collections directory with multiple collections
                const collectionsDir = path.join(tmpDir, 'collections');
                fs.mkdirSync(collectionsDir, { recursive: true });
                
                // Create collection files
                fs.writeFileSync(
                    path.join(collectionsDir, 'collection-a.collection.yml'),
                    'id: collection-a\nname: Collection A\nitems: []\nversion: "1.0.0"\n'
                );
                fs.writeFileSync(
                    path.join(collectionsDir, 'collection-b.collection.yml'),
                    'id: collection-b\nname: Collection B\nitems: []\nversion: "1.0.0"\n'
                );

                const publishedCollections: string[] = [];
                
                const spawnSync = (cmd: string, args: string[]) => {
                    // Simulate initial commit: empty base SHA and HEAD~1 doesn't exist
                    if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                        return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                    }
                    // git fetch tags
                    if (cmd === 'git' && args[0] === 'fetch') {
                        return { status: 0, stdout: '', stderr: '' };
                    }
                    // compute-collection-version
                    if (cmd === 'node' && args[0].endsWith('compute-collection-version.js')) {
                        const collectionFile = args[args.indexOf('--collection-file') + 1];
                        const collectionId = collectionFile.includes('collection-a') ? 'collection-a' : 'collection-b';
                        return {
                            status: 0,
                            stdout: JSON.stringify({ nextVersion: '1.0.0', tag: `${collectionId}-v1.0.0` }),
                            stderr: '',
                        };
                    }
                    // build-collection-bundle
                    if (cmd === 'node' && args[0].endsWith('build-collection-bundle.js')) {
                        const collectionFile = args[args.indexOf('--collection-file') + 1];
                        const collectionId = collectionFile.includes('collection-a') ? 'collection-a' : 'collection-b';
                        publishedCollections.push(collectionId);
                        return {
                            status: 0,
                            stdout: JSON.stringify({ manifestAsset: manifestPath, zipAsset: zipPath }),
                            stderr: '',
                        };
                    }
                    return { status: 0, stdout: '', stderr: '' };
                };

                const { logger, lines } = makeLogger();
                await main({
                    repoRoot: tmpDir,
                    argv: ['--dry-run'],
                    env: {
                        GITHUB_REPOSITORY: 'acme/repo',
                        GITHUB_BASE_SHA: '',  // Empty string - actual GitHub Actions behavior
                        GITHUB_HEAD_SHA: 'HEAD',
                    },
                    logger,
                    spawnSync,
                });

                // Verify initial commit mode was detected
                assert.strictEqual(
                    lines.some(l => l.includes('Initial commit mode')),
                    true,
                    'Should log initial commit mode message'
                );

                // Verify all collections were published
                assert.strictEqual(publishedCollections.length, 2, 'Should publish all 2 collections');
                assert.ok(publishedCollections.includes('collection-a'), 'Should publish collection-a');
                assert.ok(publishedCollections.includes('collection-b'), 'Should publish collection-b');
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        /**
         * Test that initial commit detection logs the appropriate message.
         * Requirements: 14.3
         */
        test('logs initial commit detection message when base SHA is all zeros and no HEAD~1', function() {
            const spawnSync = (cmd: string, args: string[]) => {
                // Simulate commitExists check failing for HEAD~1
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                    return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                }
                return { status: 0, stdout: '', stderr: '' };
            };

            // Capture console.log output
            const originalLog = console.log;
            const logMessages: string[] = [];
            console.log = (...args: any[]) => {
                logMessages.push(args.join(' '));
            };

            try {
                const result = computeChangedPathsFromGitDiff({
                    repoRoot: process.cwd(),
                    base: '0000000000000000000000000000000000000000',
                    head: 'HEAD',
                    env: {},
                    spawnSync,
                });

                // Verify the result
                assert.deepStrictEqual(result.paths, [], 'Should return empty paths');
                assert.strictEqual(result.isInitialCommit, true, 'Should indicate initial commit');

                // Verify the log message
                assert.ok(
                    logMessages.some(msg => msg.includes('Initial commit detected')),
                    `Should log initial commit detection message. Got: ${logMessages.join(', ')}`
                );
            } finally {
                console.log = originalLog;
            }
        });

        /**
         * Test that force-push with non-existent base commit falls back to HEAD~1.
         * This handles the case where user amends initial commit and force-pushes.
         * Requirements: 14.1, 14.2
         */
        test('falls back to HEAD~1 when base commit does not exist (force-push scenario)', function() {
            const spawnSync = (cmd: string, args: string[]) => {
                // Simulate base commit not existing (force-push after amend)
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('abc123^{commit}')) {
                    return { status: 1, stdout: '', stderr: 'fatal: bad object abc123' };
                }
                // Simulate HEAD~1 also not existing (amended initial commit)
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                    return { status: 1, stdout: '', stderr: 'fatal: bad revision' };
                }
                return { status: 0, stdout: '', stderr: '' };
            };

            // Capture console.log output
            const originalLog = console.log;
            const logMessages: string[] = [];
            console.log = (...args: any[]) => {
                logMessages.push(args.join(' '));
            };

            try {
                const result = computeChangedPathsFromGitDiff({
                    repoRoot: process.cwd(),
                    base: 'abc123',  // Non-existent commit (was replaced by force-push)
                    head: 'HEAD',
                    env: {},
                    spawnSync,
                });

                // Should detect as initial commit since both base and HEAD~1 don't exist
                assert.deepStrictEqual(result.paths, [], 'Should return empty paths');
                assert.strictEqual(result.isInitialCommit, true, 'Should indicate initial commit');

                // Verify the log message mentions the issue
                assert.ok(
                    logMessages.some(msg => msg.includes('Initial commit detected') || msg.includes('not found')),
                    `Should log appropriate message. Got: ${logMessages.join(', ')}`
                );
            } finally {
                console.log = originalLog;
            }
        });

        /**
         * Test that force-push with non-existent base but existing HEAD~1 uses HEAD~1.
         * This handles the case where user force-pushes but there are multiple commits.
         */
        test('uses HEAD~1 when base commit does not exist but HEAD~1 exists', function() {
            const spawnSync = (cmd: string, args: string[]) => {
                // Simulate base commit not existing (force-push)
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('abc123^{commit}')) {
                    return { status: 1, stdout: '', stderr: 'fatal: bad object abc123' };
                }
                // Simulate HEAD~1 existing
                if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('HEAD~1^{commit}')) {
                    return { status: 0, stdout: 'def456', stderr: '' };
                }
                // Simulate git diff returning changed files
                if (cmd === 'git' && args[0] === 'diff') {
                    return { status: 0, stdout: 'collections/test.collection.yml\n', stderr: '' };
                }
                return { status: 0, stdout: '', stderr: '' };
            };

            // Capture console.log output
            const originalLog = console.log;
            const logMessages: string[] = [];
            console.log = (...args: any[]) => {
                logMessages.push(args.join(' '));
            };

            try {
                const result = computeChangedPathsFromGitDiff({
                    repoRoot: process.cwd(),
                    base: 'abc123',  // Non-existent commit
                    head: 'HEAD',
                    env: {},
                    spawnSync,
                });

                // Should NOT be initial commit since HEAD~1 exists
                assert.strictEqual(result.isInitialCommit, false, 'Should NOT indicate initial commit');
                assert.deepStrictEqual(result.paths, ['collections/test.collection.yml'], 'Should return changed paths');

                // Verify the log message mentions fallback
                assert.ok(
                    logMessages.some(msg => msg.includes('not found') && msg.includes('falling back')),
                    `Should log fallback message. Got: ${logMessages.join(', ')}`
                );
            } finally {
                console.log = originalLog;
            }
        });
    });
});
