# Self-Healing Engagement Discussions

**Status:** Draft
**Date:** 2026-05-22
**Author:** gblanc
**Context:** PR #268 (`feat/feedback-squashed`), engagement system

---

## Summary

Replace the static `collections.yaml` bundle→discussion mapping with self-healing, lazy discussion creation driven by the user's own GitHub session. Discussions become the single source of truth: each one carries a metadata block in its body that identifies the bundle. Star comments drive ratings; reactions are dropped from the write path.

## Problem

PR #268 introduces engagement (ratings/feedback) backed by GitHub Discussions. The current design relies on:

1. An admin running `setup-discussions.ts` to pre-create one discussion per bundle.
2. A checked-in `collections.yaml` mapping `(source_id, bundle_id) → discussion_number`.
3. The extension fetching `collections.yaml` at hub sync time and using it to route votes.

Limitations:

- **Bundles without a mapping are unrateable.** Missing entries cause `submitRating` to log a warning and store the rating locally with `synced=true`, orphaning the vote.
- **High catalog churn** (weekly+, unpredictable) means the admin re-run cadence cannot keep up.
- **Multi-org topology**: hubs aggregate sources from multiple internal GitHub organizations. A central admin token with write access to every source is undesirable; the user's own token is the only credential we should rely on.
- **Reactions are cosmetic.** `compute-ratings` already prefers star comments and falls back to reactions only when zero comments exist, but the extension still issues three GraphQL calls per vote (remove reaction, add reaction, post/edit comment).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Lazy, user-initiated discussion creation.** First vote on an unmapped bundle creates the discussion. | All internal users have write access to the engagement repo. No bot token needed. |
| 2 | **Search-then-create + CI-side merge for races.** Before creating, GraphQL-search by title; if not found, create. Duplicates from indexing lag are merged in `compute-ratings` by body metadata key. | Simplest. GitHub provides no atomic create-if-not-exists. |
| 3 | **Drop `collections.yaml`.** Discussions are the source of truth; mappings are cached in memory only. | Eliminates checked-in state that needs to be regenerated; works with multi-org topology where no shared write credential exists. |
| 4 | **Bundle key = title + body metadata block.** Title `[rating] {sourceId}/{bundleId}` is the human-readable canonical form; a fenced YAML block in the body carries `bundle_id`/`source_id` for parsing. | Title enables fast `in:title` search. Body block survives title edits and supports manual rename reconciliation. |
| 5 | **Drop reactions from the write path.** Star comments are the only rating source. | 3× fewer API calls per vote. `compute-ratings` already comments-first. Reaction fallback is dead code. |
| 6 | **No migration.** Feature is unreleased; there are no production discussions or ratings to preserve. | Avoids deprecation cycles, schema-soft-removal, body backfill scripts. |
| 7 | **Rely on existing `['repo']` OAuth scope.** Add a defensive 403 handler that triggers `forceNewSession` re-auth on permission failure. | OAuth `repo` scope already covers discussions write. Edge cases (GHES policy, fine-grained PATs) handled at runtime. |

## Architecture

### Write flow (vote submission)

```
User clicks star
  │
  ▼
RatingCache.applyOptimisticRating()        (instant UI update)
  │
  ▼
GitHubDiscussionsBackend.submitRating()
  │
  ├── ensureDiscussion(resourceId, displayName)
  │     │
  │     ├── in-memory cache hit ─► return mapping
  │     ├── searchDiscussionByTitle("[rating] {sourceId}/{bundleId}")
  │     │     hit ─► cache + return
  │     │     miss ─► createDiscussion(title, body)
  │     │            cache + return
  │     │
  │     └── 403/401 ─► forceNewSession re-auth prompt
  │
  └── postOrEditRatingComment(mapping, "Rating: ⭐⭐⭐⭐", token)
        success ─► localBackend.submitRating({...rating, synced: true})
        failure ─► localBackend.submitRating({...rating, synced: false}); drain retry next session
```

Single GraphQL call per re-vote when mapping is cached.

### Read flow (cold start)

```
Extension activates
  │
  ▼
HubManager.syncHub()
  │
  ├── EngagementService.registerHubBackend()
  │     └── Backend.initialize()
  │     └── Backend.initializeCategory()    [resolve categoryId once]
  │
  ├── RatingCache.refreshFromHub(ratingsUrl)
  │     └── fetch CI-built ratings.json
  │
  ├── Storage.getAllRatings() → hydrate user ratings (local)
  │
  └── Backend.fetchViewerRatings()
        └── scan user's own comments in category (no per-bundle mapping needed)
```

