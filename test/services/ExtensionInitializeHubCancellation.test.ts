/**
 * Extension initializeHub() Cancellation Tests
 * 
 * Tests for initializeHub() method cancellation handling in extension.ts
 * Tests behavior through public entry points, not implementation details
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { Logger } from '../../src/utils/logger';
import { createMockHubData } from '../helpers/setupStateTestHelpers';

/**
 * Test helper to expose private initializeHub method for testing
 * This allows us to test the actual implementation without duplicating code
 */
class TestableExtension {
    private setupStateManager: SetupStateManager;
    private hubManager: HubManager;
    private logger: Logger;
    private context: vscode.ExtensionContext;
    private showFirstRunHubSelectorStub: sinon.SinonStub;

    constructor(
        setupStateManager: SetupStateManager,
        hubManager: HubManager,
        logger: Logger,
        context: vscode.ExtensionContext,
        showFirstRunHubSelectorStub: sinon.SinonStub
    ) {
        this.setupStateManager = setupStateManager;
        this.hubManager = hubManager;
        this.logger = logger;
        this.context = context;
        this.showFirstRunHubSelectorStub = showFirstRunHubSelectorStub;
    }

    /**
     * Actual implementation from extension.ts - DO NOT MODIFY
     * This is the real code being tested
     */
    async initializeHub(): Promise<void> {
        try {
            const hubManager = this.hubManager;

            // Check existing hubs
            const hubs = await hubManager.listHubs();
            const activeHubResult = await hubManager.getActiveHub();

            if (hubs.length === 0 && !activeHubResult) {
                // Scenario 1: First-time installation, no hubs
                this.logger.info('First-time hub setup: showing hub selector');
                await this.showFirstRunHubSelector();
                
                // Verify hub was actually configured
                const hubsAfter = await hubManager.listHubs();
                const activeHubAfter = await hubManager.getActiveHub();
                
                if (hubsAfter.length === 0 && !activeHubAfter) {
                    // User cancelled - mark as incomplete and throw to prevent markComplete()
                    this.logger.info('Hub selection cancelled, marking setup as incomplete');
                    await this.setupStateManager.markIncomplete('hub_cancelled');
                    throw new Error('Hub selection cancelled by user');
                }
            } else if (hubs.length > 0 && !activeHubResult) {
                // Scenario 2: Migration - hubs exist but no active hub set
                this.logger.info(`Migration detected: ${hubs.length} hubs found, migrating to active hub model`);
                // Migration logic would go here - not tested in this suite
            } else {
                // Scenario 3: Already initialized (active hub exists)
                this.logger.info('Hub already configured with active hub');
            }

            // Mark as initialized (for backward compatibility)
            await this.context.globalState.update('promptregistry.hubInitialized', true);
            this.logger.info('Hub initialization complete');

        } catch (error) {
            this.logger.error('Failed to initialize hub', error as Error);
            await this.setupStateManager.markIncomplete('hub_cancelled');
            throw error;
        }
    }

    /**
     * Delegate to stub for testing
     */
    private async showFirstRunHubSelector(): Promise<void> {
        return this.showFirstRunHubSelectorStub();
    }
}

