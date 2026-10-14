/**
 * Slice 1's end-to-end test: §11's hand-verification recipe, automated.
 *
 * Drives the REGISTERED command classes through `runCommand` against a real
 * `NodeFileSystem` and a real temp directory, so it proves reachability and
 * reader compatibility that a test faking every IO stage cannot.
 *
 * The temp directory doubles as HOME: `<workspace>/.copilot` is the vscode
 * user-scope base directory, and the XDG lockfile pair lives under
 * `<workspace>/xdg-config/ai-primitives-hub`.
 */
import {
  createHash,
} from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveUserConfigPaths,
} from '@ai-primitives-hub/app';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  HubConfig,
  PortableSourceDescriptor,
  TokenProvider,
} from '@ai-primitives-hub/core';
import {
  sourceKey as portableSourceKey,
  sourceContentDigest,
} from '@ai-primitives-hub/core';
import {
  ActiveHubStore,
  HubStore,
  NodeFileSystem,
} from '@ai-primitives-hub/infra';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  InstallCommand,
} from '../../src/commands/install';
import {
  StatusCommand,
} from '../../src/commands/status';
import {
  TargetAddCommand,
} from '../../src/commands/target-add';
import {
  UninstallCommand,
} from '../../src/commands/uninstall';
import {
  UpdateCommand,
} from '../../src/commands/update';
import {
  runCommand,
} from '../../src/framework';
import {
  BoundedFs,
} from '../fixtures/bounded-fs';
import {
  RecordingFs,
} from '../fixtures/recording-fs';
import {
  writeReleaseArchive,
} from '../fixtures/release-archives';
import {
  createSlice1Bundle,
} from '../fixtures/slice1-bundle';

vi.mock('inquirer', () => ({
  default: {
    prompt: (questions: unknown) => {
      const [question] = questions as { name: string }[];
      return question?.name === 'selectedBundles'
        ? { selectedBundles: ['web-dev'] }
        : { proceed: true };
    }
  }
}));

interface JsonEnvelope<T> {
  status: string;
  data: T;
  errors: { code: string; message: string }[];
  warnings: string[];
}

interface InstallData {
  collisions: { to: string; reason: string }[];
  satisfied: string[];
  written: string[];
}

interface DesiredFile {
  version: string;
  bundles: Record<string, { version: string; sourceKey?: string; sourceId?: string; resolution?: unknown }>;
  sources: Record<string, unknown>;
  unresolved?: {
    originalKey: string;
    version: string;
    sourceRef?: string;
    reason: string;
    knownResolution?: unknown;
  }[];
  generatedAt?: string;
  targets?: unknown;
}

interface LocalRecord {
  sourceKey?: string;
  resolution?: unknown;
  state?: string;
  installedAt: string;
  unmanagedReason?: string;
  legacy?: { originalKey?: string; knownResolution?: unknown };
  files: { path: string; checksum: string; installedChecksum?: string }[];
}

interface LocalFile {
  version: string;
  migration?: { lockfileV3: string };
  targets: Record<string, { bundles: Record<string, LocalRecord> }>;
}

const EXPECTED_TREE = [
  'agents/reviewer.agent.md',
  'instructions/ts-standards.instructions.md',
  'prompts/hello.prompt.md'
];

const INSTALL_ARGV = ['install', '--from', '<bundleDir>', 'web-dev', '--target', 'my-vscode'];

const parseJson = <T>(stdout: string): JsonEnvelope<T> => JSON.parse(stdout) as JsonEnvelope<T>;
const parseLastJson = <T>(stdout: string): JsonEnvelope<T> => {
  const line = stdout.split('\n').findLast((candidate) => candidate.startsWith('{"schemaVersion":'));
  if (line === undefined) {
    throw new Error(`No JSON output envelope found in:\n${stdout}`);
  }
  return parseJson<T>(line);
};

