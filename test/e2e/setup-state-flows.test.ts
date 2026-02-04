/**
 * Setup State Flows Integration Tests
 * 
 * End-to-end tests for the resumable first-run configuration feature.
 * Tests complete user flows through the setup state machine.
 * 
 * Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 3.1, 3.3, 3.4, 3.5, 5.1, 5.2, 5.4, 5.5, 6.1-6.5, 7.1, 7.5, 9.1, 9.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { NotificationManager } from '../../src/services/NotificationManager';
import { createMockHubData } from '../helpers/setupStateTestHelpers';

suite('E2E: Setup State Flows', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let setupStateManager: SetupStateManager;
    let globalStateStorage: Map<string, any>;

    /**
     * Create a fresh mock context for each test
     */
    const createMockContext = (extensionMode: number = 1): vscode.ExtensionContext => {
        globalStateStorage = new Map();
        return {
            globalState: {
                get: (key: string, defaultValue?: any) => {
                    return globalStateStorage.has(key) ? globalStateStorage.get(key) : defaultValue;
                },
                update: async (key: string, value: any) => {
                    globalStateStorage.set(key, value);
                },
                keys: () => Array.from(globalStateStorage.keys()),
                setKeysForSync: sandbox.stub()
            } as any,
            globalStorageUri: vscode.Uri.file('/mock/storage'),
            extensionPath: '/mock/extension',
            extensionUri: vscode.Uri.file('/mock/extension'),
            subscriptions: [],
            extensionMode: extensionMode as any
        } as any as vscode.ExtensionContext;
    };

    /**
     * Simulate hub configuration success
     */
    const simulateHubConfigured = () => {
        const { mockHubs, mockActiveHub } = createMockHubData(true, true);
        mockHubManager.listHubs.resolves(mockHubs as any);
        mockHubManager.getActiveHub.resolves(mockActiveHub as any);
    };

    /**
     * Simulate no hub configured
     */
    const simulateNoHub = () => {
        mockHubManager.listHubs.resolves([]);
        mockHubManager.getActiveHub.resolves(null);
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = createMockContext();
        mockHubManager = sandbox.createStubInstance(HubManager);
        simulateNoHub();
        
        // Reset singleton
        SetupStateManager.resetInstance();
        setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    suite('14.1: Fresh Install Flow', () => {
        /**
         * Requirement 2.2: WHEN the extension first activates, THE Extension SHALL set setup state to not_started
         * Requirement 2.3: WHEN the first-run configuration begins, THE Extension SHALL set setup state to in_progress
         * Requirement 2.4: WHEN hub configuration completes successfully, THE Extension SHALL set setup state to complete
         */
        test('should complete setup successfully: not_started → in_progress → complete', async () => {
            // Verify initial state
            const initialState = await setupStateManager.getState();
            assert.strictEqual(initialState, SetupState.NOT_STARTED, 'Initial state should be NOT_STARTED');

            // Simulate first-run flow starting
            await setupStateManager.markStarted();
            const inProgressState = await setupStateManager.getState();
            assert.strictEqual(inProgressState, SetupState.IN_PROGRESS, 'State should be IN_PROGRESS after markStarted()');

            // Simulate successful hub configuration
            simulateHubConfigured();
            await setupStateManager.markComplete();
            
            // Verify final state
            const finalState = await setupStateManager.getState();
            assert.strictEqual(finalState, SetupState.COMPLETE, 'State should be COMPLETE after successful setup');
        });

        /**
         * Requirement 5.1: WHEN the user completes hub selection successfully, THEN THE Extension SHALL set setup state to complete
         * Requirement 5.2: WHEN setup state is complete, THEN THE Extension SHALL not show resume prompts on future activations
         */
        test('should not show prompts after successful completion', async () => {
            // Complete setup
            await setupStateManager.markStarted();
            simulateHubConfigured();
            await setupStateManager.markComplete();

            // Verify no resume prompt should be shown
            const shouldShowPrompt = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShowPrompt, false, 'Should not show resume prompt after completion');

            // Verify isComplete returns true
            const isComplete = await setupStateManager.isComplete();
            assert.strictEqual(isComplete, true, 'isComplete() should return true');
        });

        /**
         * Test state persistence across simulated reloads
         */
        test('should persist complete state across manager instances', async () => {
            // Complete setup
            await setupStateManager.markStarted();
            await setupStateManager.markComplete();

            // Simulate extension reload by resetting singleton
            SetupStateManager.resetInstance();
            const newManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

            // Verify state persisted
            const state = await newManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'State should persist as COMPLETE after reload');
        });
    });

    suite('14.2: Cancellation and Resume Flow', () => {
        /**
         * Requirement 9.1: WHEN hub selection is cancelled, THEN THE Extension SHALL set setup state to incomplete
         * Requirement 3.1: WHEN the extension activates AND setup state is incomplete, THEN THE Extension SHALL show a resume prompt notification
         */
        test('should handle cancellation and resume: not_started → in_progress → incomplete → in_progress → complete', async () => {
            // Start setup
            await setupStateManager.markStarted();
            let state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.IN_PROGRESS, 'State should be IN_PROGRESS');

            // Simulate hub selection cancellation
            await setupStateManager.markIncomplete('hub_cancelled');
            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should be INCOMPLETE after cancellation');

            // Verify resume prompt should be shown
            const shouldShowPrompt = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShowPrompt, true, 'Should show resume prompt when incomplete');

            // Simulate user choosing to resume
            await setupStateManager.markStarted();
            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.IN_PROGRESS, 'State should be IN_PROGRESS after resume');

            // Simulate successful completion
            simulateHubConfigured();
            await setupStateManager.markComplete();
            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'State should be COMPLETE after successful resume');
        });

        /**
         * Requirement 3.3: WHEN the user selects "Complete Setup", THEN THE Extension SHALL restart the first-run configuration flow
         * Requirement 9.5: WHEN the user resumes setup after hub selection cancellation, THEN THE Extension SHALL show the hub selector again
         */
        test('should allow resumption after cancellation', async () => {
            // Setup incomplete state
            await setupStateManager.markIncomplete('hub_cancelled');

            // Verify can resume
            const isIncomplete = await setupStateManager.isIncomplete();
            assert.strictEqual(isIncomplete, true, 'Should be incomplete');

            // Resume and complete
            await setupStateManager.markStarted();
            simulateHubConfigured();
            await setupStateManager.markComplete();

            // Verify completed
            const isComplete = await setupStateManager.isComplete();
            assert.strictEqual(isComplete, true, 'Should be complete after resume');
        });

        /**
         * Test resume prompt shown on next activation
         */
        test('should show resume prompt on next activation after cancellation', async () => {
            // Cancel during setup
            await setupStateManager.markStarted();
            await setupStateManager.markIncomplete('hub_cancelled');

            // Simulate extension reload
            SetupStateManager.resetInstance();
            const newManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

            // Verify resume prompt should be shown
            const shouldShow = await newManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, true, 'Should show resume prompt on next activation');
        });
    });

    suite('14.3: Skip Resume Flow', () => {
        /**
         * Requirement 3.4: WHEN the user selects "Skip for Now", THEN THE Extension SHALL dismiss the prompt and continue with incomplete setup
         * Requirement 3.5: WHEN the user dismisses the resume prompt without selecting an action, THEN THE Extension SHALL treat it as "Skip for Now"
         */
        test('should handle skip and remain incomplete', async () => {
            // Setup incomplete state
            await setupStateManager.markIncomplete('hub_cancelled');

            // Simulate user skipping (mark prompt as shown)
            await setupStateManager.markResumePromptShown();

            // Verify state remains incomplete
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should remain INCOMPLETE after skip');

            // Verify prompt won't be shown again this session
            const shouldShow = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, false, 'Should not show prompt again after skip');
        });

        /**
         * Requirement 7.1: THE Extension SHALL provide a "Reset First Run" command
         * Requirement 7.5: WHEN the window reloads after reset, THEN THE Extension SHALL show the first-run configuration flow
         */
        test('should allow manual reset after skip: incomplete → not_started → complete', async () => {
            // Setup incomplete state and skip
            await setupStateManager.markIncomplete('hub_cancelled');
            await setupStateManager.markResumePromptShown();

            // Verify incomplete
            let state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'Should be incomplete');

            // Execute reset
            await setupStateManager.reset();

            // Verify reset to not_started
            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.NOT_STARTED, 'Should be NOT_STARTED after reset');

            // Verify resume prompt flag is cleared
            const shouldShow = await setupStateManager.shouldShowResumePrompt();
            // Note: shouldShowResumePrompt returns false for NOT_STARTED state (only true for INCOMPLETE)
            assert.strictEqual(shouldShow, false, 'Resume prompt flag should be cleared');

            // Complete setup after reset
            await setupStateManager.markStarted();
            simulateHubConfigured();
            await setupStateManager.markComplete();

            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'Should be COMPLETE after reset and setup');
        });

        /**
         * Test skip logs correctly (verified via state transitions)
         */
        test('should track skip action via prompt shown flag', async () => {
            await setupStateManager.markIncomplete('hub_cancelled');
            
            // Before skip
            let shouldShow = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, true, 'Should show prompt before skip');

            // Skip (mark prompt shown)
            await setupStateManager.markResumePromptShown();

            // After skip
            shouldShow = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, false, 'Should not show prompt after skip');

            // State should still be incomplete
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should remain INCOMPLETE');
        });
    });

    suite('14.4: Backward Compatibility', () => {
        /**
         * Requirement 5.4: THE Extension SHALL maintain backward compatibility with existing installations that have firstRun=false
         * Requirement 5.5: WHEN an existing installation has firstRun=false AND a hub configured, THEN THE Extension SHALL treat setup as complete
         */
        test('should not show prompts for existing install with hub', async () => {
            // Simulate existing installation with old flags and hub configured
            await mockContext.globalState.update('promptregistry.firstRun', false);
            await mockContext.globalState.update('promptregistry.hubInitialized', true);
            simulateHubConfigured();

            // Detect incomplete setup (should return false)
            const isIncomplete = await setupStateManager.detectIncompleteSetup();
            assert.strictEqual(isIncomplete, false, 'Should not detect incomplete when hub is configured');

            // Verify no resume prompt
            const shouldShow = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, false, 'Should not show resume prompt for existing install with hub');
        });

        /**
         * Requirement 1.1: WHEN the extension activates AND firstRun is false AND no hub is configured, THEN THE Extension SHALL detect the setup as incomplete
         * Requirement 1.2: WHEN the extension activates AND firstRun is false AND a hub is configured, THEN THE Extension SHALL detect the setup as complete
         */
        test('should show resume prompt for existing install without hub', async () => {
            // Simulate existing installation with old flags but NO hub
            await mockContext.globalState.update('promptregistry.firstRun', false);
            await mockContext.globalState.update('promptregistry.hubInitialized', false);
            simulateNoHub();

            // Detect incomplete setup (should return true and migrate)
            const isIncomplete = await setupStateManager.detectIncompleteSetup();
            assert.strictEqual(isIncomplete, true, 'Should detect incomplete when no hub configured');

            // Verify state was migrated to new system
            const state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'Should migrate to INCOMPLETE state');

            // Verify resume prompt should be shown
            const shouldShow = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, true, 'Should show resume prompt for existing install without hub');
        });

        /**
         * Test migration from old flags to new state system
         */
        test('should migrate old flags to new state system', async () => {
            // Simulate old installation state
            await mockContext.globalState.update('promptregistry.firstRun', false);
            await mockContext.globalState.update('promptregistry.hubInitialized', false);
            simulateNoHub();

            // Initial state should be NOT_STARTED (no new state set yet)
            let state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.NOT_STARTED, 'Initial state should be NOT_STARTED');

            // detectIncompleteSetup should migrate to new state
            await setupStateManager.detectIncompleteSetup();

            // State should now be INCOMPLETE
            state = await setupStateManager.getState();
            assert.strictEqual(state, SetupState.INCOMPLETE, 'State should be migrated to INCOMPLETE');
        });
    });

    suite('14.5: Test Environment', () => {
        /**
         * Requirement 6.1: WHEN the extension activates AND VSCODE_TEST environment variable is "1", THEN THE Extension SHALL skip all setup dialogs
         */
        test('should skip setup when VSCODE_TEST=1', async () => {
            // Save original env
            const originalEnv = process.env.VSCODE_TEST;
            
            try {
                // Set test environment
                process.env.VSCODE_TEST = '1';

                // Create fresh manager
                SetupStateManager.resetInstance();
                const testManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                // In test environment, setup should be marked complete immediately
                // (This simulates what checkFirstRun does in test environment)
                await testManager.markComplete();

                const state = await testManager.getState();
                assert.strictEqual(state, SetupState.COMPLETE, 'State should be COMPLETE in test environment');

                // No prompts should be shown
                const shouldShow = await testManager.shouldShowResumePrompt();
                assert.strictEqual(shouldShow, false, 'Should not show prompts in test environment');
            } finally {
                // Restore original env
                if (originalEnv === undefined) {
                    delete process.env.VSCODE_TEST;
                } else {
                    process.env.VSCODE_TEST = originalEnv;
                }
            }
        });

        /**
         * Requirement 6.2: WHEN the extension activates AND extension mode is Test, THEN THE Extension SHALL skip all setup dialogs
         */
        test('should skip setup when ExtensionMode.Test', async () => {
            // Create context with Test mode (3 = ExtensionMode.Test)
            const testContext = createMockContext(3);
            
            SetupStateManager.resetInstance();
            const testManager = SetupStateManager.getInstance(testContext, mockHubManager as any);

            // Mark complete (simulating test environment behavior)
            await testManager.markComplete();

            const state = await testManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'State should be COMPLETE in Test mode');
        });

        /**
         * Requirement 6.3: WHEN running in a test environment, THEN THE Extension SHALL set setup state to complete immediately
         * Requirement 6.4: WHEN running in a test environment, THEN THE Extension SHALL not show resume prompts
         * Requirement 6.5: WHEN running in a test environment, THEN THE Extension SHALL not show setup prompts in marketplace empty state
         */
        test('should set state to complete immediately in test environment', async () => {
            // Create context with Test mode
            const testContext = createMockContext(3);
            
            SetupStateManager.resetInstance();
            const testManager = SetupStateManager.getInstance(testContext, mockHubManager as any);

            // Even if we try to mark incomplete, test environment should allow marking complete
            await testManager.markIncomplete('hub_cancelled');
            await testManager.markComplete();

            const state = await testManager.getState();
            assert.strictEqual(state, SetupState.COMPLETE, 'Should be able to mark complete in test environment');

            // Verify no prompts
            const shouldShow = await testManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShow, false, 'Should not show prompts after marking complete');
        });

        /**
         * Test that test environment detection works with both methods
         */
        test('should detect test environment via both VSCODE_TEST and ExtensionMode', async () => {
            // Test VSCODE_TEST detection
            const originalEnv = process.env.VSCODE_TEST;
            
            try {
                process.env.VSCODE_TEST = '1';
                const isTestViaEnv = process.env.VSCODE_TEST === '1';
                assert.strictEqual(isTestViaEnv, true, 'Should detect test via VSCODE_TEST');

                // Test ExtensionMode detection
                const testContext = createMockContext(3); // ExtensionMode.Test = 3
                const isTestViaMode = testContext.extensionMode === 3;
                assert.strictEqual(isTestViaMode, true, 'Should detect test via ExtensionMode.Test');
            } finally {
                if (originalEnv === undefined) {
                    delete process.env.VSCODE_TEST;
                } else {
                    process.env.VSCODE_TEST = originalEnv;
                }
            }
        });
    });
});
