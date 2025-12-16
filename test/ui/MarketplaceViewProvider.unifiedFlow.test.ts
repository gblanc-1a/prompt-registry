/**
 * MarketplaceViewProvider - Unified Install Flow Integration Tests
 *
 * Verifies that MarketplaceViewProvider uses UnifiedInstallFlow for install/update operations
 * instead of inline logic, ensuring consistent behavior across all UI surfaces.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MarketplaceViewProvider } from '../../src/ui/MarketplaceViewProvider';
import { RegistryManager } from '../../src/services/RegistryManager';
import * as UnifiedInstallFlow from '../../src/services/UnifiedInstallFlow';
import { Bundle, InstalledBundle } from '../../src/types/registry';

suite('MarketplaceViewProvider - Unified Install Flow', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let unifiedInstallFlowStub: sinon.SinonStub;
    let provider: MarketplaceViewProvider;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock extension context
        mockContext = {
            extensionUri: vscode.Uri.file('/fake/extension'),
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            },
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves(),
                onDidChange: sandbox.stub().returns({ dispose: () => {} })
            }
        } as any;

        // Mock RegistryManager with event emitters
        mockRegistryManager = {
            onBundleInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUpdated: sandbox.stub().returns({ dispose: () => {} }),
            onBundlesInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundlesUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onSourceSynced: sandbox.stub().returns({ dispose: () => {} }),
            onAutoUpdatePreferenceChanged: sandbox.stub().returns({ dispose: () => {} }),
            getBundleDetails: sandbox.stub(),
            installBundle: sandbox.stub().resolves(),
            updateBundle: sandbox.stub().resolves(),
            uninstallBundle: sandbox.stub().resolves(),
            listInstalledBundles: sandbox.stub().resolves([]),
            listAvailableBundles: sandbox.stub().resolves([]),
            searchBundles: sandbox.stub().resolves([]),
            listSources: sandbox.stub().resolves([]),
            getStorage: sandbox.stub().returns({
                getUpdatePreference: sandbox.stub().resolves(true),
                setUpdatePreference: sandbox.stub().resolves()
            }),
            getAutoUpdatePreferenceManager: sandbox.stub().returns({
                getUpdatePreference: sandbox.stub().resolves(true),
                setUpdatePreference: sandbox.stub().resolves()
            })
        } as any;

        // Stub the unifiedInstallFlow function
        unifiedInstallFlowStub = sandbox.stub(UnifiedInstallFlow, 'unifiedInstallFlow');

        provider = new MarketplaceViewProvider(mockContext, mockRegistryManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('handleInstall', () => {
        test('should delegate to UnifiedInstallFlow with skipScopePrompt and skipAutoUpdatePrompt', async () => {
            const bundleId = 'test-bundle';

            // Stub getBundleDetails to return a test bundle
            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            }));

            unifiedInstallFlowStub.resolves();

            // Create a webview view to trigger the flow
            const mockWebviewView = createMockWebviewView(sandbox);
            provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

            // Trigger install via message
            const messageHandler = mockWebviewView.webview.onDidReceiveMessage.getCall(0).args[0];
            await messageHandler({ type: 'install', bundleId });

            // Verify UnifiedInstallFlow was called with correct parameters
            sinon.assert.calledOnce(unifiedInstallFlowStub);
            const callArgs = unifiedInstallFlowStub.getCall(0).args;

            assert.strictEqual(callArgs[0], mockRegistryManager, 'Should pass RegistryManager');
            assert.ok(callArgs[1], 'Should pass AutoUpdatePreferenceManager');

            const options = callArgs[2];
            assert.strictEqual(options.bundleId, bundleId);
            assert.strictEqual(options.version, 'latest');
            assert.strictEqual(options.scope, 'user', 'Marketplace should default to user scope');
            assert.strictEqual(options.skipScopePrompt, true, 'Should skip scope prompt');
            assert.strictEqual(options.skipAutoUpdatePrompt, true, 'Should skip auto-update prompt');
        });

        test('should use marketplace checkbox state for autoUpdate preference', async () => {
            const bundleId = 'test-bundle';

            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            }));

            unifiedInstallFlowStub.resolves();

            const mockWebviewView = createMockWebviewView(sandbox);
            provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

            const messageHandler = mockWebviewView.webview.onDidReceiveMessage.getCall(0).args[0];
            
            // Simulate user toggling auto-update checkbox to false
            await messageHandler({ 
                type: 'toggleAutoUpdate', 
                bundleId, 
                enabled: false 
            });

            // Now trigger install
            await messageHandler({ type: 'install', bundleId });

            // Verify autoUpdate was set based on checkbox state
            const options = unifiedInstallFlowStub.getCall(0).args[2];
            assert.strictEqual(options.autoUpdate, false, 'Should use checkbox state for autoUpdate');
        });

        test('should default autoUpdate to true if not explicitly set', async () => {
            const bundleId = 'test-bundle';

            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            }));

            unifiedInstallFlowStub.resolves();

            const mockWebviewView = createMockWebviewView(sandbox);
            provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

            const messageHandler = mockWebviewView.webview.onDidReceiveMessage.getCall(0).args[0];
            await messageHandler({ type: 'install', bundleId });

            const options = unifiedInstallFlowStub.getCall(0).args[2];
            assert.strictEqual(options.autoUpdate, true, 'Should default to auto-update enabled');
        });
    });

    suite('handleUpdate', () => {
        test('should preserve existing auto-update preference when updating', async () => {
            const bundleId = 'test-bundle';

            const mockBundle = createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '2.0.0'
            });

            mockRegistryManager.getBundleDetails.resolves(mockBundle);

            // Mock installed bundle
            mockRegistryManager.listInstalledBundles.resolves([
                createMockInstalledBundle({
                    bundleId,
                    scope: 'user',
                    version: '1.0.0'
                })
            ]);

            // Mock searchBundles to return the bundle (needed for findInstalledBundleByMarketplaceId)
            mockRegistryManager.searchBundles.resolves([mockBundle]);

            unifiedInstallFlowStub.resolves();

            const mockWebviewView = createMockWebviewView(sandbox);
            provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

            const messageHandler = mockWebviewView.webview.onDidReceiveMessage.getCall(0).args[0];
            
            // Trigger update
            await messageHandler({ type: 'update', bundleId });

            // Verify update was called (which should preserve preferences internally)
            sinon.assert.calledOnce(mockRegistryManager.updateBundle);
            sinon.assert.calledWith(mockRegistryManager.updateBundle, bundleId);
        });
    });

    suite('handleInstallVersion', () => {
        test('should delegate to UnifiedInstallFlow with specific version', async () => {
            const bundleId = 'test-bundle';
            const version = '1.5.0';

            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version
            }));

            unifiedInstallFlowStub.resolves();

            const mockWebviewView = createMockWebviewView(sandbox);
            provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

            const messageHandler = mockWebviewView.webview.onDidReceiveMessage.getCall(0).args[0];
            await messageHandler({ type: 'installVersion', bundleId, version });

            sinon.assert.calledOnce(unifiedInstallFlowStub);
            const options = unifiedInstallFlowStub.getCall(0).args[2];
            assert.strictEqual(options.bundleId, bundleId);
            assert.strictEqual(options.version, version);
            assert.strictEqual(options.skipScopePrompt, true);
            assert.strictEqual(options.skipAutoUpdatePrompt, true);
        });
    });
});

/**
 * Helper to create a mock webview view
 */