const exists = async (file: string): Promise<boolean> => {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * Recursive, sorted, baseDir-relative POSIX paths of every leaf: regular files AND symlinks
 * (listed as leaves, never followed). Callers assert equality, not containment.
 * @param root
 */
const listTree = async (root: string): Promise<string[]> => {
  if (!await exists(root)) {
    return [];
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join(path.posix.sep))
    .toSorted();
};

/**
 * Installed path → bundle-relative source path, for the slice 1 fixture. The two differ for the
 * agent (id `reviewer`, file `code-reviewer`) and the instruction (typed `instructions` under `prompts/`).
 */
const INSTALLED_FROM_BUNDLE: Record<string, string> = {
  'agents/reviewer.agent.md': 'agents/code-reviewer.agent.md',
  'instructions/ts-standards.instructions.md': 'prompts/typescript-standards.instructions.md',
  'prompts/hello.prompt.md': 'prompts/hello.prompt.md'
};

const sha256OfFixture = (bundlePath: string): string => createHash('sha256')
  .update(createSlice1Bundle().get(bundlePath) ?? new Uint8Array())
  .digest('hex');

describe('unified deploy, CLI user scope, vscode', () => {
  let workspace: string;
  let bundleDir: string;
  let env: Record<string, string>;
  let copilotDir: string;
  let desiredLockfile: string;
  let localLockfile: string;

  const runWith = (
    flag: 'on' | 'off',
    argv: string[],
    // BoundedFs: config and lockfile discovery walk upward without a boundary, so hide everything outside the workspace.
    fs: NodeFileSystem = new BoundedFs(workspace),
    providers: { http?: HttpClient; tokens?: TokenProvider } = {}
  ): ReturnType<typeof runCommand> => runCommand(
    argv.map((arg) => (arg === '<bundleDir>' ? bundleDir : arg)),
    {
      commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand, StatusCommand, UpdateCommand],
      context: {
        cwd: workspace,
        fs,
        env: { ...env, ...(flag === 'on' ? { AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' } : {}) }
      },
      ...providers
    }
  );
  const runFlagOn = (
    argv: string[],
    fs?: NodeFileSystem,
    providers?: { http?: HttpClient; tokens?: TokenProvider }
  ): ReturnType<typeof runCommand> => runWith('on', argv, fs, providers);
  const runFlagOff = (
    argv: string[],
    fs?: NodeFileSystem,
    providers?: { http?: HttpClient; tokens?: TokenProvider }
  ): ReturnType<typeof runCommand> => runWith('off', argv, fs, providers);

  const configureLiveSkillsHub = async (hubId: string): Promise<string> => {
    const skillsRoot = path.join(workspace, 'local-skills');
    const skillFile = path.join(skillsRoot, 'skills', 'web-dev', 'SKILL.md');
    await mkdir(path.dirname(skillFile), { recursive: true });
    await writeFile(skillFile, '---\nname: Web Dev\n---\n# Instructions\n', 'utf8');

    const userPaths = resolveUserConfigPaths(env);
    const hubFile = path.join(userPaths.hubs, `${hubId}.yml`);
    const hub: HubConfig = {
      version: '1.0.0',
      metadata: {
        name: 'Live local skills',
        description: 'Local live-install refusal fixture',
        maintainer: 'test',
        updatedAt: '2026-10-14T00:00:00.000Z'
      },
      sources: [{
        id: 'skills-alias',
        name: 'Skills alias',
        type: 'local-skills',
        url: './local-skills',
        enabled: true,
        priority: 0
      }],
      profiles: [{
        id: 'default',
        name: 'Default',
        bundles: [{ id: 'web-dev', version: '1.0.0', source: 'skills-alias', required: true }]
      }]
    };
    const nodeFs = new NodeFileSystem();
    await new HubStore(userPaths.hubs, nodeFs).save(hubId, hub, { type: 'local', location: hubFile });
    await new ActiveHubStore(userPaths.activeHub, nodeFs).set(hubId);
    return skillFile;
  };

  const readDesired = async (): Promise<DesiredFile> => JSON.parse(await readFile(desiredLockfile, 'utf8')) as DesiredFile;
  const readLocal = async (): Promise<LocalFile> => JSON.parse(await readFile(localLockfile, 'utf8')) as LocalFile;
  const seedV2Lockfile = async (): Promise<void> => {
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, `${JSON.stringify({
      $schema: 'https://example.com/lockfile.schema.json',
      version: '2.0.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      bundles: {
        legacy: {
          version: '0.9.0',
          sourceId: 'local-old',
          sourceType: 'local',
          installedAt: '2026-01-01T00:00:00.000Z',
          files: [{ path: 'prompts/old.prompt.md', checksum: 'archivehash' }]
        }
      },
      sources: { 'local-old': { type: 'local', url: path.join(workspace, 'old') } }
    }, null, 2)}\n`, 'utf8');
  };

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(await realpath(os.tmpdir()), 'cli-unified-e2e-'));
    bundleDir = path.join(workspace, 'bundle');
    env = {
      HOME: workspace,
      USERPROFILE: workspace,
      XDG_CONFIG_HOME: path.join(workspace, 'xdg-config'),
      XDG_CACHE_HOME: path.join(workspace, 'xdg-cache')
    };
    const xdgRoot = path.join(workspace, 'xdg-config', 'ai-primitives-hub');
    desiredLockfile = path.join(xdgRoot, 'ai-primitives-hub.lock.json');
    localLockfile = path.join(xdgRoot, 'ai-primitives-hub.local.lock.json');
    copilotDir = path.join(workspace, '.copilot');
    await mkdir(bundleDir, { recursive: true });
    await writeReleaseArchive(bundleDir, createSlice1Bundle());
    expect((await runFlagOn(['target', 'add', 'my-vscode', '--type', 'vscode', '-o', 'json'])).exitCode).toBe(0);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('installs real files named from the normalized id, by manifest kind', async () => {
    const result = await runFlagOn(INSTALL_ARGV);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    await expect(readFile(path.join(copilotDir, 'agents', 'reviewer.agent.md'), 'utf8')).resolves.toBe('# Reviewer\n');
    await expect(readFile(path.join(copilotDir, 'instructions', 'ts-standards.instructions.md'), 'utf8'))
      .resolves.toBe('# TS Standards\n');
  });

  it('writes regular files, not links', async () => {
    await runFlagOn(INSTALL_ARGV);

    for (const relative of EXPECTED_TREE) {
      const info = await lstat(path.join(copilotDir, ...relative.split(path.posix.sep)));
      expect(info.isSymbolicLink(), relative).toBe(false);
      expect(info.isFile(), relative).toBe(true);
    }
  });

  it('keeps README.md out of the target, because it is not a manifest placement item', async () => {
    await runFlagOn(INSTALL_ARGV);

    expect(await exists(path.join(copilotDir, 'README.md'))).toBe(false);
    expect(await exists(path.join(workspace, 'README.md'))).toBe(false);
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
  });

  it('records one desired entry and one materialization record', async () => {
    await runFlagOn(INSTALL_ARGV);

    const desired = await readDesired();
    const [key] = Object.keys(desired.bundles);
    if (key === undefined) {
      throw new Error('The deployment did not record its desired bundle.');
    }
    expect(key).toMatch(/^src-[a-f0-9]{64}\/web-dev$/);
    const sourceKey = key.slice(0, key.indexOf('/'));
    const resolution = {
      kind: 'pinned',
      provider: 'local-snapshot',
      version: '1.0.0',
      bundleSelector: 'bundle',
      sourceContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    };
    // The desired half is shareable: exactly these fields, so no `generatedAt`, `generatedBy`,
    // `targets`, `installedAt`, `baseDir`, `files` or checksums can appear at any depth.
    expect(desired).toEqual({
      $schema: expect.stringContaining('lockfile-v3.schema.json'),
      version: '3.0.0',
      bundles: { [key]: { version: '1.0.0', sourceKey, resolution } },
      sources: {
        [sourceKey]: {
          type: 'local',
          identity: { kind: 'workspace-local', root: '.' },
          locator: '.'
        }
      }
    });
    // The local half is machine state: the same key, with every file's two checksums computed from the fixture.
    const expectedFiles = EXPECTED_TREE.map((installed) => {
      const checksum = sha256OfFixture(INSTALLED_FROM_BUNDLE[installed]);
      return { path: installed, checksum, installedChecksum: checksum };
    });
    const local = await readLocal();
    expect(Object.keys(local).toSorted()).toEqual(['generatedAt', 'generatedBy', 'targets', 'version']);
    expect(local.version).toBe('3.0.0');
    expect(local.targets).toEqual({
      'my-vscode': {
        targetType: 'vscode',
        scope: 'user',
        baseDir: copilotDir,
        bundles: {
          [key]: {
            version: '1.0.0',
            sourceKey,
            resolution: desired.bundles[key].resolution,
            installedAt: expect.any(String),
            files: expect.any(Array)
          }
        }
      }
    });
    const recordedFiles = local.targets['my-vscode'].bundles[key].files;
    expect(recordedFiles.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual(expectedFiles);
  });

  it('keeps the registered install/replay/uninstall lifecycle on one portable key and pin', async () => {
    const installed = await runFlagOn(INSTALL_ARGV);
    expect(installed.exitCode, `stdout:\n${installed.stdout}\nstderr:\n${installed.stderr}`).toBe(0);

    const initialDesired = await readDesired();
    const [key] = Object.keys(initialDesired.bundles);
    if (key === undefined) {
      throw new Error('The registered install did not record desired state.');
    }
    const initialRecord = (await readLocal()).targets['my-vscode'].bundles[key];
    const initialFiles = initialRecord.files;
    const desiredBytes = await readFile(desiredLockfile, 'utf8');
    await rm(copilotDir, { recursive: true, force: true });

    const replayed = await runFlagOn([
      'install', '--lockfile', desiredLockfile, '--target', 'my-vscode', '-o', 'json'
    ]);

    expect(replayed.exitCode, `stdout:\n${replayed.stdout}\nstderr:\n${replayed.stderr}`).toBe(0);
    expect(parseJson<{ replayed: string[]; failures: unknown[] }>(replayed.stdout).data).toMatchObject({
      replayed: [key],
      failures: []
    });
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    expect(await readFile(desiredLockfile, 'utf8')).toBe(desiredBytes);
    const replayedDesired = await readDesired();
    const replayedRecord = (await readLocal()).targets['my-vscode'].bundles[key];
    expect(replayedDesired.bundles[key]).toEqual(initialDesired.bundles[key]);
    expect(replayedRecord.sourceKey).toBe(initialRecord.sourceKey);
    expect(replayedRecord.resolution).toEqual(initialRecord.resolution);
    expect(replayedRecord.files).toEqual(initialFiles);

    const removed = await runFlagOn(['uninstall', '--bundle', key, '--target', 'my-vscode']);

    expect(removed.exitCode, `stdout:\n${removed.stdout}\nstderr:\n${removed.stderr}`).toBe(0);
    expect(await listTree(copilotDir)).toEqual([]);
    expect((await readDesired()).bundles).toEqual({});
    expect((await readLocal()).targets).toEqual({});
  });

  it('keeps logical keys and exact local pins stable when the registry source alias changes', async () => {
    const hubId = 'portable-source-aliases';
    const userPaths = resolveUserConfigPaths(env);
    const hubFile = path.join(userPaths.hubs, `${hubId}.yml`);
    const hubStore = new HubStore(userPaths.hubs, new NodeFileSystem());
    const activeHubStore = new ActiveHubStore(userPaths.activeHub, new NodeFileSystem());
    const registryBundle = path.join(workspace, 'registry', 'web-dev');
    await mkdir(registryBundle, { recursive: true });
    await writeReleaseArchive(registryBundle, createSlice1Bundle());
    const localHub = (sourceAlias: string): HubConfig => ({
      version: '1.0.0',
      metadata: {
        name: 'Portable source aliases',
        description: 'Alias-independence fixture',
        maintainer: 'test',
        updatedAt: '2026-10-14T00:00:00.000Z'
      },
      sources: [{
        id: sourceAlias,
        name: `Friendly ${sourceAlias}`,
        type: 'local',
        url: './registry',
        enabled: true,
        priority: 0
      }],
      profiles: [{
        id: 'default',
        name: 'Default',
        bundles: [{ id: 'web-dev', version: '1.0.0', source: sourceAlias, required: true }]
      }]
    });
    const reference = { type: 'local' as const, location: hubFile };
    await hubStore.save(hubId, localHub('registry-a'), reference);
    await activeHubStore.set(hubId);

    const first = await runFlagOn([
      'install', '--source', hubId, '--interactive', '--target', 'my-vscode', '-o', 'json'
    ]);
    expect(first.exitCode, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`).toBe(0);
    const firstDesiredBytes = await readFile(desiredLockfile, 'utf8');
    const firstDesired = await readDesired();
    const [key] = Object.keys(firstDesired.bundles);
    if (key === undefined) {
      throw new Error('The first source alias did not record desired state.');
    }
    const firstRecord = (await readLocal()).targets['my-vscode'].bundles[key];

    await hubStore.save(hubId, localHub('registry-b'), reference);
    const second = await runFlagOn([
      'install', '--source', hubId, '--interactive', '--target', 'my-vscode', '-o', 'json'
    ]);

    expect(second.exitCode, `stdout:\n${second.stdout}\nstderr:\n${second.stderr}`).toBe(0);
    const secondDesired = await readDesired();
    const secondRecord = (await readLocal()).targets['my-vscode'].bundles[key];
    const sourceId = key.slice(0, key.indexOf('/'));
    expect(Object.keys(secondDesired.bundles)).toEqual([key]);
    expect(secondDesired.bundles[key]).toEqual(firstDesired.bundles[key]);
    expect(secondDesired.sources[sourceId]).toEqual({
      type: 'local',
      identity: { kind: 'workspace-local', root: 'registry' },
      locator: 'registry'
    });
    expect(secondRecord.sourceKey).toBe(sourceId);
    expect(secondRecord.resolution).toEqual(firstRecord.resolution);
    expect(secondRecord.files).toEqual(firstRecord.files);
    expect(secondDesired.bundles[key]).not.toHaveProperty('sourceId');
    expect(secondRecord).not.toHaveProperty('sourceId');
    expect(JSON.stringify(secondDesired)).not.toContain(workspace);
    expect(JSON.stringify(secondDesired)).not.toContain('registry-a');
    expect(JSON.stringify(secondDesired)).not.toContain('registry-b');
    expect(await readFile(desiredLockfile, 'utf8')).toBe(firstDesiredBytes);
    expect(portableSourceKey(
      { kind: 'workspace-local', root: 'registry' },
      'local'
    )).toBe(sourceId);
  });

  it('produces identical portable desired state across independent clone roots and replays local bytes', async () => {
    const secondWorkspace = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), 'cli-unified-clone-')));
    const aliases = ['clone-registry-a', 'clone-registry-b'];
    const roots = [workspace, secondWorkspace];
    const rootEnvs = roots.map((root) => ({
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      XDG_CACHE_HOME: path.join(root, 'xdg-cache')
    }));
    const denyHttpCalls: string[] = [];
    const denyHttp: HttpClient = {
      fetch: (request: HttpRequest): Promise<HttpResponse> => {
        denyHttpCalls.push(request.url);
        return Promise.reject(new Error(`Unexpected provider lookup: ${request.url}`));
      }
    };
    try {
      const pairs: {
        desiredBytes: string;
        desired: DesiredFile;
        local: LocalFile;
        paths: ReturnType<typeof resolveUserConfigPaths>;
        copilot: string;
        root: string;
      }[] = [];

      for (const [index, root] of roots.entries()) {
        const rootEnv = rootEnvs[index];
        const alias = aliases[index];
        if (rootEnv === undefined || alias === undefined) {
          throw new Error('The clone-root fixture is incomplete.');
        }
        const registryRoot = path.join(root, 'registry');
        await mkdir(registryRoot, { recursive: true });
        await writeReleaseArchive(path.join(registryRoot, 'web-dev'), createSlice1Bundle());
        const paths = resolveUserConfigPaths(rootEnv);
        const hubId = 'portable-clone';
        const hubFile = path.join(paths.hubs, `${hubId}.yml`);
        const hub: HubConfig = {
          version: '1.0.0',
          metadata: {
            name: 'Portable clone source',
            description: 'Independent workspace root fixture',
            maintainer: 'test',
            updatedAt: '2026-10-14T00:00:00.000Z'
          },
          sources: [{
            id: alias,
            name: `Friendly ${alias}`,
            type: 'local',
            url: './registry',
            enabled: true,
            priority: 0
          }],
          profiles: [{
            id: 'default',
            name: 'Default',
            bundles: [{ id: 'web-dev', version: '1.0.0', source: alias, required: true }]
          }]
        };
        const nodeFs = new NodeFileSystem();
        await new HubStore(paths.hubs, nodeFs).save(hubId, hub, { type: 'local', location: hubFile });
        await new ActiveHubStore(paths.activeHub, nodeFs).set(hubId);

        if (root !== workspace) {
          const targetAdded = await runCommand(
            ['target', 'add', 'my-vscode', '--type', 'vscode', '-o', 'json'],
            {
              commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand, StatusCommand, UpdateCommand],
              context: { cwd: root, fs: new BoundedFs(root), env: { ...rootEnv, AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' } },
              http: denyHttp,
              tokens: { getToken: () => Promise.resolve(undefined) }
            }
          );
          expect(targetAdded.exitCode, targetAdded.stdout).toBe(0);
        }

        const installed = root === workspace
          ? await runFlagOn([
            'install', '--source', hubId, '--interactive', '--target', 'my-vscode', '-o', 'json'
          ], undefined, { http: denyHttp, tokens: { getToken: () => Promise.resolve(undefined) } })
          : await runCommand(
            ['install', '--source', hubId, '--interactive', '--target', 'my-vscode', '-o', 'json'],
            {
              commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand, StatusCommand, UpdateCommand],
              context: { cwd: root, fs: new BoundedFs(root), env: { ...rootEnv, AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' } },
              http: denyHttp,
              tokens: { getToken: () => Promise.resolve(undefined) }
            }
          );
        expect(installed.exitCode, `stdout:\n${installed.stdout}\nstderr:\n${installed.stderr}`).toBe(0);
        const desiredBytes = await readFile(paths.userLockfile, 'utf8');
        const localBytes = await readFile(paths.userLocalLockfile, 'utf8');
        const copilot = path.join(root, '.copilot');
        pairs.push({
          desiredBytes,
          desired: JSON.parse(desiredBytes) as DesiredFile,
          local: JSON.parse(localBytes) as LocalFile,
          paths,
          copilot,
          root
        });
      }

      const first = pairs[0];
      const second = pairs[1];
      const secondEnv = rootEnvs[1];
      if (first === undefined || second === undefined || secondEnv === undefined) {
        throw new Error('Both workspace clones must be installed.');
      }
      expect(first.root).not.toBe(second.root);
      expect(await realpath(path.join(first.root, 'registry'))).not.toBe(await realpath(path.join(second.root, 'registry')));
      expect(first.desiredBytes).toBe(second.desiredBytes);

      const firstKeys = Object.keys(first.desired.bundles);
      const secondKeys = Object.keys(second.desired.bundles);
      expect(firstKeys).toHaveLength(1);
      expect(secondKeys).toEqual(firstKeys);
      const key = firstKeys[0];
      if (key === undefined) {
        throw new Error('The clone did not record a portable bundle key.');
      }
      const sourceId = key.slice(0, key.indexOf('/'));
      expect(key).toMatch(/^src-[a-f0-9]{64}\/web-dev$/);
      expect(first.desired.sources[sourceId]).toEqual({
        type: 'local',
        identity: { kind: 'workspace-local', root: 'registry' },
        locator: 'registry'
      });
      expect(first.desiredBytes).not.toContain(first.root);
      expect(first.desiredBytes).not.toContain(second.root);
      expect(first.desiredBytes).not.toContain(aliases[0]);
      expect(first.desiredBytes).not.toContain(aliases[1]);

      const firstRecord = first.local.targets['my-vscode'].bundles[key];
      const secondRecord = second.local.targets['my-vscode'].bundles[key];
      expect(firstRecord.sourceKey).toBe(sourceId);
      expect(secondRecord.sourceKey).toBe(sourceId);
      expect(secondRecord.resolution).toEqual(firstRecord.resolution);
      expect(secondRecord.files).toEqual(firstRecord.files);
      expect((firstRecord.resolution as { sourceContentSha256: string }).sourceContentSha256)
        .toMatch(/^[a-f0-9]{64}$/);

      await rm(second.copilot, { recursive: true, force: true });
      const replay = await runCommand(
        ['install', '--lockfile', second.paths.userLockfile, '--target', 'my-vscode', '-o', 'json'],
        {
          commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand, StatusCommand, UpdateCommand],
          context: {
            cwd: second.root,
            fs: new BoundedFs(second.root),
            env: { ...secondEnv, AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' }
          },
          http: denyHttp,
          tokens: { getToken: () => Promise.resolve(undefined) }
        }
      );
      expect(replay.exitCode, `stdout:\n${replay.stdout}\nstderr:\n${replay.stderr}`).toBe(0);
      expect(parseJson<{ replayed: string[]; failures: unknown[] }>(replay.stdout).data).toMatchObject({
        replayed: [key],
        failures: []
      });
      expect(await listTree(second.copilot)).toEqual(EXPECTED_TREE);
      await expect(readFile(path.join(second.copilot, 'prompts', 'hello.prompt.md'), 'utf8')).resolves.toBe('# Hello\n');
      expect(await readFile(second.paths.userLockfile, 'utf8')).toBe(second.desiredBytes);
      expect(denyHttpCalls).toEqual([]);
    } finally {
      await rm(secondWorkspace, { recursive: true, force: true });
    }
  });

  it('resumes a branch-era v3 local-first migration offline without duplicating legacy ownership', async () => {
    const legacyKey = 'computer-specific/acme.reviewer@1.0.0';
    const oldBaseDir = path.join(workspace, '.cursor');
    const oldFile = path.join(oldBaseDir, 'agents', 'reviewer.md');
    const knownDigest = 'b'.repeat(64);
    const installedDigest = 'c'.repeat(64);
    await mkdir(path.dirname(oldFile), { recursive: true });
    await writeFile(oldFile, '# Existing reviewer\n', 'utf8');
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, `${JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-12T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      bundles: {
        [legacyKey]: {
          version: '1.0.0',
          sourceId: 'computer-specific',
          archiveSha: 'a'.repeat(64)
        }
      },
      sources: {
        'computer-specific': {
          type: 'github',
          url: 'https://github.com/acme/agents',
          branch: 'main'
        }
      },
      hubs: { shared: { name: 'Shared', url: 'https://example.com/hub.yml' } },
      profiles: { defaults: { name: 'Defaults', bundleIds: [legacyKey] } }
    }, null, 2)}\n`, 'utf8');
    await writeFile(localLockfile, `${JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-12T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        'cursor-user': {
          targetType: 'cursor',
          scope: 'user',
          baseDir: oldBaseDir,
          bundles: {
            [legacyKey]: {
              version: '1.0.0',
              sourceId: 'computer-specific',
              installedAt: '2026-10-12T00:00:00.000Z',
              commitMode: 'local-only',
              files: [{
                path: 'agents/reviewer.md',
                checksum: knownDigest,
                installedChecksum: installedDigest
              }],
              mcpConfigPath: '.copilot/mcp-config.json',
              mcpServers: ['reviewer-mcp']
            }
          }
        }
      }
    }, null, 2)}\n`, 'utf8');

    const providerCalls: string[] = [];
    const denyHttp: HttpClient = {
      fetch: (request: HttpRequest): Promise<HttpResponse> => {
        providerCalls.push(request.url);
        return Promise.reject(new Error(`Unexpected provider lookup: ${request.url}`));
      }
    };
    const interruptionFs = new class extends RecordingFs {
      private interrupted = false;

      public override async rename(from: string, to: string): Promise<void> {
        await super.rename(from, to);
        if (!this.interrupted && to === localLockfile) {
          this.interrupted = true;
          throw new Error('simulated interruption after local-first write');
        }
      }
    }(workspace);
    const tokens: TokenProvider = { getToken: () => Promise.resolve(undefined) };
    const first = await runFlagOn([...INSTALL_ARGV, '-o', 'json'], interruptionFs, { http: denyHttp, tokens });

    expect(first.exitCode).not.toBe(0);
    expect(first.stdout + first.stderr).toContain('simulated interruption after local-first write');
    expect((await readLocal()).migration).toBeUndefined();
    expect(Object.keys((await readDesired()).bundles)).toEqual([legacyKey]);
    expect(await readFile(oldFile, 'utf8')).toBe('# Existing reviewer\n');

    const resumed = await runFlagOn([...INSTALL_ARGV, '-o', 'json'], new RecordingFs(workspace), { http: denyHttp, tokens });

    expect(resumed.exitCode, `stdout:\n${resumed.stdout}\nstderr:\n${resumed.stderr}`).toBe(0);
    expect(providerCalls).toEqual([]);
    expect(await exists(env.XDG_CACHE_HOME)).toBe(false);
    expect(await readFile(oldFile, 'utf8')).toBe('# Existing reviewer\n');
    const desired = await readDesired();
    expect(desired.unresolved).toEqual([
      expect.objectContaining({ originalKey: legacyKey, sourceRef: 'computer-specific', version: '1.0.0' })
    ]);
    expect(Object.keys(desired.bundles)).toHaveLength(1);
    const local = await readLocal();
    expect(local.migration).toEqual({ lockfileV3: 'complete' });
    const oldRecords = Object.values(local.targets['cursor-user'].bundles)
      .filter((record) => record.state === 'unmanaged');
    expect(oldRecords).toHaveLength(1);
    expect(oldRecords[0]).toMatchObject({
      files: [{ path: 'agents/reviewer.md', checksum: knownDigest, installedChecksum: installedDigest }]
    });
    expect(local.targets['my-vscode'].bundles).toHaveProperty(Object.keys(desired.bundles)[0]);
  });

  it('retains conflicting branch-era aliases, pins, and file baselines as separate reported records', async () => {
    const firstLegacyKey = 'computer-a/acme.reviewer@1.0.0';
    const secondLegacyKey = 'computer-b/acme.reviewer@1.0.0';
    const oldBaseDir = path.join(workspace, '.cursor');
    const oldFile = path.join(oldBaseDir, 'agents', 'reviewer.md');
    const firstPin = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '100',
      assetId: '200',
      archiveSha256: 'a'.repeat(64)
    };
    const secondPin = {
      ...firstPin,
      releaseId: '300',
      assetId: '400',
      archiveSha256: 'd'.repeat(64)
    };
    await mkdir(path.dirname(oldFile), { recursive: true });
    await writeFile(oldFile, '# Conflicting existing reviewer\n', 'utf8');
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, `${JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-12T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      bundles: {
        [firstLegacyKey]: {
          version: '1.0.0',
          sourceId: 'computer-a',
          resolution: firstPin,
          archiveSha: firstPin.archiveSha256
        },
        [secondLegacyKey]: {
          version: '1.0.0',
          sourceId: 'computer-b',
          resolution: secondPin,
          archiveSha: secondPin.archiveSha256
        }
      },
      sources: {
        'computer-a': { type: 'github', url: 'https://github.com/acme/agents', branch: 'main' },
        'computer-b': { type: 'github', url: 'https://github.com/acme/agents', branch: 'main' }
      }
    }, null, 2)}\n`, 'utf8');
    await writeFile(localLockfile, `${JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-12T00:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        'cursor-user': {
          targetType: 'cursor',
          scope: 'user',
          baseDir: oldBaseDir,
          bundles: {
            [firstLegacyKey]: {
              version: '1.0.0',
              sourceId: 'computer-a',
              resolution: firstPin,
              installedAt: '2026-10-12T00:00:00.000Z',
              files: [{ path: 'agents/reviewer.md', checksum: 'b'.repeat(64), installedChecksum: 'c'.repeat(64) }]
            },
            [secondLegacyKey]: {
              version: '1.0.0',
              sourceId: 'computer-b',
              resolution: secondPin,
              installedAt: '2026-10-12T00:00:00.000Z',
              files: [{ path: 'agents/reviewer.md', checksum: 'e'.repeat(64), installedChecksum: 'f'.repeat(64) }]
            }
          }
        }
      }
    }, null, 2)}\n`, 'utf8');

    const providerCalls: string[] = [];
    const result = await runFlagOn(
      [...INSTALL_ARGV, '-o', 'json'],
      new RecordingFs(workspace),
      {
        http: {
          fetch: (request: HttpRequest): Promise<HttpResponse> => {
            providerCalls.push(request.url);
            return Promise.reject(new Error(`Unexpected provider lookup: ${request.url}`));
          }
        },
        tokens: { getToken: () => Promise.resolve(undefined) }
      }
    );

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(providerCalls).toEqual([]);
    const desired = await readDesired();
    expect(desired.unresolved?.map(({ originalKey }) => originalKey).toSorted())
      .toEqual([firstLegacyKey, secondLegacyKey].toSorted());
    expect(desired.unresolved?.find(({ originalKey }) => originalKey === firstLegacyKey)?.knownResolution).toEqual(firstPin);
    expect(desired.unresolved?.find(({ originalKey }) => originalKey === secondLegacyKey)?.knownResolution).toEqual(secondPin);
    expect(desired.sources).not.toHaveProperty('computer-a');
    expect(desired.sources).not.toHaveProperty('computer-b');

    const local = await readLocal();
    const oldRecords = Object.values(local.targets['cursor-user'].bundles)
      .filter((record) => record.state === 'unmanaged');
    expect(oldRecords).toHaveLength(2);
    expect(oldRecords.map((record) => record.files[0]?.checksum).toSorted())
      .toEqual(['b'.repeat(64), 'e'.repeat(64)].toSorted());
    expect(oldRecords.map((record) => record.files[0]?.installedChecksum).toSorted())
      .toEqual(['c'.repeat(64), 'f'.repeat(64)].toSorted());
    expect(oldRecords.map((record) => record.legacy?.knownResolution).toSorted((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    )).toEqual([firstPin, secondPin].toSorted((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ));
    const migration = parseJson<{ migration: { unmanaged: { key: string; reason: string }[] } }>(result.stdout).data.migration;
    expect(migration.unmanaged).toHaveLength(2);
    expect(migration.unmanaged.every(({ reason }) => reason.length > 0)).toBe(true);
    expect(await readFile(oldFile, 'utf8')).toBe('# Conflicting existing reviewer\n');
  });

  it('replays a moved tree branch from the recorded commit, not an incompatible configured ref', async () => {
    const hubId = 'tree-pinned-source';
    const userPaths = resolveUserConfigPaths(env);
    const hubFile = path.join(userPaths.hubs, `${hubId}.yml`);
    const sourceAlias = 'tree-source';
    const collectionPath = 'collections/web-dev.collection.yml';
    const manifestAtA = new TextEncoder().encode([
      'id: web-dev',
      'name: Web Dev',
      'description: Pinned tree collection.',
      'version: 1.0.0',
      'items:',
      '  - path: prompts/hello.prompt.md',
      '    kind: prompt'
    ].join('\n'));
    const manifestAtB = new TextEncoder().encode([
      'id: web-dev',
      'name: Web Dev',
      'description: Moved tree branch collection.',
      'version: 1.0.0',
      'items:',
      '  - path: prompts/hello.prompt.md',
      '    kind: prompt'
    ].join('\n'));
    const fileAtA = new TextEncoder().encode('# Pinned main commit\n');
    const fileAtB = new TextEncoder().encode('# Moved main branch\n');
    const commitA = 'a'.repeat(40);
    const commitB = 'b'.repeat(40);
    const commitMaster = 'c'.repeat(40);
    let branchHead = commitA;
    const httpCalls: string[] = [];
    const responses = new Map<string, HttpResponse>();
    const response = (url: string, body: Uint8Array): HttpResponse => ({
      statusCode: 200,
      body,
      finalUrl: url,
      headers: {}
    });
    const putJson = (url: string, value: unknown): void => {
      responses.set(url, response(url, new TextEncoder().encode(JSON.stringify(value))));
    };
    const repoUrl = 'https://api.github.com/repos/owner/repo';
    putJson(repoUrl, {
      id: 123,
      full_name: 'owner/repo',
      html_url: 'https://github.com/owner/repo',
      default_branch: 'main'
    });
    putJson(`${repoUrl}/commits/${commitA}`, { sha: commitA });
    putJson(`${repoUrl}/commits/${commitB}`, { sha: commitB });
    putJson(`${repoUrl}/commits/${commitMaster}`, { sha: commitMaster });
    putJson(`${repoUrl}/git/trees/${commitA}?recursive=1`, {
      tree: [
        { path: collectionPath, type: 'blob', sha: 'collection-a' },
        { path: 'prompts/hello.prompt.md', type: 'blob', sha: 'prompt-a' }
      ]
    });
    putJson(`${repoUrl}/git/trees/${commitB}?recursive=1`, {
      tree: [
        { path: collectionPath, type: 'blob', sha: 'collection-b' },
        { path: 'prompts/hello.prompt.md', type: 'blob', sha: 'prompt-b' }
      ]
    });
    putJson(`${repoUrl}/git/trees/${commitMaster}?recursive=1`, {
      tree: [
        { path: collectionPath, type: 'blob', sha: 'collection-master' },
        { path: 'prompts/hello.prompt.md', type: 'blob', sha: 'prompt-master' }
      ]
    });
    for (const [commit, manifest, content] of [
      [commitA, manifestAtA, fileAtA],
      [commitB, manifestAtB, fileAtB],
      [commitMaster, manifestAtB, fileAtB]
    ] as const) {
      responses.set(
        `https://raw.githubusercontent.com/owner/repo/${commit}/${collectionPath}`,
        response(`https://raw.githubusercontent.com/owner/repo/${commit}/${collectionPath}`, manifest)
      );
      responses.set(
        `https://raw.githubusercontent.com/owner/repo/${commit}/prompts/hello.prompt.md`,
        response(`https://raw.githubusercontent.com/owner/repo/${commit}/prompts/hello.prompt.md`, content)
      );
    }
    const http: HttpClient = {
      fetch: (request: HttpRequest): Promise<HttpResponse> => {
        httpCalls.push(request.url);
        if (request.url === `${repoUrl}/commits/main`) {
          return Promise.resolve(response(request.url, new TextEncoder().encode(JSON.stringify({ sha: branchHead }))));
        }
        const found = responses.get(request.url);
        return found === undefined
          ? Promise.reject(new Error(`Unexpected provider request: ${request.url}`))
          : Promise.resolve(found);
      }
    };
    const hubConfig = (branch: string): HubConfig => ({
      version: '1.0.0',
      metadata: {
        name: 'Pinned tree source',
        description: 'Tree branch pin fixture',
        maintainer: 'test',
        updatedAt: '2026-10-14T00:00:00.000Z'
      },
      sources: [{
        id: sourceAlias,
        name: 'Tree branch source',
        type: 'awesome-copilot',
        url: 'https://github.com/owner/repo',
        enabled: true,
        priority: 0,
        config: { branch, collectionsPath: 'collections' }
      }],
      profiles: [{
        id: 'default',
        name: 'Default',
        bundles: [{ id: 'web-dev', version: '1.0.0', source: sourceAlias, required: true }]
      }]
    });
    const store = new HubStore(userPaths.hubs, new NodeFileSystem());
    const reference = { type: 'local' as const, location: hubFile };
    await store.save(hubId, hubConfig('main'), reference);
    await new ActiveHubStore(userPaths.activeHub, new NodeFileSystem()).set(hubId);
    const tokens: TokenProvider = { getToken: () => Promise.resolve(undefined) };

    const installed = await runFlagOn(
      ['install', '--source', hubId, '--interactive', '--target', 'my-vscode', '-o', 'json'],
      undefined,
      { http, tokens }
    );
    expect(installed.exitCode, `stdout:\n${installed.stdout}\nstderr:\n${installed.stderr}`).toBe(0);
    const desiredBytes = await readFile(desiredLockfile, 'utf8');
    const desired = await readDesired();
    const [key] = Object.keys(desired.bundles);
    if (key === undefined) {
      throw new Error('The initial tree install did not record a desired bundle.');
    }
    const sourceId = key.slice(0, key.indexOf('/'));
    const pin = desired.bundles[key].resolution as { kind: string; provider?: string; commitSha?: string };
    expect(pin).toMatchObject({ kind: 'pinned', provider: 'github-tree', commitSha: commitA });
    expect((desired.sources[sourceId] as { identity: { ref?: string } }).identity.ref).toBe('main');
    expect(await readFile(path.join(copilotDir, 'prompts', 'hello.prompt.md'), 'utf8')).toBe('# Pinned main commit\n');

    branchHead = commitB;
    await store.save(hubId, hubConfig('master'), reference);
    await rm(copilotDir, { recursive: true, force: true });
    httpCalls.length = 0;

    const replayed = await runFlagOn([
      'install', '--lockfile', desiredLockfile, '--target', 'my-vscode', '-o', 'json'
    ], undefined, { http, tokens });

    expect(replayed.exitCode, `stdout:\n${replayed.stdout}\nstderr:\n${replayed.stderr}`).toBe(0);
    expect(parseJson<{ replayed: string[]; failures: unknown[] }>(replayed.stdout).data).toMatchObject({
      replayed: [key],
      failures: []
    });
    expect(httpCalls).toContain(`${repoUrl}/git/trees/${commitA}?recursive=1`);
    expect(httpCalls).not.toContain(`${repoUrl}/commits/main`);
    expect(httpCalls).not.toContain(`${repoUrl}/commits/master`);
    expect(httpCalls).not.toContain(`${repoUrl}/git/trees/${commitB}?recursive=1`);
    expect(await readFile(path.join(copilotDir, 'prompts', 'hello.prompt.md'), 'utf8')).toBe('# Pinned main commit\n');
    expect(await readFile(desiredLockfile, 'utf8')).toBe(desiredBytes);
    expect((await readDesired()).bundles[key].resolution).toEqual(desired.bundles[key].resolution);
    expect((await readDesired()).sources[sourceId]).toEqual(desired.sources[sourceId]);
  });

  it('replays recorded local collection selectors from an unchanged external binding', async () => {
    const sourceRoot = path.join(workspace, 'bound-collection');
    const collectionSelector = 'recorded/web-dev.collection.yml';
    const collectionBytes = new TextEncoder().encode([
      'id: web-dev',
      'name: Web Dev',
      'description: Bound local collection',
      'version: 1.0.0',
      'items:',
      '  - path: prompts/hello.prompt.md',
      '    kind: prompt'
    ].join('\n'));
    const promptBytes = new TextEncoder().encode('# Bound collection content\n');
    const promptPath = 'prompts/hello.prompt.md';
    await mkdir(path.join(sourceRoot, 'recorded'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'prompts'), { recursive: true });
    await writeFile(path.join(sourceRoot, collectionSelector), collectionBytes);
    await writeFile(path.join(sourceRoot, promptPath), promptBytes);

    const descriptor: PortableSourceDescriptor = {
      type: 'local-awesome-copilot',
      identity: { kind: 'external-local', bindingName: 'bound', collectionsPath: 'recorded' },
      locator: 'bound'
    };
    const sourceId = portableSourceKey(descriptor.identity, descriptor.type);
    const key = `${sourceId}/web-dev`;
    const resolution = {
      kind: 'pinned',
      provider: 'local-snapshot',
      version: '1.0.0',
      bundleSelector: collectionSelector,
      sourceContentSha256: sourceContentDigest(new Map([
        [collectionSelector, collectionBytes],
        [promptPath, promptBytes]
      ]))
    };
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, JSON.stringify({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {
        [key]: {
          version: '1.0.0',
          sourceKey: sourceId,
          resolution
        }
      },
      sources: { [sourceId]: descriptor }
    }, null, 2));

    const userPaths = resolveUserConfigPaths(env);
    const hubId = 'bound-local-hub';
    const hubFile = path.join(userPaths.hubs, `${hubId}.yml`);
    const hub: HubConfig = {
      version: '1.0.0',
      metadata: {
        name: 'Bound local source',
        description: 'Replay source binding fixture',
        maintainer: 'test',
        updatedAt: '2026-10-14T00:00:00.000Z'
      },
      sources: [{
        id: 'bound',
        name: 'Bound collection',
        type: 'local-awesome-copilot',
        url: sourceRoot,
        enabled: true,
        priority: 0,
        config: { collectionsPath: 'changed' }
      }],
      profiles: [{
        id: 'default',
        name: 'Default',
        bundles: []
      }]
    };
    const nodeFs = new NodeFileSystem();
    await new HubStore(userPaths.hubs, nodeFs).save(hubId, hub, { type: 'local', location: hubFile });
    await new ActiveHubStore(userPaths.activeHub, nodeFs).set(hubId);
    const recordingFs = new RecordingFs(workspace);

    const result = await runFlagOn([
      'install', '--lockfile', desiredLockfile, '--target', 'my-vscode', '-o', 'json'
    ], recordingFs);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    const { data } = parseJson<{ replayed: string[]; failures: { key: string }[] }>(result.stdout);
    expect(data.replayed).toEqual([key]);
    expect(data.failures).toEqual([]);
    expect(await readFile(path.join(copilotDir, 'prompts', 'hello.prompt.md'), 'utf8'))
      .toBe('# Bound collection content\n');
    expect(JSON.parse(await readFile(desiredLockfile, 'utf8')).sources[sourceId]).toEqual(descriptor);
  });

  it('keeps a missing external binding as an actionable replay failure without writes', async () => {
    const descriptor: PortableSourceDescriptor = {
      type: 'local',
      identity: { kind: 'external-local', bindingName: 'missing-registry' },
      locator: 'missing-registry'
    };
    const sourceId = portableSourceKey(descriptor.identity, descriptor.type);
    const key = `${sourceId}/web-dev`;
    const rawDesired = `${JSON.stringify({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {
        [key]: {
          version: '1.0.0',
          sourceKey: sourceId,
          resolution: {
            kind: 'pinned',
            provider: 'local-snapshot',
            version: '1.0.0',
            bundleSelector: 'web-dev',
            sourceContentSha256: 'a'.repeat(64)
          }
        }
      },
      sources: { [sourceId]: descriptor }
    }, null, 2)}\n`;
    await mkdir(path.dirname(desiredLockfile), { recursive: true });
    await writeFile(desiredLockfile, rawDesired, 'utf8');
    const recordingFs = new RecordingFs(workspace);

    const result = await runFlagOn([
      'install', '--lockfile', desiredLockfile, '--target', 'my-vscode', '-o', 'json'
    ], recordingFs);

    expect(result.exitCode).toBe(1);
    const { data } = parseJson<{
      replayed: string[];
      failures: { key: string; reason: string; error?: { code: string } }[];
    }>(result.stdout);
    expect(data.replayed).toEqual([]);
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].key).toBe(key);
    expect(data.failures[0].reason).toContain('No active local source configuration provides binding "missing-registry"');
    expect(data.failures[0].error?.code).toBe('CONFIG.MISSING_LOCAL_BINDING');
    expect(await readFile(desiredLockfile, 'utf8')).toBe(rawDesired);
    expect(await exists(localLockfile)).toBe(false);
    expect(await listTree(copilotDir)).toEqual([]);
    expect(recordingFs.writes).toEqual([]);
  });

  it('runs a local dry-run with rejecting mutation ports and leaves both state halves untouched', async () => {
    const recordingFs = new RecordingFs(workspace);
    const writeFileSpy = vi.spyOn(recordingFs, 'writeFile').mockRejectedValue(new Error('dry-run mutation forbidden'));
    const writeFileBytesSpy = vi.spyOn(recordingFs, 'writeFileBytes').mockRejectedValue(new Error('dry-run mutation forbidden'));
    const mkdirSpy = vi.spyOn(recordingFs, 'mkdir').mockRejectedValue(new Error('dry-run mutation forbidden'));
    const renameSpy = vi.spyOn(recordingFs, 'rename').mockRejectedValue(new Error('dry-run mutation forbidden'));
    const removeSpy = vi.spyOn(recordingFs, 'remove').mockRejectedValue(new Error('dry-run mutation forbidden'));

    const result = await runFlagOn([...INSTALL_ARGV, '--dry-run', '-o', 'json'], recordingFs);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(parseJson<{ dryRun: boolean }>(result.stdout).data.dryRun).toBe(true);
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(writeFileBytesSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(await listTree(copilotDir)).toEqual([]);
    expect(await exists(desiredLockfile)).toBe(false);
    expect(await exists(localLockfile)).toBe(false);
  });

  it('uninstall removes exactly those paths and nothing else', async () => {
    await runFlagOn(INSTALL_ARGV);
    await writeFile(path.join(copilotDir, 'prompts', 'mine.prompt.md'), '# mine\n', 'utf8');

    const result = await runFlagOn(['uninstall', '--bundle', 'web-dev', '--target', 'my-vscode']);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(await listTree(copilotDir)).toEqual(['prompts/mine.prompt.md']);
    expect((await readDesired()).bundles).toEqual({});
    // An emptied target is pruned from the local half.
    expect((await readLocal()).targets).toEqual({});
  });

  it('migrates an existing v2 XDG lockfile into the pair on that first write', async () => {
    await seedV2Lockfile();

    const result = await runFlagOn([...INSTALL_ARGV, '-o', 'json']);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    const { migration } = parseJson<{ migration: { migrated: string[]; unmanaged: { key: string; reason: string }[] } }>(result.stdout).data;
    const desired = await readDesired();
    const local = await readLocal();
    expect(desired.version).toBe('3.0.0');
    expect(desired.unresolved).toContainEqual(expect.objectContaining({
      originalKey: 'legacy',
      sourceRef: 'local-old',
      version: '0.9.0'
    }));
    expect(migration.unmanaged).toHaveLength(1);
    const unmanaged = migration.unmanaged[0];
    if (unmanaged === undefined) {
      throw new Error('The legacy intent was not retained as an unmanaged record.');
    }
    expect(unmanaged.key).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    expect(local.targets.unmanaged.bundles[unmanaged.key].state).toBe('unmanaged');
    expect(local.migration).toEqual({ lockfileV3: 'complete' });
    expect(migration.unmanaged).toEqual([
      { key: unmanaged.key, reason: local.targets.unmanaged.bundles[unmanaged.key].unmanagedReason }
    ]);
    expect(migration.unmanaged[0].reason).not.toBe('');
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
  });

  it('shows the migration reason in text output', async () => {
    await seedV2Lockfile();

    const result = await runFlagOn(INSTALL_ARGV);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    const local = await readLocal();
    const unmanaged = Object.keys(local.targets.unmanaged.bundles)[0];
    if (unmanaged === undefined) {
      throw new Error('The legacy intent was not retained as an unmanaged record.');
    }
    expect(unmanaged).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    const reason = local.targets.unmanaged.bundles[unmanaged].unmanagedReason;
    expect(reason).toBeTruthy();
    expect(result.stdout + result.stderr).toContain(unmanaged);
    expect(result.stdout + result.stderr).toContain(reason ?? '');
  });

  it('is idempotent: the same install twice leaves one record and the same bytes', async () => {
    await runFlagOn(INSTALL_ARGV);
    const firstDesired = await readFile(desiredLockfile, 'utf8');
    const firstLocal = await readLocal();
    const firstTree = await listTree(copilotDir);

    const second = await runFlagOn(INSTALL_ARGV);

    expect(second.exitCode).toBe(0);
    expect(await listTree(copilotDir)).toEqual(firstTree);
    // Byte-identical, not merely equivalent: the desired half has no churn.
    expect(await readFile(desiredLockfile, 'utf8')).toBe(firstDesired);
    const secondLocal = await readLocal();
    expect(Object.keys(secondLocal.targets['my-vscode'].bundles)).toEqual(Object.keys(firstLocal.targets['my-vscode'].bundles));
    // The local half is machine state: its `installedAt` may move, its records may not.
    const withoutTimestamps = (local: LocalFile): unknown => Object.values(local.targets['my-vscode'].bundles)
      .map(({ installedAt: _installedAt, ...rest }) => rest);
    expect(withoutTimestamps(secondLocal)).toEqual(withoutTimestamps(firstLocal));
  });

  describe('with a hand-written file already at one destination', () => {
    const HAND_WRITTEN = '# hand-written\n';
    const COLLIDED = 'prompts/hello.prompt.md';
    const OTHERS = ['agents/reviewer.agent.md', 'instructions/ts-standards.instructions.md'];
    let collision: string;

    const recordedPaths = async (): Promise<string[]> => {
      const { targets } = await readLocal();
      return Object.values(targets['my-vscode'].bundles).flatMap((record) => record.files.map((file) => file.path)).toSorted();
    };

    beforeEach(async () => {
      collision = path.join(copilotDir, ...COLLIDED.split(path.posix.sep));
      await mkdir(path.dirname(collision), { recursive: true });
      await writeFile(collision, HAND_WRITTEN, 'utf8');
    });

    it('skips and summarizes it, installing and recording only the other files', async () => {
      const skipped = await runFlagOn([...INSTALL_ARGV, '-o', 'json']);

      // A partial success: exit 0 with a `warning` status and the collision summarized.
      expect(skipped.exitCode).toBe(0);
      expect(parseJson<InstallData>(skipped.stdout).status).toBe('warning');
      expect(parseJson<InstallData>(skipped.stdout).data.collisions).toEqual([{ to: collision, reason: 'untracked-existing' }]);
      expect(await readFile(collision, 'utf8')).toBe(HAND_WRITTEN);
      expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
      expect(Object.keys((await readDesired()).bundles)).toHaveLength(1);
      // The skipped file is user-owned content, so it must not be in the record.
      expect(await recordedPaths()).toEqual(OTHERS);
    });

    it('leaves it in place on a later uninstall, because it was never recorded', async () => {
      await runFlagOn(INSTALL_ARGV);

      const result = await runFlagOn(['uninstall', '--bundle', 'web-dev', '--target', 'my-vscode']);

      expect(result.exitCode).toBe(0);
      expect(await listTree(copilotDir)).toEqual([COLLIDED]);
      expect(await readFile(collision, 'utf8')).toBe(HAND_WRITTEN);
    });

    it('overwrites it and records all three files with --force', async () => {
      await runFlagOn(INSTALL_ARGV);

      const forced = await runFlagOn([...INSTALL_ARGV, '--force']);

      expect(forced.exitCode).toBe(0);
      expect(await readFile(collision, 'utf8')).toBe('# Hello\n');
      expect(await recordedPaths()).toEqual(EXPECTED_TREE);
    });
  });

  /**
   * A RecordingFs whose first rename onto `lockfile` fails, as a state-write failure would.
   * With `keepBytes`, the best-effort rollback of placed files also fails, so the bytes
   * stay on disk as they would after a crash.
   * @param lockfile The state file whose write fails.
   * @param keepBytes Whether the placed files survive the failed install.
   */
  const failingStateWrite = (lockfile: string, keepBytes: boolean): RecordingFs => {
    const failing = new RecordingFs(workspace);
    failing.failOnce('rename', (file) => file === lockfile, new Error('injected state-write failure'));
    if (keepBytes) {
      for (const relative of EXPECTED_TREE) {
        const placed = path.join(copilotDir, ...relative.split(path.posix.sep));
        failing.failOnce('remove', (file) => file === placed, new Error('injected rollback failure'));
      }
    }
    return failing;
  };

  const relativeToCopilot = (file: string): string => path.relative(copilotDir, file).split(path.sep).join(path.posix.sep);

  /** After a retry: both halves are 3.0.0, with one desired entry and one materialization record for it. */
  const expectConvergedState = async (): Promise<void> => {
    const desired = await readDesired();
    const local = await readLocal();
    expect(desired.version).toBe('3.0.0');
    expect(local.version).toBe('3.0.0');
    const keys = Object.keys(desired.bundles);
    expect(keys).toHaveLength(1);
    expect(Object.keys(local.targets['my-vscode'].bundles)).toEqual(keys);
  };

  it('converges after a state-write failure that left bytes and no record, with no flag, because the bytes match', async () => {
    const failed = await runFlagOn(INSTALL_ARGV, failingStateWrite(localLockfile, true));

    // The injection fired on the first state write: bytes on disk, no record of them anywhere.
    expect(failed.exitCode).not.toBe(0);
    expect(failed.stdout + failed.stderr).toContain('injected state-write failure');
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    expect(await exists(localLockfile)).toBe(false);
    expect(await exists(desiredLockfile)).toBe(false);

    const retry = await runFlagOn([...INSTALL_ARGV, '-o', 'json']);

    expect(retry.exitCode).toBe(0);
    const { collisions, satisfied, written } = parseJson<InstallData>(retry.stdout).data;
    expect(collisions).toEqual([]);
    expect(written).toEqual([]);
    expect(satisfied.map((file) => relativeToCopilot(file)).toSorted()).toEqual(EXPECTED_TREE);
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    await expectConvergedState();
  });

  it('converges after a desired-write failure that left bytes and the local half', async () => {
    const failed = await runFlagOn(INSTALL_ARGV, failingStateWrite(desiredLockfile, true));

    // The injection fired on the desired write: the local half is already on disk, the desired half absent.
    expect(failed.exitCode).not.toBe(0);
    expect(failed.stdout + failed.stderr).toContain('injected state-write failure');
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    expect(await exists(desiredLockfile)).toBe(false);
    expect((await readLocal()).version).toBe('3.0.0');

    const retry = await runFlagOn([...INSTALL_ARGV, '-o', 'json']);

    expect(retry.exitCode).toBe(0);
    expect(parseJson<InstallData>(retry.stdout).data.collisions).toEqual([]);
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    await expectConvergedState();
  });

  it('converges after a desired-write failure that rolled the placed files back', async () => {
    const failed = await runFlagOn(INSTALL_ARGV, failingStateWrite(desiredLockfile, false));

    expect(failed.exitCode).not.toBe(0);
    expect(failed.stdout + failed.stderr).toContain('injected state-write failure');
    expect(await exists(desiredLockfile)).toBe(false);
    expect(await exists(localLockfile)).toBe(true);
    expect(await listTree(copilotDir)).toEqual([]);

    const retry = await runFlagOn(INSTALL_ARGV);

    expect(retry.exitCode).toBe(0);
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
    await expectConvergedState();
  });

  it.each([
    ['status', ['status']],
    ['update', ['update', '--target', 'my-vscode']],
    ['uninstall', ['uninstall', '--bundle', 'web-dev', '--target', 'my-vscode']]
  ])('flag-off %s against 3.0.0 state fails loudly and writes nothing', async (_name, argv) => {
    await runFlagOn(INSTALL_ARGV);
    const before = [
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ];
    const treeBefore = await listTree(copilotDir);

    const result = await runFlagOff(argv);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/newer version of AI Primitives Hub/);
    expect(result.stdout + result.stderr).toContain(desiredLockfile);
    expect([
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ]).toEqual(before);
    expect(await listTree(copilotDir)).toEqual(treeBefore);
  });

  it('flag-off local install against 3.0.0 state fails loudly before writing any bundle file', async () => {
    await runFlagOn(INSTALL_ARGV);
    const before = [
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ];
    // Drop the bundle's files so a flag-off install has something visible to write.
    await rm(copilotDir, { recursive: true, force: true });
    expect(await listTree(copilotDir)).toEqual([]);

    const result = await runFlagOff(INSTALL_ARGV);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/newer version of AI Primitives Hub/);
    expect(result.stdout + result.stderr).toContain(desiredLockfile);
    expect(await listTree(copilotDir)).toEqual([]);
    expect([
      await readFile(desiredLockfile, 'utf8'),
      await readFile(localLockfile, 'utf8')
    ]).toEqual(before);
  });

  it('writes a 2.0.0 desired lockfile and no local half with the flag off', async () => {
    const result = await runFlagOff(INSTALL_ARGV);

    expect(result.exitCode).toBe(0);
    expect((await readDesired()).version).toBe('2.0.0');
    // The legacy path writes one file and never creates the local half.
    expect(await exists(localLockfile)).toBe(false);
  });

  it('fails a live local-skills install before placement or lockfile writes', async () => {
    const skillFile = await configureLiveSkillsHub('live-local-skills');
    const userPaths = resolveUserConfigPaths(env);
    const recordingFs = new RecordingFs(workspace);

    const result = await runFlagOn(
      ['install', '--source', 'live-local-skills', '--interactive', '--target', 'my-vscode', '-o', 'json'],
      recordingFs
    );

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(1);
    expect(parseLastJson<{ installed: number; total: number }>(result.stdout)).toMatchObject({
      status: 'warning',
      data: { installed: 0, total: 1 }
    });
    expect(result.stdout + result.stderr).toContain('Live local-skills deployment is not supported by copy-only targets');
    expect(await listTree(copilotDir)).toEqual([]);
    expect(await readFile(skillFile, 'utf8')).toBe('---\nname: Web Dev\n---\n# Instructions\n');
    expect(await exists(desiredLockfile)).toBe(false);
    expect(await exists(localLockfile)).toBe(false);
    expect(recordingFs.writes.some((file) => file.startsWith(copilotDir))).toBe(false);
    const nonHubWrites = recordingFs.writes.filter((file) =>
      file !== userPaths.hubs && !file.startsWith(`${userPaths.hubs}${path.sep}`)
    );
    expect(nonHubWrites).toEqual([]);
  });

  it('preserves legacy flag-off ok JSON status for an incomplete interactive install', async () => {
    const skillFile = await configureLiveSkillsHub('live-local-skills-flag-off');
    const recordingFs = new RecordingFs(workspace);

    const result = await runFlagOff(
      ['install', '--source', 'live-local-skills-flag-off', '--interactive', '--target', 'my-vscode', '-o', 'json'],
      recordingFs
    );

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(parseLastJson<{ installed: number; total: number }>(result.stdout)).toMatchObject({
      status: 'ok',
      data: { installed: 0, total: 1 },
      warnings: []
    });
    expect(await listTree(copilotDir)).toEqual([]);
    expect(await readFile(skillFile, 'utf8')).toBe('---\nname: Web Dev\n---\n# Instructions\n');
    expect(await exists(desiredLockfile)).toBe(false);
    expect(await exists(localLockfile)).toBe(false);
    const userPaths = resolveUserConfigPaths(env);
    expect(recordingFs.writes.filter((file) =>
      file !== userPaths.hubs && !file.startsWith(`${userPaths.hubs}${path.sep}`)
    )).toEqual([]);
  });
});
