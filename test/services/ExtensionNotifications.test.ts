import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ExtensionNotifications } from '../../src/notifications/ExtensionNotifications';
import { NotificationManager } from '../../src/services/NotificationManager';

suite('ExtensionNotifications', () => {
    let sandbox: sinon.SinonSandbox;
    let notifications: ExtensionNotifications;
    let notificationManagerStub: any;
    let executeCommandStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        notificationManagerStub = {
            showError: sandbox.stub().resolves(undefined),
            showInfo: sandbox.stub().resolves(undefined),
            showWarning: sandbox.stub().resolves(undefined),
        };

        sandbox.stub(NotificationManager, 'getInstance').returns(notificationManagerStub as NotificationManager);
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        notifications = ExtensionNotifications.getInstance();
    });

    teardown(() => {
        sandbox.restore();
        // Reset singleton for isolation between tests
        (ExtensionNotifications as any).instance = undefined;
    });

    test('showInstallationError retry triggers install bundle command', async () => {
        notificationManagerStub.showError.resolves('Retry');

        const result = await notifications.showInstallationError('some error');

        assert.strictEqual(result, 'retry');
        assert.ok(executeCommandStub.calledOnce);
        assert.strictEqual(executeCommandStub.firstCall.args[0], 'promptRegistry.installBundle');
    });
});
