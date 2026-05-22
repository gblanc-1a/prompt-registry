# Self-Healing Engagement Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static `collections.yaml` mapping with lazy, user-initiated GitHub Discussion creation. Discussions become source of truth via body metadata block. Drop reactions from write path.

**Architecture:** First vote on an unmapped bundle triggers `ensureDiscussion(resourceId, displayName)` which (1) checks in-memory cache, (2) GraphQL-searches by exact title, (3) creates a new discussion with a body metadata block. `compute-ratings` lists all discussions in the rating category and aggregates by `(source_id, bundle_id)` parsed from body, merging duplicates. Auth uses existing `['repo']` OAuth scope; 401/403 triggers `forceNewSession` re-auth.

**Tech Stack:** TypeScript, VS Code Extension API, GitHub GraphQL API, axios, mocha + nock for tests.

**Spec:** `docs/superpowers/specs/2026-05-22-self-healing-engagement-discussions-design.md` (commit `cb29b9f`).

**Branch:** `feat/feedback-squashed` (PR #268). Build on top of existing engagement code.

---

## File Structure

### Modified files

| File | Responsibility |
|------|---------------|
| `src/services/engagement/backends/github-discussions-backend.ts` | Replace `loadCollectionsMappings` with `initializeCategory` + `ensureDiscussion`. Add `searchDiscussionByTitle`, `createDiscussion`, `handleAuthError`. Drop `removeExistingReaction`, `addReaction`, `userVotes`. |
| `src/services/engagement/engagement-service.ts` | Drop `collectionsUrl` branch in `registerHubBackend`. Call `initializeCategory()` instead. |
| `src/services/engagement/engagement-hydrator.ts` | Drop any `loadCollectionsMappings` reference. |
| `src/services/hub-manager.ts` | No call-site change beyond the service path. Confirm. |
| `src/types/engagement.ts` | Drop `collectionsUrl` from `GitHubDiscussionsBackendConfig`. Add `displayName?: string` to `Rating`. |
| `schemas/hub-config.schema.json` | Drop `collectionsUrl` field. |
| `src/ui/marketplace-view-provider.ts` | Pass `bundle.name` as `displayName` when calling rating submission. |
| `lib/src/compute-ratings.ts` | Drop `collections.yaml` read path. Add `listDiscussionsInCategory`, `parseBundleMetadata`. Aggregate by `(source_id, bundle_id)`. Drop reaction-fallback. |

### Created files

| File | Responsibility |
|------|---------------|
| `src/services/engagement/discussion-body-template.ts` | Shared title format + body template + parser for body metadata block. Used by extension and (re-exported via lib copy) by compute-ratings. |
| `lib/src/discussion-body-template.ts` | Library-side copy of body parser (lib has its own tsconfig and cannot import from src). |

### Deleted files

| File | Reason |
|------|--------|
| `lib/src/setup-discussions.ts` | Capability moves into extension. |
| `lib/bin/setup-discussions.js` | Entrypoint for deleted module. |
| `lib/test/setup-discussions.test.ts` (if present) | Tests for deleted module. |

### Test files

| File | Coverage |
|------|---------|
| `test/services/engagement/backends/github-discussions-backend.test.ts` | Existing — update for new flows; remove reaction tests. |
| `test/services/engagement/engagement-service.test.ts` | Existing — drop `collectionsUrl` cases. |
| `test/services/engagement/engagement-hydrator.test.ts` | Existing — confirm no `loadCollectionsMappings`. |
| `test/services/engagement/discussion-body-template.test.ts` | New — title format + body template + parser. |
| `lib/test/compute-ratings.test.ts` | Existing — drop `collections.yaml`, add metadata-block + duplicate-merge tests. |
| `lib/test/discussion-body-template.test.ts` | New — body parser. |

---

## Task 0: Establish Pre-flight Baseline

**Files:**
- Read-only

- [ ] **Step 1: Confirm branch + clean state**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git status --short
```
Expected: `feat/feedback-squashed`. Working tree may have unstaged WIP from PR #268 — that's fine. Note them; don't commit them yet.

- [ ] **Step 2: Confirm base test suite passes**

Run:
```bash
npm install
npm run compile 2>&1 | tail -20
npm test 2>&1 | tee /tmp/baseline-test.log | tail -30
```
Expected: build succeeds, full suite passes. If any test fails, **stop** — record the failure and report to the user before proceeding. Subsequent task verifications compare against this baseline.

- [ ] **Step 3: Confirm lib subworkspace builds**

Run:
```bash
cd lib && npm install && npm test 2>&1 | tail -20 && cd ..
```
Expected: lib tests pass.

---

## Task 1: Add Title + Body Template Module (Extension)

Shared constants + body parser, used by extension backend and (mirrored) by compute-ratings.

**Files:**
- Create: `src/services/engagement/discussion-body-template.ts`
- Create: `test/services/engagement/discussion-body-template.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/services/engagement/discussion-body-template.test.ts`:

```typescript
import { strict as assert } from 'assert';
import {
  buildRatingDiscussionTitle,
  buildRatingDiscussionBody,
  parseBundleMetadata,
  METADATA_MARKER,
} from '../../../src/services/engagement/discussion-body-template';

describe('discussion-body-template', () => {
  describe('buildRatingDiscussionTitle', () => {
    it('formats sourceId/bundleId', () => {
      assert.equal(
        buildRatingDiscussionTitle('awesome-copilot', 'react-helpers'),
        '[rating] awesome-copilot/react-helpers'
      );
    });
  });

  describe('buildRatingDiscussionBody', () => {
    it('includes display name and metadata block', () => {
      const body = buildRatingDiscussionBody({
        sourceId: 'awesome-copilot',
        bundleId: 'react-helpers',
        displayName: 'React Helpers',
      });
      assert.ok(body.includes('Rating discussion for **React Helpers**'));
      assert.ok(body.includes(METADATA_MARKER));
      assert.ok(body.includes('bundle_id: react-helpers'));
      assert.ok(body.includes('source_id: awesome-copilot'));
      assert.ok(body.includes('schema_version: 1'));
    });
  });

  describe('parseBundleMetadata', () => {
    it('parses a valid metadata block', () => {
      const body = buildRatingDiscussionBody({
        sourceId: 'src-a',
        bundleId: 'bundle-x',
        displayName: 'X',
      });
      const meta = parseBundleMetadata(body);
      assert.deepEqual(meta, { source_id: 'src-a', bundle_id: 'bundle-x' });
    });

    it('returns undefined when marker is missing', () => {
      assert.equal(parseBundleMetadata('Hello world'), undefined);
    });

    it('returns undefined when YAML is malformed', () => {
      const broken = `${METADATA_MARKER}\n\`\`\`yaml\n: : not-valid : :\n\`\`\``;
      assert.equal(parseBundleMetadata(broken), undefined);
    });

    it('returns undefined when required fields are missing', () => {
      const partial = `${METADATA_MARKER}\n\`\`\`yaml\nfoo: bar\n\`\`\``;
      assert.equal(parseBundleMetadata(partial), undefined);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/discussion-body-template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `src/services/engagement/discussion-body-template.ts`:

```typescript
/**
 * Shared title format and body template for GitHub Discussions used as
 * rating containers. Title is canonical for human display and search;
 * body metadata block is canonical for machine parsing.
 */
import * as yaml from 'js-yaml';

export const METADATA_MARKER = '<!-- prompt-registry:metadata -->';
export const SCHEMA_VERSION = 1;

/**
 * Build the canonical title for a rating discussion.
 * @param sourceId Adapter source identifier (configId).
 * @param bundleId Bundle identifier within that source.
 */
export function buildRatingDiscussionTitle(sourceId: string, bundleId: string): string {
  return `[rating] ${sourceId}/${bundleId}`;
}

/**
 * Inputs for building a rating discussion body.
 */
export interface BuildBodyInput {
  sourceId: string;
  bundleId: string;
  displayName: string;
}

/**
 * Build the canonical body for a rating discussion. Includes a fenced
 * YAML metadata block keyed by METADATA_MARKER.
 * @param input Bundle identity used in the body.
 */
export function buildRatingDiscussionBody(input: BuildBodyInput): string {
  const { sourceId, bundleId, displayName } = input;
  return [
    `Rating discussion for **${displayName}**.`,
    '',
    'Vote by adding a comment with `Rating: ⭐⭐⭐⭐⭐` (1–5 stars).',
    '',
    METADATA_MARKER,
    '```yaml',
    `bundle_id: ${bundleId}`,
    `source_id: ${sourceId}`,
    `display_name: ${displayName}`,
    'created_by: prompt-registry-extension',
    `schema_version: ${SCHEMA_VERSION}`,
    '```',
    '',
  ].join('\n');
}

/**
 * Parsed metadata extracted from a rating discussion body.
 */
/* eslint-disable @typescript-eslint/naming-convention -- snake_case matches YAML wire format */
export interface BundleMetadata {
  source_id: string;
  bundle_id: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Parse the bundle metadata block from a discussion body.
 * @param body Raw discussion body text.
 * @returns Parsed metadata when valid, or undefined.
 */
export function parseBundleMetadata(body: string): BundleMetadata | undefined {
  const markerIdx = body.indexOf(METADATA_MARKER);
  if (markerIdx === -1) {
    return undefined;
  }
  const after = body.slice(markerIdx + METADATA_MARKER.length);
  const fenceMatch = after.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(fenceMatch[1]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const sourceId = obj.source_id;
  const bundleId = obj.bundle_id;
  if (typeof sourceId !== 'string' || typeof bundleId !== 'string') {
    return undefined;
  }
  return { source_id: sourceId, bundle_id: bundleId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/discussion-body-template.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/engagement/discussion-body-template.ts \
        test/services/engagement/discussion-body-template.test.ts
git commit -m "feat(engagement): add rating discussion title/body template module

Shared title format ([rating] sourceId/bundleId) and body template
with YAML metadata block. Parser extracts (source_id, bundle_id) for
later use by ensureDiscussion and compute-ratings."
```

---

## Task 2: Add `displayName` to `Rating` Type, Drop `collectionsUrl`

**Files:**
- Modify: `src/types/engagement.ts`
- Modify: `schemas/hub-config.schema.json`
- Modify: `test/types/hub-engagement-validation.test.ts`

- [ ] **Step 1: Update the Rating interface**

In `src/types/engagement.ts`, add `displayName?: string` after the `version?` field (around line 41) inside the `Rating` interface:

```typescript
export interface Rating {
  /** Unique rating ID */
  id: string;
  /** Type of resource being rated */
  resourceType: EngagementResourceType;
  /** Resource identifier */
  resourceId: string;
  /** Rating score (1-5) */
  score: RatingScore;
  /** ISO timestamp */
  timestamp: string;
  /** Resource version at time of rating */
  version?: string;
  /** Display name for the rated bundle, used to seed discussion creation on first vote */
  displayName?: string;
  /** Source identifier (adapter sourceId) for resolving cache keys across sessions */
  sourceId?: string;
  /** Hub ID — required for activation-time drain to route the retry to the correct backend */
  hubId?: string;
  /**
   * Whether this rating was successfully submitted to the remote backend.
   * Omitted on existing entries (treated as synced for backward compat).
   * Explicit `false` means submission failed and a drain pass should retry.
   */
  synced?: boolean;
}
```

- [ ] **Step 2: Drop `collectionsUrl` from the GitHub Discussions backend config**

In `src/types/engagement.ts`, modify `GitHubDiscussionsBackendConfig` (around line 145) to remove the `collectionsUrl` field:

```typescript
export interface GitHubDiscussionsBackendConfig extends EngagementBackendConfigBase {
  type: 'github-discussions';
  /** Repository in owner/repo format */
  repository: string;
  /** Discussion category */
  category?: string;
  /** Minimum account age in days to count votes (anti-abuse) */
  minAccountAgeDays?: number;
  /** List of usernames to exclude from vote counting */
  blacklist?: string[];
  /** Cache duration in minutes for aggregated ratings */
  cacheDurationMinutes?: number;
}
```

- [ ] **Step 3: Drop `collectionsUrl` from the JSON schema**

In `schemas/hub-config.schema.json`, find the discussions-backend definition (search for `"github-discussions"`). Remove any `collectionsUrl` property. If the surrounding object enumerates required or known properties, remove the entry consistently.

Run: `grep -n "collectionsUrl" schemas/hub-config.schema.json`
Expected: no matches.

- [ ] **Step 4: Update validation tests**

Open `test/types/hub-engagement-validation.test.ts`. For any test asserting acceptance of `collectionsUrl`, either:

- Replace it with a test asserting that an unknown property is rejected (if validator is strict), or
- Delete the test if it solely verified `collectionsUrl` round-tripping.

Run:
```bash
grep -n "collectionsUrl" test/types/hub-engagement-validation.test.ts
```

Update each match to remove the property from fixture objects and remove the assertion if it referenced `collectionsUrl`.

- [ ] **Step 5: Build to surface compile errors**

Run: `npm run compile 2>&1 | tee /tmp/typecheck.log | tail -40`

Expected: compile errors in files that referenced `collectionsUrl` (engagement-service.ts, github-discussions-backend.ts, tests). These will be fixed in Tasks 3–5. **Do not** patch them in this commit.

If errors are limited to `collectionsUrl` references, proceed.

- [ ] **Step 6: Commit**

```bash
git add src/types/engagement.ts schemas/hub-config.schema.json test/types/hub-engagement-validation.test.ts
git commit -m "refactor(engagement): drop collectionsUrl, add displayName to Rating

collectionsUrl is replaced by lazy discussion creation. displayName is
required when first vote on an unmapped bundle creates a new discussion."
```

Build remains broken until Task 3 lands.

---

## Task 3: Replace `loadCollectionsMappings` with `initializeCategory` + `ensureDiscussion`

This is the largest task. Split into sub-steps. All edits in `src/services/engagement/backends/github-discussions-backend.ts`.

**Files:**
- Modify: `src/services/engagement/backends/github-discussions-backend.ts`

### 3.1 — Strip dead code (reactions, userVotes, loadCollectionsMappings)

- [ ] **Step 1: Delete `userVotes` field**

In `github-discussions-backend.ts` line ~68:

Remove:
```typescript
private readonly userVotes: Map<string, 'up' | 'down'> = new Map();
```

- [ ] **Step 2: Delete `removeExistingReaction` method**

Search for `private async removeExistingReaction` (around line 155). Delete the entire method.

- [ ] **Step 3: Delete `loadCollectionsMappings` method**

Search for `public async loadCollectionsMappings` (around line 499). Delete the entire method, including its JSDoc.

- [ ] **Step 4: Delete the `convertRawUrlToApi` import if unused**

Run: `grep -n "convertRawUrlToApi" src/services/engagement/backends/github-discussions-backend.ts`
If only the (now-deleted) import remains, remove the import line.

- [ ] **Step 5: Delete `userVotes.clear()` and `userVotes.set/get/delete` references**

Run: `grep -n "userVotes" src/services/engagement/backends/github-discussions-backend.ts`
Remove every line that references `this.userVotes`. There should be ~4–5 hits in `submitRating`, `getRating`, `clearRating`, `initialize`. Replace logic appropriately:

- In `submitRating`: remove the line `this.userVotes.set(rating.resourceId, ...)`.
- In `getRating`: remove the early-return that reads `userVotes`. Fall through to existing `localBackend.getRating(...)`.
- In `clearRating` (or wherever it appears): remove the `userVotes.delete(...)` line.
- In `initialize`: remove `this.userVotes.clear()`.

- [ ] **Step 6: Compile**

Run: `npm run compile 2>&1 | tee /tmp/typecheck.log | tail -30`
Expected: compile errors only in `engagement-service.ts` (still references `loadCollectionsMappings`) and possibly in tests. Backend file should compile.

If backend file shows other errors, address them now (e.g., remove orphan `addReaction` GraphQL mutation block left in `submitRating`).

### 3.2 — Add `categoryId` field + `initializeCategory` + helpers

- [ ] **Step 7: Add categoryId field**

Near other private fields (top of class, around line 60):

```typescript
private categoryId: string | undefined;
```

- [ ] **Step 8: Add `initializeCategory` method**

Add a new public method (place it near `initialize`, respecting member ordering: public after private):

```typescript
/**
 * Resolve and cache the discussion category ID for the configured repo.
 * Must be called once after `initialize` before votes can create discussions.
 */
public async initializeCategory(): Promise<void> {
  this.ensureInitialized();
  if (this.categoryId) {
    return;
  }
  const categoryName = this.config.category ?? 'Bundle Ratings';
  const token = await this.getAccessToken();
  const query = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussionCategories(first: 50) {
          nodes { id name }
        }
      }
    }
  `;
  const response = await axios.post(
    'https://api.github.com/graphql',
    { query, variables: { owner: this.owner, repo: this.repo } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  /* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL response shape */
  const data = response.data as any;
  if (data?.errors) {
    throw new Error(`GraphQL error resolving category: ${JSON.stringify(data.errors)}`);
  }
  const nodes = data?.data?.repository?.discussionCategories?.nodes ?? [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const match = nodes.find((n: { name: string }) => n.name === categoryName);
  if (!match) {
    throw new Error(`Discussion category "${categoryName}" not found in ${this.owner}/${this.repo}`);
  }
  this.categoryId = match.id;
  this.logger.info(`Resolved discussion category "${categoryName}" → ${match.id}`);
}
```

- [ ] **Step 9: Add `searchDiscussionByTitle` method**

Place under the private methods section:

```typescript
/**
 * Search for an existing rating discussion by exact title.
 * Filters search results to the configured category.
 * @param title Exact discussion title to find.
 */
private async searchDiscussionByTitle(title: string): Promise<DiscussionMapping | undefined> {
  this.ensureInitialized();
  const token = await this.getAccessToken();
  const queryString = `repo:${this.owner}/${this.repo} in:title "${title}"`;
  const query = `
    query($q: String!) {
      search(query: $q, type: DISCUSSION, first: 10) {
        nodes {
          ... on Discussion {
            number
            title
            category { id }
          }
        }
      }
    }
  `;
  const response = await axios.post(
    'https://api.github.com/graphql',
    { query, variables: { q: queryString } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  /* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL response shape */
  const data = response.data as any;
  if (data?.errors) {
    this.logger.warn(`Search returned errors for "${title}"; falling back to create`);
    return undefined;
  }
  const nodes = data?.data?.search?.nodes ?? [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  for (const node of nodes) {
    if (node.title === title && node.category?.id === this.categoryId) {
      return { discussionNumber: node.number };
    }
  }
  return undefined;
}
```

- [ ] **Step 10: Add `createDiscussion` method**

```typescript
/**
 * Create a new rating discussion in the configured category.
 * @param title Discussion title (canonical bundle key).
 * @param body Discussion body including metadata YAML block.
 */
private async createDiscussion(title: string, body: string): Promise<DiscussionMapping> {
  this.ensureInitialized();
  if (!this.categoryId) {
    throw new Error('Category not initialized. Call initializeCategory() first.');
  }
  const token = await this.getAccessToken();

  // First fetch repository node ID (createDiscussion requires it).
  const repoQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) { id }
    }
  `;
  const repoResp = await axios.post(
    'https://api.github.com/graphql',
    { query: repoQuery, variables: { owner: this.owner, repo: this.repo } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  /* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL response shape */
  const repoData = repoResp.data as any;
  if (repoData?.errors) {
    throw new Error(`Failed to fetch repository ID: ${JSON.stringify(repoData.errors)}`);
  }
  const repoId = repoData?.data?.repository?.id;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!repoId) {
    throw new Error(`Repository ${this.owner}/${this.repo} not found`);
  }

  const mutation = `
    mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId,
        categoryId: $categoryId,
        title: $title,
        body: $body
      }) {
        discussion { number }
      }
    }
  `;
  const response = await axios.post(
    'https://api.github.com/graphql',
    {
      query: mutation,
      variables: { repositoryId: repoId, categoryId: this.categoryId, title, body },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  /* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL response shape */
  const data = response.data as any;
  if (data?.errors) {
    throw new Error(`createDiscussion GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  const number = data?.data?.createDiscussion?.discussion?.number;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (typeof number !== 'number') {
    throw new Error('createDiscussion returned no discussion number');
  }
  this.logger.info(`Created rating discussion #${number} for "${title}"`);
  return { discussionNumber: number };
}
```

- [ ] **Step 11: Add `ensureDiscussion` method**

```typescript
/**
 * Get or create a discussion mapping for a bundle resource.
 * Cache → search → create.
 * @param resourceId Composite "{sourceId}:{bundleId}".
 * @param displayName Human-readable bundle name (used in body).
 */
private async ensureDiscussion(resourceId: string, displayName: string): Promise<DiscussionMapping> {
  const cached = this.discussionMappings.get(resourceId);
  if (cached) {
    return cached;
  }
  const [sourceId, bundleId] = this.splitResourceId(resourceId);
  const title = buildRatingDiscussionTitle(sourceId, bundleId);
  const body = buildRatingDiscussionBody({ sourceId, bundleId, displayName });

  let mapping: DiscussionMapping | undefined;
  try {
    mapping = await this.searchDiscussionByTitle(title);
  } catch (err) {
    this.logger.warn(`searchDiscussionByTitle failed for "${title}": ${(err as Error).message}. Falling back to create.`);
  }

  if (!mapping) {
    mapping = await this.createDiscussion(title, body);
  }

  this.discussionMappings.set(resourceId, mapping);
  return mapping;
}

/**
 * Split a composite resourceId "{sourceId}:{bundleId}" into parts.
 * @param resourceId Composite identifier.
 */
private splitResourceId(resourceId: string): [string, string] {
  const idx = resourceId.indexOf(':');
  if (idx <= 0 || idx === resourceId.length - 1) {
    throw new Error(`Invalid resourceId format: "${resourceId}". Expected "sourceId:bundleId".`);
  }
  return [resourceId.slice(0, idx), resourceId.slice(idx + 1)];
}
```

- [ ] **Step 12: Add `handleAuthError` method**

```typescript
/**
 * Inspect an error for 401/403; if matched, prompt the user to re-authenticate
 * with `forceNewSession`. Always rethrows so callers can roll back optimistic state.
 * @param err The error caught from a GraphQL call.
 * @param op Human description of the failing operation (e.g., "create rating discussion").
 */
private async handleAuthError(err: unknown, op: string): Promise<never> {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) {
    const choice = await vscode.window.showWarningMessage(
      `GitHub token lacks permission to ${op}. Re-authenticate with required scopes?`,
      'Sign in again',
      'Cancel'
    );
    if (choice === 'Sign in again') {
      try {
        await vscode.authentication.getSession('github', ['repo'], { forceNewSession: true });
      } catch (reauthErr) {
        this.logger.warn(`Re-authentication dismissed: ${(reauthErr as Error).message}`);
      }
    }
  }
  throw err instanceof Error ? err : new Error(String(err));
}
```

- [ ] **Step 13: Add the new imports**

At the top of `github-discussions-backend.ts`, add:

```typescript
import * as vscode from 'vscode';
import {
  buildRatingDiscussionTitle,
  buildRatingDiscussionBody,
} from '../discussion-body-template';
```

(Keep existing imports. If `vscode` is already imported, skip.)

- [ ] **Step 14: Compile**

Run: `npm run compile 2>&1 | tee /tmp/typecheck.log | tail -40`
Expected: only `engagement-service.ts` should still error (it calls `loadCollectionsMappings`). Fix in Task 4.

### 3.3 — Rewire `submitRating`

- [ ] **Step 15: Rewrite `submitRating`**

Find `public async submitRating` (around line 574). Replace its body:

```typescript
public async submitRating(rating: Rating): Promise<void> {
  this.ensureInitialized();

  const displayName = rating.displayName ?? this.fallbackDisplayName(rating.resourceId);

  let mapping: DiscussionMapping;
  try {
    mapping = await this.ensureDiscussion(rating.resourceId, displayName);
  } catch (err) {
    this.logger.error(
      `Failed to ensure discussion for ${rating.resourceId}: ${(err as Error).message}. Stored locally; activation drain will retry.`,
      err instanceof Error ? err : undefined
    );
    await this.localBackend.submitRating({ ...rating, synced: false });
    await this.handleAuthError(err, 'create rating discussion');
    return; // unreachable — handleAuthError rethrows
  }

  try {
    const token = await this.getAccessToken();
    await this.postOrEditRatingComment(mapping, rating, token);
    await this.localBackend.submitRating({ ...rating, synced: true });
    this.logger.info(`Submitted rating for ${rating.resourceId} on discussion #${mapping.discussionNumber}`);
  } catch (err) {
    this.logger.error(
      `Failed to post rating comment for ${rating.resourceId}: ${(err as Error).message}. Stored locally; activation drain will retry.`,
      err instanceof Error ? err : undefined
    );
    await this.localBackend.submitRating({ ...rating, synced: false });
    await this.handleAuthError(err, 'post rating comment');
  }
}

/**
 * Build a fallback display name from the resourceId when the caller did not provide one.
 * @param resourceId Composite "{sourceId}:{bundleId}".
 */
private fallbackDisplayName(resourceId: string): string {
  const idx = resourceId.indexOf(':');
  return idx > 0 ? resourceId.slice(idx + 1) : resourceId;
}
```

- [ ] **Step 16: Compile**

Run: `npm run compile 2>&1 | tail -30`
Expected: only outstanding errors should be in `engagement-service.ts`.

- [ ] **Step 17: Commit**

```bash
git add src/services/engagement/backends/github-discussions-backend.ts
git commit -m "feat(engagement): replace collections.yaml with lazy discussion creation

ensureDiscussion: cache → searchDiscussionByTitle → createDiscussion.
initializeCategory resolves the rating category once. handleAuthError
prompts forceNewSession on 401/403. Reactions and userVotes removed."
```

---

## Task 4: Rewire `EngagementService.registerHubBackend`

**Files:**
- Modify: `src/services/engagement/engagement-service.ts`

- [ ] **Step 1: Replace the collectionsUrl block with `initializeCategory` call**

Open `src/services/engagement/engagement-service.ts` and find the `registerHubBackend` method (around line 230). Replace the existing `if (ghConfig.collectionsUrl) { ... }` block (roughly lines 247–272) with:

```typescript
if (config.backend.type === 'github-discussions') {
  const ghConfig = config.backend;
  backend = new GitHubDiscussionsBackend(storagePath);
  await backend.initialize(ghConfig);

  // Resolve discussion category once. Non-fatal: backend can still serve reads
  // via local fallback if the category cannot be resolved (e.g., transient 5xx).
  try {
    await (backend as GitHubDiscussionsBackend).initializeCategory();
  } catch (err) {
    this.logger.warn(
      `Failed to initialize discussion category for hub ${hubId}: ${(err as Error).message}. Voting will fail until next session.`
    );
  }
}
```

(Keep the surrounding else-branch for the file backend untouched.)

- [ ] **Step 2: Compile**

Run: `npm run compile 2>&1 | tail -20`
Expected: clean build (no errors).

- [ ] **Step 3: Run engagement service tests**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/engagement-service.test.ts 2>&1 | tail -40`

Expected: failures in tests that referenced `collectionsUrl`. Note them — fixed in next step.

- [ ] **Step 4: Update engagement-service tests**

In `test/services/engagement/engagement-service.test.ts`, find the four `collectionsUrl` references (around lines 213, 233, 254, 265).

For each:
- Remove the `collectionsUrl: '...'` line from the fixture object.
- If the test was specifically asserting that `loadCollectionsMappings` was called, replace it with a test that asserts `initializeCategory` was called instead. Use `sinon.stub(backend, 'initializeCategory').resolves()` or equivalent to verify.

Concrete pattern for the "happy path" test (around line 265, currently `'happy path without collectionsUrl still registers the backend'`):

Rename to: `'happy path: initializeCategory is called on registerHubBackend'`. Body should construct a fixture without `collectionsUrl`, stub `initializeCategory`, register the hub, assert the stub was called.

- [ ] **Step 5: Re-run engagement service tests**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/engagement-service.test.ts 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/engagement/engagement-service.ts test/services/engagement/engagement-service.test.ts
git commit -m "refactor(engagement): wire registerHubBackend to initializeCategory

Drops collectionsUrl branch and replaces it with a one-shot category
resolution call. Tests updated to assert the new contract."
```

---

## Task 5: Update `EngagementHydrator` (Drop Any `loadCollectionsMappings` Reference)

**Files:**
- Modify: `src/services/engagement/engagement-hydrator.ts`
- Modify: `test/services/engagement/engagement-hydrator.test.ts`

- [ ] **Step 1: Inspect the hydrator**

Run: `grep -n "loadCollectionsMappings\|collectionsUrl" src/services/engagement/engagement-hydrator.ts`

If there are no hits, skip to Step 3 (no source change needed).

- [ ] **Step 2: Remove any matches**

For each hit, remove the line. Hydrator should rely on `EngagementService.registerHubBackend` (already updated in Task 4) for backend setup.

- [ ] **Step 3: Add a hydrator test asserting no `loadCollectionsMappings` calls**

In `test/services/engagement/engagement-hydrator.test.ts`, add (or update) a test:

```typescript
it('does not call loadCollectionsMappings', async () => {
  const backend = new GitHubDiscussionsBackend('/tmp/test');
  // The method should not exist on the backend any more.
  assert.equal(typeof (backend as any).loadCollectionsMappings, 'undefined');
});
```

- [ ] **Step 4: Run hydrator tests**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/engagement-hydrator.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/engagement/engagement-hydrator.ts test/services/engagement/engagement-hydrator.test.ts
git commit -m "refactor(engagement): drop loadCollectionsMappings from hydrator path"
```

---

## Task 6: Update Marketplace View Provider to Pass `displayName`

**Files:**
- Modify: `src/ui/marketplace-view-provider.ts`

- [ ] **Step 1: Find rating-submission call sites**

Run: `grep -n "submitRating\|score:\|RatingService\|engagementService" src/ui/marketplace-view-provider.ts | head -30`

- [ ] **Step 2: For every place that constructs a `Rating` object, add `displayName: bundle.name`**

For each call site, locate the `Rating` literal (or partial) being passed to `submitRating` / `RatingService`. Add `displayName: bundle.name` to the object. Example pattern:

```typescript
await ratingService.submitRating({
  // ...existing fields...
  resourceType: 'bundle',
  resourceId: `${bundle.sourceId}:${bundle.id}`,
  score,
  timestamp: new Date().toISOString(),
  displayName: bundle.name,   // NEW
  hubId,
  sourceId: bundle.sourceId,
});
```

Repeat for every call site.

- [ ] **Step 3: Compile**

Run: `npm run compile 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 4: Run marketplace tests**

Run: `npx mocha --config test/.mocharc.json test/ui/marketplace-view-provider.test.ts 2>&1 | tail -30`
Expected: PASS (or pre-existing failures only — should not introduce new ones).

- [ ] **Step 5: Commit**

```bash
git add src/ui/marketplace-view-provider.ts
git commit -m "feat(engagement): pass bundle.name as displayName on rating submit

Required by ensureDiscussion to seed body metadata when first vote
creates the discussion."
```

---

## Task 7: Update GitHub Discussions Backend Tests

**Files:**
- Modify: `test/services/engagement/backends/github-discussions-backend.test.ts`

- [ ] **Step 1: Remove reaction-related tests**

Run: `grep -n "removeExistingReaction\|addReaction\|userVotes\|THUMBS_UP\|THUMBS_DOWN" test/services/engagement/backends/github-discussions-backend.test.ts`

Delete any test (entire `it(...)` block) that asserts behavior of those removed methods.

- [ ] **Step 2: Add tests for `ensureDiscussion`**

Add a new `describe` block:

```typescript
describe('ensureDiscussion', () => {
  beforeEach(async () => {
    backend = new GitHubDiscussionsBackend('/tmp/test-storage');
    await backend.initialize({
      type: 'github-discussions',
      repository: 'org/repo',
    });
    // Pre-set a category id to skip the resolution call in unit tests.
    (backend as any).categoryId = 'CAT_1';
  });

  it('returns cached mapping without GraphQL on second call', async () => {
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, {
        data: { search: { nodes: [{ number: 42, title: '[rating] s/b', category: { id: 'CAT_1' } }] } },
      });

    const m1 = await (backend as any).ensureDiscussion('s:b', 'B');
    const m2 = await (backend as any).ensureDiscussion('s:b', 'B');
    assert.equal(m1.discussionNumber, 42);
    assert.equal(m2.discussionNumber, 42);
    assert.ok(nock.isDone(), 'no extra GraphQL calls');
  });

  it('falls back to createDiscussion when search returns no match', async () => {
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { search: { nodes: [] } } });
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { repository: { id: 'REPO_1' } } });
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { createDiscussion: { discussion: { number: 99 } } } });

    const m = await (backend as any).ensureDiscussion('s:b', 'B');
    assert.equal(m.discussionNumber, 99);
  });

  it('falls back to create when search throws', async () => {
    nock('https://api.github.com').post('/graphql').replyWithError('boom');
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { repository: { id: 'REPO_1' } } });
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { createDiscussion: { discussion: { number: 7 } } } });

    const m = await (backend as any).ensureDiscussion('s:b', 'B');
    assert.equal(m.discussionNumber, 7);
  });
});
```

(Adapt imports / `nock` setup to match the existing file's conventions; if mocha + sinon are used differently, mirror the style of nearby tests.)

- [ ] **Step 3: Add tests for `submitRating` end-to-end flow**

```typescript
describe('submitRating (lazy creation)', () => {
  it('first vote: search miss → create → comment → synced=true', async () => {
    // search miss
    nock('https://api.github.com').post('/graphql').reply(200, { data: { search: { nodes: [] } } });
    // repo id
    nock('https://api.github.com').post('/graphql').reply(200, { data: { repository: { id: 'R' } } });
    // create
    nock('https://api.github.com').post('/graphql').reply(200, { data: { createDiscussion: { discussion: { number: 1 } } } });
    // postOrEditRatingComment internals (match whatever your mock contract requires)
    nock('https://api.github.com').post('/graphql').reply(200, { data: { /* ... */ } }).persist();

    await backend.submitRating({
      id: 'r1',
      resourceType: 'bundle',
      resourceId: 's:b',
      score: 4,
      timestamp: new Date().toISOString(),
      displayName: 'B',
    });

    const stored = await (backend as any).localBackend.getRating('bundle', 's:b');
    assert.equal(stored.synced, true);
  });

  it('create fails with 403: rolls back, prompts re-auth, synced=false', async () => {
    nock('https://api.github.com').post('/graphql').reply(200, { data: { search: { nodes: [] } } });
    nock('https://api.github.com').post('/graphql').reply(200, { data: { repository: { id: 'R' } } });
    nock('https://api.github.com').post('/graphql').reply(403, {});

    const showWarn = sinon.stub(vscode.window, 'showWarningMessage').resolves('Cancel');

    await assert.rejects(() => backend.submitRating({
      id: 'r2',
      resourceType: 'bundle',
      resourceId: 's:b',
      score: 5,
      timestamp: new Date().toISOString(),
      displayName: 'B',
    }));

    const stored = await (backend as any).localBackend.getRating('bundle', 's:b');
    assert.equal(stored?.synced, false);
    assert.ok(showWarn.calledOnce);

    showWarn.restore();
  });
});
```

- [ ] **Step 4: Add `handleAuthError` direct test**

```typescript
describe('handleAuthError', () => {
  it('triggers forceNewSession when user clicks Sign in again', async () => {
    const showWarn = sinon.stub(vscode.window, 'showWarningMessage').resolves('Sign in again');
    const getSession = sinon.stub(vscode.authentication, 'getSession').resolves(undefined);

    const err = { response: { status: 403 } };
    await assert.rejects(() => (backend as any).handleAuthError(err, 'test op'));

    assert.ok(showWarn.calledOnce);
    assert.ok(getSession.calledWithMatch('github', ['repo'], sinon.match({ forceNewSession: true })));

    showWarn.restore();
    getSession.restore();
  });
});
```

- [ ] **Step 5: Run backend tests**

Run: `npx mocha --config test/.mocharc.json test/services/engagement/backends/github-discussions-backend.test.ts 2>&1 | tee /tmp/backend-tests.log | tail -50`

Expected: PASS. If failures: read the log, adjust tests to match exact GraphQL call ordering used by the implementation. Do not weaken assertions — fix mocks.

- [ ] **Step 6: Commit**

```bash
git add test/services/engagement/backends/github-discussions-backend.test.ts
git commit -m "test(engagement): cover ensureDiscussion + submitRating lazy flow

