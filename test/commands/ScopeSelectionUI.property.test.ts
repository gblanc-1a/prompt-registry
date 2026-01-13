/**
 * Property-Based Tests for Scope Selection UI
 * 
 * **Property 8: Scope Selection UI Completeness**
 * **Validates: Requirements 2.1-2.6, 1.8**
 * 
 * For any installation with workspace open, the dialog SHALL present exactly three options.
 * Without workspace, only "User Profile" SHALL be available (repository options disabled).
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { PropertyTestConfig } from '../helpers/propertyTestHelpers';
import { InstallationScope, RepositoryCommitMode } from '../../src/types/registry';
import { showScopeSelectionDialog } from '../../src/utils/scopeSelectionUI';

suite('ScopeSelectionUI - Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockShowQuickPick: sinon.SinonStub;
    let mockShowWarningMessage: sinon.SinonStub;
    let originalWorkspaceFolders: typeof vscode.workspace.workspaceFolders;

    // ===== Test Utilities =====
    
    /**
     * Generator for workspace state (open or closed)
     */
    const workspaceStateArb = fc.boolean();

    /**
     * Set workspace state for testing
     */
    const setWorkspaceOpen = (isOpen: boolean): void => {
        if (isOpen) {
            (vscode.workspace as any).workspaceFolders = [
                { uri: { fsPath: '/mock/workspace' }, name: 'workspace', index: 0 }
            ];
        } else {
            (vscode.workspace as any).workspaceFolders = undefined;
        }
    };

    /**
     * Create a mock QuickPick item based on index and workspace state
     */
    const createMockSelection = (index: number | undefined, hasWorkspace: boolean) => {
        if (index === undefined) {
            return undefined;
        }

        const options = [
            {
                label: '$(repo) Repository - Commit to Git (Recommended)',
                description: 'Install in .github/, tracked in version control',
                detail: hasWorkspace ? undefined : '(Requires an open workspace)',
                _scope: 'repository' as InstallationScope,
                _commitMode: 'commit' as RepositoryCommitMode,
                _disabled: !hasWorkspace
            },
            {
                label: '$(eye-closed) Repository - Local Only',
                description: 'Install in .github/, excluded via .git/info/exclude',
                detail: hasWorkspace ? undefined : '(Requires an open workspace)',
                _scope: 'repository' as InstallationScope,
                _commitMode: 'local-only' as RepositoryCommitMode,
                _disabled: !hasWorkspace
            },
            {
                label: '$(account) User Profile',
                description: 'Install in user config, available everywhere',
                _scope: 'user' as InstallationScope,
                _commitMode: undefined,
                _disabled: false
            }
        ];

        return options[index];
    };

    const resetAllMocks = (): void => {
        mockShowQuickPick.reset();
        mockShowWarningMessage.reset();
    };

    // ===== Test Lifecycle =====
    setup(() => {
        sandbox = sinon.createSandbox();
        mockShowQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
        mockShowWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage');
        // Save original workspace folders
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    });

    teardown(() => {
        sandbox.restore();
        // Restore original workspace folders
        (vscode.workspace as any).workspaceFolders = originalWorkspaceFolders;
    });

    // ===== Property Tests =====

    /**
     * Property 8: Scope Selection UI Completeness
     * **Feature: repository-level-installation, Property 8: Scope Selection UI Completeness**
     * **Validates: Requirements 2.1-2.6, 1.8**
     */
    suite('Property 8: Scope Selection UI Completeness', () => {
        /**
         * Property 8.1: Dialog always presents exactly three options
         * For any workspace state, the dialog SHALL present exactly three options.
         */
        test('should always present exactly three options regardless of workspace state', async () => {
            await fc.assert(
                fc.asyncProperty(
                    workspaceStateArb,
                    async (hasWorkspace) => {
                        resetAllMocks();
                        setWorkspaceOpen(hasWorkspace);
                        mockShowQuickPick.resolves(createMockSelection(2, hasWorkspace)); // Select User Profile

                        await showScopeSelectionDialog();

                        // Verify: QuickPick was called with exactly 3 items
                        assert.strictEqual(mockShowQuickPick.callCount, 1, 'Should show one QuickPick dialog');
                        const items = mockShowQuickPick.firstCall.args[0];
                        assert.strictEqual(items.length, 3, 'Should always have exactly 3 options');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 8.2: Options are in correct order
         * For any workspace state, options SHALL be in order: Repository-Commit, Repository-LocalOnly, User
         */
        test('should present options in correct order for any workspace state', async () => {
            await fc.assert(
                fc.asyncProperty(
                    workspaceStateArb,
                    async (hasWorkspace) => {
                        resetAllMocks();
                        setWorkspaceOpen(hasWorkspace);
                        mockShowQuickPick.resolves(createMockSelection(2, hasWorkspace));

                        await showScopeSelectionDialog();

                        const items = mockShowQuickPick.firstCall.args[0];
                        
                        // Verify order
                        assert.ok(
                            items[0].label.includes('Repository') && items[0].label.includes('Commit'),
                            'First option should be Repository - Commit'
                        );
                        assert.ok(
                            items[1].label.includes('Repository') && items[1].label.includes('Local'),
                            'Second option should be Repository - Local Only'
                        );
                        assert.ok(
                            items[2].label.includes('User'),
                            'Third option should be User Profile'
                        );

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 8.3: Repository options disabled when no workspace
         * When hasWorkspace is false, repository options SHALL show disabled indicator.
         */
        test('should disable repository options when no workspace is open', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(false), // No workspace
                    async () => {
                        resetAllMocks();
                        setWorkspaceOpen(false);
                        mockShowQuickPick.resolves(createMockSelection(2, false));

                        await showScopeSelectionDialog();

                        const items = mockShowQuickPick.firstCall.args[0];
                        
                        // Repository options should have disabled indicator
                        assert.ok(
                            items[0]._disabled === true,
                            'Repository - Commit should be disabled'
                        );
                        assert.ok(
                            items[1]._disabled === true,
                            'Repository - Local Only should be disabled'
                        );
                        // User Profile should not be disabled
                        assert.ok(
                            items[2]._disabled !== true,
                            'User Profile should not be disabled'
                        );

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        /**
         * Property 8.4: All options enabled when workspace is open
         * When hasWorkspace is true, all options SHALL be enabled.
         */
        test('should enable all options when workspace is open', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constant(true), // Workspace open
                    async () => {
                        resetAllMocks();
                        setWorkspaceOpen(true);
                        mockShowQuickPick.resolves(createMockSelection(0, true));

                        await showScopeSelectionDialog();

                        const items = mockShowQuickPick.firstCall.args[0];
                        
                        // All options should be enabled
                        assert.ok(
                            items[0]._disabled !== true,
                            'Repository - Commit should be enabled'
                        );
                        assert.ok(
                            items[1]._disabled !== true,
                            'Repository - Local Only should be enabled'
                        );
                        assert.ok(
                            items[2]._disabled !== true,
                            'User Profile should be enabled'
                        );

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        /**
         * Property 8.5: Selection returns correct scope and commit mode
         * For any valid selection, the result SHALL contain correct scope and commitMode.
         */
        test('should return correct scope and commit mode for any selection', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 2 }),
                    async (selectionIndex) => {
                        resetAllMocks();
                        setWorkspaceOpen(true); // Workspace open (all options enabled)
                        mockShowQuickPick.resolves(createMockSelection(selectionIndex, true));

                        const result = await showScopeSelectionDialog();

                        // Verify result matches selection
                        assert.ok(result, 'Should return a result');
                        
                        if (selectionIndex === 0) {
                            assert.strictEqual(result.scope, 'repository', 'Index 0 should return repository scope');
                            assert.strictEqual(result.commitMode, 'commit', 'Index 0 should return commit mode');
                        } else if (selectionIndex === 1) {
                            assert.strictEqual(result.scope, 'repository', 'Index 1 should return repository scope');
                            assert.strictEqual(result.commitMode, 'local-only', 'Index 1 should return local-only mode');
                        } else {
                            assert.strictEqual(result.scope, 'user', 'Index 2 should return user scope');
                            assert.strictEqual(result.commitMode, undefined, 'Index 2 should not have commit mode');
                        }

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 8.6: Cancellation returns undefined
         * For any workspace state, cancelling the dialog SHALL return undefined.
         */
        test('should return undefined when dialog is cancelled', async () => {
            await fc.assert(
                fc.asyncProperty(
                    workspaceStateArb,
                    async (hasWorkspace) => {
                        resetAllMocks();
                        setWorkspaceOpen(hasWorkspace);
                        mockShowQuickPick.resolves(undefined); // User cancels

                        const result = await showScopeSelectionDialog();

                        assert.strictEqual(result, undefined, 'Should return undefined when cancelled');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        /**
         * Property 8.7: Disabled option selection shows warning
         * When a disabled option is selected, a warning SHALL be shown and undefined returned.
         */
        test('should show warning and return undefined when disabled option is selected', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: 1 }), // Repository options (disabled when no workspace)
                    async (selectionIndex) => {
                        resetAllMocks();
                        setWorkspaceOpen(false); // No workspace
                        mockShowQuickPick.resolves(createMockSelection(selectionIndex, false));
                        mockShowWarningMessage.resolves();

                        const result = await showScopeSelectionDialog();

                        // Should return undefined for disabled option
                        assert.strictEqual(result, undefined, 'Should return undefined for disabled option');
                        
                        // Should show warning
                        assert.strictEqual(mockShowWarningMessage.callCount, 1, 'Should show warning message');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        /**
         * Property 8.8: User Profile always selectable
         * For any workspace state, User Profile option SHALL always be selectable.
         */
        test('should always allow User Profile selection regardless of workspace state', async () => {
            await fc.assert(
                fc.asyncProperty(
                    workspaceStateArb,
                    async (hasWorkspace) => {
                        resetAllMocks();
                        setWorkspaceOpen(hasWorkspace);
                        mockShowQuickPick.resolves(createMockSelection(2, hasWorkspace)); // User Profile

                        const result = await showScopeSelectionDialog();

                        // Should return user scope
                        assert.ok(result, 'Should return a result');
                        assert.strictEqual(result.scope, 'user', 'Should return user scope');
                        
                        // Should not show warning
                        assert.strictEqual(mockShowWarningMessage.callCount, 0, 'Should not show warning');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });
    });
});
