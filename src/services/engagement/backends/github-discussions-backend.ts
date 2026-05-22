/**
 * GitHubDiscussionsBackend - Engagement backend using GitHub Discussions
 *
 * Uses GitHub Discussions as the voting surface:
 * - Each rated bundle has (or lazily gets) a Discussion under the configured category
 * - Star ratings are recorded as comments on the discussion
 * - Feedback is also stored locally as backup
 *
 * This backend is read-heavy and write-light:
 * - Aggregated ratings come from pre-computed ratings.json (via RatingService)
 * - Votes are submitted by posting/editing rating comments via GraphQL
 */

import axios from 'axios';
import * as vscode from 'vscode';
import {
  BackendConfig,
  EngagementResourceType,
  Feedback,
  GitHubDiscussionsBackendConfig,
  Rating,
  RatingScore,
  RatingStats,
} from '../../../types/engagement';
import {
  Logger,
} from '../../../utils/logger';
import {
  parseRatingFromComment,
} from '../../../utils/rating-parser';
import {
  buildRatingDiscussionBody,
  buildRatingDiscussionTitle,
} from '../discussion-body-template';
import {
  BaseEngagementBackend,
} from '../engagement-backend';
import {
  FileBackend,
} from './file-backend';

/**
 * Mapping of resource IDs to GitHub Discussion numbers
 */
interface DiscussionMapping {
  resourceId: string;
  discussionNumber: number;
  commentId?: number;
}

/**
 * GitHub Discussions Backend implementation
 */
export class GitHubDiscussionsBackend extends BaseEngagementBackend {
  public readonly type = 'github-discussions';

  private readonly logger: Logger;
  private config?: GitHubDiscussionsBackendConfig;
  private owner = '';
  private repo = '';
  private categoryId: string | undefined;
  private readonly discussionMappings: Map<string, DiscussionMapping> = new Map();

  // Use FileBackend for local storage of feedback
  private readonly localBackend: FileBackend;

  // Cache for comment node IDs (discussionNumber -> commentNodeId)
  private readonly commentNodeIds: Map<string, string> = new Map();

  private readonly storagePath: string;

  constructor(storagePath: string) {
    super();
    this.logger = Logger.getInstance();
    this.localBackend = new FileBackend();
    this.storagePath = storagePath;
  }

