/**
 * AutoUpdatePreferenceManager
 * Centralized manager for auto-update preferences with event emission
 */

import * as vscode from 'vscode';
import { RegistryStorage } from '../storage/RegistryStorage';

/**
 * Event payload for preference changes
 */
export interface AutoUpdatePreferenceChangedEvent {
    bundleId: string;
    autoUpdate: boolean;  // per-bundle preference
    globalEnabled: boolean;  // global auto-update enabled/disabled flag
}

/**
 * Centralized manager for auto-update preferences
 * Provides single source of truth for preference access and change notifications
 */
export class AutoUpdatePreferenceManager {
    private readonly _onPreferenceChanged = new vscode.EventEmitter<AutoUpdatePreferenceChangedEvent>();
    public readonly onPreferenceChanged: vscode.Event<AutoUpdatePreferenceChangedEvent> = this._onPreferenceChanged.event;

    constructor(private readonly storage: RegistryStorage) {}

    /**
     * Get auto-update preference for a specific bundle
     * @param bundleId Bundle identifier
     * @returns true if auto-update is enabled for this bundle
     */
    async getUpdatePreference(bundleId: string): Promise<boolean> {
        return this.storage.getUpdatePreference(bundleId);
    }

    /**
     * Set auto-update preference for a specific bundle
     * Fires onPreferenceChanged event with both per-bundle and global state
     * @param bundleId Bundle identifier
     * @param autoUpdate Enable/disable auto-update for this bundle
     */
    async setUpdatePreference(bundleId: string, autoUpdate: boolean): Promise<void> {
        await this.storage.setUpdatePreference(bundleId, autoUpdate);
        
        // Fire event with both per-bundle and global state
        this._onPreferenceChanged.fire({
            bundleId,
            autoUpdate,
            globalEnabled: this.isGlobalAutoUpdateEnabled()
        });
    }

    /**
     * Check if global auto-update is enabled
     * Reads from promptregistry.updateCheck.autoUpdate setting
     * @returns true if global auto-update is enabled (default: true)
     */
    isGlobalAutoUpdateEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('promptregistry');
        return config.get<boolean>('updateCheck.autoUpdate', true);
    }

    /**
     * Dispose event emitter
     */
    dispose(): void {
        this._onPreferenceChanged.dispose();
    }
}
