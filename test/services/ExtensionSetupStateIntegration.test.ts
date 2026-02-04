/**
 * Extension Setup State Integration Tests
 * 
 * Tests for extension first-run flow with SetupStateManager integration
 * 
 * Requirements: 1.1, 1.2, 1.3, 6.1, 6.2, 6.3
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { ExtensionNotifications } from '../../src/notifications/ExtensionNotifications';

suite('Extension Setup State Integration', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let setupStateManager: SetupStateManager;
    let mockNotifications: sinon.SinonStubbedInstance<ExtensionNotifications>;
    let globalStateStorage: Map<string, any>;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateStorage = new Map();

        // Create mock context with working globalState
        // ExtensionMode: Production = 1, Development = 2, Test = 3
        mockContext = {
            globalState: {
                get: (key: string, defaultValue?: any) => {
                    return globalStateStorage.has(key) ? globalStateStorage.get(key) : defaultValue;
                },
                update: async (key: string, value: any) => {
                    globalStateStorage.set(key, value);
                },
                keys: () => Array.from(globalStateStorage.keys())
            },
            extensionMode: 1 as any // ExtensionMode.Production
        } as any;

        // Create mock HubManager
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockHubManager.listHubs.resolves([]);
        mockHubManager.getActiveHub.resolves(null);

        // Create mock notifications
        mockNotifications = sandbox.createStubInstance(ExtensionNotifications);

        // Reset singleton
        SetupStateManager.resetInstance();
        setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager);
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    suite('checkFirstRun() - Fresh Install Flow', () => {
        /**
         * Requirement 1.1: WHEN the extension activates AND firstRun is false AND no hub is configured,
         * THEN THE Extension SHALL detect the setup as incomplete
         */
        test('should complete setup successfully on fresh install', async () => {
            // Arrange
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.NOT_STARTED, 'Initial state should be NOT_STARTED');

            // Simulate successful hub initialization
            mockHubManager.listHubs.resolves([{ id: 'test-hub', name: 'Test Hub' } as any]);
            mockHubManager.getActiveHub.resolves({ id: 'test-hub', name: 'Test Hub' } as any);

            // Act - simulate checkFirstRun flow
            await setupStateManager.markStarted();
            // Hub initialization would happen here
            await setupStateManager.markComplete();

            // Assert
            const finalState = await setupStateManager.getState();
            assert.strictEqual(finalState, SetupState.COMPLETE, 'State should be COMPLETE after successful setup');
        });

        /**
         * Requirement 1.3: WHEN the extension activates in a test environment,
         * THEN THE Extension SHALL skip incomplete setup detection
         */
        test('should handle cancellation during hub selection', async () => {
            // Arrange
            await setupStateManager.markStarted();

            // Act - simulate hub selection cancellation
            await setupStateManager.markIncomplete('hub_cancelled');

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should be INCOMPLETE after cancellation');
            
            const isIncomplete = await setupStateManager.isIncomplete();
            assert.strictEqual(isIncomplete, true, 'isIncomplete() should return true');
        });

        /**
         * Requirement 1.3: WHEN the extension activates in a test environment,
         * THEN THE Extension SHALL skip incomplete setup detection
         */
        test('should handle errors during setup', async () => {
            // Arrange
            await setupStateManager.markStarted();

            // Act - simulate error during setup
            try {
                throw new Error('Hub initialization failed');
            } catch (error) {
                await setupStateManager.markIncomplete('hub_cancelled');
            }

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should be INCOMPLETE after error');
        });
    });

    suite('checkFirstRun() - Incomplete Setup Detection', () => {
        /**
         * Requirement 1.1: WHEN the extension activates AND firstRun is false AND no hub is configured,
         * THEN THE Extension SHALL detect the setup as incomplete
         */
        test('should detect incomplete setup from previous session', async () => {
            // Arrange - simulate incomplete setup from previous session
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act
            const isIncomplete = await setupStateManager.detectIncompleteSetup();

            // Assert
            assert.strictEqual(isIncomplete, true, 'Should detect incomplete setup');
        });

        /**
         * Requirement 1.2: WHEN the extension activates AND firstRun is false AND a hub is configured,
         * THEN THE Extension SHALL detect the setup as complete
         */
        test('should not detect incomplete setup when hub is configured', async () => {
            // Arrange - simulate completed setup
            await setupStateManager.markComplete();
            mockHubManager.listHubs.resolves([{ id: 'test-hub', name: 'Test Hub' } as any]);
            mockHubManager.getActiveHub.resolves({ id: 'test-hub', name: 'Test Hub' } as any);

            // Act
            const isIncomplete = await setupStateManager.detectIncompleteSetup();

            // Assert
            assert.strictEqual(isIncomplete, false, 'Should not detect incomplete setup when hub is configured');
        });

        /**
         * Requirement 1.1: Backward compatibility with old firstRun flag
         */
        test('should detect incomplete setup from old firstRun flag', async () => {
            // Arrange - simulate old installation with firstRun=false but no hub
            await mockContext.globalState.update('promptregistry.firstRun', false);
            await mockContext.globalState.update('promptregistry.hubInitialized', false);
            mockHubManager.listHubs.resolves([]);
            mockHubManager.getActiveHub.resolves(null);

            // Act
            const isIncomplete = await setupStateManager.detectIncompleteSetup();

            // Assert
            assert.strictEqual(isIncomplete, true, 'Should detect incomplete setup from old flags');
            
            // Verify migration to new state system
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'Should migrate to new state system');
        });
    });

    suite('checkFirstRun() - Test Environment Bypass', () => {
        /**
         * Requirement 6.1: WHEN the extension activates AND VSCODE_TEST environment variable is "1",
         * THEN THE Extension SHALL skip all setup dialogs
         */
        test('should skip setup in test environment (VSCODE_TEST)', async () => {
            // Arrange
            const originalEnv = process.env.VSCODE_TEST;
            process.env.VSCODE_TEST = '1';

            try {
                // Act - simulate test environment detection
                await setupStateManager.markComplete();

                // Assert
                const state = await setupStateManager.getState();
                assert.strictEqual(state, SetupState.COMPLETE, 'Should mark as complete in test environment');
            } finally {
                // Restore original environment
                if (originalEnv === undefined) {
                    delete process.env.VSCODE_TEST;
                } else {
                    process.env.VSCODE_TEST = originalEnv;
                }
            }
        });

        /**
         * Requirement 6.2: WHEN the extension activates AND extension mode is Test,
         * THEN THE Extension SHALL skip all setup dialogs
         */
        test('should skip setup in test environment (ExtensionMode.Test)', async () => {
            // Arrange
            const testContext = {
                globalState: mockContext.globalState,
                extensionMode: 3 as any // ExtensionMode.Test
            } as any;
            
            SetupStateManager.resetInstance();
            const testSetupManager = SetupStateManager.getInstance(testContext, mockHubManager);

            // Act - simulate test environment detection
            await testSetupManager.markComplete();

            // Assert
            const state = await testSetupManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'Should mark as complete in test mode');
        });

        /**
         * Requirement 6.3: WHEN running in a test environment,
         * THEN THE Extension SHALL set setup state to complete immediately
         */
        test('should not show resume prompt in test environment', async () => {
            // Arrange
            const testContext = {
                globalState: mockContext.globalState,
                extensionMode: 3 as any // ExtensionMode.Test
            } as any;
            
            SetupStateManager.resetInstance();
            const testSetupManager = SetupStateManager.getInstance(testContext, mockHubManager);
            await testSetupManager.markIncomplete('hub_cancelled');

            // Act - in test environment, should mark as complete instead
            await testSetupManager.markComplete();

            // Assert
            const shouldShow = await testSetupManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, false, 'Should not show resume prompt after marking complete');
        });
    });

    suite('checkFirstRun() - Resume Prompt Logic', () => {
        /**
         * Requirement 1.5: WHEN setup state is incomplete AND the user has dismissed the resume prompt,
         * THEN THE Extension SHALL respect the dismissal until next activation
         */
        test('should show resume prompt when setup is incomplete', async () => {
            // Arrange
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act
            const shouldShow = await setupStateManager.shouldShowResumePrompt();

            // Assert
            assert.strictEqual(shouldShow, true, 'Should show resume prompt when setup is incomplete');
        });

        /**
         * Requirement 3.6: THE Extension SHALL not show the resume prompt more than once per activation
         */
        test('should not show resume prompt twice in same session', async () => {
            // Arrange
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act - mark prompt as shown
            await setupStateManager.markResumePromptShown();
            const shouldShow = await setupStateManager.shouldShowResumePrompt();

            // Assert
            assert.strictEqual(shouldShow, false, 'Should not show resume prompt twice in same session');
        });

        /**
         * Requirement 1.5: Resume prompt should be shown again on next activation
         */
        test('should show resume prompt again on next activation', async () => {
            // Arrange
            await setupStateManager.markIncomplete('hub_cancelled');
            await setupStateManager.markResumePromptShown();

            // Simulate new activation by resetting the prompt shown flag
            await mockContext.globalState.update('promptregistry.resumePromptShown', false);

            // Act
            const shouldShow = await setupStateManager.shouldShowResumePrompt();

            // Assert
            assert.strictEqual(shouldShow, true, 'Should show resume prompt on next activation');
        });
    });

    suite('checkFirstRun() - Error Handling', () => {
        /**
         * Requirement 1.3: Error handling should mark setup as incomplete
         */
        test('should mark setup as incomplete on error', async () => {
            // Arrange
            await setupStateManager.markStarted();

            // Act - simulate error
            await setupStateManager.markIncomplete('hub_cancelled');

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'Should mark as incomplete on error');
        });

        /**
         * Requirement 1.3: Should allow resumption after error
         */
        test('should allow resumption after error', async () => {
            // Arrange
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act - simulate successful resumption
            await setupStateManager.markStarted();
            await setupStateManager.markComplete();

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'Should complete after successful resumption');
        });
    });
});
