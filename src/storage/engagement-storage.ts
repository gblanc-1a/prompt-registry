/**
 * EngagementStorage - File-based persistence for engagement data
 *
 * Storage structure:
 * globalStorage/
 * └── engagement/
 *     ├── ratings.json          # User ratings (incl. unsynced flag for drain retry)
 *     ├── feedback.json         # User feedback
 *     └── pending-feedback.json # Unsynced feedback queued for drain retry
 */

import * as fs from 'node:fs';
import {
  promises as fsp,
} from 'node:fs';
import * as path from 'node:path';
import {
  EngagementResourceType,
  Feedback,
  Rating,
} from '../types/engagement';
import {
  PendingFeedback,
} from '../types/pending-feedback';
import {
  Logger,
} from '../utils/logger';

/**
 * Storage paths for engagement data
 */
interface EngagementStoragePaths {
  root: string;
  ratings: string;
  feedback: string;
  pendingFeedback: string;
}

/**
 * Internal storage format for ratings
 */
interface RatingsStore {
  version: string;
  ratings: Rating[];
}

/**
 * Internal storage format for feedback
 */
interface FeedbackStore {
  version: string;
  feedback: Feedback[];
}

/**
 * Internal storage format for pending feedback
 */
interface PendingFeedbackStore {
  version: string;
  entries: PendingFeedback[];
}

/**
 * EngagementStorage manages file-based persistence for engagement data
 */
export class EngagementStorage {
  private static readonly STORAGE_VERSION = '1.0.0';
  private static readonly MAX_FEEDBACK_ENTRIES = 1000;

  private readonly paths: EngagementStoragePaths;
  private readonly logger = Logger.getInstance();
  private ratingsCache?: RatingsStore;
  private feedbackCache?: FeedbackStore;
  private pendingFeedbackCache?: PendingFeedbackStore;

  constructor(storagePath: string) {
    if (!storagePath || storagePath.trim() === '') {
      throw new Error('Storage path cannot be empty');
    }

    const engagementDir = path.join(storagePath, 'engagement');
    this.paths = {
      root: engagementDir,
      ratings: path.join(engagementDir, 'ratings.json'),
      feedback: path.join(engagementDir, 'feedback.json'),
      pendingFeedback: path.join(engagementDir, 'pending-feedback.json')
    };
  }

