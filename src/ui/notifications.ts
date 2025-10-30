import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Notification service for the Prompt Registry extension
 */
export class Notifications {
    private static instance: Notifications;
    private readonly logger: Logger;

    private constructor() {
        this.logger = Logger.getInstance();
    }

    public static getInstance(): Notifications {
        if (!Notifications.instance) {
            Notifications.instance = new Notifications();
        }
        return Notifications.instance;
    }

    /**
     * Show information notification
     */
    public async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        this.logger.info(`Notification (Info): ${message}`);
        return await vscode.window.showInformationMessage(message, ...actions);
    }

    /**
     * Show warning notification
     */
    public async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        this.logger.warn(`Notification (Warning): ${message}`);
        return await vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show error notification
     */
    public async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        this.logger.error(`Notification (Error): ${message}`);
        return await vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * Show update notification
     */
    public async showUpdateNotification(
        currentVersion: string,
        newVersion: string,
        scope?: string
    ): Promise<'update' | 'dismiss' | undefined> {
        const scopeText = scope ? ` (${scope})` : '';
        const message = `Prompt Registry update available${scopeText}: ${currentVersion} → ${newVersion}`;
        
        const action = await this.showInfo(message, 'Update Now', 'Dismiss');
        
        switch (action) {
            case 'Update Now':
                return 'update';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show installation success notification
     */
    public async showInstallationSuccess(
        version: string,
        scope: string,
        path: string
    ): Promise<'show' | 'dismiss' | undefined> {
        const message = `Prompt Registry v${version} installed successfully in ${scope} scope!`;
        
        const action = await this.showInfo(message, 'Show in Explorer', 'Dismiss');
        
        switch (action) {
            case 'Show in Explorer':
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
                return 'show';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show update success notification
     */
    public async showUpdateSuccess(
        version: string,
        scope: string
    ): Promise<'details' | 'dismiss' | undefined> {
        const message = `Prompt Registry updated to v${version} in ${scope} scope!`;
        
        const action = await this.showInfo(message, 'Show Details', 'Dismiss');
        
        switch (action) {
            case 'Show Details':
                vscode.commands.executeCommand('promptregistry.showVersion');
                return 'details';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show uninstall confirmation
     */
    public async showUninstallConfirmation(
        scope: string
    ): Promise<'confirm' | 'cancel' | undefined> {
        const message = `Are you sure you want to uninstall Prompt Registry from ${scope} scope? This action cannot be undone.`;
        
        const action = await this.showWarning(message, 'Uninstall', 'Cancel');
        
        switch (action) {
            case 'Uninstall':
                return 'confirm';
            case 'Cancel':
                return 'cancel';
            default:
                return undefined;
        }
    }

    /**
     * Show installation error notification
     */
    public async showInstallationError(
        error: string
    ): Promise<'retry' | 'logs' | 'dismiss' | undefined> {
        const message = `Failed to install Prompt Registry: ${error}`;
        
        const action = await this.showError(message, 'Retry', 'Show Logs', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                vscode.commands.executeCommand('promptregistry.enhancedInstall');
                return 'retry';
            case 'Show Logs':
                this.logger.show();
                return 'logs';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show update error notification
     */
    public async showUpdateError(
        error: string
    ): Promise<'retry' | 'logs' | 'dismiss' | undefined> {
        const message = `Failed to update Prompt Registry: ${error}`;
        
        const action = await this.showError(message, 'Retry', 'Show Logs', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                vscode.commands.executeCommand('promptregistry.update');
                return 'retry';
            case 'Show Logs':
                this.logger.show();
                return 'logs';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show connectivity error notification
     */
    public async showConnectivityError(): Promise<'retry' | 'dismiss' | undefined> {
        const message = 'Unable to connect to GitHub. Please check your internet connection.';
        
        const action = await this.showError(message, 'Retry', 'Dismiss');
        
        switch (action) {
            case 'Retry':
                return 'retry';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }

    /**
     * Show first install welcome notification
     */
    public async showWelcomeNotification(): Promise<'install' | 'learn' | 'dismiss' | undefined> {
        const message = 'Welcome to Prompt Registry! Get started by installing the Prompt Registry components.';
        
        const action = await this.showInfo(message, 'Install Now', 'Learn More', 'Dismiss');
        
        switch (action) {
            case 'Install Now':
                vscode.commands.executeCommand('promptregistry.enhancedInstall');
                return 'install';
            case 'Learn More':
                vscode.commands.executeCommand('promptregistry.showHelp');
                return 'learn';
            case 'Dismiss':
                return 'dismiss';
            default:
                return undefined;
        }
    }
}
