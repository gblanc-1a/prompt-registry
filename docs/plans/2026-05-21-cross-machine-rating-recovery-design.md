# Cross-Machine Rating Recovery via Discussion Comments

**Date:** 2026-05-21  
**Status:** Draft  
**Branch:** `feat/feedback-clean`

## Problem

When a user rates a bundle, the exact star count (1-5) is only persisted locally. GitHub Discussion reactions are binary (THUMBS_UP/THUMBS_DOWN), losing the granularity. On a new machine or fresh VS Code install pointed at the same hub, the user's own rating cannot be recovered — the detail panel shows empty stars even though they rated before.

## Solution

Use GitHub Discussion **comments** as the durable, cross-machine source of truth for exact star ratings. Every rating (with or without user feedback text) posts a comment to the bundle's discussion. On startup, the extension queries the viewer's comments across the engagement repo and parses star counts to hydrate the rating cache.

## Design

### Write Path (Rating Submission)

Current flow:
1. Optimistic UI update
2. Post reaction (THUMBS_UP/THUMBS_DOWN) to discussion
3. Persist to local storage

New flow adds step between 2 and 3:
1. Optimistic UI update
2. Post reaction (THUMBS_UP/THUMBS_DOWN) to discussion
3. **Post or edit a comment on the discussion with exact star count**
4. Persist to local storage

#### Comment Format

Rating-only (no user feedback text):
```
Rating: ⭐⭐⭐⭐
```

Rating with feedback:
```
Rating: ⭐⭐⭐⭐
Feedback: Great prompts for code review!
---
Version: 1.2.0
```

This is the same format `formatFeedbackComment` already produces. The change is calling it on every rating, not just when the user writes feedback text.

#### Re-Rating (Edit Existing Comment)

One comment per user per bundle discussion. On re-rate:
1. Search for existing comment by viewer on that discussion (GraphQL)
2. If found → `updateDiscussionComment` mutation (edit in place)
3. If not found → `addDiscussionComment` mutation (new comment)
4. Cache returned comment node ID in memory for faster re-edits within session

### Read Path (Startup Hydration)

Triggered during `registerHubEngagement()`, after collections.yaml is loaded.

#### Step 1: Find Viewer's Comments

Use GitHub search API (single HTTP call):
```
GET https://api.github.com/search/issues?q=commenter:@me+repo:{owner}/{repo}+type:discussions
```

This returns all discussions in the engagement repo where the current user has commented.

> **Implementation note:** Verify that `type:discussions` qualifier works with the `/search/issues` endpoint. If not, use the GraphQL `search(type: DISCUSSION)` query instead:
> ```graphql
> query { search(query: "repo:{owner}/{repo} commenter:@me", type: DISCUSSION, first: 50) { nodes { ... on Discussion { number } } } }
> ```

#### Step 2: Fetch Comments from Matched Discussions

For each discussion returned by search, fetch comments and filter by viewer's login:
```graphql
query {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      comments(first: 100) {
        nodes {
          author { login }
          body
        }
      }
    }
  }
}
```

Optimization: batch multiple discussions using GraphQL aliases in a single request.

#### Step 3: Parse Star Count

```typescript
function parseRatingFromComment(body: string): RatingScore | undefined {
  const match = body.match(/^Rating:\s*(⭐+)/m);
  if (!match) return undefined;
  const count = [...match[1]].filter(c => c === '⭐').length;
  return (count >= 1 && count <= 5) ? count as RatingScore : undefined;
}
```

Note: `'⭐'` is a multi-codepoint emoji. Using spread + filter handles this correctly.

#### Step 4: Map to Bundle IDs

Discussion number → bundleId mapping already exists in `discussionMappings` (loaded from collections.yaml). Use it to build the `[{sourceId, bundleId, score}]` array.

#### Step 5: Feed into Existing Hydration

Call `RatingCache.getInstance().hydrateUserRatings(resolved)` — no changes needed to this method.

### Hydration Priority

Local storage serves as a persistent cache of the remote source of truth. On every startup:

1. **Immediate (sync):** Read local ratings file → `hydrateUserRatings()` → stars pre-fill instantly
2. **Background (async):** Fetch viewer's comments from engagement repo → parse star counts → reconcile with local cache
   - On success: overwrite local entries + update `userRatings` map in `RatingCache`. If remote has new ratings (from another machine), local cache is updated and persisted for next startup.
   - On failure (offline, rate-limited, auth error): no-op. Local cache remains valid from last successful sync.

Same pattern as aggregate ratings: `refreshFromHub()` fetches remote `ratings.json` and overwrites the in-memory cache. Here we do the same for per-user ratings.

`hydrateUserRatings` needs an `overwrite` flag so the remote pass can replace entries set by the local pass.

## Components Changed

| File | Change |
|------|--------|
| `src/services/engagement/backends/github-discussions-backend.ts` | `submitRating()`: post/edit comment after reaction. New `findViewerComment()` method. New `fetchViewerRatings()` public method. |
| `src/services/hub-manager.ts` | `registerHubEngagement()`: call `fetchViewerRatings()` and feed results to `hydrateUserRatings()` |
| `src/services/engagement/rating-cache.ts` | `hydrateUserRatings()`: add option to overwrite (remote > local) |
| `src/utils/rating-parser.ts` (new) | `parseRatingFromComment()` utility |

## Error Handling

- **Comment post/edit failure:** Non-fatal. Rating still works (reaction + local persist are the primary mechanisms). Log warning.
- **Search/hydration failure:** Non-fatal. Fall back to local storage hydration (existing behavior). Log debug.
- **Rate limiting:** GitHub search API has lower rate limits. If 403/429, skip remote hydration silently.

## Sequence Diagram

```
User clicks 3 stars
    │
    ├─► applyOptimisticRating() → UI updates
    │
    ├─► addReaction(THUMBS_UP) to discussion
    │
    ├─► findViewerComment(discussion)
    │       ├─ found → updateDiscussionComment("Rating: ⭐⭐⭐")
    │       └─ not found → addDiscussionComment("Rating: ⭐⭐⭐")
    │
    └─► localBackend.submitRating() → persist locally


Extension activates on new machine
    │
    ├─► registerHubEngagement()
    │       ├─► refreshFromHub() (aggregate ratings)
    │       ├─► hydrateUserRatings() from local storage (empty on new machine)
    │       └─► fetchViewerRatings()
    │               ├─► search API: commenter:@me repo:X type:discussions
    │               ├─► for each discussion: fetch comments, filter by viewer
    │               ├─► parse ⭐ count from each comment
    │               ├─► map discussion# → bundleId via collections.yaml
    │               └─► hydrateUserRatings(resolved, { overwrite: true })
    │
    └─► UI shows pre-filled stars ✓
```

## Testing

- Unit test: `parseRatingFromComment` — various formats, edge cases
- Unit test: `fetchViewerRatings` — mocked GraphQL responses
- Unit test: `submitRating` posts comment (extend existing test)
- Unit test: re-rating edits existing comment
- Integration: hydration from remote overwrites empty local storage