  /**
   * Read and parse a JSON store file. Returns `defaultValue` only if the file does not yet exist (ENOENT).
   * Re-throws every other error so a corrupt or unreadable file does not silently turn into an empty
   * store that the next write would overwrite — which would destroy a user's persisted data.
   * @param filePath
   * @param defaultValue
   */
  private async loadJsonOrDefault<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
      const data = await fsp.readFile(filePath, 'utf8');
      return JSON.parse(data) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return defaultValue;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to load ${filePath}: ${message}`);
      throw error;
    }
  }

  private async loadPendingFeedbackStore(): Promise<PendingFeedbackStore> {
    if (this.pendingFeedbackCache) {
      return this.pendingFeedbackCache;
    }
    this.pendingFeedbackCache = await this.loadJsonOrDefault<PendingFeedbackStore>(
      this.paths.pendingFeedback,
      { version: EngagementStorage.STORAGE_VERSION, entries: [] }
    );
    return this.pendingFeedbackCache;
  }

  private async savePendingFeedbackStore(store: PendingFeedbackStore): Promise<void> {
    await this.initialize();
    await fsp.writeFile(this.paths.pendingFeedback, JSON.stringify(store, null, 2), 'utf8');
    this.pendingFeedbackCache = store;
  }

  private async loadRatingsStore(): Promise<RatingsStore> {
    if (this.ratingsCache) {
      return this.ratingsCache;
    }
    this.ratingsCache = await this.loadJsonOrDefault<RatingsStore>(
      this.paths.ratings,
      { version: EngagementStorage.STORAGE_VERSION, ratings: [] }
    );
    return this.ratingsCache;
  }

  private async saveRatingsStore(store: RatingsStore): Promise<void> {
    await this.initialize();
    await fsp.writeFile(this.paths.ratings, JSON.stringify(store, null, 2), 'utf8');
    this.ratingsCache = store;
  }

  private async loadFeedbackStore(): Promise<FeedbackStore> {
    if (this.feedbackCache) {
      return this.feedbackCache;
    }
    this.feedbackCache = await this.loadJsonOrDefault<FeedbackStore>(
      this.paths.feedback,
      { version: EngagementStorage.STORAGE_VERSION, feedback: [] }
    );
    return this.feedbackCache;
  }

  private async saveFeedbackStore(store: FeedbackStore): Promise<void> {
    await this.initialize();
    await fsp.writeFile(this.paths.feedback, JSON.stringify(store, null, 2), 'utf8');
    this.feedbackCache = store;
  }

  /**
   * Initialize storage directories
   */
  public async initialize(): Promise<void> {
    if (!fs.existsSync(this.paths.root)) {
      await fsp.mkdir(this.paths.root, { recursive: true });
    }
  }

  /**
   * Get storage paths
   */
  public getPaths(): EngagementStoragePaths {
    return { ...this.paths };
  }

  // ========================================================================
  // Rating Operations
  // ========================================================================

  /**
   * Save or update a rating
   * @param rating
   */
  public async saveRating(rating: Rating): Promise<void> {
    const store = await this.loadRatingsStore();

    // Find existing rating for same resource
    const existingIndex = store.ratings.findIndex(
      (r) => r.resourceType === rating.resourceType && r.resourceId === rating.resourceId
    );

    if (existingIndex === -1) {
      // Add new
      store.ratings.push(rating);
    } else {
      // Update existing
      store.ratings[existingIndex] = rating;
    }

    await this.saveRatingsStore(store);
  }

  /**
   * Get rating for a specific resource
   * @param resourceType
   * @param resourceId
   */
  public async getRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<Rating | undefined> {
    const store = await this.loadRatingsStore();
    return store.ratings.find(
      (r) => r.resourceType === resourceType && r.resourceId === resourceId
    );
  }

  /**
   * Save multiple ratings in a single write (avoids N disk writes).
   * @param ratings
   */
  public async saveRatings(ratings: Rating[]): Promise<void> {
    if (ratings.length === 0) {
      return;
    }
    const store = await this.loadRatingsStore();
    for (const rating of ratings) {
      const existingIndex = store.ratings.findIndex(
        (r) => r.resourceType === rating.resourceType && r.resourceId === rating.resourceId
      );
      if (existingIndex === -1) {
        store.ratings.push(rating);
      } else {
        store.ratings[existingIndex] = rating;
      }
    }
    await this.saveRatingsStore(store);
  }

  /**
   * Get all ratings
   */
  public async getAllRatings(): Promise<Rating[]> {
    const store = await this.loadRatingsStore();
    return store.ratings;
  }

  /**
   * Delete rating for a resource
   * @param resourceType
   * @param resourceId
   */
  public async deleteRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<void> {
    const store = await this.loadRatingsStore();
    store.ratings = store.ratings.filter(
      (r) => !(r.resourceType === resourceType && r.resourceId === resourceId)
    );
    await this.saveRatingsStore(store);
  }

  /**
   * Return ratings whose remote submission failed and that should be retried.
   * Entries with `synced === false` are pending; older entries (no `synced` field)
   * are treated as already-delivered for backward compatibility.
   */
  public async getUnsyncedRatings(): Promise<Rating[]> {
    const store = await this.loadRatingsStore();
    return store.ratings.filter((r) => r.synced === false);
  }

  /**
   * Mark a rating as successfully submitted to the remote backend.
   * @param id
   */
  public async markRatingSynced(id: string): Promise<void> {
    const store = await this.loadRatingsStore();
    const entry = store.ratings.find((r) => r.id === id);
    if (entry) {
      entry.synced = true;
      await this.saveRatingsStore(store);
    }
  }

  // ========================================================================
  // Feedback Operations
  // ========================================================================

  /**
   * Save feedback
   * @param feedback
   */
  public async saveFeedback(feedback: Feedback): Promise<void> {
    const store = await this.loadFeedbackStore();
    store.feedback.push(feedback);

    // Trim old feedback if exceeding max
    if (store.feedback.length > EngagementStorage.MAX_FEEDBACK_ENTRIES) {
      store.feedback = store.feedback.slice(-EngagementStorage.MAX_FEEDBACK_ENTRIES);
    }

    await this.saveFeedbackStore(store);
  }

  /**
   * Get feedback for a specific resource
   * @param resourceType
   * @param resourceId
   * @param limit
   */
  public async getFeedback(
    resourceType: EngagementResourceType,
    resourceId: string,
    limit?: number
  ): Promise<Feedback[]> {
    const store = await this.loadFeedbackStore();
    let feedback = store.feedback.filter(
      (f) => f.resourceType === resourceType && f.resourceId === resourceId
    );

    // Sort by timestamp descending (most recent first)
    feedback.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (limit && limit > 0) {
      feedback = feedback.slice(0, limit);
    }

    return feedback;
  }

  /**
   * Get all feedback
   */
  public async getAllFeedback(): Promise<Feedback[]> {
    const store = await this.loadFeedbackStore();
    return store.feedback;
  }

  /**
   * Delete feedback by ID
   * @param feedbackId
   */
  public async deleteFeedback(feedbackId: string): Promise<void> {
    const store = await this.loadFeedbackStore();
    store.feedback = store.feedback.filter((f) => f.id !== feedbackId);
    await this.saveFeedbackStore(store);
  }

  // ========================================================================
  // Pending Feedback Operations
  // ========================================================================

  public async savePendingFeedback(entry: PendingFeedback): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    const existingIndex = store.entries.findIndex(
      (e) => e.bundleId === entry.bundleId && e.resourceType === entry.resourceType
    );
    if (existingIndex === -1) {
      store.entries.push(entry);
    } else {
      store.entries[existingIndex] = entry;
    }
    await this.savePendingFeedbackStore(store);
  }

  public async getPendingFeedback(): Promise<PendingFeedback[]> {
    const store = await this.loadPendingFeedbackStore();
    return store.entries;
  }

  public async getUnsyncedFeedback(): Promise<PendingFeedback[]> {
    const store = await this.loadPendingFeedbackStore();
    return store.entries.filter((e) => !e.synced);
  }

  public async markFeedbackSynced(id: string): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    const entry = store.entries.find((e) => e.id === id);
    if (entry) {
      entry.synced = true;
      await this.savePendingFeedbackStore(store);
    }
  }

  public async deletePendingFeedback(id: string): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    store.entries = store.entries.filter((e) => e.id !== id);
    await this.savePendingFeedbackStore(store);
  }

  // ========================================================================
  // Cache Management
  // ========================================================================

  /**
   * Clear all caches
   */
  public clearCache(): void {
    this.ratingsCache = undefined;
    this.feedbackCache = undefined;
    this.pendingFeedbackCache = undefined;
  }

  /**
   * Clear all engagement data
   */
  public async clearAll(): Promise<void> {
    const emptyRatings: RatingsStore = {
      version: EngagementStorage.STORAGE_VERSION,
      ratings: []
    };
    await this.saveRatingsStore(emptyRatings);

    const emptyFeedback: FeedbackStore = {
      version: EngagementStorage.STORAGE_VERSION,
      feedback: []
    };
    await this.saveFeedbackStore(emptyFeedback);

    const emptyPending: PendingFeedbackStore = {
      version: EngagementStorage.STORAGE_VERSION,
      entries: []
    };
    await this.savePendingFeedbackStore(emptyPending);
  }
}