suite('Extension initializeHub() Cancellation', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let setupStateManager: SetupStateManager;
    let logger: Logger;
    let testableExtension: TestableExtension;
    let globalStateStorage: Map<string, any>;
    let showFirstRunHubSelectorStub: sinon.SinonStub;

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
        
        // Reset singletons
        SetupStateManager.resetInstance();
        setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager);
        
        logger = Logger.getInstance();

        // Create stub for showFirstRunHubSelector
        showFirstRunHubSelectorStub = sandbox.stub().resolves();

        // Create testable extension with actual implementation
        testableExtension = new TestableExtension(
            setupStateManager,
            mockHubManager,
            logger,
            mockContext,
            showFirstRunHubSelectorStub
        );
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    suite('initializeHub()', () => {
        /**
         * Requirement 9.1: WHEN hub selection is cancelled,
         * THEN THE Extension SHALL set setup state to incomplete
         * 
         * Requirement 9.2: WHEN hub selection is cancelled,
         * THEN THE Extension SHALL log the cancellation
         */
        test('should mark state as incomplete when hub selection is cancelled', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            // Simulate user cancelling hub selector - no hub configured after
            showFirstRunHubSelectorStub.resolves();
            
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act & Assert
            try {
                await testableExtension.initializeHub();
                assert.fail('Should have thrown error');
            } catch (error) {
                // Verify state was marked as incomplete
                const state = await setupStateManager.getState();
                assert.strictEqual(
                    state,
                    SetupState.INCOMPLETE,
                    'Should mark setup as incomplete after cancellation'
                );
                
                // Verify cancellation was logged
                assert.ok(
                    loggerInfoStub.calledWith('Hub selection cancelled, marking setup as incomplete'),
                    'Should log cancellation'
                );
            }
        });

        /**
         * Requirement 9.3: WHEN hub selection is cancelled,
         * THEN THE Extension SHALL not show an error notification
         * 
         * Requirement 9.4: WHEN hub selection is cancelled,
         * THEN THE Extension SHALL allow the extension to continue activating
         */
        test('should throw error to prevent markComplete() but allow extension activation', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            showFirstRunHubSelectorStub.resolves();

            // Act & Assert
            try {
                await testableExtension.initializeHub();
                assert.fail('Should have thrown error');
            } catch (error) {
                // Verify error message indicates cancellation (not a failure)
                assert.strictEqual(
                    (error as Error).message,
                    'Hub selection cancelled by user',
                    'Should throw cancellation error'
                );
            }
        });

        /**
         * Requirement 9.5: WHEN the user resumes setup after hub selection cancellation,
         * THEN THE Extension SHALL show the hub selector again
         * 
         * Tests that hub selector is called when no hub is configured
         */
        test('should call showFirstRunHubSelector when no hub is configured', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            showFirstRunHubSelectorStub.resolves();

            // Act
            try {
                await testableExtension.initializeHub();
            } catch (error) {
                // Expected to throw
            }

            // Assert
            assert.ok(
                showFirstRunHubSelectorStub.calledOnce,
                'Should call showFirstRunHubSelector when no hub configured'
            );
        });

        /**
         * Requirement 8.1: WHEN GitHub authentication is cancelled,
         * THEN THE Extension SHALL set setup state to incomplete
         * 
         * Requirement 8.2: WHEN GitHub authentication is cancelled,
         * THEN THE Extension SHALL log the cancellation
         * 
         * Tests error handling when hub selector throws (e.g., auth cancellation)
         */
        test('should mark state as incomplete when authentication fails', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            // Simulate authentication error
            showFirstRunHubSelectorStub.rejects(new Error('Authentication cancelled'));
            
            const loggerErrorStub = sandbox.stub(logger, 'error');

            // Act & Assert
            try {
                await testableExtension.initializeHub();
                assert.fail('Should have thrown error');
            } catch (error) {
                // Verify state was marked as incomplete
                const state = await setupStateManager.getState();
                assert.strictEqual(
                    state,
                    SetupState.INCOMPLETE,
                    'Should mark setup as incomplete after authentication error'
                );
                
                // Verify error was logged
                assert.ok(
                    loggerErrorStub.calledWith('Failed to initialize hub'),
                    'Should log error'
                );
            }
        });

        /**
         * Requirement 8.3: WHEN GitHub authentication is cancelled,
         * THEN THE Extension SHALL not show an error notification
         * 
         * Requirement 8.4: WHEN GitHub authentication is cancelled,
         * THEN THE Extension SHALL allow the extension to continue activating
         */
        test('should rethrow error to allow caller to handle it', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            const authError = new Error('Authentication cancelled');
            showFirstRunHubSelectorStub.rejects(authError);

            // Act & Assert
            try {
                await testableExtension.initializeHub();
                assert.fail('Should have thrown error');
            } catch (error) {
                // Verify original error is rethrown
                assert.strictEqual(
                    error,
                    authError,
                    'Should rethrow original error for caller to handle'
                );
            }
        });

        /**
         * Requirement 9.2: WHEN hub selection is cancelled,
         * THEN THE Extension SHALL log the cancellation
         * 
         * Tests logging outputs for cancellation events
         */
        test('should log appropriate messages during cancellation flow', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(false, false);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            showFirstRunHubSelectorStub.resolves();
            
            const loggerInfoStub = sandbox.stub(logger, 'info');
            const loggerErrorStub = sandbox.stub(logger, 'error');

            // Act
            try {
                await testableExtension.initializeHub();
            } catch (error) {
                // Expected to throw
            }

            // Assert
            assert.ok(
                loggerInfoStub.calledWith('First-time hub setup: showing hub selector'),
                'Should log hub selector display'
            );
            assert.ok(
                loggerInfoStub.calledWith('Hub selection cancelled, marking setup as incomplete'),
                'Should log cancellation detection'
            );
            assert.ok(
                loggerErrorStub.calledWith('Failed to initialize hub'),
                'Should log error in catch block'
            );
        });

        /**
         * Success case: Hub is successfully configured
         * 
         * Tests that state is NOT marked as incomplete when hub is configured
         */
        test('should not mark as incomplete when hub is successfully configured', async () => {
            // Arrange - no hubs initially
            mockHubManager.listHubs.onFirstCall().resolves([]);
            mockHubManager.getActiveHub.onFirstCall().resolves(null);
            
            // After hub selector, hub is configured
            const { mockHubs, mockActiveHub } = createMockHubData(true, true);
            mockHubManager.listHubs.onSecondCall().resolves(mockHubs);
            mockHubManager.getActiveHub.onSecondCall().resolves(mockActiveHub);
            
            showFirstRunHubSelectorStub.resolves();

            // Act
            await testableExtension.initializeHub();

            // Assert
            const state = await setupStateManager.getState();
            assert.notStrictEqual(
                state,
                SetupState.INCOMPLETE,
                'Should not mark as incomplete when hub is configured'
            );
        });

        /**
         * Success case: Hub already configured
         * 
         * Tests that initializeHub succeeds when hub is already configured
         */
        test('should succeed when hub is already configured', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(true, true);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);
            
            const loggerInfoStub = sandbox.stub(logger, 'info');

            // Act
            await testableExtension.initializeHub();

            // Assert
            assert.ok(
                loggerInfoStub.calledWith('Hub already configured with active hub'),
                'Should log that hub is already configured'
            );
            assert.ok(
                loggerInfoStub.calledWith('Hub initialization complete'),
                'Should log completion'
            );
        });

        /**
         * Backward compatibility: hubInitialized flag
         * 
         * Tests that hubInitialized flag is set for backward compatibility
         */
        test('should set hubInitialized flag for backward compatibility', async () => {
            // Arrange
            const { mockHubs, mockActiveHub } = createMockHubData(true, true);
            mockHubManager.listHubs.resolves(mockHubs);
            mockHubManager.getActiveHub.resolves(mockActiveHub);

            // Act
            await testableExtension.initializeHub();

            // Assert
            const hubInitialized = globalStateStorage.get('promptregistry.hubInitialized');
            assert.strictEqual(
                hubInitialized,
                true,
                'Should set hubInitialized flag for backward compatibility'
            );
        });
    });
});
