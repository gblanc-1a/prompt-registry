/**
 * Unit tests for PromptLoader
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  PromptLoader,
} from '../../src/services/prompt-loader';

suite('PromptLoader', () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let tempDir: string;
  let bundlesDir: string;
  let loader: PromptLoader;

  /**
   * Create a bundle fixture with a deployment manifest and optional prompt files.
   */
  const createBundleFixture = (
    bundleId: string,
    prompts: Array<{ id: string; name: string; description: string; file: string; tags?: string[]; content?: string }>
  ): void => {
    const bundlePath = path.join(bundlesDir, bundleId);
    fs.mkdirSync(bundlePath, { recursive: true });

    // Write deployment manifest
    const manifest: any = {
      id: bundleId,
      version: '1.0.0',
      name: bundleId,
      prompts: prompts.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        file: p.file,
        tags: p.tags || []
      }))
    };
    fs.writeFileSync(path.join(bundlePath, 'deployment-manifest.yml'), yaml.dump(manifest));

    // Write prompt files
    for (const p of prompts) {
      if (p.content !== undefined) {
        const promptPath = path.join(bundlePath, p.file);
        fs.mkdirSync(path.dirname(promptPath), { recursive: true });
        fs.writeFileSync(promptPath, p.content);
      }
    }
  };

  setup(() => {
    sandbox = sinon.createSandbox();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loader-test-'));
    bundlesDir = path.join(tempDir, 'bundles');
    fs.mkdirSync(bundlesDir, { recursive: true });

    mockContext = {
      globalStorageUri: vscode.Uri.file(tempDir),
      globalState: {
        get: () => undefined,
        update: async () => {},
        keys: () => [],
        setKeysForSync: sandbox.stub()
      } as any,
      extensionPath: '/mock/extension',
      extensionUri: vscode.Uri.file('/mock/extension'),
      subscriptions: []
    } as any;

    loader = new PromptLoader(mockContext);
  });

  teardown(() => {
    sandbox.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  suite('getAvailablePrompts()', () => {
    test('should return empty array when bundles directory does not exist', async () => {
      fs.rmSync(bundlesDir, { recursive: true, force: true });

      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts, []);
    });

    test('should return empty array when no bundles are installed', async () => {
      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts, []);
    });

    test('should return prompts from a bundle with valid manifest', async () => {
      createBundleFixture('test-bundle', [
        { id: 'prompt-1', name: 'Test Prompt', description: 'A test', file: 'prompts/test.md', content: '# Test' }
      ]);

      const prompts = await loader.getAvailablePrompts();
      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].id, 'prompt-1');
      assert.strictEqual(prompts[0].name, 'Test Prompt');
      assert.strictEqual(prompts[0].bundleId, 'test-bundle');
    });

    test('should return prompts from multiple bundles', async () => {
      createBundleFixture('bundle-a', [
        { id: 'p1', name: 'Prompt A', description: 'A', file: 'a.md', content: 'A' }
      ]);
      createBundleFixture('bundle-b', [
        { id: 'p2', name: 'Prompt B', description: 'B', file: 'b.md', content: 'B' },
        { id: 'p3', name: 'Prompt C', description: 'C', file: 'c.md', content: 'C' }
      ]);

      const prompts = await loader.getAvailablePrompts();
      assert.strictEqual(prompts.length, 3);
    });

    test('should skip bundles without manifest', async () => {
      const bundlePath = path.join(bundlesDir, 'no-manifest');
      fs.mkdirSync(bundlePath, { recursive: true });

      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts, []);
    });

    test('should skip bundles with no prompts in manifest', async () => {
      const bundlePath = path.join(bundlesDir, 'no-prompts');
      fs.mkdirSync(bundlePath, { recursive: true });
      fs.writeFileSync(
        path.join(bundlePath, 'deployment-manifest.yml'),
        yaml.dump({ id: 'no-prompts', version: '1.0.0', name: 'No Prompts' })
      );

      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts, []);
    });

    test('should skip prompt entries where file does not exist', async () => {
      createBundleFixture('missing-file', [
        { id: 'exists', name: 'Exists', description: 'E', file: 'exists.md', content: 'content' },
        { id: 'missing', name: 'Missing', description: 'M', file: 'missing.md' } // no content = file not created
      ]);

      const prompts = await loader.getAvailablePrompts();
      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].id, 'exists');
    });

    test('should skip non-directory entries in bundles folder', async () => {
      fs.writeFileSync(path.join(bundlesDir, 'not-a-dir.txt'), 'file');

      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts, []);
    });

    test('should include tags from manifest', async () => {
      createBundleFixture('tagged', [
        { id: 'tp', name: 'Tagged', description: 'T', file: 't.md', tags: ['ai', 'code-review'], content: 'tagged' }
      ]);

      const prompts = await loader.getAvailablePrompts();
      assert.deepStrictEqual(prompts[0].tags, ['ai', 'code-review']);
    });
  });

  suite('loadPrompt()', () => {
    test('should return null for non-existent prompt', async () => {
      const result = await loader.loadPrompt('non-existent');
      assert.strictEqual(result, null);
    });

    test('should load prompt content from file', async () => {
      createBundleFixture('my-bundle', [
        { id: 'my-prompt', name: 'My Prompt', description: 'Desc', file: 'prompt.md', content: '# Hello World' }
      ]);

      const result = await loader.loadPrompt('my-prompt');
      assert.ok(result);
      assert.strictEqual(result.info.id, 'my-prompt');
      assert.strictEqual(result.content, '# Hello World');
    });

    test('should cache loaded prompts', async () => {
      createBundleFixture('cached-bundle', [
        { id: 'cached', name: 'Cached', description: 'C', file: 'c.md', content: 'cached content' }
      ]);

      const first = await loader.loadPrompt('cached');
      const second = await loader.loadPrompt('cached');
      assert.strictEqual(first, second); // same reference from cache
    });
  });
});
