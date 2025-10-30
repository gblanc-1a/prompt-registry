/**
 * Marketplace View Provider
 * Displays a visual marketplace for browsing and installing prompt bundles
 * Similar to open-vsx.org marketplace experience
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle, InstalledBundle } from '../types/registry';

export class MarketplaceViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptregistry.marketplace';

    private _view?: vscode.WebviewView;
    private logger: Logger;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly registryManager: RegistryManager
    ) {
        this.logger = Logger.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Load and send bundles data
        this.loadBundles();
    }

    /**
     * Load bundles from registries and send to webview
     */
    private async loadBundles(): Promise<void> {
        try {
            this.logger.debug('Loading bundles for marketplace');

            // Search for all bundles (empty query)
            const bundles = await this.registryManager.searchBundles({});
            const installedBundles = await this.registryManager.listInstalledBundles();
            
            const enhancedBundles = bundles.map(bundle => {
                const installed = installedBundles.find(ib => ib.bundleId === bundle.id);
                // Use manifest from installed bundle if available
                const contentBreakdown = this.getContentBreakdown(bundle, installed?.manifest);

                return {
                    ...bundle,
                    installed: !!installed,
                    installedVersion: installed?.version,
                    contentBreakdown
                };
            });

            // Send to webview
            this._view?.webview.postMessage({
                type: 'bundlesLoaded',
                bundles: enhancedBundles
            });

            this.logger.debug(`Loaded ${enhancedBundles.length} bundles for marketplace`);

        } catch (error) {
            this.logger.error('Failed to load marketplace bundles', error as Error);
        }
    }

    /**
     * Calculate content breakdown from bundle metadata
     */
    private getContentBreakdown(bundle: Bundle, manifest?: any): {
        prompts: number;
        instructions: number;
        chatmodes: number;
        agents: number;
    } {
        const breakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0
        };

        // First: Use manifest if provided (from installed bundle)
        if (manifest?.prompts && Array.isArray(manifest.prompts)) {
            for (const prompt of manifest.prompts) {
                const type = prompt.type || 'prompt';
                if (type === 'prompt') breakdown.prompts++;
                else if (type === 'instructions') breakdown.instructions++;
                else if (type === 'chatmode') breakdown.chatmodes++;
                else if (type === 'agent') breakdown.agents++;
            }
            return breakdown;
        }

        // Second: Try to parse from bundle data (some sources embed this)
        const bundleData = bundle as any;
        if (bundleData.prompts && Array.isArray(bundleData.prompts)) {
            for (const prompt of bundleData.prompts) {
                const type = prompt.type || 'prompt';
                if (type === 'prompt') breakdown.prompts++;
                else if (type === 'instructions') breakdown.instructions++;
                else if (type === 'chatmode') breakdown.chatmodes++;
                else if (type === 'agent') breakdown.agents++;
            }
            return breakdown;
        }

        // Fallback: estimate from tags (better than nothing)
        if (bundle.tags && bundle.tags.length > 0) {
            const tags = bundle.tags;
            // Count tag occurrences as rough estimate
            const promptTags = tags.filter(t => t.includes('prompt') || t.includes('review') || t.includes('template'));
            const instructionTags = tags.filter(t => t.includes('instruction') || t.includes('guide') || t.includes('standard'));
            const modeTags = tags.filter(t => t.includes('mode') || t.includes('chat'));
            const agentTags = tags.filter(t => t.includes('agent') || t.includes('bot'));
            
            breakdown.prompts = Math.min(promptTags.length || 1, 5); // Default to 1, max 5
            breakdown.instructions = instructionTags.length;
            breakdown.chatmodes = modeTags.length;
            breakdown.agents = agentTags.length;
        }

        return breakdown;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this.loadBundles();
                break;
            case 'install':
                await this.handleInstall(message.bundleId);
                break;
            case 'uninstall':
                await this.handleUninstall(message.bundleId);
                break;
            case 'openDetails':
                await this.openBundleDetails(message.bundleId);
                break;
            case 'openPromptFile':
                await this.openPromptFileInEditor(message.installPath, message.filePath);
                break;
            default:
                this.logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Open a prompt file in the editor
     */
    private async openPromptFileInEditor(installPath: string, filePath: string): Promise<void> {
        try {
            const path = require('path');
            const fullPath = path.join(installPath, filePath);
            
            this.logger.debug(`Opening prompt file: ${fullPath}`);
            
            // Open the file in the editor
            const document = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
            
        } catch (error) {
            this.logger.error('Failed to open prompt file', error as Error);
            vscode.window.showErrorMessage(`Failed to open file: ${(error as Error).message}`);
        }
    }

    /**
     * Install a bundle
     */
    private async handleInstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Installing bundle from marketplace: ${bundleId}`);

            // Use RegistryManager to install
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: 'user',
                    version: 'latest'
                });
            });

            vscode.window.showInformationMessage(`✅ Bundle installed successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to install bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to install bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Uninstall a bundle
     */
    private async handleUninstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Uninstalling bundle from marketplace: ${bundleId}`);

            await this.registryManager.uninstallBundle(bundleId, 'user');

            vscode.window.showInformationMessage(`✅ Bundle uninstalled successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to uninstall bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to uninstall bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Open bundle details in a new webview panel
     */
    private async openBundleDetails(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Opening details for bundle: ${bundleId}`);

            // Get bundle info
            const bundles = await this.registryManager.searchBundles({});
            const bundle = bundles.find(b => b.id === bundleId);
            
            if (!bundle) {
                vscode.window.showErrorMessage('Bundle not found');
                return;
            }

            // Check if installed to get manifest
            const installedBundles = await this.registryManager.listInstalledBundles();
            const installed = installedBundles.find(ib => ib.bundleId === bundleId);
            const breakdown = this.getContentBreakdown(bundle, installed?.manifest);

            // Create webview panel
            const panel = vscode.window.createWebviewPanel(
                'bundleDetails',
                `📦 ${bundle.name}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            // Set HTML content
            panel.webview.html = this.getBundleDetailsHtml(bundle, installed, breakdown);

            // Handle messages from the details panel
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    if (message.type === 'openPromptFile') {
                        await this.openPromptFileInEditor(message.installPath, message.filePath);
                    }
                },
                undefined,
                this.context.subscriptions
            );

        } catch (error) {
            this.logger.error('Failed to open bundle details', error as Error);
            vscode.window.showErrorMessage('Failed to open bundle details');
        }
    }

    /**
     * Get HTML for bundle details panel
     */
    private getBundleDetailsHtml(bundle: Bundle, installed: InstalledBundle | undefined, breakdown: any): string {
        const isInstalled = !!installed;
        const installPath = installed?.installPath || 'Not installed';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${bundle.name}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        h1 {
            font-size: 28px;
            margin: 0 0 8px 0;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .badge {
            display: inline-block;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 12px;
        }
        .section {
            margin-bottom: 32px;
        }
        .section h2 {
            font-size: 20px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .breakdown {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }
        .breakdown-item {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            text-align: center;
        }
        .breakdown-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .breakdown-count {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .breakdown-label {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }
        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
        }
        .info-grid {
            display: grid;
            gap: 12px;
            margin-top: 12px;
        }
        .info-row {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 16px;
        }
        .info-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        .info-value {
            color: var(--vscode-foreground);
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .prompt-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();
        
        function openPromptFile(installPath, filePath) {
            vscode.postMessage({
                type: 'openPromptFile',
                installPath: installPath,
                filePath: filePath
            });
        }
    </script>
</head>
<body>
    <div class="header">
        <h1>
            📦 ${bundle.name}
            ${isInstalled ? '<span class="badge">✓ Installed</span>' : ''}
        </h1>
        <div class="meta">
            by ${bundle.author || 'Unknown'} • Version ${bundle.version}
        </div>
    </div>

    <div class="section">
        <h2>Description</h2>
        <p>${bundle.description || 'No description available'}</p>
    </div>

    <div class="section">
        <h2>📊 Content Breakdown</h2>
        <div class="breakdown">
            <div class="breakdown-item">
                <div class="breakdown-icon">💬</div>
                <div class="breakdown-count">${breakdown.prompts}</div>
                <div class="breakdown-label">Prompts</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">📋</div>
                <div class="breakdown-count">${breakdown.instructions}</div>
                <div class="breakdown-label">Instructions</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🎭</div>
                <div class="breakdown-count">${breakdown.chatmodes}</div>
                <div class="breakdown-label">Chat Modes</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🤖</div>
                <div class="breakdown-count">${breakdown.agents}</div>
                <div class="breakdown-label">Agents</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>ℹ️ Information</h2>
        <div class="info-grid">
            <div class="info-row">
                <div class="info-label">Bundle ID:</div>
                <div class="info-value"><code>${bundle.id}</code></div>
            </div>
            <div class="info-row">
                <div class="info-label">Version:</div>
                <div class="info-value">${bundle.version}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Author:</div>
                <div class="info-value">${bundle.author || 'Unknown'}</div>
            </div>
            ${isInstalled ? `
            <div class="info-row">
                <div class="info-label">Installed At:</div>
                <div class="info-value">${new Date(installed!.installedAt).toLocaleString()}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Install Path:</div>
                <div class="info-value"><code>${installPath}</code></div>
            </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">Environments:</div>
                <div class="info-value">${(bundle.environments || ['any']).join(', ')}</div>
            </div>
        </div>
    </div>

    ${bundle.tags && bundle.tags.length > 0 ? `
    <div class="section">
        <h2>🏷️ Tags</h2>
        <div class="tags">
            ${bundle.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    </div>
    ` : ''}

    ${installed?.manifest?.prompts ? `
    <div class="section">
        <h2>📝 Included Prompts</h2>
        <div class="info-grid">
            ${installed.manifest.prompts.map(p => `
                <div class="info-row prompt-item" onclick="openPromptFile('${installed.installPath}', '${p.file}')" style="cursor: pointer;">
                    <div class="info-label">${p.id}:</div>
                    <div class="info-value">
                        ${p.name} 
                        <em style="color: var(--vscode-descriptionForeground);">(${p.type || 'prompt'})</em>
                        <span style="color: var(--vscode-textLink-foreground); margin-left: 8px;">📄 Open</span>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    ` : ''}
</body>
</html>`;
    }

    /**
     * Get HTML content for marketplace webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompt Marketplace</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        .header {
            margin-bottom: 24px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .controls {
            display: flex;
            gap: 12px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }

        .search-box {
            flex: 1;
            min-width: 200px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 14px;
        }

        .filter-btn {
            padding: 8px 16px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }

        .filter-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .refresh-btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }

        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .marketplace-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .bundle-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .bundle-card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transform: translateY(-2px);
        }

        .bundle-card.installed {
            border-color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .installed-badge {
            position: absolute;
            top: 12px;
            right: 12px;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }

        .bundle-header {
            margin-bottom: 12px;
        }

        .bundle-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .bundle-author {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .bundle-description {
            font-size: 14px;
            color: var(--vscode-foreground);
            margin-bottom: 16px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .content-breakdown {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }

        .content-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        .content-icon {
            font-size: 16px;
        }

        .content-count {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .bundle-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 16px;
        }

        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .bundle-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            flex: 1;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background 0.2s;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .btn-danger:hover {
            opacity: 0.9;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .empty-state-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            display: inline-block;
            width: 24px;
            height: 24px;
            border: 3px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎨 Prompt Marketplace</h1>
        <p>Discover and install curated prompt bundles for GitHub Copilot</p>
    </div>

    <div class="controls">
        <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search bundles...">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="prompts">Prompts</button>
        <button class="filter-btn" data-filter="instructions">Instructions</button>
        <button class="filter-btn" data-filter="chatmodes">Chat Modes</button>
        <button class="filter-btn" data-filter="agents">Agents</button>
        <button class="refresh-btn" id="refreshBtn">↻ Refresh</button>
    </div>

    <div id="marketplace" class="marketplace-grid">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading bundles...</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let allBundles = [];
        let currentFilter = 'all';

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'bundlesLoaded') {
                allBundles = message.bundles;
                renderBundles();
            }
        });

        // Search functionality
        document.getElementById('searchBox').addEventListener('input', (e) => {
            renderBundles(e.target.value);
        });

        // Filter functionality
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderBundles();
            });
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        function renderBundles(searchTerm = '') {
            const marketplace = document.getElementById('marketplace');
            
            let filteredBundles = allBundles;

            // Apply search filter
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                filteredBundles = filteredBundles.filter(bundle => 
                    bundle.name.toLowerCase().includes(term) ||
                    bundle.description.toLowerCase().includes(term) ||
                    (bundle.tags && bundle.tags.some(tag => tag.toLowerCase().includes(term)))
                );
            }

            // Apply content filter
            if (currentFilter !== 'all' && currentFilter) {
                filteredBundles = filteredBundles.filter(bundle => {
                    if (!bundle.contentBreakdown) return false;
                    return bundle.contentBreakdown[currentFilter] > 0;
                });
            }

            if (filteredBundles.length === 0) {
                marketplace.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📦</div>
                        <div class="empty-state-title">No bundles found</div>
                        <p>Try adjusting your search or filters</p>
                    </div>
                \`;
                return;
            }

            marketplace.innerHTML = filteredBundles.map(bundle => \`
                <div class="bundle-card \${bundle.installed ? 'installed' : ''}" data-bundle-id="\${bundle.id}" onclick="openDetails('\${bundle.id}')">
                    \${bundle.installed ? '<div class="installed-badge">✓ Installed</div>' : ''}
                    
                    <div class="bundle-header">
                        <div class="bundle-title">\${bundle.name}</div>
                        <div class="bundle-author">by \${bundle.author || 'Unknown'} • v\${bundle.version}</div>
                    </div>

                    <div class="bundle-description">
                        \${bundle.description || 'No description available'}
                    </div>

                    <div class="content-breakdown">
                        \${renderContentItem('💬', 'Prompts', bundle.contentBreakdown?.prompts || 0)}
                        \${renderContentItem('📋', 'Instructions', bundle.contentBreakdown?.instructions || 0)}
                        \${renderContentItem('🎭', 'Chat Modes', bundle.contentBreakdown?.chatmodes || 0)}
                        \${renderContentItem('🤖', 'Agents', bundle.contentBreakdown?.agents || 0)}
                    </div>

                    <div class="bundle-tags">
                        \${(bundle.tags || []).slice(0, 4).map(tag => \`
                            <span class="tag">\${tag}</span>
                        \`).join('')}
                    </div>

                    <div class="bundle-actions" onclick="event.stopPropagation()">
                        \${bundle.installed 
                            ? \`<button class="btn btn-danger" onclick="uninstallBundle('\${bundle.id}')">Uninstall</button>\`
                            : \`<button class="btn btn-primary" onclick="installBundle('\${bundle.id}')">Install</button>\`
                        }
                        <button class="btn btn-secondary" onclick="openDetails('\${bundle.id}')">Details</button>
                    </div>
                </div>
            \`).join('');
        }

        function renderContentItem(icon, label, count) {
            if (count === 0) return '';
            return \`
                <div class="content-item">
                    <span class="content-icon">\${icon}</span>
                    <span class="content-count">\${count}</span>
                    <span>\${label}</span>
                </div>
            \`;
        }

        function installBundle(bundleId) {
            vscode.postMessage({ type: 'install', bundleId });
        }

        function uninstallBundle(bundleId) {
            vscode.postMessage({ type: 'uninstall', bundleId });
        }

        function openDetails(bundleId) {
            vscode.postMessage({ type: 'openDetails', bundleId });
        }
    </script>
</body>
</html>`;
    }
}
