/**
 * Shared test fixtures for deployment tests.
 * @module test/deploy/fixtures
 */
import {
  createHash,
} from 'node:crypto';
import {
  dump as dumpYaml,
} from 'js-yaml';
import {
  createGovernedReleaseArchive,
} from '../../../core/test/fixtures/release-archives';
import type {
  DeployPorts,
  DeployRequest,
} from '../../src/deploy/types';
import type {
  DesiredLockfileV3,
  LocalLockfileV3,
} from '../../src/stores/lockfile-v3';

export const LOCAL_FILE = '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json';

/**
 * Seed a v3 local file holding one materialization record.
 * @param files - Files to include in the materialization record.
 * @returns JSON string of a LocalLockfileV3.
 */
export const seedLocal = (files: { path: string; installedChecksum: string }[]): string => JSON.stringify({
  version: '3.0.0',
  generatedAt: '2026-10-09T12:00:00.000Z',
  generatedBy: 'ai-primitives-hub-cli',
  migration: { lockfileV3: 'complete' },
  targets: {
    'my-vscode': {
      targetType: 'vscode',
      scope: 'user',
      baseDir: '/home/u/.copilot',
      bundles: {
        'github-abc123/web-dev': {
          version: '1.0.0',
          sourceId: 'github-abc123',
          installedAt: '2026-10-09T12:00:00.000Z',
          files
        }
      }
    }
  }
});

/**
 * Create a standard deployment request for testing.
 * @returns DeployRequest with test data.
 */
export const request = (): DeployRequest => ({
  files: createGovernedReleaseArchive({ id: 'web-dev', version: '1.0.0' }),
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/repo' },
  targetName: 'my-vscode',
  runtimeAssetRoot: '/home/u/.config/ai-primitives-hub/runtime',
  placement: {
    scope: 'user' as const,
    targetType: 'vscode' as const,
    resolvedLayout: {
      baseDir: '${HOME}/.copilot',
      kindRoutes: { 'prompts/': 'prompts/', 'instructions/': 'instructions/', 'agents/': 'agents/' },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    },
    baseRoot: '/home/u/.copilot',
    env: { HOME: '/home/u' }
  }
});

/**
 * Build a two-item governed release archive for testing rollback.
 * @returns ExtractedFiles with two prompt items.
 */
export function twoItemArchive(): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

  const sourceSnapshotPath = 'metadata/source/collections/governed.collection.yml';
  const archiveFiles = {
    'prompts/hello.prompt.md': '# Hello Prompt\n',
    'prompts/second.prompt.md': '# Second Prompt\n',
    [sourceSnapshotPath]: 'id: web-dev\n',
    'README.md': '# Two-item bundle\n',
    LICENSE: 'License text\n',
    'ignored/build/cache.pyc': 'cache bytes\n'
  };

  const fileEntries = Object.entries(archiveFiles).map(([filePath, content]) => ({
    path: filePath,
    role: filePath.startsWith('prompts/')
      ? 'installable'
      : (filePath.startsWith('ignored/') ? 'ignored' : 'metadata'),
    size: encoder.encode(content).byteLength,
    sha256: `sha256:${sha256(content)}`
  }));

  const manifest = {
    formatVersion: 1,
    id: 'web-dev',
    version: '1.0.0',
    name: 'Web Dev Bundle',
    readme: 'README.md',
    items: [
      { id: 'hello', path: 'prompts/hello.prompt.md', kind: 'prompt' },
      { id: 'second', path: 'prompts/second.prompt.md', kind: 'prompt' }
    ],
    prompts: [
      { id: 'hello', file: 'prompts/hello.prompt.md', type: 'prompt' },
      { id: 'second', file: 'prompts/second.prompt.md', type: 'prompt' }
    ],
    provenance: {
      source: 'https://github.com/example/web-dev',
      governance: {
        attestations: [],
        provenance: { ref: '', url: '', commit: '' }
      }
    },
    files: fileEntries
  };

  return new Map([
    ['deployment-manifest.yml', encoder.encode(dumpYaml(manifest, { lineWidth: -1 }))],
    ...Object.entries(archiveFiles).map(([filePath, content]) => [filePath, encoder.encode(content)] as const)
  ]);
}