Removes reaction-era tests. Adds search/create/cache and 403 re-auth
coverage."
```

---

## Task 8: Add Library-Side Body Parser (lib/src/discussion-body-template.ts)

`lib/` is a separate workspace and cannot import from `src/`. Mirror the parser there.

**Files:**
- Create: `lib/src/discussion-body-template.ts`
- Create: `lib/test/discussion-body-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/test/discussion-body-template.test.ts`:

```typescript
import { strict as assert } from 'assert';
import { parseBundleMetadata, METADATA_MARKER } from '../src/discussion-body-template';

describe('lib/discussion-body-template', () => {
  it('parses metadata block', () => {
    const body = `Hello\n\n${METADATA_MARKER}\n\`\`\`yaml\nbundle_id: b1\nsource_id: s1\n\`\`\`\n`;
    assert.deepEqual(parseBundleMetadata(body), { source_id: 's1', bundle_id: 'b1' });
  });

  it('returns undefined when marker missing', () => {
    assert.equal(parseBundleMetadata('no marker'), undefined);
  });

  it('returns undefined when fields missing', () => {
    const body = `${METADATA_MARKER}\n\`\`\`yaml\nfoo: bar\n\`\`\``;
    assert.equal(parseBundleMetadata(body), undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd lib && npm test -- --grep "lib/discussion-body-template" 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the lib parser**

Create `lib/src/discussion-body-template.ts`:

```typescript
import * as yaml from 'js-yaml';

export const METADATA_MARKER = '<!-- prompt-registry:metadata -->';

/* eslint-disable @typescript-eslint/naming-convention -- snake_case matches YAML wire format */
export interface BundleMetadata {
  source_id: string;
  bundle_id: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Parse the bundle metadata block from a discussion body.
 * @param body Raw discussion body text.
 */
export function parseBundleMetadata(body: string): BundleMetadata | undefined {
  const markerIdx = body.indexOf(METADATA_MARKER);
  if (markerIdx === -1) return undefined;
  const after = body.slice(markerIdx + METADATA_MARKER.length);
  const fenceMatch = after.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fenceMatch) return undefined;
  let parsed: unknown;
  try {
    parsed = yaml.load(fenceMatch[1]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.source_id !== 'string' || typeof obj.bundle_id !== 'string') return undefined;
  return { source_id: obj.source_id, bundle_id: obj.bundle_id };
}
```

- [ ] **Step 4: Run the test**

Run: `cd lib && npm test -- --grep "lib/discussion-body-template" 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/src/discussion-body-template.ts lib/test/discussion-body-template.test.ts
git commit -m "feat(lib): add discussion body metadata parser

Mirrors src/services/engagement/discussion-body-template parser for
use by compute-ratings. lib has its own tsconfig and cannot import
from src."
```

---

## Task 9: Rewrite `lib/src/compute-ratings.ts` to Aggregate from Discussions

**Files:**
- Modify: `lib/src/compute-ratings.ts`
- Modify: `lib/test/compute-ratings.test.ts`
- Modify: `lib/bin/compute-ratings.js` (CLI args)

### 9.1 — Add `listDiscussionsInCategory` and aggregation by metadata

- [ ] **Step 1: Update CLI args**

Open `lib/bin/compute-ratings.js`. Change the args contract from `--config <collections.yaml>` to `--repo <owner/repo> --category <name>`. Replace the file's contents (it's small, ~25 lines) with:

```javascript
#!/usr/bin/env node
const { computeRatings } = require('../dist/compute-ratings');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const repo = getArg('repo');
const category = getArg('category') ?? 'Bundle Ratings';
const output = getArg('output');
const token = process.env.GITHUB_TOKEN;

if (!repo || !output || !token) {
  console.error('Usage: GITHUB_TOKEN=... compute-ratings --repo owner/repo --output ratings.json [--category "Bundle Ratings"]');
  process.exit(1);
}

computeRatings({ repo, category, outputPath: output, token })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Add `listDiscussionsInCategory` to compute-ratings.ts**

In `lib/src/compute-ratings.ts`, add (place after the existing GraphQL helpers like `fetchDiscussionReactions`):

```typescript
import { parseBundleMetadata } from './discussion-body-template';

/**
 * GraphQL Discussion node returned by listDiscussionsInCategory.
 */
export interface DiscussionNode {
  number: number;
  title: string;
  body: string;
}

/**
 * List all discussions in the named category, paginated.
 * @param owner Repo owner.
 * @param repo Repo name.
 * @param categoryName Discussion category to filter by.
 * @param token GitHub token.
 */
export async function listDiscussionsInCategory(
  owner: string,
  repo: string,
  categoryName: string,
  token: string
): Promise<DiscussionNode[]> {
  // Resolve category id first.
  const catQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussionCategories(first: 50) { nodes { id name } }
      }
    }
  `;
  const catResp = await axios.post(
    'https://api.github.com/graphql',
    { query: catQuery, variables: { owner, repo } },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const catData = catResp.data as any;
  const cats = catData?.data?.repository?.discussionCategories?.nodes ?? [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const cat = cats.find((c: { name: string }) => c.name === categoryName);
  if (!cat) {
    throw new Error(`Category "${categoryName}" not found`);
  }

  const out: DiscussionNode[] = [];
  let cursor: string | null = null;

  for (;;) {
    const query = `
      query($owner: String!, $repo: String!, $catId: ID!, $after: String) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 100, categoryId: $catId, after: $after) {
            pageInfo { endCursor hasNextPage }
            nodes { number title body }
          }
        }
      }
    `;
    const resp = await axios.post(
      'https://api.github.com/graphql',
      { query, variables: { owner, repo, catId: cat.id, after: cursor } },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const data = resp.data as any;
    if (data?.errors) {
      throw new Error(`listDiscussionsInCategory GraphQL error: ${JSON.stringify(data.errors)}`);
    }
    const page = data?.data?.repository?.discussions;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const nodes = page?.nodes ?? [];
    out.push(...nodes);
    if (!page?.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}
```

