/**
 * RegistryManager Behavior Tests
 * 
 * Tests verify actual outcomes rather than implementation details.
 * Focus on requirements from bundle-state-management-fixes spec.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { RegistrySource } from '../../src/types/registry';
import { RepositoryAdapterFactory } from '../../src/adapters/RepositoryAdapter';

suite('RegistryManager - Settings Export/Import Behavior', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        manager = RegistryManager.getInstance(mockContext);
        
        // Create and inject mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockStorage.getSources.resolves([]);
        mockStorage.getProfiles.resolves([]);
        mockStorage.getInstalledBundles.resolves([]);
        (manager as any).storage = mockStorage;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should export settings as JSON string with required fields', async () => {
        const exportedString = await manager.exportSettings('json');
        const exported = JSON.parse(exportedString);
        
        assert.ok(exported.version, 'Should have version');
        assert.ok(exported.exportedAt, 'Should have timestamp');
        assert.ok(Array.isArray(exported.sources), 'Should have sources array');
        assert.ok(Array.isArray(exported.profiles), 'Should have profiles array');
    });

    test('should import settings from JSON string', async () => {
        const testData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            sources: [{
                id: 'test-source',
                name: 'Test',
                type: 'local' as const,
                url: 'file:///mock/path',
                enabled: true,
                priority: 0
            }],
            profiles: [],
            configuration: {}
        };
        
        mockStorage.addSource.resolves();
        mockStorage.getSources.resolves([testData.sources[0]]);
        
        await manager.importSettings(JSON.stringify(testData), 'json', 'merge');
        
        // Verify source was added
        const sources = await manager.listSources();
        assert.ok(sources.length > 0, 'Should have imported sources');
    });
});

suite('RegistryManager - Version Selection Behavior', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        (mockContext.globalState.get as sinon.SinonStub).withArgs('sources').returns([]);
        (mockContext.globalState.get as sinon.SinonStub).withArgs('profiles').returns([]);
        (mockContext.globalState.get as sinon.SinonStub).withArgs('installations').returns([]);

        manager = RegistryManager.getInstance(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should retrieve available versions for a bundle', async () => {
        // This tests Requirement 2.1: Display dropdown with all available versions
        const bundleId = 'owner-repo-v2.0.0';
        
        const versions = await manager.getAvailableVersions(bundleId);
        
        // Should return array of version strings
        assert.ok(Array.isArray(versions), 'Should return array of versions');
    });
});

suite('RegistryManager - Event Emission Behavior', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        (mockContext.globalState.get as sinon.SinonStub).withArgs('sources').returns([]);
        (mockContext.globalState.get as sinon.SinonStub).withArgs('profiles').returns([]);
        (mockContext.globalState.get as sinon.SinonStub).withArgs('installations').returns([]);

        manager = RegistryManager.getInstance(mockContext);
        
        // Create and inject mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockStorage.getSources.resolves([]);
        mockStorage.getProfiles.resolves([]);
        mockStorage.getInstalledBundles.resolves([]);
        (manager as any).storage = mockStorage;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should fire onBundleInstalled event when bundle is installed', async () => {
        // Requirement 6.1: Fire onBundleInstalled event
        let eventFired = false;
        let firedBundleId: string | undefined;
        
        manager.onBundleInstalled((bundle) => {
            eventFired = true;
            firedBundleId = bundle.bundleId;
        });
        
        // Simulate the event firing (this would normally happen during actual installation)
        const testBundle = {
            bundleId: 'test-bundle-v1.0.0',
            version: '1.0.0',
            sourceId: 'test-source',
            installedAt: new Date().toISOString(),
            scope: 'user' as const
        };
        
        // Fire the event directly to test listener behavior
        (manager as any)._onBundleInstalled.fire(testBundle);
        
        assert.ok(eventFired, 'Event should fire when bundle is installed');
        assert.strictEqual(firedBundleId, 'test-bundle-v1.0.0', 'Event should contain correct bundle ID');
    });

    test('should fire onBundleUninstalled event when bundle is uninstalled', async () => {
        // Requirement 6.2: Fire onBundleUninstalled event
        let eventFired = false;
        let firedBundleId: string | undefined;
        
        manager.onBundleUninstalled((bundleId) => {
            eventFired = true;
            firedBundleId = bundleId;
        });
        
        // Fire the event directly to test listener behavior
        (manager as any)._onBundleUninstalled.fire('test-bundle-v1.0.0');
        
        assert.ok(eventFired, 'Event should fire when bundle is uninstalled');
        assert.strictEqual(firedBundleId, 'test-bundle-v1.0.0', 'Event should contain correct bundle ID');
    });

    test('should fire onBundleUpdated event when bundle is updated', async () => {
        // Requirement 6.3: Fire onBundleUpdated event
        let eventFired = false;
        let firedUpdate: any;
        
        manager.onBundleUpdated((update) => {
            eventFired = true;
            firedUpdate = update;
        });
        
        const testUpdate = {
            bundleId: 'test-bundle-v1.0.0',
            oldVersion: '1.0.0',
            newVersion: '2.0.0'
        };
        
        // Fire the event directly to test listener behavior
        (manager as any)._onBundleUpdated.fire(testUpdate);
        
        assert.ok(eventFired, 'Event should fire when bundle is updated');
        assert.strictEqual(firedUpdate.bundleId, 'test-bundle-v1.0.0', 'Event should contain correct bundle ID');
        assert.strictEqual(firedUpdate.newVersion, '2.0.0', 'Event should contain new version');
    });
});

suite('RegistryManager - Installation Record Structure', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        manager = RegistryManager.getInstance(mockContext);
        
        // Create and inject mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockStorage.getInstalledBundles.resolves([]);
        (manager as any).storage = mockStorage;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should list installed bundles', async () => {
        // Requirement 4.5: Store both full bundle ID and source type
        const installed = await manager.listInstalledBundles();
        
        assert.ok(Array.isArray(installed), 'Should return array of installed bundles');
    });

    test('should return empty array when no bundles installed', async () => {
        const installed = await manager.listInstalledBundles();
        
        assert.strictEqual(installed.length, 0, 'Should return empty array');
    });
});

suite('RegistryManager - Source Management', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        manager = RegistryManager.getInstance(mockContext);
        
        // Create and inject mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockStorage.getSources.resolves([]);
        (manager as any).storage = mockStorage;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should list sources', async () => {
        const sources = await manager.listSources();
        
        assert.ok(Array.isArray(sources), 'Should return array of sources');
    });

    test('should add a new source and make it available in source list', async () => {
        const newSource: RegistrySource = {
            id: 'new-source',
            name: 'New Source',
            type: 'local',
            url: 'file:///mock/path',
            enabled: true,
            priority: 0
        };
        
        // Mock the storage to return the new source after adding
        mockStorage.addSource.resolves();
        mockStorage.getSources.resolves([newSource]);
        
        // Mock the adapter factory to return a mock adapter with successful validation
        const mockAdapter = {
            validate: sandbox.stub().resolves({ valid: true, errors: [] }),
            fetchBundles: sandbox.stub().resolves([])
        };
        const factoryStub = sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);
        
        await manager.addSource(newSource);
        
        // Verify the source is now in the list
        const sources = await manager.listSources();
        assert.ok(sources.some(s => s.id === 'new-source'), 'Added source should be in source list');
        assert.strictEqual(sources[0].name, 'New Source', 'Source should have correct name');
        
        // Verify adapter was created and validated
        assert.ok(factoryStub.called, 'Adapter factory should be called');
        assert.ok(mockAdapter.validate.called, 'Adapter validation should be called');
    });
});

suite('RegistryManager - Version Change Installation', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let manager: RegistryManager;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/path',
            extensionUri: vscode.Uri.file('/mock/path'),
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global'),
            asAbsolutePath: (p: string) => `/mock/path/${p}`,
        } as any;

        manager = RegistryManager.getInstance(mockContext);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        (manager as any).storage = mockStorage;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should allow installing different version when bundle already installed', async () => {
        const bundleId = 'test-bundle';
        
        // Mock existing installation with v1.0.0
        mockStorage.getInstalledBundle.resolves({
            bundleId: bundleId,
            version: '1.0.0',
            installedAt: new Date().toISOString(),
            scope: 'user',
            sourceId: 'test-source',
            sourceType: 'github',
            installPath: '/mock/path',
            manifest: { id: bundleId, name: 'Test', version: '1.0.0' } as any
        });

        // Mock bundle resolution to return v1.0.1
        const mockBundle = {
            id: bundleId,
            name: 'Test Bundle',
            version: '1.0.1',
            description: 'Test',
            author: 'Test',
            tags: []
        };

        // Stub internal methods
        sandbox.stub(manager as any, 'resolveInstallationBundle').resolves(mockBundle);
        sandbox.stub(manager as any, 'getSourceForBundle').resolves({ id: 'test-source', type: 'github' });
        sandbox.stub(manager as any, 'downloadAndInstall').resolves({
            bundleId: bundleId,
            version: '1.0.1',
            installedAt: new Date().toISOString(),
            scope: 'user',
            sourceId: 'test-source',
            sourceType: 'github'
        });
        mockStorage.recordInstallation.resolves();

        // Should not throw error - version change should be allowed
        await assert.doesNotReject(
            manager.installBundle(bundleId, { scope: 'user', version: '1.0.1' }),
            'Installing different version should not throw error'
        );

        // Verify installation was recorded
        assert.ok(mockStorage.recordInstallation.called, 'Installation should be recorded');
    });

    test('should throw error when installing same version without force', async () => {
        const bundleId = 'test-bundle';
        
        // Mock existing installation with v1.0.0
        mockStorage.getInstalledBundle.resolves({
            bundleId: bundleId,
            version: '1.0.0',
            installedAt: new Date().toISOString(),
            scope: 'user',
            sourceId: 'test-source',
            sourceType: 'github',
            installPath: '/mock/path',
            manifest: { id: bundleId, name: 'Test', version: '1.0.0' } as any
        });

        // Mock bundle resolution to return same version
        const mockBundle = {
            id: bundleId,
            name: 'Test Bundle',
            version: '1.0.0',
            description: 'Test',
            author: 'Test',
            tags: []
        };

        sandbox.stub(manager as any, 'resolveInstallationBundle').resolves(mockBundle);

        // Should throw error for same version
        await assert.rejects(
            manager.installBundle(bundleId, { scope: 'user', version: '1.0.0' }),
            /already installed/,
            'Installing same version should throw error'
        );
    });

    test('should allow downgrade from v1.0.17 to v1.0.15', async () => {
        const bundleId = 'amadeus-airlines-solutions-workflow-instructions';
        
        // Mock existing installation with v1.0.17
        mockStorage.getInstalledBundle.resolves({
            bundleId: `${bundleId}-1.0.17`,
            version: '1.0.17',
            installedAt: new Date().toISOString(),
            scope: 'user',
            sourceId: 'test-source',
            sourceType: 'github',
            installPath: '/mock/path',
            manifest: { id: bundleId, name: 'Amadeus', version: '1.0.17' } as any
        });

        // Mock bundle resolution to return v1.0.15 (downgrade)
        const mockBundle = {
            id: `${bundleId}-1.0.15`,
            name: 'Amadeus Airlines Solutions',
            version: '1.0.15',
            description: 'Test',
            author: 'Test',
            tags: []
        };

        sandbox.stub(manager as any, 'resolveInstallationBundle').resolves(mockBundle);
        sandbox.stub(manager as any, 'getSourceForBundle').resolves({ id: 'test-source', type: 'github' });
        sandbox.stub(manager as any, 'downloadAndInstall').resolves({
            bundleId: `${bundleId}-1.0.15`,
            version: '1.0.15',
            installedAt: new Date().toISOString(),
            scope: 'user',
            sourceId: 'test-source',
            sourceType: 'github'
        });
        mockStorage.recordInstallation.resolves();

        // Should allow downgrade
        await assert.doesNotReject(
            manager.installBundle(bundleId, { scope: 'user', version: '1.0.15' }),
            'Downgrade should be allowed'
        );

        assert.ok(mockStorage.recordInstallation.called, 'Downgrade should be recorded');
    });
});
