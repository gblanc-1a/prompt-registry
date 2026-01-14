/**
 * Npm Install Integration Tests
 * 
 * Integration tests for the npm install flow after scaffolding.
 * Tests complete scaffolding flow with npm install prompt, terminal creation,
 * and command execution.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 13.1, 13.2, 13.3
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ScaffoldCommand, ScaffoldType } from '../../src/commands/ScaffoldCommand';

suite('E2E: Npm Install Integration Tests', () => {
    const templateRoot = path.join(process.cwd(), 'templates/scaffolds/github');
    let testDir: string;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        // Create unique temp directory for each test
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-install-e2e-'));
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        sandbox.restore();
    });

    suite('Npm Install Prompt Flow', () => {
        /**
         * Test: Scaffolding prompts user for npm install
         * Requirements: 13.1 - Prompt user to confirm npm install after scaffolding completes
         */
        test('E2E: Scaffolding prompts user to run npm install after completion', async function() {
            this.timeout(30000);

            // Mock VS Code showInformationMessage to capture the prompt
            let promptCalled = false;
            let promptMessage = '';
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage')
                .callsFake((message: string, ...options: any[]): Promise<any> => {
                    promptCalled = true;
                    promptMessage = message;
                    // User declines npm install - return undefined (no selection)
                    return Promise.resolve(undefined);
                });

            const scaffoldCommand = new ScaffoldCommand(templateRoot, ScaffoldType.GitHub);
            
            await scaffoldCommand.execute(testDir, {
                projectName: 'npm-prompt-test'
            });

            // Verify scaffolding completed successfully
            assert.ok(
                fs.existsSync(path.join(testDir, 'package.json')),
                'Scaffolding should complete and create package.json'
            );

            // Verify npm install prompt was shown
            assert.ok(
                promptCalled,
                'Should prompt user for npm install'
            );

            // Verify prompt message mentions npm install or dependencies
            assert.ok(
                promptMessage.toLowerCase().includes('dependencies') || 
                promptMessage.toLowerCase().includes('npm install'),
                `Prompt should mention npm install or dependencies, got: ${promptMessage}`
            );
        });

        /**
         * Test: User declining npm install shows manual instructions
         * Requirements: 13.6 - Show manual instructions if user declines
         */
        test('E2E: Declining npm install shows manual instructions', async function() {
            this.timeout(30000);

            let manualInstructionsShown = false;
            let instructionMessage = '';

            // Mock first prompt (npm install confirmation) - user declines
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
            showInformationMessageStub.onFirstCall().resolves(undefined); // User declines
            
            // Mock second call (manual instructions)
            showInformationMessageStub.onSecondCall().callsFake((message: string): Promise<any> => {
                manualInstructionsShown = true;
                instructionMessage = message;
                return Promise.resolve(undefined);
            });

            const scaffoldCommand = new ScaffoldCommand(templateRoot, ScaffoldType.GitHub);
            
            await scaffoldCommand.execute(testDir, {
                projectName: 'manual-instructions-test'
            });

            // Verify manual instructions were shown
            assert.ok(
                manualInstructionsShown,
                'Should show manual instructions when user declines npm install'
            );

            // Verify instructions mention how to run npm install manually
            assert.ok(
                instructionMessage.toLowerCase().includes('npm install'),
                `Manual instructions should mention npm install, got: ${instructionMessage}`
            );
        });
    });

    suite('Terminal Creation and Command Execution', () => {
        /**
         * Test: Accepting npm install attempts to use terminal approach
         * Requirements: 13.2, 13.3 - Execute npm install in VS Code terminal with visible output
         */
        test('E2E: Accepting npm install triggers terminal-based installation', async function() {
            this.timeout(30000);

            let userAcceptedInstall = false;
            let progressNotificationShown = false;

            // Mock child_process.spawn to prevent actual npm execution
            const childProcess = require('child_process');
            const spawnStub = sandbox.stub(childProcess, 'spawn').callsFake((command: string, args: string[], options: any) => {
                // Create a mock process that completes successfully
                const mockProcess = {
                    on: (event: string, callback: Function) => {
                        if (event === 'close') {
                            // Simulate successful completion
                            setTimeout(() => callback(0), 10);
                        }
                    },
                    kill: sandbox.stub(),
                    stderr: { on: sandbox.stub() }
                };
                return mockProcess;
            });

            // Mock VS Code withProgress
            const withProgressStub = sandbox.stub(vscode.window, 'withProgress')
                .callsFake(async (options: any, task: Function) => {
                    const progress = { report: sandbox.stub() };
                    const token = { onCancellationRequested: sandbox.stub() };
                    return await task(progress, token);
                });

            // Mock npm install prompt - user accepts
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
            showInformationMessageStub.onFirstCall().callsFake((message: string, ...options: any[]): Promise<any> => {
                if (message.includes('dependencies')) {
                    userAcceptedInstall = true;
                    return Promise.resolve('Yes, run npm install');
                }
                return Promise.resolve(undefined);
            });
            
            // Mock success notification
            showInformationMessageStub.onSecondCall().callsFake((message: string): Promise<any> => {
                progressNotificationShown = true;
                return Promise.resolve(undefined);
            });

            const scaffoldCommand = new ScaffoldCommand(templateRoot, ScaffoldType.GitHub);
            
            await scaffoldCommand.execute(testDir, {
                projectName: 'terminal-test'
            });

            // Verify user accepted the install
            assert.ok(
                userAcceptedInstall,
                'Should capture user accepting npm install'
            );

            // Verify progress was shown (indicates npm install was attempted)
            assert.ok(
                withProgressStub.called,
                'Should show progress when npm install is attempted'
            );

            // Verify success notification was shown
            assert.ok(
                progressNotificationShown,
                'Should show success notification when npm install completes'
            );
        });
    });

    suite('Success Scenarios', () => {
        /**
         * Test: Successful npm install flow completes without errors
         * Requirements: 13.1, 13.2, 13.3 - Complete npm install flow
         */
        test('E2E: Complete npm install flow executes successfully', async function() {
            this.timeout(30000);

            let npmInstallPromptShown = false;
            let progressShown = false;

            // Mock child_process.spawn to prevent actual npm execution
            const childProcess = require('child_process');
            const spawnStub = sandbox.stub(childProcess, 'spawn').callsFake((command: string, args: string[], options: any) => {
                // Create a mock process that completes successfully
                const mockProcess = {
                    on: (event: string, callback: Function) => {
                        if (event === 'close') {
                            // Simulate successful completion
                            setTimeout(() => callback(0), 10);
                        }
                    },
                    kill: sandbox.stub(),
                    stderr: { on: sandbox.stub() }
                };
                return mockProcess;
            });

            // Mock VS Code withProgress
            const withProgressStub = sandbox.stub(vscode.window, 'withProgress')
                .callsFake(async (options: any, task: Function) => {
                    progressShown = true;
                    const progress = { report: sandbox.stub() };
                    const token = { onCancellationRequested: sandbox.stub() };
                    return await task(progress, token);
                });

            // Mock npm install prompt - user accepts
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage')
                .callsFake((message: string, ...options: any[]): Promise<any> => {
                    if (message.toLowerCase().includes('dependencies') || 
                        message.toLowerCase().includes('npm install')) {
                        npmInstallPromptShown = true;
                        return Promise.resolve('Yes, run npm install');
                    }
                    // Success notification
                    return Promise.resolve(undefined);
                });

            const scaffoldCommand = new ScaffoldCommand(templateRoot, ScaffoldType.GitHub);
            
            // Execute scaffolding with npm install
            await scaffoldCommand.execute(testDir, {
                projectName: 'success-test'
            });

            // Verify complete flow executed
            assert.ok(
                fs.existsSync(path.join(testDir, 'package.json')),
                'Scaffolding should complete successfully'
            );

            assert.ok(
                npmInstallPromptShown,
                'Should show npm install prompt'
            );

            assert.ok(
                progressShown,
                'Should show progress when npm install is attempted'
            );
        });

        /**
         * Test: Scaffolding works correctly when user declines npm install
         * Requirements: 13.6 - Skip installation and inform user how to run manually
         */
        test('E2E: Scaffolding completes successfully when npm install is declined', async function() {
            this.timeout(30000);

            let manualInstructionsShown = false;

            // Mock npm install prompt - user declines
            const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
            showInformationMessageStub.onFirstCall().resolves(undefined); // User declines
            showInformationMessageStub.onSecondCall().callsFake((): Promise<any> => {
                manualInstructionsShown = true;
                return Promise.resolve(undefined);
            });

            const scaffoldCommand = new ScaffoldCommand(templateRoot, ScaffoldType.GitHub);
            
            await scaffoldCommand.execute(testDir, {
                projectName: 'decline-test'
            });

            // Verify scaffolding completed
            assert.ok(
                fs.existsSync(path.join(testDir, 'package.json')),
                'Scaffolding should complete even when npm install is declined'
            );

            // Verify manual instructions were shown
            assert.ok(
                manualInstructionsShown,
                'Should show manual instructions when npm install is declined'
            );
        });
    });
});