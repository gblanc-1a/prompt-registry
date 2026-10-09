/**
 * Flag-on (`AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`) `install` integration tests.
 *
 * Real `NodeFileSystem` against a temp workspace, local `--from` mode only
 * (no network). The legacy path is covered by `install.test.ts`, which runs
 * with the flag unset.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  emptyLockfile,
  resolveUserConfigPaths,
  upsertBundleEntry,
  upsertSource,
  writeLockfile,
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
  InstallCommand,
} from '../../src/commands/install';
import {
  TargetAddCommand,
} from '../../src/commands/target-add';
import {
  runCommand,
} from '../../src/framework';
import {
  createLegacyReleaseArchive,
  writeReleaseArchive,
} from '../fixtures/release-archives';

interface JsonEnvelope<T> {
  status: string;
  data: T;
  errors: { code: string; message: string }[];
  warnings: string[];
}

interface UnifiedInstallData {
  target: string;
  bundle: { id: string; version: string };
  written: string[];
  skipped: unknown[];
  lockfile: string;
  collisions: { to: string; reason: string }[];
  satisfied: string[];
  migration: { migrated: string[]; unmanaged: { key: string; reason: string }[] } | null;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

describe('install command (AI_PRIMITIVES_HUB_UNIFIED_DEPLOY on, user scope)', () => {
  let workspace: string;
  let bundleDir: string;
  let env: Record<string, string>;

  const run = (argv: string[], overrides: Record<string, string> = {}): ReturnType<typeof runCommand> => runCommand(argv, {
    commandClasses: [TargetAddCommand, InstallCommand],
    context: {
      cwd: workspace,
      fs: new NodeFileSystem(),
      env: { ...env, ...overrides }
    }
  });
  const flagOn = { AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' };
  const parse = <T>(stdout: string): JsonEnvelope<T> => JSON.parse(stdout) as JsonEnvelope<T>;
  const destination = (): string => path.join(workspace, '.copilot', 'prompts', 'hello.prompt.md');

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'cli-install-unified-test-'));
    bundleDir = path.join(workspace, 'bundle');
    env = {
      HOME: workspace,
      USERPROFILE: workspace,
      XDG_CONFIG_HOME: path.join(workspace, 'xdg-config'),
      XDG_CACHE_HOME: path.join(workspace, 'xdg-cache')
    };
    await mkdir(bundleDir, { recursive: true });
    await writeReleaseArchive(bundleDir, createLegacyReleaseArchive({ id: 'local-foo' }));
    expect((await run(['target', 'add', 'my-vscode', '--type', 'vscode', '-o', 'json'])).exitCode).toBe(0);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('installs through the deploy path and emits the legacy keys plus collisions, satisfied and migration', async () => {
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const { data } = parse<UnifiedInstallData>(result.stdout);
    expect(data.target).toBe('my-vscode');
    expect(data.bundle).toEqual({ id: 'local-foo', version: '1.0.0' });
    expect(data.written).toEqual([destination()]);
    expect(data.skipped).toEqual([]);
    expect(data.lockfile).toBe(resolveUserConfigPaths(env).userLockfile);
    expect(data.collisions).toEqual([]);
    expect(data.satisfied).toEqual([]);
    expect(data.migration).toBeNull();
    await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    const desired = JSON.parse(await readFile(data.lockfile, 'utf8')) as { version: string; bundles: Record<string, unknown> };
    expect(desired.version.startsWith('3.')).toBe(true);
    expect(Object.keys(desired.bundles)).toEqual([`local-${path.basename(bundleDir)}/local-foo`]);
  });

  it('reports a second identical install as satisfied rather than rewriting', async () => {
    await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const { data } = parse<UnifiedInstallData>(result.stdout);
    expect(data.written).toEqual([]);
    expect(data.satisfied).toEqual([destination()]);
  });

  it('dry-run plans without writing the bundle or any lockfile', async () => {
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '--dry-run', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const { data } = parse<{ dryRun: boolean; destinations: string[] }>(result.stdout);
    expect(data.dryRun).toBe(true);
    expect(data.destinations).toEqual([destination()]);
    expect(await exists(destination())).toBe(false);
    const userPaths = resolveUserConfigPaths(env);
    expect(await exists(userPaths.userLockfile)).toBe(false);
    expect(await exists(userPaths.userLocalLockfile)).toBe(false);
  });

  it('leaves an untracked colliding file in place unless --force is given', async () => {
    await mkdir(path.dirname(destination()), { recursive: true });
    await writeFile(destination(), 'user-authored\n');

    const refused = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(refused.exitCode).toBe(0);
    const refusedEnvelope = parse<UnifiedInstallData>(refused.stdout);
    expect(refusedEnvelope.status).toBe('warning');
    expect(refusedEnvelope.data.collisions).toEqual([{ to: destination(), reason: 'untracked-existing' }]);
    expect(refusedEnvelope.data.written).toEqual([]);
    await expect(readFile(destination(), 'utf8')).resolves.toBe('user-authored\n');

    const forced = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '--force', '-o', 'json'], flagOn);

    expect(forced.exitCode).toBe(0);
    expect(parse<UnifiedInstallData>(forced.stdout).data.written).toEqual([destination()]);
    await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
  });

  it('refuses repository scope naming the flag, and writes nothing', async () => {
    const result = await run([
      'install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '--scope', 'repository', '-o', 'json'
    ], flagOn);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('BUNDLE.UNSUPPORTED_SCOPE');
    expect(result.stdout + result.stderr).toContain('AI_PRIMITIVES_HUB_UNIFIED_DEPLOY');
    expect(await exists(path.join(workspace, '.github'))).toBe(false);
    expect(await exists(resolveUserConfigPaths(env).userLocalLockfile)).toBe(false);
  });

  it('surfaces why a legacy bundle was left unmanaged, in JSON and in text', async () => {
    const userPaths = resolveUserConfigPaths(env);
    let legacy = emptyLockfile('ai-primitives-hub-cli');
    legacy = upsertBundleEntry(legacy, 'older-bundle', {
      version: '0.9.0',
      sourceId: 'legacy-source',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      files: []
    });
    legacy = upsertSource(legacy, 'legacy-source', { type: 'github', url: 'https://github.com/o/r' });
    await mkdir(path.dirname(userPaths.userLockfile), { recursive: true });
    await writeLockfile(userPaths.userLockfile, legacy, new NodeFileSystem());

    const json = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(json.exitCode).toBe(0);
    const { data } = parse<UnifiedInstallData>(json.stdout);
    expect(data.migration?.unmanaged).toHaveLength(1);
    const [entry] = data.migration?.unmanaged ?? [];
    expect(entry.key).toContain('older-bundle');
    expect(entry.reason.length).toBeGreaterThan(0);

    // A second flag-on run does not migrate again, so rebuild the v2 state for the text assertion.
    await rm(userPaths.userLockfile);
    await rm(userPaths.userLocalLockfile);
    await writeLockfile(userPaths.userLockfile, legacy, new NodeFileSystem());
    await rm(destination());
    const text = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode'], flagOn);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(entry.key);
    expect(text.stdout).toContain(entry.reason);
  });
});