/** Recording filesystem and ports for testing. */
export interface RecordingPorts extends DeployPorts {
  files: Map<string, string>;
  calls: string[];
  failWriteAt?: number;
}

/**
 * Create recording ports that write to memory and track calls.
 * @param opts - Options for the recording ports.
 * @param opts.now - ISO timestamp for generated files.
 * @param opts.failWriteAt - Fail the Nth writeFileBytes/writeFile call (1-indexed).
 * @returns Recording ports for testing.
 */
export const recordingPorts = (opts?: { now?: string; failWriteAt?: number }): RecordingPorts => {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const now = opts?.now ?? '2026-10-09T12:00:00.000Z';
  let writeCount = 0;

  // Create the ports object first so we can read its mutable failWriteAt property.
  const ports: RecordingPorts = {
    files,
    calls,
    failWriteAt: opts?.failWriteAt,
    fs: {
      readFile: async (p: string) => {
        const v = files.get(p);
        if (v === undefined) {
          throw new Error(`ENOENT ${p}`);
        }
        return v;
      },
      readFileBytes: async (p: string) => new TextEncoder().encode(files.get(p) ?? ''),
      exists: async (p: string) => files.has(p),
      lstat: async () => ({ isDirectory: false, isFile: true, isSymbolicLink: false, size: 0, mtimeMs: 0 }),
      stat: async () => ({ isDirectory: false, isFile: true, size: 0, mtimeMs: 0 }),
      writeFile: async (p: string, content: string) => {
        writeCount++;
        if (ports.failWriteAt !== undefined && writeCount === ports.failWriteAt) {
          throw new Error(`Simulated write failure at call ${writeCount}`);
        }
        calls.push(`writeFile:${p}`);
        files.set(p, content);
      },
      writeFileBytes: async (p: string, bytes: Uint8Array) => {
        writeCount++;
        if (ports.failWriteAt !== undefined && writeCount === ports.failWriteAt) {
          throw new Error(`Simulated write failure at call ${writeCount}`);
        }
        calls.push(`writeFileBytes:${p}`);
        files.set(p, new TextDecoder().decode(bytes));
      },
      writeJson: async () => {
        throw new Error('writeJson should not be called');
      },
      mkdir: async (p: string) => {
        calls.push(`mkdir:${p}`);
      },
      remove: async (p: string) => {
        calls.push(`remove:${p}`);
        files.delete(p);
      },
      rename: async (from: string, to: string) => {
        calls.push(`rename:${to}`);
        const content = files.get(from);
        if (content !== undefined) {
          files.set(to, content);
          files.delete(from);
        }
      },
      readJson: async (p: string) => JSON.parse(files.get(p) ?? 'null'),
      readDir: async () => [],
      readDirEntries: async () => []
    },
    env: { HOME: '/home/u' },
    appStorage: {
      getPaths: () => {
        throw new Error('appStorage.getPaths should not be called in deployBundle');
      },
      getState: async () => {
        throw new Error('appStorage.getState should not be called');
      },
      setState: async () => {
        throw new Error('appStorage.setState should not be called');
      }
    },
    lockfileStore: {
      desiredFile: '/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json',
      localFile: '/home/u/.config/ai-primitives-hub/ai-primitives-hub.local.lock.json',
      legacyFiles: []
    },
    generatedBy: 'test-harness',
    now,
    onEvent: (event) => {
      calls.push(`event:${JSON.stringify(event)}`);
    }
  };

  return ports;
};

/**
 * Read both halves of the pair a test's ports wrote.
 * @param ports - Recording ports.
 * @returns The desired and local lockfiles.
 */
export const readPair = (ports: RecordingPorts): { desired: DesiredLockfileV3; local: LocalLockfileV3 } => ({
  desired: JSON.parse(ports.files.get(ports.lockfileStore.desiredFile) ?? 'null'),
  local: JSON.parse(ports.files.get(ports.lockfileStore.localFile) ?? 'null')
});
