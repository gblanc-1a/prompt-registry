/**
 * UnifiedInstallFlow
 * Centralized install/update flow with consistent prompting across UI surfaces
 */

import * as vscode from 'vscode';
import { AutoUpdatePreferenceManager } from './AutoUpdatePreferenceManager';
import { RegistryManager } from './RegistryManager';
import { InstallOptions } from '../types/registry';
import { Logger } from '../utils/logger';

/**
 * Options for unified install flow
 */
export interface UnifiedInstallFlowOptions {
    bundleId: string;
    version?: string;  // default: 'latest'
    scope?: 'user' | 'workspace';  // if undefined, prompt user
    autoUpdate?: boolean;  // if undefined, prompt user
    skipScopePrompt?: boolean;  // force use provided scope or fail
    skipAutoUpdatePrompt?: boolean;  // force use provided autoUpdate or fail
    showProgressNotification?: boolean;  // default: true
    successMessage?: string;  // custom success message
    showSuccessMessage?: boolean;  // default: true, set to false to skip success notification
}

/**
 * Unified install flow for bundles
 * Handles scope selection, auto-update prompts, and installation execution
 * 
 * @param registryManager Registry manager instance
 * @param preferenceManager Auto-update preference manager instance
 * @param options Install flow options
 */
export async function unifiedInstallFlow(
    registryManager: RegistryManager,
    preferenceManager: AutoUpdatePreferenceManager,
    options: UnifiedInstallFlowOptions
): Promise<void> {
    const logger = Logger.getInstance();
    const {
        bundleId,
        version = 'latest',
        showProgressNotification = true,
        successMessage,
        showSuccessMessage = true,
    } = options;

    let { scope, autoUpdate } = options;

    // Validate skip flags
    if (options.skipScopePrompt && scope === undefined) {
        throw new Error('scope is required when skipScopePrompt is true');
    }
    if (options.skipAutoUpdatePrompt && autoUpdate === undefined) {
        throw new Error('autoUpdate is required when skipAutoUpdatePrompt is true');
    }

    // Get bundle details for messaging
    const bundle = await registryManager.getBundleDetails(bundleId);

    // Prompt for scope if needed
    if (scope === undefined && !options.skipScopePrompt) {
        const scopeChoice = await vscode.window.showQuickPick(
            [
                {
                    label: '$(account) User',
                    description: 'Install for current user (all workspaces)',
                    value: 'user' as const
                },
                {
                    label: '$(folder) Workspace',
                    description: 'Install for current workspace only',
                    value: 'workspace' as const
                }
            ],
            {
                placeHolder: 'Select installation scope',
                title: `Install ${bundle.name}`,
                ignoreFocusOut: true
            }
        );

        if (!scopeChoice) {
            return; // User cancelled
        }

        scope = scopeChoice.value;
    }

    // Prompt for auto-update preference if needed
    if (autoUpdate === undefined && !options.skipAutoUpdatePrompt) {
        const autoUpdateChoice = await vscode.window.showQuickPick(
            [
                {
                    label: '$(sync) Enable auto-update',
                    description: 'Automatically install updates when available',
                    detail: 'Recommended for staying up-to-date with the latest features and fixes',
                    value: true
                },
                {
                    label: '$(circle-slash) Manual updates only',
                    description: 'You will be notified but updates must be installed manually',
                    detail: 'Choose this if you prefer to review changes before updating',
                    value: false
                }
            ],
            {
                placeHolder: 'Enable auto-update for this bundle?',
                title: `Install ${bundle.name} - Auto-Update Preference`,
                ignoreFocusOut: true
            }
        );

        if (autoUpdateChoice === undefined) {
            return; // User cancelled
        }

        autoUpdate = autoUpdateChoice.value;
    }

    // Prepare install options
    const installOptions: InstallOptions = {
        scope: scope!,
        version
    };

    // Execute installation
    const installTask = async () => {
        if (showProgressNotification) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing ${bundle.name}...`,
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Downloading...' });
                    await registryManager.installBundle(bundleId, installOptions);
                    progress.report({ message: 'Complete', increment: 100 });
                }
            );
        } else {
            await registryManager.installBundle(bundleId, installOptions);
        }
    };

    await installTask();

    // Store auto-update preference after successful installation
    await preferenceManager.setUpdatePreference(bundleId, autoUpdate!);

    logger.info(
        `Auto-update preference for '${bundleId}' set to: ${autoUpdate}`
    );

    // Show success message (unless explicitly disabled)
    if (showSuccessMessage) {
        const finalMessage = successMessage || `✓ ${bundle.name} installed successfully!`;
        await vscode.window.showInformationMessage(finalMessage);
    }
}