  /**
   * Add a comment to a GitHub Discussion using GraphQL mutation
   * @param discussionId Node ID of the target discussion.
   * @param body Markdown body for the new comment.
   * @param token GitHub access token.
   */
  private async addDiscussionComment(discussionId: string, body: string, token: string): Promise<void> {
    const mutation = `
            mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
                addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                    comment {
                        id
                        body
                    }
                }
            }
        `;

    this.logger.debug(`Adding comment to discussion ${discussionId}`);

    const response = await axios.post<{
      data?: {
        addDiscussionComment?: {
          comment?: {
            id: string;
            body: string;
          };
        };
      };
      errors?: { message: string; type?: string }[];
    }>(
      'https://api.github.com/graphql',
      {
        query: mutation,
        variables: {
          discussionId,
          body
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Check for GraphQL errors
    if (response.data.errors && response.data.errors.length > 0) {
      const errorMessages = response.data.errors.map((e) => e.message).join(', ');
      this.logger.error(`GraphQL errors: ${errorMessages}`);
      throw new Error(`GraphQL error: ${errorMessages}`);
    }

    // Verify comment was created
    const commentId = response.data.data?.addDiscussionComment?.comment?.id;
    if (!commentId) {
      this.logger.error('No comment ID returned from GitHub Discussions');
      throw new Error('Comment was not created - no comment ID returned');
    }

    this.logger.debug(`Comment created with ID: ${commentId}`);
  }

  /**
   * Create a new rating discussion in the resolved category.
   * @param title Title of the new discussion.
   * @param body Body markdown including the metadata block.
   */
  private async createDiscussion(title: string, body: string): Promise<DiscussionMapping> {
    this.ensureInitialized();
    if (!this.categoryId) {
      throw new Error('Category not initialized. Call initializeCategory() first.');
    }
    const token = await this.getAccessToken();

    const repoQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) { id }
    }
  `;
    const repoResp = await axios.post<{
      data?: { repository?: { id: string } };
      errors?: { message: string }[];
    }>(
      'https://api.github.com/graphql',
      { query: repoQuery, variables: { owner: this.owner, repo: this.repo } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (repoResp.data?.errors?.length) {
      throw new Error(`Failed to fetch repository id: ${repoResp.data.errors.map((e) => e.message).join('; ')}`);
    }
    const repoId = repoResp.data?.data?.repository?.id;
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
    const response = await axios.post<{
      data?: { createDiscussion?: { discussion?: { number: number } } };
      errors?: { message: string }[];
    }>(
      'https://api.github.com/graphql',
      {
        query: mutation,
        variables: { repositoryId: repoId, categoryId: this.categoryId, title, body }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (response.data?.errors?.length) {
      throw new Error(`createDiscussion error: ${response.data.errors.map((e) => e.message).join('; ')}`);
    }
    const number = response.data?.data?.createDiscussion?.discussion?.number;
    if (typeof number !== 'number') {
      throw new Error('createDiscussion returned no discussion number');
    }
    this.logger.info(`Created rating discussion #${number} for "${title}"`);
    return { resourceId: '', discussionNumber: number };
  }

  /**
   * Resolve and cache the discussion category id for the configured repo.
   * Idempotent: subsequent calls return immediately if already resolved.
   */
  private async ensureCategoryResolved(): Promise<void> {
    this.ensureInitialized();
    if (this.categoryId) {
      return;
    }
    const categoryName = this.config?.category ?? 'Bundle Ratings';
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
    const response = await axios.post<{
      data?: { repository?: { discussionCategories?: { nodes: { id: string; name: string }[] } } };
      errors?: { message: string }[];
    }>(
      'https://api.github.com/graphql',
      { query, variables: { owner: this.owner, repo: this.repo } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (response.data?.errors?.length) {
      throw new Error(`Failed to resolve discussion category: ${response.data.errors.map((e) => e.message).join('; ')}`);
    }
    const nodes = response.data?.data?.repository?.discussionCategories?.nodes ?? [];
    const match = nodes.find((n) => n.name === categoryName);
    if (!match) {
      throw new Error(`Discussion category "${categoryName}" not found in ${this.owner}/${this.repo}`);
    }
    this.categoryId = match.id;
    this.logger.info(`Resolved discussion category "${categoryName}" → ${match.id}`);
  }

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
    await this.ensureCategoryResolved();

    const [sourceId, bundleId] = this.splitResourceId(resourceId);
    const title = buildRatingDiscussionTitle(sourceId, bundleId);

    let mapping = await this.searchDiscussionByTitle(title);
    if (!mapping) {
      const body = buildRatingDiscussionBody({ sourceId, bundleId, displayName });
      mapping = await this.createDiscussion(title, body);
    }

    const resolved: DiscussionMapping = { resourceId, discussionNumber: mapping.discussionNumber };
    this.discussionMappings.set(resourceId, resolved);
    return resolved;
  }

  /**
   * Fallback display name derived from a composite resourceId.
   * @param resourceId Composite "{sourceId}:{bundleId}".
   */
  private fallbackDisplayName(resourceId: string): string {
    const idx = resourceId.indexOf(':');
    return idx > 0 ? resourceId.slice(idx + 1) : resourceId;
  }

  /**
   * Fetch all comments on a discussion via GraphQL
   * @param discussionNumber Discussion number to fetch comments for.
   * @param token GitHub access token.
   */
  private async fetchDiscussionComments(
    discussionNumber: number,
    token: string
  ): Promise<{ id: string; author: { login: string }; body: string }[]> {
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
              nodes: { id: string; author: { login: string }; body: string }[];
            };
          };
        };
      };
    }>(
      'https://api.github.com/graphql',
      { query, variables: { owner: this.owner, repo: this.repo, number: discussionNumber } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    return response.data?.data?.repository?.discussion?.comments?.nodes || [];
  }

  /**
   * Find viewer's existing rating comment on a discussion
   * @param discussionNumber Discussion number to search.
   * @param token GitHub access token.
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

    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
    const viewerLogin = session?.account.label;
    if (!viewerLogin) {
      return undefined;
    }

    const comments = await this.fetchDiscussionComments(discussionNumber, token);
    const viewerComments = comments.filter(
      (c) => c.author?.login === viewerLogin && c.body.match(/^Rating:\s*⭐/m)
    );

    // Use the last (most recent) comment — GraphQL returns chronologically
    const viewerComment = viewerComments.length > 0 ? viewerComments.at(-1) : undefined;

    if (viewerComment) {
      this.commentNodeIds.set(String(discussionNumber), viewerComment.id);
      return { nodeId: viewerComment.id, body: viewerComment.body };
    }

    return undefined;
  }

  /**
   * Format feedback into a readable GitHub comment
   * New format:
   * Rating: ⭐⭐⭐⭐⭐
   * Feedback: Works great!
   * ---
   * Version: 1.0.0
   * @param feedback Feedback entry to format.
   */
  private formatFeedbackComment(feedback: Feedback): string {
    const parts: string[] = [];

    // Rating line with stars if present
    if (feedback.rating !== undefined) {
      const stars = '⭐'.repeat(feedback.rating);
      parts.push(`Rating: ${stars}`);
    }

    // Feedback line (only if comment is not empty)
    if (feedback.comment && feedback.comment.trim()) {
      parts.push(`Feedback: ${feedback.comment}`);
    }

    // Add metadata footer with separator
    if (feedback.version) {
      parts.push('---', `Version: ${feedback.version}`);
    }

    return parts.join('\n');
  }

  /**
   * Format rating as a comment body
   * @param score Rating score 1..5.
   */
  private formatRatingComment(score: number): string {
    const stars = '⭐'.repeat(score);
    return `Rating: ${stars}`;
  }

  /**
   * Get GitHub access token via VS Code authentication
   */
  private async getAccessToken(): Promise<string> {
    const session = await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: true
    });
    return session.accessToken;
  }

  /**
   * Get the GitHub Discussion node ID (required for GraphQL mutations)
   * @param discussionNumber Discussion number to look up.
   * @param token GitHub access token.
   */
  private async getDiscussionNodeId(discussionNumber: number, token: string): Promise<string> {
    const query = `
            query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    discussion(number: $number) {
                        id
                    }
                }
            }
        `;

    const response = await axios.post<{
      data: {
        repository: {
          discussion: {
            id: string;
          };
        };
      };
    }>(
      'https://api.github.com/graphql',
      {
        query,
        variables: {
          owner: this.owner,
          repo: this.repo,
          number: discussionNumber
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const discussionId = response.data?.data?.repository?.discussion?.id;
    if (!discussionId) {
      throw new Error(`Discussion #${discussionNumber} not found`);
    }

    return discussionId;
  }

  /**
   * If err is a 401/403 from GitHub, prompt the user to re-authenticate
   * with forceNewSession. Always rethrows so callers can mark unsynced.
   * @param err Error caught from a GraphQL call.
   * @param op Human description of the failing operation.
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

  /**
   * Post or edit a rating comment on a discussion
   * @param mapping Discussion mapping to comment under.
   * @param rating Rating to record.
   * @param token GitHub access token.
   */
  private async postOrEditRatingComment(
    mapping: DiscussionMapping,
    rating: Rating,
    token: string
  ): Promise<void> {
    const commentBody = this.formatRatingComment(rating.score);
    const existing = await this.findViewerComment(mapping.discussionNumber, token);

    if (existing) {
      await this.updateDiscussionComment(existing.nodeId, commentBody, token);
      this.logger.debug(`Updated rating comment on discussion #${mapping.discussionNumber}`);
    } else {
      const discussionNodeId = await this.getDiscussionNodeId(mapping.discussionNumber, token);
      await this.addDiscussionComment(discussionNodeId, commentBody, token);
      this.logger.debug(`Posted rating comment on discussion #${mapping.discussionNumber}`);
    }
  }

  /**
   * Search for an existing rating discussion by exact title.
   * Filters to the configured category. Returns undefined on any error
   * (caller falls back to createDiscussion).
   * @param title Exact discussion title to match.
   */
  private async searchDiscussionByTitle(title: string): Promise<DiscussionMapping | undefined> {
    this.ensureInitialized();
    if (!this.categoryId) {
      return undefined;
    }
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
    try {
      const response = await axios.post<{
        data?: { search?: { nodes: { number: number; title: string; category?: { id: string } }[] } };
        errors?: { message: string }[];
      }>(
        'https://api.github.com/graphql',
        { query, variables: { q: queryString } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      if (response.data?.errors?.length) {
        this.logger.warn(`Discussion search returned errors for "${title}"; falling back to create.`);
        return undefined;
      }
      const nodes = response.data?.data?.search?.nodes ?? [];
      for (const node of nodes) {
        if (node.title === title && node.category?.id === this.categoryId) {
          return { resourceId: '', discussionNumber: node.number };
        }
      }
      return undefined;
    } catch (err) {
      this.logger.warn(`Discussion search threw for "${title}": ${(err as Error).message}. Falling back to create.`);
      return undefined;
    }
  }

  /**
   * Split a composite resourceId "{sourceId}:{bundleId}" into its parts.
   * Throws on malformed input.
   * @param resourceId Composite identifier.
   */
  private splitResourceId(resourceId: string): [string, string] {
    const idx = resourceId.indexOf(':');
    if (idx <= 0 || idx === resourceId.length - 1) {
      throw new Error(`Invalid resourceId format: "${resourceId}". Expected "sourceId:bundleId".`);
    }
    return [resourceId.slice(0, idx), resourceId.slice(idx + 1)];
  }

  /**
   * Update an existing discussion comment
   * @param commentNodeId Node ID of the comment to update.
   * @param body New markdown body.
   * @param token GitHub access token.
   */
  private async updateDiscussionComment(commentNodeId: string, body: string, token: string): Promise<void> {
    const mutation = `
      mutation UpdateDiscussionComment($commentId: ID!, $body: String!) {
        updateDiscussionComment(input: { commentId: $commentId, body: $body }) {
          comment { id body }
        }
      }
    `;

    const response = await axios.post<{
      data?: { updateDiscussionComment?: { comment?: { id: string } } };
      errors?: { message: string }[];
    }>(
      'https://api.github.com/graphql',
      { query: mutation, variables: { commentId: commentNodeId, body } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    if (response.data.errors && response.data.errors.length > 0) {
      const messages = response.data.errors.map((e) => e.message).join('; ');
      throw new Error(`updateDiscussionComment GraphQL errors: ${messages}`);
    }
  }

  /**
   * Delete user's rating. Remote comment removal is not implemented;
   * this clears the local copy only.
   * @param resourceType Resource type (always 'bundle' currently).
   * @param resourceId Composite "{sourceId}:{bundleId}".
   */
  public async deleteRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<void> {
    this.ensureInitialized();
    this.logger.warn(`deleteRating called for ${resourceId}; remote comment removal not implemented, clearing local copy only`);
    await this.localBackend.deleteRating(resourceType, resourceId);
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.localBackend.dispose();
    this.discussionMappings.clear();
    this.commentNodeIds.clear();
    this._initialized = false;
  }

  /**
   * Fetch the viewer's own ratings from discussion comments.
   * Searches for discussions the viewer has commented on, parses Rating: lines.
   * Returns resourceId + score pairs ready for hydrateUserRatings.
   * Non-fatal: returns empty array on any error.
   */
  public async fetchViewerRatings(): Promise<{ resourceId: string; score: RatingScore }[]> {
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
        data: { search: { nodes: { number?: number }[] } };
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
      const results: { resourceId: string; score: RatingScore }[] = [];

      for (const disc of discussions) {
        const resourceId = numberToResourceId.get(disc.number!);
        if (!resourceId) {
          continue;
        }

        const comments = await this.fetchDiscussionComments(disc.number!, token);
        const viewerComments = comments.filter(
          (c) => c.author?.login === viewerLogin && c.body.match(/^Rating:\s*⭐/m)
        );
        // Use last (most recent) comment — consistent with findViewerComment
        const viewerComment = viewerComments.length > 0 ? viewerComments.at(-1) : undefined;

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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `fetchViewerRatings failed for ${this.owner}/${this.repo}: ${message}`,
        error instanceof Error ? error : undefined
      );
      return [];
    }
  }

  /**
   * Get aggregated rating statistics
   * Note: This returns cached/computed stats, not live data
   * @param resourceType Resource type to look up.
   * @param resourceId Composite resource id.
   */
  public async getAggregatedRatings(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<RatingStats | undefined> {
    this.ensureInitialized();
    // Aggregated ratings should come from RatingService/RatingCache
    // which fetches from the pre-computed ratings.json
    return this.localBackend.getAggregatedRatings(resourceType, resourceId);
  }

  public async getFeedback(
    resourceType: EngagementResourceType,
    resourceId: string,
    limit?: number
  ): Promise<Feedback[]> {
    this.ensureInitialized();
    return this.localBackend.getFeedback(resourceType, resourceId, limit);
  }

  public async deleteFeedback(feedbackId: string): Promise<void> {
    this.ensureInitialized();
    await this.localBackend.deleteFeedback(feedbackId);
  }

  /**
   * Get user's rating for a resource
   * @param resourceType Resource type to look up.
   * @param resourceId Composite resource id.
   */
  public async getRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<Rating | undefined> {
    this.ensureInitialized();
    return this.localBackend.getRating(resourceType, resourceId);
  }

  /**
   * Get repository owner and name
   */
  public getRepository(): { owner: string; repo: string } {
    this.ensureInitialized();
    return { owner: this.owner, repo: this.repo };
  }

  /**
   * Initialize the backend
   * @param config Backend config (must be of type 'github-discussions').
   */
  public async initialize(config: BackendConfig): Promise<void> {
    if (config.type !== 'github-discussions') {
      throw new Error(`Invalid config type: ${config.type}. Expected 'github-discussions'.`);
    }

    this.config = config;

    const [owner, repo] = this.config.repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${this.config.repository}. Expected 'owner/repo'.`);
    }
    this.owner = owner;
    this.repo = repo;

    await this.localBackend.initialize({
      type: 'file',
      storagePath: this.storagePath
    });

    this._initialized = true;
    this.logger.info(`GitHubDiscussionsBackend initialized for ${this.config.repository}`);
  }

  /**
   * Resolve and cache the discussion category id. Safe to call repeatedly.
   * Throws on unresolved category or auth/network failure — callers should
   * log and continue (voting will fail until next session).
   */
  public async initializeCategory(): Promise<void> {
    await this.ensureCategoryResolved();
  }

  public async submitFeedback(feedback: Feedback): Promise<void> {
    this.ensureInitialized();
    this.logger.debug(`Feedback received for ${feedback.resourceType}/${feedback.resourceId}`);

    // Best-effort remote post; falls back to local-only on any failure.
    try {
      const displayName = this.fallbackDisplayName(feedback.resourceId);
      const mapping = await this.ensureDiscussion(feedback.resourceId, displayName);
      const token = await this.getAccessToken();
      const commentBody = this.formatFeedbackComment(feedback);
      const existing = await this.findViewerComment(mapping.discussionNumber, token);
      if (existing) {
        await this.updateDiscussionComment(existing.nodeId, commentBody, token);
        this.logger.debug(`Updated existing comment with feedback on discussion #${mapping.discussionNumber}`);
      } else {
        const discussionNodeId = await this.getDiscussionNodeId(mapping.discussionNumber, token);
        await this.addDiscussionComment(discussionNodeId, commentBody, token);
        this.logger.debug(`Posted feedback comment on discussion #${mapping.discussionNumber}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to post feedback to GitHub, storing locally: ${(err as Error).message}`);
    }

    await this.localBackend.submitFeedback(feedback);
    this.logger.debug('Feedback saved to local file backend');
  }

  /**
   * Submit a rating via a star comment on the bundle's rating discussion.
   * Lazily creates the discussion on first vote.
   * @param rating Rating to record.
   */
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
      return;
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
}
