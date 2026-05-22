/**
 * Tests for EngagementService
 * Unified facade for ratings and feedback
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  GitHubDiscussionsBackend,
} from '../../../src/services/engagement/backends/github-discussions-backend';
import {
  EngagementService,
} from '../../../src/services/engagement/engagement-service';

suite('EngagementService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: EngagementService;
  let tempDir: string;
  let mockContext: vscode.ExtensionContext;

  const createMockContext = (storagePath: string): vscode.ExtensionContext => ({
    globalStorageUri: vscode.Uri.file(storagePath),
    subscriptions: [],
    workspaceState: {
      get: sandbox.stub() as any,
      update: sandbox.stub(),
      keys: () => []
    },
    globalState: {
      get: sandbox.stub() as any,
      update: sandbox.stub(),
      keys: () => [],
      setKeysForSync: sandbox.stub()
    },
    extensionUri: vscode.Uri.file('/mock/extension'),
    extensionPath: '/mock/extension',
    asAbsolutePath: (p: string) => path.join('/mock/extension', p),
    storagePath: storagePath,
    globalStoragePath: storagePath,
    logPath: path.join(storagePath, 'logs'),
    extensionMode: 3, // ExtensionMode.Test
    extension: {} as any,
    environmentVariableCollection: {} as any,
    secrets: {} as any,
    storageUri: vscode.Uri.file(storagePath),
    logUri: vscode.Uri.file(path.join(storagePath, 'logs')),
    languageModelAccessInformation: {} as any
  });

  setup(async () => {
    sandbox = sinon.createSandbox();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-service-test-'));
    mockContext = createMockContext(tempDir);

    EngagementService.resetInstance();

    service = EngagementService.getInstance(mockContext);
    await service.initialize();
  });

  teardown(() => {
    sandbox.restore();
    EngagementService.resetInstance();

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  suite('Singleton Pattern', () => {
    test('should return same instance on subsequent calls', () => {
      const instance1 = EngagementService.getInstance();
      const instance2 = EngagementService.getInstance();
      assert.strictEqual(instance1, instance2);
    });

    test('should throw error if context not provided on first call', () => {
      EngagementService.resetInstance();
      assert.throws(
        () => EngagementService.getInstance(),
        /ExtensionContext required/
      );
    });
  });

  suite('Initialization', () => {
    test('should initialize with file backend', () => {
      assert.strictEqual(service.initialized, true);
    });

    test('should create engagement storage directory', () => {
      const engagementDir = path.join(tempDir, 'engagement');
      assert.ok(fs.existsSync(engagementDir));
    });
  });

  suite('Rating Operations', () => {
    test('should submit a rating', async () => {
      const rating = await service.submitRating('bundle', 'test-bundle', 5);

      assert.ok(rating.id);
      assert.strictEqual(rating.score, 5);
      assert.strictEqual(rating.resourceId, 'test-bundle');
    });

    test('should fire event when rating submitted', async () => {
      let firedRating: any = null;
      service.onRatingSubmitted((rating) => {
        firedRating = rating;
      });

      await service.submitRating('bundle', 'test-bundle', 4);

      assert.ok(firedRating);
      assert.strictEqual(firedRating.score, 4);
    });

    test('should persist submitted rating in storage', async () => {
      await service.submitRating('bundle', 'test-bundle', 5, { version: '1.0.0' });

      const all = await service.getAllRatings();
      const persisted = all.find((r) => r.resourceId === 'test-bundle');
      assert.ok(persisted);
      assert.strictEqual(persisted.score, 5);
      assert.strictEqual(persisted.version, '1.0.0');
    });
  });

  suite('Feedback Operations', () => {
    test('should submit feedback', async () => {
      const feedback = await service.submitFeedback(
        'bundle',
        'test-bundle',
        'Great bundle!'
      );

      assert.ok(feedback.id);
      assert.strictEqual(feedback.comment, 'Great bundle!');
      assert.strictEqual(feedback.resourceId, 'test-bundle');
    });

    test('should submit feedback with rating', async () => {
      const feedback = await service.submitFeedback(
        'bundle',
        'test-bundle',
        'Excellent!',
        { rating: 5 }
      );

      assert.strictEqual(feedback.rating, 5);
    });

    test('should fire event when feedback submitted', async () => {
      let firedFeedback: any = null;
      service.onFeedbackSubmitted((feedback) => {
        firedFeedback = feedback;
      });

      await service.submitFeedback('bundle', 'test-bundle', 'Nice!');

      assert.ok(firedFeedback);
      assert.strictEqual(firedFeedback.comment, 'Nice!');
    });
  });

  suite('Hub Backend Management', () => {
    test('should register hub backend', async () => {
      await service.registerHubBackend('test-hub', {
        enabled: true,
        backend: { type: 'file', storagePath: tempDir }
      });

      assert.ok(service.getHubBackend('test-hub'));
    });

    test('should skip registration when engagement disabled', async () => {
      await service.registerHubBackend('disabled-hub', {
        enabled: false,
        backend: { type: 'file', storagePath: tempDir }
      });

      assert.strictEqual(service.getHubBackend('disabled-hub'), undefined);
    });

    test('falls back to file backend with warning when type is unknown', async () => {
      await service.registerHubBackend('unknown-hub', {
        enabled: true,
        // Cast through unknown to bypass the closed union; the runtime path is what matters here.
        backend: { type: 'github-issues', repository: 'owner/repo' } as any
      });

      const backend = service.getHubBackend('unknown-hub');
      assert.ok(backend);
      assert.strictEqual(backend.type, 'file');
    });
  });

  suite('registerHubBackend() — github-discussions branch', () => {
    test('registers backend and loads collections mappings on happy path', async () => {
      const loadStub = sandbox
        .stub(GitHubDiscussionsBackend.prototype, 'loadCollectionsMappings')
        .resolves();

      await service.registerHubBackend('gh-hub', {
        enabled: true,
        backend: {
          type: 'github-discussions',
          repository: 'owner/repo',
          collectionsUrl: 'https://example.com/collections.yaml'
        }
      });

      const backend = service.getHubBackend('gh-hub');
      assert.ok(backend);
      assert.strictEqual(backend.type, 'github-discussions');
      assert.ok(loadStub.calledOnceWith('https://example.com/collections.yaml'));
    });

    test('registers backend even when loadCollectionsMappings rejects', async () => {
      sandbox
        .stub(GitHubDiscussionsBackend.prototype, 'loadCollectionsMappings')
        .rejects(new Error('Boom'));

      await service.registerHubBackend('gh-hub-err', {
        enabled: true,
        backend: {
          type: 'github-discussions',
          repository: 'owner/repo',
          collectionsUrl: 'https://example.com/collections.yaml'
        }
      });

      assert.ok(service.getHubBackend('gh-hub-err'));
    });

    test('does not block activation when loadCollectionsMappings hangs past the 5s timeout', async () => {
      // Use fake timers so we can fast-forward the production-side setTimeout(5000).
      const clock = sandbox.useFakeTimers();

      // Hanging mappings load: never resolves on its own.
      sandbox
        .stub(GitHubDiscussionsBackend.prototype, 'loadCollectionsMappings')
        .returns(new Promise<void>(() => { /* never resolves */ }));

      const registerPromise = service.registerHubBackend('gh-hub-slow', {
        enabled: true,
        backend: {
          type: 'github-discussions',
          repository: 'owner/repo',
          collectionsUrl: 'https://example.com/collections.yaml'
        }
      });

      // Drive past the 5s timeout. Without it, registerHubBackend would never settle.
      await clock.tickAsync(5000);
      await registerPromise;

      assert.ok(service.getHubBackend('gh-hub-slow'));
    });

    test('happy path without collectionsUrl still registers the backend', async () => {
      const loadStub = sandbox
        .stub(GitHubDiscussionsBackend.prototype, 'loadCollectionsMappings')
        .resolves();

      await service.registerHubBackend('gh-hub-bare', {
        enabled: true,
        backend: { type: 'github-discussions', repository: 'owner/repo' }
      });

      assert.ok(service.getHubBackend('gh-hub-bare'));
      assert.strictEqual(loadStub.callCount, 0);
    });
  });
});
