"use strict";
/**
 * Rating Computation for GitHub Actions
 *
 * Fetches reaction counts from GitHub Discussions and computes ratings
 * using Wilson score algorithm. Outputs ratings.json for static hosting.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStarRatingFromComment = parseStarRatingFromComment;
exports.deduplicateRatingsByUser = deduplicateRatingsByUser;
exports.computeAverageStarRating = computeAverageStarRating;
exports.computeResourceRating = computeResourceRating;
exports.parseArgs = parseArgs;
exports.computeRatings = computeRatings;
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
const axios_1 = __importDefault(require("axios"));
// ============================================================================
// Rating Algorithms (inline to avoid circular dependencies)
// ============================================================================
/**
 * Calculate Wilson score lower bound (95% confidence)
 */
function wilsonLowerBound(upvotes, downvotes) {
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
 */
function bayesianSmoothing(upvotes, downvotes, priorMean = 3.5, priorWeight = 10) {
    const totalVotes = upvotes + downvotes;
    const observedMean = totalVotes > 0 ? (upvotes / totalVotes) * 5 : priorMean;
    return (observedMean * totalVotes + priorMean * priorWeight) / (totalVotes + priorWeight);
}
/**
 * Get confidence level based on vote count
 */
function getConfidenceLevel(voteCount) {
    if (voteCount >= 100) {
        return 'very_high';
    }
    else if (voteCount >= 20) {
        return 'high';
    }
    else if (voteCount >= 5) {
        return 'medium';
    }
    else {
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
function parseStarRatingFromComment(commentBody) {
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
        const rating = parseInt(oldFormatMatch[1], 10);
        if (rating >= 1 && rating <= 5) {
            return rating;
        }
    }
    // Fallback: N ⭐... at start of line
    const fallbackMatch = commentBody.match(/^(\d)\s*⭐/m);
    if (fallbackMatch) {
        const rating = parseInt(fallbackMatch[1], 10);
        if (rating >= 1 && rating <= 5) {
            return rating;
        }
    }
    return null;
}
/**
 * Deduplicate ratings by user, keeping only the most recent rating from each user
 * This follows industry standard practice (Amazon, App Store, etc.)
 * @param comments Array of discussion comments with author and timestamp
 * @returns Array of star ratings with duplicates removed (one per user)
 */
function deduplicateRatingsByUser(comments) {
    // Map to store the most recent rating for each user
    const userRatings = new Map();
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
    return Array.from(userRatings.values()).map(entry => entry.rating);
}
/**
 * Compute average star rating from an array of individual ratings
 * @param ratings Array of star ratings (1-5)
 * @returns Average rating, count, and confidence level
 */
function computeAverageStarRating(ratings) {
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
 */
function calculateRatingMetrics(upvotes, downvotes) {
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
/**
 * Aggregate resource scores into collection score
 */
function aggregateResourceScores(resources) {
    if (resources.length === 0) {
        return 0;
    }
    const totalVotes = resources.reduce((sum, r) => sum + r.voteCount, 0);
    if (totalVotes === 0) {
        return 0;
    }
    return resources.reduce((sum, r) => sum + r.score * r.voteCount, 0) / totalVotes;
}
// ============================================================================
// GitHub API Functions
// ============================================================================
/**
 * Rate limit tracking
 */
let rateLimitRemaining = 5000;
let rateLimitReset = 0;
/**
 * Check and log rate limit status
 */
function updateRateLimit(headers) {
    if (headers['x-ratelimit-remaining']) {
        rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
    }
    if (headers['x-ratelimit-reset']) {
        rateLimitReset = parseInt(headers['x-ratelimit-reset'], 10);
    }
}
/**
 * Get current rate limit status
 */
function getRateLimitStatus() {
    return { remaining: rateLimitRemaining, resetAt: rateLimitReset };
}
/**
 * Fetch all reactions with pagination support
 * GitHub API returns max 100 items per page
 */
async function fetchAllReactions(url, token) {
    const allReactions = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const response = await axios_1.default.get(`${url}?per_page=${perPage}&page=${page}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        // Update rate limit tracking
        updateRateLimit(response.headers);
        const reactions = response.data;
        allReactions.push(...reactions);
        // If we got fewer than perPage results, we've reached the end
        if (reactions.length < perPage) {
            break;
        }
        page++;
        // Safety limit to prevent infinite loops
        if (page > 100) {
            console.warn(`Pagination limit reached for ${url}`);
            break;
        }
    }
    return allReactions;
}
/**
 * Fetch discussion node ID using GraphQL (required for REST API access)
 */
async function fetchDiscussionNodeId(owner, repo, discussionNumber, token) {
    const query = `
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                discussion(number: $number) {
                    id
                }
            }
        }
    `;
    try {
        const response = await axios_1.default.post('https://api.github.com/graphql', {
            query,
            variables: { owner, repo, number: discussionNumber }
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        updateRateLimit(response.headers);
        return response.data?.data?.repository?.discussion?.id || null;
    }
    catch (error) {
        console.warn(`Failed to fetch discussion #${discussionNumber}: ${error.message}`);
        return null;
    }
}
/**
 * Fetch discussion reactions using GraphQL (more reliable than REST)
 */
async function fetchDiscussionReactions(owner, repo, discussionNumber, token) {
    const query = `
        query($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
                discussion(number: $number) {
                    reactions(first: 100) {
                        nodes {
                            content
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
        const response = await axios_1.default.post('https://api.github.com/graphql', {
            query,
            variables: { owner, repo, number: discussionNumber }
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        updateRateLimit(response.headers);
        const discussion = response.data?.data?.repository?.discussion;
        if (!discussion) {
            console.warn(`Discussion #${discussionNumber} not found, using zero counts`);
            return { '+1': 0, '-1': 0 };
        }
        // Count reactions by type
        const counts = { '+1': 0, '-1': 0 };
        const reactions = discussion.reactions?.nodes || [];
        for (const reaction of reactions) {
            const content = reaction.content;
            if (content === 'THUMBS_UP') {
                counts['+1']++;
            }
            else if (content === 'THUMBS_DOWN') {
                counts['-1']++;
            }
        }
        return counts;
    }
    catch (error) {
        console.warn(`Error fetching discussion #${discussionNumber}: ${error.message}`);
        return { '+1': 0, '-1': 0 };
    }
}
/**
 * Fetch reactions for a comment (resource-level voting, with pagination)
 */
