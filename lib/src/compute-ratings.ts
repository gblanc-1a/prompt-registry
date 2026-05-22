/* eslint-disable no-console -- CLI script uses console for output */
/**
 * Rating Computation for GitHub Actions
 *
 * Lists discussions in a configured GitHub repo + category, parses each
 * discussion body's metadata block (`source_id`, `bundle_id`), groups
 * discussions by that key, and aggregates star-rating comments into
 * `ratings.json`.
 *
 * Reaction-based voting and per-resource (per-comment) voting are no longer
 * collected. Legacy fields in the output schema (`up`, `down`, `resources`)
 * are zeroed/empty for backward compatibility with consumers.
 */

import * as fs from 'node:fs';
import axios from 'axios';
import {
  parseBundleMetadata,
} from './discussion-body-template';

// ============================================================================
// Types
// ============================================================================

/* eslint-disable @typescript-eslint/naming-convention -- snake_case fields mirror output schema and GitHub API response structures */

/**
 * Resource rating in output. Retained for schema compatibility; this rewrite
 * does not collect per-resource (per-comment) voting, so the `resources` map
 * on `CollectionRating` is always empty.
 */
export interface ResourceRating {
  up: number;
  down: number;
  wilson_score: number;
  bayesian_score: number;
  star_rating: number;
  confidence: string;
}

/**
 * Collection rating in output.
 *
 * `up`/`down` are kept at 0 because reaction-based voting is no longer
 * collected. `discussion_number` is optional and, when multiple discussions
 * map to the same `(source_id, bundle_id)` key, holds the lowest discussion
 * number in the group. `resources` is always `{}` because per-resource voting
 * is not collected by this rewrite.
 */
export interface CollectionRating {
  source_id?: string;
  discussion_number?: number;
  up: number;
  down: number;
  wilson_score: number;
  bayesian_score: number;
  aggregated_score: number;
  star_rating: number;
  rating_count: number;
  confidence: string;
  resources: Record<string, ResourceRating>;
}

/**
 * Output ratings.json structure
 */
