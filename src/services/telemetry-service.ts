import * as vscode from 'vscode';
import {
  InstalledBundle,
  Profile,
  RegistrySource,
  SourceSyncedEvent,
} from '../types/registry';
import {
  TelemetryDocument,
  TelemetryTransport,
} from '../types/telemetry';
import {
  RegistryManager,
} from './registry-manager';

/**
 * Telemetry service that tracks bundle lifecycle events using VS Code's
 * built-in TelemetryLogger infrastructure.
 *
 * Uses `vscode.env.createTelemetryLogger` with a Logger-backed sender,
 * so VS Code automatically respects the user's telemetry preferences
 * (`telemetry.telemetryLevel`):
 *  - `all`   → usage + error events are sent
 *  - `error` → only error events are sent
 *  - `crash` / `off` → nothing is sent
 *
 * Optionally forwards events to one or more {@link TelemetryTransport}
 * instances (e.g. Elastic Search, console).
 */
export class TelemetryService {
  private static instance: TelemetryService;

  private readonly transports: TelemetryTransport[] = [];
  private readonly telemetryLogger: vscode.TelemetryLogger;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    const sender: vscode.TelemetrySender = {
      sendEventData: (eventName: string, data?: Record<string, any>) => {
        this.send({ timestamp: new Date().toISOString(), eventName, data });
      },
      sendErrorData: (error: Error, data?: Record<string, any>) => {
        this.send({
          timestamp: new Date().toISOString(),
          error: { message: error.message, stack: error.stack },
          data
        });
      }
    };

