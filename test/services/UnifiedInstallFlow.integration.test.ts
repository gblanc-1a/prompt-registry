/**
 * UnifiedInstallFlow - Higher-level Integration Tests
 *
 * Tests the real UnifiedInstallFlow function with stubbed RegistryManager
 * to catch signature changes and verify end-to-end prompt flows.
 * 
 * This complements the unit tests which stub unifiedInstallFlow itself.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { unifiedInstallFlow } from '../../src/services/UnifiedInstallFlow';
import { AutoUpdatePreferenceManager } from '../../src/services/AutoUpdatePreferenceManager';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { Bundle } from '../../src/types/registry';
import { Logger } from '../../src/utils/logger';

suite('UnifiedInstallFlow - Integration Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let preferenceManager: AutoUpdatePreferenceManager;
    let loggerStub: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub logger
        const loggerInstance = Logger.getInstance();
        loggerStub = sandbox.stub(loggerInstance);
        loggerStub.debug.returns();
        loggerStub.info.returns();
        loggerStub.warn.returns();
        loggerStub.error.returns();

        // Create real storage stub
        mockStorage = {
            getUpdatePreference: sandbox.stub().resolves(false),
            setUpdatePreference: sandbox.stub().resolves(),
        } as any;

        // Create REAL AutoUpdatePreferenceManager (not stubbed)
        // This is the integration point we're testing
        preferenceManager = new AutoUpdatePreferenceManager(mockStorage as any);

        // Mock RegistryManager
        mockRegistryManager = {
            installBundle: sandbox.stub().resolves(),
            getBundleDetails: sandbox.stub().resolves(createMockBundle({
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0'
            })),
        } as any;

        // Mock VS Code workspace configuration
        const mockConfig = {
            get: sandbox.stub().withArgs('updateCheck.autoUpdate', true).returns(true),
        };
        sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as any);
    });

    teardown(() => {
        if (preferenceManager) {
            preferenceManager.dispose();
        }
        sandbox.restore();
    });

    suite('Complete flow with user prompts', () => {
        test('should execute full prompt flow and persist preferences', async () => {
            const bundleId = 'integration-test-bundle';
            
            // Mock user selections
            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPickStub.onFirstCall().resolves({ value: 'user' } as any); // scope
            showQuickPickStub.onSecondCall().resolves({ value: true } as any);  // autoUpdate

            const withProgressStub = sandbox.stub(vscode.window, 'withProgress');
            withProgressStub.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();

            // Execute the real UnifiedInstallFlow
            await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                bundleId,
                version: 'latest'
            });

            // Verify the complete flow executed correctly
            assert.ok(showQuickPickStub.calledTwice, 'Should prompt for scope and autoUpdate');
            assert.ok(mockRegistryManager.installBundle.calledOnce, 'Should call installBundle');
            assert.ok(mockRegistryManager.installBundle.calledWith(bundleId, {
                scope: 'user',
                version: 'latest'
            }), 'Should pass correct install options');

            // Verify preference was persisted through the REAL AutoUpdatePreferenceManager
            assert.ok(mockStorage.setUpdatePreference.calledOnceWith(bundleId, true),
                'Should persist auto-update preference via real AutoUpdatePreferenceManager');

            // Verify success message shown
            assert.ok(showInfoStub.calledOnce, 'Should show success message');
        });

        test('should handle user cancellation at scope prompt', async () => {
            const bundleId = 'cancelled-bundle';

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPickStub.resolves(undefined); // User cancels

            await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                bundleId,
                version: 'latest'
            });

            // Verify flow stopped early
            assert.ok(showQuickPickStub.calledOnce, 'Should prompt for scope');
            assert.ok(mockRegistryManager.installBundle.notCalled, 'Should not install when cancelled');
            assert.ok(mockStorage.setUpdatePreference.notCalled, 'Should not set preference when cancelled');
        });

        test('should handle user cancellation at auto-update prompt', async () => {
            const bundleId = 'cancelled-bundle';

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPickStub.onFirstCall().resolves({ value: 'workspace' } as any);
            showQuickPickStub.onSecondCall().resolves(undefined); // User cancels

            await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                bundleId,
                version: 'latest'
            });

            // Verify flow stopped after scope selection
            assert.ok(showQuickPickStub.calledTwice, 'Should prompt for both scope and autoUpdate');
            assert.ok(mockRegistryManager.installBundle.notCalled, 'Should not install when cancelled');
        });
    });

    suite('Skip prompts mode (marketplace/command usage)', () => {
        test('should skip all prompts when scope and autoUpdate provided', async () => {
            const bundleId = 'skip-prompts-bundle';

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
            const withProgressStub = sandbox.stub(vscode.window, 'withProgress');
            withProgressStub.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();

            await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                bundleId,
                version: '2.1.0',
                scope: 'workspace',
                autoUpdate: false,
                skipScopePrompt: true,
                skipAutoUpdatePrompt: true
            });

            // Verify no prompts shown
            assert.ok(showQuickPickStub.notCalled, 'Should not show any prompts');

            // Verify installation with provided values
            assert.ok(mockRegistryManager.installBundle.calledOnceWith(bundleId, {
                scope: 'workspace',
                version: '2.1.0'
            }));

            // Verify preference set with provided value
            assert.ok(mockStorage.setUpdatePreference.calledOnceWith(bundleId, false));
        });

        test('should throw when skipScopePrompt=true but scope not provided', async () => {
            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                    bundleId: 'test',
                    skipScopePrompt: true,
                    autoUpdate: true
                }),
                /scope is required when skipScopePrompt is true/i
            );
        });

        test('should throw when skipAutoUpdatePrompt=true but autoUpdate not provided', async () => {
            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                    bundleId: 'test',
                    scope: 'user',
                    skipAutoUpdatePrompt: true
                }),
                /autoUpdate is required when skipAutoUpdatePrompt is true/i
            );
        });
    });

    suite('Event emission through AutoUpdatePreferenceManager', () => {
        test('should fire preference changed event with correct payload', async () => {
            const bundleId = 'event-test-bundle';
            let eventFired = false;
            let eventPayload: any;

            // Listen to the REAL AutoUpdatePreferenceManager's event
            preferenceManager.onPreferenceChanged((event) => {
                eventFired = true;
                eventPayload = event;
            });

            const withProgressStub = sandbox.stub(vscode.window, 'withProgress');
            withProgressStub.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();

            await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                bundleId,
                scope: 'user',
                autoUpdate: true
            });

            // Verify event was fired through real AutoUpdatePreferenceManager
            assert.strictEqual(eventFired, true, 'Event should be fired');
            assert.deepStrictEqual(eventPayload, {
                bundleId,
                autoUpdate: true,
                globalEnabled: true
            }, 'Event should contain correct payload');
        });
    });

    suite('Error handling', () => {
        test('should propagate installation errors without setting preference', async () => {
            const installError = new Error('Installation failed');
            mockRegistryManager.installBundle.rejects(installError);

            const withProgressStub = sandbox.stub(vscode.window, 'withProgress');
            withProgressStub.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, preferenceManager, {
                    bundleId: 'error-bundle',
                    scope: 'user',
                    autoUpdate: true
                }),
                installError
            );

            // Verify preference was NOT set when installation failed
            assert.ok(mockStorage.setUpdatePreference.notCalled,
                'Should not set preference when installation fails');
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
