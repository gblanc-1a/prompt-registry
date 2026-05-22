/**
 * EngagementService - Unified facade for engagement features
 *
 * Responsibilities:
 * - Backend selection based on hub configuration
 * - Event coordination
 * - Singleton pattern for extension-wide access
 */

import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
  EngagementStorage,
} from '../../storage/engagement-storage';
import {
  EngagementResourceType,
  Feedback,
  FileBackendConfig,
  HubEngagementConfig,
  Rating,
  RatingScore,
} from '../../types/engagement';
import {
  PendingFeedback,
} from '../../types/pending-feedback';
import {
  Logger,
} from '../../utils/logger';
import {
  FileBackend,
} from './backends/file-backend';
import {
  GitHubDiscussionsBackend,
} from './backends/github-discussions-backend';
import {
  IEngagementBackend,
} from './engagement-backend';
import {
  RatingCache,
} from './rating-cache';
import {
  RatingService,
} from './rating-service';

/**
 * EngagementService provides a unified interface for ratings and feedback
 */
export class EngagementService {
  private static instance: EngagementService | undefined;
  private defaultBackend?: IEngagementBackend;
  private readonly hubBackends: Map<string, IEngagementBackend> = new Map();
  private readonly logger: Logger;
  private storage?: EngagementStorage;

  // Events
  private readonly _onRatingSubmitted = new vscode.EventEmitter<Rating>();
  private readonly _onFeedbackSubmitted = new vscode.EventEmitter<Feedback>();