    this.telemetryLogger = vscode.env.createTelemetryLogger(sender);
    this.telemetryLogger.logUsage('telemetryService.started');
    this.disposables.push(this.telemetryLogger);
  }

  /**
   * Forward a telemetry document to all attached transports.
   * @param doc - the telemetry document to send
   */
  private send(doc: TelemetryDocument): void {
    this.transports.forEach((transport) => transport.send(doc));
  }

  private trackBundleEvent(eventName: string, bundle: InstalledBundle): void {
    this.telemetryLogger.logUsage(eventName, {
      bundleId: bundle.bundleId,
      version: bundle.version,
      scope: bundle.scope,
      sourceType: bundle.sourceType ?? 'unknown',
      sessionId: vscode.env.sessionId
    });
  }

  private trackProfileEvent(eventName: string, profile: Profile): void {
    this.telemetryLogger.logUsage(eventName, {
      profileId: profile.id,
      name: profile.name
    });
  }

  private trackSourceEvent(eventName: string, source: RegistrySource): void {
    this.telemetryLogger.logUsage(eventName, {
      sourceId: source.id,
      type: source.type
    });
  }

  private trackSourceSyncedEvent(eventName: string, event: SourceSyncedEvent): void {
    this.telemetryLogger.logUsage(eventName, {
      sourceId: event.sourceId,
      bundleCount: event.bundleCount
    });
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  /**
   * Reset the singleton instance (for testing only).
   */
  public static resetInstance(): void {
    if (TelemetryService.instance) {
      TelemetryService.instance.dispose();
    }
    TelemetryService.instance = undefined!;
  }

  /**
   * Add a transport for forwarding telemetry events to an external backend.
   * Multiple transports can be attached; each receives every event.
   * @param transports - the transports to add
   */
  public addTransport(...transports: TelemetryTransport[]): void {
    this.transports.push(...transports);
  }

  /**
   * Subscribe to RegistryManager bundle lifecycle events.
   * Subscriptions are owned by this service and cleaned up on dispose().
   * @param registryManager - the registry manager to subscribe to
   */
  public subscribeToRegistryEvents(registryManager: RegistryManager): void {
    this.disposables.push(
      // Bundle events
      registryManager.onBundleInstalled((bundle) => this.trackBundleEvent('bundle.installed', bundle)),
      registryManager.onBundleUninstalled((bundleId) => this.telemetryLogger.logUsage('bundle.uninstalled', { bundleId })),
      registryManager.onBundleUpdated((bundle) => this.trackBundleEvent('bundle.updated', bundle)),
      registryManager.onBundlesInstalled((bundles) => this.telemetryLogger.logUsage('bundles.installed', { count: bundles.length, bundleIds: bundles.map((b) => b.bundleId) })),
      registryManager.onBundlesUninstalled((bundleIds) => this.telemetryLogger.logUsage('bundles.uninstalled', { count: bundleIds.length, bundleIds })),
      // Profile events
      registryManager.onProfileActivated((profile) => this.trackProfileEvent('profile.activated', profile)),
      registryManager.onProfileDeactivated((profileId) => this.telemetryLogger.logUsage('profile.deactivated', { profileId })),
      registryManager.onProfileCreated((profile) => this.trackProfileEvent('profile.created', profile)),
      registryManager.onProfileUpdated((profile) => this.trackProfileEvent('profile.updated', profile)),
      registryManager.onProfileDeleted((profileId) => this.telemetryLogger.logUsage('profile.deleted', { profileId })),
      // Source events
      registryManager.onSourceAdded((source) => this.trackSourceEvent('source.added', source)),
      registryManager.onSourceRemoved((sourceId) => this.telemetryLogger.logUsage('source.removed', { sourceId })),
      registryManager.onSourceUpdated((sourceId) => this.telemetryLogger.logUsage('source.updated', { sourceId })),
      registryManager.onSourceSynced((event) => this.trackSourceSyncedEvent('source.synced', event)),
      // Preference events
      registryManager.onAutoUpdatePreferenceChanged((event) => this.telemetryLogger.logUsage('autoUpdate.preferenceChanged', { bundleId: event.bundleId, enabled: event.enabled })),
      registryManager.onRepositoryBundlesChanged(() => this.telemetryLogger.logUsage('repository.bundlesChanged'))
    );
  }

  /**
   * Track a marketplace search as an active-user signal.
   *
   * Only anonymized metrics are recorded (never the raw query text):
   * the query length, the number of matching results, and whether the
   * search yielded any results. `sessionId` allows downstream analytics
   * to correlate a search with a subsequent install within the same
   * session (see {@link trackBundleEvent}).
   * @param params - anonymized search metrics
   * @param params.termLength - length of the search query
   * @param params.resultCount - number of bundles matching the query
   */
  public trackSearch(params: { termLength: number; resultCount: number }): void {
    this.telemetryLogger.logUsage('bundle.searched', {
      termLength: params.termLength,
      resultCount: params.resultCount,
      hasResults: params.resultCount > 0,
      sessionId: vscode.env.sessionId
    });
  }

  /**
   * Track a snapshot of the currently installed bundle inventory.
   *
   * Emitted periodically by {@link InventoryScheduler} to measure how many
   * bundles are installed via the registry, broken down by scope and source
   * type.
   * @param params - aggregated inventory counts
   * @param params.total - total number of installed bundles
   * @param params.byScope - installed bundle counts keyed by scope
   * @param params.byScope.user - number of user-scoped bundles
   * @param params.byScope.workspace - number of workspace-scoped bundles
   * @param params.byScope.repository - number of repository-scoped bundles
   * @param params.bySourceType - installed bundle counts keyed by source type
   */
  public trackInventorySnapshot(params: {
    total: number;
    byScope: { user: number; workspace: number; repository: number };
    bySourceType: Record<string, number>;
  }): void {
    this.telemetryLogger.logUsage('inventory.snapshot', {
      total: params.total,
      userCount: params.byScope.user,
      workspaceCount: params.byScope.workspace,
      repositoryCount: params.byScope.repository,
      bySourceType: params.bySourceType
    });
  }

  /**
   * Dispose the telemetry logger and all event subscriptions.
   */
  public dispose(): void {
    this.telemetryLogger.logUsage('telemetryService.stopped');
    this.transports.forEach((t) => t.dispose());
    this.transports.length = 0;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
