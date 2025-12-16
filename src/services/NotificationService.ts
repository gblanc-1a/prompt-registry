/**
 * NotificationService
 * Wraps BundleUpdateNotifications with deduplication logic
 * Purpose: BundleUpdateNotifications has NO built-in deduplication (only preference filtering)
 * This service adds cross-source deduplication to prevent duplicate notifications
 */

import { BundleUpdateNotifications, BundleUpdateNotificationOptions } from '../notifications/BundleUpdateNotifications';
import { UpdateCheckResult } from './UpdateCache';
import { Logger } from '../utils/logger';

/**
 * Notification source type
 */
export type NotificationSource = 'manual' | 'background';

/**
 * Options for showUpdateNotification
 */
export interface NotificationServiceOptions {
    updates: UpdateCheckResult[];
    source: NotificationSource;
    notificationPreference: 'all' | 'critical' | 'none';
}

/**
 * Cache entry for notification deduplication
 */
interface NotificationCacheEntry {
    fingerprint: string;
    timestamp: number;
}

/**
 * Notification service with deduplication
 * Prevents duplicate notifications from manual and background checks
 */
export class NotificationService {
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    private cache: Map<string, NotificationCacheEntry> = new Map();
    private logger: Logger;

    constructor(private bundleNotifications: BundleUpdateNotifications) {
        this.logger = Logger.getInstance();
    }

    /**
     * Show update notification with deduplication
     * Manual checks bypass deduplication CHECK but still update cache
     * Background checks are fully deduplicated
     */
    async showUpdateNotification(options: NotificationServiceOptions): Promise<void> {
        const { updates, source, notificationPreference } = options;

        // Skip if no updates
        if (updates.length === 0) {
            return;
        }

        const fingerprint = this.calculateFingerprint(updates);
        
        // Clean up expired cache entries
        this.cleanupCache();

        // Manual checks bypass deduplication CHECK
        if (source === 'manual') {
            await this.bundleNotifications.showUpdateNotification({
                updates,
                notificationPreference,
            });
            
            // But still update cache to suppress subsequent background checks
            this.cache.set(fingerprint, {
                fingerprint,
                timestamp: Date.now(),
            });
            return;
        }

        // For background checks, check for duplicates
        if (this.isDuplicate(fingerprint)) {
            this.logger.debug(`Suppressing duplicate notification for fingerprint: ${fingerprint}`);
            return;
        }

        // Show notification and cache
        await this.bundleNotifications.showUpdateNotification({
            updates,
            notificationPreference,
        });

        // Add to cache
        this.cache.set(fingerprint, {
            fingerprint,
            timestamp: Date.now(),
        });
    }

    /**
     * Calculate fingerprint for update set
     * Fingerprint = comma-separated list of bundleId@version
     * This allows new versions to show even if old version was dismissed
     */
    private calculateFingerprint(updates: UpdateCheckResult[]): string {
        return updates
            .map(u => `${u.bundleId}@${u.latestVersion}`)
            .sort()
            .join(',');
    }

    /**
     * Check if fingerprint is in cache and not expired
     */
    private isDuplicate(fingerprint: string): boolean {
        const entry = this.cache.get(fingerprint);
        if (!entry) {
            return false;
        }

        const age = Date.now() - entry.timestamp;
        return age < NotificationService.CACHE_TTL_MS;
    }

    /**
     * Remove expired entries from cache
     */
    private cleanupCache(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp >= NotificationService.CACHE_TTL_MS) {
                expiredKeys.push(key);
            }
        }

        for (const key of expiredKeys) {
            this.cache.delete(key);
        }

        if (expiredKeys.length > 0) {
            this.logger.debug(`Cleaned up ${expiredKeys.length} expired notification cache entries`);
        }
    }
}
