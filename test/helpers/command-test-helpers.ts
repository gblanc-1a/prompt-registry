/**
 * Shared test utilities for command tests.
 * Provides factories for common mock objects and setup patterns.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

// ─── Mock Memento ───────────────────────────────────────────────────────────

/**
 * Create a mock vscode.Memento backed by a Map.
 * Useful for testing services that use globalState or workspaceState.
 */
export function createMockMemento(sandbox: sinon.SinonSandbox): {
  memento: vscode.Memento;
  data: Map<string, any>;
} {
  const data = new Map<string, any>();
  const memento = {
    get: (key: string, defaultValue?: any) => data.get(key) ?? defaultValue,
    update: async (key: string, value: any) => { data.set(key, value); },
    keys: () => Array.from(data.keys()),
    setKeysForSync: sandbox.stub()
  } as any as vscode.Memento;
  return { memento, data };
}

// ─── Mock ExtensionContext ──────────────────────────────────────────────────

/**
 * Create a mock vscode.ExtensionContext with sensible defaults.
 * globalStorageUri points to the given path (or /mock/storage).
 */
export function createMockContext(
  sandbox: sinon.SinonSandbox,
  storagePath = '/mock/storage'
): {
  context: vscode.ExtensionContext;
  globalStateData: Map<string, any>;
} {
  const { memento, data } = createMockMemento(sandbox);
  const context = {
    globalState: memento,
    globalStorageUri: vscode.Uri.file(storagePath),
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
    subscriptions: [],
    extensionMode: 1 as any // Production
  } as any as vscode.ExtensionContext;
  return { context, globalStateData: data };
}

// ─── Workspace Folder Mock ─────────────────────────────────────────────────

/**
 * Override vscode.workspace.workspaceFolders for the duration of a test.
 * Returns a restore function to call in teardown.
 *
 * Usage:
 *   const { tempDir, restore } = mockWorkspaceFolder();
 *   // ... test ...
 *   restore(); // in teardown
 *   fs.rmSync(tempDir, { recursive: true, force: true });
 */
export function mockWorkspaceFolder(dirPrefix = 'cmd-test-'): {
  tempDir: string;
  restore: () => void;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), dirPrefix));
  const original = vscode.workspace.workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{
    uri: vscode.Uri.file(tempDir),
    name: 'workspace',
    index: 0
  }];
  return {
    tempDir,
    restore: () => { (vscode.workspace as any).workspaceFolders = original; }
  };
}

// ─── withProgress stub ─────────────────────────────────────────────────────

/**
 * Stub vscode.window.withProgress so it immediately invokes the task
 * with a dummy progress reporter and cancellation token.
 */
export function stubWithProgress(sandbox: sinon.SinonSandbox): sinon.SinonStub {
  return sandbox.stub(vscode.window, 'withProgress').callsFake(
    async (_opts: any, task: any) => {
      const progress = { report: () => {} };
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
      return await task(progress, token);
    }
  );
}

// ─── Input sequence helper ─────────────────────────────────────────────────

/**
 * Stub vscode.window.showInputBox to return a sequence of values,
 * one per successive call. Returns the stub for additional assertions.
 */
export function stubInputSequence(
  sandbox: sinon.SinonSandbox,
  values: (string | undefined)[]
): sinon.SinonStub {
  const stub = sandbox.stub(vscode.window, 'showInputBox');
  values.forEach((val, i) => stub.onCall(i).resolves(val));
  return stub;
}
