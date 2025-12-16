/**
 * Unit tests for UnifiedInstallFlow
 * Tests centralized install/update logic with consistent prompting
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { unifiedInstallFlow, UnifiedInstallFlowOptions } from '../../src/services/UnifiedInstallFlow';
import { AutoUpdatePreferenceManager } from '../../src/services/AutoUpdatePreferenceManager';
import { RegistryManager } from '../../src/services/RegistryManager';
import { Logger } from '../../src/utils/logger';

suite('UnifiedInstallFlow', () => {
    let sandbox: sinon.SinonSandbox;
    let mockPreferenceManager: sinon.SinonStubbedInstance<AutoUpdatePreferenceManager>;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockWindow: sinon.SinonStubbedInstance<typeof vscode.window>;
    let loggerStub: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub logger
        const loggerInstance = Logger.getInstance();
        loggerStub = sandbox.stub(loggerInstance);
        loggerStub.debug.returns();
        loggerStub.info.returns();
        loggerStub.warn.returns();
        loggerStub.error.returns();

        // Create stubbed dependencies
        mockPreferenceManager = {
            setUpdatePreference: sandbox.stub().resolves(),
            getUpdatePreference: sandbox.stub().resolves(false),
            isGlobalAutoUpdateEnabled: sandbox.stub().returns(true),
            dispose: sandbox.stub(),
        } as any;

        mockRegistryManager = {
            installBundle: sandbox.stub().resolves(),
            getBundleDetails: sandbox.stub().resolves({
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
            }),
        } as any;

        // Stub VS Code window API
        mockWindow = {
            showQuickPick: sandbox.stub(),
            withProgress: sandbox.stub(),
            showInformationMessage: sandbox.stub(),
            showErrorMessage: sandbox.stub(),
        } as any;

        sandbox.stub(vscode.window, 'showQuickPick').callsFake(mockWindow.showQuickPick as any);
        sandbox.stub(vscode.window, 'withProgress').callsFake(mockWindow.withProgress as any);
        sandbox.stub(vscode.window, 'showInformationMessage').callsFake(mockWindow.showInformationMessage as any);
        sandbox.stub(vscode.window, 'showErrorMessage').callsFake(mockWindow.showErrorMessage as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Scope selection', () => {
        test('should prompt for scope when undefined and not skipped', async () => {
            mockWindow.showQuickPick.onFirstCall().resolves({ value: 'user' } as any);
            mockWindow.showQuickPick.onSecondCall().resolves({ value: true } as any);
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                autoUpdate: true,  // Provide autoUpdate to skip that prompt
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showQuickPick.calledOnce, 'Should prompt for scope');
            const firstCall = mockWindow.showQuickPick.getCall(0);
            const items = firstCall.args[0] as any[];
            assert.ok(items.some((item: any) => item.value === 'user'));
            assert.ok(items.some((item: any) => item.value === 'workspace'));
        });

        test('should use provided scope without prompting', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showQuickPick.notCalled, 'Should not prompt when scope provided');
            assert.ok(mockRegistryManager.installBundle.calledOnceWith('test-bundle', {
                scope: 'user',
                version: 'latest'
            }));
        });

        test('should throw when scope undefined and skipScopePrompt=true', async () => {
            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                skipScopePrompt: true,
                autoUpdate: false,
            };

            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options),
                /scope is required when skipScopePrompt is true/i
            );
        });

        test('should return early when user cancels scope selection', async () => {
            mockWindow.showQuickPick.resolves(undefined);

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                autoUpdate: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockRegistryManager.installBundle.notCalled, 'Should not install when user cancels');
        });
    });

    suite('Auto-update preference selection', () => {
        test('should prompt for auto-update when undefined and not skipped', async () => {
            mockWindow.showQuickPick.onFirstCall().resolves({ value: 'user' } as any);
            mockWindow.showQuickPick.onSecondCall().resolves({ value: true } as any);
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',  // Provide scope to skip that prompt
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showQuickPick.calledOnce, 'Should prompt for auto-update');
            const firstCall = mockWindow.showQuickPick.getCall(0);
            assert.ok((firstCall.args[0] as any[]).some((item: any) => item.value === true));
            assert.ok((firstCall.args[0] as any[]).some((item: any) => item.value === false));
        });

        test('should use provided autoUpdate without prompting', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'workspace',
                autoUpdate: true,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showQuickPick.notCalled, 'Should not prompt when autoUpdate provided');
            assert.ok(mockPreferenceManager.setUpdatePreference.calledOnceWith('test-bundle', true));
        });

        test('should throw when autoUpdate undefined and skipAutoUpdatePrompt=true', async () => {
            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                skipAutoUpdatePrompt: true,
            };

            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options),
                /autoUpdate is required when skipAutoUpdatePrompt is true/i
            );
        });

        test('should return early when user cancels auto-update selection', async () => {
            mockWindow.showQuickPick.resolves(undefined);

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockRegistryManager.installBundle.notCalled, 'Should not install when user cancels');
        });
    });

    suite('Installation execution', () => {
        test('should call installBundle with correct parameters', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'my-bundle',
                scope: 'workspace',
                version: '2.1.0',
                autoUpdate: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockRegistryManager.installBundle.calledOnceWith('my-bundle', {
                scope: 'workspace',
                version: '2.1.0'
            }));
        });

        test('should default version to latest when not provided', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: true,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockRegistryManager.installBundle.calledOnceWith('test-bundle', {
                scope: 'user',
                version: 'latest'
            }));
        });

        test('should show progress notification by default', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.withProgress.calledOnce);
            const progressOptions = mockWindow.withProgress.getCall(0).args[0];
            assert.strictEqual(progressOptions.location, vscode.ProgressLocation.Notification);
        });

        test('should skip progress notification when showProgressNotification=false', async () => {
            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: true,
                showProgressNotification: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.withProgress.notCalled, 'Should not show progress when disabled');
            assert.ok(mockRegistryManager.installBundle.calledOnce, 'Should still install');
        });

        test('should store auto-update preference after successful installation', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: true,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockPreferenceManager.setUpdatePreference.calledOnceWith('test-bundle', true));
            assert.ok(mockPreferenceManager.setUpdatePreference.calledAfter(mockRegistryManager.installBundle));
        });

        test('should show custom success message when provided', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
                successMessage: 'Custom install complete!',
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showInformationMessage.calledWith('Custom install complete!'));
        });

        test('should show default success message when not provided', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });
            mockRegistryManager.getBundleDetails.resolves({
                id: 'test-bundle',
                name: 'My Test Bundle',
                version: '1.0.0',
            } as any);

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showInformationMessage.calledOnce);
            const message = mockWindow.showInformationMessage.getCall(0).args[0];
            assert.ok(message.includes('My Test Bundle'));
            assert.ok(message.includes('installed successfully'));
        });

        test('should not show success message when showSuccessMessage=false', async () => {
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
                showSuccessMessage: false,
            };

            await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);

            assert.ok(mockWindow.showInformationMessage.notCalled);
        });
    });

    suite('Error handling', () => {
        test('should propagate installation errors', async () => {
            const installError = new Error('Network failure');
            mockRegistryManager.installBundle.rejects(installError);
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: false,
            };

            await assert.rejects(
                async () => await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options),
                installError
            );
        });

        test('should not store preference when installation fails', async () => {
            mockRegistryManager.installBundle.rejects(new Error('Install failed'));
            mockWindow.withProgress.callsFake(async (options: any, task: any) => {
                const mockProgress = { report: () => {} };
                return await task(mockProgress);
            });

            const options: UnifiedInstallFlowOptions = {
                bundleId: 'test-bundle',
                scope: 'user',
                autoUpdate: true,
            };

            try {
                await unifiedInstallFlow(mockRegistryManager as any, mockPreferenceManager as any, options);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(mockPreferenceManager.setUpdatePreference.notCalled, 'Should not set preference on failure');
            }
        });
    });
});
