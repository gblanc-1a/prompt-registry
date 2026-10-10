/**
 * Shared test fixtures for deployment tests.
 * @module test/deploy/fixtures
 */
import {
  createHash,
} from 'node:crypto';
import * as posix from 'node:path/posix';
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
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/repo' },
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
      revision: '0123456789abcdef0123456789abcdef01234567',
      collectionPath: 'collections/governed.collection.yml',
      sourceSnapshotPath,
      license: 'Test-License',
      licensePath: 'LICENSE'
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

/** A governed skill with non-installable children beside its entry point. */
export function governedSkillArchive(): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const archive = {
    'skills/my-skill/SKILL.md': '# Governed skill\n',
    'skills/my-skill/private.json': '{}',
    'skills/my-skill/notes.md': '# Metadata\n',
    'README.md': '# Skills\n',
    LICENSE: 'Test license',
    'metadata/source.yml': 'id: skills\n'
  };
  const manifest = {
    formatVersion: 1, id: 'skills', version: '1.0.0', name: 'Skills', readme: 'README.md',
    items: [{ id: 'my-skill', path: 'skills/my-skill/SKILL.md', kind: 'skill' }],
    prompts: [{ id: 'my-skill', file: 'skills/my-skill/SKILL.md', type: 'skill' }],
    provenance: {
      source: 'https://github.com/owner/repo',
      revision: '0123456789abcdef0123456789abcdef01234567',
      collectionPath: 'collections/skills.yml', sourceSnapshotPath: 'metadata/source.yml',
      license: 'Test-License', licensePath: 'LICENSE'
    },
    files: Object.entries(archive).map(([filePath, content]) => ({
      path: filePath,
      role: filePath.endsWith('SKILL.md') ? 'installable' : (filePath.endsWith('private.json') ? 'ignored' : 'metadata'),
      size: encoder.encode(content).length,
      sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`
    }))
  };
  return new Map([
    ['deployment-manifest.yml', encoder.encode(dumpYaml(manifest))],
    ...Object.entries(archive).map(([filePath, content]) => [filePath, encoder.encode(content)] as const)
  ]);
}

/**
 * Build a simple prompt bundle for testing upgrades.
 * @param version - Version string for the manifest.
 * @param content - Content for the prompt file.
 * @returns ExtractedFiles with a single prompt.
 */
export function promptArchive(version: string, content: string): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const manifest = `id: upgrade-test
version: ${version}
name: Upgrade Test Bundle
prompts:
  - id: test-prompt
    file: prompts/test-prompt.prompt.md
    type: prompt
`;
  return new Map<string, Uint8Array>([
    ['deployment-manifest.yml', encoder.encode(manifest)],
    ['prompts/test-prompt.prompt.md', encoder.encode(content)]
  ]);
}

/**
 * Build a skill bundle with specific content for testing upgrades.
 * @param version - Version string for the manifest.
 * @param content - Content for the main skill file.
 * @returns ExtractedFiles with a skill directory.
 */
export function skillArchiveVersioned(version: string, content: string): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const manifest = `id: skills
version: ${version}
name: Skills Bundle
prompts:
  - id: upgrade-skill
    file: skills/upgrade-skill/SKILL.md
    type: skill
`;
  return new Map<string, Uint8Array>([
    ['deployment-manifest.yml', encoder.encode(manifest)],
    ['skills/upgrade-skill/SKILL.md', encoder.encode(content)],
    ['skills/upgrade-skill/config.json', encoder.encode('{"enabled": true}\n')]
  ]);
}

/**
 * Create a deployment request for testing upgrades.
 * @param files - Archive files.
 * @param version - Version string.
 * @returns DeployRequest for upgrade testing.
 */
export const upgradePromptRequest = (files: Map<string, Uint8Array>, version: string): DeployRequest => ({
  files,
  bundle: { bundleId: 'upgrade-test', version },
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/repo' },
  targetName: 'my-vscode',
  runtimeAssetRoot: '/home/u/.config/ai-primitives-hub/runtime',
  placement: {
    scope: 'user' as const,
    targetType: 'vscode' as const,
    resolvedLayout: {
      baseDir: '${HOME}/.copilot',
      kindRoutes: { 'prompts/': 'prompts/' },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    },
    baseRoot: '/home/u/.copilot',
    env: { HOME: '/home/u' }
  }
});

/**
 * Create a deployment request for skill upgrades.
 * @param files - Archive files.
 * @param version - Version string.
 * @returns DeployRequest for skill upgrade testing.
 */
export const upgradeSkillRequest = (files: Map<string, Uint8Array>, version: string): DeployRequest => ({
  files,
  bundle: { bundleId: 'skills', version },
  source: { sourceId: 'github-abc123', type: 'github', url: 'https://github.com/owner/repo' },
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
  const files = new Map<string, string | Uint8Array>();
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

/** A filesystem boundary that follows symbolic links for reads, writes and removal. */
export function symlinkPorts(): RecordingPorts & { links: Map<string, string> } {
  const ports = recordingPorts();
  const links = new Map<string, string>();
  const resolve = (input: string): string => {
    let current = posix.normalize(input);
    for (let depth = 0; depth < 20; depth++) {
      const candidate = current;
      const match = [...links].find(([linkPath]) => candidate === linkPath || candidate.startsWith(`${linkPath}/`));
      if (match === undefined) {
        return current;
      }
      const [link, target] = match;
      current = posix.join(target, current.slice(link.length));
    }
    throw new Error('symlink loop');
  };
  const original = ports.fs;
  ports.fs = {
    ...original,
    readFile: (destination) => original.readFile(resolve(destination)),
    readFileBytes: (destination) => original.readFileBytes(resolve(destination)),
    exists: (destination) => original.exists(resolve(destination)),
    writeFile: (destination, content) => original.writeFile(resolve(destination), content),
    writeFileBytes: (destination, bytes) => original.writeFileBytes(resolve(destination), bytes),
    remove: (destination, options) => original.remove(resolve(destination), options),
    lstat: async (destination) => {
      const identity = posix.join(resolve(posix.dirname(destination)), posix.basename(destination));
      if (links.has(identity)) {
        return { isDirectory: false, isFile: false, isSymbolicLink: true, size: 0, mtimeMs: 0 };
      }
      return original.lstat(resolve(destination));
    }
  };
  return Object.assign(ports, { links });
}

/**
 * Read both halves of the pair a test's ports wrote.
 * @param ports - Recording ports.
 * @returns The desired and local lockfiles.
 */
export const readPair = (ports: RecordingPorts): { desired: DesiredLockfileV3; local: LocalLockfileV3 } => {
  const desiredContent = ports.files.get(ports.lockfileStore.desiredFile);
  const localContent = ports.files.get(ports.lockfileStore.localFile);
  const desiredText = typeof desiredContent === 'string' ? desiredContent : (desiredContent ? new TextDecoder().decode(desiredContent) : 'null');
  const localText = typeof localContent === 'string' ? localContent : (localContent ? new TextDecoder().decode(localContent) : 'null');
  return {
    desired: JSON.parse(desiredText),
    local: JSON.parse(localText)
  };
};
