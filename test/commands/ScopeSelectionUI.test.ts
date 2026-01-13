/**
 * Unit Tests for Scope Selection UI
 * 
 * Tests the scope selection dialog functionality for bundle installation.
 * Validates Requirements 2.1-2.6, 1.8
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { InstallationScope, RepositoryCommitMode } from '../../src/types/registry';
import { showScopeSelectionDialog, hasOpenWorkspace } from '../../src/utils/scopeSelectionUI';

suite('ScopeSelectionUI', () => {
    let sandbox: sinon.SinonSandbox;
    let mockShowQuickPick: sinon.SinonStub;
    let mockShowWarningMessage: sinon.SinonStub;
    let originalWorkspaceFolders: typeof vscode.workspace.workspaceFolders;

    // ===== Test Utilities =====
    
    const createQuickPickItem = (
        scope: InstallationScope,
        commitMode?: RepositoryCommitMode,
        disabled: boolean = false
    ) => {
        const labels: Record<string, string> = {
            'repository-commit': '$(repo) Repository - Commit to Git (Recommended)',
            'repository-local-only': '$(eye-closed) Repository - Local Only',
            'user': '$(account) User Profile'
        };
        
        const descriptions: Record<string, string> = {
            'repository-commit': 'Install in .github/, tracked in version control',
            'repository-local-only': 'Install in .github/, excluded via .git/info/exclude',
            'user': 'Install in user config, available everywhere'
        };

        const key = scope === 'repository' ? `repository-${commitMode}` : scope;
        
        return {
            label: labels[key],
            description: descriptions[key],
            detail: disabled ? '(Requires an open workspace)' : undefined,
            picked: scope === 'repository' && commitMode === 'commit' && !disabled,
            _scope: scope,
            _commitMode: commitMode,
            _disabled: disabled
        };
    };

    const setWorkspaceOpen = (isOpen: boolean): void => {
        if (isOpen) {
            (vscode.workspace as any).workspaceFolders = [
                { uri: { fsPath: '/mock/workspace' }, name: 'workspace', index: 0 }
            ];
        } else {
            (vscode.workspace as any).workspaceFolders = undefined;
        }
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

    // ===== Unit Tests =====

    suite('hasOpenWorkspace()', () => {
        test('should return true when workspace folders exist', () => {
            setWorkspaceOpen(true);
            assert.strictEqual(hasOpenWorkspace(), true);
        });

        test('should return false when workspace folders is undefined', () => {
            setWorkspaceOpen(false);
            assert.strictEqual(hasOpenWorkspace(), false);
        });

        test('should return false when workspace folders is empty array', () => {
            (vscode.workspace as any).workspaceFolders = [];
            assert.strictEqual(hasOpenWorkspace(), false);
        });
    });

    suite('Dialog Options When Workspace Is Open', () => {
        setup(() => {
            setWorkspaceOpen(true);
        });

        /**
         * Requirement 2.1: WHEN presenting installation options, THE Extension SHALL display 
         * a single QuickPick dialog with three options
         */
        test('should display exactly three options when workspace is open', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'commit'));

            await showScopeSelectionDialog();

            assert.strictEqual(mockShowQuickPick.callCount, 1, 'Should show one QuickPick dialog');
            
            const items = mockShowQuickPick.firstCall.args[0];
            assert.strictEqual(items.length, 3, 'Should have exactly 3 options');
        });

        /**
         * Requirement 2.2: WHEN displaying the QuickPick dialog, THE Extension SHALL show 
         * "Repository - Commit to Git (Recommended)" as the first option
         */
        test('should show "Repository - Commit to Git (Recommended)" as first option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'commit'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.ok(
                items[0].label.includes('Repository - Commit to Git'),
                'First option should be Repository - Commit to Git'
            );
            assert.ok(
                items[0].label.includes('Recommended'),
                'First option should indicate it is recommended'
            );
            assert.ok(
                items[0].description.includes('tracked in version control'),
                'First option should describe version control tracking'
            );
        });

        /**
         * Requirement 2.3: WHEN displaying the QuickPick dialog, THE Extension SHALL show 
         * "Repository - Local Only" as the second option
         */
        test('should show "Repository - Local Only" as second option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'local-only'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.ok(
                items[1].label.includes('Repository - Local Only'),
                'Second option should be Repository - Local Only'
            );
            assert.ok(
                items[1].description.includes('excluded via .git/info/exclude'),
                'Second option should describe git exclude'
            );
        });

        /**
         * Requirement 2.4: WHEN displaying the QuickPick dialog, THE Extension SHALL show 
         * "User Profile" as the third option
         */
        test('should show "User Profile" as third option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.ok(
                items[2].label.includes('User Profile'),
                'Third option should be User Profile'
            );
            assert.ok(
                items[2].description.includes('available everywhere'),
                'Third option should describe availability'
            );
        });

        /**
         * Requirement 2.2: First option should have description "Install in .github/, tracked in version control"
         */
        test('should have correct description for Repository - Commit option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'commit'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.strictEqual(
                items[0].description,
                'Install in .github/, tracked in version control',
                'First option should have correct description'
            );
        });

        /**
         * Requirement 2.3: Second option should have description "Install in .github/, excluded via .git/info/exclude"
         */
        test('should have correct description for Repository - Local Only option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'local-only'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.strictEqual(
                items[1].description,
                'Install in .github/, excluded via .git/info/exclude',
                'Second option should have correct description'
            );
        });

        /**
         * Requirement 2.4: Third option should have description "Install in user config, available everywhere"
         */
        test('should have correct description for User Profile option', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.strictEqual(
                items[2].description,
                'Install in user config, available everywhere',
                'Third option should have correct description'
            );
        });

        /**
         * All repository options should be enabled when workspace is open
         */
        test('should enable all repository options when workspace is open', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'commit'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            
            // Repository options should not have disabled detail
            assert.ok(
                !items[0].detail || !items[0].detail.includes('Requires'),
                'Repository - Commit should not show disabled message'
            );
            assert.ok(
                !items[1].detail || !items[1].detail.includes('Requires'),
                'Repository - Local Only should not show disabled message'
            );
        });
    });

    suite('Dialog Options When No Workspace Is Open', () => {
        setup(() => {
            setWorkspaceOpen(false);
        });

        /**
         * Requirement 1.8: WHEN no workspace is open, THE Extension SHALL disable repository 
         * scope option and default to user scope
         */
        test('should show disabled message for repository options when no workspace', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            
            // Repository options should have disabled detail
            assert.ok(
                items[0].detail && items[0].detail.includes('Requires an open workspace'),
                'Repository - Commit should show disabled message'
            );
            assert.ok(
                items[1].detail && items[1].detail.includes('Requires an open workspace'),
                'Repository - Local Only should show disabled message'
            );
        });

        /**
         * User Profile option should always be available
         */
        test('should keep User Profile option enabled when no workspace', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            
            // User Profile should not have disabled detail
            assert.ok(
                !items[2].detail || !items[2].detail.includes('Requires'),
                'User Profile should not show disabled message'
            );
        });

        /**
         * Should still display all three options even when some are disabled
         */
        test('should still display three options when no workspace', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const items = mockShowQuickPick.firstCall.args[0];
            assert.strictEqual(items.length, 3, 'Should still have 3 options');
        });
    });

    suite('Selection Handling', () => {
        setup(() => {
            setWorkspaceOpen(true);
        });

        /**
         * Requirement 2.5: WHEN user selects an option, THE Extension SHALL proceed with 
         * installation using the selected scope and commit preference
         */
        test('should return repository scope with commit mode when first option selected', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'commit'));

            const result = await showScopeSelectionDialog();

            assert.ok(result, 'Should return a result');
            assert.strictEqual(result.scope, 'repository', 'Should return repository scope');
            assert.strictEqual(result.commitMode, 'commit', 'Should return commit mode');
        });

        test('should return repository scope with local-only mode when second option selected', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('repository', 'local-only'));

            const result = await showScopeSelectionDialog();

            assert.ok(result, 'Should return a result');
            assert.strictEqual(result.scope, 'repository', 'Should return repository scope');
            assert.strictEqual(result.commitMode, 'local-only', 'Should return local-only mode');
        });

        test('should return user scope without commit mode when third option selected', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            const result = await showScopeSelectionDialog();

            assert.ok(result, 'Should return a result');
            assert.strictEqual(result.scope, 'user', 'Should return user scope');
            assert.strictEqual(result.commitMode, undefined, 'Should not have commit mode for user scope');
        });

        /**
         * Requirement 2.6: WHEN user cancels the dialog, THE Extension SHALL abort the installation
         */
        test('should return undefined when user cancels dialog', async () => {
            mockShowQuickPick.resolves(undefined);

            const result = await showScopeSelectionDialog();

            assert.strictEqual(result, undefined, 'Should return undefined when cancelled');
        });

        /**
         * Should show warning and return undefined when disabled option is selected
         */
        test('should show warning when disabled repository option is selected', async () => {
            setWorkspaceOpen(false);
            
            // Simulate selecting a disabled option
            mockShowQuickPick.resolves({
                ...createQuickPickItem('repository', 'commit', true),
                _disabled: true
            });
            mockShowWarningMessage.resolves();

            const result = await showScopeSelectionDialog();

            assert.strictEqual(result, undefined, 'Should return undefined for disabled option');
            assert.strictEqual(mockShowWarningMessage.callCount, 1, 'Should show warning message');
            assert.ok(
                mockShowWarningMessage.firstCall.args[0].includes('workspace'),
                'Warning should mention workspace requirement'
            );
        });
    });

    suite('QuickPick Configuration', () => {
        setup(() => {
            setWorkspaceOpen(true);
        });

        test('should set appropriate title for the dialog', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const options = mockShowQuickPick.firstCall.args[1];
            assert.ok(options.title, 'Should have a title');
            assert.ok(
                options.title.toLowerCase().includes('scope') || 
                options.title.toLowerCase().includes('installation'),
                'Title should mention scope or installation'
            );
        });

        test('should include bundle name in title when provided', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog('my-bundle');

            const options = mockShowQuickPick.firstCall.args[1];
            assert.ok(options.title.includes('my-bundle'), 'Title should include bundle name');
        });

        test('should set ignoreFocusOut to true', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const options = mockShowQuickPick.firstCall.args[1];
            assert.strictEqual(options.ignoreFocusOut, true, 'Should ignore focus out');
        });

        test('should have a placeholder text', async () => {
            mockShowQuickPick.resolves(createQuickPickItem('user'));

            await showScopeSelectionDialog();

            const options = mockShowQuickPick.firstCall.args[1];
            assert.ok(options.placeHolder, 'Should have placeholder text');
        });
    });
});
