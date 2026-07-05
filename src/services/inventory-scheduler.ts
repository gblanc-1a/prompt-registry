/**
 * Inventory Scheduler Service
 * Periodically captures a snapshot of the installed bundle inventory
 * (total count, broken down by scope and source type) for KPI reporting.
 */

import * as vscode from 'vscode';
import {
  InstallationScope,
} from '../types/registry';
import {
  Logger,
} from '../utils/logger';
import {
  RegistryManager,
} from './registry-manager';
import {
  TelemetryService,
} from './telemetry-service';

const SCHEDULER_CONSTANTS = {
  STARTUP_DELAY_MS: 5000, // 5 seconds after activation, mirroring UpdateScheduler
  SNAPSHOT_INTERVAL_MS: 24 * 60 * 60 * 1000 // 24 hours
} as const;

/**
 * Schedules a startup snapshot and periodic (daily) snapshots of the installed
 * bundle inventory. Follows the HubSyncScheduler/UpdateScheduler pattern:
 * setTimeout re-scheduling with an overlap guard and test-environment detection.
 */
export class InventoryScheduler {
  private readonly logger: Logger;
  private startupSnapshotTimer?: NodeJS.Timeout;
  private scheduledSnapshotTimer?: NodeJS.Timeout;
  private isSnapshotInProgress = false;
  private isInitialized = false;
  private readonly isTestEnvironment: boolean;

  constructor(
    context: vscode.ExtensionContext,
    private readonly registryManager: RegistryManager,
    private readonly telemetryService: TelemetryService
  ) {
    this.logger = Logger.getInstance();

    // Test environment detection — same pattern as UpdateScheduler/HubSyncScheduler.
    // Node.js timers keep the process alive, causing test runners to hang.
    const isNodeTestEnvironment =
      process.env.NODE_ENV === 'test'
      || process.argv.some((arg) => arg.includes('mocha'))
      || process.argv.some((arg) => arg.includes('test'));
    const allowTimersOverride = process.env.INVENTORY_SCHEDULER_ALLOW_TIMERS_IN_TESTS === 'true';
    this.isTestEnvironment = isNodeTestEnvironment && !allowTimersOverride;

    // Register for automatic disposal when extension deactivates
    if (context?.subscriptions) {
      context.subscriptions.push({
        dispose: () => this.dispose()
      });
    }
  }

  /**
   * Capture a single inventory snapshot and forward it to telemetry.
   * Never throws — telemetry must not break activation or scheduling.
   */
  private async captureSnapshot(): Promise<void> {
    try {
      const bundles = await this.registryManager.listInstalledBundles();

      const byScope: Record<InstallationScope, number> = {
        user: 0,
        workspace: 0,
        repository: 0
      };
      const bySourceType: Record<string, number> = {};

      for (const bundle of bundles) {
        if (byScope[bundle.scope] !== undefined) {
          byScope[bundle.scope] += 1;
        }
        const sourceType = bundle.sourceType ?? 'unknown';
        bySourceType[sourceType] = (bySourceType[sourceType] ?? 0) + 1;
      }

      this.telemetryService.trackInventorySnapshot({
        total: bundles.length,
        byScope,
        bySourceType
      });
      this.logger.debug(`Inventory snapshot captured: ${bundles.length} installed bundles`);
    } catch (error) {
      this.logger.error('Failed to capture inventory snapshot', error as Error);
    }
  }

  /**
   * Schedule the startup snapshot shortly after activation.
   */
  private scheduleStartupSnapshot(): void {
    this.logger.debug(`Scheduling startup inventory snapshot in ${SCHEDULER_CONSTANTS.STARTUP_DELAY_MS}ms`);

    this.startupSnapshotTimer = setTimeout(async () => {
      try {
        await this.captureSnapshot();
      } finally {
        this.startupSnapshotTimer = undefined;
      }
    }, SCHEDULER_CONSTANTS.STARTUP_DELAY_MS);
  }

  /**
   * Schedule the next periodic snapshot using setTimeout with re-scheduling.
   */
  private schedulePeriodicSnapshot(): void {
    if (this.isTestEnvironment) {
      this.logger.debug('Test environment detected, skipping periodic snapshot timers');
      return;
    }

    // Clear existing timer
    if (this.scheduledSnapshotTimer) {
      clearTimeout(this.scheduledSnapshotTimer);
      this.scheduledSnapshotTimer = undefined;
    }

    const intervalMs = SCHEDULER_CONSTANTS.SNAPSHOT_INTERVAL_MS;
    this.logger.debug(`Scheduling periodic inventory snapshot in ${intervalMs}ms`);

    this.scheduledSnapshotTimer = setTimeout(async () => {
      if (this.isSnapshotInProgress) {
        this.logger.warn('Previous inventory snapshot still in progress, skipping this cycle');
        this.schedulePeriodicSnapshot();
        return;
      }

      this.isSnapshotInProgress = true;
      try {
        this.logger.info('Performing scheduled inventory snapshot');
        await this.captureSnapshot();
      } finally {
        this.isSnapshotInProgress = false;
        this.schedulePeriodicSnapshot();
      }
    }, intervalMs);
  }

  /**
   * Start the startup and periodic snapshot timers.
   */
  public initialize(): void {
    if (this.isInitialized) {
      this.logger.debug('InventoryScheduler already initialized');
      return;
    }

    this.logger.info('Initializing InventoryScheduler');

    if (this.isTestEnvironment) {
      this.logger.debug('Test environment detected, skipping inventory snapshot timers');
    } else {
      this.scheduleStartupSnapshot();
      this.schedulePeriodicSnapshot();
    }

    this.isInitialized = true;
    this.logger.info('InventoryScheduler initialized successfully');
  }

  /**
   * Cleanup timers.
   */
  public dispose(): void {
    this.logger.debug('Disposing InventoryScheduler');

    if (this.startupSnapshotTimer) {
      clearTimeout(this.startupSnapshotTimer);
      this.startupSnapshotTimer = undefined;
    }

    if (this.scheduledSnapshotTimer) {
      clearTimeout(this.scheduledSnapshotTimer);
      this.scheduledSnapshotTimer = undefined;
    }

    this.isInitialized = false;
  }
}
