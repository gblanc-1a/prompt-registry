/**
 * Publish Collections Integration Tests
 * 
 * Transposed from workflow-bundle/test/publish-collections.integration.test.js
 * Tests the publish-collections script end-to-end functionality.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.1
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

suite('Publish Collections Integration Tests', () => {
    // Helper functions
    function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): { code: number | null; stdout: string; stderr: string } {
        const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
        return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
    }

    function writeFile(root: string, rel: string, content: string): string {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        return abs;
    }

    function copyDir(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    function initGitRepo(root: string): void {
        assert.strictEqual(run('git', ['init', '-q'], root).code, 0);
        assert.strictEqual(run('git', ['config', 'user.email', 'test@example.com'], root).code, 0);
        assert.strictEqual(run('git', ['config', 'user.name', 'Test'], root).code, 0);
    }

    function gitCommitAll(root: string, message: string): void {
        assert.strictEqual(run('git', ['add', '.'], root).code, 0);
        const res = run('git', ['commit', '-q', '-m', message], root);
        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
    }

    function createGhStub(root: string): { binDir: string; logPath: string } {
        const binDir = path.join(root, 'bin');
        fs.mkdirSync(binDir, { recursive: true });

        const logPath = path.join(root, 'gh.log');
        fs.writeFileSync(logPath, '');

        const ghPath = path.join(binDir, 'gh');
        writeFile(
            root,
            path.relative(root, ghPath),
            [
                '#!/usr/bin/env node',
                "const fs = require('node:fs');",
                "const log = process.env.GH_STUB_LOG;",
                'const args = process.argv.slice(2);',
                'fs.appendFileSync(log, JSON.stringify(args) + "\\n");',
                "if (args[0] === 'release' && args[1] === 'view') process.exit(1);",
                "if (args[0] === 'release' && args[1] === 'create') process.exit(0);",
                'process.exit(0);',
                '',
            ].join('\n'),
        );
        fs.chmodSync(ghPath, 0o755);

        return { binDir, logPath };
    }

    function readGhCalls(logPath: string): string[][] {
        return fs
            .readFileSync(logPath, 'utf8')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => JSON.parse(l));
    }

    function unzipList(zipAbsPath: string, cwd: string): string {
        const res = run('unzip', ['-l', zipAbsPath], cwd);
        assert.strictEqual(res.code, 0, res.stderr || res.stdout);
        return res.stdout;
    }

    function makeMinimalPackageJson(root: string): void {
        writeFile(
            root,
            'package.json',
            JSON.stringify({
                name: 'x',
                description: 'x',
                license: 'MIT',
                repository: { url: 'https://example.com/x' },
                keywords: [],
            }),
        );
    }

    function assertReleaseCreateCalledWithAssets(options: {
        calls: string[][];
        tag: string;
        mustInclude: RegExp[];
    }): { zipArg: string; manifestArg: string; listing: string } {
        const { calls, tag, mustInclude } = options;
        const creates = calls.filter(c => c[0] === 'release' && c[1] === 'create' && c[2] === tag);
        assert.strictEqual(creates.length, 1, `Expected one gh release create for ${tag}`);

        const args = creates[0];
        const zipArg = args[args.length - 2];
        const manifestArg = args[args.length - 1];

        assert.ok(fs.existsSync(zipArg), `Missing zip asset at ${zipArg}`);
        assert.ok(fs.existsSync(manifestArg), `Missing manifest asset at ${manifestArg}`);

        const listing = unzipList(zipArg, path.dirname(zipArg));
        assert.match(listing, /deployment-manifest\.yml/);
        mustInclude.forEach(re => assert.match(listing, re));

        return { zipArg, manifestArg, listing };
    }

    // Get the path to the scaffolded scripts (source templates)
    // These scripts are run from the prompt-registry directory where node_modules exists
    // Note: __dirname in compiled tests is test-dist/test/scripts/, so we need to go up 3 levels
    const projectRoot = path.join(__dirname, '../../..');
    const templateScriptsDir = path.join(projectRoot, 'templates/scaffolds/github/scripts');

    /**
     * Copy scripts to a temp project directory.
     * The scripts are designed to run from within a scaffolded project,
     * so we need to copy them to the test project directory.
     */
    function copyScriptsToProject(root: string): string {
        const scriptsDir = path.join(root, 'scripts');
        copyDir(templateScriptsDir, scriptsDir);
        return scriptsDir;
    }

    /**
     * Run the publish-collections script.
     * Creates a symlink to node_modules so the scripts can find their dependencies.
     */
    function runPublishScript(
        root: string,
        changedPaths: string[],
        repoSlug: string,
        env: NodeJS.ProcessEnv
    ): { code: number | null; stdout: string; stderr: string } {
        // Build the argv array
        const argv: string[] = [];
        changedPaths.forEach(p => {
            argv.push('--changed-path', p);
        });
        argv.push('--repo-slug', repoSlug);

        // Run the script from the temp directory's scripts folder
        const scriptsDir = path.join(root, 'scripts');
        const publishScript = path.join(scriptsDir, 'publish-collections.js');
        
        // Create a symlink to prompt-registry's node_modules in the temp directory
        // so the scripts can find their dependencies (js-yaml, archiver, etc.)
        const sourceNodeModules = path.join(projectRoot, 'node_modules');
        const targetNodeModules = path.join(root, 'node_modules');
        
        if (!fs.existsSync(targetNodeModules)) {
            fs.symlinkSync(sourceNodeModules, targetNodeModules, 'dir');
        }
        
        const res = spawnSync('node', [publishScript, ...argv], {
            cwd: root,
            env,
            encoding: 'utf8',
        });
        return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
    }

    test('shared referenced file change publishes two releases (one per bundle)', async function() {
        this.timeout(60000); // Integration tests need more time

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-'));
        
        try {
            initGitRepo(root);
            makeMinimalPackageJson(root);

            // Copy scripts to the project (needed for detect-affected-collections, etc.)
            copyScriptsToProject(root);

            writeFile(root, 'prompts/shared.md', '# Shared\n');
            writeFile(root, 'prompts/a.md', '# A\n');
            writeFile(root, 'prompts/b.md', '# B\n');

            writeFile(
                root,
                'collections/a.collection.yml',
                [
                    'id: a',
                    'name: A',
                    'description: A',
                    'items:',
                    '  - path: prompts/shared.md',
                    '    kind: prompt',
                    '  - path: prompts/a.md',
                    '    kind: prompt',
                    'version: "1.0.0"',
                    '',
                ].join('\n'),
            );

            writeFile(
                root,
                'collections/b.collection.yml',
                [
                    'id: b',
                    'name: B',
                    'description: B',
                    'items:',
                    '  - path: prompts/shared.md',
                    '    kind: prompt',
                    '  - path: prompts/b.md',
                    '    kind: prompt',
                    'version: "1.0.0"',
                    '',
                ].join('\n'),
            );

            gitCommitAll(root, 'init');

            const { binDir, logPath } = createGhStub(root);

            const env = {
                ...process.env,
                PATH: `${binDir}:${process.env.PATH || ''}`,
                GH_STUB_LOG: logPath,
                GH_TOKEN: 'x',
                GITHUB_TOKEN: 'x',
                GITHUB_REPOSITORY: 'owner/repo',
            };

            const res = runPublishScript(root, ['prompts/shared.md'], 'repo', env);

            assert.strictEqual(res.code, 0, res.stderr || res.stdout);

            const calls = readGhCalls(logPath);
            assert.strictEqual(calls.filter(c => c[0] === 'release' && c[1] === 'create').length, 2);

            const a = assertReleaseCreateCalledWithAssets({
                calls,
                tag: 'a-v1.0.0',
                mustInclude: [/prompts\/shared\.md/, /prompts\/a\.md/],
            });
            assert.doesNotMatch(a.listing, /prompts\/b\.md/);

            const b = assertReleaseCreateCalledWithAssets({
                calls,
                tag: 'b-v1.0.0',
                mustInclude: [/prompts\/shared\.md/, /prompts\/b\.md/],
            });
            assert.doesNotMatch(b.listing, /prompts\/a\.md/);
        } finally {
            // Cleanup
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });

    test('two per-collection file changes publish both releases with correct assets', async function() {
        this.timeout(60000);

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-'));
        
        try {
            initGitRepo(root);
            makeMinimalPackageJson(root);

            // Copy scripts to the project (needed for detect-affected-collections, etc.)
            copyScriptsToProject(root);

            writeFile(root, 'prompts/a.md', '# A\n');
            writeFile(root, 'prompts/b.md', '# B\n');

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
                    '',
                ].join('\n'),
            );

            writeFile(
                root,
                'collections/b.collection.yml',
                [
                    'id: b',
                    'name: B',
                    'description: B',
                    'items:',
                    '  - path: prompts/b.md',
                    '    kind: prompt',
                    'version: "1.0.0"',
                    '',
                ].join('\n'),
            );

            gitCommitAll(root, 'init');

            const { binDir, logPath } = createGhStub(root);

            const env = {
                ...process.env,
                PATH: `${binDir}:${process.env.PATH || ''}`,
                GH_STUB_LOG: logPath,
                GH_TOKEN: 'x',
                GITHUB_TOKEN: 'x',
                GITHUB_REPOSITORY: 'owner/repo',
            };

            const res = runPublishScript(root, ['prompts/a.md', 'prompts/b.md'], 'repo', env);

            assert.strictEqual(res.code, 0, res.stderr || res.stdout);

            const calls = readGhCalls(logPath);
            assert.strictEqual(calls.filter(c => c[0] === 'release' && c[1] === 'create').length, 2);

            const a = assertReleaseCreateCalledWithAssets({
                calls,
                tag: 'a-v1.0.0',
                mustInclude: [/prompts\/a\.md/],
            });
            assert.doesNotMatch(a.listing, /prompts\/b\.md/);

            const b = assertReleaseCreateCalledWithAssets({
                calls,
                tag: 'b-v1.0.0',
                mustInclude: [/prompts\/b\.md/],
            });
            assert.doesNotMatch(b.listing, /prompts\/a\.md/);
        } finally {
            // Cleanup
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });
});
