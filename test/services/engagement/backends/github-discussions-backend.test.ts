/**
 * Tests for GitHubDiscussionsBackend
 * GitHub Discussions-based engagement backend (lazy-creation API).
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import nock from 'nock';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  GitHubDiscussionsBackend,
} from '../../../../src/services/engagement/backends/github-discussions-backend';
import {
  Feedback,
  GitHubDiscussionsBackendConfig,
  Rating,
} from '../../../../src/types/engagement';

/**
 * Narrow accessor type for the private fields a few tests need to reach
 * (cache hit assertions, category resolution shortcut).
 */
interface BackendPrivates {
  categoryId: string | undefined;
  discussionMappings: Map<string, { resourceId: string; discussionNumber: number; commentId?: number }>;
}

/**
 * Cast helper to access private state without leaking `any` into tests.
 * @param b The backend instance to view privately.
 */
function asPrivate(b: GitHubDiscussionsBackend): BackendPrivates {
  return b as unknown as BackendPrivates;
}

suite('GitHubDiscussionsBackend', () => {
  let sandbox: sinon.SinonSandbox;
  let backend: GitHubDiscussionsBackend;
  let tempDir: string;

  const mockConfig: GitHubDiscussionsBackendConfig = {
    type: 'github-discussions',
    repository: 'test-owner/test-repo',
    category: 'Feedback'
  };

  const mockSession = {
    accessToken: 'mock-token',
    account: { id: '123', label: 'testuser' },
    id: 'session-id',
    scopes: ['repo']
  };

  let getSessionStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-discussions-test-'));
    backend = new GitHubDiscussionsBackend(tempDir);
    getSessionStub = sandbox.stub(vscode.authentication, 'getSession').resolves(mockSession);
  });

  teardown(() => {
    sandbox.restore();
    nock.cleanAll();
    if (backend.initialized) {
      backend.dispose();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  suite('initialize()', () => {
    test('should initialize with valid config', async () => {
      await backend.initialize(mockConfig);
      assert.strictEqual(backend.initialized, true);
    });

    test('should throw error for invalid config type', async () => {
      await assert.rejects(
        backend.initialize({ type: 'file', storagePath: '/tmp' } as unknown as GitHubDiscussionsBackendConfig),
        /Invalid config type/
      );
    });

    test('should throw error for invalid repository format', async () => {
      await assert.rejects(
        backend.initialize({ ...mockConfig, repository: 'invalid' }),
        /Invalid repository format/
      );
    });
  });

  suite('dispose()', () => {
    test('should clean up resources', async () => {
      await backend.initialize(mockConfig);
      backend.dispose();
      assert.strictEqual(backend.initialized, false);
    });
  });

  suite('getRepository()', () => {
    test('should return repository owner and name', async () => {
      await backend.initialize(mockConfig);
      const repo = backend.getRepository();
      assert.strictEqual(repo.owner, 'test-owner');
      assert.strictEqual(repo.repo, 'test-repo');
    });

    test('should throw when not initialized', () => {
      assert.throws(
        () => backend.getRepository(),
        /not initialized/
      );
    });
  });

  suite('Rating Operations (local fallback)', () => {
    test('falls back to local storage when ensureDiscussion errors and no auth prompt', async () => {
      await backend.initialize(mockConfig);

      // Force ensureCategoryResolved to fail with a non-auth error.
      nock('https://api.github.com')
        .post('/graphql')
        .reply(500, { message: 'Internal Server Error' });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:unmapped-bundle',
        score: 4,
        timestamp: new Date().toISOString()
      };

      await assert.rejects(backend.submitRating(rating), /Failed to resolve discussion category|Request failed/);

      // Local copy is persisted as unsynced.
      const retrieved = await backend.getRating('bundle', 'src:unmapped-bundle');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.score, 4);
      assert.strictEqual(retrieved.synced, false);
    });

    test('deleteRating clears local entry only', async () => {
      await backend.initialize(mockConfig);

      // Pre-populate via cache hit so submitRating succeeds without remote.
      asPrivate(backend).categoryId = 'CAT_PRE';
      asPrivate(backend).discussionMappings.set('src:test-bundle', {
        resourceId: 'src:test-bundle',
        discussionNumber: 7
      });

      // Mock postOrEditRatingComment path: findViewerComment (empty) → getDiscussionNodeId → addDiscussionComment.
      nock('https://api.github.com')
        .post('/graphql')
        .reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        .post('/graphql')
        .reply(200, { data: { repository: { discussion: { id: 'D_kwDO_pre' } } } })
        .post('/graphql')
        .reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:test-bundle',
        score: 3,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);
      assert.ok((await backend.getRating('bundle', 'src:test-bundle')) !== undefined);

      await backend.deleteRating('bundle', 'src:test-bundle');
      const retrieved = await backend.getRating('bundle', 'src:test-bundle');
      assert.strictEqual(retrieved, undefined);
    });
  });

  suite('Feedback Operations', () => {
    test('submits and retrieves feedback locally even when remote fails', async () => {
      await backend.initialize(mockConfig);

      // ensureDiscussion will try to resolve the category and fail; submitFeedback swallows.
      nock('https://api.github.com')
        .post('/graphql')
        .reply(500, { message: 'Internal Server Error' });

      const feedback: Feedback = {
        id: 'feedback-1',
        resourceType: 'bundle',
        resourceId: 'src:test-bundle',
        comment: 'Great bundle!',
        timestamp: new Date().toISOString()
      };

      await backend.submitFeedback(feedback);
      const retrieved = await backend.getFeedback('bundle', 'src:test-bundle');
      assert.strictEqual(retrieved.length, 1);
      assert.strictEqual(retrieved[0].comment, 'Great bundle!');
    });

    test('deletes feedback', async () => {
      await backend.initialize(mockConfig);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(500, { message: 'Internal Server Error' });

      const feedback: Feedback = {
        id: 'feedback-1',
        resourceType: 'bundle',
        resourceId: 'src:test-bundle',
        comment: 'Test feedback',
        timestamp: new Date().toISOString()
      };

      await backend.submitFeedback(feedback);
      await backend.deleteFeedback('feedback-1');
      const retrieved = await backend.getFeedback('bundle', 'src:test-bundle');
      assert.strictEqual(retrieved.length, 0);
    });

    test('posts feedback as discussion comment when ensureDiscussion succeeds via cache', async () => {
      await backend.initialize(mockConfig);

      // Pre-cache mapping so ensureDiscussion is a cache hit.
      asPrivate(backend).categoryId = 'CAT_1';
      asPrivate(backend).discussionMappings.set('src:bundle-1', {
        resourceId: 'src:bundle-1',
        discussionNumber: 42
      });

      let capturedBody = '';

      nock('https://api.github.com')
        // findViewerComment (no existing comments)
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_kwDOTest42' } } } })
        // addDiscussionComment (capture body)
        .post('/graphql', (body: { variables?: { body?: string } }) => {
          capturedBody = body.variables?.body ?? '';
          return true;
        }).reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const feedback: Feedback = {
        id: 'feedback-1',
        resourceType: 'bundle',
        resourceId: 'src:bundle-1',
        comment: 'Works great!',
        rating: 5,
        timestamp: new Date().toISOString()
      };

      await backend.submitFeedback(feedback);

      assert.ok(nock.isDone(), 'All GraphQL mocks consumed (feedback comment posted)');
      assert.ok(capturedBody.includes('⭐'), 'Comment should include star rating');
      assert.ok(capturedBody.includes('Works great!'), 'Comment should include feedback text');

      const retrieved = await backend.getFeedback('bundle', 'src:bundle-1');
      assert.strictEqual(retrieved.length, 1);
    });
  });

  suite('ensureDiscussion (cache → search → create)', () => {
    test('cache hit returns mapping without GraphQL search', async () => {
      await backend.initialize(mockConfig);

      asPrivate(backend).categoryId = 'CAT_1';
      asPrivate(backend).discussionMappings.set('src:b', {
        resourceId: 'src:b',
        discussionNumber: 42
      });

      // Only postOrEditRatingComment GraphQL calls should be made — no search.
      nock('https://api.github.com')
        // findViewerComment
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_42' } } } })
        // addDiscussionComment
        .post('/graphql').reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 4,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);
      assert.ok(nock.isDone(), 'Exactly 3 GraphQL calls expected (post-comment path), no category/search/create');

      // Mapping unchanged.
      const cached = asPrivate(backend).discussionMappings.get('src:b');
      assert.ok(cached);
      assert.strictEqual(cached.discussionNumber, 42);
    });

    test('cache miss + search hit caches the mapping', async () => {
      await backend.initialize(mockConfig);
      asPrivate(backend).categoryId = 'CAT_1';

      let createCalled = false;

      nock('https://api.github.com')
        // searchDiscussionByTitle → matching node
        .post('/graphql').reply(200, {
          data: {
            search: {
              nodes: [{ number: 77, title: '[rating] src/b', category: { id: 'CAT_1' } }]
            }
          }
        })
        // findViewerComment
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_77' } } } })
        // addDiscussionComment
        .post('/graphql').reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      // Track that no createDiscussion mutation is called.
      const createScope = nock('https://api.github.com')
        .post('/graphql', (body: { query?: string }) => {
          if (body.query?.includes('createDiscussion')) {
            createCalled = true;
            return true;
          }
          return false;
        })
        .reply(200, {});

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 5,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);

      assert.strictEqual(createCalled, false, 'createDiscussion mutation must not run when search hits');
      assert.strictEqual(createScope.isDone(), false, 'create scope should be untouched');

      const cached = asPrivate(backend).discussionMappings.get('src:b');
      assert.ok(cached, 'Mapping must be cached after search hit');
      assert.strictEqual(cached.discussionNumber, 77);
    });

    test('cache miss + search miss creates a new discussion', async () => {
      await backend.initialize(mockConfig);
      asPrivate(backend).categoryId = 'CAT_1';

      nock('https://api.github.com')
        // searchDiscussionByTitle → empty
        .post('/graphql').reply(200, { data: { search: { nodes: [] } } })
        // createDiscussion: repo id query
        .post('/graphql').reply(200, { data: { repository: { id: 'R_kwDORepo' } } })
        // createDiscussion: mutation
        .post('/graphql').reply(200, { data: { createDiscussion: { discussion: { number: 101 } } } })
        // findViewerComment
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_101' } } } })
        // addDiscussionComment
        .post('/graphql').reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 4,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);
      assert.ok(nock.isDone(), 'All search-miss + create + comment-post mocks consumed');

      const cached = asPrivate(backend).discussionMappings.get('src:b');
      assert.ok(cached);
      assert.strictEqual(cached.discussionNumber, 101);

      const stored = await backend.getRating('bundle', 'src:b');
      assert.ok(stored);
      assert.strictEqual(stored.synced, true);
    });

    test('search throws then falls through to create', async () => {
      await backend.initialize(mockConfig);
      asPrivate(backend).categoryId = 'CAT_1';

      nock('https://api.github.com')
        // searchDiscussionByTitle → network error
        .post('/graphql').replyWithError('boom')
        // createDiscussion: repo id query
        .post('/graphql').reply(200, { data: { repository: { id: 'R_kwDORepo' } } })
        // createDiscussion: mutation
        .post('/graphql').reply(200, { data: { createDiscussion: { discussion: { number: 202 } } } })
        // findViewerComment
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_202' } } } })
        // addDiscussionComment
        .post('/graphql').reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 3,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);
      assert.ok(nock.isDone(), 'All mocks consumed despite search error');

      const cached = asPrivate(backend).discussionMappings.get('src:b');
      assert.ok(cached);
      assert.strictEqual(cached.discussionNumber, 202);
    });
  });

  suite('submitRating (lazy creation)', () => {
    test('first vote: search miss → create → comment marks rating synced=true', async () => {
      await backend.initialize(mockConfig);

      nock('https://api.github.com')
        // category resolution
        .post('/graphql').reply(200, {
          data: {
            repository: {
              discussionCategories: {
                nodes: [{ id: 'CAT_FB', name: 'Feedback' }]
              }
            }
          }
        })
        // search → empty
        .post('/graphql').reply(200, { data: { search: { nodes: [] } } })
        // create: repo id
        .post('/graphql').reply(200, { data: { repository: { id: 'R_kwDORepo' } } })
        // create: mutation
        .post('/graphql').reply(200, { data: { createDiscussion: { discussion: { number: 7 } } } })
        // findViewerComment
        .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
        // getDiscussionNodeId
        .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_7' } } } })
        // addDiscussionComment
        .post('/graphql').reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: '' } } } });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:bundle-1',
        score: 5,
        sourceId: 'otter',
        displayName: 'Bundle One',
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);
      assert.ok(nock.isDone(), 'All seven GraphQL mocks consumed');

      const stored = await backend.getRating('bundle', 'src:bundle-1');
      assert.ok(stored, 'Rating must be persisted locally');
      assert.strictEqual(stored.score, 5);
      assert.strictEqual(stored.synced, true);
    });

    test('createDiscussion 403 prompts re-auth and marks synced=false', async () => {
      await backend.initialize(mockConfig);
      asPrivate(backend).categoryId = 'CAT_1';

      const showWarning = sandbox.stub(vscode.window, 'showWarningMessage').resolves('Cancel' as unknown as vscode.MessageItem);

      nock('https://api.github.com')
        // search → empty
        .post('/graphql').reply(200, { data: { search: { nodes: [] } } })
        // createDiscussion: repo id query → 403
        .post('/graphql').reply(403, { message: 'Resource not accessible by integration' });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 4,
        timestamp: new Date().toISOString()
      };

      await assert.rejects(backend.submitRating(rating));

      assert.strictEqual(showWarning.callCount, 1, 'showWarningMessage should be invoked once');

      const stored = await backend.getRating('bundle', 'src:b');
      assert.ok(stored, 'Rating must be persisted locally');
      assert.strictEqual(stored.synced, false, 'Rating must be marked unsynced after auth failure');
    });

    test('post-ensure: cache-hit path persists with synced=true (post errors are swallowed)', async () => {
      // postOrEditRatingComment swallows errors internally, so submitRating
      // marks the rating synced=true after a successful ensureDiscussion.
      await backend.initialize(mockConfig);

      asPrivate(backend).categoryId = 'CAT_1';
      asPrivate(backend).discussionMappings.set('src:b', {
        resourceId: 'src:b',
        discussionNumber: 99
      });

      // findViewerComment fails — postOrEditRatingComment catches and logs.
      nock('https://api.github.com')
        .post('/graphql')
        .reply(500, { message: 'Internal Server Error' });

      const rating: Rating = {
        id: 'rating-1',
        resourceType: 'bundle',
        resourceId: 'src:b',
        score: 5,
        timestamp: new Date().toISOString()
      };

      await backend.submitRating(rating);

      const cached = asPrivate(backend).discussionMappings.get('src:b');
      assert.ok(cached);
      assert.strictEqual(cached.discussionNumber, 99, 'Cached mapping should be retained');

      const stored = await backend.getRating('bundle', 'src:b');
      assert.ok(stored);
      assert.strictEqual(stored.synced, true, 'submitRating sets synced=true after ensureDiscussion succeeds');
    });
  });

  suite('handleAuthError', () => {
    test('403 with "Sign in again" forces a new session and rethrows', async () => {
      await backend.initialize(mockConfig);

      const showWarning = sandbox
        .stub(vscode.window, 'showWarningMessage')
        .resolves('Sign in again' as unknown as vscode.MessageItem);

      const err = { response: { status: 403 } };
      await assert.rejects(
        (backend as unknown as { handleAuthError(e: unknown, op: string): Promise<never> }).handleAuthError(err, 'test op')
      );

      assert.strictEqual(showWarning.callCount, 1, 'warning prompt shown once');
      const forceNewCall = getSessionStub
        .getCalls()
        .find((c) => (c.args[2] as { forceNewSession?: boolean } | undefined)?.forceNewSession === true);
      assert.ok(forceNewCall, 'getSession must be called with forceNewSession: true');
    });

    test('403 with "Cancel" rethrows without calling getSession with forceNewSession', async () => {
      await backend.initialize(mockConfig);

      const showWarning = sandbox
        .stub(vscode.window, 'showWarningMessage')
        .resolves('Cancel' as unknown as vscode.MessageItem);
      const callsBefore = getSessionStub.callCount;

      const err = { response: { status: 403 } };
      await assert.rejects(
        (backend as unknown as { handleAuthError(e: unknown, op: string): Promise<never> }).handleAuthError(err, 'test op')
      );

      assert.strictEqual(showWarning.callCount, 1);
      const forceNewCall = getSessionStub
        .getCalls()
        .slice(callsBefore)
        .find((c) => (c.args[2] as { forceNewSession?: boolean } | undefined)?.forceNewSession === true);
      assert.strictEqual(forceNewCall, undefined, 'No forceNewSession call when user cancels');
    });

    test('non-auth error rethrows without prompt or forced session', async () => {
      await backend.initialize(mockConfig);

      const showWarning = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
      const callsBefore = getSessionStub.callCount;

      const err = { response: { status: 500 } };
      await assert.rejects(
        (backend as unknown as { handleAuthError(e: unknown, op: string): Promise<never> }).handleAuthError(err, 'test op')
      );

      assert.strictEqual(showWarning.callCount, 0, 'No warning prompt for non-auth errors');
      const forceNewCall = getSessionStub
        .getCalls()
        .slice(callsBefore)
        .find((c) => (c.args[2] as { forceNewSession?: boolean } | undefined)?.forceNewSession === true);
      assert.strictEqual(forceNewCall, undefined);
    });
  });

  suite('fetchViewerRatings()', () => {
    test('returns ratings parsed from viewer comments across discussions', async () => {
      await backend.initialize(mockConfig);
      asPrivate(backend).discussionMappings.set('otter:otter-bundle', {
        resourceId: 'otter:otter-bundle',
        discussionNumber: 9
      });
      asPrivate(backend).discussionMappings.set('otter:fox-bundle', {
        resourceId: 'otter:fox-bundle',
        discussionNumber: 10
      });

      nock('https://api.github.com')
        // search for viewer's discussions
        .post('/graphql').reply(200, {
          data: { search: { nodes: [{ number: 9 }, { number: 10 }, { number: 99 }] } }
        })
        // comments for #9
        .post('/graphql').reply(200, {
          data: {
            repository: {
              discussion: {
                comments: {
                  nodes: [
                    { id: 'DC_1', author: { login: 'testuser' }, body: 'Rating: ⭐⭐⭐' },
                    { id: 'DC_other', author: { login: 'otheruser' }, body: 'Rating: ⭐⭐⭐⭐⭐' }
                  ]
                }
              }
            }
          }
        })
        // comments for #10
        .post('/graphql').reply(200, {
          data: {
            repository: {
              discussion: {
                comments: {
                  nodes: [
                    { id: 'DC_2', author: { login: 'testuser' }, body: 'Rating: ⭐⭐⭐⭐⭐' }
                  ]
                }
              }
            }
          }
        });

      const results = await backend.fetchViewerRatings();

      assert.strictEqual(results.length, 2);
      assert.deepStrictEqual(results[0], { resourceId: 'otter:otter-bundle', score: 3 });
      assert.deepStrictEqual(results[1], { resourceId: 'otter:fox-bundle', score: 5 });
    });

    test('returns empty array when search finds no discussions', async () => {
      await backend.initialize(mockConfig);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(200, { data: { search: { nodes: [] } } });

      const results = await backend.fetchViewerRatings();
      assert.deepStrictEqual(results, []);
    });

    test('returns empty array on API error', async () => {
      await backend.initialize(mockConfig);

      nock('https://api.github.com')
        .post('/graphql')
        .reply(500, { message: 'Internal Server Error' });

      const results = await backend.fetchViewerRatings();
      assert.deepStrictEqual(results, []);
    });
  });

  suite('Error Handling', () => {
    test('throws when not initialized', async () => {
      await assert.rejects(
        backend.getRating('bundle', 'test'),
        /not initialized/
      );
    });
  });
});
