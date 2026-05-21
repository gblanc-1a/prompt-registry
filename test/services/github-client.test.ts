import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  GitHubClient,
} from '../../src/services/github-client';

suite('GitHubClient', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('constructor', () => {
    test('parses HTTPS URL to extract owner and repo', () => {
      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
      });
      assert.strictEqual(client.owner, 'octocat');
      assert.strictEqual(client.repo, 'hello-world');
    });

    test('parses HTTPS URL with .git suffix', () => {
      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world.git',
      });
      assert.strictEqual(client.owner, 'octocat');
      assert.strictEqual(client.repo, 'hello-world');
    });

    test('parses SSH URL', () => {
      const client = new GitHubClient({
        sourceUrl: 'git@github.com:octocat/hello-world.git',
      });
      assert.strictEqual(client.owner, 'octocat');
      assert.strictEqual(client.repo, 'hello-world');
    });

    test('throws on invalid URL', () => {
      assert.throws(
        () => new GitHubClient({ sourceUrl: 'https://gitlab.com/foo/bar' }),
        /Invalid GitHub URL/
      );
    });

    test('throws on malformed URL', () => {
      assert.throws(
        () => new GitHubClient({ sourceUrl: 'not-a-url' }),
        /Invalid GitHub URL/
      );
    });
  });

  suite('authenticate()', () => {
    test('uses VS Code session as primary auth method', async () => {
      const mockSession = { accessToken: 'vscode-token-12345678' };
      sandbox.stub(vscode.authentication, 'getSession').resolves(mockSession as any);

      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
        explicitToken: 'explicit-token',
      });
      await client.authenticate();

      assert.strictEqual(client.getAuthMethod(), 'vscode');
    });

    test('falls back to explicit token when VS Code auth fails', async () => {
      sandbox.stub(vscode.authentication, 'getSession').rejects(new Error('no session'));

      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
        explicitToken: 'explicit-token-1234',
      });
      await client.authenticate();

      assert.strictEqual(client.getAuthMethod(), 'explicit');
    });

    test('falls back to gh CLI when VS Code and explicit both fail', async () => {
      sandbox.stub(vscode.authentication, 'getSession').rejects(new Error('no session'));

      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
      });

      sandbox.stub(client as any, 'execGhAuthToken').resolves('gh-cli-token-12345678');

      await client.authenticate();

      assert.strictEqual(client.getAuthMethod(), 'gh-cli');
    });

    test('falls back to unauthenticated when all methods fail', async () => {
      sandbox.stub(vscode.authentication, 'getSession').rejects(new Error('no session'));

      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
      });

      sandbox.stub(client as any, 'execGhAuthToken').rejects(new Error('gh not found'));

      await client.authenticate();

      assert.strictEqual(client.getAuthMethod(), 'none');
    });

    test('caches authentication result on subsequent calls', async () => {
      const getSessionStub = sandbox.stub(vscode.authentication, 'getSession')
        .resolves({ accessToken: 'cached-token' } as any);

      const client = new GitHubClient({
        sourceUrl: 'https://github.com/octocat/hello-world',
      });

      await client.authenticate();
      await client.authenticate();

      assert.strictEqual(getSessionStub.callCount, 1);
    });
  });
});
