import * as vscode from 'vscode';
import * as path from 'path';
import { InstallationManager } from '../services/installationManager';
import { Logger } from '../utils/logger';

/**
 * Command for uninstalling Prompt Registry from all scopes
 * This command removes all recorded files from installation metadata
 */
export class UninstallCommand {
    constructor(
        private readonly installationManager: InstallationManager,
        private readonly logger: Logger
    ) {}

    /**
     * Execute the uninstall all command
     * This removes Prompt Registry from all installed scopes after user confirmation
     */
    async executeUninstallAll(): Promise<void> {
        try {
            this.logger.info('Starting Prompt Registry uninstallation from all scopes...');
            
            // Get all installed scopes
            const installedScopes = await this.installationManager.getInstalledScopes();
            
            if (installedScopes.length === 0) {
                this.logger.info('No Prompt Registry installations found');
                await vscode.window.showInformationMessage('Prompt Registry is not installed in any scope.');
                return;
            }

            // Show confirmation dialog
            const scopesList = installedScopes.join(', ');
            const confirmationMessage = `Are you sure you want to uninstall Prompt Registry from ALL scopes (${scopesList})? This will remove all recorded files and cannot be undone.`;
            
            const confirmation = await vscode.window.showWarningMessage(
                confirmationMessage,
                'Uninstall All',
                'Cancel'
            );

            if (confirmation !== 'Uninstall All') {
                this.logger.info('User cancelled uninstall operation');
                return;
            }

            // Perform uninstallation with progress tracking
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Uninstalling Prompt Registry from all scopes',
                cancellable: false
            }, async (progress) => {
                const successfulScopes: string[] = [];
                const failedScopes: string[] = [];
                
                const totalScopes = installedScopes.length;
                
                for (let i = 0; i < totalScopes; i++) {
                    const scope = installedScopes[i];
                    const progressPercentage = Math.round((i / totalScopes) * 100);
                    
                    progress.report({
                        increment: progressPercentage,
                        message: `Uninstalling from ${scope}...`
                    });

                    try {
                        this.logger.info(`Uninstalling Prompt Registry from scope: ${scope}`);
                        const success = await this.installationManager.uninstall(scope);
                        
                        if (success) {
                            successfulScopes.push(scope);
                            this.logger.info(`Successfully uninstalled from scope: ${scope}`);
                        } else {
                            this.logger.warn(`Failed to uninstall from scope: ${scope}`);
                            failedScopes.push(scope);
                        }
                    } catch (error) {
                        this.logger.error(`Failed to uninstall from scope: ${scope}`, error as Error);
                        failedScopes.push(scope);
                    }
                }

                // Final progress update
                progress.report({ increment: 100, message: 'Completing uninstallation...' });

                // Show completion summary
                await this.showUninstallationSummary(successfulScopes, failedScopes);
            });
            
        } catch (error) {
            const err = error as Error;
            this.logger.error('Failed to get installed scopes', err);
            await vscode.window.showErrorMessage(`Failed to check Prompt Registry installations: ${err.message}`);
        }
    }

    /**
     * Get all installed files from all scopes
     * Useful for debugging and showing what will be removed
     */
    async getInstalledFiles(): Promise<Array<{ scope: string; path: string; fullPath: string }>> {
        const allFiles: Array<{ scope: string; path: string; fullPath: string }> = [];
        
        try {
            const installedScopes = await this.installationManager.getInstalledScopes();
            
            for (const scope of installedScopes) {
                try {
                    const installationInfo = await this.installationManager.getInstallationInfo(scope);
                    
                    if (!installationInfo) {
                        this.logger.warn(`No installation info found for scope: ${scope}`);
                        continue;
                    }

                    const { installedFiles = [], installedPath = '' } = installationInfo;
                    
                    for (const filePath of installedFiles) {
                        allFiles.push({
                            scope,
                            path: filePath,
                            fullPath: path.join(installedPath, filePath)
                        });
                    }
                } catch (error) {
                    this.logger.error(`Failed to get installation info for scope: ${scope}`, error as Error);
                }
            }
        } catch (error) {
            this.logger.error('Failed to get installed files', error as Error);
        }
        
        return allFiles;
    }

    /**
     * Show a summary of the uninstallation results
     */
    private async showUninstallationSummary(successfulScopes: string[], failedScopes: string[]): Promise<void> {
        if (failedScopes.length === 0) {
            // Complete success
            this.logger.info('Successfully uninstalled Prompt Registry from all scopes');
            await vscode.window.showInformationMessage(
                `✅ Prompt Registry successfully uninstalled from all scopes: ${successfulScopes.join(', ')}`
            );
        } else if (successfulScopes.length === 0) {
            // Complete failure
            this.logger.error('Failed to uninstall Prompt Registry from any scope');
            await vscode.window.showErrorMessage(
                `❌ Failed to uninstall Prompt Registry from all scopes: ${failedScopes.join(', ')}`
            );
        } else {
            // Partial success
            this.logger.warn('Prompt Registry uninstallation completed with some failures');
            const summary = `⚠️ Prompt Registry uninstallation completed with mixed results:\n\n` +
                           `✅ Successfully removed from: ${successfulScopes.join(', ')}\n` +
                           `❌ Failed to remove from: ${failedScopes.join(', ')}`;
            await vscode.window.showWarningMessage(summary);
        }
    }

    /**
     * Show detailed information about what will be removed
     * Useful for user confirmation
     */
    async showRemovalPreview(): Promise<void> {
        try {
            const installedFiles = await this.getInstalledFiles();
            
            if (installedFiles.length === 0) {
                await vscode.window.showInformationMessage('No Prompt Registry files found to remove.');
                return;
            }

            // Group files by scope for better presentation
            const filesByScope: { [scope: string]: string[] } = {};
            for (const file of installedFiles) {
                if (!filesByScope[file.scope]) {
                    filesByScope[file.scope] = [];
                }
                filesByScope[file.scope].push(file.path);
            }

            // Build preview message
            let previewMessage = `Prompt Registry Installation Preview (${installedFiles.length} files):\n\n`;
            
            for (const [scope, files] of Object.entries(filesByScope)) {
                previewMessage += `📁 ${scope.toUpperCase()} (${files.length} files):\n`;
                files.slice(0, 5).forEach(file => {
                    previewMessage += `  • ${file}\n`;
                });
                if (files.length > 5) {
                    previewMessage += `  • ... and ${files.length - 5} more files\n`;
                }
                previewMessage += '\n';
            }

            await vscode.window.showInformationMessage(previewMessage);
            
        } catch (error) {
            this.logger.error('Failed to show removal preview', error as Error);
            await vscode.window.showErrorMessage(`Failed to get file preview: ${(error as Error).message}`);
        }
    }
}
