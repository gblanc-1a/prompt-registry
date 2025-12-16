/**
 * Unit tests for NotificationService
 * Tests notification deduplication with fingerprint-based caching
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { NotificationService } from '../../src/services/NotificationService';
import { BundleUpdateNotifications } from '../../src/notifications/BundleUpdateNotifications';
import { UpdateCheckResult } from '../../src/services/UpdateCache';
import { Logger } from '../../src/utils/logger';

suite('NotificationService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockBundleNotifications: sinon.SinonStubbedInstance<BundleUpdateNotifications>;
    let service: NotificationService;
    let loggerStub: sinon.SinonStubbedInstance<Logger>;
    let clock: sinon.SinonFakeTimers;

    const createUpdate = (bundleId: string, version: string): UpdateCheckResult => ({
        bundleId,
        currentVersion: '1.0.0',
        latestVersion: version,
        autoUpdateEnabled: false,
        releaseDate: new Date().toISOString(),
        downloadUrl: `https://example.com/${bundleId}/${version}.zip`,
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        clock = sinon.useFakeTimers();

        // Stub logger
        const loggerInstance = Logger.getInstance();
        loggerStub = sandbox.stub(loggerInstance);
        loggerStub.debug.returns();
        loggerStub.info.returns();
        loggerStub.warn.returns();
        loggerStub.error.returns();

        // Create stubbed BundleUpdateNotifications
        mockBundleNotifications = {
            showUpdateNotification: sandbox.stub().resolves(),
            showAutoUpdateComplete: sandbox.stub().resolves(),
            showUpdateFailure: sandbox.stub().resolves(),
        } as any;

        // Create service
        service = new NotificationService(mockBundleNotifications as any);
    });

    teardown(() => {
        clock.restore();
        sandbox.restore();
    });

    suite('Deduplication by fingerprint', () => {
        test('should show notification on first call', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledOnce);
            assert.ok(mockBundleNotifications.showUpdateNotification.calledWith({
                updates,
                notificationPreference: 'all',
            }));
        });

        test('should suppress duplicate notification within TTL window', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // First call
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Second call with same updates within 5 minutes
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledOnce, 'Should only show once');
        });

        test('should show notification after TTL expires', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // First call
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Advance time by 6 minutes (past 5 minute TTL)
            clock.tick(6 * 60 * 1000);

            // Second call - should show again
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice, 'Should show after TTL expires');
        });

        test('should allow notification for new version of same bundle', async () => {
            const updates1 = [createUpdate('bundle-1', '2.0.0')];
            const updates2 = [createUpdate('bundle-1', '2.1.0')];

            // First call with version 2.0.0
            await service.showUpdateNotification({
                updates: updates1,
                source: 'background',
                notificationPreference: 'all',
            });

            // Second call with version 2.1.0 - different fingerprint
            await service.showUpdateNotification({
                updates: updates2,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice, 'Should show for new version');
        });

        test('should use bundleId@version as fingerprint', async () => {
            const updates = [
                createUpdate('bundle-1', '2.0.0'),
                createUpdate('bundle-2', '1.5.0'),
            ];

            // First call with both updates
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Second call with same updates
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledOnce, 'Should deduplicate by fingerprint');
        });
    });

    suite('Manual check bypass', () => {
        test('should always show notification when source=manual', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // First call as background
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Second call as manual - should bypass cache
            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice, 'Manual check should bypass cache');
        });

        test('should allow multiple manual checks in succession', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            assert.strictEqual(mockBundleNotifications.showUpdateNotification.callCount, 3, 'All manual checks should show');
        });
    });

    suite('Mixed update scenarios', () => {
        test('should handle manual check followed by background check', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // Manual check
            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            // Background check within TTL - should be suppressed
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledOnce, 'Background after manual should be suppressed');
        });

        test('should handle background check followed by manual check', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // Background check
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Manual check - should bypass
            await service.showUpdateNotification({
                updates,
                source: 'manual',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice, 'Manual should bypass background cache');
        });
    });

    suite('Multiple rapid checks', () => {
        test('should suppress rapid successive background checks', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // Simulate 5 rapid background checks
            for (let i = 0; i < 5; i++) {
                await service.showUpdateNotification({
                    updates,
                    source: 'background',
                    notificationPreference: 'all',
                });
                clock.tick(10 * 1000); // 10 seconds between each
            }

            assert.ok(mockBundleNotifications.showUpdateNotification.calledOnce, 'Should only show first notification');
        });

        test('should handle different bundles in rapid succession', async () => {
            const updates1 = [createUpdate('bundle-1', '2.0.0')];
            const updates2 = [createUpdate('bundle-2', '1.5.0')];

            await service.showUpdateNotification({
                updates: updates1,
                source: 'background',
                notificationPreference: 'all',
            });

            await service.showUpdateNotification({
                updates: updates2,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice, 'Different bundles should both show');
        });
    });

    suite('Cache cleanup', () => {
        test('should clean up expired entries from cache', async () => {
            const updates = [createUpdate('bundle-1', '2.0.0')];

            // Add entry to cache
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            // Advance time past TTL
            clock.tick(6 * 60 * 1000);

            // This should trigger cleanup and allow the notification
            await service.showUpdateNotification({
                updates,
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.calledTwice);
        });
    });

    suite('Empty updates', () => {
        test('should not show notification for empty updates array', async () => {
            await service.showUpdateNotification({
                updates: [],
                source: 'background',
                notificationPreference: 'all',
            });

            assert.ok(mockBundleNotifications.showUpdateNotification.notCalled, 'Should not show for empty updates');
        });
    });
});