async function fetchCommentReactions(owner, repo, commentId, token) {
    const url = `https://api.github.com/repos/${owner}/${repo}/discussions/comments/${commentId}/reactions`;
    try {
        const reactions = await fetchAllReactions(url, token);
        const counts = { '+1': 0, '-1': 0 };
        for (const reaction of reactions) {
            const content = reaction.content;
            counts[content] = (counts[content] || 0) + 1;
        }
        return counts;
    }
    catch (error) {
        if (error.response?.status === 404) {
            console.warn(`Comment #${commentId} not found, using zero counts`);
            return { '+1': 0, '-1': 0 };
        }
        throw new Error(`GitHub API error: ${error.response?.status || 'unknown'} ${error.message}`);
    }
}
/**
 * Fetch all comments from a discussion using GraphQL with pagination
 * These comments contain the star ratings in the format "**Feedback** (N ⭐...)"
 */
async function fetchDiscussionComments(owner, repo, discussionNumber, token) {
    const allComments = [];
    let hasNextPage = true;
    let cursor = null;
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
            const response = await axios_1.default.post('https://api.github.com/graphql', {
                query,
                variables: { owner, repo, number: discussionNumber, cursor }
            }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
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
        }
        catch (error) {
            console.warn(`Error fetching comments for discussion #${discussionNumber}: ${error.message}`);
            break;
        }
    }
    return allComments;
}
// ============================================================================
// Rating Computation
// ============================================================================
/**
 * Compute ratings for a single resource
 */
function computeResourceRating(up, down) {
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
 * Compute ratings for a collection including all resources
 *
 * Rating sources (in priority order):
 * 1. Star ratings from feedback comments (new system: "**Feedback** (N ⭐...)")
 * 2. Thumbs up/down reactions on the discussion (legacy fallback)
 */
async function computeCollectionRating(collection, owner, repo, token) {
    console.log(`  Processing collection: ${collection.id}`);
    // Fetch discussion comments to extract star ratings
    const comments = await fetchDiscussionComments(owner, repo, collection.discussion_number, token);
    // Deduplicate ratings by user (keep only most recent rating per user)
    // This follows industry standard practice (Amazon, App Store, etc.)
    const starRatings = deduplicateRatingsByUser(comments);
    // Also fetch discussion-level reactions as fallback/supplement
    const discussionReactions = await fetchDiscussionReactions(owner, repo, collection.discussion_number, token);
    const collectionUp = discussionReactions['+1'];
    const collectionDown = discussionReactions['-1'];
    // Compute rating based on star ratings if available, otherwise use reactions
    let starRating;
    let confidence;
    let wilsonScore;
    let bayesianScore;
    if (starRatings.length > 0) {
        // Use star ratings from comments (new system)
        const avgResult = computeAverageStarRating(starRatings);
        starRating = avgResult.average;
        confidence = avgResult.confidence;
        // Convert star rating to wilson-like score (0-1 scale)
        wilsonScore = (starRating - 1) / 4; // Maps 1-5 to 0-1
        bayesianScore = starRating;
        console.log(`    Found ${starRatings.length} star ratings, average: ${starRating}`);
    }
    else {
        // Fallback to reaction-based rating (legacy system)
        const collectionMetrics = calculateRatingMetrics(collectionUp, collectionDown);
        starRating = collectionMetrics.starRating;
        confidence = collectionMetrics.confidence;
        wilsonScore = collectionMetrics.wilsonScore;
        bayesianScore = collectionMetrics.bayesianScore;
        console.log(`    No star ratings found, using reactions: ${collectionUp} up, ${collectionDown} down`);
    }
    // Process resources (still using reactions for now)
    const resources = {};
    const resourceScores = [];
    if (collection.resources && collection.resources.length > 0) {
        for (const resource of collection.resources) {
            if (resource.comment_id) {
                const reactions = await fetchCommentReactions(owner, repo, resource.comment_id, token);
                const rating = computeResourceRating(reactions['+1'], reactions['-1']);
                resources[resource.id] = rating;
                resourceScores.push({
                    score: rating.wilson_score,
                    voteCount: rating.up + rating.down
                });
            }
        }
    }
    // Compute aggregated score from resources (if any)
    let aggregatedScore = wilsonScore;
    if (resourceScores.length > 0) {
        const resourceAggregated = aggregateResourceScores(resourceScores);
        // Blend collection-level and resource-level scores (70/30 split)
        aggregatedScore = 0.7 * wilsonScore + 0.3 * resourceAggregated;
    }
    return {
        source_id: collection.source_id,
        discussion_number: collection.discussion_number,
        up: collectionUp,
        down: collectionDown,
        wilson_score: Math.round(wilsonScore * 1000) / 1000,
        bayesian_score: Math.round(bayesianScore * 1000) / 1000,
        aggregated_score: Math.round(aggregatedScore * 1000) / 1000,
        star_rating: starRating,
        confidence,
        resources
    };
}
// ============================================================================
// Main Script
// ============================================================================
/**
 * Parse command line arguments
 */
function parseArgs(args) {
    let configPath = 'collections.yaml';
    let outputPath = 'ratings.json';
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        // Handle --config=value format
        if (arg.startsWith('--config=')) {
            configPath = arg.substring('--config='.length);
        }
        // Handle --config value format
        else if (arg === '--config' && args[i + 1]) {
            configPath = args[i + 1];
            i++;
        }
        // Handle --output=value format
        else if (arg.startsWith('--output=')) {
            outputPath = arg.substring('--output='.length);
        }
        // Handle --output value format
        else if (arg === '--output' && args[i + 1]) {
            outputPath = args[i + 1];
            i++;
        }
    }
    return { configPath, outputPath };
}
/**
 * Main entry point
 */
