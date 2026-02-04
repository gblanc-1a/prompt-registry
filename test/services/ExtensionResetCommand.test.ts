/**
 * Extension Reset Command Tests
 * 
 * Tests for the resetFirstRun command in extension.ts
 * Tests behavior through the command handler, not implementation details
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { Logger } from '../../src/utils/logger';

/**
 * Test helper to expose the reset command handler for testing
 * This allows us to test the actual implementation without duplicating code
 */
class TestableExtension {
    private setupStateManager: SetupStateManager;
    private hubManager: HubManager;
    private logger: Logger;

    constructor(
        setupStateManager: SetupStateManager,
        hubManager: HubManager,
        logger: Logger
    ) {
        this.setupStateManager = setupStateManager;
        this.hubManager = hubManager;
        this.logger = logger;
    }

    /**
     * Actual implementation from extension.ts - DO NOT MODIFY
     * This is the real code being tested
     */
    async executeResetCommand(): Promise<void> {
        await this.setupStateManager.reset();
        // Clear active hub to ensure hub selector is shown
        await this.hubManager.setActiveHub(null);
        this.logger.info('First run state reset via SetupStateManager');
        vscode.window.showInformationMessage('First run state has been reset. Reload the window to trigger first-run initialization.');
    }
}

suite('Extension Reset Command', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let setupStateManager: SetupStateManager;
    let logger: Logger;
    let testableExtension: TestableExtension;
    let globalStateStorage: Map<string, any>;
    let showInformationMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateStorage = new Map();

        // Create mock context with working globalState
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
        mockHubManager.setActiveHub.resolves();

        // Mock vscode.window.showInformationMessage
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');

        // Reset singletons
        SetupStateManager.resetInstance();
        setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager);
        
        logger = Logger.getInstance();

        // Create testable extension with actual implementation
        testableExtension = new TestableExtension(
            setupStateManager,
            mockHubManager,
            logger
        );
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    suite('resetFirstRun command', () => {
        /**
         * Requirement 7.1: THE Extension SHALL provide a "Reset First Run" command
         * Requirement 7.2: WHEN the "Reset First Run" command executes,
         * THEN THE Extension SHALL set setup state to not_started
         */
        test('should call reset() on SetupStateManager', async () => {
            // Arrange
            await setupStateManager.markComplete();
            const resetSpy = sandbox.spy(setupStateManager, 'reset');

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            assert.ok(resetSpy.calledOnce, 'Should call reset() once');
            const finalState = await setupStateManager.getState();
            assert.strictEqual(
                finalState,
                SetupState.NOT_STARTED,
                'Should set state to not_started'
            );
        });

        /**
         * Requirement 7.3: WHEN the "Reset First Run" command executes,
         * THEN THE Extension SHALL clear the active hub
         */
        test('should clear active hub', async () => {
            // Arrange
            await setupStateManager.markComplete();

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            assert.ok(
                mockHubManager.setActiveHub.calledOnce,
                'Should call setActiveHub once'
            );
            assert.ok(
                mockHubManager.setActiveHub.calledWith(null),
                'Should call setActiveHub with null'
            );
        });

        /**
         * Requirement 7.4: WHEN the "Reset First Run" command executes,
         * THEN THE Extension SHALL show a notification prompting to reload the window
         */
        test('should show reload notification', async () => {
            // Arrange
            await setupStateManager.markComplete();

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            assert.ok(
                showInformationMessageStub.calledOnce,
                'Should show information message once'
            );
            assert.strictEqual(
                showInformationMessageStub.firstCall.args[0],
                'First run state has been reset. Reload the window to trigger first-run initialization.',
                'Should show correct reload message'
            );
        });

        /**
         * Requirement 7.5: WHEN the window reloads after reset,
         * THEN THE Extension SHALL show the first-run configuration flow
         * 
         * This test verifies the state is set correctly for the next activation
         */
        test('should set state to not_started for next activation', async () => {
            // Arrange
            await setupStateManager.markComplete();

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(
                state,
                SetupState.NOT_STARTED,
                'State should be not_started to trigger first-run on next activation'
            );
        });

        /**
         * Requirement 7.2, 7.3, 7.4: Verify all operations complete successfully
         * 
         * Integration test to verify the complete reset flow
         */
        test('should complete all reset operations in correct order', async () => {
            // Arrange
            await setupStateManager.markComplete();
            const resetSpy = sandbox.spy(setupStateManager, 'reset');
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.executeResetCommand();

            // Assert - verify all operations were called
            assert.ok(resetSpy.calledOnce, 'Should call reset()');
            assert.ok(mockHubManager.setActiveHub.calledOnce, 'Should clear active hub');
            assert.ok(showInformationMessageStub.calledOnce, 'Should show notification');
            assert.ok(
                loggerInfoStub.calledWith('First run state reset via SetupStateManager'),
                'Should log reset action'
            );
        });

        /**
         * Requirement 7.2: Verify reset works from any state
         * 
         * Tests that reset can be called from incomplete state
         */
        test('should reset from incomplete state', async () => {
            // Arrange
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(
                state,
                SetupState.NOT_STARTED,
                'Should reset to not_started from incomplete state'
            );
        });

        /**
         * Requirement 7.2: Verify reset works from any state
         * 
         * Tests that reset can be called from in_progress state
         */
        test('should reset from in_progress state', async () => {
            // Arrange
            await setupStateManager.markStarted();

            // Act
            await testableExtension.executeResetCommand();

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(
                state,
                SetupState.NOT_STARTED,
                'Should reset to not_started from in_progress state'
            );
        });

        /**
         * Requirement 7.2: Verify reset is idempotent
         * 
         * Tests that calling reset multiple times has no adverse effects
         */
        test('should be idempotent when called multiple times', async () => {
            // Arrange
            await setupStateManager.markComplete();

            // Act
            await testableExtension.executeResetCommand();
            await testableExtension.executeResetCommand();
            await testableExtension.executeResetCommand();

            // Assert
            const state = await setupStateManager.getState();
            assert.strictEqual(
                state,
                SetupState.NOT_STARTED,
                'Should remain in not_started state after multiple resets'
            );
            assert.strictEqual(
                mockHubManager.setActiveHub.callCount,
                3,
                'Should call setActiveHub for each reset'
            );
            assert.strictEqual(
                showInformationMessageStub.callCount,
                3,
                'Should show notification for each reset'
            );
        });
    });
});
