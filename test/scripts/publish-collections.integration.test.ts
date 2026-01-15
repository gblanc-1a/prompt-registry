/**
 * Publish Collections Integration Tests
 *
 * Transposed from workflow-bundle/test/publish-collections.integration.test.js
 * Tests the publish-collections script end-to-end functionality.
 *
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.1
 */

import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    writeFile,
    initGitRepo,
    gitCommitAll,
    createGhStub,
    readGhCalls,
    unzipList,
    makeMinimalPackageJson,
    copyScriptsToProject,
    getNodeModulesPath,
} from '../helpers/scriptTestHelpers';

suite('Publish Collections Integration Tests', () => {
    function assertReleaseCreateCalledWithAssets(options: {
        calls: string[][];
        tag: string;
        mustInclude: RegExp[];
    }): { zipArg: string; manifestArg: string; listing: string } {
        const { calls, tag, mustInclude } = options;
        const creates = calls.filter(
            (c) => c[0] === 'release' && c[1] === 'create' && c[2] === tag
        );
        assert.strictEqual(creates.length, 1, `Expected one gh release create for ${tag}`);

        const args = creates[0];
        const zipArg = args.at(-2);
        const manifestArg = args.at(-1);

        assert.ok(zipArg && fs.existsSync(zipArg), `Missing zip asset at ${zipArg}`);
        assert.ok(
            manifestArg && fs.existsSync(manifestArg),
            `Missing manifest asset at ${manifestArg}`
        );

        const listing = unzipList(zipArg, path.dirname(zipArg));
        assert.match(listing, /deployment-manifest\.yml/);
        for (const re of mustInclude) {
            assert.match(listing, re);
        }

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
        for (const p of changedPaths) {
            argv.push('--changed-path', p);
        }
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

    test('shared referenced file change publishes two releases (one per bundle)', async function () {
        this.timeout(60_000);

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
                ].join('\n')
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
                ].join('\n')
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
            assert.strictEqual(
                calls.filter((c) => c[0] === 'release' && c[1] === 'create').length,
                2
            );

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

    test('two per-collection file changes publish both releases with correct assets', async function () {
        this.timeout(60_000);

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
                ].join('\n')
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
                ].join('\n')
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
            assert.strictEqual(
                calls.filter((c) => c[0] === 'release' && c[1] === 'create').length,
                2
            );

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

    test('skill items include entire skill directory contents in bundle', async function () {
        this.timeout(60_000);

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-skill-'));

        try {
            initGitRepo(root);
            makeMinimalPackageJson(root);
            copyScriptsToProject(root);

            // Create a skill directory with multiple files (like ospo.skills-collection)
            writeFile(root, 'skills/my-skill/SKILL.md', '# My Skill\nDescription');
            writeFile(root, 'skills/my-skill/assets/diagram.png', 'fake-png-content');
            writeFile(root, 'skills/my-skill/references/doc.md', '# Reference Doc');
            writeFile(root, 'skills/my-skill/scripts/helper.js', 'console.log("helper")');

            // Create a regular prompt
            writeFile(root, 'prompts/simple.prompt.md', '# Simple Prompt');

            writeFile(
                root,
                'collections/skills-collection.collection.yml',
                [
                    'id: skills-collection',
                    'name: Skills Collection',
                    'description: Collection with skills',
                    'items:',
                    '  - path: skills/my-skill/SKILL.md',
                    '    kind: skill',
                    '  - path: prompts/simple.prompt.md',
                    '    kind: prompt',
                    'version: "1.0.0"',
                    '',
                ].join('\n')
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

            const res = runPublishScript(root, ['skills/my-skill/SKILL.md'], 'repo', env);

            assert.strictEqual(res.code, 0, res.stderr || res.stdout);

            const calls = readGhCalls(ghStub.logPath);
            assert.strictEqual(
                calls.filter((c) => c[0] === 'release' && c[1] === 'create').length,
                1
            );

            // Verify the bundle includes ALL skill directory contents, not just SKILL.md
            const result = assertReleaseCreateCalledWithAssets({
                calls,
                tag: 'skills-collection-v1.0.0',
                mustInclude: [
                    /skills\/my-skill\/SKILL\.md/,
                    /skills\/my-skill\/assets\/diagram\.png/,
                    /skills\/my-skill\/references\/doc\.md/,
                    /skills\/my-skill\/scripts\/helper\.js/,
                    /prompts\/simple\.prompt\.md/,
                ],
            });

            // Verify the listing contains all expected files
            assert.match(result.listing, /skills\/my-skill\/SKILL\.md/, 'Should include SKILL.md');
            assert.match(
                result.listing,
                /skills\/my-skill\/assets\/diagram\.png/,
                'Should include assets'
            );
            assert.match(
                result.listing,
                /skills\/my-skill\/references\/doc\.md/,
                'Should include references'
            );
            assert.match(
                result.listing,
                /skills\/my-skill\/scripts\/helper\.js/,
                'Should include scripts'
            );
        } finally {
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });
});