  public readonly onRatingSubmitted = this._onRatingSubmitted.event;
  public readonly onFeedbackSubmitted = this._onFeedbackSubmitted.event;

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
  }

  /**
   * Get singleton instance
   * @param context
   */
  public static getInstance(context?: vscode.ExtensionContext): EngagementService {
    if (!EngagementService.instance) {
      if (!context) {
        throw new Error('ExtensionContext required on first call to EngagementService.getInstance()');
      }
      EngagementService.instance = new EngagementService(context);
    }
    return EngagementService.instance;
  }

  /**
   * Reset instance (for testing)
   */
  public static resetInstance(): void {
    if (EngagementService.instance) {
      EngagementService.instance.dispose();
      EngagementService.instance = undefined;
    }
  }

  /**
   * Get backend for a hub (falls back to default)
   * @param hubId
   */
  private getBackend(hubId?: string): IEngagementBackend {
    this.logger.debug(`getBackend called with hubId: "${hubId || 'none'}"`);

    if (hubId) {
      const hubBackend = this.hubBackends.get(hubId);
      if (hubBackend) {
        this.logger.debug(`Using hub backend for: ${hubId}`);
        return hubBackend;
      }
      this.logger.warn(`No hub backend found for: ${hubId}, falling back to default`);
    }

    if (!this.defaultBackend) {
      throw new Error('EngagementService not initialized');
    }
    return this.defaultBackend;
  }

  private requireStorage(): EngagementStorage {
    if (!this.storage) {
      throw new Error('EngagementService not initialized — call initialize() first');
    }
    return this.storage;
  }

  /**
   * Initialize the service with default file backend
   */
  public async initialize(): Promise<void> {
    const storagePath = this.context.globalStorageUri.fsPath;
    const config: FileBackendConfig = {
      type: 'file',
      storagePath
    };

    this.storage = new EngagementStorage(storagePath);
    await this.storage.initialize();

    const fileBackend = new FileBackend();
    fileBackend.setSharedStorage(this.storage);
    await fileBackend.initialize(config);
    this.defaultBackend = fileBackend;

    this.logger.info('EngagementService initialized with file backend');
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this._onRatingSubmitted.dispose();
    this._onFeedbackSubmitted.dispose();

    if (this.defaultBackend) {
      this.defaultBackend.dispose();
    }

    for (const backend of this.hubBackends.values()) {
      backend.dispose();
    }
    this.hubBackends.clear();

    // Reset sub-singletons owned by this service
    RatingCache.resetInstance();
    RatingService.resetInstance();
  }

  /**
   * Check if service is initialized
   */
  public get initialized(): boolean {
    return this.defaultBackend?.initialized ?? false;
  }

  /**
   * Get all persisted ratings from local storage
   */
  public async getAllRatings(): Promise<Rating[]> {
    return this.requireStorage().getAllRatings();
  }

  /**
   * Save multiple ratings to local storage in a single write
   * @param ratings
   */
  public async saveRatings(ratings: Rating[]): Promise<void> {
    await this.requireStorage().saveRatings(ratings);
  }

  /**
   * Save a pending feedback entry to local storage
   * @param entry
   */
  public async savePendingFeedback(entry: PendingFeedback): Promise<void> {
    await this.requireStorage().savePendingFeedback(entry);
  }

  /**
   * Get all unsynced pending feedback entries
   */
  public async getUnsyncedFeedback(): Promise<PendingFeedback[]> {
    return this.requireStorage().getUnsyncedFeedback();
  }

  /**
   * Mark a pending feedback entry as synced
   * @param id
   */
  public async markFeedbackSynced(id: string): Promise<void> {
    await this.requireStorage().markFeedbackSynced(id);
  }

  /**
   * Get ratings whose remote submission failed and that should be retried on next drain.
   */
  public async getUnsyncedRatings(): Promise<Rating[]> {
    return this.requireStorage().getUnsyncedRatings();
  }

  /**
   * Mark a rating as successfully submitted to the remote backend.
   * @param id
   */
  public async markRatingSynced(id: string): Promise<void> {
    await this.requireStorage().markRatingSynced(id);
  }

  // ========================================================================
  // Backend Management
  // ========================================================================

  /**
   * Register a backend for a specific hub
   * @param hubId
   * @param config
   */
  public async registerHubBackend(hubId: string, config: HubEngagementConfig): Promise<void> {
    if (!config.enabled) {
      this.logger.debug(`Engagement disabled for hub ${hubId}`);
      return;
    }

    const storagePath = this.context.globalStorageUri.fsPath;
    let backend: IEngagementBackend;

    // Initialize backend based on type
    if (config.backend.type === 'github-discussions') {
      const ghConfig = config.backend;
      backend = new GitHubDiscussionsBackend(storagePath);
      await backend.initialize(ghConfig);

      // Resolve discussion category once. Non-fatal: backend can still serve
      // reads via local fallback if the category cannot be resolved (transient
      // 5xx, missing category). Voting will fail until next session.
      try {
        await (backend as GitHubDiscussionsBackend).initializeCategory();
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to initialize discussion category for hub ${hubId}: ${(error as Error).message}. Voting will fail until next session.`
        );
      }
    } else {
      // Default to file backend
      if (config.backend.type !== 'file') {
        this.logger.warn(`Backend type '${config.backend.type}' not yet supported, using file backend`);
      }
      const fileConfig: FileBackendConfig = {
        type: 'file',
        storagePath
      };
      backend = new FileBackend();
      await backend.initialize(fileConfig);
    }

    this.hubBackends.set(hubId, backend);
    this.logger.info(`Registered engagement backend for hub: ${hubId} (type: ${config.backend.type})`);
  }

  /**
   * Get the typed backend for a hub.
   * Returns undefined if hub not registered.
   * @param hubId
   */
  public getHubBackend(hubId: string): IEngagementBackend | undefined {
    return this.hubBackends.get(hubId);
  }

  // ========================================================================
  // Rating Operations
  // ========================================================================

  /**
   * Submit a rating
   * @param resourceType
   * @param resourceId
   * @param score
   * @param options
   * @param options.version
   * @param options.hubId
   * @param options.sourceId
   */
  public async submitRating(
    resourceType: EngagementResourceType,
    resourceId: string,
    score: RatingScore,
    options?: {
      version?: string;
      hubId?: string;
      sourceId?: string;
    }
  ): Promise<Rating> {
    const rating: Rating = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      resourceType,
      resourceId,
      score,
      version: options?.version,
      sourceId: options?.sourceId,
      hubId: options?.hubId
    };

    const backend = this.getBackend(options?.hubId);
    await backend.submitRating(rating);

    this._onRatingSubmitted.fire(rating);
    this.logger.info(`Rating submitted: ${score} stars for ${resourceType}/${resourceId}`);

    return rating;
  }

  // ========================================================================
  // Feedback Operations
  // ========================================================================

  /**
   * Submit feedback
   * @param resourceType
   * @param resourceId
   * @param comment
   * @param options
   * @param options.version
   * @param options.rating
   * @param options.hubId
   */
  public async submitFeedback(
    resourceType: EngagementResourceType,
    resourceId: string,
    comment: string,
    options?: {
      version?: string;
      rating?: RatingScore;
      hubId?: string;
    }
  ): Promise<Feedback> {
    const feedback: Feedback = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      resourceType,
      resourceId,
      comment,
      version: options?.version,
      rating: options?.rating
    };

    const backend = this.getBackend(options?.hubId);
    await backend.submitFeedback(feedback);

    this._onFeedbackSubmitted.fire(feedback);
    this.logger.info(`Feedback submitted for ${resourceType}/${resourceId}`);

    return feedback;
  }
}
