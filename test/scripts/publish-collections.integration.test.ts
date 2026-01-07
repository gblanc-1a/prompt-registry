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
import {
    run,
    writeFile,
    initGitRepo,
    gitCommitAll,
    createGhStub,
    readGhCalls,
    unzipList,
    makeMinimalPackageJson,
    copyScriptsToProject,
    getNodeModulesPath
} from '../helpers/scriptTestHelpers';

suite('Publish Collections Integration Tests', () => {

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

    /**
     * Run the publish-collections script.
     */
    function runPublishScript(
        root: string,
        changedPaths: string[],
        repoSlug: string,
        env: NodeJS.ProcessEnv
    ): { code: number | null; stdout: string; stderr: string } {
        const argv: string[] = [];
        changedPaths.forEach(p => {
            argv.push('--changed-path', p);
        });
        argv.push('--repo-slug', repoSlug);

        const scriptsDir = path.join(root, 'scripts');
        const publishScript = path.join(scriptsDir, 'publish-collections.js');
        
        const res = spawnSync('node', [publishScript, ...argv], {
            cwd: root,
            env,
            encoding: 'utf8',
        });
        return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
    }

    test('shared referenced file change publishes two releases (one per bundle)', async function() {
        this.timeout(60000);

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-'));
        
        try {
            initGitRepo(root);
            makeMinimalPackageJson(root);
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

            const ghStub = createGhStub(root);

            const env = {
                ...process.env,
                PATH: `${ghStub.binDir}:${process.env.PATH || ''}`,
                GH_STUB_LOG: ghStub.logPath,
                GH_TOKEN: 'x',
                GITHUB_TOKEN: 'x',
                GITHUB_REPOSITORY: 'owner/repo',
                NODE_PATH: getNodeModulesPath(),
            };

            const res = runPublishScript(root, ['prompts/shared.md'], 'repo', env);

            assert.strictEqual(res.code, 0, res.stderr || res.stdout);

            const calls = readGhCalls(ghStub.logPath);
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

            const ghStub = createGhStub(root);

            const env = {
                ...process.env,
                PATH: `${ghStub.binDir}:${process.env.PATH || ''}`,
                GH_STUB_LOG: ghStub.logPath,
                GH_TOKEN: 'x',
                GITHUB_TOKEN: 'x',
                GITHUB_REPOSITORY: 'owner/repo',
                NODE_PATH: getNodeModulesPath(),
            };

            const res = runPublishScript(root, ['prompts/a.md', 'prompts/b.md'], 'repo', env);

            assert.strictEqual(res.code, 0, res.stderr || res.stdout);

            const calls = readGhCalls(ghStub.logPath);
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
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });
});
