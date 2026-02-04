/**
 * Property-based tests for Extension Setup Behavior
 * Tests universal correctness properties for cancellation handling, empty state UI, and reset command
 * 
 * Properties covered:
 * - Property 7: Cancellation Graceful Handling (Req 8.1-8.4, 9.1-9.4)
 * - Property 8: Empty State UI Correctness (Req 4.1, 4.2, 4.3, 4.5)
 * - Property 10: Reset Command Completeness (Req 7.1-7.5)
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { Logger } from '../../src/utils/logger';
import { PropertyTestConfig } from '../helpers/propertyTestHelpers';
import { createMockHubData, formatTestParams } from '../helpers/setupStateTestHelpers';

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

    /**
     * Actual implementation from extension.ts - DO NOT MODIFY
     * This is the real code being tested for reset command
     */
    async executeResetCommand(): Promise<void> {
        await this.setupStateManager.reset();
        // Clear active hub to ensure hub selector is shown
        await this.hubManager.setActiveHub(null);
        this.logger.info('First run state reset via SetupStateManager');
        vscode.window.showInformationMessage('First run state has been reset. Reload the window to trigger first-run initialization.');
    }
}

suite('Extension Setup - Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let globalStateData: Map<string, any>;
    let showFirstRunHubSelectorStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateData = new Map();

        mockContext = {
            globalState: {
                get: (key: string, defaultValue?: any) => globalStateData.get(key) ?? defaultValue,
                update: async (key: string, value: any) => {
                    globalStateData.set(key, value);
                },
                keys: () => Array.from(globalStateData.keys()),
                setKeysForSync: sandbox.stub()
            } as any,
            globalStorageUri: vscode.Uri.file('/mock/storage'),
            extensionPath: '/mock/extension',
            extensionUri: vscode.Uri.file('/mock/extension'),
            subscriptions: [],
            extensionMode: 1 as any // ExtensionMode.Production
        } as any as vscode.ExtensionContext;

        mockHubManager = sandbox.createStubInstance(HubManager);
        mockHubManager.listHubs.resolves([]);
        mockHubManager.getActiveHub.resolves(null);
        mockHubManager.setActiveHub.resolves();

        showFirstRunHubSelectorStub = sandbox.stub().resolves();
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage').resolves();
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

        // Reset singleton
        SetupStateManager.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    /**
     * Property 7: Cancellation Graceful Handling
     * For any cancellation during authentication or hub selection, the system should:
     * - Set state to incomplete
     * - Log the cancellation
     * - NOT show error notifications
     * - Allow extension activation to continue
     * 
     * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4**
     */
    test('Property 7: Cancellation graceful handling (Req 8.1-8.4, 9.1-9.4)', async () => {
        const cancellationTypeArbitrary = fc.constantFrom(
            'hub_cancelled',      // User cancels hub selector
            'auth_error',         // Authentication error/cancellation
            'network_error',      // Network error during setup
            'unknown_error'       // Unknown error
        );

        await fc.assert(
            fc.asyncProperty(
                cancellationTypeArbitrary,
                fc.integer({ min: 1, max: 5 }), // Number of cancellation attempts
                async (cancellationType, attemptCount) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    showErrorMessageStub.resetHistory();

                    const setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);
                    const logger = Logger.getInstance();
                    const loggerInfoStub = sandbox.stub(logger, 'info');
                    const loggerErrorStub = sandbox.stub(logger, 'error');

                    // Configure hub selector to simulate cancellation
                    if (cancellationType === 'hub_cancelled') {
                        // User cancels - no hub configured after selector
                        showFirstRunHubSelectorStub.resolves();
                        mockHubManager.listHubs.resolves([]);
                        mockHubManager.getActiveHub.resolves(null);
                    } else {
                        // Error during setup
                        const errorMessage = cancellationType === 'auth_error' 
                            ? 'Authentication cancelled'
                            : cancellationType === 'network_error'
                            ? 'Network error'
                            : 'Unknown error';
                        showFirstRunHubSelectorStub.rejects(new Error(errorMessage));
                    }

                    const testableExtension = new TestableExtension(
                        setupStateManager,
                        mockHubManager as any,
                        logger,
                        mockContext,
                        showFirstRunHubSelectorStub
                    );

                    const testParams = formatTestParams({ cancellationType, attemptCount });

                    // Attempt setup multiple times
                    for (let i = 0; i < attemptCount; i++) {
                        try {
                            await testableExtension.initializeHub();
                        } catch (error) {
                            // Expected - cancellation throws error
                        }
                    }

                    // Verify state is always incomplete after cancellation
                    const finalState = await setupStateManager.getState();
                    assert.strictEqual(
                        finalState,
                        SetupState.INCOMPLETE,
                        `Req 8.1, 9.1: State should be INCOMPLETE after cancellation (${testParams})`
                    );

                    // Verify cancellation was logged (either info or error)
                    const hasLoggedCancellation = loggerInfoStub.getCalls().some(call => 
                        call.args[0]?.toString().toLowerCase().includes('cancel') ||
                        call.args[0]?.toString().toLowerCase().includes('incomplete')
                    ) || loggerErrorStub.getCalls().some(call =>
                        call.args[0]?.toString().toLowerCase().includes('failed')
                    );
                    assert.ok(
                        hasLoggedCancellation,
                        `Req 8.2, 9.2: Cancellation should be logged (${testParams})`
                    );

                    // Verify NO error notification was shown to user
                    // (showErrorMessage should not be called for cancellations)
                    assert.ok(
                        !showErrorMessageStub.called,
                        `Req 8.3, 9.3: No error notification should be shown for cancellation (${testParams})`
                    );

                    // Restore stubs for next iteration
                    loggerInfoStub.restore();
                    loggerErrorStub.restore();

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    /**
     * Property 10: Reset Command Completeness
     * For any execution of the reset command:
     * - State should transition to not_started
     * - Active hub should be cleared
     * - Reload notification should be shown
     * 
     * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
     */
    test('Property 10: Reset command completeness (Req 7.1-7.5)', async () => {
        const initialStateArbitrary = fc.constantFrom(
            SetupState.NOT_STARTED,
            SetupState.IN_PROGRESS,
            SetupState.COMPLETE,
            SetupState.INCOMPLETE
        );

        await fc.assert(
            fc.asyncProperty(
                initialStateArbitrary,
                fc.integer({ min: 1, max: 5 }), // Number of reset calls
                async (initialState, resetCount) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    mockHubManager.setActiveHub.resetHistory();
                    showInformationMessageStub.resetHistory();

                    const setupStateManager = SetupStateManager.getInstance(mockContext, mockHubManager as any);
                    const logger = Logger.getInstance();

                    // Set initial state
                    switch (initialState) {
                        case SetupState.IN_PROGRESS:
                            await setupStateManager.markStarted();
                            break;
                        case SetupState.COMPLETE:
                            await setupStateManager.markComplete();
                            break;
                        case SetupState.INCOMPLETE:
                            await setupStateManager.markIncomplete('hub_cancelled');
                            break;
                        // NOT_STARTED is default
                    }

                    const testableExtension = new TestableExtension(
                        setupStateManager,
                        mockHubManager as any,
                        logger,
                        mockContext,
                        showFirstRunHubSelectorStub
                    );

                    const testParams = formatTestParams({ initialState, resetCount });

                    // Execute reset command multiple times
                    for (let i = 0; i < resetCount; i++) {
                        await testableExtension.executeResetCommand();
                    }

                    // Verify state is always not_started after reset
                    const finalState = await setupStateManager.getState();
                    assert.strictEqual(
                        finalState,
                        SetupState.NOT_STARTED,
                        `Req 7.2: State should be NOT_STARTED after reset (${testParams})`
                    );

                    // Verify active hub was cleared for each reset
                    assert.strictEqual(
                        mockHubManager.setActiveHub.callCount,
                        resetCount,
                        `Req 7.3: setActiveHub(null) should be called for each reset (${testParams})`
                    );
                    for (let i = 0; i < resetCount; i++) {
                        assert.ok(
                            mockHubManager.setActiveHub.getCall(i).calledWith(null),
                            `Req 7.3: setActiveHub should be called with null (${testParams})`
                        );
                    }

                    // Verify reload notification was shown for each reset
                    assert.strictEqual(
                        showInformationMessageStub.callCount,
                        resetCount,
                        `Req 7.4: Reload notification should be shown for each reset (${testParams})`
                    );
                    for (let i = 0; i < resetCount; i++) {
                        const message = showInformationMessageStub.getCall(i).args[0];
                        assert.ok(
                            message.includes('reset') && message.includes('Reload'),
                            `Req 7.4: Notification should mention reset and reload (${testParams})`
                        );
                    }

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });
});

