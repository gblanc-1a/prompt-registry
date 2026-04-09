/**
 * Unit tests for PromptExecutor
 */

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  PromptExecutor,
  PromptExecutionOptions,
} from '../../src/services/prompt-executor';

suite('PromptExecutor', () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let executor: PromptExecutor;
  let streamOutput: string[];
  let mockStream: vscode.ChatResponseStream;
  let mockToken: vscode.CancellationToken;

  const createMockStream = (): vscode.ChatResponseStream => {
    streamOutput = [];
    return {
      markdown: (value: string) => { streamOutput.push(value); },
      anchor: () => {},
      button: () => {},
      filetree: () => {},
      progress: () => {},
      push: () => {},
      reference: () => {},
      warning: () => {},
      confirmation: () => {},
      codeCitation: () => {},
      textEdit: () => {},
    } as any;
  };

  const createMockToken = (cancelled = false): vscode.CancellationToken => ({
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose: () => {} })
  } as any);

  const createOptions = (overrides?: Partial<PromptExecutionOptions>): PromptExecutionOptions => ({
    promptContent: 'Test prompt',
    userInput: 'Test input',
    stream: mockStream,
    token: mockToken,
    ...overrides,
  });

  setup(() => {
    sandbox = sinon.createSandbox();
    mockContext = {
      globalStorageUri: vscode.Uri.file('/mock/storage'),
      globalState: {
        get: () => undefined,
        update: async () => {},
        keys: () => [],
        setKeysForSync: sandbox.stub()
      } as any,
      extensionPath: '/mock/extension',
      extensionUri: vscode.Uri.file('/mock/extension'),
      subscriptions: []
    } as any;

    mockStream = createMockStream();
    mockToken = createMockToken();
    executor = new PromptExecutor(mockContext);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('execute()', () => {
    test('should show error when no models are available', async () => {
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([]);

      await executor.execute(createOptions());
      const output = streamOutput.join('');
      assert.ok(output.includes('No language model available'));
    });

    test('should stream response from language model', async () => {
      const mockResponse = {
        text: (async function* () {
          yield 'Hello ';
          yield 'World';
        })()
      };
      const mockModel = {
        vendor: 'copilot',
        family: 'gpt-4',
        sendRequest: sandbox.stub().resolves(mockResponse)
      };
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([mockModel]);

      await executor.execute(createOptions());
      const output = streamOutput.join('');
      assert.ok(output.includes('Hello '));
      assert.ok(output.includes('World'));
    });

    test('should fall back to any available model if preferred model not found', async () => {
      const mockResponse = {
        text: (async function* () {
          yield 'Fallback response';
        })()
      };
      const fallbackModel = {
        vendor: 'other',
        family: 'llama',
        sendRequest: sandbox.stub().resolves(mockResponse)
      };

      const selectStub = sandbox.stub((vscode as any).lm, 'selectChatModels');
      // First call (copilot/gpt-4) returns empty, second call (any) returns fallback
      selectStub.onFirstCall().resolves([]);
      selectStub.onSecondCall().resolves([fallbackModel]);

      await executor.execute(createOptions());
      const output = streamOutput.join('');
      assert.ok(output.includes('Fallback response'));
    });

    test('should include context in messages when provided', async () => {
      const mockResponse = {
        text: (async function* () { yield 'ok'; })()
      };
      const mockModel = {
        vendor: 'copilot',
        family: 'gpt-4',
        sendRequest: sandbox.stub().resolves(mockResponse)
      };
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([mockModel]);

      await executor.execute(createOptions({
        context: {
          selection: 'const x = 1;',
          fileName: 'test.ts',
          language: 'typescript'
        }
      }));

      const [messages] = mockModel.sendRequest.firstCall.args;
      assert.ok(messages.length >= 2, 'Should have prompt + context messages');
      const contextMsg = messages.find((m: any) => m.content.includes('Current Selection'));
      assert.ok(contextMsg, 'Should include context message');
      assert.ok(contextMsg.content.includes('const x = 1;'));
    });

    test('should handle cancellation during streaming', async () => {
      let cancelFn: (() => void) | undefined;
      const cancellableToken: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: any) => {
          cancelFn = listener;
          return { dispose: () => {} };
        }
      } as any;

      const mockResponse = {
        text: (async function* () {
          yield 'First chunk';
          // Simulate cancellation after first chunk
          (cancellableToken as any).isCancellationRequested = true;
          yield 'Second chunk';
        })()
      };
      const mockModel = {
        vendor: 'copilot',
        family: 'gpt-4',
        sendRequest: sandbox.stub().resolves(mockResponse)
      };
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([mockModel]);

      await executor.execute(createOptions({ token: cancellableToken }));
      const output = streamOutput.join('');
      assert.ok(output.includes('First chunk'));
      assert.ok(output.includes('cancelled'));
    });

    test('should handle model error gracefully', async () => {
      const mockModel = {
        vendor: 'copilot',
        family: 'gpt-4',
        sendRequest: sandbox.stub().rejects(new Error('Model unavailable'))
      };
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([mockModel]);

      await executor.execute(createOptions());
      const output = streamOutput.join('');
      assert.ok(output.includes('Error executing prompt'));
      assert.ok(output.includes('Model unavailable'));
    });

    test('should not add user input message when input is empty', async () => {
      const mockResponse = {
        text: (async function* () { yield 'ok'; })()
      };
      const mockModel = {
        vendor: 'copilot',
        family: 'gpt-4',
        sendRequest: sandbox.stub().resolves(mockResponse)
      };
      sandbox.stub((vscode as any).lm, 'selectChatModels').resolves([mockModel]);

      await executor.execute(createOptions({ userInput: '  ' }));

      const [messages] = mockModel.sendRequest.firstCall.args;
      // Should only have the prompt message, not an empty user input message
      assert.strictEqual(messages.length, 1);
    });
  });
});