No `loadCollectionsMappings`. Mappings start empty and populate lazily on votes.

### compute-ratings flow (CI)

```
For each engagement repo in hub config:
  listDiscussionsInCategory(repo, category, token)        [paginated GraphQL]
  For each discussion:
    meta = parseBundleMetadata(body)
    if !meta: skip (legacy / human-created)
    comments = fetchDiscussionComments(number)
    starRatings = deduplicateRatingsByUser(comments)
    accumulate under key (meta.source_id, meta.bundle_id)
  Aggregate per key: avg, wilson, count, confidence
  Emit ratings.json
```

Two discussions sharing the same `(source_id, bundle_id)` (post-rename or race) are unioned.

## Component Contracts

### Title format

```
[rating] {sourceId}/{bundleId}
```

ASCII, deterministic, suitable for GraphQL `in:title` search.

### Body template

```markdown
Rating discussion for **{displayName}**.

Vote by adding a comment with `Rating: ⭐⭐⭐⭐⭐` (1–5 stars).

<!-- prompt-registry:metadata -->
​```yaml
bundle_id: {bundleId}
source_id: {sourceId}
display_name: {displayName}
created_by: prompt-registry-extension
schema_version: 1
​```
```

Parser key: the fenced ```yaml block following the `<!-- prompt-registry:metadata -->` HTML comment.

Manual rename reconciliation: edit `bundle_id` / `source_id` in the body block. CI groups by current values. Title is display-only after creation.

### `GitHubDiscussionsBackend`

New / changed:

```typescript
public async initializeCategory(): Promise<void>
// Resolves and caches categoryId for the configured repo. Called once after register.

private async ensureDiscussion(
  resourceId: string,        // "{sourceId}:{bundleId}"
  displayName: string
): Promise<DiscussionMapping>
// 1. Cache hit  → return.
// 2. Search hit → cache + return.
// 3. Create     → cache + return.

private async searchDiscussionByTitle(title: string): Promise<DiscussionMapping | undefined>
// GraphQL: repo:{owner}/{repo} in:title "{title}"
// Filter by category + exact title.

private async createDiscussion(title: string, body: string): Promise<DiscussionMapping>
// Ported from lib/src/setup-discussions.ts:312, then file deleted.

public async submitRating(rating: Rating): Promise<void>
// const mapping = await ensureDiscussion(...);
// await postOrEditRatingComment(mapping, rating, token);
// await localBackend.submitRating({...rating, synced: true});

public async getRating(...): Promise<Rating | undefined>
// Read user's own comment via findViewerComment() if mapping cached.
// No mapping → fall back to localBackend.

private async handleAuthError(err: AxiosError, op: string): Promise<never>
// 401/403 → showWarningMessage("Sign in again") → forceNewSession.
```

Removed:

- `loadCollectionsMappings()`
- `removeExistingReaction()` / `addReaction()`
- `userVotes` map (up/down cache)
- All reaction-related GraphQL mutations

### `Rating` type

```typescript
interface Rating {
  // existing fields...
  displayName?: string;  // NEW: needed when creating a discussion on first vote
}
```

### `compute-ratings.ts` (lib)

Add:

```typescript
listDiscussionsInCategory(owner, repo, categoryId, token): Promise<Discussion[]>
parseBundleMetadata(body: string): { source_id, bundle_id } | undefined
```

Aggregation groups by `(source_id, bundle_id)` and unions star comments across duplicate discussions.

Drop:

- `collections.yaml` read path
- Reaction-fallback aggregation (~60 lines)

### Hub config schema

Before:
```yaml
engagement:
  type: github-discussions
  repository: org/repo
  collectionsUrl: https://raw.../collections.yaml
```

After:
```yaml
engagement:
  type: github-discussions
  repository: org/repo
  category: "Bundle Ratings"   # default if omitted
