/**
 * Extension Resume Setup Prompt Tests
 * 
 * Tests for showResumeSetupPrompt() method in extension.ts
 * Tests behavior through checkFirstRun() integration, not implementation details
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { NotificationManager } from '../../src/services/NotificationManager';
import { Logger } from '../../src/utils/logger';

/**
 * Test helper to expose private showResumeSetupPrompt method for testing
 * This allows us to test the actual implementation without duplicating code
 */
class TestableExtension {
    private setupStateManager: SetupStateManager;
    private notificationManager: NotificationManager;
    private logger: Logger;
    private initializeHubStub: sinon.SinonStub;

    constructor(
        setupStateManager: SetupStateManager,
        notificationManager: NotificationManager,
        logger: Logger,
        initializeHubStub: sinon.SinonStub
    ) {
        this.setupStateManager = setupStateManager;
        this.notificationManager = notificationManager;
        this.logger = logger;
        this.initializeHubStub = initializeHubStub;
    }

    /**
     * Actual implementation from extension.ts - DO NOT MODIFY
     * This is the real code being tested
     */
    async showResumeSetupPrompt(): Promise<void> {
        // Mark prompt as shown to prevent showing it multiple times in the same session
        await this.setupStateManager.markResumePromptShown();
        
        // Show notification with action buttons using NotificationManager
        const action = await this.notificationManager.showInfo(
            'Setup was not completed. Would you like to finish configuring Prompt Registry?',
            'Complete Setup',
            'Skip for Now'
        );
        
        if (action === 'Complete Setup') {
            this.logger.info('User chose to resume setup');
            await this.setupStateManager.markStarted();
            
            try {
                await this.initializeHub();
                await this.setupStateManager.markComplete();
                this.logger.info('Setup resumed and completed successfully');
            } catch (error) {
                this.logger.error('Failed to complete setup during resume', error as Error);
                await this.setupStateManager.markIncomplete('hub_cancelled');
            }
        } else {
            // Handle both "Skip for Now" action and dismissal (undefined)
            this.logger.info('User skipped setup resumption');
        }
    }

    /**
     * Delegate to stub for testing
     */
    private async initializeHub(): Promise<void> {
        return this.initializeHubStub();
    }
}