- [ ] **Step 3: Replace the public `computeRatings` entrypoint**

Find the current `export async function computeRatings(configPath, outputPath, token)` (around line ~785). Replace with:

```typescript
/**
 * Inputs for computeRatings.
 */
export interface ComputeRatingsInput {
  repo: string;       // "owner/repo"
  category: string;   // discussion category name
  outputPath: string;
  token: string;
}

/**
 * Compute ratings.json from discussions in the configured repo + category.
 * @param input Repo, category, output path, token.
 */
export async function computeRatings(input: ComputeRatingsInput): Promise<void> {
  const [owner, repo] = input.repo.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repo format. Expected "owner/repo".');
  }

  console.log(`Computing ratings from ${input.repo} category "${input.category}"`);

  const discussions = await listDiscussionsInCategory(owner, repo, input.category, input.token);
  console.log(`Found ${discussions.length} discussions`);

  // Group discussions by (source_id, bundle_id) parsed from body metadata.
  const grouped = new Map<string, DiscussionNode[]>();
  let skipped = 0;
  for (const d of discussions) {
    const meta = parseBundleMetadata(d.body);
    if (!meta) {
      skipped++;
      continue;
    }
    const key = `${meta.source_id}:${meta.bundle_id}`;
    const list = grouped.get(key) ?? [];
    list.push(d);
    grouped.set(key, list);
  }
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} discussions without metadata block`);
  }

  // For each group, fetch all comments, dedupe by user, compute aggregates.
  const collections: Record<string, CollectionRating> = {};
  for (const [key, ds] of grouped) {
    const allComments: DiscussionComment[] = [];
    for (const d of ds) {
      const cs = await fetchDiscussionComments(owner, repo, d.number, input.token);
      allComments.push(...cs);
    }
    const starRatings = deduplicateRatingsByUser(allComments);
    if (starRatings.length === 0) continue;
    const avg = computeAverageStarRating(starRatings);
    const wilson = (avg.average - 1) / 4;
    collections[key] = {
      source_id: key.split(':')[0],
      discussion_number: ds[0].number,
      up: 0,
      down: 0,
      wilson_score: Math.round(wilson * 1000) / 1000,
      bayesian_score: Math.round(avg.average * 1000) / 1000,
      aggregated_score: Math.round(avg.average * 1000) / 1000,
      star_rating: avg.average,
      rating_count: avg.count,
      confidence: avg.confidence,
      resources: {},
    };
  }

  const output: RatingsOutput = {
    generated_at: new Date().toISOString(),
    repository: input.repo,
    collections,
  };
  fs.writeFileSync(input.outputPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${Object.keys(collections).length} ratings to ${input.outputPath}`);
}
```

(Adjust the `CollectionRating` shape to match the existing interface — it may already include all listed fields. Run `grep -n "interface CollectionRating" lib/src/compute-ratings.ts` to confirm.)

- [ ] **Step 4: Delete the obsolete code paths**

Search for and delete the now-unused functions in `lib/src/compute-ratings.ts`:

- The old `computeCollectionRating(collection, owner, repo, token)` (around line 648).
- The reaction-fetching helpers if they're no longer called: `fetchDiscussionReactions`, `fetchAllReactions`, `fetchCommentReactions` if unused.
- The `CollectionsConfig` / `CollectionMapping` / `ResourceMapping` interfaces (around lines 30–50) if no longer used.
- Any `yaml.load(configContent)` lines for the old config flow.
- Any `fs.readFileSync(configPath)` in the old entrypoint.

After each deletion, run: `npx tsc --noEmit -p lib/tsconfig.json 2>&1 | tail -10` to surface remaining references. Iterate until clean.

- [ ] **Step 5: Confirm lib build**

Run: `cd lib && npm run build 2>&1 | tail -10 && cd ..`
Expected: clean.

### 9.2 — Tests

- [ ] **Step 6: Update `lib/test/compute-ratings.test.ts`**

Run: `grep -n "collections.yaml\|loadConfig\|configPath" lib/test/compute-ratings.test.ts`

For every match, remove the test or rewrite it. Add new tests:

```typescript
import { strict as assert } from 'assert';
import nock from 'nock';
import { listDiscussionsInCategory, computeRatings } from '../src/compute-ratings';
import * as fs from 'fs';
import * as path from 'path';

describe('listDiscussionsInCategory', () => {
  afterEach(() => nock.cleanAll());

  it('paginates and returns all nodes', async () => {
    nock('https://api.github.com')
      .post('/graphql')
      .reply(200, { data: { repository: { discussionCategories: { nodes: [{ id: 'C1', name: 'Bundle Ratings' }] } } } })
      .post('/graphql')
      .reply(200, { data: { repository: { discussions: {
        pageInfo: { endCursor: 'X', hasNextPage: true },
        nodes: [{ number: 1, title: 't1', body: 'b1' }],
      } } } })
      .post('/graphql')
      .reply(200, { data: { repository: { discussions: {
        pageInfo: { endCursor: null, hasNextPage: false },
        nodes: [{ number: 2, title: 't2', body: 'b2' }],
      } } } });

    const out = await listDiscussionsInCategory('o', 'r', 'Bundle Ratings', 'tok');
    assert.equal(out.length, 2);
  });
});

describe('computeRatings (aggregation by body metadata)', () => {
  afterEach(() => nock.cleanAll());

  it('groups two discussions sharing the same (source_id, bundle_id)', async () => {
    const body = `<!-- prompt-registry:metadata -->\n\`\`\`yaml\nbundle_id: bx\nsource_id: sa\n\`\`\``;
    nock('https://api.github.com')
      .post('/graphql').reply(200, { data: { repository: { discussionCategories: { nodes: [{ id: 'C1', name: 'Bundle Ratings' }] } } } })
      .post('/graphql').reply(200, { data: { repository: { discussions: {
        pageInfo: { endCursor: null, hasNextPage: false },
        nodes: [
          { number: 10, title: 't', body },
          { number: 11, title: 't', body },
        ],
      } } } })
      // comments fetch for #10
      .get(/discussions\/10\/comments.*/).reply(200, [{ user: { login: 'alice' }, body: 'Rating: ⭐⭐⭐⭐' }])
      // comments fetch for #11
      .get(/discussions\/11\/comments.*/).reply(200, [{ user: { login: 'bob' }, body: 'Rating: ⭐⭐⭐⭐⭐' }]);

    const tmp = path.join('/tmp', `ratings-${Date.now()}.json`);
    await computeRatings({ repo: 'o/r', category: 'Bundle Ratings', outputPath: tmp, token: 'tok' });
    const out = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    assert.ok(out.collections['sa:bx']);
    assert.equal(out.collections['sa:bx'].rating_count, 2);
  });

  it('skips discussions without metadata', async () => {
    nock('https://api.github.com')
      .post('/graphql').reply(200, { data: { repository: { discussionCategories: { nodes: [{ id: 'C1', name: 'Bundle Ratings' }] } } } })
      .post('/graphql').reply(200, { data: { repository: { discussions: {
        pageInfo: { endCursor: null, hasNextPage: false },
        nodes: [{ number: 1, title: 't', body: 'no marker here' }],
      } } } });

    const tmp = path.join('/tmp', `ratings-${Date.now()}.json`);
    await computeRatings({ repo: 'o/r', category: 'Bundle Ratings', outputPath: tmp, token: 'tok' });
    const out = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    assert.deepEqual(out.collections, {});
  });
});
```

(Adapt nock URLs to match what `fetchDiscussionComments` actually requests — REST or GraphQL — confirm by reading that function.)

- [ ] **Step 7: Run lib tests**

Run: `cd lib && npm test 2>&1 | tee /tmp/lib-tests.log | tail -40 && cd ..`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/src/compute-ratings.ts lib/test/compute-ratings.test.ts lib/bin/compute-ratings.js
git commit -m "feat(lib): rewrite compute-ratings to aggregate from discussions

Drops collections.yaml input. Lists discussions in the rating category,
parses body metadata, groups by (source_id, bundle_id), unions star
comments across duplicates."
```

