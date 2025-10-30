import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { RefactoredUninstallCommand } from '../../../src/commands/refactoredUninstallCommand';

describe('RefactoredUninstallCommand', () => {
    let tempDir: string;
    let command: RefactoredUninstallCommand;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olaf-test-'));
        command = new RefactoredUninstallCommand();
    });

    afterEach(async () => {
        if (tempDir && await fs.pathExists(tempDir)) {
            await fs.remove(tempDir);
        }
    });

    it('should create RefactoredUninstallCommand instance', () => {
        assert.ok(command instanceof RefactoredUninstallCommand);
    });

    it('should have execute method', () => {
        assert.strictEqual(typeof command.execute, 'function');
    });

    // Integration test would require VS Code API mocking for workspace folders
    // and user input prompts, which is complex for a unit test
    // The real testing happens through the UnifiedUninstaller tests
});
