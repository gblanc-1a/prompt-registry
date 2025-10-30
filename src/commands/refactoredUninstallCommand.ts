/**
 * Refactored Uninstall Command using UnifiedUninstaller
 * Replaces the complex enhancedUninstallCommand with a clean, simple interface
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { UnifiedUninstaller, UninstallOptions, UninstallResult } from '../services/unifiedUninstaller';
import { Logger } from '../utils/logger';

export class RefactoredUninstallCommand {
    private readonly unifiedUninstaller: UnifiedUninstaller;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly logger: Logger;

    constructor() {
        this.unifiedUninstaller = new UnifiedUninstaller();
        this.outputChannel = vscode.window.createOutputChannel('Prompt Registry Uninstall');
        this.logger = Logger.getInstance();
    }

    /**
     * Main execute method for the unified uninstall command
     */
    async execute(): Promise<void> {
        try {
            this.outputChannel.show();
            this.outputChannel.appendLine('Starting Prompt Registry Uninstallation...');
            
            // Get the target directory (workspace root)
            const workspaceRoot = this.getWorkspaceRoot();
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace open. Please open a workspace to uninstall Prompt Registry.');
                return;
            }

            // Ask user for uninstall type
            const uninstallType = await this.promptForUninstallType();
            if (!uninstallType) {
                return; // User cancelled
            }

            // Set up options based on user choice
            const options: UninstallOptions = {
                type: uninstallType,
                targetDir: workspaceRoot,
                createBackup: uninstallType !== 'complete', // Always backup unless complete removal
                onProgress: (progress: number, message: string) => {
                    this.outputChannel.appendLine(`[${progress}%] ${message}`);
                    this.logger.info(`Progress: ${progress}% - ${message}`);
                }
            };

            // Handle custom selection if needed
            if (uninstallType === 'custom') {
                options.customSelection = await this.getCustomSelection(workspaceRoot);
                if (!options.customSelection) {
                    return; // User cancelled custom selection
                }
            }

            // Execute the uninstall
            this.outputChannel.appendLine(`\nExecuting ${uninstallType} uninstall...`);
            const result = await this.unifiedUninstaller.uninstall(options);
            
            // Show results
            await this.showResults(result, uninstallType);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Error: ${errorMessage}`);
            this.logger.error('Uninstall failed', error as Error);
            
            // Check if this is a safety error about missing metadata
            if (errorMessage.includes('SAFETY ERROR: Cannot uninstall without installation metadata')) {
                // Provide helpful guidance for metadata-related safety errors
                const helpMessage = 'Prompt Registry installation metadata not found. This is a safety protection to prevent accidental deletion of non-Prompt Registry files.\n\nThe smart uninstall feature requires installation metadata to safely identify which files belong to Prompt Registry.';
                const actions = ['Try Legacy Uninstall', 'Show Details', 'Cancel'];
                
                vscode.window.showWarningMessage(helpMessage, ...actions).then(choice => {
                    if (choice === 'Try Legacy Uninstall') {
                        // Offer alternative uninstall method
                        vscode.window.showInformationMessage('Would you like to try the legacy uninstall method instead? This will use the basic uninstall approach.');
                        vscode.commands.executeCommand('promptregistry.uninstall');
                    } else if (choice === 'Show Details') {
                        this.outputChannel.show(true);
                    }
                });
                return;
            }
            
            const actions = ['Show Details', 'OK'];
            vscode.window.showErrorMessage(`Uninstall failed: ${errorMessage}`, ...actions).then(choice => {
                if (choice === 'Show Details') {
                    this.outputChannel.show(true);
                }
            });
        }
    }

    /**
     * Get the workspace root directory
     */
    private getWorkspaceRoot(): string | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath;
    }

    /**
     * Prompt user for uninstall type
     */
    private async promptForUninstallType(): Promise<'complete' | 'smart' | 'custom' | undefined> {
        const choices = [
            {
                label: 'Smart Uninstall',
                description: 'Remove original files, preserve your modifications',
                value: 'smart' as const
            },
            {
                label: 'Complete Uninstall', 
                description: 'Remove everything (no backup)',
                value: 'complete' as const
            },
            {
                label: 'Custom Selection',
                description: 'Choose exactly what to remove',
                value: 'custom' as const
            }
        ];

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Select uninstall type',
            ignoreFocusOut: true
        });

        return selected?.value;
    }

    /**
     * Get custom file selection from user
     */
    private async getCustomSelection(targetDir: string): Promise<string[] | undefined> {
        // For now, this is a simplified version - in a full implementation,
        // you might want to show a tree view or file picker
        const manualEntry = await vscode.window.showInputBox({
            prompt: 'Enter file paths to remove (comma-separated, relative to workspace root)',
            placeHolder: 'e.g., file1.txt, src/file2.js, folder/file3.py',
            ignoreFocusOut: true
        });

        if (!manualEntry) {
            return undefined;
        }

        return manualEntry
            .split(',')
            .map(file => path.resolve(targetDir, file.trim()))
            .filter(file => file.length > 0);
    }

    /**
     * Show uninstall results to the user
     */
    private async showResults(result: UninstallResult, uninstallType: string): Promise<void> {
        const summary = [
            `\n✅ ${uninstallType} uninstall ${result.success ? 'completed successfully!' : 'encountered errors!'}`,
            ``,
            `📊 Summary:`,
            `  • Files removed: ${result.filesRemoved}`,
            `  • Files preserved: ${result.filesPreserved}`,
            result.backupPath ? `  • Backup created at: ${result.backupPath}` : '  • No backup created',
            ``
        ];

        // Show errors if any
        if (result.errors.length > 0) {
            summary.push(`⚠️ Errors encountered:`);
            result.errors.forEach(error => 
                summary.push(`  - ${error}`)
            );
            summary.push('');
        }

        // Show detailed file lists
        if (result.details.removed.length > 0) {
            summary.push(`📝 Removed files:`);
            result.details.removed.forEach(file => 
                summary.push(`  - ${file}`)
            );
            summary.push('');
        }

        if (result.details.preserved.length > 0) {
            summary.push(`💾 Preserved files:`);
            result.details.preserved.forEach(file => 
                summary.push(`  - ${file}`)
            );
            summary.push('');
        }

        if (result.details.backedUp.length > 0) {
            summary.push(`📦 Backed up files:`);
            result.details.backedUp.forEach(file => 
                summary.push(`  - ${file}`)
            );
            summary.push('');
        }

        // Output to channel
        summary.forEach(line => this.outputChannel.appendLine(line));

        // Show appropriate message
        if (result.success) {
            const message = result.backupPath 
                ? `Uninstall completed. ${result.filesRemoved} files removed, ${result.filesPreserved} files preserved. Backup: ${path.basename(result.backupPath)}`
                : `Uninstall completed. ${result.filesRemoved} files removed.`;
            
            vscode.window.showInformationMessage(message, 'Show Details').then(choice => {
                if (choice === 'Show Details') {
                    // Ensure output channel is visible and focused
                    this.outputChannel.clear();
                    this.outputChannel.show(true); // true = preserveFocus: false (will focus the output channel)
                    
                    // Add a summary at the top for quick reference
                    this.outputChannel.appendLine('='.repeat(80));
                    this.outputChannel.appendLine('UNINSTALL DETAILS - ' + new Date().toLocaleString());
                    this.outputChannel.appendLine('='.repeat(80));
                    this.outputChannel.appendLine('');
                }
            });
        } else {
            vscode.window.showErrorMessage(`Uninstall completed with ${result.errors.length} errors. See output for details.`, 'Show Details').then(choice => {
                if (choice === 'Show Details') {
                    // Ensure output channel is visible and focused
                    this.outputChannel.clear();
                    this.outputChannel.show(true); // true = preserveFocus: false (will focus the output channel)
                    
                    // Add a clear header for error details
                    this.outputChannel.appendLine('='.repeat(80));
                    this.outputChannel.appendLine('UNINSTALL ERROR DETAILS - ' + new Date().toLocaleString());
                    this.outputChannel.appendLine('='.repeat(80));
                    this.outputChannel.appendLine('');
                    
                    // Add detailed console logging for debugging
                    console.error(`[${new Date().toISOString()}] ERROR in refactoredUninstallCommand:`);
                    console.error('='.repeat(60));
                    if (result.errors && result.errors.length > 0) {
                        console.error(`Found ${result.errors.length} error(s):`);
                        result.errors.forEach((error, index) => {
                            console.error(`  ${index + 1}. ${error}`);
                        });
                    } else {
                        console.error('No specific error details available');
                    }
                    console.error('='.repeat(60));
                }
            });
        }
    }
}