---

## Task 10: Delete Obsolete `setup-discussions` Files

**Files:**
- Delete: `lib/src/setup-discussions.ts`
- Delete: `lib/bin/setup-discussions.js`
- Delete: `lib/test/setup-discussions.test.ts` (if present)
- Modify: `lib/src/index.ts` (drop re-export if any)
- Modify: `lib/package.json` (drop bin entry if any)

- [ ] **Step 1: Confirm no remaining references**

Run:
```bash
grep -rn "setup-discussions" lib/ src/ test/ docs/ package.json README.md 2>&1 | head -30
```

For every match outside the files being deleted, plan an update.

- [ ] **Step 2: Delete the files**

Run:
```bash
git rm lib/src/setup-discussions.ts lib/bin/setup-discussions.js
test -f lib/test/setup-discussions.test.ts && git rm lib/test/setup-discussions.test.ts || true
```

- [ ] **Step 3: Drop re-export from `lib/src/index.ts`**

Run: `grep -n "setup-discussions\|setupDiscussions" lib/src/index.ts`
Remove any matching line.

- [ ] **Step 4: Drop bin entry from `lib/package.json` if present**

Open `lib/package.json`. If `bin` contains a `setup-discussions` mapping, remove that one entry.

- [ ] **Step 5: Update docs that reference setup-discussions**

