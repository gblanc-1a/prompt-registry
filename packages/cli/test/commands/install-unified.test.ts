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
  type Lockfile,
  resolveUserConfigPaths,
  upsertBundleEntry,
  upsertSource,
  writeLockfile,
} from '@ai-primitives-hub/app';
import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  RegistrySource,
  Target,
} from '@ai-primitives-hub/core';
import {
  buildZip,
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
  installBundleWithSource,
  InstallCommand,
} from '../../src/commands/install';
import {
  TargetAddCommand,
} from '../../src/commands/target-add';
import {
  createTestContext,
  runCli,
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

/** Real filesystem that records which paths a run read and which it mutated. */
class RecordingFs extends NodeFileSystem {
  public readonly reads: string[] = [];
  public readonly writes: string[] = [];

  public override async readFile(file: string): Promise<string> {
    this.reads.push(file);
    return await super.readFile(file);
  }

  public override async readFileBytes(file: string): Promise<Uint8Array> {
    this.reads.push(file);
    return await super.readFileBytes(file);
  }

  public override async exists(file: string): Promise<boolean> {
    this.reads.push(file);
    return await super.exists(file);
  }

  public override async readDir(dir: string): Promise<string[]> {
    this.reads.push(dir);
    return await super.readDir(dir);
  }

  public override async writeFile(file: string, contents: string): Promise<void> {
    this.writes.push(file);
    await super.writeFile(file, contents);
  }

  public override async writeFileBytes(file: string, bytes: Uint8Array): Promise<void> {
    this.writes.push(file);
    await super.writeFileBytes(file, bytes);
  }

  public override async mkdir(dir: string, opts?: { recursive?: boolean }): Promise<void> {
    this.writes.push(dir);
    await super.mkdir(dir, opts);
  }

  public override async rename(from: string, to: string): Promise<void> {
    this.writes.push(to);
    await super.rename(from, to);
  }

  public override async remove(file: string, opts?: { recursive?: boolean }): Promise<void> {
    this.writes.push(file);
    await super.remove(file, opts);
  }
}

describe('install command (AI_PRIMITIVES_HUB_UNIFIED_DEPLOY on, user scope)', () => {
  let workspace: string;
  let bundleDir: string;
  let env: Record<string, string>;

  const run = (
    argv: string[],
    overrides: Record<string, string> = {},
    fs: NodeFileSystem = new NodeFileSystem()
  ): ReturnType<typeof runCommand> => runCommand(argv, {
    commandClasses: [TargetAddCommand, InstallCommand],
    context: { cwd: workspace, fs, env: { ...env, ...overrides } }
  });

  const seedLegacyLockfile = async (): Promise<Lockfile> => {
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
    return legacy;
  };
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

  it.each(['repository', 'workspace', 'bogus'])('refuses scope "%s" with BUNDLE.UNSUPPORTED_SCOPE before reading or writing anything', async (scope) => {
    const recording = new RecordingFs();
    await seedLegacyLockfile();
    const userPaths = resolveUserConfigPaths(env);
    const before = await readFile(userPaths.userLockfile, 'utf8');

    const result = await run([
      'install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '--scope', scope, '-o', 'json'
    ], flagOn, recording);

    expect(result.exitCode).toBe(1);
    const { errors } = parse<null>(result.stdout);
    expect(errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
    expect(errors[0].message).toContain(`scope "${scope}"`);
    expect(errors[0].message).toContain('slice 3');
    expect(recording.writes).toEqual([]);
    expect(recording.reads.filter((p) => p.startsWith(bundleDir)
      || p === userPaths.userLockfile || p === userPaths.userLocalLockfile)).toEqual([]);
    await expect(readFile(userPaths.userLockfile, 'utf8')).resolves.toBe(before);
    expect(await exists(path.join(workspace, '.github'))).toBe(false);
    expect(await exists(userPaths.userLocalLockfile)).toBe(false);
  });

  it('reads a target with no scope as user and records user scope', async () => {
    const added = await run(['target', 'add', 'scopeless', '--type', 'vscode', '-o', 'json']);
    const { file } = parse<{ file: string }>(added.stdout).data;
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replaceAll(/^\s*scope: .*\n/gm, ''));

    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'scopeless', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const local = JSON.parse(await readFile(resolveUserConfigPaths(env).userLocalLockfile, 'utf8')) as {
      targets: Record<string, { scope: string }>;
    };
    expect(local.targets.scopeless.scope).toBe('user');
  });

  it('records the source descriptor in the desired lockfile for a fresh local install', async () => {
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const desired = JSON.parse(await readFile(resolveUserConfigPaths(env).userLockfile, 'utf8')) as {
      bundles: Record<string, { sourceId: string }>;
      sources: Record<string, { type: string; url: string }>;
    };
    const [entry] = Object.values(desired.bundles);
    expect(desired.sources[entry.sourceId]).toEqual({ type: 'local', url: bundleDir });
  });

  it('dry-run over an un-migrated v2 lockfile refuses with an actionable error and writes nothing', async () => {
    await seedLegacyLockfile();
    const userPaths = resolveUserConfigPaths(env);
    const before = await readFile(userPaths.userLockfile, 'utf8');
    const recording = new RecordingFs();

    const result = await run([
      'install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '--dry-run', '-o', 'json'
    ], flagOn, recording);

    expect(result.exitCode).toBe(1);
    const { errors } = parse<null>(result.stdout);
    expect(errors[0].code).toBe('CONFIG.LOCKFILE_NOT_MIGRATED');
    expect(errors[0].message).toContain(userPaths.userLockfile);
    expect(JSON.stringify(errors[0])).toContain('Run the install without --dry-run to migrate it');
    expect(recording.writes).toEqual([]);
    await expect(readFile(userPaths.userLockfile, 'utf8')).resolves.toBe(before);
    expect(await exists(userPaths.userLocalLockfile)).toBe(false);
  });

  it('a non-dry-run install over a v2 lockfile still migrates it and succeeds', async () => {
    await seedLegacyLockfile();

    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);

    expect(result.exitCode).toBe(0);
    const { data } = parse<UnifiedInstallData>(result.stdout);
    expect(data.migration?.unmanaged.map((u) => u.key)).toEqual(['legacy-source/older-bundle']);
    const desired = JSON.parse(await readFile(data.lockfile, 'utf8')) as { version: string; bundles: Record<string, unknown> };
    expect(desired.version.startsWith('3.')).toBe(true);
    expect(Object.keys(desired.bundles)).toContain('legacy-source/older-bundle');
    await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
  });

  it('does not claim a lockfile update when a collision-only fresh install wrote none', async () => {
    await mkdir(path.dirname(destination()), { recursive: true });
    await writeFile(destination(), 'user-authored\n');
    const userPaths = resolveUserConfigPaths(env);

    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode'], flagOn);

    expect(result.exitCode).toBe(0);
    expect(await exists(userPaths.userLockfile)).toBe(false);
    expect(await exists(userPaths.userLocalLockfile)).toBe(false);
    expect(result.stdout).not.toContain('Updated');
    expect(result.stdout).toContain('Lockfile unchanged');
  });

  it('says it updated the lockfile when it did', async () => {
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode'], flagOn);

    expect(result.stdout).toContain(`Updated ${resolveUserConfigPaths(env).userLockfile}.`);
  });

  describe('remote', () => {
    const remoteBundleId = 'remote-foo';
    const zipBytes = buildZip([...createLegacyReleaseArchive({ id: remoteBundleId }).entries()].map(([filePath, bytes]) => ({
      path: filePath,
      bytes
    })));
    let httpCalls: string[];
    const http: HttpClient = {
      fetch: (request: HttpRequest): Promise<HttpResponse> => {
        httpCalls.push(request.url);
        if (request.url === 'https://api.github.com/repos/owner/repo/releases') {
          return Promise.resolve({
            statusCode: 200,
            body: new TextEncoder().encode(JSON.stringify([{
              tag_name: `${remoteBundleId}-v1.0.0`,
              assets: [{ name: 'bundle.zip', url: 'https://api.github.com/assets/remote-foo' }]
            }])),
            finalUrl: request.url,
            headers: {}
          });
        }
        if (request.url === 'https://api.github.com/assets/remote-foo') {
          return Promise.resolve({ statusCode: 200, body: zipBytes, finalUrl: request.url, headers: {} });
        }
        return Promise.reject(new Error(`Unexpected request: ${request.url}`));
      }
    };
    const tokens = { getToken: () => Promise.resolve(undefined) };

    const runRemote = async (argv: string[], fs: NodeFileSystem = new NodeFileSystem()): Promise<{ exitCode: number; stdout: string }> => {
      const ctx = createTestContext({ cwd: workspace, fs, env: { ...env, ...flagOn } });
      const exitCode = await runCli(argv, {
        ctx,
        name: 'ai-primitives-hub',
        version: '0.0.0-test',
        commands: [],
        commandClasses: [TargetAddCommand, InstallCommand],
        http,
        tokens
      });
      return { exitCode, stdout: ctx.stdout.captured() };
    };

    beforeEach(() => {
      httpCalls = [];
    });

    it('refuses repository scope before any HTTP request', async () => {
      const recording = new RecordingFs();

      const result = await runRemote([
        'install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '--scope', 'repository', '-o', 'json'
      ], recording);

      expect(result.exitCode).toBe(1);
      expect(parse<null>(result.stdout).errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(httpCalls).toEqual([]);
      expect(recording.writes).toEqual([]);
    });

    it('dry-run over an un-migrated v2 lockfile surfaces CONFIG.LOCKFILE_NOT_MIGRATED, not a network error, and writes nothing', async () => {
      await seedLegacyLockfile();
      const recording = new RecordingFs();

      const result = await runRemote([
        'install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '--dry-run', '-o', 'json'
      ], recording);

      expect(result.exitCode).toBe(1);
      expect(parse<null>(result.stdout).errors[0].code).toBe('CONFIG.LOCKFILE_NOT_MIGRATED');
      expect(recording.writes).toEqual([]);
    });

    it('a non-dry-run install over a v2 lockfile still migrates it and succeeds', async () => {
      await seedLegacyLockfile();

      const result = await runRemote(['install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '-o', 'json']);

      expect(result.exitCode).toBe(0);
      expect(parse<UnifiedInstallData>(result.stdout).data.migration?.unmanaged).toHaveLength(1);
    });

    it('records github.com as the source URL when no source is configured', async () => {
      const result = await runRemote(['install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '-o', 'json']);

      expect(result.exitCode).toBe(0);
      const desired = JSON.parse(await readFile(resolveUserConfigPaths(env).userLockfile, 'utf8')) as {
        sources: Record<string, unknown>;
      };
      expect(Object.values(desired.sources)).toEqual([{ type: 'github', url: 'https://github.com/owner/repo' }]);
    });

    it('records the configured source URL, branch and collectionsPath rather than a synthesized github.com URL', async () => {
      const source: RegistrySource = {
        id: 'mirror-source',
        name: 'Mirror source',
        type: 'github',
        url: 'https://www.github.com/owner/repo',
        enabled: true,
        priority: 0,
        config: { branch: 'release', collectionsPath: 'collections' }
      };
      const target: Target = { name: 'my-vscode', type: 'vscode', scope: 'user' };
      const ctx = createTestContext({ cwd: workspace, fs: new NodeFileSystem(), env: { ...env, ...flagOn } });

      const exitCode = await installBundleWithSource(remoteBundleId, source, target, ctx, http, tokens, 'json');

      expect(exitCode).toBe(0);
      const desired = JSON.parse(await readFile(resolveUserConfigPaths(env).userLockfile, 'utf8')) as {
        bundles: Record<string, { sourceId: string }>;
        sources: Record<string, unknown>;
      };
      const [entry] = Object.values(desired.bundles);
      expect(desired.sources[entry.sourceId]).toEqual({
        type: source.type,
        url: source.url,
        branch: 'release',
        collectionsPath: 'collections'
      });
    });
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
