import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { StatusCommand } from '../../src/commands/statusCommand';
import { InstallationManager } from '../../src/services/installationManager';
import { ExtensionUpdateManager } from '../../src/services/updateManager';

suite('StatusCommand - install fallback uses bundle install command', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('checkUpdates uses promptRegistry.installBundle when not installed and user accepts', async () => {
        const installationManagerStub = {
            getInstalledScopes: sandbox.stub().resolves([]),
        } as unknown as InstallationManager;

        const updateManagerStub = {
            checkForUpdates: sandbox.stub().resolves([]),
            getUpdateNotificationMessage: sandbox.stub().returns(''),
        } as unknown as ExtensionUpdateManager;

        sandbox.stub(InstallationManager, 'getInstance').returns(installationManagerStub);
        sandbox.stub(ExtensionUpdateManager, 'getInstance').returns(updateManagerStub);

        const showInformationMessageStub = sandbox
            .stub(vscode.window, 'showInformationMessage')
            .resolves('Install Prompt Registry' as any);

        const executeCommandStub = sandbox
            .stub(vscode.commands, 'executeCommand')
            .resolves();

        const command = new StatusCommand();
        await command.checkUpdates();

        assert.ok(showInformationMessageStub.calledOnce);
        assert.ok(executeCommandStub.calledOnce);
        assert.strictEqual(executeCommandStub.firstCall.args[0], 'promptRegistry.installBundle');
    });
});