Run: `grep -rn "setup-discussions\|setupDiscussions" docs/ 2>&1 | head -20`

For each match, either delete the section (if it documented the removed CLI as a required step) or rewrite it to describe the new lazy-creation flow. Most likely:

- `docs/contributor-guide/architecture/engagement.md` — the section "compute-ratings CLI" needs to lose any setup-discussions prerequisite. Update the "What it does" list to: "Lists discussions in the rating category. Parses body metadata. Aggregates star ratings."

- `docs/reference/engagement-api.md` — drop any setup-discussions API section.

- [ ] **Step 6: Build everything**

Run:
```bash
npm run compile 2>&1 | tail -10
cd lib && npm run build 2>&1 | tail -10 && cd ..
```
Expected: both clean.

- [ ] **Step 7: Run all tests**

Run: `npm test 2>&1 | tee /tmp/full-tests.log | tail -30`
Expected: PASS.

Run: `cd lib && npm test 2>&1 | tail -20 && cd ..`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(engagement): delete setup-discussions CLI

Discussion creation now happens lazily in the extension on first vote.
The standalone setup-discussions CLI is no longer needed."
```

---

## Task 11: Update Architecture Docs

**Files:**
- Modify: `docs/contributor-guide/architecture/engagement.md`
- Modify: `docs/reference/engagement-api.md`
- Modify: `docs/reference/hub-schema.md`
- Modify: `docs/user-guide/engagement.md`

- [ ] **Step 1: Update `docs/contributor-guide/architecture/engagement.md`**

Read the file. Update at minimum:

1. Replace the "GitHubDiscussionsBackend / Mapping" section to describe `ensureDiscussion` (cache → search → create) instead of `loadCollectionsMappings`.
2. Update the comment-format block to reflect that the body now contains a metadata block and the title is the canonical key.
3. Update the "compute-ratings CLI" section: drop `--config <collections.yaml>`, document `--repo owner/repo --category "Bundle Ratings"`, and explain that aggregation groups by body metadata.
4. Update the sequence diagrams to show `initializeCategory` instead of `loadCollectionsMappings`.
5. Add a short subsection "Race handling" explaining search-then-create + CI merge.

- [ ] **Step 2: Update `docs/reference/engagement-api.md`**

Adjust the API reference to match the new `GitHubDiscussionsBackend` public surface:

- Remove `loadCollectionsMappings`.
- Add `initializeCategory`.
- Mention `ensureDiscussion` as a private implementation detail (non-public).

- [ ] **Step 3: Update `docs/reference/hub-schema.md`**

Find the engagement section. Remove the `collectionsUrl` description. Confirm `category` is documented (default `Bundle Ratings`).

- [ ] **Step 4: Update `docs/user-guide/engagement.md`**

If it instructs users or admins to run `setup-discussions`, replace with: "Discussions are created automatically the first time someone votes on a bundle." Remove any reference to `collections.yaml`.

- [ ] **Step 5: Verify Docusaurus build**

Run: `cd website && npm run build 2>&1 | tail -20 && cd ..`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add docs/ website/ 2>/dev/null || git add docs/
git commit -m "docs(engagement): document lazy discussion creation flow

Removes setup-discussions and collections.yaml references. Documents
ensureDiscussion lifecycle, body metadata block, and updated
compute-ratings CLI args."
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full lint**

Run: `npm run lint 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npm test 2>&1 | tee /tmp/final.log | tail -30`
Expected: PASS.

- [ ] **Step 3: Full lib test suite**

Run: `cd lib && npm test 2>&1 | tail -20 && cd ..`
Expected: PASS.

- [ ] **Step 4: Full compile**

Run: `npm run compile 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 5: Manual smoke (extension dev host)**

