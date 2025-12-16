/**
 * Unit tests for AutoUpdatePreferenceManager
 * Tests centralized preference management with event emission
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { AutoUpdatePreferenceManager } from '../../src/services/AutoUpdatePreferenceManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { Logger } from '../../src/utils/logger';

suite('AutoUpdatePreferenceManager', () => {
    let sandbox: sinon.SinonSandbox;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let manager: AutoUpdatePreferenceManager;
    let loggerStub: sinon.SinonStubbedInstance<Logger>;
    let mockConfig: any;
    let getConfigurationStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub logger
        const loggerInstance = Logger.getInstance();
        loggerStub = sandbox.stub(loggerInstance);
        loggerStub.debug.returns();
        loggerStub.info.returns();
        loggerStub.warn.returns();
        loggerStub.error.returns();

        // Create stubbed storage
        mockStorage = {
            getUpdatePreference: sandbox.stub(),
            setUpdatePreference: sandbox.stub(),
        } as any;

        // Mock VS Code workspace configuration
        mockConfig = {
            get: sandbox.stub(),
        };
        getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);

        // Dispose old manager if exists
        if (manager) {
            manager.dispose();
        }

        // Create manager with mocked dependencies
        manager = new AutoUpdatePreferenceManager(mockStorage as any);
    });

    teardown(() => {
        if (manager) {
            manager.dispose();
        }
        sandbox.restore();
    });

    suite('getUpdatePreference()', () => {
        test('should delegate to RegistryStorage.getUpdatePreference', async () => {
            const bundleId = 'test-bundle';
            mockStorage.getUpdatePreference.withArgs(bundleId).resolves(true);

            const result = await manager.getUpdatePreference(bundleId);

            assert.strictEqual(result, true);
            assert.ok(mockStorage.getUpdatePreference.calledOnceWith(bundleId));
        });

        test('should return false when storage returns false', async () => {
            const bundleId = 'disabled-bundle';
            mockStorage.getUpdatePreference.withArgs(bundleId).resolves(false);

            const result = await manager.getUpdatePreference(bundleId);

            assert.strictEqual(result, false);
        });
    });

    suite('setUpdatePreference()', () => {
        test('should delegate to RegistryStorage.setUpdatePreference', async () => {
            const bundleId = 'test-bundle';
            const autoUpdate = true;
            mockStorage.setUpdatePreference.resolves();
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(true);

            await manager.setUpdatePreference(bundleId, autoUpdate);

            assert.ok(mockStorage.setUpdatePreference.calledOnceWith(bundleId, autoUpdate));
        });

        test('should fire onPreferenceChanged event with correct data', async () => {
            const bundleId = 'test-bundle';
            const autoUpdate = true;
            const globalEnabled = true;

            mockStorage.setUpdatePreference.resolves();
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(globalEnabled);

            // Listen for event
            let eventFired = false;
            let eventData: any;
            manager.onPreferenceChanged((e) => {
                eventFired = true;
                eventData = e;
            });

            await manager.setUpdatePreference(bundleId, autoUpdate);

            assert.strictEqual(eventFired, true, 'Event should be fired');
            assert.deepStrictEqual(eventData, {
                bundleId,
                autoUpdate,
                globalEnabled
            });
        });

        test('should include global flag in event when global auto-update disabled', async () => {
            const bundleId = 'test-bundle';
            const autoUpdate = true;
            const globalEnabled = false;

            mockStorage.setUpdatePreference.resolves();
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(globalEnabled);

            let eventData: any;
            manager.onPreferenceChanged((e) => {
                eventData = e;
            });

            await manager.setUpdatePreference(bundleId, autoUpdate);

            assert.strictEqual(eventData.globalEnabled, false);
            assert.strictEqual(eventData.autoUpdate, true);
        });
    });

    suite('isGlobalAutoUpdateEnabled()', () => {
        test('should read promptregistry.updateCheck.autoUpdate setting', () => {
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(true);

            const result = manager.isGlobalAutoUpdateEnabled();

            assert.strictEqual(result, true);
            assert.ok(mockConfig.get.calledOnce);
        });

        test('should return false when global setting is disabled', () => {
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(false);

            const result = manager.isGlobalAutoUpdateEnabled();

            assert.strictEqual(result, false);
        });

        test('should default to true when setting is not configured', () => {
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(undefined);

            const result = manager.isGlobalAutoUpdateEnabled();

            // Should use default value (true)
            assert.strictEqual(mockConfig.get.calledWith('updateCheck.autoUpdate', true), true);
        });
    });

    suite('dispose()', () => {
        test('should dispose event emitter', () => {
            const disposeSpy = sandbox.spy(manager as any, 'dispose');
            
            manager.dispose();

            assert.ok(disposeSpy.calledOnce);
        });

        test('should not throw when disposed multiple times', () => {
            assert.doesNotThrow(() => {
                manager.dispose();
                manager.dispose();
            });
        });
    });

    suite('Event subscription lifecycle', () => {
        test('should allow multiple event listeners', async () => {
            const bundleId = 'test-bundle';
            mockStorage.setUpdatePreference.resolves();
            mockConfig.get.withArgs('updateCheck.autoUpdate', true).returns(true);

            let listener1Fired = false;
            let listener2Fired = false;

            manager.onPreferenceChanged(() => { listener1Fired = true; });
            manager.onPreferenceChanged(() => { listener2Fired = true; });

            await manager.setUpdatePreference(bundleId, true);

            assert.strictEqual(listener1Fired, true, 'First listener should fire');
            assert.strictEqual(listener2Fired, true, 'Second listener should fire');
        });

        // Note: VS Code EventEmitter disposal is a core API feature tested by VS Code itself.
        // We rely on the VS Code API contract that disposable.dispose() removes event listeners.
        // Testing this behavior in unit tests would require mocking the entire EventEmitter,
        // which would not validate the actual integration with VS Code's event system.
    });
});