```

`collectionsUrl` removed outright (no migration cycle).

### `EngagementHydrator` / `HubManager`

- Drop `loadCollectionsMappings(collectionsUrl)` call.
- Add `initializeCategory()` call.
- Mappings populate lazily on first vote.

## Auth & Scope

### Existing scope

`vscode.authentication.getSession('github', ['repo'], …)` is unchanged. The `repo` OAuth scope grants discussions read/write — no new scope is required for the standard GitHub.com path.

### Defensive 403/401 handling

Wrap `createDiscussion` and `postOrEditRatingComment`:

```typescript
private async handleAuthError(err: AxiosError, op: string): Promise<never> {
  if (err.response?.status === 403 || err.response?.status === 401) {
    const choice = await vscode.window.showWarningMessage(
      `GitHub token lacks permission to ${op} discussions. Re-authenticate with required scopes?`,
      'Sign in again', 'Cancel'
    );
    if (choice === 'Sign in again') {
      await vscode.authentication.getSession('github', ['repo'], { forceNewSession: true });
    }
  }
  throw err;
}
```

Optimistic rating rolls back; pending feedback queued; next session retries with the new token.

### Optional activation probe

```typescript
// GraphQL: repository.viewerCanCreateDiscussion
async checkDiscussionWritePerm(): Promise<boolean>
```

On first hub registration, if false → non-blocking toast with `forceNewSession` action. Read paths (ratings.json fetch, viewer-rating scan) keep working with read-only tokens.

## Failure Handling

| Scenario | Action |
|----------|--------|
| `searchDiscussionByTitle` throws | Log, fall through to `createDiscussion` |
| `createDiscussion` throws (perms) | Optimistic rollback, `synced=false`, drain retry; trigger 403 handler |
| `postOrEditRatingComment` throws after ensure | `synced=false`, drain retry; mapping kept in cache |
| Search indexing lag → duplicate created | CI groups by body metadata key; eventually consistent |
| User dismisses re-auth prompt | Rating stays optimistic + `synced=false`, drains next session |
| Body edited by humans, metadata block lost | Parser logs warning, skips discussion; CI run flags missing-metadata count |

## Tests

### Unit (extension)

`github-discussions-backend.test.ts`:
- `ensureDiscussion`: cache hit → no GraphQL call
- `ensureDiscussion`: cache miss + search hit → cached, no create
- `ensureDiscussion`: search miss → create called, result cached
- `ensureDiscussion`: search throws → fallback to create
- `submitRating`: first vote creates discussion + posts comment
- `submitRating`: re-vote on cached mapping → only edit-comment call
- `submitRating`: create fails with 403 → re-auth prompt; rolls back; `synced=false`
- `submitRating`: comment post fails after ensure → `synced=false`, mapping kept
- `handleAuthError`: 403 → `forceNewSession` invoked

Removed tests: `removeExistingReaction`, `addReaction`, `userVotes`.

`engagement-hydrator.test.ts`:
- No `loadCollectionsMappings` call.
- `initializeCategory` invoked once per hub.

### Unit (lib)

`compute-ratings.test.ts`:
- `parseBundleMetadata`: valid YAML block → object
- `parseBundleMetadata`: missing marker → undefined
- `parseBundleMetadata`: malformed YAML → undefined (skip discussion)
- `listDiscussionsInCategory`: paginates, filters by category
- Aggregation: two discussions same `(source_id, bundle_id)` → comments merged
- Aggregation: discussions without metadata → skipped

Removed tests: `collections.yaml` parsing path.

### Integration

- nock-mocked: full first-vote flow → search → create → comment
- nock-mocked: race simulation → both backends miss search → both create → CI merge produces a single rating

## Net Code Impact vs PR #268

**Deletions:**
- `lib/src/setup-discussions.ts` (853 lines) — capability moves into the extension
- `lib/bin/setup-discussions.js`
- `loadCollectionsMappings()` in backend
- `collectionsUrl` field in hub schema and types
- `removeExistingReaction`, `addReaction`, `userVotes` in backend
- Reaction-related tests
- Reaction fallback path in `compute-ratings.ts` (~60 lines)

**Additions:**
- `ensureDiscussion`, `searchDiscussionByTitle`, `createDiscussion` in backend (~150 lines, partly portable from `setup-discussions.ts` before deletion)
- `parseBundleMetadata`, `listDiscussionsInCategory` in `compute-ratings.ts`
- Body metadata template constant
- `handleAuthError` + activation probe
- Tests for new flows

## Out of Scope

- Bundle deletion / discussion archival
- Cross-hub feedback portability
- Discussion locking on bundle removal
- Reaction-based voting (dropped)
- Migration from existing engagement data (none exists)

## Open Questions

None at design time. Resolve during implementation:

- Whether the activation probe is enabled by default or behind a setting.
- Whether `category` is renamed in hub schema (`category` vs `engagementCategory`); pick during implementation review.
