/**
 * RepositoryActivationService Unit Tests
 * 
 * Tests for the service that detects lockfiles on workspace open and prompts
 * users to enable repository bundles.
 * 
 * Requirements: 13.1-13.7, 12.4-12.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RepositoryActivationService } from '../../src/services/RepositoryActivationService';
import { LockfileManager } from '../../src/services/LockfileManager';
import { HubManager } from '../../src/services/HubManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { Lockfile } from '../../src/types/lockfile';
import { createMockLockfile } from '../helpers/lockfileTestHelpers';

suite('RepositoryActivationService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockLockfileManager: sinon.SinonStubbedInstance<LockfileManager>;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockContext: vscode.ExtensionContext;
    let service: RepositoryActivationService;
    let showInformationMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves()
            }
        } as any;
        
        // Mock getContext() to return the mock context
        mockStorage.getContext.returns(mockContext);
        
        service = new RepositoryActivationService(
            mockLockfileManager,
            mockHubManager,
            mockStorage
        );
        
        // Mock VS Code APIs
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('checkAndPromptActivation()', () => {
        test('should not prompt when no lockfile exists', async () => {
            // Arrange
            mockLockfileManager.read.resolves(null);

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!showInformationMessageStub.called, 'Should not show prompt when no lockfile');
        });

        test('should not prompt when repository was previously declined', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            (mockContext.globalState.get as sinon.SinonStub).returns(['/repo']);

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!showInformationMessageStub.called, 'Should not prompt when previously declined');
        });

        test('should prompt when lockfile exists and not previously declined', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            
            // Reset the context mock for this test
            const customContext = {
                globalState: {
                    get: sandbox.stub().withArgs('repositoryActivation.declined').returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 'Should show activation prompt');
        });

        test('should show bundle count in prompt message', async () => {
            // Arrange
            const lockfile = createMockLockfile(3);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('3'), 'Message should include bundle count');
        });

        test('should show profile count in prompt message when profiles exist', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeProfiles: true });
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('profile') || message.includes('Profile'), 
                'Message should mention profiles');
        });

        test('should call enableRepositoryBundles when user accepts', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Enable');
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(enableSpy.calledOnce, 'Should call enableRepositoryBundles');
            assert.ok(enableSpy.calledWith(lockfile), 'Should pass lockfile to enable method');
        });

        test('should remember declined when user selects "Don\'t ask again"', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Don\'t ask again');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(updateStub.calledOnce, 'Should update global state');
            const updateCall = updateStub.firstCall;
            assert.strictEqual(updateCall.args[0], 'repositoryActivation.declined');
            assert.ok(Array.isArray(updateCall.args[1]), 'Should store array of declined repos');
        });

        test('should not enable bundles when user declines', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Not now');
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!enableSpy.called, 'Should not enable bundles when declined');
        });

        test('should not enable bundles when user dismisses prompt', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves(undefined); // User dismissed
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!enableSpy.called, 'Should not enable bundles when dismissed');
        });
    });

    suite('showActivationPrompt()', () => {
        test('should return "enable" when user clicks Enable', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Enable');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'enable');
        });

        test('should return "decline" when user clicks Not now', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Not now');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'decline');
        });

        test('should return "never" when user clicks Don\'t ask again', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Don\'t ask again');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'never');
        });

        test('should return "decline" when user dismisses prompt', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves(undefined);

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'decline');
        });

        test('should show three action buttons: Enable, Not now, Don\'t ask again', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const callArgs = showInformationMessageStub.firstCall.args;
            const buttons = callArgs.slice(1); // Skip message, get buttons
            assert.strictEqual(buttons.length, 3, 'Should have exactly 3 buttons');
            assert.ok(buttons.includes('Enable'), 'Should have Enable button');
            assert.ok(buttons.includes('Not now'), 'Should have Not now button');
            assert.ok(buttons.includes('Don\'t ask again'), 'Should have Don\'t ask again button');
        });

        test('should include bundle count in message', async () => {
            // Arrange
            const lockfile = createMockLockfile(5);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('5'), 'Should include bundle count');
        });

        test('should mention profiles when lockfile has profiles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeProfiles: true });
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('profile'), 'Should mention profiles');
        });
    });

    suite('enableRepositoryBundles()', () => {
        test('should verify all bundles are installed', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]);

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(mockStorage.getInstalledBundles.calledOnce, 
                'Should check installed bundles');
        });

        test('should offer to install missing bundles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]); // No bundles installed
            showInformationMessageStub.resolves('Install');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt to install missing bundles');
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('missing') || message.toLowerCase().includes('install'),
                'Message should mention missing bundles');
        });

        test('should not prompt when all bundles are installed', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([
                { bundleId: 'bundle-0', scope: 'repository' } as any,
                { bundleId: 'bundle-1', scope: 'repository' } as any
            ]);

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(!showInformationMessageStub.called, 
                'Should not prompt when all bundles installed');
        });

        test('should check for missing sources and hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getInstalledBundles.resolves([
                { bundleId: 'bundle-0', scope: 'repository' } as any,
                { bundleId: 'bundle-1', scope: 'repository' } as any
            ]);
            const checkSpy = sandbox.spy(service, 'checkAndOfferMissingSources');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(checkSpy.calledOnce, 'Should check for missing sources/hubs');
            assert.ok(checkSpy.calledWith(lockfile), 'Should pass lockfile to check method');
        });
    });

    suite('checkAndOfferMissingSources()', () => {
        test('should detect missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([]); // No sources configured

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(result.missingSources.length > 0, 'Should detect missing sources');
            assert.strictEqual(result.missingSources[0], 'mock-source');
        });

        test('should detect missing hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([]); // No hubs configured

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(result.missingHubs.length > 0, 'Should detect missing hubs');
            assert.strictEqual(result.missingHubs[0], 'mock-hub');
        });

        test('should not detect sources that are already configured', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingSources.length, 0, 
                'Should not detect configured sources as missing');
        });

        test('should not detect hubs that are already imported', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([
                { id: 'mock-hub', name: 'Mock Hub', description: '', reference: { type: 'url', location: '' } }
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingHubs.length, 0, 
                'Should not detect imported hubs as missing');
        });

        test('should offer to add missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([]);
            showInformationMessageStub.resolves('Add Sources');

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt to add missing sources');
            assert.ok(result.offeredToAdd, 'Should indicate offer was made');
        });

        test('should offer to add missing hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([]);
            showInformationMessageStub.resolves('Add Sources');

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('hub') || message.toLowerCase().includes('source'),
                'Message should mention missing sources/hubs');
        });

        test('should return empty arrays when all sources and hubs are configured', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            mockHubManager.listHubs.resolves([
                { id: 'mock-hub', name: 'Mock Hub', description: '', reference: { type: 'url', location: '' } }
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingSources.length, 0);
            assert.strictEqual(result.missingHubs.length, 0);
            assert.ok(!result.offeredToAdd, 'Should not offer when nothing missing');
        });
    });

    suite('rememberDeclined()', () => {
        test('should store repository path in global state', async () => {
            // Arrange
            const repositoryPath = '/path/to/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(repositoryPath);

            // Assert
            assert.ok(updateStub.calledOnce, 'Should update global state');
            assert.strictEqual(updateStub.firstCall.args[0], 'repositoryActivation.declined');
            const declinedList = updateStub.firstCall.args[1] as string[];
            assert.ok(declinedList.includes(repositoryPath), 
                'Should include repository path in declined list');
        });

        test('should not duplicate repository paths', async () => {
            // Arrange
            const repositoryPath = '/path/to/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([repositoryPath]), // Already declined
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(repositoryPath);

            // Assert - should NOT call update since path already exists
            assert.ok(!updateStub.called, 'Should not update when path already exists');
        });

        test('should preserve existing declined repositories', async () => {
            // Arrange
            const existingPath = '/existing/repo';
            const newPath = '/new/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([existingPath]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(newPath);

            // Assert
            const declinedList = updateStub.firstCall.args[1] as string[];
            assert.ok(declinedList.includes(existingPath), 
                'Should preserve existing declined repository');
            assert.ok(declinedList.includes(newPath), 
                'Should add new declined repository');
        });
    });

    suite('Edge cases', () => {
        test('should handle lockfile read errors gracefully', async () => {
            // Arrange
            mockLockfileManager.read.rejects(new Error('Read error'));

            // Act & Assert - should not throw
            await service.checkAndPromptActivation();
            assert.ok(!showInformationMessageStub.called, 
                'Should not show prompt on error');
        });

        test('should handle empty lockfile gracefully', async () => {
            // Arrange
            const emptyLockfile = createMockLockfile(0);
            mockLockfileManager.read.resolves(emptyLockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.checkAndPromptActivation();

            // Assert - should still prompt even with 0 bundles
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt even with empty lockfile');
        });

        test('should handle missing lockfile path gracefully', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act & Assert - should not throw
            await service.checkAndPromptActivation();
        });

        test('should handle HubManager errors when checking missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.rejects(new Error('Hub error'));

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert - should still detect missing sources even if hub check fails
            assert.ok(result.missingSources.length > 0, 
                'Should still detect missing sources on hub error');
        });

        test('should handle storage errors when checking installed bundles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.rejects(new Error('Storage error'));

            // Act & Assert - should not throw
            await service.enableRepositoryBundles(lockfile);
        });
    });
});