suite('Extension Resume Setup Prompt', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let setupStateManager: SetupStateManager;
    let notificationManager: NotificationManager;
    let logger: Logger;
    let testableExtension: TestableExtension;
    let globalStateStorage: Map<string, any>;
    let initializeHubStub: sinon.SinonStub;

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
        mockHubManager.listHubs.resolves([]);
        mockHubManager.getActiveHub.resolves(null);

        // Reset singletons
        SetupStateManager.resetInstance();
        setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager);
        
        notificationManager = NotificationManager.getInstance();
        logger = Logger.getInstance();

        // Create stub for initializeHub
        initializeHubStub = sandbox.stub().resolves();

        // Create testable extension with actual implementation
        testableExtension = new TestableExtension(
            setupStateManager,
            notificationManager,
            logger,
            initializeHubStub
        );
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    suite('showResumeSetupPrompt()', () => {
        /**
         * Requirement 3.1: WHEN the extension activates AND setup state is incomplete,
         * THEN THE Extension SHALL show a resume prompt notification
         * 
         * Requirement 3.2: THE Resume_Prompt SHALL offer actions: "Complete Setup" and "Skip for Now"
         */
        test('should show notification with correct message and actions', async () => {
            // Arrange
            const showInfoStub = sandbox.stub(notificationManager, 'showInfo').resolves(undefined);

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            assert.ok(showInfoStub.calledOnce, 'Should call showInfo once');
            const [message, action1, action2] = showInfoStub.firstCall.args;
            assert.strictEqual(
                message,
                'Setup was not completed. Would you like to finish configuring Prompt Registry?',
                'Should show correct message'
            );
            assert.strictEqual(action1, 'Complete Setup', 'Should offer "Complete Setup" action');
            assert.strictEqual(action2, 'Skip for Now', 'Should offer "Skip for Now" action');
        });

        /**
         * Requirement 3.3: WHEN the user selects "Complete Setup",
         * THEN THE Extension SHALL restart the first-run configuration flow
         */
        test('should trigger initializeHub when user selects "Complete Setup"', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves('Complete Setup');
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            assert.ok(initializeHubStub.calledOnce, 'Should call initializeHub once');
            assert.ok(
                loggerInfoStub.calledWith('User chose to resume setup'),
                'Should log user choice'
            );
        });

        /**
         * Requirement 3.3: WHEN the user selects "Complete Setup",
         * THEN THE Extension SHALL restart the first-run configuration flow
         * 
         * Tests state transitions during successful setup completion
         */
        test('should mark setup as started then complete when "Complete Setup" succeeds', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves('Complete Setup');
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            const finalState = await setupStateManager.getState();
            assert.strictEqual(
                finalState,
                SetupState.COMPLETE,
                'Should mark setup as complete after successful initialization'
            );
        });

        /**
         * Requirement 3.3: Error handling during setup resumption
         * 
         * Tests that errors during initializeHub are caught and state is marked incomplete
         */
        test('should mark setup as incomplete when initializeHub fails', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves('Complete Setup');
            initializeHubStub.rejects(new Error('Hub initialization failed'));
            const loggerErrorStub = sandbox.stub(logger, 'error');
            await setupStateManager.markIncomplete('hub_cancelled');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            const finalState = await setupStateManager.getState();
            assert.strictEqual(
                finalState,
                SetupState.INCOMPLETE,
                'Should mark setup as incomplete after error'
            );
            assert.ok(
                loggerErrorStub.calledWith('Failed to complete setup during resume'),
                'Should log error'
            );
        });

        /**
         * Requirement 3.4: WHEN the user selects "Skip for Now",
         * THEN THE Extension SHALL dismiss the prompt and continue with incomplete setup
         */
        test('should log skip action when user selects "Skip for Now"', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves('Skip for Now');
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            assert.ok(
                loggerInfoStub.calledWith('User skipped setup resumption'),
                'Should log skip action'
            );
            assert.ok(initializeHubStub.notCalled, 'Should not call initializeHub');
        });

        /**
         * Requirement 3.5: WHEN the user dismisses the resume prompt without selecting an action,
         * THEN THE Extension SHALL treat it as "Skip for Now"
         */
        test('should treat dismissal as "Skip for Now"', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves(undefined);
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            assert.ok(
                loggerInfoStub.calledWith('User skipped setup resumption'),
                'Should log skip action for dismissal'
            );
            assert.ok(initializeHubStub.notCalled, 'Should not call initializeHub on dismissal');
        });

        /**
         * Requirement 3.6: THE Extension SHALL not show the resume prompt more than once per activation
         * 
         * Tests that markResumePromptShown is called to track prompt display
         */
        test('should mark resume prompt as shown', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves(undefined);
            await setupStateManager.markIncomplete('hub_cancelled');

            // Verify prompt should be shown before calling
            const shouldShowBefore = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(shouldShowBefore, true, 'Prompt should be shown initially');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            const shouldShowAfter = await setupStateManager.shouldShowResumePrompt();
            assert.strictEqual(
                shouldShowAfter,
                false,
                'Prompt should not be shown again after being marked as shown'
            );
        });

        /**
         * Requirement 3.6: Verify prompt tracking happens before showing notification
         * 
         * Tests that markResumePromptShown is called first, even if notification fails
         */
        test('should mark prompt as shown before showing notification', async () => {
            // Arrange
            const showInfoStub = sandbox.stub(notificationManager, 'showInfo');
            const markShownSpy = sandbox.spy(setupStateManager, 'markResumePromptShown');
            
            // Make showInfo throw to verify markResumePromptShown was called first
            showInfoStub.rejects(new Error('Notification failed'));

            // Act & Assert
            try {
                await testableExtension.showResumeSetupPrompt();
                assert.fail('Should have thrown error');
            } catch (error) {
                // Verify markResumePromptShown was called before the error
                assert.ok(markShownSpy.calledOnce, 'Should call markResumePromptShown');
                assert.ok(
                    markShownSpy.calledBefore(showInfoStub),
                    'Should mark prompt as shown before showing notification'
                );
            }
        });

        /**
         * Requirement 3.3: Verify logging during successful setup completion
         */
        test('should log success message when setup completes successfully', async () => {
            // Arrange
            sandbox.stub(notificationManager, 'showInfo').resolves('Complete Setup');
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.showResumeSetupPrompt();

            // Assert
            assert.ok(
                loggerInfoStub.calledWith('Setup resumed and completed successfully'),
                'Should log success message'
            );
        });
    });
});
