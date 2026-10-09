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
 * Create a deployment request for a skill bundle.
 * @returns DeployRequest for skill testing.
 */
export const skillRequest = (): DeployRequest => ({
  files: skillArchive(),
  bundle: { bundleId: 'skills', version: '1.0.0' },
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/skills' },
  targetName: 'my-vscode',
  runtimeAssetRoot: '/home/u/.config/ai-primitives-hub/runtime',
  placement: {
    scope: 'user' as const,
    targetType: 'vscode' as const,
    resolvedLayout: {
      baseDir: '${HOME}/.copilot',
      kindRoutes: { 'skills/': 'skills/' },
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

/**
 * Build a skill bundle for testing directory-kind deployment.
 * Uses legacy manifest format (no formatVersion) to avoid sha256 validation complexity.
 * @returns ExtractedFiles with a skill directory containing multiple files.
 */
export function skillArchive(): Map<string, Uint8Array> {
  const encoder = new TextEncoder();

  // Add a binary file that decodeUtf8Strict will reject
  const binaryContent = new Uint8Array([0xFF, 0xFE, 0x00]);

  // Legacy manifest format: no formatVersion, no files block, no sha256 checks
  const manifest = `id: skills
version: 1.0.0
name: Skills Bundle
prompts:
  - id: my-skill
    file: skills/my-skill/SKILL.md
    type: skill
`;

  return new Map<string, Uint8Array>([
    ['deployment-manifest.yml', encoder.encode(manifest)],
    ['skills/my-skill/SKILL.md', encoder.encode('# My Skill\n')],
    ['skills/my-skill/config.json', encoder.encode('{"enabled": true}\n')],
    ['skills/my-skill/binary.dat', binaryContent]
  ]);
}

/** Recording filesystem and ports for testing. */
export interface RecordingPorts extends DeployPorts {
  files: Map<string, string | Uint8Array>;
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
      readFile: async (filePath: string) => {
        const v = files.get(filePath);
        if (v === undefined) {
          throw new Error(`ENOENT ${filePath}`);
        }
        return typeof v === 'string' ? v : new TextDecoder().decode(v);
      },
      readFileBytes: async (filePath: string) => {
        const v = files.get(filePath);
        if (v === undefined) {
          throw new Error(`ENOENT ${filePath}`);
        }
        return typeof v === 'string' ? new TextEncoder().encode(v) : v;
      },
      exists: async (filePath: string) => {
        // Support directory existence: a path exists if it's a file or a directory prefix
        if (files.has(filePath)) {
          return true;
        }
        const dirPrefix = filePath.endsWith('/') ? filePath : filePath + '/';
        for (const key of files.keys()) {
          if (key.startsWith(dirPrefix)) {
            return true;
          }
        }
        return false;
      },
      lstat: async (filePath: string) => {
        // Check if this path is a directory (has files under it)
        const dirPrefix = filePath.endsWith('/') ? filePath : filePath + '/';
        const isDirectory = Array.from(files.keys()).some((k) => k.startsWith(dirPrefix));
        return { isDirectory, isFile: !isDirectory, isSymbolicLink: false, size: 0, mtimeMs: 0 };
      },
      stat: async (filePath: string) => {
        const dirPrefix = filePath.endsWith('/') ? filePath : filePath + '/';
        const isDirectory = Array.from(files.keys()).some((k) => k.startsWith(dirPrefix));
        return { isDirectory, isFile: !isDirectory, size: 0, mtimeMs: 0 };
      },
      writeFile: async (filePath: string, content: string) => {
        writeCount++;
        if (ports.failWriteAt !== undefined && writeCount === ports.failWriteAt) {
          throw new Error(`Simulated write failure at call ${writeCount}`);
        }
        calls.push(`writeFile:${filePath}`);
        files.set(filePath, content);
      },
      writeFileBytes: async (filePath: string, bytes: Uint8Array) => {
        writeCount++;
        if (ports.failWriteAt !== undefined && writeCount === ports.failWriteAt) {
          throw new Error(`Simulated write failure at call ${writeCount}`);
        }
        calls.push(`writeFileBytes:${filePath}`);
        files.set(filePath, bytes);
      },
      writeJson: async (_filePath: string) => {
        throw new Error('writeJson should not be called');
      },
      mkdir: async (dirPath: string) => {
        calls.push(`mkdir:${dirPath}`);
      },
      remove: async (filePath: string) => {
        calls.push(`remove:${filePath}`);
        files.delete(filePath);
      },
      rename: async (fromPath: string, toPath: string) => {
        calls.push(`rename:${toPath}`);
        const content = files.get(fromPath);
        if (content !== undefined) {
          files.set(toPath, content);
          files.delete(fromPath);
        }
      },
      readJson: async (filePath: string) => {
        const v = files.get(filePath);
        if (v === undefined) {
          return null;
        }
        const text = typeof v === 'string' ? v : new TextDecoder().decode(v);
        return JSON.parse(text);
      },
      readDir: async (_dirPath: string) => [],
      readDirEntries: async (_dirPath: string) => []
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
