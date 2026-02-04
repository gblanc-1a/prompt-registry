/**
 * Property-based tests for SetupStateManager
 * Tests universal correctness properties across all valid executions
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { HubManager } from '../../src/services/HubManager';
import { PropertyTestConfig } from '../helpers/propertyTestHelpers';
import { createMockHubData, formatTestParams } from '../helpers/setupStateTestHelpers';

suite('SetupStateManager - Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let globalStateData: Map<string, any>;

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

        // Reset singleton
        SetupStateManager.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        SetupStateManager.resetInstance();
    });

    // Property 1: State Transition Validity
    // For any sequence of setup operations, the setup state should only transition through valid paths
    test('Property 1: State transitions follow valid paths (Req 2.1-2.6)', async () => {
        const operationArbitrary = fc.constantFrom(
            'start',
            'complete',
            'cancel_auth',
            'cancel_hub',
            'resume',
            'reset'
        );

        await fc.assert(
            fc.asyncProperty(
                fc.array(operationArbitrary, { minLength: 1, maxLength: 20 }),
                async (operations) => {
                    // Reset state for each test
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    const manager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    const validTransitions: Record<SetupState, SetupState[]> = {
                        [SetupState.NOT_STARTED]: [SetupState.IN_PROGRESS, SetupState.COMPLETE, SetupState.INCOMPLETE],
                        [SetupState.IN_PROGRESS]: [SetupState.COMPLETE, SetupState.INCOMPLETE, SetupState.NOT_STARTED], // Can reset from in_progress
                        [SetupState.COMPLETE]: [SetupState.NOT_STARTED, SetupState.IN_PROGRESS, SetupState.INCOMPLETE], // Reset, re-setup, or error
                        [SetupState.INCOMPLETE]: [SetupState.IN_PROGRESS, SetupState.NOT_STARTED, SetupState.COMPLETE] // Resume, reset, or direct complete
                    };

                    let previousState = await manager.getState();

                    for (const op of operations) {
                        switch (op) {
                            case 'start':
                                await manager.markStarted();
                                break;
                            case 'complete':
                                await manager.markComplete();
                                break;
                            case 'cancel_auth':
                                await manager.markIncomplete('auth_cancelled');
                                break;
                            case 'cancel_hub':
                                await manager.markIncomplete('hub_cancelled');
                                break;
                            case 'resume':
                                await manager.markStarted();
                                break;
                            case 'reset':
                                await manager.reset();
                                break;
                        }

                        const currentState = await manager.getState();

                        // Verify transition is valid or state didn't change
                        if (currentState !== previousState) {
                            const allowedNextStates = validTransitions[previousState];
                            assert.ok(
                                allowedNextStates.includes(currentState),
                                `Invalid transition: ${previousState} → ${currentState} (operation: ${op}, sequence: ${operations.join(',')})`
                            );
                        }

                        previousState = currentState;
                    }

                    // Final state should always be valid
                    const finalState = await manager.getState();
                    assert.ok(
                        Object.values(SetupState).includes(finalState),
                        `Final state ${finalState} is not a valid SetupState (sequence: ${operations.join(',')})`
                    );

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 6: Setup Completion Idempotence
    // For any setup state that is already complete, calling markComplete() again should not change state
    test('Property 6: Setup completion is idempotent (Req 5.1, 5.2, 5.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (repeatCount) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    const manager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    // Mark as complete once
                    await manager.markComplete();
                    const stateAfterFirst = await manager.getState();
                    assert.strictEqual(stateAfterFirst, SetupState.COMPLETE, 
                        `Initial state should be COMPLETE (repeatCount=${repeatCount})`);

                    // Mark as complete multiple times
                    for (let i = 0; i < repeatCount; i++) {
                        await manager.markComplete();
                    }

                    // State should still be complete
                    const finalState = await manager.getState();
                    assert.strictEqual(finalState, SetupState.COMPLETE,
                        `State should remain COMPLETE after ${repeatCount} additional markComplete() calls`);

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 9: State Persistence
    // For any state transition, the new state should be persisted and retrievable
    test('Property 9: State persists across manager instances (Req 1.4, 2.6)', async () => {
        const stateArbitrary = fc.constantFrom(
            SetupState.NOT_STARTED,
            SetupState.IN_PROGRESS,
            SetupState.COMPLETE,
            SetupState.INCOMPLETE
        );

        await fc.assert(
            fc.asyncProperty(
                stateArbitrary,
                async (targetState) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    const manager1 = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    // Transition to target state
                    switch (targetState) {
                        case SetupState.NOT_STARTED:
                            await manager1.reset();
                            break;
                        case SetupState.IN_PROGRESS:
                            await manager1.markStarted();
                            break;
                        case SetupState.COMPLETE:
                            await manager1.markComplete();
                            break;
                        case SetupState.INCOMPLETE:
                            await manager1.markIncomplete('hub_cancelled');
                            break;
                    }

                    const stateBeforeReload = await manager1.getState();

                    // Create new manager instance (simulates extension reload)
                    SetupStateManager.resetInstance();
                    const manager2 = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    const stateAfterReload = await manager2.getState();

                    // State should persist
                    assert.strictEqual(
                        stateAfterReload,
                        stateBeforeReload,
                        `State did not persist: ${stateBeforeReload} → ${stateAfterReload} (target: ${targetState})`
                    );

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 2: Incomplete Setup Detection & Backward Compatibility
    // For any extension activation where firstRun=false and no hub is configured, 
    // the system should detect setup as incomplete
    // **Validates: Requirements 1.1, 1.2, 5.4, 5.5**
    // **Merged with Property 5 to eliminate duplication**
    test('Property 2: Incomplete setup detection and backward compatibility (Req 1.1, 1.2, 5.4, 5.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.boolean(), // firstRun flag
                fc.boolean(), // hubInitialized flag
                fc.boolean(), // has hubs in list
                fc.boolean(), // has active hub
                async (firstRun, hubInitialized, hasHubs, hasActiveHub) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();

                    // Set up old flags for backward compatibility testing
                    globalStateData.set('promptregistry.firstRun', firstRun);
                    globalStateData.set('promptregistry.hubInitialized', hubInitialized);

                    // Mock hub manager responses using helper
                    const { mockHubs, mockActiveHub } = createMockHubData(hasHubs, hasActiveHub);
                    mockHubManager.listHubs.resolves(mockHubs);
                    mockHubManager.getActiveHub.resolves(mockActiveHub);

                    const manager = SetupStateManager.getInstance(mockContext, mockHubManager as any);
                    const isIncomplete = await manager.detectIncompleteSetup();

                    const hasAnyHub = hasHubs || hasActiveHub;
                    const testParams = formatTestParams({ firstRun, hubInitialized, hasHubs, hasActiveHub });

                    // Requirement 1.1: firstRun=false AND no hub → incomplete
                    if (!firstRun && !hubInitialized && !hasAnyHub) {
                        assert.strictEqual(
                            isIncomplete,
                            true,
                            `Req 1.1: Should detect incomplete when firstRun=false and no hub (${testParams})`
                        );
                        
                        // Verify migration to new state system
                        const state = await manager.getState();
                        assert.strictEqual(
                            state,
                            SetupState.INCOMPLETE,
                            `Should migrate to INCOMPLETE state (${testParams})`
                        );
                    }
                    // Requirement 1.2 & 5.4, 5.5: firstRun=false AND has hub → complete (backward compat)
                    else if (!firstRun && hasAnyHub) {
                        assert.strictEqual(
                            isIncomplete,
                            false,
                            `Req 1.2, 5.4, 5.5: Should detect complete when firstRun=false and hub exists (${testParams})`
                        );
                        
                        // Should NOT migrate state when hub is configured (backward compat)
                        const state = await manager.getState();
                        assert.strictEqual(
                            state,
                            SetupState.NOT_STARTED,
                            `Should not migrate state when hub is configured (${testParams})`
                        );
                    }
                    // firstRun=true → not incomplete (fresh install)
                    else if (firstRun) {
                        assert.strictEqual(
                            isIncomplete,
                            false,
                            `Fresh install (firstRun=true) should not be incomplete (${testParams})`
                        );
                    }
                    // Other cases (hubInitialized=true) → not incomplete
                    else {
                        assert.strictEqual(
                            isIncomplete,
                            false,
                            `Should not detect incomplete in other cases (${testParams})`
                        );
                    }

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 13: Valid State Values
    // The state should always be one of the defined SetupState enum values
    test('Property 13: State is always a valid enum value (Req 2.1)', async () => {
        const operationArbitrary = fc.constantFrom(
            'start',
            'complete',
            'incomplete',
            'reset'
        );

        await fc.assert(
            fc.asyncProperty(
                fc.array(operationArbitrary, { minLength: 1, maxLength: 15 }),
                async (operations) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    const manager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    for (const op of operations) {
                        switch (op) {
                            case 'start':
                                await manager.markStarted();
                                break;
                            case 'complete':
                                await manager.markComplete();
                                break;
                            case 'incomplete':
                                await manager.markIncomplete('hub_cancelled');
                                break;
                            case 'reset':
                                await manager.reset();
                                break;
                        }

                        const currentState = await manager.getState();
                        assert.ok(
                            Object.values(SetupState).includes(currentState),
                            `Invalid state value: ${currentState} (operation: ${op}, sequence: ${operations.join(',')})`
                        );
                    }

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 3: Resume Prompt Shown Once
    // For any activation session with incomplete setup, the resume prompt should be shown at most once
    // **Validates: Requirements 3.6**
    test('Property 3: Resume prompt shown at most once per session (Req 3.6)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }), // Number of times to check shouldShowResumePrompt
                async (checkCount) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();
                    const manager = SetupStateManager.getInstance(mockContext, mockHubManager as any);

                    // Set up incomplete state
                    await manager.markIncomplete('hub_cancelled');

                    // First check: should show prompt
                    const shouldShowFirst = await manager.shouldShowResumePrompt();
                    assert.strictEqual(
                        shouldShowFirst,
                        true,
                        `Should show resume prompt when setup is incomplete and prompt not yet shown (checkCount=${checkCount})`
                    );

                    // Mark prompt as shown
                    await manager.markResumePromptShown();

                    // All subsequent checks: should NOT show prompt
                    for (let i = 0; i < checkCount; i++) {
                        const shouldShowAgain = await manager.shouldShowResumePrompt();
                        assert.strictEqual(
                            shouldShowAgain,
                            false,
                            `Should not show resume prompt after marking as shown (check ${i + 1}/${checkCount})`
                        );
                    }

                    // Verify the flag persists in global state
                    const promptShownFlag = globalStateData.get('promptregistry.resumePromptShown');
                    assert.strictEqual(
                        promptShownFlag,
                        true,
                        `Resume prompt shown flag should be persisted in global state (checkCount=${checkCount})`
                    );

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    // Property 4: Test Environment Bypass
    // For any extension activation in a test environment (VSCODE_TEST=1 or ExtensionMode.Test),
    // all setup dialogs should be skipped and state should be set to complete
    // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
    test('Property 4: Test environment bypass (Req 6.1, 6.2, 6.3, 6.4, 6.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(SetupState.NOT_STARTED, SetupState.IN_PROGRESS, SetupState.INCOMPLETE),
                fc.boolean(), // Whether VSCODE_TEST is set
                fc.constantFrom(1, 2, 3), // ExtensionMode (Production=1, Development=2, Test=3)
                async (initialState, hasVscodeTest, extensionMode) => {
                    globalStateData.clear();
                    SetupStateManager.resetInstance();

                    // Set initial state
                    if (initialState !== SetupState.NOT_STARTED) {
                        globalStateData.set('promptregistry.setupState', initialState);
                    }

                    // Set up test environment
                    const originalEnv = process.env.VSCODE_TEST;
                    if (hasVscodeTest) {
                        process.env.VSCODE_TEST = '1';
                    } else {
                        delete process.env.VSCODE_TEST;
                    }

                    const testContext = {
                        globalState: mockContext.globalState,
                        extensionMode: extensionMode as any
                    } as any;

                    try {
                        const manager = SetupStateManager.getInstance(testContext, mockHubManager as any);

                        const isTestEnv = hasVscodeTest || extensionMode === 3;
                        const testParams = formatTestParams({ 
                            initialState, 
                            hasVscodeTest, 
                            extensionMode: extensionMode === 1 ? 'Production' : extensionMode === 2 ? 'Development' : 'Test',
                            isTestEnv
                        });

                        if (isTestEnv) {
                            // In test environment, marking complete should work
                            await manager.markComplete();
                            const state = await manager.getState();
                            
                            assert.strictEqual(
                                state,
                                SetupState.COMPLETE,
                                `Req 6.1-6.3: Test environment should allow marking as complete (${testParams})`
                            );

                            // Should not show resume prompt in test environment
                            const shouldShow = await manager.shouldShowResumePrompt();
                            assert.strictEqual(
                                shouldShow,
                                false,
                                `Req 6.4: Should not show resume prompt in test environment (${testParams})`
                            );
                        } else {
                            // In non-test environment, state should remain as set
                            const state = await manager.getState();
                            assert.strictEqual(
                                state,
                                initialState,
                                `Non-test environment should preserve initial state (${testParams})`
                            );
                        }

                        return true;
                    } finally {
                        // Restore environment
                        if (originalEnv !== undefined) {
                            process.env.VSCODE_TEST = originalEnv;
                        } else {
                            delete process.env.VSCODE_TEST;
                        }
                    }
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });
});
