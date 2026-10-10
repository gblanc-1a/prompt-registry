/**
 * `profile activate`/`profile deactivate` end-to-end tests.
 *
 * Uses a real `NodeFileSystem` against a real temp directory (not
 * `createTestContext`'s default in-memory `fs` stub, which rejects every
 * call — see `framework/test-context.ts`'s module doc) because
 * activate/deactivate exercise real file writes/removals across a hub
 * config, a target directory, and the user-scope profile-activation
 * store. Mirrors the fixture/command-sequence already proven correct by
 * `doctor diagnostics`' steps 1-9 and 20-21.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveUserConfigPaths,
} from '@ai-primitives-hub/app';
import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  ApplyCommand,
} from '../../src/commands/apply';
import {
  HubAddCommand,
  HubSyncCommand,
  HubUseCommand,
} from '../../src/commands/hub';
import {
  ProfileActivateCommand,
  ProfileCurrentCommand,
  ProfileDeactivateCommand,
  ProfileListCommand,
  ProfileShowCommand,
} from '../../src/commands/profile';
import {
  TargetAddCommand,
} from '../../src/commands/target-add';
import {
  runCommand,
} from '../../src/framework';
import {
  RecordingFs,
} from '../fixtures/recording-fs';
import {
  createGovernedReleaseArchive,
  createLegacyReleaseArchive,
  writeReleaseArchive,
} from '../fixtures/release-archives';

const COMMAND_CLASSES = [
  ApplyCommand,
  TargetAddCommand,
  HubAddCommand,
  HubUseCommand,
  HubSyncCommand,
  ProfileListCommand,
  ProfileShowCommand,
  ProfileCurrentCommand,
  ProfileActivateCommand,
  ProfileDeactivateCommand
];

interface JsonEnvelope<T> {
  status: string;
  data: T;
}

describe('profile activate/deactivate', () => {
  let workspace: string;
  let bundleDir: string;
  let targetDir: string;
  let hubConfigFile: string;

  const run = (argv: string[], fs: NodeFileSystem = new NodeFileSystem()): ReturnType<typeof runCommand> => runCommand(argv, {
    commandClasses: COMMAND_CLASSES,
    context: {
      cwd: workspace,
      fs,
      env: {
        HOME: workspace,
        USERPROFILE: workspace,
        XDG_CONFIG_HOME: path.join(workspace, 'xdg-config'),
        XDG_CACHE_HOME: path.join(workspace, 'xdg-cache')
      }
    }
  });

  const parseJson = <T>(stdout: string): JsonEnvelope<T> => JSON.parse(stdout) as JsonEnvelope<T>;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'cli-profile-test-'));
    bundleDir = path.join(workspace, 'bundle');
    targetDir = path.join(workspace, 'target');
    hubConfigFile = path.join(workspace, 'hub-config.yml');

    await mkdir(targetDir, { recursive: true });
    await writeReleaseArchive(bundleDir, createLegacyReleaseArchive({ id: 'local-foo' }));
    await writeFile(
      hubConfigFile,
      `version: 1.0.0
metadata:
  name: Test Hub
  description: Test hub for profile activate/deactivate
  maintainer: test
  updatedAt: '2026-01-01T00:00:00Z'
sources:
  - id: local-foo-src
    name: Local Foo Source
    type: local
    url: ${bundleDir}
    enabled: true
    priority: 0
    hubId: test-hub
profiles:
  - id: backend
    name: Backend Developer
    description: Test profile
    bundles:
      - id: local-foo
        version: 1.0.0
        source: local-foo-src
        required: true
`
    );

    expect((await run([
      'target', 'add', 'copilot', '--type', 'copilot-cli', '--path', targetDir, '-o', 'json'
    ])).exitCode).toBe(0);
    expect((await run([
      'hub', 'add', '--type', 'local', '--location', hubConfigFile, '--id', 'test-hub', '-o', 'json'
    ])).exitCode).toBe(0);
    expect((await run(['hub', 'use', 'test-hub', '-o', 'json'])).exitCode).toBe(0);
    expect((await run(['hub', 'sync', 'test-hub', '-o', 'json'])).exitCode).toBe(0);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const snapshotTree = async (): Promise<[string, string][]> => {
    const entries = await readdir(workspace, { recursive: true, withFileTypes: true });
    return Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(workspace, file), (await readFile(file)).toString('base64')] as [string, string];
    }));
  };

  const gatedCommands = [
    ['profile', 'activate', 'backend'],
    ['apply', '--no-sync'],
    ['apply'],
    ['profile', 'deactivate']
  ].map((argv) => ({ argv, label: argv.join(' ') }));
  it.each(gatedCommands)('$label preflights mixed repository/user targets before any profile or file mutation', async ({ argv }) => {
    const repository = path.join(workspace, 'repository');
    await mkdir(repository);
    expect((await run([
      'target', 'add', 'repo', '--type', 'vscode', '--scope', 'repository', '--workspace-root', repository, '-o', 'json'
    ])).exitCode).toBe(0);
    expect((await run(['profile', 'activate', 'backend', '-o', 'json'])).exitCode).toBe(0);
    const userLockfile = resolveUserConfigPaths({ HOME: workspace, XDG_CONFIG_HOME: path.join(workspace, 'xdg-config') }).userLockfile;
    await writeFile(userLockfile, JSON.stringify({ version: '3.0.0', bundles: {}, sources: {} }));
    const before = await snapshotTree();
    const recording = new RecordingFs(workspace);

    const result = await run([...argv, '-o', 'json'], recording);
    expect(result.exitCode).not.toBe(0);
    expect(recording.writes).toEqual([]);
    expect(await snapshotTree()).toEqual(before);
    const current = await run(['profile', 'current', '-o', 'json']);
    expect(parseJson<{ active: { profileId: string } }>(current.stdout).data.active.profileId).toBe('backend');
  });

  it('profile activation dry-run previews can return before the v3 gate without mutations', async () => {
    expect((await run(['profile', 'activate', 'backend', '-o', 'json'])).exitCode).toBe(0);
    const userLockfile = resolveUserConfigPaths({ HOME: workspace, XDG_CONFIG_HOME: path.join(workspace, 'xdg-config') }).userLockfile;
    await writeFile(userLockfile, JSON.stringify({ version: '3.0.0', bundles: {}, sources: {} }));
    const recording = new RecordingFs(workspace);
    expect((await run(['profile', 'activate', 'backend', '--dry-run', '-o', 'json'], recording)).exitCode).toBe(0);
    expect(recording.writes).toEqual([]);
  });

  it('lists the seeded profile', async () => {
    const result = await run(['profile', 'list', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson<{ profiles: { id: string; name: string }[] }>(result.stdout);
    expect(envelope.data.profiles.map((p) => p.id)).toContain('backend');
  });

  it('shows profile details', async () => {
    const result = await run(['profile', 'show', 'backend', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson<{ profile: { id: string; bundles: { id: string }[] } }>(result.stdout);
    expect(envelope.data.profile.id).toBe('backend');
    expect(envelope.data.profile.bundles.map((b) => b.id)).toContain('local-foo');
  });

  it('reports no active profile before activation', async () => {
    const result = await run(['profile', 'current', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson<{ active: null }>(result.stdout);
    expect(envelope.data.active).toBeNull();
  });

  it('activates a profile: installs bundle files to the target and records it as current', async () => {
    const activateResult = await run(['profile', 'activate', 'backend', '--target', 'copilot', '-o', 'json']);
    expect(activateResult.exitCode).toBe(0);
    const activateEnvelope = parseJson<{ hubId: string; profileId: string }>(activateResult.stdout);
    expect(activateEnvelope.data.profileId).toBe('backend');
    expect(activateEnvelope.data.hubId).toBe('test-hub');

    const installed = await readFile(path.join(targetDir, 'prompts', 'hello.prompt.md'), 'utf8');
    expect(installed).toContain('Hello Prompt');

    const currentResult = await run(['profile', 'current', '-o', 'json']);
    expect(currentResult.exitCode).toBe(0);
    const currentEnvelope = parseJson<{ active: { hubId: string; profileId: string } }>(currentResult.stdout);
    expect(currentEnvelope.data.active).toEqual({ hubId: 'test-hub', profileId: 'backend' });
  });

  it('activates a governed profile without writing archive metadata or ignored files', async () => {
    await writeReleaseArchive(bundleDir, createGovernedReleaseArchive({ id: 'local-foo' }));
    expect((await run(['hub', 'sync', 'test-hub', '-o', 'json'])).exitCode).toBe(0);

    const activateResult = await run(['profile', 'activate', 'backend', '--target', 'copilot', '-o', 'json']);
    expect(activateResult.exitCode).toBe(0);

    await expect(readFile(path.join(targetDir, 'prompts', 'hello.prompt.md'), 'utf8'))
      .resolves.toContain('Hello Prompt');
    await expect(readFile(path.join(targetDir, 'README.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(targetDir, 'LICENSE'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(targetDir, 'ignored', 'build', 'cache.pyc'), 'utf8'))
      .rejects.toThrow();

    const lockfilePath = resolveUserConfigPaths({
      XDG_CONFIG_HOME: path.join(workspace, 'xdg-config'),
      HOME: workspace,
      USERPROFILE: workspace
    }).userLockfile;
    const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8')) as {
      bundles: Record<string, { files: { path: string }[] }>;
    };
    expect(lockfile.bundles['local-foo'].files.map((file) => file.path)).toEqual([
      'prompts/hello.prompt.md'
    ]);
  });

  it('deactivates a profile: removes installed files and clears the active profile', async () => {
    expect((await run(['profile', 'activate', 'backend', '--target', 'copilot', '-o', 'json'])).exitCode).toBe(0);

    const deactivateResult = await run(['profile', 'deactivate', '-o', 'json']);
    expect(deactivateResult.exitCode).toBe(0);
    const deactivateEnvelope = parseJson<{ deactivated: { hubId: string; profileId: string } }>(deactivateResult.stdout);
    expect(deactivateEnvelope.data.deactivated).toEqual({ hubId: 'test-hub', profileId: 'backend' });

    await expect(readFile(path.join(targetDir, 'prompts', 'hello.prompt.md'), 'utf8')).rejects.toThrow();

    const currentResult = await run(['profile', 'current', '-o', 'json']);
    const currentEnvelope = parseJson<{ active: null }>(currentResult.stdout);
    expect(currentEnvelope.data.active).toBeNull();
  });

  it('deactivating with no active profile is a no-op that succeeds', async () => {
    const result = await run(['profile', 'deactivate', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson<{ deactivated: null }>(result.stdout);
    expect(envelope.data.deactivated).toBeNull();
  });

  it('is idempotent across repeated activate/deactivate cycles: leaves no residue', async () => {
    for (let i = 0; i < 2; i += 1) {
      expect((await run(['profile', 'activate', 'backend', '--target', 'copilot', '-o', 'json'])).exitCode).toBe(0);
      expect((await run(['profile', 'deactivate', '-o', 'json'])).exitCode).toBe(0);
    }

    await expect(readFile(path.join(targetDir, 'prompts', 'hello.prompt.md'), 'utf8')).rejects.toThrow();
  });
});
