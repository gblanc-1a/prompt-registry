/**
 * Scope Selection UI Utility
 * 
 * Provides a unified scope selection dialog for bundle installation.
 * Implements Requirements 2.1-2.6, 1.8 for repository-level installation.
 */

import * as vscode from 'vscode';
import { InstallationScope, RepositoryCommitMode } from '../types/registry';

/**
 * Result of scope selection dialog
 */
export interface ScopeSelectionResult {
    scope: InstallationScope;
    commitMode?: RepositoryCommitMode;
}

/**
 * Internal option structure for QuickPick items
 */
interface ScopeSelectionOption {
    label: string;
    description: string;
    detail?: string;
    scope: InstallationScope;
    commitMode?: RepositoryCommitMode;
    disabled: boolean;
}

/**
 * Extended QuickPickItem with internal metadata for scope selection
 */
interface ScopeQuickPickItem extends vscode.QuickPickItem {
    _scope: InstallationScope;
    _commitMode?: RepositoryCommitMode;
    _disabled: boolean;
}

/**
 * Shows the scope selection dialog for bundle installation.
 * 
 * Presents three options:
 * 1. Repository - Commit to Git (Recommended) - tracked in version control
 * 2. Repository - Local Only - excluded via .git/info/exclude
 * 3. User Profile - available everywhere
 * 
 * Repository options are disabled when no workspace is open.
 * 
 * @param bundleName - Optional bundle name to display in the dialog title
 * @returns The selected scope and commit mode, or undefined if cancelled
 * 
 * @example
 * ```typescript
 * const result = await showScopeSelectionDialog('my-bundle');
 * if (result) {
 *     console.log(`Installing to ${result.scope} scope`);
 *     if (result.commitMode) {
 *         console.log(`Commit mode: ${result.commitMode}`);
 *     }
 * }
 * ```
 */
export async function showScopeSelectionDialog(bundleName?: string): Promise<ScopeSelectionResult | undefined> {
    const hasWorkspace = hasOpenWorkspace();

    const options: ScopeSelectionOption[] = [
        {
            label: '$(repo) Repository - Commit to Git (Recommended)',
            description: 'Install in .github/, tracked in version control',
            detail: hasWorkspace ? undefined : '(Requires an open workspace)',
            scope: 'repository',
            commitMode: 'commit',
            disabled: !hasWorkspace
        },
        {
            label: '$(eye-closed) Repository - Local Only',
            description: 'Install in .github/, excluded via .git/info/exclude',
            detail: hasWorkspace ? undefined : '(Requires an open workspace)',
            scope: 'repository',
            commitMode: 'local-only',
            disabled: !hasWorkspace
        },
        {
            label: '$(account) User Profile',
            description: 'Install in user config, available everywhere',
            scope: 'user',
            disabled: false
        }
    ];

    // Create QuickPick items with internal metadata
    const quickPickItems: ScopeQuickPickItem[] = options.map(opt => ({
        label: opt.label,
        description: opt.description,
        detail: opt.detail,
        picked: opt.scope === 'repository' && opt.commitMode === 'commit' && hasWorkspace,
        _scope: opt.scope,
        _commitMode: opt.commitMode,
        _disabled: opt.disabled
    }));

    const title = bundleName 
        ? `Install ${bundleName} - Select Scope`
        : 'Select Installation Scope';

    const selected = await vscode.window.showQuickPick(quickPickItems, {
        title,
        placeHolder: 'Choose where to install the bundle',
        ignoreFocusOut: true
    });

    if (!selected) {
        return undefined;
    }

    // Check if disabled option was selected
    if (selected._disabled) {
        vscode.window.showWarningMessage('Repository scope requires an open workspace.');
        return undefined;
    }

    return {
        scope: selected._scope,
        commitMode: selected._commitMode
    };
}

/**
 * Checks if a workspace is currently open.
 * 
 * @returns true if at least one workspace folder is open
 */
export function hasOpenWorkspace(): boolean {
    return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
}

/**
 * Gets the root path of the first workspace folder.
 * 
 * @returns The workspace root path, or undefined if no workspace is open
 */
export function getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return undefined;
}
