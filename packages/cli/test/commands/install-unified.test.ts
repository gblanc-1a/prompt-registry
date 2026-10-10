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
  symlink,
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
  RecordingFs,
} from '../fixtures/recording-fs';
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
  duplicates?: { to: string; ids: string[] }[];
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

  it.each(['json', 'text'])('reports normalized duplicates and keeps the first payload in %s output', async (output) => {
    await writeFile(path.join(bundleDir, 'deployment-manifest.yml'),
      'id: local-foo\nversion: 1.0.0\nname: Duplicates\nprompts:\n'
      + '  - id: hello world\n    file: prompts/first.md\n    type: prompt\n'
      + '  - id: hello-world\n    file: prompts/last.md\n    type: prompt\n');
    await writeFile(path.join(bundleDir, 'prompts', 'first.md'), '# first\n');
    await writeFile(path.join(bundleDir, 'prompts', 'last.md'), '# last\n');
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', output], flagOn);
    const duplicate = path.join(workspace, '.copilot', 'prompts', 'hello-world.prompt.md');
    expect(result.exitCode).toBe(0);
    expect(await readFile(duplicate, 'utf8')).toBe('# first\n');
    if (output === 'json') {
      expect(parse<UnifiedInstallData>(result.stdout).data.duplicates).toEqual([
        { to: duplicate, ids: ['hello world', 'hello-world'] }
      ]);
    } else {
      expect(result.stdout).toContain('Duplicate destination');
      expect(result.stdout).toContain(duplicate);
      expect(result.stdout).toContain('first');
    }
  });

  it.each(['json', 'text'])('renders applied effects after a state-write failure in %s output and exits nonzero', async (output) => {
    const fs = new RecordingFs(workspace);
    const local = resolveUserConfigPaths(env).userLocalLockfile;
    fs.failOnce('writeFile', (file) => file.startsWith(`${local}.`), new Error('ENOSPC at state write'));
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', output], flagOn, fs);
    expect(result.exitCode).toBe(1);
    expect(await exists(destination())).toBe(false);
    if (output === 'json') {
      const envelope = parse<{ stage: string; written: string[]; created: string[]; cleanedUp: string[] }>(result.stdout);
      expect(envelope.data).toMatchObject({
        stage: 'state-write', written: [destination()], created: [destination()], cleanedUp: [destination()]
      });
      expect(envelope.errors[0].code).toBe('BUNDLE.DEPLOY_FAILED');
    } else {
      expect(result.stderr).toContain('written:');
      expect(result.stderr).toContain('cleaned up:');
      expect(result.stderr).toContain(destination());
    }
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

  describe('lockfile replay (local sources)', () => {
    interface DesiredFile {
      bundles: Record<string, { version: string; sourceId: string }>;
      sources: Record<string, unknown>;
    }
    interface ReplayData {
      lockfile: string;
      target: string;
      replayPlanned: number;
      replayed: string[];
      failures: { key: string; reason: string }[];
      written: string[];
      skipped: unknown[];
      collisions: { to: string; reason: string }[];
      satisfied: string[];
      migration: { migrated: string[] } | null;
    }
    interface DryRunReplayData {
      dryRun: boolean;
      replayPlanned: number;
      wouldReplay: string[];
      destinations: string[];
      satisfied: string[];
      collisions: unknown[];
      skipped: unknown[];
      failures: { key: string; reason: string }[];
    }

    const lockfilePath = (): string => resolveUserConfigPaths(env).userLockfile;
    const replayKey = (): string => `local-${path.basename(bundleDir)}/local-foo`;
    const installOnce = async (): Promise<void> => {
      const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json'], flagOn);
      expect(result.exitCode).toBe(0);
    };
    const replay = (extra: string[] = [], fs: NodeFileSystem = new NodeFileSystem(), file: string = lockfilePath()): ReturnType<typeof runCommand> =>
      run(['install', '--lockfile', file, '--target', 'my-vscode', ...extra, '-o', 'json'], flagOn, fs);
    const readDesired = async (): Promise<DesiredFile> => JSON.parse(await readFile(lockfilePath(), 'utf8')) as DesiredFile;
    const editDesired = async (edit: (desired: DesiredFile) => void): Promise<void> => {
      const desired = await readDesired();
      edit(desired);
      await writeFile(lockfilePath(), JSON.stringify(desired, null, 2));
    };

    it('replay preserves a failed bundle applied-effects details in its JSON failures', async () => {
      await installOnce();
      await rm(destination());
      const fs = new RecordingFs(workspace);
      fs.failOnce('rename', (file) => file === resolveUserConfigPaths(env).userLocalLockfile, new Error('state rename refused'));
      const result = await replay([], fs);
      expect(result.exitCode).toBe(1);
      const data = parse<{ failures: { error: { context: { appliedEffects: { written: string[]; cleanedUp: string[] } } } }[] }>(result.stdout).data;
      const local = resolveUserConfigPaths(env).userLocalLockfile;
      const temporary = fs.writes.find((file) => file.startsWith(`${local}.`) && file.endsWith('.tmp'));
      if (temporary === undefined) {
        throw new Error('The failed rename must follow a successful temporary state-file write');
      }
      expect(data.failures[0].error.context.appliedEffects).toMatchObject({
        written: [destination()], cleanedUp: [destination(), temporary]
      });
      expect(await exists(destination())).toBe(false);
      expect(await exists(temporary)).toBe(false);
    });

    it('replays the desired state a prior flag-on install recorded, restoring a deleted file', async () => {
      await installOnce();
      await rm(destination());

      const result = await replay();

      expect(result.exitCode).toBe(0);
      const envelope = parse<ReplayData>(result.stdout);
      expect(envelope.status).toBe('ok');
      expect(envelope.data.replayed).toEqual([replayKey()]);
      expect(envelope.data.replayPlanned).toBe(1);
      expect(envelope.data.failures).toEqual([]);
      expect(envelope.data.written).toEqual([destination()]);
      expect(envelope.data.collisions).toEqual([]);
      expect(envelope.data.skipped).toEqual([]);
      expect(envelope.data.migration).toBeNull();
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('reports a replay over already-installed files as satisfied rather than rewriting', async () => {
      await installOnce();

      const result = await replay();

      expect(result.exitCode).toBe(0);
      const { data } = parse<ReplayData>(result.stdout);
      expect(data.replayed).toEqual([replayKey()]);
      expect(data.written).toEqual([]);
      expect(data.satisfied).toEqual([destination()]);
    });

    it('--dry-run plans each desired entry and writes nothing', async () => {
      await installOnce();
      await rm(destination());
      const userPaths = resolveUserConfigPaths(env);
      const desiredBefore = await readFile(userPaths.userLockfile, 'utf8');
      const localBefore = await readFile(userPaths.userLocalLockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await replay(['--dry-run'], recording);

      expect(result.exitCode).toBe(0);
      const { data } = parse<DryRunReplayData>(result.stdout);
      expect(data.dryRun).toBe(true);
      expect(data.wouldReplay).toEqual([replayKey()]);
      expect(data.replayPlanned).toBe(1);
      expect(data.destinations).toEqual([destination()]);
      expect(data.failures).toEqual([]);
      expect(recording.writes).toEqual([]);
      expect(await exists(destination())).toBe(false);
      await expect(readFile(userPaths.userLockfile, 'utf8')).resolves.toBe(desiredBefore);
      await expect(readFile(userPaths.userLocalLockfile, 'utf8')).resolves.toBe(localBefore);
    });

    it('--dry-run over an un-migrated v2 lockfile refuses with CONFIG.LOCKFILE_NOT_MIGRATED and writes nothing', async () => {
      await seedLegacyLockfile();
      const userPaths = resolveUserConfigPaths(env);
      const before = await readFile(userPaths.userLockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await replay(['--dry-run'], recording);

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('CONFIG.LOCKFILE_NOT_MIGRATED');
      expect(errors[0].message).toContain(userPaths.userLockfile);
      expect(recording.writes).toEqual([]);
      await expect(readFile(userPaths.userLockfile, 'utf8')).resolves.toBe(before);
      expect(await exists(userPaths.userLocalLockfile)).toBe(false);
    });

    it('migrates the user lockfile on a non-dry-run replay of it, then replays the migrated entry', async () => {
      const userPaths = resolveUserConfigPaths(env);
      let legacy = emptyLockfile('ai-primitives-hub-cli');
      legacy = upsertBundleEntry(legacy, 'local-foo', {
        version: '1.0.0',
        sourceId: 'local-bundle',
        sourceType: 'local',
        installedAt: '2026-01-01T00:00:00.000Z',
        files: []
      });
      legacy = upsertSource(legacy, 'local-bundle', { type: 'local', url: bundleDir });
      await mkdir(path.dirname(userPaths.userLockfile), { recursive: true });
      await writeLockfile(userPaths.userLockfile, legacy, new NodeFileSystem());

      const result = await replay();

      expect(result.exitCode).toBe(0);
      const { data } = parse<ReplayData>(result.stdout);
      expect(data.migration).not.toBeNull();
      expect(data.replayed).toEqual(['local-bundle/local-foo']);
      expect((await readDesired()).bundles['local-bundle/local-foo'].version).toBe('1.0.0');
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    // A foreign file that would, if replayed, overwrite the descriptor of the user pair's source.
    const writeForeign = async (file: string, format: 'v2' | 'v3'): Promise<void> => {
      const sourceId = `local-${path.basename(bundleDir)}`;
      const elsewhere = path.join(workspace, 'elsewhere');
      await mkdir(path.dirname(file), { recursive: true });
      if (format === 'v3') {
        await writeFile(file, JSON.stringify({
          version: '3.0.0',
          bundles: { [`${sourceId}/local-foo`]: { version: '1.0.0', sourceId } },
          sources: { [sourceId]: { type: 'local', url: elsewhere } }
        }, null, 2));
        return;
      }
      let legacy = emptyLockfile('ai-primitives-hub-cli');
      legacy = upsertBundleEntry(legacy, 'local-foo', {
        version: '1.0.0',
        sourceId,
        sourceType: 'local',
        installedAt: '2026-01-01T00:00:00.000Z',
        files: []
      });
      legacy = upsertSource(legacy, sourceId, { type: 'local', url: elsewhere });
      await writeLockfile(file, legacy, new NodeFileSystem());
    };
    const expectRefusedUntouched = async (
      result: Awaited<ReturnType<typeof runCommand>>,
      recording: RecordingFs,
      foreign: string,
      userBefore: string
    ): Promise<void> => {
      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(errors[0].message).toContain(foreign);
      expect(errors[0].message).toContain('slice 3');
      expect(JSON.stringify(errors[0])).toContain('Unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY');
      expect(recording.writes).toEqual([]);
      expect(recording.contentReads).not.toContain(foreign);
      await expect(readFile(lockfilePath(), 'utf8')).resolves.toBe(userBefore);
      expect(await exists(destination())).toBe(false);
    };

    it.each(['v2', 'v3'] as const)('refuses an explicit %s lockfile other than the user lockfile without reading or writing anything', async (format) => {
      await installOnce();
      await rm(destination());
      const foreign = path.join(workspace, 'foreign.lock.json');
      await writeForeign(foreign, format);
      const userBefore = await readFile(lockfilePath(), 'utf8');
      const recording = new RecordingFs();

      const result = await replay([], recording, foreign);

      await expectRefusedUntouched(result, recording, foreign, userBefore);
      expect(recording.reads).not.toContain(foreign);
    });

    it.each(['prompt-registry.lock.json', 'prompt-registry.local.lock.json'])('refuses a bare install whose detection selects the project v2 %s, without reading it', async (name) => {
      await installOnce();
      await rm(destination());
      const foreign = path.join(workspace, name);
      await writeForeign(foreign, 'v2');
      const userBefore = await readFile(lockfilePath(), 'utf8');
      const recording = new RecordingFs();

      const result = await run(['install', '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      // Detection only probes for the file's existence; its contents are never read.
      await expectRefusedUntouched(result, recording, foreign, userBefore);
    });

    it('ignores a project ai-primitives-hub.lock.json in detection and replays the user lockfile instead', async () => {
      await installOnce();
      await rm(destination());
      const foreign = path.join(workspace, 'ai-primitives-hub.lock.json');
      await writeForeign(foreign, 'v3');
      const recording = new RecordingFs();

      const result = await run(['install', '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expect(result.exitCode).toBe(0);
      expect(parse<ReplayData>(result.stdout).data.lockfile).toBe(lockfilePath());
      expect(recording.reads).not.toContain(foreign);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('with no user lockfile, a bare install ignores a project ai-primitives-hub.lock.json and asks for a mode', async () => {
      const foreign = path.join(workspace, 'ai-primitives-hub.lock.json');
      await writeForeign(foreign, 'v3');
      const recording = new RecordingFs();

      const result = await run(['install', '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expect(result.exitCode).toBe(1);
      expect(parse<null>(result.stdout).errors[0].code).toBe('USAGE.MISSING_FLAG');
      expect(recording.reads).not.toContain(foreign);
      expect(recording.writes).toEqual([]);
    });

    it('replays the user lockfile on a bare install when only the user lockfile exists', async () => {
      await installOnce();
      await rm(destination());

      const result = await run(['install', '--target', 'my-vscode', '-o', 'json'], flagOn);

      expect(result.exitCode).toBe(0);
      const { data } = parse<ReplayData>(result.stdout);
      expect(data.lockfile).toBe(lockfilePath());
      expect(data.replayed).toEqual([replayKey()]);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('accepts a /./ spelling and a relative spelling of the user lockfile', async () => {
      await installOnce();
      const spellings = [
        `${path.dirname(lockfilePath())}${path.sep}.${path.sep}${path.basename(lockfilePath())}`,
        path.relative(workspace, lockfilePath())
      ];

      for (const spelling of spellings) {
        await rm(destination(), { force: true });
        const result = await replay([], new NodeFileSystem(), spelling);

        expect(result.exitCode, spelling).toBe(0);
        expect(parse<ReplayData>(result.stdout).data.replayed).toEqual([replayKey()]);
        await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
      }
    });

    it('migrates a v2 user lockfile named with a /./ spelling, as it does the plain spelling', async () => {
      const userPaths = resolveUserConfigPaths(env);
      let legacy = emptyLockfile('ai-primitives-hub-cli');
      legacy = upsertBundleEntry(legacy, 'local-foo', {
        version: '1.0.0',
        sourceId: 'local-bundle',
        sourceType: 'local',
        installedAt: '2026-01-01T00:00:00.000Z',
        files: []
      });
      legacy = upsertSource(legacy, 'local-bundle', { type: 'local', url: bundleDir });
      await mkdir(path.dirname(userPaths.userLockfile), { recursive: true });
      await writeLockfile(userPaths.userLockfile, legacy, new NodeFileSystem());
      const spelling = `${path.dirname(userPaths.userLockfile)}${path.sep}.${path.sep}${path.basename(userPaths.userLockfile)}`;

      const result = await replay([], new NodeFileSystem(), spelling);

      expect(result.exitCode).toBe(0);
      expect(parse<ReplayData>(result.stdout).data.migration).not.toBeNull();
      expect((await readDesired()).bundles['local-bundle/local-foo'].version).toBe('1.0.0');
    });

    it('refuses a symlink alias of the user lockfile (aliases are not followed)', async () => {
      await installOnce();
      await rm(destination());
      const alias = path.join(workspace, 'alias.lock.json');
      await symlink(lockfilePath(), alias);
      const userBefore = await readFile(lockfilePath(), 'utf8');
      const recording = new RecordingFs();

      const result = await replay([], recording, alias);

      await expectRefusedUntouched(result, recording, alias, userBefore);
    });

    it.each(['repository', 'workspace', 'bogus'])('refuses scope "%s" with BUNDLE.UNSUPPORTED_SCOPE before reading or writing anything', async (scope) => {
      await installOnce();
      await rm(destination());
      const userPaths = resolveUserConfigPaths(env);
      const before = await readFile(userPaths.userLockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await replay(['--scope', scope], recording);

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(errors[0].message).toContain(`scope "${scope}"`);
      expect(recording.writes).toEqual([]);
      expect(recording.reads.filter((p) => p.startsWith(bundleDir)
        || p === userPaths.userLockfile || p === userPaths.userLocalLockfile)).toEqual([]);
      await expect(readFile(userPaths.userLockfile, 'utf8')).resolves.toBe(before);
      expect(await exists(destination())).toBe(false);
    });

    it('fails closed, naming the key and version, when a pinned version is absent from the source', async () => {
      await installOnce();
      await editDesired((desired) => {
        desired.bundles[replayKey()].version = '9.9.9';
      });
      await rm(destination());
      const before = await readFile(lockfilePath(), 'utf8');

      const result = await replay();

      expect(result.exitCode).toBe(1);
      const envelope = parse<ReplayData>(result.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data.replayed).toEqual([]);
      expect(envelope.data.failures).toHaveLength(1);
      expect(envelope.data.failures[0].key).toBe(replayKey());
      expect(envelope.data.failures[0].reason).toContain('9.9.9');
      expect(envelope.warnings.join('\n')).toContain('9.9.9');
      expect(await exists(destination())).toBe(false);
      await expect(readFile(lockfilePath(), 'utf8')).resolves.toBe(before);
    });

    it('--dry-run reports the missing pin as a failure and exits 1', async () => {
      await installOnce();
      await editDesired((desired) => {
        desired.bundles[replayKey()].version = '9.9.9';
      });
      await rm(destination());
      const recording = new RecordingFs();

      const result = await replay(['--dry-run'], recording);

      expect(result.exitCode).toBe(1);
      const { data } = parse<DryRunReplayData>(result.stdout);
      expect(data.wouldReplay).toEqual([]);
      expect(data.failures).toHaveLength(1);
      expect(data.failures[0].key).toBe(replayKey());
      expect(data.failures[0].reason).toContain('9.9.9');
      expect(recording.writes).toEqual([]);
    });

    it('fails an entry whose source has no descriptor, still replays the others, and exits 1', async () => {
      await installOnce();
      await editDesired((desired) => {
        desired.bundles = { 'ghost-source/ghost': { version: '1.0.0', sourceId: 'ghost-source' }, ...desired.bundles };
      });
      await rm(destination());

      const result = await replay();

      expect(result.exitCode).toBe(1);
      const { data } = parse<ReplayData>(result.stdout);
      expect(data.replayPlanned).toBe(2);
      expect(data.replayed).toEqual([replayKey()]);
      expect(data.failures).toHaveLength(1);
      expect(data.failures[0].key).toBe('ghost-source/ghost');
      expect(data.failures[0].reason).toContain('ghost-source');
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
      expect(Object.keys((await readDesired()).sources)).not.toContain('ghost-source');
    });

    it('reports an unrecognized AI_PRIMITIVES_HUB_UNIFIED_DEPLOY value as USAGE.INVALID_FLAG', async () => {
      const result = await run(['install', '--lockfile', lockfilePath(), '--target', 'my-vscode', '-o', 'json'], {
        AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: 'maybe'
      });

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('USAGE.INVALID_FLAG');
      expect(errors[0].message).toContain('AI_PRIMITIVES_HUB_UNIFIED_DEPLOY');
    });

    it('fails an entry whose key names a different source than its sourceId', async () => {
      await installOnce();
      await editDesired((desired) => {
        desired.sources['some-other-source'] = desired.sources[desired.bundles[replayKey()].sourceId];
        desired.bundles[replayKey()].sourceId = 'some-other-source';
      });
      await rm(destination());

      const result = await replay();

      expect(result.exitCode).toBe(1);
      const { data } = parse<ReplayData>(result.stdout);
      expect(data.replayed).toEqual([]);
      expect(data.failures[0].key).toBe(replayKey());
      expect(data.failures[0].reason).toContain('some-other-source');
      expect(await exists(destination())).toBe(false);
    });
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

    const runRemote = async (
      argv: string[],
      fs: NodeFileSystem = new NodeFileSystem(),
      flag: Record<string, string> = flagOn
    ): Promise<{ exitCode: number; stdout: string }> => {
      const ctx = createTestContext({ cwd: workspace, fs, env: { ...env, ...flag } });
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

    it('flag-off remote install over 3.0.0 state fails loudly before writing any bundle file', async () => {
      const installArgv = ['install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '-o', 'json'];
      expect((await runRemote(installArgv)).exitCode).toBe(0);
      const userPaths = resolveUserConfigPaths(env);
      const before = [
        await readFile(userPaths.userLockfile, 'utf8'),
        await readFile(userPaths.userLocalLockfile, 'utf8')
      ];
      // Drop the bundle's file so a flag-off install has something visible to write.
      await rm(destination());
      const recording = new RecordingFs();

      const result = await runRemote(installArgv, recording, {});

      expect(result.exitCode).not.toBe(0);
      expect(parse<null>(result.stdout).errors[0].message).toMatch(/newer version of AI Primitives Hub/);
      expect(recording.writes).toEqual([]);
      expect(await exists(destination())).toBe(false);
      expect([
        await readFile(userPaths.userLockfile, 'utf8'),
        await readFile(userPaths.userLocalLockfile, 'utf8')
      ]).toEqual(before);
    });

    it('records github.com as the source URL when no source is configured', async () => {
      const result = await runRemote(['install', remoteBundleId, '--source', 'owner/repo', '--target', 'my-vscode', '-o', 'json']);

      expect(result.exitCode).toBe(0);
      const desired = JSON.parse(await readFile(resolveUserConfigPaths(env).userLockfile, 'utf8')) as {
        sources: Record<string, unknown>;
      };
      expect(Object.values(desired.sources)).toEqual([{ type: 'github', url: 'https://github.com/owner/repo' }]);
      expect(parse<{ source: Record<string, unknown> }>(result.stdout).data.source).not.toHaveProperty('collectionsPath');
    });

    describe('lockfile replay', () => {
      const sourceId = 'gh-source';
      const key = `${sourceId}/${remoteBundleId}`;
      const writeDesired = async (version: string): Promise<void> => {
        const file = resolveUserConfigPaths(env).userLockfile;
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({
          version: '3.0.0',
          bundles: { [key]: { version, sourceId } },
          sources: { [sourceId]: { type: 'github', url: 'https://github.com/owner/repo' } }
        }, null, 2));
      };
      const replayRemote = async (fs: NodeFileSystem): Promise<{ exitCode: number; stdout: string }> =>
        await runRemote(['install', '--lockfile', resolveUserConfigPaths(env).userLockfile, '--target', 'my-vscode', '-o', 'json'], fs);

      it('fetches the recorded source descriptor at the pinned version and deploys it', async () => {
        await writeDesired('1.0.0');

        const result = await replayRemote(new NodeFileSystem());

        expect(result.exitCode).toBe(0);
        const { data } = parse<{ replayed: string[]; failures: unknown[] }>(result.stdout);
        expect(data.replayed).toEqual([key]);
        expect(data.failures).toEqual([]);
        expect(httpCalls).toContain('https://api.github.com/repos/owner/repo/releases');
        await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
      });

      it('replays a recorded github descriptor despite an awesome-copilot sourceId prefix', async () => {
        await writeDesired('1.0.0');
        const file = resolveUserConfigPaths(env).userLockfile;
        const misleading = 'awesome-copilot-misleading';
        const desired = JSON.parse(await readFile(file, 'utf8')) as {
          bundles: Record<string, { version: string; sourceId: string }>;
          sources: Record<string, { type: string; url: string }>;
        };
        desired.bundles = { [`${misleading}/${remoteBundleId}`]: { version: '1.0.0', sourceId: misleading } };
        desired.sources = { [misleading]: { type: 'github', url: 'https://github.com/owner/repo' } };
        await writeFile(file, JSON.stringify(desired));
        const result = await replayRemote(new NodeFileSystem());
        expect(result.exitCode).toBe(0);
        expect(parse<{ replayed: string[] }>(result.stdout).data.replayed).toEqual([`${misleading}/${remoteBundleId}`]);
        expect(httpCalls).toContain('https://api.github.com/repos/owner/repo/releases');
        expect(httpCalls.some((url) => url.includes('/contents/'))).toBe(false);
        expect(await readFile(destination(), 'utf8')).toContain('Hello Prompt');
      });

      it('fails closed when the pinned version is not a release, and never downloads the latest instead', async () => {
        await writeDesired('9.9.9');
        const recording = new RecordingFs();

        const result = await replayRemote(recording);

        expect(result.exitCode).toBe(1);
        const { data } = parse<{ replayed: string[]; failures: { key: string; reason: string }[] }>(result.stdout);
        expect(data.replayed).toEqual([]);
        expect(data.failures).toHaveLength(1);
        expect(data.failures[0].key).toBe(key);
        expect(data.failures[0].reason).toContain('9.9.9');
        expect(httpCalls).not.toContain('https://api.github.com/assets/remote-foo');
        expect(recording.writes).toEqual([]);
        expect(await exists(destination())).toBe(false);
      });
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
      expect(parse<{ source: { collectionsPath?: string; url: string } }>(ctx.stdout.captured()).data.source)
        .toMatchObject({ collectionsPath: 'collections', url: source.url });
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