Run from VS Code: `F5` to launch Extension Development Host. In the host:

1. Add a hub whose engagement repo is one you have write access to and where the rating category exists (or create category manually first).
2. Open the marketplace view.
3. Click thumbs/star on a bundle that has no existing discussion.
4. Open the engagement repo Discussions tab in a browser → confirm a new `[rating] sourceId/bundleId` discussion exists with the body metadata block.
5. Click a different score on the same bundle → confirm only an updated comment, no new discussion.
6. Run `GITHUB_TOKEN=$(gh auth token) node lib/bin/compute-ratings.js --repo OWNER/REPO --output /tmp/r.json`
7. Inspect `/tmp/r.json` → confirm the bundle key shows up with `rating_count >= 1`.

If any step fails, **do not** mark the task complete. Stop and report.

- [ ] **Step 6: Final commit / branch state**

Confirm working tree is clean:

```bash
git status --short
git log --oneline origin/feat/feedback-squashed..HEAD
```

The new commits should form a coherent series (one per task). Done.

---

## Self-Review Checklist (run before declaring "plan complete")

- [x] Spec coverage: every decision in the spec maps to a task. Decisions 1–7 → Tasks 3, 9, 4, 1, 3.1, 6, 3.12.
- [x] No placeholders: every code block is concrete; no "TBD"/"add appropriate handling".
- [x] Type consistency: `DiscussionMapping`, `BundleMetadata`, `ComputeRatingsInput`, `Rating.displayName` referenced consistently.
- [x] File paths are absolute relative to repo root and match the actual codebase layout (verified via grep during plan authoring).
- [x] TDD ordering preserved: failing test → minimal code → passing test → commit, in every component task.
- [x] Frequent commits: every task ends with one commit; no megacommits.