export interface RatingsOutput {
  generated_at: string;
  repository: string;
  collections: Record<string, CollectionRating>;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Rating metrics calculation result
 */
interface RatingMetrics {
  wilsonScore: number;
  bayesianScore: number;
  starRating: number;
  confidence: string;
}

// ============================================================================
// Rating Algorithms (inline to avoid circular dependencies)
// ============================================================================

/**
 * Calculate Wilson score lower bound (95% confidence)
 * @param upvotes
 * @param downvotes
 */
function wilsonLowerBound(upvotes: number, downvotes: number): number {
  const n = upvotes + downvotes;
  if (n === 0) {
    return 0;
  }

  const z = 1.96; // 95% confidence
  const phat = upvotes / n;

  return (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

/**
 * Calculate Bayesian smoothed rating
 * @param upvotes
 * @param downvotes
 * @param priorMean
 * @param priorWeight
 */
function bayesianSmoothing(upvotes: number, downvotes: number, priorMean = 3.5, priorWeight = 10): number {
  const totalVotes = upvotes + downvotes;
  const observedMean = totalVotes > 0 ? (upvotes / totalVotes) * 5 : priorMean;

  return (observedMean * totalVotes + priorMean * priorWeight) / (totalVotes + priorWeight);
}

/**
 * Get confidence level based on vote count
 * @param voteCount
 */
function getConfidenceLevel(voteCount: number): string {
  if (voteCount >= 100) {
    return 'very_high';
  } else if (voteCount >= 20) {
    return 'high';
  } else if (voteCount >= 5) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Parse star rating from a feedback comment body
 * Supports both old and new formats:
 * - New: "Rating: ⭐⭐⭐⭐⭐"
 * - Old: "**Feedback** (N ⭐⭐⭐⭐⭐)"
 * @param commentBody The comment body text
 * @returns The star rating (1-5) or null if not found
 */
export function parseStarRatingFromComment(commentBody: string): number | null {
  // New format: Rating: ⭐⭐⭐⭐⭐
  const newFormatMatch = commentBody.match(/Rating:\s*(⭐+)/);
  if (newFormatMatch) {
    const starCount = newFormatMatch[1].length;
    if (starCount >= 1 && starCount <= 5) {
      return starCount;
    }
  }

  // Old format: **Feedback** (N ⭐⭐⭐⭐⭐)
  const oldFormatMatch = commentBody.match(/\*\*Feedback\*\*\s*\((\d)\s*⭐/);
  if (oldFormatMatch) {
    const rating = Number.parseInt(oldFormatMatch[1], 10);
    if (rating >= 1 && rating <= 5) {
      return rating;
    }
  }

  // Fallback: N ⭐... at start of line
  const fallbackMatch = commentBody.match(/^(\d)\s*⭐/m);
  if (fallbackMatch) {
    const rating = Number.parseInt(fallbackMatch[1], 10);
    if (rating >= 1 && rating <= 5) {
      return rating;
    }
  }

  return null;
}

/**
 * Result of computing average star rating
 */
export interface AverageStarRatingResult {
  average: number;
  count: number;
  confidence: string;
}

/**
 * Deduplicate ratings by user, keeping only the most recent rating from each user
 * This follows industry standard practice (Amazon, App Store, etc.)
 * @param comments Array of discussion comments with author and timestamp
 * @returns Array of star ratings with duplicates removed (one per user)
 */
export function deduplicateRatingsByUser(comments: DiscussionComment[]): number[] {
  // Map to store the most recent rating for each user
  const userRatings = new Map<string, { rating: number; createdAt: string }>();

  for (const comment of comments) {
    const rating = parseStarRatingFromComment(comment.body);
    if (rating === null) {
      continue; // Skip non-rating comments
    }

    const author = comment.author?.login;
    if (!author) {
      // Anonymous or deleted user - still count the rating
      // Use a unique key based on timestamp to avoid collision
      const anonymousKey = `anonymous_${comment.createdAt}`;
      userRatings.set(anonymousKey, { rating, createdAt: comment.createdAt });
      continue;
    }

    // Check if we already have a rating from this user
    const existing = userRatings.get(author);
    if (!existing || comment.createdAt > existing.createdAt) {
      // This is either the first rating from this user, or a more recent one
      userRatings.set(author, { rating, createdAt: comment.createdAt });
    }
  }

  // Extract just the ratings
  return Array.from(userRatings.values()).map((entry) => entry.rating);
}

/**
 * Compute average star rating from an array of individual ratings
 * @param ratings Array of star ratings (1-5)
 * @returns Average rating, count, and confidence level
 */
export function computeAverageStarRating(ratings: number[]): AverageStarRatingResult {
  if (ratings.length === 0) {
    return {
      average: 0,
      count: 0,
      confidence: 'low'
    };
  }

  const sum = ratings.reduce((acc, r) => acc + r, 0);
  const average = Math.round((sum / ratings.length) * 10) / 10; // Round to 1 decimal
  const confidence = getConfidenceLevel(ratings.length);

  return {
    average,
    count: ratings.length,
    confidence
  };
}

/**
 * Calculate all rating metrics
 * @param upvotes
 * @param downvotes
 */
function calculateRatingMetrics(upvotes: number, downvotes: number): RatingMetrics {
  const wilsonScore = wilsonLowerBound(upvotes, downvotes);
  const bayesianScore = bayesianSmoothing(upvotes, downvotes);
  const starRating = Math.round(bayesianScore * 10) / 10;
  const confidence = getConfidenceLevel(upvotes + downvotes);

  return {
    wilsonScore,
    bayesianScore,
    starRating,
    confidence
  };
}

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * Rate limit tracking
 */
const rateLimitState = { remaining: 5000, resetAt: 0 };

/**
 * Check and log rate limit status
 * @param headers
 */
function updateRateLimit(headers: Record<string, string>): void {
  if (headers['x-ratelimit-remaining']) {
    rateLimitState.remaining = Number.parseInt(headers['x-ratelimit-remaining'], 10);
  }
  if (headers['x-ratelimit-reset']) {
    rateLimitState.resetAt = Number.parseInt(headers['x-ratelimit-reset'], 10);
  }
}

/**
 * Get current rate limit status
 */
function getRateLimitStatus(): { remaining: number; resetAt: number } {
  return { remaining: rateLimitState.remaining, resetAt: rateLimitState.resetAt };
}

/**
 * Discussion comment structure from GraphQL
 */
interface DiscussionComment {
  body: string;
  author?: {
    login: string;
  };
  createdAt: string;
}

/**
 * Fetch all comments from a discussion using GraphQL with pagination
 * These comments contain the star ratings in the format "**Feedback** (N ⭐...)"
 * @param owner
 * @param repo
 * @param discussionNumber
 * @param token
 */
async function fetchDiscussionComments(
    owner: string,
    repo: string,
    discussionNumber: number,
    token: string
): Promise<DiscussionComment[]> {
  const allComments: DiscussionComment[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const query = `
            query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
                repository(owner: $owner, name: $repo) {
                    discussion(number: $number) {
                        comments(first: 100, after: $cursor) {
                            nodes {
                                body
                                author {
                                    login
                                }
                                createdAt
                            }
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                        }
                    }
                }
            }
        `;

    try {
      interface CommentsResponse {
        data?: {
          repository?: {
            discussion?: {
              comments?: {
                nodes: DiscussionComment[];
                pageInfo: {
                  hasNextPage: boolean;
                  endCursor: string | null;
                };
              };
            };
          };
        };
      }

      const response: { data: CommentsResponse; headers: Record<string, string> } = await axios.post(
        'https://api.github.com/graphql',
        {
          query,
          variables: { owner, repo, number: discussionNumber, cursor }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      updateRateLimit(response.headers);

      const discussionData = response.data?.data?.repository?.discussion;
      if (!discussionData) {
        console.warn(`Discussion #${discussionNumber} not found`);
        break;
      }

      const comments = discussionData.comments?.nodes || [];
      allComments.push(...comments);

      hasNextPage = discussionData.comments?.pageInfo?.hasNextPage || false;
      cursor = discussionData.comments?.pageInfo?.endCursor || null;

      // Safety limit
      if (allComments.length > 1000) {
        console.warn(`Comment limit reached for discussion #${discussionNumber}`);
        break;
      }
    } catch (error: unknown) {
      console.warn(`Error fetching comments for discussion #${discussionNumber}: ${(error as Error).message}`);
      break;
    }
  }

  return allComments;
}

// ============================================================================
// Rating Computation
// ============================================================================

/**
 * Compute ratings for a single resource. Retained as an exported helper for
 * tests and external math callers; not used by the new aggregation flow.
 * @param up
 * @param down
 */
export function computeResourceRating(up: number, down: number): ResourceRating {
  const metrics = calculateRatingMetrics(up, down);
  return {
    up,
    down,
    wilson_score: Math.round(metrics.wilsonScore * 1000) / 1000,
    bayesian_score: Math.round(metrics.bayesianScore * 1000) / 1000,
    star_rating: metrics.starRating,
    confidence: metrics.confidence
  };
}

/**
 * Discussion node returned by listDiscussionsInCategory.
 */
export interface DiscussionNode {
  number: number;
  title: string;
  body: string;
}

/**
 * Inputs for the rewritten computeRatings entrypoint.
 */
export interface ComputeRatingsInput {
  /** Repository in `owner/repo` form. */
  repo: string;
  /** Discussion category name to scan (e.g., "Bundle Ratings"). */
  category: string;
  /** Path to write ratings.json. */
  outputPath: string;
  /** GitHub token. */
  token: string;
}

/**
 * Resolve discussion category id, then list every discussion in it via
 * paginated GraphQL.
 * @param owner Repo owner.
 * @param repo Repo name.
 * @param categoryName Discussion category name.
 * @param token GitHub token.
 */
export async function listDiscussionsInCategory(
  owner: string,
  repo: string,
  categoryName: string,
  token: string
): Promise<DiscussionNode[]> {
  // Step 1: resolve category id.
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
  updateRateLimit(catResp.headers as Record<string, string>);
  const catData = catResp.data as {
    data?: { repository?: { discussionCategories?: { nodes: { id: string; name: string }[] } } };
    errors?: { message: string }[];
  };
  if (catData.errors?.length) {
    throw new Error(`category resolution: ${catData.errors.map((e) => e.message).join('; ')}`);
  }
  const cats = catData.data?.repository?.discussionCategories?.nodes ?? [];
  const cat = cats.find((c) => c.name === categoryName);
  if (!cat) {
    throw new Error(`Category "${categoryName}" not found in ${owner}/${repo}`);
  }

  // Step 2: paginate discussions in category.
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
    updateRateLimit(resp.headers as Record<string, string>);
    const data = resp.data as {
      data?: {
        repository?: {
          discussions?: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            nodes: DiscussionNode[];
          };
        };
      };
      errors?: { message: string }[];
    };
    if (data.errors?.length) {
      throw new Error(`listDiscussionsInCategory: ${data.errors.map((e) => e.message).join('; ')}`);
    }
    const page = data.data?.repository?.discussions;
    out.push(...(page?.nodes ?? []));
    if (!page?.pageInfo.hasNextPage) {
      break;
    }
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

/**
 * Compute ratings.json from discussions in the configured repo + category.
 *
 * Aggregates by (source_id, bundle_id) parsed from each discussion body's
 * metadata block. Discussions sharing the same key (race or post-rename)
 * have their star comments unioned. Reaction-based voting and per-resource
 * voting are not collected; legacy fields in the output are zeroed.
 * @param input Repo, category, output path, token.
 */
export async function computeRatings(input: ComputeRatingsInput): Promise<void> {
  const [owner, repo] = input.repo.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repo format. Expected "owner/repo".');
  }

  console.log(`Computing ratings from ${input.repo} category "${input.category}"`);

  const discussions = await listDiscussionsInCategory(owner, repo, input.category, input.token);
  console.log(`Found ${discussions.length} discussions in category`);

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

  const collections: Record<string, CollectionRating> = {};

  for (const [key, ds] of grouped) {
    // Fetch comments for every discussion in the group, in series to keep
    // rate-limit pressure predictable. Could parallelize later if needed.
    const allComments: DiscussionComment[] = [];
    for (const d of ds) {
      const cs = await fetchDiscussionComments(owner, repo, d.number, input.token);
      allComments.push(...cs);
    }
    const starRatings = deduplicateRatingsByUser(allComments);
    if (starRatings.length === 0) {
      continue;
    }
    const avg = computeAverageStarRating(starRatings);
    const wilson = (avg.average - 1) / 4;
    const sourceId = key.split(':')[0];
    const minDiscussionNumber = ds.reduce((m, d) => Math.min(m, d.number), Number.POSITIVE_INFINITY);

    collections[key] = {
      source_id: sourceId,
      discussion_number: Number.isFinite(minDiscussionNumber) ? minDiscussionNumber : undefined,
      up: 0,
      down: 0,
      wilson_score: Math.round(wilson * 1000) / 1000,
      bayesian_score: Math.round(avg.average * 1000) / 1000,
      aggregated_score: Math.round(avg.average * 1000) / 1000,
      star_rating: avg.average,
      rating_count: avg.count,
      confidence: avg.confidence,
      resources: {}
    };
  }

  const output: RatingsOutput = {

    generated_at: new Date().toISOString(),

    repository: input.repo,
    collections
  };

  fs.writeFileSync(input.outputPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${Object.keys(collections).length} ratings to ${input.outputPath}`);

  const currentLimit = getRateLimitStatus();
  if (currentLimit.remaining < 100) {
    console.warn(`⚠️  Rate limit low: ${currentLimit.remaining} requests remaining`);
  }
}
