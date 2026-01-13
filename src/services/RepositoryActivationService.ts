/**
 * RepositoryActivationService
 * 
 * Handles detection of lockfiles on workspace open and prompts users to enable
 * repository bundles. Manages "Don't ask again" persistence and missing source/hub detection.
 * 
 * Requirements covered:
 * - 13.1-13.7: Repository bundle activation prompt
 * - 12.4-12.5: Missing source/hub detection
 */

import * as vscode from 'vscode';
import { LockfileManager } from './LockfileManager';
import { HubManager } from './HubManager';
import { RegistryStorage } from '../storage/RegistryStorage';
import { Lockfile } from '../types/lockfile';
import { Logger } from '../utils/logger';

/**
 * Result of missing source/hub detection
 */
export interface MissingSourcesResult {
    missingSources: string[];
    missingHubs: string[];
    offeredToAdd: boolean;
}

/**
 * RepositoryActivationService singleton
 * 
 * Detects lockfiles on workspace open and prompts users to enable repository bundles.
 * Follows the singleton pattern used by other services in the codebase.
 */
export class RepositoryActivationService {
    private static instance: RepositoryActivationService | null = null;
    private logger: Logger;
    private readonly DECLINED_KEY = 'repositoryActivation.declined';

    constructor(
        private lockfileManager: LockfileManager,
        private hubManager: HubManager,
        private storage: RegistryStorage
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * Get the singleton instance of RepositoryActivationService
     */
    static getInstance(
        lockfileManager?: LockfileManager,
        hubManager?: HubManager,
        storage?: RegistryStorage
    ): RepositoryActivationService {
        if (!RepositoryActivationService.instance) {
            if (!lockfileManager || !hubManager || !storage) {
                throw new Error('Dependencies required on first call to RepositoryActivationService.getInstance()');
            }
            RepositoryActivationService.instance = new RepositoryActivationService(
                lockfileManager,
                hubManager,
                storage
            );
        }
        return RepositoryActivationService.instance;
    }

    /**
     * Reset the singleton instance (for testing purposes)
     */
    static resetInstance(): void {
        RepositoryActivationService.instance = null;
    }

    /**
     * Check for lockfile and prompt activation if appropriate
     * Called on workspace open
     */
    async checkAndPromptActivation(): Promise<void> {
        try {
            // Check if lockfile exists
            const lockfile = await this.lockfileManager.read();
            if (!lockfile) {
                this.logger.debug('No lockfile found, skipping activation prompt');
                return;
            }

            // Check if this repository was previously declined
            const lockfilePath = this.lockfileManager.getLockfilePath();
            const repositoryPath = this.getRepositoryPath(lockfilePath);
            
            if (await this.wasDeclined(repositoryPath)) {
                this.logger.debug(`Repository ${repositoryPath} was previously declined, skipping prompt`);
                return;
            }

            // Show activation prompt
            const choice = await this.showActivationPrompt(lockfile);

            switch (choice) {
                case 'enable':
                    await this.enableRepositoryBundles(lockfile);
                    break;
                case 'never':
                    await this.rememberDeclined(repositoryPath);
                    break;
                case 'decline':
                default:
                    // User declined or dismissed - do nothing
                    break;
            }
        } catch (error) {
            this.logger.error('Failed to check and prompt activation:', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Show activation prompt to user
     * @param lockfile - The lockfile to activate
     * @returns User's choice: 'enable', 'decline', or 'never'
     */
    async showActivationPrompt(lockfile: Lockfile): Promise<'enable' | 'decline' | 'never'> {
        const bundleCount = Object.keys(lockfile.bundles).length;
        const profileCount = lockfile.profiles ? Object.keys(lockfile.profiles).length : 0;

        let message = `This repository has ${bundleCount} bundle${bundleCount !== 1 ? 's' : ''} configured`;
        if (profileCount > 0) {
            message += ` and ${profileCount} profile${profileCount !== 1 ? 's' : ''}`;
        }
        message += '. Would you like to enable them?';

        const choice = await vscode.window.showInformationMessage(
            message,
            'Enable',
            'Not now',
            'Don\'t ask again'
        );

        switch (choice) {
            case 'Enable':
                return 'enable';
            case 'Don\'t ask again':
                return 'never';
            case 'Not now':
            default:
                return 'decline';
        }
    }

    /**
     * Enable repository bundles
     * Verifies bundles are installed and checks for missing sources/hubs
     * 
     * @param lockfile - The lockfile to enable
     */
    async enableRepositoryBundles(lockfile: Lockfile): Promise<void> {
        try {
            this.logger.debug('Enabling repository bundles...');
            
            // Check which bundles are installed - this MUST be called for proper activation
            const installedBundles = await this.storage.getInstalledBundles('repository');
            this.logger.debug(`Found ${installedBundles.length} installed bundles at repository scope`);
            
            const installedBundleIds = new Set(installedBundles.map(b => b.bundleId));
            
            const lockfileBundleIds = Object.keys(lockfile.bundles);
            const missingBundleIds = lockfileBundleIds.filter(id => !installedBundleIds.has(id));

            // Offer to install missing bundles
            if (missingBundleIds.length > 0) {
                this.logger.debug(`Found ${missingBundleIds.length} missing bundles`);
                const choice = await vscode.window.showInformationMessage(
                    `${missingBundleIds.length} bundle${missingBundleIds.length !== 1 ? 's are' : ' is'} not installed. Would you like to install them?`,
                    'Install',
                    'Skip'
                );

                if (choice === 'Install') {
                    this.logger.info(`User chose to install ${missingBundleIds.length} missing bundles`);
                    // Note: Actual installation would be handled by RegistryManager
                    // For now, just log the intent
                }
            } else {
                this.logger.debug('All bundles from lockfile are already installed');
            }

            // Check for missing sources and hubs
            await this.checkAndOfferMissingSources(lockfile);

        } catch (error) {
            this.logger.error('Failed to enable repository bundles:', error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage('Failed to enable repository bundles. See logs for details.');
        }
    }

    /**
     * Check for missing sources and hubs, offer to add them
     * @param lockfile - The lockfile to check
     * @returns Result with missing sources/hubs and whether offer was made
     */
    async checkAndOfferMissingSources(lockfile: Lockfile): Promise<MissingSourcesResult> {
        const result: MissingSourcesResult = {
            missingSources: [],
            missingHubs: [],
            offeredToAdd: false
        };

        try {
            // Get configured sources
            const configuredSources = await this.storage.getSources();
            const configuredSourceIds = new Set(configuredSources.map(s => s.id));

            // Check for missing sources
            const lockfileSourceIds = Object.keys(lockfile.sources);
            result.missingSources = lockfileSourceIds.filter(id => !configuredSourceIds.has(id));

            // Check for missing hubs
            if (lockfile.hubs) {
                const configuredHubs = await this.hubManager.listHubs();
                const configuredHubIds = new Set(configuredHubs.map(h => h.id));
                
                const lockfileHubIds = Object.keys(lockfile.hubs);
                result.missingHubs = lockfileHubIds.filter(id => !configuredHubIds.has(id));
            }

            // Offer to add missing sources/hubs
            if (result.missingSources.length > 0 || result.missingHubs.length > 0) {
                const totalMissing = result.missingSources.length + result.missingHubs.length;
                const itemType = result.missingHubs.length > 0 ? 'sources and hubs' : 'sources';
                
                const choice = await vscode.window.showInformationMessage(
                    `${totalMissing} ${itemType} from the lockfile are not configured. Would you like to add them?`,
                    'Add Sources',
                    'Not now'
                );

                result.offeredToAdd = true;

                if (choice === 'Add Sources') {
                    this.logger.info(`User chose to add ${totalMissing} missing ${itemType}`);
                    // Note: Actual addition would be handled by RegistryManager/HubManager
                    // For now, just log the intent
                }
            }

        } catch (error) {
            this.logger.error('Failed to check for missing sources/hubs:', error instanceof Error ? error : undefined);
        }

        return result;
    }

    /**
     * Remember that user declined activation for this repository
     * @param repositoryPath - Path to the repository
     */
    async rememberDeclined(repositoryPath: string): Promise<void> {
        try {
            const declined = await this.getDeclinedRepositories();
            
            if (!declined.includes(repositoryPath)) {
                declined.push(repositoryPath);
                await this.storage.getContext().globalState.update(this.DECLINED_KEY, declined);
                this.logger.debug(`Remembered declined activation for: ${repositoryPath}`);
            }
        } catch (error) {
            this.logger.error('Failed to remember declined repository:', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Check if user previously declined activation for this repository
     * @param repositoryPath - Path to the repository
     * @returns True if previously declined
     */
    private async wasDeclined(repositoryPath: string): Promise<boolean> {
        const declined = await this.getDeclinedRepositories();
        return declined.includes(repositoryPath);
    }

    /**
     * Get list of declined repositories from global state
     * @returns Array of repository paths
     */
    private async getDeclinedRepositories(): Promise<string[]> {
        const context = this.storage.getContext();
        return context.globalState.get<string[]>(this.DECLINED_KEY, []);
    }

    /**
     * Extract repository path from lockfile path
     * @param lockfilePath - Full path to lockfile
     * @returns Repository root path
     */
    private getRepositoryPath(lockfilePath: string): string {
        // Remove the lockfile name to get repository root
        const parts = lockfilePath.split(/[/\\]/);
        parts.pop(); // Remove 'prompt-registry.lock.json'
        return parts.join('/');
    }
}
