# Cross-Machine Rating Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable user ratings to be recovered on any machine by persisting exact star counts as GitHub Discussion comments and hydrating from them on startup.

**Architecture:** On rating submit, post/edit a comment on the bundle's discussion with exact star count. On startup, query viewer's comments via GitHub GraphQL search, parse star counts, and feed into existing `hydrateUserRatings()` mechanism. Local storage serves as a warm cache for instant pre-fill; remote is authoritative.

**Tech Stack:** GitHub GraphQL API, axios, existing `GitHubDiscussionsBackend`, `RatingCache`, `hub-manager` orchestration.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/rating-parser.ts` (new) | Parse `Rating: ⭐⭐⭐` from comment body → `RatingScore` |
| `src/services/engagement/backends/github-discussions-backend.ts` | `submitRating()`: post/edit comment. New `findViewerComment()`, `updateDiscussionComment()`, `fetchViewerRatings()` methods |
| `src/services/engagement/rating-cache.ts` | `hydrateUserRatings()`: add `overwrite` parameter |
| `src/services/hub-manager.ts` | `registerHubEngagement()`: call remote hydration after local |
| `src/services/engagement/engagement-service.ts` | New `getHubBackend()` accessor to expose typed backend |
| `test/utils/rating-parser.test.ts` (new) | Unit tests for parser |
| `test/services/engagement/backends/github-discussions-backend.test.ts` | Extend with comment post/edit/fetch tests |
| `test/services/engagement/rating-cache.test.ts` | Test overwrite behavior |

---

### Task 1: Rating Comment Parser Utility

**Files:**
- Create: `src/utils/rating-parser.ts`
- Create: `test/utils/rating-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/utils/rating-parser.test.ts
import * as assert from 'node:assert';
import { parseRatingFromComment } from '../../src/utils/rating-parser';