async function computeRatings(configPath, outputPath, token) {
    // Load collections config
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent);
    if (!config.repository || !config.collections) {
        throw new Error('Invalid config file. Must have "repository" and "collections" fields.');
    }
    const [owner, repo] = config.repository.split('/');
    if (!owner || !repo) {
        throw new Error('Invalid repository format. Expected "owner/repo".');
    }
    console.log(`Computing ratings for ${config.repository}`);
    console.log(`Processing ${config.collections.length} collections...`);
    // Determine concurrency based on rate limit
    const rateLimit = getRateLimitStatus();
    let concurrency = 10; // Default
    if (rateLimit.remaining < 1000) {
        concurrency = 3;
        console.log(`Low rate limit (${rateLimit.remaining} remaining), using concurrency: ${concurrency}`);
    }
    else if (rateLimit.remaining < 2000) {
        concurrency = 5;
        console.log(`Medium rate limit (${rateLimit.remaining} remaining), using concurrency: ${concurrency}`);
    }
    else {
        console.log(`Good rate limit (${rateLimit.remaining} remaining), using concurrency: ${concurrency}`);
    }
    // Process collections concurrently in batches
    const collections = {};
    const batches = [];
    for (let i = 0; i < config.collections.length; i += concurrency) {
        batches.push(config.collections.slice(i, i + concurrency));
    }
    for (const batch of batches) {
        const promises = batch.map(async (collection) => {
            try {
                return {
                    id: collection.id,
                    rating: await computeCollectionRating(collection, owner, repo, token)
                };
            }
            catch (error) {
                console.error(`  Error processing ${collection.id}:`, error);
                return null;
            }
        });
        const results = await Promise.all(promises);
        for (const result of results) {
            if (result) {
                collections[result.id] = result.rating;
            }
        }
        // Log rate limit status after each batch
        const currentLimit = getRateLimitStatus();
        if (currentLimit.remaining < 100) {
            console.warn(`⚠️  Rate limit low: ${currentLimit.remaining} requests remaining`);
        }
    }
    // Generate output
    const output = {
        generated_at: new Date().toISOString(),
        repository: config.repository,
        collections
    };
    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nRatings written to: ${outputPath}`);
    // Summary
    const totalCollections = Object.keys(collections).length;
    const totalResources = Object.values(collections).reduce((sum, c) => sum + Object.keys(c.resources).length, 0);
    console.log(`Summary: ${totalCollections} collections, ${totalResources} resources`);
}
// ============================================================================
// CLI Entry Point
// ============================================================================
/**
 * Main CLI entry point - runs when script is executed directly
 */
if (require.main === module) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('Error: GITHUB_TOKEN environment variable is required');
        console.error('Usage: GITHUB_TOKEN=<token> node compute-ratings.js [--config <path>] [--output <path>]');
        process.exit(1);
    }
    const args = parseArgs(process.argv.slice(2));
    computeRatings(args.configPath, args.outputPath, token)
        .then(() => {
        console.log('✓ Rating computation completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('✗ Rating computation failed:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    });
}
//# sourceMappingURL=compute-ratings.js.map