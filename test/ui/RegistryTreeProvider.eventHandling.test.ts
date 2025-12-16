/**
 * RegistryTreeProvider Event Handling Tests
 *
 * Verifies that the tree view refreshes correctly on registry events
 * and that update detection updates installed bundle presentation.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RegistryTreeProvider, RegistryTreeItem, TreeItemType } from '../../src/ui/RegistryTreeProvider';
import { RegistryManager } from '../../src/services/RegistryManager';
import { HubManager } from '../../src/services/HubManager';
import { InstalledBundle, Bundle } from '../../src/types/registry';
import { UpdateCheckResult } from '../../src/services/UpdateCache';

suite('RegistryTreeProvider - Event Handling', () => {
    let sandbox: sinon.SinonSandbox;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;

    let onBundleUpdatedCallback: ((installation: InstalledBundle) => void) | undefined;
    let onAutoUpdatePreferenceChangedCallback: ((event: { bundleId: string; enabled: boolean }) => void) | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockRegistryManager = {
            onBundleInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUpdated: sandbox.stub().callsFake((cb: any) => {
                onBundleUpdatedCallback = cb;
                return { dispose: () => {} };
            }),
            onBundlesInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundlesUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onProfileActivated: sandbox.stub().returns({ dispose: () => {} }),
            onProfileDeactivated: sandbox.stub().returns({ dispose: () => {} }),
            onProfileCreated: sandbox.stub().returns({ dispose: () => {} }),
            onProfileUpdated: sandbox.stub().returns({ dispose: () => {} }),
            onProfileDeleted: sandbox.stub().returns({ dispose: () => {} }),
            onSourceAdded: sandbox.stub().returns({ dispose: () => {} }),
            onSourceRemoved: sandbox.stub().returns({ dispose: () => {} }),
            onSourceUpdated: sandbox.stub().returns({ dispose: () => {} }),
            onSourceSynced: sandbox.stub().returns({ dispose: () => {} }),
            onAutoUpdatePreferenceChanged: sandbox.stub().callsFake((cb: any) => {
                onAutoUpdatePreferenceChangedCallback = cb;
                return { dispose: () => {} };
            }),
            listInstalledBundles: sandbox.stub().resolves([]),
            getBundleDetails: sandbox.stub(),
            listProfiles: sandbox.stub().resolves([]),
            listSources: sandbox.stub().resolves([]),
            autoUpdateService: undefined,
        } as any;

        mockHubManager = {
            onHubImported: sandbox.stub().returns({ dispose: () => {} }),
            onHubDeleted: sandbox.stub().returns({ dispose: () => {} }),
            onHubSynced: sandbox.stub().returns({ dispose: () => {} }),
        } as any;
    });

    teardown(() => {
        sandbox.restore();
        onBundleUpdatedCallback = undefined;
        onAutoUpdatePreferenceChangedCallback = undefined;
    });

    suite('Refresh on registry events', () => {
        test('should refresh tree when bundle is updated', () => {
            const provider = new RegistryTreeProvider(mockRegistryManager as any, mockHubManager as any);

            const refreshSpy = sandbox.spy(provider, 'refresh');

            const installation: InstalledBundle = {
                bundleId: 'test-bundle',
                version: '1.1.0',
                installPath: '/mock/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: 'source-1',
                sourceType: 'github',
            } as any;

            assert.ok(onBundleUpdatedCallback, 'onBundleUpdated callback should be registered');
            onBundleUpdatedCallback!(installation);

            assert.ok(refreshSpy.calledOnce, 'refresh should be called when bundle updated');
        });

        test('should refresh tree when auto-update preference changes', () => {
            const provider = new RegistryTreeProvider(mockRegistryManager as any, mockHubManager as any);

            const refreshSpy = sandbox.spy(provider, 'refresh');

            assert.ok(onAutoUpdatePreferenceChangedCallback, 'onAutoUpdatePreferenceChanged callback should be registered');
            onAutoUpdatePreferenceChangedCallback!({ bundleId: 'test-bundle', enabled: true });

            assert.ok(refreshSpy.calledOnce, 'refresh should be called when auto-update preference changes');
        });
    });

    suite('Update detection integration', () => {
        test('should update installed bundle indicators when updates detected and then cleared', async () => {
            const provider = new RegistryTreeProvider(mockRegistryManager as any, mockHubManager as any);

            const installedBundle: InstalledBundle = {
                bundleId: 'bundle-1',
                version: '1.0.0',
                installPath: '/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: 'source-1',
                sourceType: 'github',
            } as any;

            const bundleDetails: Bundle = {
                id: 'bundle-1',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'desc',
                author: 'author',
                sourceId: 'source-1',
                environments: ['vscode'],
                tags: [],
                lastUpdated: '2024-01-01',
                size: '1MB',
                dependencies: [],
                license: 'MIT',
                manifestUrl: 'https://example.com/manifest.yml',
                downloadUrl: 'https://example.com/bundle.zip',
            } as any;

            mockRegistryManager.listInstalledBundles.resolves([installedBundle]);
            mockRegistryManager.getBundleDetails.resolves(bundleDetails);

            const updates: UpdateCheckResult[] = [
                {
                    bundleId: 'bundle-1',
                    currentVersion: '1.0.0',
                    latestVersion: '1.2.0',
                    releaseDate: new Date().toISOString(),
                    downloadUrl: 'https://example.com/bundle.zip',
                    autoUpdateEnabled: false,
                    releaseNotes: 'notes',
                },
            ];

            const rootItems = await provider.getChildren();
            const installedRoot = rootItems.find(i => i.type === TreeItemType.INSTALLED_ROOT)!;

            // Before updates detected, no update indicator
            let installedItems = await provider.getChildren(installedRoot);
            assert.strictEqual(installedItems.length, 1);
            let item = installedItems[0] as RegistryTreeItem;
            assert.ok(item.label.startsWith('✓ '));
            assert.strictEqual(item.description, `v${installedBundle.version}`);

            // When updates detected, indicator and version range should be shown
            provider.onUpdatesDetected(updates);
            installedItems = await provider.getChildren(installedRoot);
            item = installedItems[0] as RegistryTreeItem;
            assert.ok(item.label.startsWith('⬆️ '));
            assert.strictEqual(item.description, `v${installedBundle.version} → v${updates[0].latestVersion}`);

            // After clearing updates (e.g., after successful update), indicator should be removed
            const updatedBundle: InstalledBundle = { ...installedBundle, version: '1.2.0' } as any;
            mockRegistryManager.listInstalledBundles.resolves([updatedBundle]);
            provider.onUpdatesDetected([]);

            installedItems = await provider.getChildren(installedRoot);
            item = installedItems[0] as RegistryTreeItem;
            assert.ok(item.label.startsWith('✓ '));
            assert.strictEqual(item.description, `v${updatedBundle.version}`);
        });
    });
});