suite('parseRatingFromComment', () => {
  test('parses 1 star', () => {
    assert.strictEqual(parseRatingFromComment('Rating: ⭐'), 1);
  });

  test('parses 5 stars', () => {
    assert.strictEqual(parseRatingFromComment('Rating: ⭐⭐⭐⭐⭐'), 5);
  });

  test('parses rating with feedback text below', () => {
    const body = 'Rating: ⭐⭐⭐\nFeedback: Good stuff!\n---\nVersion: 1.0.0';
    assert.strictEqual(parseRatingFromComment(body), 3);
  });

  test('returns undefined for comment without rating line', () => {
    assert.strictEqual(parseRatingFromComment('Just a regular comment'), undefined);
  });

  test('returns undefined for 0 stars', () => {
    assert.strictEqual(parseRatingFromComment('Rating: '), undefined);
  });

  test('returns undefined for more than 5 stars', () => {
    assert.strictEqual(parseRatingFromComment('Rating: ⭐⭐⭐⭐⭐⭐'), undefined);
  });

  test('handles rating line not at start of body', () => {
    const body = 'Some preamble\nRating: ⭐⭐\nMore text';
    assert.strictEqual(parseRatingFromComment(body), 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:one -- test/utils/rating-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/utils/rating-parser.ts
import { RatingScore, isValidRatingScore } from '../types/engagement';

const STAR = '⭐';
const RATING_LINE_PATTERN = /^Rating:\s*(⭐+)/m;

export function parseRatingFromComment(body: string): RatingScore | undefined {
  const match = body.match(RATING_LINE_PATTERN);
  if (!match) {
    return undefined;
  }
  const count = [...match[1]].filter(c => c === STAR).length;
  if (!isValidRatingScore(count)) {
    return undefined;
  }
  return count as RatingScore;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:one -- test/utils/rating-parser.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/rating-parser.ts test/utils/rating-parser.test.ts
git commit -m "feat(engagement): add parseRatingFromComment utility"
```

---

### Task 2: Add `overwrite` Flag to `hydrateUserRatings`

**Files:**
- Modify: `src/services/engagement/rating-cache.ts:152-161`
- Modify: `test/services/engagement/rating-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `hydrateUserRatings()` suite in `test/services/engagement/rating-cache.test.ts`:

```typescript
test('overwrites existing entries when overwrite flag is true', () => {
  // Local hydration set score 3
  cache.hydrateUserRatings([
    { sourceId: 'adapter-abc123', bundleId: 'otter', score: 3 }
  ]);
  assert.strictEqual(cache.getUserRating('adapter-abc123', 'otter'), 3);

  // Remote hydration with overwrite replaces it
  cache.hydrateUserRatings([
    { sourceId: 'adapter-abc123', bundleId: 'otter', score: 5 }
  ], { overwrite: true });
  assert.strictEqual(cache.getUserRating('adapter-abc123', 'otter'), 5);
});

test('overwrite does not replace in-session optimistic ratings', () => {
  // User rated 4 in this session (optimistic)
  cache.applyOptimisticRating('adapter-abc123', 'otter', 4);

  // Remote hydration tries to overwrite with 3
  cache.hydrateUserRatings([
    { sourceId: 'adapter-abc123', bundleId: 'otter', score: 3 }
  ], { overwrite: true });

  // Optimistic (in-session) rating wins
  assert.strictEqual(cache.getUserRating('adapter-abc123', 'otter'), 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:one -- test/services/engagement/rating-cache.test.ts`
Expected: FAIL — `hydrateUserRatings` doesn't accept second argument

- [ ] **Step 3: Implement**

In `src/services/engagement/rating-cache.ts`, modify `hydrateUserRatings`:

```typescript
/**
 * Hydrate userRatings from pre-resolved rating data.
 * Called by the orchestration layer (hub-manager) after refresh.
 * Does not overwrite in-session optimistic ratings (from applyOptimisticRating).
 * With overwrite: true, replaces entries from previous hydration calls but still
 * preserves in-session optimistic ratings.
 */
public hydrateUserRatings(
  ratings: Array<{ sourceId: string; bundleId: string; score: RatingScore }>,
  options?: { overwrite?: boolean }
): void {
  for (const { sourceId, bundleId, score } of ratings) {
    if (!isValidRatingScore(score)) {
      continue;
    }
    const key = this.makeKey(sourceId, bundleId);
    if (options?.overwrite) {
      // Overwrite previous hydration but not in-session optimistic ratings.
      // In-session ratings are tracked by checking if the key was set via
      // applyOptimisticRating (it always updates the cache entry's cachedAt).
      // Simple heuristic: if key exists and was set this session, skip.
      if (!this.optimisticKeys.has(key)) {
        this.userRatings.set(key, score);
      }
    } else {
      if (!this.userRatings.has(key)) {
        this.userRatings.set(key, score);
      }
    }
  }
}
```

Also add the `optimisticKeys` set to track in-session ratings:

```typescript
// Add to class fields (after userRatings):
private readonly optimisticKeys: Set<string> = new Set();
```

Update `applyOptimisticRating` to track the key:

```typescript
// At the end of applyOptimisticRating, before _onCacheUpdated.fire():
this.optimisticKeys.add(key);
```

Update `clear()` and `dispose()` to also clear `optimisticKeys`:

```typescript
// In clear():
this.optimisticKeys.clear();

// In dispose():
this.optimisticKeys.clear();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:one -- test/services/engagement/rating-cache.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/engagement/rating-cache.ts test/services/engagement/rating-cache.test.ts
git commit -m "feat(engagement): add overwrite flag to hydrateUserRatings"
```

---

### Task 3: Post Rating Comment on `submitRating`

**Files:**
- Modify: `src/services/engagement/backends/github-discussions-backend.ts:438-496`
- Modify: `test/services/engagement/backends/github-discussions-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `Rating Operations` suite in `test/services/engagement/backends/github-discussions-backend.test.ts`:

```typescript
test('should post a rating comment to the discussion on successful submit', async () => {
  await backend.initialize(mockConfig);
  backend.setDiscussionMapping('bundle-1', 42);

  let capturedCommentBody = '';

  // Mock: getDiscussionNodeId
  nock('https://api.github.com')
    .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_kwDOTest42' } } } })
    // Mock: removeExistingReaction x2
    .post('/graphql').reply(200, { data: { removeReaction: { reaction: null } } })
    .post('/graphql').reply(200, { data: { removeReaction: { reaction: null } } })
    // Mock: addReaction
    .post('/graphql').reply(200, { data: { addReaction: { reaction: { content: 'THUMBS_UP' } } } })
    // Mock: findViewerComment (no existing comment)
    .post('/graphql').reply(200, { data: { repository: { discussion: { comments: { nodes: [] } } } } })
    // Mock: addDiscussionComment
    .post('/graphql', (body: any) => {
      capturedCommentBody = body.variables?.body || '';
      return true;
    }).reply(200, { data: { addDiscussionComment: { comment: { id: 'DC_new', body: capturedCommentBody } } } });

  const rating: Rating = {
    id: 'rating-1',
    resourceType: 'bundle',
    resourceId: 'bundle-1',
    score: 4,
    timestamp: new Date().toISOString()
  };

  await backend.submitRating(rating);

  assert.ok(nock.isDone(), 'All mocks consumed (comment was posted)');
  assert.ok(capturedCommentBody.includes('⭐⭐⭐⭐'), 'Comment body should contain 4 stars');
  assert.ok(capturedCommentBody.startsWith('Rating:'), 'Comment should start with Rating:');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:one -- test/services/engagement/backends/github-discussions-backend.test.ts`
Expected: FAIL — nock mocks not consumed (no comment posted by current code)

- [ ] **Step 3: Implement**

In `src/services/engagement/backends/github-discussions-backend.ts`, add these new private methods and a class field:

```typescript
// Add to class fields:
private readonly commentNodeIds: Map<string, string> = new Map();
```

Add new method `findViewerComment`:

```typescript
/**
 * Find the viewer's existing rating comment on a discussion.
 * Returns the comment node ID and body if found.
 */
private async findViewerComment(
  discussionNumber: number,
  token: string
): Promise<{ nodeId: string; body: string } | undefined> {
  // Check in-memory cache first
  const cachedId = this.commentNodeIds.get(String(discussionNumber));
  if (cachedId) {
    return { nodeId: cachedId, body: '' };
  }

  const query = `
    query GetDiscussionComments($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          comments(first: 100) {
            nodes {
              id
              author { login }
              body
            }
          }
        }
      }
    }
  `;

  const response = await axios.post<{
    data: {
      repository: {
        discussion: {
          comments: {
            nodes: Array<{ id: string; author: { login: string }; body: string }>;
          };
        };
      };
    };
  }>(
    'https://api.github.com/graphql',
    { query, variables: { owner: this.owner, repo: this.repo, number: discussionNumber } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
  const viewerLogin = session?.account.label;
  if (!viewerLogin) {
    return undefined;
  }

  const comments = response.data?.data?.repository?.discussion?.comments?.nodes || [];
  const viewerComment = comments.find(
    (c) => c.author?.login === viewerLogin && c.body.match(/^Rating:\s*⭐/m)
  );

  if (viewerComment) {
    this.commentNodeIds.set(String(discussionNumber), viewerComment.id);
    return { nodeId: viewerComment.id, body: viewerComment.body };
  }

  return undefined;
}
```

Add new method `updateDiscussionComment`:

```typescript
/**
 * Update an existing discussion comment via GraphQL.
 */
private async updateDiscussionComment(commentNodeId: string, body: string, token: string): Promise<void> {
  const mutation = `
    mutation UpdateDiscussionComment($commentId: ID!, $body: String!) {
      updateDiscussionComment(input: { commentId: $commentId, body: $body }) {
        comment { id body }
      }
    }
  `;

  await axios.post(
    'https://api.github.com/graphql',
    { query: mutation, variables: { commentId: commentNodeId, body } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}
```

Add new method `postOrEditRatingComment`:

```typescript
/**
 * Post or edit a rating comment on the bundle's discussion.
 * Non-fatal: errors are logged but do not prevent the rating from succeeding.
 */
private async postOrEditRatingComment(
  mapping: DiscussionMapping,
  rating: Rating,
  token: string
): Promise<void> {
  try {
    const commentBody = this.formatRatingComment(rating.score);
    const existing = await this.findViewerComment(mapping.discussionNumber, token);
    const discussionNodeId = await this.getDiscussionNodeId(mapping.discussionNumber, token);

    if (existing) {
      await this.updateDiscussionComment(existing.nodeId, commentBody, token);
      this.logger.debug(`Updated rating comment on discussion #${mapping.discussionNumber}`);
    } else {
      await this.addDiscussionComment(discussionNodeId, commentBody, token);
      this.logger.debug(`Posted rating comment on discussion #${mapping.discussionNumber}`);
    }
  } catch (error) {
    this.logger.warn(`Failed to post/edit rating comment: ${(error as Error).message}`);
  }
}

/**
 * Format a rating-only comment body.
 */
private formatRatingComment(score: number): string {
  const stars = '⭐'.repeat(score);
  return `Rating: ${stars}`;
}
```

Finally, insert the call in `submitRating` after the reaction is posted (line ~488, after `this.userVotes.set(...)`):

```typescript
// Post or edit a comment with exact star count (non-fatal)
await this.postOrEditRatingComment(mapping, rating, token);
```

Also clear `commentNodeIds` in `dispose()`:

```typescript
this.commentNodeIds.clear();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:one -- test/services/engagement/backends/github-discussions-backend.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/engagement/backends/github-discussions-backend.ts test/services/engagement/backends/github-discussions-backend.test.ts
git commit -m "feat(engagement): post/edit rating comment on discussion"
```

---

### Task 4: Re-Rating Edits Existing Comment

**Files:**
- Modify: `test/services/engagement/backends/github-discussions-backend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('should edit existing comment when re-rating', async () => {
  await backend.initialize(mockConfig);
  backend.setDiscussionMapping('bundle-1', 42);

  let capturedUpdateBody = '';

  // Mock: getDiscussionNodeId
  nock('https://api.github.com')
    .post('/graphql').reply(200, { data: { repository: { discussion: { id: 'D_kwDOTest42' } } } })
    // Mock: removeExistingReaction x2
    .post('/graphql').reply(200, { data: { removeReaction: { reaction: null } } })
    .post('/graphql').reply(200, { data: { removeReaction: { reaction: null } } })
    // Mock: addReaction
    .post('/graphql').reply(200, { data: { addReaction: { reaction: { content: 'THUMBS_UP' } } } })
    // Mock: findViewerComment (found existing)
    .post('/graphql').reply(200, {
      data: {
        repository: {
          discussion: {
            comments: {
              nodes: [{ id: 'DC_existing', author: { login: 'testuser' }, body: 'Rating: ⭐⭐⭐' }]
            }
          }
        }
      }
    })
    // Mock: updateDiscussionComment (edit in place)
    .post('/graphql', (body: any) => {
      capturedUpdateBody = body.variables?.body || '';
      return true;
    }).reply(200, { data: { updateDiscussionComment: { comment: { id: 'DC_existing', body: capturedUpdateBody } } } });

  const rating: Rating = {
    id: 'rating-2',
    resourceType: 'bundle',
    resourceId: 'bundle-1',
    score: 5,
    timestamp: new Date().toISOString()
  };

  await backend.submitRating(rating);

  assert.ok(nock.isDone(), 'All mocks consumed (comment was edited)');
  assert.ok(capturedUpdateBody.includes('⭐⭐⭐⭐⭐'), 'Updated body should contain 5 stars');
});
```

- [ ] **Step 2: Run test to verify it passes (already implemented in Task 3)**

Run: `npm run test:one -- test/services/engagement/backends/github-discussions-backend.test.ts`
Expected: PASS — if Task 3 edit path works correctly

- [ ] **Step 3: Commit**

```bash
git add test/services/engagement/backends/github-discussions-backend.test.ts
git commit -m "test(engagement): verify re-rating edits existing comment"
```

---

### Task 5: `fetchViewerRatings` — Remote Hydration

**Files:**
- Modify: `src/services/engagement/backends/github-discussions-backend.ts`
- Modify: `test/services/engagement/backends/github-discussions-backend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
suite('fetchViewerRatings()', () => {
  test('should return ratings parsed from viewer comments across discussions', async () => {
    await backend.initialize(mockConfig);
    backend.setDiscussionMapping('otter:otter-bundle', 9);
    backend.setDiscussionMapping('otter:fox-bundle', 10);

    // Mock: GraphQL search for viewer's discussions
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, {
        data: {
          search: {
            nodes: [
              { number: 9 },
              { number: 10 },
              { number: 99 } // unmapped discussion — should be ignored
            ]
          }
        }
      });

    // Mock: fetch comments for discussion #9
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, {
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
      });

    // Mock: fetch comments for discussion #10
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, {
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

  test('should return empty array when search finds no discussions', async () => {
    await backend.initialize(mockConfig);

    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { search: { nodes: [] } } });

    const results = await backend.fetchViewerRatings();
    assert.deepStrictEqual(results, []);
  });

  test('should return empty array on API error', async () => {
    await backend.initialize(mockConfig);

    nock('https://api.github.com')
      .post('/graphql')
      .reply(500, { message: 'Internal Server Error' });

    const results = await backend.fetchViewerRatings();
    assert.deepStrictEqual(results, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:one -- test/services/engagement/backends/github-discussions-backend.test.ts`
Expected: FAIL — `fetchViewerRatings` does not exist

- [ ] **Step 3: Implement**

Add to `GitHubDiscussionsBackend`:

```typescript
/**
 * Fetch the viewer's own ratings from discussion comments.
 * Searches for discussions the viewer has commented on, parses Rating: lines.
 * Returns resourceId + score pairs ready for hydrateUserRatings.
 * Non-fatal: returns empty array on any error.
 */
public async fetchViewerRatings(): Promise<Array<{ resourceId: string; score: RatingScore }>> {
  this.ensureInitialized();

  try {
    const token = await this.getAccessToken();
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
    const viewerLogin = session?.account.label;
    if (!viewerLogin) {
      return [];
    }

    // Step 1: Find discussions the viewer commented on
    const searchQuery = `
      query SearchViewerDiscussions($query: String!) {
        search(query: $query, type: DISCUSSION, first: 50) {
          nodes {
            ... on Discussion { number }
          }
        }
      }
    `;

    const searchResponse = await axios.post<{
      data: { search: { nodes: Array<{ number?: number }> } };
    }>(
      'https://api.github.com/graphql',
      {
        query: searchQuery,
        variables: { query: `repo:${this.owner}/${this.repo} commenter:${viewerLogin}` }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    const discussions = searchResponse.data?.data?.search?.nodes?.filter((n) => n.number) || [];
    if (discussions.length === 0) {
      return [];
    }

    // Build reverse map: discussionNumber → resourceId
    const numberToResourceId = new Map<number, string>();
    for (const [resourceId, mapping] of this.discussionMappings.entries()) {
      numberToResourceId.set(mapping.discussionNumber, resourceId);
    }

    // Step 2: For each matched discussion, fetch comments and find viewer's rating
    const results: Array<{ resourceId: string; score: RatingScore }> = [];

    for (const disc of discussions) {
      const resourceId = numberToResourceId.get(disc.number!);
      if (!resourceId) {
        continue; // Discussion not mapped to a bundle
      }

      const commentsQuery = `
        query GetDiscussionComments($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            discussion(number: $number) {
              comments(first: 100) {
                nodes {
                  id
                  author { login }
                  body
                }
              }
            }
          }
        }
      `;

      const commentsResponse = await axios.post<{
        data: {
          repository: {
            discussion: {
              comments: { nodes: Array<{ id: string; author: { login: string }; body: string }> };
            };
          };
        };
      }>(
        'https://api.github.com/graphql',
        { query: commentsQuery, variables: { owner: this.owner, repo: this.repo, number: disc.number } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      const comments = commentsResponse.data?.data?.repository?.discussion?.comments?.nodes || [];
      const viewerComment = comments.find(
        (c) => c.author?.login === viewerLogin && c.body.match(/^Rating:\s*⭐/m)
      );

      if (viewerComment) {
        const score = parseRatingFromComment(viewerComment.body);
        if (score) {
          results.push({ resourceId, score });
          this.commentNodeIds.set(String(disc.number), viewerComment.id);
        }
      }
    }

    this.logger.debug(`fetchViewerRatings: found ${results.length} ratings from remote`);
    return results;
  } catch (error) {
    this.logger.debug(`fetchViewerRatings failed: ${(error as Error).message}`);
    return [];
  }
}
```

Add import at top of file:

```typescript
import { parseRatingFromComment } from '../../../utils/rating-parser';
```

Also import `RatingScore`:

```typescript
import {
  // ... existing imports ...
  RatingScore,
} from '../../../types/engagement';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:one -- test/services/engagement/backends/github-discussions-backend.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/engagement/backends/github-discussions-backend.ts src/utils/rating-parser.ts test/services/engagement/backends/github-discussions-backend.test.ts
git commit -m "feat(engagement): add fetchViewerRatings for cross-machine hydration"
```

---

### Task 6: Expose Hub Backend and Wire Remote Hydration

**Files:**
- Modify: `src/services/engagement/engagement-service.ts`
- Modify: `src/services/hub-manager.ts:626-644`

- [ ] **Step 1: Add `getHubBackend` to EngagementService**

In `src/services/engagement/engagement-service.ts`, add:

```typescript
/**
 * Get the typed backend for a hub.
 * Returns undefined if hub not registered or not a discussions backend.
 */
public getHubBackend(hubId: string): IEngagementBackend | undefined {
  return this.hubBackends.get(hubId);
}
```

- [ ] **Step 2: Wire remote hydration in hub-manager**

In `src/services/hub-manager.ts`, after the existing local hydration block (line ~644), add:

```typescript
// Remote hydration: fetch viewer's rating comments from discussions (authoritative, cross-machine)
if (engagement.backend.type === 'github-discussions') {
  try {
    const backend = EngagementService.getInstance().getHubBackend(hubId);
    if (backend && 'fetchViewerRatings' in backend) {
      const remoteRatings = await (backend as any).fetchViewerRatings();
      if (remoteRatings.length > 0 && sourceIdMap) {
        const resolved = remoteRatings.map((r: { resourceId: string; score: any }) => {
          // resourceId from fetchViewerRatings is the mapping key (e.g. "otter:otter-bundle")
          // Extract bundleId from the "sourceId:bundleId" format
          const parts = r.resourceId.split(':');
          const configSourceId = parts[0];
          const bundleId = parts.slice(1).join(':');
          return {
            sourceId: sourceIdMap.get(configSourceId) || configSourceId,
            bundleId,
            score: r.score
          };
        });
        RatingCache.getInstance().hydrateUserRatings(resolved, { overwrite: true });

        // Persist remote ratings locally for next startup's instant hydration
        const storage = EngagementService.getInstance().getStorage();
        if (storage) {
          for (const r of remoteRatings) {
            const parts = r.resourceId.split(':');
            const configSourceId = parts[0];
            const bundleId = parts.slice(1).join(':');
            await storage.saveRating({
              id: crypto.randomUUID(),
              resourceType: 'bundle',
              resourceId: bundleId,
              score: r.score,
              sourceId: configSourceId,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    }
  } catch (error) {
    this.logger.debug(`Failed to hydrate user ratings from remote: ${error}`);
  }
}
```

- [ ] **Step 3: Run full test suite**

Run: `LOG_LEVEL=ERROR npm run test:unit 2>&1 | tee /tmp/test.log | grep -E "passing|failing"`
Expected: All pass (remote hydration is behind a type check and non-fatal)

- [ ] **Step 4: Commit**

```bash
git add src/services/engagement/engagement-service.ts src/services/hub-manager.ts
git commit -m "feat(engagement): wire remote hydration on startup via fetchViewerRatings"
```

---

### Task 7: Integration Test — Full Hydration Flow

**Files:**
- Modify: `test/services/engagement/rating-cache.test.ts`

- [ ] **Step 1: Write integration test**

Add new suite to `test/services/engagement/rating-cache.test.ts`:

```typescript
suite('remote hydration overwrites local', () => {
  test('hydrateUserRatings with overwrite replaces local-only entries', () => {
    // Simulate local hydration (score 3 from local storage)
    cache.hydrateUserRatings([
      { sourceId: 'adapter-hash', bundleId: 'otter', score: 3 }
    ]);
    assert.strictEqual(cache.getUserRating('adapter-hash', 'otter'), 3);

    // Simulate remote hydration arriving with updated score (user rated 5 on other machine)
    cache.hydrateUserRatings([
      { sourceId: 'adapter-hash', bundleId: 'otter', score: 5 }
    ], { overwrite: true });

    assert.strictEqual(cache.getUserRating('adapter-hash', 'otter'), 5);
  });

  test('remote hydration adds ratings not in local storage', () => {
    // Local has nothing
    assert.strictEqual(cache.getUserRating('adapter-hash', 'fox'), undefined);

    // Remote hydration brings a rating
    cache.hydrateUserRatings([
      { sourceId: 'adapter-hash', bundleId: 'fox', score: 4 }
    ], { overwrite: true });

    assert.strictEqual(cache.getUserRating('adapter-hash', 'fox'), 4);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:one -- test/services/engagement/rating-cache.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/services/engagement/rating-cache.test.ts
git commit -m "test(engagement): integration test for remote hydration overwrite flow"
```

---

### Task 8: Update `submitFeedback` to Merge with Existing Rating Comment

**Files:**
- Modify: `src/services/engagement/backends/github-discussions-backend.ts`

When user submits feedback (comment text) after rating, the feedback should be merged into the existing rating comment rather than creating a second comment.

- [ ] **Step 1: Modify `submitFeedback` to edit existing rating comment**

In the `submitFeedback` method, before calling `postFeedbackToDiscussion`, check if a rating comment already exists. If so, update it with the full `formatFeedbackComment` output (rating + feedback text). If not, post as new.

Replace the `postFeedbackToDiscussion` call with:

```typescript
// If a rating comment already exists for this viewer, update it with the feedback text
const existing = await this.findViewerComment(mapping.discussionNumber, token);
const commentBody = this.formatFeedbackComment(feedback);

if (existing) {
  await this.updateDiscussionComment(existing.nodeId, commentBody, token);
} else {
  const discussionId = await this.getDiscussionNodeId(mapping.discussionNumber, token);
  await this.addDiscussionComment(discussionId, commentBody, token);
}
```

This requires getting `token` before the discussion check. Restructure `submitFeedback`'s try block to get token early.

- [ ] **Step 2: Run tests**

Run: `LOG_LEVEL=ERROR npm run test:unit 2>&1 | tee /tmp/test.log | grep -E "passing|failing"`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/services/engagement/backends/github-discussions-backend.ts
git commit -m "feat(engagement): merge feedback into existing rating comment"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `LOG_LEVEL=ERROR npm run test:unit 2>&1 | tee /tmp/test.log | grep -E "passing|failing"`
Expected: All pass, 0 failing

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Compile production build**

Run: `npm run compile`
Expected: No errors

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: lint and compile fixes for rating recovery feature"
```