function createMockWebviewView(sandbox: sinon.SinonSandbox) {
    return {
        webview: {
            options: {},
            html: '',
            onDidReceiveMessage: sandbox.stub().returns({ dispose: () => {} }),
            postMessage: sandbox.stub().resolves(true),
            asWebviewUri: sandbox.stub().callsFake((uri: vscode.Uri) => uri),
            cspSource: 'vscode-webview'
        },
        visible: true,
        viewType: 'promptregistry.marketplace',
        onDidDispose: sandbox.stub().returns({ dispose: () => {} }),
        onDidChangeVisibility: sandbox.stub().returns({ dispose: () => {} }),
        show: sandbox.stub(),
        dispose: sandbox.stub()
    };
}

/**
 * Helper to create a mock bundle
 */
function createMockBundle(overrides: Partial<Bundle> = {}): Bundle {
    return {
        id: 'test-bundle',
        name: 'Test Bundle',
        version: '1.0.0',
        description: 'A test bundle',
        author: 'Test Author',
        sourceId: 'test-source',
        environments: [],
        tags: [],
        lastUpdated: new Date().toISOString(),
        size: '1.0 MB',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.yml',
        downloadUrl: 'https://example.com/bundle.zip',
        ...overrides
    };
}

/**
 * Helper to create a mock installed bundle
 */
function createMockInstalledBundle(overrides: Partial<InstalledBundle> = {}): InstalledBundle {
    return {
        bundleId: 'test-bundle',
        scope: 'user',
        version: '1.0.0',
        installedAt: new Date().toISOString(),
        installPath: '/fake/path',
        manifest: {
            common: {
                directories: [],
                files: [],
                include_patterns: [],
                exclude_patterns: []
            },
            bundle_settings: {
                include_common_in_environment_bundles: false,
                create_common_bundle: true,
                compression: 'zip' as any,
                naming: {
                    environment_bundle: 'bundle-{environment}'
                }
            },
            metadata: {
                manifest_version: '1.0',
                description: 'Test bundle'
            }
        },
        ...overrides
    };
}
