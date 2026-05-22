/**
 * Tests for EngagementCommands
 * VS Code commands for collecting user feedback and rating retry drain.
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  EngagementCommands,
  FeedbackableItem,
} from '../../src/commands/engagement-commands';
import {
  EngagementService,
} from '../../src/services/engagement/engagement-service';
import {
  RatingCache,
} from '../../src/services/engagement/rating-cache';
import {
  Feedback,
} from '../../src/types/engagement';

suite('EngagementCommands', () => {
  let sandbox: sinon.SinonSandbox;
  let commands: EngagementCommands;
  let mockEngagementService: sinon.SinonStubbedInstance<EngagementService>;
  let showInputBoxStub: sinon.SinonStub;
  let showQuickPickStub: sinon.SinonStub;
  let showInformationMessageStub: sinon.SinonStub;
  let showWarningMessageStub: sinon.SinonStub;

  const createMockItem = (overrides: Partial<FeedbackableItem> = {}): FeedbackableItem => ({
    resourceId: 'test-bundle',
    resourceType: 'bundle',
    name: 'Test Bundle',
    version: '1.0.0',
    ...overrides
  });

  const createMockFeedback = (comment: string, rating?: 1 | 2 | 3 | 4 | 5): Feedback => ({
    id: 'feedback-123',
    resourceType: 'bundle',
    resourceId: 'test-bundle',
    comment,
    rating,
    timestamp: new Date().toISOString()
  });

  setup(() => {
    sandbox = sinon.createSandbox();

    showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
    showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
    showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
    showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
    sandbox.stub(vscode.window, 'showErrorMessage');

    mockEngagementService = {
      submitFeedback: sandbox.stub(),
      submitRating: sandbox.stub(),
      savePendingFeedback: sandbox.stub().resolves(),
      getUnsyncedFeedback: sandbox.stub().resolves([]),
      markFeedbackSynced: sandbox.stub().resolves(),
      getUnsyncedRatings: sandbox.stub().resolves([]),
      markRatingSynced: sandbox.stub().resolves()
    } as unknown as sinon.SinonStubbedInstance<EngagementService>;

    commands = new EngagementCommands(mockEngagementService);
  });

  teardown(() => {
    sandbox.restore();
    RatingCache.resetInstance();
  });

  suite('submitFeedback()', () => {
    test('should submit feedback with rating and comment', async () => {
      const item = createMockItem();
      const feedback = createMockFeedback('Great bundle!', 5);

      showQuickPickStub.onFirstCall().resolves({
        label: '⭐⭐⭐⭐⭐',
        description: '5 stars - Excellent!'
      });
      showInputBoxStub.onFirstCall().resolves('Great bundle!');
      showQuickPickStub.onSecondCall().resolves({
        label: '⏭️ Skip',
        description: 'Just submit the star rating'
      });
      mockEngagementService.submitFeedback.resolves(feedback);

      const result = await commands.submitFeedback(item);

      assert.strictEqual(result.success, true);
      assert.ok(result.feedback);
      assert.ok(showInformationMessageStub.calledOnce);
    });

    test('should return cancelled when user cancels rating selection', async () => {
      const item = createMockItem();
      showQuickPickStub.resolves(undefined);

      const result = await commands.submitFeedback(item);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Cancelled');
    });

    test('should save rating when user cancels comment input', async () => {
      const item = createMockItem();
      const feedback = createMockFeedback('Rated 4 stars', 4);

      showQuickPickStub.resolves({
        label: '⭐⭐⭐⭐☆',
        description: '4 stars - Very good'
      });
      showInputBoxStub.resolves(undefined);
      mockEngagementService.submitFeedback.resolves(feedback);

      const result = await commands.submitFeedback(item);

      assert.strictEqual(result.success, true);
      const callArgs = mockEngagementService.submitFeedback.firstCall.args;
      assert.strictEqual(callArgs[3]?.rating, 4);
    });
  });

  suite('Network Resilience', () => {
    test('should silently store feedback locally when remote submission fails', async () => {
      const item = createMockItem({ hubId: 'test-hub' });

      showQuickPickStub.onFirstCall().resolves({
        label: '⭐⭐⭐☆☆',
        description: '3 stars - Good'
      });
      showInputBoxStub.resolves('Test feedback');
      showQuickPickStub.onSecondCall().resolves({
        label: '⏭️ Skip'
      });
      mockEngagementService.submitFeedback.rejects(new Error('Network error'));

      const result = await commands.submitFeedback(item);

      // Feedback saved locally = success from caller's perspective
      assert.strictEqual(result.success, true);
      assert.ok(result.feedback);
      // No user-facing warning — drain on next activation will retry
      assert.strictEqual(showWarningMessageStub.callCount, 0);
      // No "Thank you" toast since the remote submission failed
      assert.strictEqual(showInformationMessageStub.callCount, 0);
      // Pending feedback was persisted
      assert.ok(mockEngagementService.savePendingFeedback.calledOnce);
      const savedEntry = mockEngagementService.savePendingFeedback.firstCall.args[0];
      assert.strictEqual(savedEntry.synced, false);
    });

    test('should apply optimistic rating update after submission', async () => {
      const item = createMockItem({ hubId: 'test-hub', sourceId: 'test-source' });
      const feedback = createMockFeedback('Nice!', 4);

      const ratingCache = RatingCache.getInstance();
      const applyStub = sandbox.stub(ratingCache, 'applyOptimisticRating');

      showQuickPickStub.onFirstCall().resolves({
        label: '⭐⭐⭐⭐☆',
        description: '4 stars - Very good'
      });
      showInputBoxStub.resolves('Nice!');
      showQuickPickStub.onSecondCall().resolves({
        label: '⏭️ Skip'
      });
      mockEngagementService.submitFeedback.resolves(feedback);

      await commands.submitFeedback(item);

      assert.ok(applyStub.calledOnce);
      assert.strictEqual(applyStub.firstCall.args[0], 'test-source');
      assert.strictEqual(applyStub.firstCall.args[1], 'test-bundle');
      assert.strictEqual(applyStub.firstCall.args[2], 4);
    });

    test('should mark feedback as synced when remote submission succeeds', async () => {
      const item = createMockItem({ hubId: 'test-hub' });
      const feedback = createMockFeedback('Great!', 5);

      showQuickPickStub.onFirstCall().resolves({
        label: '⭐⭐⭐⭐⭐',
        description: '5 stars - Excellent!'
      });
      showInputBoxStub.resolves('Great!');
      showQuickPickStub.onSecondCall().resolves({
        label: '⏭️ Skip'
      });
      mockEngagementService.submitFeedback.resolves(feedback);

      const result = await commands.submitFeedback(item);

      assert.strictEqual(result.success, true);
      assert.ok(showInformationMessageStub.calledOnce);
      assert.ok(mockEngagementService.savePendingFeedback.calledOnce);
      const savedEntry = mockEngagementService.savePendingFeedback.firstCall.args[0];
      assert.strictEqual(savedEntry.synced, true);
    });
  });

  suite('registerCommands()', () => {
    test('should register engagement commands', () => {
      const mockContext = {
        subscriptions: [] as vscode.Disposable[]
      } as vscode.ExtensionContext;

      const registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand').returns({
        dispose: () => {}
      });

      commands.registerCommands(mockContext);

      assert.strictEqual(registerCommandStub.callCount, 3);
      assert.ok(registerCommandStub.calledWith('promptRegistry.feedback'));
      assert.ok(registerCommandStub.calledWith('promptRegistry.reportIssue'));
      assert.ok(registerCommandStub.calledWith('promptRegistry.requestFeature'));
    });
  });

  suite('Issue Tracker URL Encoding', () => {
    let openExternalStub: sinon.SinonStub;

    setup(() => {
      openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
    });

    test('reportIssue URL should not double-encode markdown characters', async () => {
      const item = createMockItem({
        sourceUrl: 'https://github.com/org/repo',
        sourceType: 'github'
      });

      await commands.reportIssue(item);

      assert.ok(openExternalStub.calledOnce, 'openExternal should be called');
      const uri: vscode.Uri = openExternalStub.firstCall.args[0];
      const url = uri.toString();

      const queryString = url.split('?')[1];
      assert.ok(queryString, 'URL should have query string');

      const params = new URLSearchParams(queryString);
      const body = params.get('body');
      assert.ok(body, 'body param should exist');
      assert.ok(body.includes('## Bug Description'));
      assert.ok(body.includes('## Steps to Reproduce'));
      assert.ok(!body.includes('%23'));
    });

    test('requestFeature URL should not double-encode markdown characters', async () => {
      const item = createMockItem({
        sourceUrl: 'https://github.com/org/repo',
        sourceType: 'github'
      });

      await commands.requestFeature(item);

      assert.ok(openExternalStub.calledOnce);
      const uri: vscode.Uri = openExternalStub.firstCall.args[0];
      const url = uri.toString();

      const queryString = url.split('?')[1];
      const params = new URLSearchParams(queryString);
      const body = params.get('body');
      assert.ok(body, 'body param should exist');
      assert.ok(body.includes('## Feature Description'));
      assert.ok(!body.includes('%23'));
      assert.ok(!body.includes('%3F'));
    });
  });

  suite('drainUnsyncedRatings()', () => {
    test('returns 0 when there are no unsynced ratings', async () => {
      mockEngagementService.getUnsyncedRatings.resolves([]);

      const result = await commands.drainUnsyncedRatings();

      assert.strictEqual(result, 0);
      assert.strictEqual(mockEngagementService.submitRating.callCount, 0);
      assert.strictEqual(mockEngagementService.markRatingSynced.callCount, 0);
    });

    test('resubmits each unsynced rating and marks it synced when remote succeeds', async () => {
      const ratings = [
        { id: 'r1', resourceType: 'bundle' as const, resourceId: 'bundle-a', score: 5 as const, timestamp: 't1', sourceId: 'src-a', hubId: 'hub-1', synced: false },
        { id: 'r2', resourceType: 'bundle' as const, resourceId: 'bundle-b', score: 3 as const, timestamp: 't2', sourceId: 'src-b', hubId: 'hub-2', synced: false }
      ];
      mockEngagementService.getUnsyncedRatings.resolves(ratings);
      mockEngagementService.submitRating.resolves(ratings[0]);

      const result = await commands.drainUnsyncedRatings();

      assert.strictEqual(result, 2);
      assert.strictEqual(mockEngagementService.submitRating.callCount, 2);

      const firstArgs = mockEngagementService.submitRating.firstCall.args;
      assert.strictEqual(firstArgs[0], 'bundle');
      assert.strictEqual(firstArgs[1], 'bundle-a');
      assert.strictEqual(firstArgs[2], 5);
      assert.deepStrictEqual(firstArgs[3], { version: undefined, hubId: 'hub-1', sourceId: 'src-a' });

      assert.strictEqual(mockEngagementService.markRatingSynced.callCount, 2);
      assert.ok(mockEngagementService.markRatingSynced.calledWith('r1'));
      assert.ok(mockEngagementService.markRatingSynced.calledWith('r2'));
    });

    test('leaves an entry unsynced when submitRating throws and continues with the rest', async () => {
      const ratings = [
        { id: 'r-ok', resourceType: 'bundle' as const, resourceId: 'a', score: 5 as const, timestamp: 't', sourceId: 's', hubId: 'h', synced: false },
        { id: 'r-fail', resourceType: 'bundle' as const, resourceId: 'b', score: 4 as const, timestamp: 't', sourceId: 's', hubId: 'h', synced: false },
        { id: 'r-ok-2', resourceType: 'bundle' as const, resourceId: 'c', score: 3 as const, timestamp: 't', sourceId: 's', hubId: 'h', synced: false }
      ];
      mockEngagementService.getUnsyncedRatings.resolves(ratings);
      mockEngagementService.submitRating.callsFake((_rt: any, resourceId: string) => {
        if (resourceId === 'b') {
          return Promise.reject(new Error('still offline'));
        }
        return Promise.resolve(ratings[0]);
      });

      const result = await commands.drainUnsyncedRatings();

      assert.strictEqual(result, 2);
      assert.ok(mockEngagementService.markRatingSynced.calledWith('r-ok'));
      assert.ok(!mockEngagementService.markRatingSynced.calledWith('r-fail'));
      assert.ok(mockEngagementService.markRatingSynced.calledWith('r-ok-2'));
    });
  });

  suite('drainUnsyncedFeedback()', () => {
    test('returns 0 when storage is empty', async () => {
      mockEngagementService.getUnsyncedFeedback.resolves([]);

      const result = await commands.drainUnsyncedFeedback();

      assert.strictEqual(result, 0);
      assert.strictEqual(mockEngagementService.submitFeedback.callCount, 0);
      assert.strictEqual(mockEngagementService.markFeedbackSynced.callCount, 0);
    });

    test('submits and marks all entries synced when all succeed', async () => {
      const entries = [
        { id: 'e1', bundleId: 'b1', sourceId: 'b1', hubId: 'h1', resourceType: 'bundle' as const, rating: 5 as const, comment: 'one', timestamp: 't1', synced: false },
        { id: 'e2', bundleId: 'b2', sourceId: 'b2', hubId: 'h2', resourceType: 'bundle' as const, rating: 4 as const, comment: undefined, timestamp: 't2', synced: false },
        { id: 'e3', bundleId: 'b3', sourceId: 'b3', hubId: '', resourceType: 'bundle' as const, rating: 3 as const, comment: 'three', timestamp: 't3', synced: false }
      ];
      mockEngagementService.getUnsyncedFeedback.resolves(entries);
      mockEngagementService.submitFeedback.resolves(createMockFeedback('ok', 5));

      const result = await commands.drainUnsyncedFeedback();

      assert.strictEqual(result, 3);
      assert.strictEqual(mockEngagementService.submitFeedback.callCount, 3);

      const firstArgs = mockEngagementService.submitFeedback.firstCall.args;
      assert.strictEqual(firstArgs[0], 'bundle');
      assert.strictEqual(firstArgs[1], 'b1');
      assert.strictEqual(firstArgs[2], 'one');
      assert.deepStrictEqual(firstArgs[3], { rating: 5, hubId: 'h1' });

      const secondArgs = mockEngagementService.submitFeedback.secondCall.args;
      assert.strictEqual(secondArgs[2], 'Rated 4 stars');

      const thirdArgs = mockEngagementService.submitFeedback.thirdCall.args;
      assert.deepStrictEqual(thirdArgs[3], { rating: 3, hubId: undefined });

      assert.strictEqual(mockEngagementService.markFeedbackSynced.callCount, 3);
      assert.ok(mockEngagementService.markFeedbackSynced.calledWith('e1'));
      assert.ok(mockEngagementService.markFeedbackSynced.calledWith('e2'));
      assert.ok(mockEngagementService.markFeedbackSynced.calledWith('e3'));
    });

    test('returns success count and leaves failed entries unsynced on partial failure', async () => {
      const entries = [
        { id: 'e1', bundleId: 'b1', sourceId: 'b1', hubId: 'h1', resourceType: 'bundle' as const, rating: 5 as const, comment: 'one', timestamp: 't1', synced: false },
        { id: 'e2', bundleId: 'b2', sourceId: 'b2', hubId: 'h2', resourceType: 'bundle' as const, rating: 4 as const, comment: 'two', timestamp: 't2', synced: false },
        { id: 'e3', bundleId: 'b3', sourceId: 'b3', hubId: 'h3', resourceType: 'bundle' as const, rating: 3 as const, comment: 'three', timestamp: 't3', synced: false }
      ];
      mockEngagementService.getUnsyncedFeedback.resolves(entries);

      mockEngagementService.submitFeedback.callsFake((_rt: any, resourceId: string) => {
        if (resourceId === 'b2') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(createMockFeedback('ok', 5));
      });

      const result = await commands.drainUnsyncedFeedback();

      assert.strictEqual(result, 2);
      assert.strictEqual(mockEngagementService.markFeedbackSynced.callCount, 2);
      assert.ok(mockEngagementService.markFeedbackSynced.calledWith('e1'));
      assert.ok(!mockEngagementService.markFeedbackSynced.calledWith('e2'));
      assert.ok(mockEngagementService.markFeedbackSynced.calledWith('e3'));
    });
  });
});
