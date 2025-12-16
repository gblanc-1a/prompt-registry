/**
 * BundleInstallationCommands - Unified Install Flow Integration Tests
 *
 * Verifies that BundleInstallationCommands uses UnifiedInstallFlow for install operations
 * ensuring consistent behavior with MarketplaceViewProvider.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BundleInstallationCommands } from '../../src/commands/BundleInstallationCommands';
import { RegistryManager } from '../../src/services/RegistryManager';
import * as UnifiedInstallFlow from '../../src/services/UnifiedInstallFlow';
import { Bundle } from '../../src/types/registry';

suite('BundleInstallationCommands - Unified Install Flow', () => {
    let sandbox: sinon.SinonSandbox;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let unifiedInstallFlowStub: sinon.SinonStub;
    let commands: BundleInstallationCommands;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock RegistryManager
        mockRegistryManager = {
            getBundleDetails: sandbox.stub(),
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

        commands = new BundleInstallationCommands(mockRegistryManager as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('installBundle', () => {
        test('should delegate to UnifiedInstallFlow with user prompts', async () => {
            const bundleId = 'test-bundle';

            const mockBundle = createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            });

            mockRegistryManager.getBundleDetails.resolves(mockBundle);
            unifiedInstallFlowStub.resolves();

            // Call installBundle
            await commands.installBundle(bundleId);

            // Verify UnifiedInstallFlow was called
            sinon.assert.calledOnce(unifiedInstallFlowStub);
            const callArgs = unifiedInstallFlowStub.getCall(0).args;

            assert.strictEqual(callArgs[0], mockRegistryManager, 'Should pass RegistryManager');
            assert.ok(callArgs[1], 'Should pass AutoUpdatePreferenceManager');

            const options = callArgs[2];
            assert.strictEqual(options.bundleId, bundleId);
            assert.strictEqual(options.version, 'latest');
            assert.strictEqual(options.skipScopePrompt, undefined, 'Should allow scope prompt');
            assert.strictEqual(options.skipAutoUpdatePrompt, undefined, 'Should allow auto-update prompt');
            assert.strictEqual(options.showProgressNotification, true);
            assert.strictEqual(options.showSuccessMessage, false, 'Should not show UnifiedInstallFlow success message');
        });

        test('should not skip scope and auto-update prompts (command always prompts)', async () => {
            const bundleId = 'test-bundle';

            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            }));

            unifiedInstallFlowStub.resolves();

            await commands.installBundle(bundleId);

            const options = unifiedInstallFlowStub.getCall(0).args[2];
            
            // Commands should not skip prompts (unlike Marketplace which has UI controls)
            assert.strictEqual(options.skipScopePrompt, undefined);
            assert.strictEqual(options.skipAutoUpdatePrompt, undefined);
        });

        test('should use custom success message with action buttons', async () => {
            const bundleId = 'test-bundle';

            mockRegistryManager.getBundleDetails.resolves(createMockBundle({
                id: bundleId,
                name: 'Test Bundle',
                version: '1.0.0'
            }));

            unifiedInstallFlowStub.resolves();

            // Stub showInformationMessage to verify success message
            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();

            await commands.installBundle(bundleId);

            // Verify custom success message was shown (not the default from UnifiedInstallFlow)
            sinon.assert.calledOnce(showInfoStub);
            const messageCall = showInfoStub.getCall(0);
            assert.ok(messageCall.args[0].includes('Test Bundle installed successfully'));
            assert.ok(messageCall.args.includes('View Bundle'));
            assert.ok(messageCall.args.includes('Install More'));
        });
    });
});

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
