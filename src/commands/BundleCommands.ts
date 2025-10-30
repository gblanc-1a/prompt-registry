/**
 * Bundle Management Commands
 * Handles bundle search, installation, updates, and uninstallation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle, InstallOptions, BundleUpdate } from '../types/registry';
import { Logger } from '../utils/logger';

/**
 * Bundle Commands Handler
 */
export class BundleCommands {
    private logger: Logger;

    constructor(private registryManager: RegistryManager) {
        this.logger = Logger.getInstance();
    }

    /**
     * Search and install a bundle
     */
    async searchAndInstall(): Promise<void> {
        try {
            // Search for bundles
            const searchQuery = await vscode.window.showInputBox({
                prompt: 'Search for bundles',
                placeHolder: 'e.g., python developer',
            });

            if (!searchQuery) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Searching bundles...',
                    cancellable: false
                },
                async () => {
                    const bundles = await this.registryManager.searchBundles({
                        text: searchQuery
                    });

                    if (bundles.length === 0) {
                        vscode.window.showInformationMessage(
                            `No bundles found for "${searchQuery}"`
                        );
                        return;
                    }

                    // Show results
                    const selected = await vscode.window.showQuickPick(
                        bundles.map(b => ({
                            label: b.name,
                            description: `v${b.version} • ${b.author}`,
                            detail: b.description,
                            bundle: b
                        })),
                        {
                            placeHolder: `Found ${bundles.length} bundle(s)`,
                            title: 'Select Bundle to Install'
                        }
                    );

                    if (selected) {
                        await this.installBundle(selected.bundle.id);
                    }
                }
            );

        } catch (error) {
            this.logger.error('Failed to search bundles', error as Error);
            vscode.window.showErrorMessage(`Search failed: ${(error as Error).message}`);
        }
    }

    /**
     * Install a specific bundle
     */
    async installBundle(bundleId?: string): Promise<void> {
        try {
            // If no bundleId, let user search
            if (!bundleId) {
                await this.searchAndInstall();
                return;
            }

            // Get bundle details
            const bundle = await this.registryManager.getBundleDetails(bundleId);

            // Ask for installation scope
            const scope = await vscode.window.showQuickPick(
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
                    title: `Install ${bundle.name}`
                }
            );

            if (!scope) {
                return;
            }

            const options: InstallOptions = {
                scope: scope.value,
                version: 'latest'
            };

            // Install with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing ${bundle.name}...`,
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Downloading...' });
                    await this.registryManager.installBundle(bundleId, options);
                    progress.report({ message: 'Complete', increment: 100 });
                }
            );

            vscode.window.showInformationMessage(
                `✓ ${bundle.name} installed successfully!`,
                'View Bundle', 'Install More'
            ).then(action => {
                if (action === 'View Bundle') {
                    this.viewBundle(bundleId);
                } else if (action === 'Install More') {
                    this.searchAndInstall();
                }
            });

        } catch (error) {
            this.logger.error('Failed to install bundle', error as Error);
            vscode.window.showErrorMessage(`Installation failed: ${(error as Error).message}`);
        }
    }

    /**
     * Uninstall a bundle
     */
    async uninstallBundle(bundleId?: string): Promise<void> {
        try {
            // If no bundleId, let user select
            if (!bundleId) {
                const installed = await this.registryManager.listInstalledBundles();

                if (installed.length === 0) {
                    vscode.window.showInformationMessage('No bundles installed.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    await Promise.all(installed.map(async ib => {
                        try {
                            const bundle = await this.registryManager.getBundleDetails(ib.bundleId);
                            return {
                                label: bundle.name,
                                description: `v${ib.version} • ${ib.scope}`,
                                detail: bundle.description,
                                bundleId: ib.bundleId
                            };
                        } catch {
                            return {
                                label: ib.bundleId,
                                description: `v${ib.version} • ${ib.scope}`,
                                detail: 'Bundle details not available',
                                bundleId: ib.bundleId
                            };
                        }
                    })),
                    {
                        placeHolder: 'Select bundle to uninstall',
                        title: 'Uninstall Bundle'
                    }
                );

                if (!selected) {
                    return;
                }

                bundleId = selected.bundleId;
            }

            // Get bundle name for confirmation
            let bundleName = bundleId;
            try {
                const bundle = await this.registryManager.getBundleDetails(bundleId);
                bundleName = bundle.name;
            } catch {
                // Use bundleId if details not available
            }

            // Confirm uninstallation
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to uninstall "${bundleName}"?`,
                { modal: true },
                'Uninstall', 'Cancel'
            );

            if (confirmation !== 'Uninstall') {
                return;
            }

            // Uninstall with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Uninstalling ${bundleName}...`,
                    cancellable: false
                },
                async () => {
                    await this.registryManager.uninstallBundle(bundleId!);
                }
            );

            vscode.window.showInformationMessage(
                `✓ ${bundleName} uninstalled successfully`
            );

        } catch (error) {
            this.logger.error('Failed to uninstall bundle', error as Error);
            vscode.window.showErrorMessage(`Uninstall failed: ${(error as Error).message}`);
        }
    }

    /**
     * Update a bundle
     */
    async updateBundle(bundleId?: string): Promise<void> {
        try {
            // If no bundleId, show all available updates
            if (!bundleId) {
                await this.checkAllUpdates();
                return;
            }

            // Get bundle details
            const bundle = await this.registryManager.getBundleDetails(bundleId);

            // Update with progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Updating ${bundle.name}...`,
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Downloading...' });
                    await this.registryManager.updateBundle(bundleId);
                    progress.report({ message: 'Complete', increment: 100 });
                }
            );

            vscode.window.showInformationMessage(
                `✓ ${bundle.name} updated successfully!`
            );

        } catch (error) {
            this.logger.error('Failed to update bundle', error as Error);
            vscode.window.showErrorMessage(`Update failed: ${(error as Error).message}`);
        }
    }

    /**
     * Check for updates on all installed bundles
     */
    async checkAllUpdates(): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Checking for updates...',
                    cancellable: false
                },
                async () => {
                    const updates = await this.registryManager.checkUpdates();

                    if (updates.length === 0) {
                        vscode.window.showInformationMessage('All bundles are up to date!');
                        return;
                    }

                    // Show available updates with bundle names
                    const updateItems = await Promise.all(updates.map(async u => {
                        let name = u.bundleId;
                        try {
                            const bundle = await this.registryManager.getBundleDetails(u.bundleId);
                            name = bundle.name;
                        } catch {
                            // Use bundleId if details not available
                        }
                        return {
                            label: name,
                            description: `${u.currentVersion} → ${u.latestVersion}`,
                            detail: 'Update available',
                            update: u,
                            name
                        };
                    }));

                    const selected = await vscode.window.showQuickPick(
                        updateItems,
                        {
                            placeHolder: `${updates.length} update(s) available`,
                            title: 'Bundle Updates',
                            canPickMany: true
                        }
                    );

                    if (!selected || selected.length === 0) {
                        return;
                    }

                    // Update selected bundles
                    for (const item of selected) {
                        try {
                            await this.updateBundle(item.update.bundleId);
                        } catch (error) {
                            this.logger.warn(`Failed to update ${item.name}`, error as Error);
                        }
                    }

                    vscode.window.showInformationMessage(
                        `✓ Updated ${selected.length} bundle(s)`
                    );
                }
            );

        } catch (error) {
            this.logger.error('Failed to check updates', error as Error);
            vscode.window.showErrorMessage(`Update check failed: ${(error as Error).message}`);
        }
    }

    /**
     * View bundle details
     */
    async viewBundle(bundleId?: string): Promise<void> {
        try {
            // If no bundleId, let user search
            if (!bundleId) {
                const searchQuery = await vscode.window.showInputBox({
                    prompt: 'Search for bundles',
                    placeHolder: 'e.g., python developer',
                });

                if (!searchQuery) {
                    return;
                }

                const bundles = await this.registryManager.searchBundles({
                    text: searchQuery
                });

                if (bundles.length === 0) {
                    vscode.window.showInformationMessage(`No bundles found for "${searchQuery}"`);
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    bundles.map(b => ({
                        label: b.name,
                        description: `v${b.version}`,
                        bundle: b
                    })),
                    {
                        placeHolder: 'Select bundle to view',
                        title: 'Bundle Search'
                    }
                );

                if (!selected) {
                    return;
                }

                bundleId = selected.bundle.id;
            }

            // Get bundle details
            const bundle = await this.registryManager.getBundleDetails(bundleId);

            // Check if installed
            const installed = await this.registryManager.listInstalledBundles();
            const isInstalled = installed.some(ib => ib.bundleId === bundleId);

            // Show quick pick with bundle info and actions
            const action = await vscode.window.showQuickPick([
                {
                    label: '$(info) Bundle Information',
                    description: '',
                    detail: this.formatBundleInfo(bundle, isInstalled),
                    value: 'info',
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...(isInstalled ? [] : [{
                    label: '$(cloud-download) Install',
                    description: 'Install this bundle',
                    value: 'install'
                }]),
                ...(isInstalled ? [{
                    label: '$(trash) Uninstall',
                    description: 'Remove this bundle',
                    value: 'uninstall'
                }] : []),
                ...(isInstalled ? [{
                    label: '$(sync) Check for Updates',
                    description: 'Check if newer version available',
                    value: 'update'
                }] : []),
                {
                    label: '$(link-external) View in Browser',
                    description: 'Open bundle repository',
                    value: 'browser'
                }
            ], {
                placeHolder: bundle.name,
                title: 'Bundle Details'
            });

            if (action) {
                switch (action.value) {
                    case 'install':
                        await this.installBundle(bundleId);
                        break;
                    case 'uninstall':
                        await this.uninstallBundle(bundleId);
                        break;
                    case 'update':
                        await this.updateBundle(bundleId);
                        break;
                    case 'browser':
                        // TODO: Open in browser once we have repository URL in bundle metadata
                        vscode.window.showInformationMessage('Repository URL not available');
                        break;
                }
            }

        } catch (error) {
            this.logger.error('Failed to view bundle', error as Error);
            vscode.window.showErrorMessage(`Failed to load bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Browse bundles by category
     */
    async browseByCategory(): Promise<void> {
        try {
            const category = await vscode.window.showQuickPick(
                [
                    { label: '💻 Development', value: 'development' },
                    { label: '🎨 Design', value: 'design' },
                    { label: '📝 Documentation', value: 'documentation' },
                    { label: '🧪 Testing', value: 'testing' },
                    { label: '🔧 DevOps', value: 'devops' },
                    { label: '📊 Data Science', value: 'data-science' },
                    { label: '🤖 AI/ML', value: 'ai-ml' },
                    { label: '🌐 Web Development', value: 'web-dev' },
                ],
                {
                    placeHolder: 'Select a category',
                    title: 'Browse Bundles by Category'
                }
            );

            if (!category) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Loading ${category.label} bundles...`,
                    cancellable: false
                },
                async () => {
                    const bundles = await this.registryManager.searchBundles({
                        tags: [category.value]
                    });

                    if (bundles.length === 0) {
                        vscode.window.showInformationMessage(
                            `No bundles found in ${category.label}`
                        );
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(
                        bundles.map(b => ({
                            label: b.name,
                            description: `v${b.version} • ${b.author}`,
                            detail: b.description,
                            bundle: b
                        })),
                        {
                            placeHolder: `${bundles.length} bundle(s) in ${category.label}`,
                            title: 'Select Bundle'
                        }
                    );

                    if (selected) {
                        await this.viewBundle(selected.bundle.id);
                    }
                }
            );

        } catch (error) {
            this.logger.error('Failed to browse bundles', error as Error);
            vscode.window.showErrorMessage(`Browse failed: ${(error as Error).message}`);
        }
    }

    /**
     * Show popular bundles
     */
    async showPopular(): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Loading popular bundles...',
                    cancellable: false
                },
                async () => {
                    const bundles = await this.registryManager.searchBundles({
                        sortBy: 'downloads'
                    });

                    if (bundles.length === 0) {
                        vscode.window.showInformationMessage('No bundles available');
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(
                        bundles.slice(0, 20).map(b => ({
                            label: b.name,
                            description: `v${b.version} • ${b.author}`,
                            detail: b.description,
                            bundle: b
                        })),
                        {
                            placeHolder: 'Popular bundles',
                            title: 'Most Downloaded Bundles'
                        }
                    );

                    if (selected) {
                        await this.viewBundle(selected.bundle.id);
                    }
                }
            );

        } catch (error) {
            this.logger.error('Failed to show popular bundles', error as Error);
            vscode.window.showErrorMessage(`Failed to load bundles: ${(error as Error).message}`);
        }
    }

    /**
     * List installed bundles
     */
    async listInstalled(): Promise<void> {
        try {
            const installed = await this.registryManager.listInstalledBundles();

            if (installed.length === 0) {
                vscode.window.showInformationMessage(
                    'No bundles installed yet.',
                    'Browse Bundles'
                ).then(action => {
                    if (action === 'Browse Bundles') {
                        this.searchAndInstall();
                    }
                });
                return;
            }

            const selected = await vscode.window.showQuickPick(
                await Promise.all(installed.map(async ib => {
                    try {
                        const bundle = await this.registryManager.getBundleDetails(ib.bundleId);
                        return {
                            label: bundle.name,
                            description: `v${ib.version} • ${ib.scope}`,
                            detail: `Installed: ${new Date(ib.installedAt).toLocaleDateString()}`,
                            installed: ib
                        };
                    } catch {
                        return {
                            label: ib.bundleId,
                            description: `v${ib.version} • ${ib.scope}`,
                            detail: `Installed: ${new Date(ib.installedAt).toLocaleDateString()}`,
                            installed: ib
                        };
                    }
                })),
                {
                    placeHolder: `${installed.length} bundle(s) installed`,
                    title: 'Installed Bundles'
                }
            );

            if (selected) {
                await this.viewBundle(selected.installed.bundleId);
            }

        } catch (error) {
            this.logger.error('Failed to list installed bundles', error as Error);
            vscode.window.showErrorMessage(`Failed to load bundles: ${(error as Error).message}`);
        }
    }

    // ===== Helper Methods =====

    /**
     * Format bundle info for display
     */
    private formatBundleInfo(bundle: Bundle, isInstalled: boolean): string {
        const parts: string[] = [];
        
        parts.push(`Name: ${bundle.name}`);
        parts.push(`Version: ${bundle.version}`);
        parts.push(`Author: ${bundle.author}`);
        parts.push(`Description: ${bundle.description}`);
        
        if (bundle.tags && bundle.tags.length > 0) {
            parts.push(`Tags: ${bundle.tags.join(', ')}`);
        }
        
        if (isInstalled) {
            parts.push(`Status: ✓ Installed`);
        } else {
            parts.push(`Status: Not installed`);
        }
        
        return parts.join('\n');
    }
}
