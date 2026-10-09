/**
 * Flag-on (`AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`) `uninstall` integration tests, user scope.
 *
 * Real `NodeFileSystem` against a temp workspace, with a prior flag-on `install`
 * writing the state the uninstall then reverses. This lives apart from
 * `uninstall.test.ts` for the same reason `install-unified.test.ts` lives apart
 * from `install.test.ts`: the legacy file runs with the flag unset and a
 * copilot-cli target; this one needs the recording filesystem and the vscode
 * target the unified install tests use. v3 lockfiles are hand-written only for
 * states no install produces (unmanaged records under a real target, two
 * sources offering one manifest id, an interrupted migration).
 */
import {
  mkdir,
  mkdtemp,
  readdir,
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
  UninstallCommand,
} from '../../src/commands/uninstall';
import {
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
  errors: { code: string; message: string; hint?: string }[];
  warnings: string[];
}

interface MigrationData {
  migrated: string[];
  unmanaged: { key: string; reason: string }[];
}

interface UninstallData {
  target: string;
  bundle: string;
  key: string;
  removed: string[];
  skipped: string[];
  lockfile: string;
  unmanagedReason?: string;
  migration?: MigrationData;
}

interface UninstallAllData {
  target: string;
  uninstalled: number;
  bundles: { id: string; removed: number; skipped: number; unmanagedReason?: string }[];
  migration?: MigrationData;
}

interface V3Record {
  version: string;
  sourceId: string;
  installedAt: string;
  state?: 'unmanaged';
  unmanagedReason?: string;
  files: { path: string }[];
}

interface LocalFile {
  targets: Record<string, { baseDir: string; bundles: Record<string, V3Record> }>;
}

interface DesiredFile {
  bundles: Record<string, { version: string; sourceId: string }>;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const listTree = async (dir: string): Promise<string[]> => {
  if (!await exists(dir)) {
    return [];
  }
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
};

describe('uninstall command (AI_PRIMITIVES_HUB_UNIFIED_DEPLOY on, user scope)', () => {
  let workspace: string;
  let bundleDir: string;
  let env: Record<string, string>;

  const flagOn = { AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' };
  const run = (
    argv: string[],
    overrides: Record<string, string> = flagOn,
    fs: NodeFileSystem = new NodeFileSystem()
  ): ReturnType<typeof runCommand> => runCommand(argv, {
    commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand],
    context: { cwd: workspace, fs, env: { ...env, ...overrides } }
  });
  const parse = <T>(stdout: string): JsonEnvelope<T> => JSON.parse(stdout) as JsonEnvelope<T>;
  const paths = (): ReturnType<typeof resolveUserConfigPaths> => resolveUserConfigPaths(env);
  const copilotDir = (): string => path.join(workspace, '.copilot');
  const destination = (): string => path.join(copilotDir(), 'prompts', 'hello.prompt.md');
  const installedKey = (): string => `local-${path.basename(bundleDir)}/local-foo`;
  const uninstall = (extra: string[], fs?: NodeFileSystem): ReturnType<typeof runCommand> =>
    run(['uninstall', '--target', 'my-vscode', ...extra, '-o', 'json'], flagOn, fs);
  const install = async (): Promise<string[]> => {
    const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'my-vscode', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    return parse<{ written: string[] }>(result.stdout).data.written;
  };
  const makeBundle = async (id: string): Promise<string> => {
    const dir = path.join(workspace, `src-${id}`);
    await mkdir(path.join(dir, 'prompts'), { recursive: true });
    await writeFile(
      path.join(dir, 'deployment-manifest.yml'),
      `id: ${id}\nversion: 1.0.0\nname: ${id}\nprompts:\n  - id: ${id}\n    file: prompts/${id}.prompt.md\n    type: prompt\n`
    );
    await writeFile(path.join(dir, 'prompts', `${id}.prompt.md`), `# ${id}\n`);
    return dir;
  };
  // Installs a one-file bundle with its own destination, so several can coexist in one target.
  const installBundle = async (id: string): Promise<{ key: string; file: string }> => {
    const result = await run(['install', id, '--from', await makeBundle(id), '--target', 'my-vscode', '-o', 'json']);
    expect(result.exitCode).toBe(0);
    return { key: `local-src-${id}/${id}`, file: path.join(copilotDir(), 'prompts', `${id}.prompt.md`) };
  };
  const readLocal = async (): Promise<LocalFile> => JSON.parse(await readFile(paths().userLocalLockfile, 'utf8')) as LocalFile;
  const readDesired = async (): Promise<DesiredFile> => JSON.parse(await readFile(paths().userLockfile, 'utf8')) as DesiredFile;
  const lockfileBytes = async (): Promise<(string | null)[]> => Promise.all(
    [paths().userLockfile, paths().userLocalLockfile].map(async (file) => await exists(file) ? await readFile(file, 'utf8') : null)
  );

  const record = (over: Partial<V3Record> & Pick<V3Record, 'sourceId' | 'files'>): V3Record => ({
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    ...over
  });
  // Hand-written v3 pair, for states no install produces.
  const writeV3 = async (
    bundles: Record<string, V3Record>,
    baseDir: string = path.join(workspace, 'managed')
  ): Promise<void> => {
    await mkdir(path.dirname(paths().userLockfile), { recursive: true });
    await writeFile(paths().userLockfile, JSON.stringify({
      version: '3.0.0',
      bundles: Object.fromEntries(Object.entries(bundles).map(([key, rec]) => [key, { version: rec.version, sourceId: rec.sourceId }])),
      sources: Object.fromEntries(Object.values(bundles).map((rec) => [rec.sourceId, { type: 'local', url: workspace }]))
    }, null, 2));
    await writeFile(paths().userLocalLockfile, JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generatedBy: 'test',
      migration: { lockfileV3: 'complete' },
      targets: { 'my-vscode': { targetType: 'vscode', scope: 'user', baseDir, bundles } }
    }, null, 2));
  };
  const writeManaged = async (...relative: string[]): Promise<string[]> => {
    const files = relative.map((rel) => path.join(workspace, 'managed', rel));
    for (const file of files) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `# ${path.basename(file)}\n`);
    }
    return files;
  };
  const seedV2 = async (bundleId: string, files: { path: string; checksum: string }[]): Promise<void> => {
    let legacy = emptyLockfile('ai-primitives-hub-cli');
    legacy = upsertBundleEntry(legacy, bundleId, {
      version: '1.0.0',
      sourceId: 'legacy-source',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      files
    });
    legacy = upsertSource(legacy, 'legacy-source', { type: 'github', url: 'https://github.com/o/r' });
    await mkdir(path.dirname(paths().userLockfile), { recursive: true });
    await writeLockfile(paths().userLockfile, legacy, new NodeFileSystem());
  };

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'cli-uninstall-unified-test-'));
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

  describe('--bundle', () => {
    it('removes exactly the files the flag-on install wrote, and drops both lockfile entries', async () => {
      const written = await install();
      expect(await listTree(copilotDir())).not.toEqual([]);

      const result = await uninstall(['--bundle', 'local-foo']);

      expect(result.exitCode).toBe(0);
      const envelope = parse<UninstallData>(result.stdout);
      expect(envelope.status).toBe('ok');
      expect(envelope.data.removed).toEqual(written);
      expect(envelope.data.skipped).toEqual([]);
      expect(await listTree(copilotDir())).toEqual([]);
      expect((await readLocal()).targets['my-vscode']?.bundles ?? {}).toEqual({});
      expect((await readDesired()).bundles).toEqual({});
    });

    it('accepts a bare bundle id and resolves it to the logical key, echoing the id the user typed', async () => {
      await install();

      const result = await uninstall(['--bundle', 'local-foo']);

      const { data } = parse<UninstallData>(result.stdout);
      expect(data.bundle).toBe('local-foo');
      expect(data.key).toBe(installedKey());
      expect(data.target).toBe('my-vscode');
      expect(data.lockfile).toBe(paths().userLockfile);
    });

    it('accepts the full sourceId/bundleId key', async () => {
      await install();

      const result = await uninstall(['--bundle', installedKey()]);

      expect(result.exitCode).toBe(0);
      const { data } = parse<UninstallData>(result.stdout);
      expect(data.bundle).toBe(installedKey());
      expect(data.removed).toEqual([destination()]);
      expect(await listTree(copilotDir())).toEqual([]);
    });

    it('says what it removed and which lockfile it updated in text mode', async () => {
      await install();

      const result = await run(['uninstall', '--bundle', 'local-foo', '--target', 'my-vscode']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Uninstalled local-foo from target "my-vscode"');
      expect(result.stdout).toContain('1 file removed');
      expect(result.stdout).toContain(`Updated ${paths().userLockfile}.`);
    });

    it('leaves a hand-written neighbour file alone', async () => {
      await install();
      const mine = path.join(copilotDir(), 'prompts', 'mine.prompt.md');
      await writeFile(mine, '# mine\n');

      await uninstall(['--bundle', 'local-foo']);

      await expect(readFile(mine, 'utf8')).resolves.toBe('# mine\n');
      expect(await exists(destination())).toBe(false);
    });

    it('warns rather than failing for a bundle that was never installed, and creates no lockfile', async () => {
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'absent'], recording);

      expect(result.exitCode).toBe(0);
      const envelope = parse<{ bundle: string; reason: string }>(result.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data.bundle).toBe('absent');
      expect(envelope.data.reason).toBe('not found in lockfile');
      expect(recording.writes).toEqual([]);
      expect(await exists(paths().userLockfile)).toBe(false);
      expect(await exists(paths().userLocalLockfile)).toBe(false);
    });

    it('says the bundle is not installed in text mode', async () => {
      const result = await run(['uninstall', '--bundle', 'absent', '--target', 'my-vscode']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Bundle "absent" is not installed in target "my-vscode". Nothing to uninstall.');
    });

    it('leaves the lockfiles and files untouched when another bundle is installed but not the one named', async () => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'absent'], recording);

      expect(result.exitCode).toBe(0);
      expect(parse<unknown>(result.stdout).status).toBe('warning');
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('does not treat a record under a different target as installed in this one', async () => {
      await install();
      expect((await run(['target', 'add', 'other', '--type', 'vscode', '-o', 'json'])).exitCode).toBe(0);
      const before = await lockfileBytes();

      const result = await run(['uninstall', '--bundle', 'local-foo', '--target', 'other', '-o', 'json']);

      expect(result.exitCode).toBe(0);
      expect(parse<unknown>(result.stdout).status).toBe('warning');
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('refuses an id offered by two sources, naming both keys, and changes nothing', async () => {
      const [fileA, fileB] = await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      await writeV3({
        'src-a/local-foo': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-b/local-foo': record({ sourceId: 'src-b', files: [{ path: 'prompts/b.prompt.md' }] })
      });
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo'], recording);

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.AMBIGUOUS_ID');
      expect(errors[0].message).toContain('src-a/local-foo');
      expect(errors[0].message).toContain('src-b/local-foo');
      expect(errors[0].hint).toContain('sourceId/bundleId');
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      expect(await exists(fileA)).toBe(true);
      expect(await exists(fileB)).toBe(true);
    });

    it('removes only the named source\'s files when the full key disambiguates', async () => {
      const [fileA, fileB] = await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      await writeV3({
        'src-a/local-foo': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-b/local-foo': record({ sourceId: 'src-b', files: [{ path: 'prompts/b.prompt.md' }] })
      });

      const result = await uninstall(['--bundle', 'src-b/local-foo']);

      expect(result.exitCode).toBe(0);
      expect(parse<UninstallData>(result.stdout).data.removed).toEqual([fileB]);
      expect(await exists(fileA)).toBe(true);
      expect(await exists(fileB)).toBe(false);
      expect(Object.keys((await readLocal()).targets['my-vscode'].bundles)).toEqual(['src-a/local-foo']);
      expect(Object.keys((await readDesired()).bundles)).toEqual(['src-a/local-foo']);
    });

    it('leaves the files of an unmanaged record in place, drops the record, and says why in JSON and text', async () => {
      const [kept] = await writeManaged('prompts/kept.prompt.md');
      const reason = 'destination could not be proven from bundle-relative path';
      await writeV3({
        'src-a/local-foo': record({
          sourceId: 'src-a',
          state: 'unmanaged',
          unmanagedReason: reason,
          files: [{ path: 'prompts/kept.prompt.md' }]
        })
      });

      const json = await uninstall(['--bundle', 'local-foo']);

      expect(json.exitCode).toBe(0);
      const envelope = parse<UninstallData>(json.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data.removed).toEqual([]);
      expect(envelope.data.skipped).toEqual([kept]);
      expect(envelope.data.unmanagedReason).toBe(reason);
      await expect(readFile(kept, 'utf8')).resolves.toContain('kept.prompt.md');
      expect((await readLocal()).targets['my-vscode']?.bundles ?? {}).toEqual({});

      await writeV3({
        'src-a/local-foo': record({
          sourceId: 'src-a',
          state: 'unmanaged',
          unmanagedReason: reason,
          files: [{ path: 'prompts/kept.prompt.md' }]
        })
      });
      const text = await run(['uninstall', '--bundle', 'local-foo', '--target', 'my-vscode']);

      expect(text.exitCode).toBe(0);
      expect(text.stdout).toContain(reason);
      expect(text.stdout).toContain('left in place');
      await expect(readFile(kept, 'utf8')).resolves.toContain('kept.prompt.md');
    });

    it('does not remove a recorded path that escapes the target base directory', async () => {
      const outside = path.join(workspace, 'outside.md');
      await writeFile(outside, '# outside\n');
      await mkdir(path.join(workspace, 'managed'), { recursive: true });
      await writeV3({
        'src-a/local-foo': record({ sourceId: 'src-a', files: [{ path: '../outside.md' }] })
      });

      const result = await uninstall(['--bundle', 'local-foo']);

      expect(result.exitCode).toBe(0);
      const { data } = parse<UninstallData>(result.stdout);
      expect(data.removed).toEqual([]);
      expect(data.skipped).toEqual([outside]);
      await expect(readFile(outside, 'utf8')).resolves.toBe('# outside\n');
    });

    it('reads a target with no scope as user', async () => {
      await install();
      const added = await run(['target', 'add', 'scopeless', '--type', 'vscode', '-o', 'json']);
      const { file } = parse<{ file: string }>(added.stdout).data;
      const text = await readFile(file, 'utf8');
      await writeFile(file, text.replaceAll(/^\s*scope: .*\n/gm, ''));
      const result = await run(['install', 'local-foo', '--from', bundleDir, '--target', 'scopeless', '-o', 'json']);
      expect(result.exitCode).toBe(0);

      const removed = await run(['uninstall', '--bundle', 'local-foo', '--target', 'scopeless', '-o', 'json']);

      expect(removed.exitCode).toBe(0);
      expect(parse<UninstallData>(removed.stdout).data.key).toBe(installedKey());
    });

    it.each(['constructor', 'toString', '__proto__'])('reports "%s", which no bundle is named, as not installed without touching the store', async (typed) => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', typed], recording);

      expect(result.exitCode).toBe(0);
      const envelope = parse<{ bundle: string; reason: string }>(result.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data).toMatchObject({ bundle: typed, reason: 'not found in lockfile' });
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('uninstalls a bundle whose id is "constructor", by bare id and by full key', async () => {
      const first = await installBundle('constructor');
      expect(await exists(first.file)).toBe(true);

      const bare = await uninstall(['--bundle', 'constructor']);

      expect(bare.exitCode).toBe(0);
      expect(parse<UninstallData>(bare.stdout).data).toMatchObject({ key: first.key, removed: [first.file] });
      expect(await exists(first.file)).toBe(false);

      await installBundle('constructor');
      const full = await uninstall(['--bundle', first.key]);

      expect(full.exitCode).toBe(0);
      expect(parse<UninstallData>(full.stdout).data.key).toBe(first.key);
      expect(await exists(first.file)).toBe(false);
    });

    it('converges on retry after the desired write failed behind a successful local write', async () => {
      await install();
      const recording = new RecordingFs();
      recording.failOnce('rename', (to) => to === paths().userLockfile, new Error('ENOSPC: simulated desired write failure'));

      const failed = await uninstall(['--bundle', 'local-foo'], recording);

      expect(failed.exitCode).not.toBe(0);
      // The injection fired on the intended write: files and the local record are gone, desired still names the bundle.
      expect(await exists(destination())).toBe(false);
      expect((await readLocal()).targets['my-vscode']).toBeUndefined();
      expect(Object.keys((await readDesired()).bundles)).toEqual([installedKey()]);

      const retry = await uninstall(['--bundle', 'local-foo']);

      expect(retry.exitCode).toBe(0);
      expect(parse<UninstallData>(retry.stdout).data).toMatchObject({ key: installedKey(), removed: [], skipped: [] });
      expect((await readDesired()).bundles).toEqual({});
    });
  });

  describe('--dry-run', () => {
    it('lists the files it would remove and writes nothing', async () => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo', '--dry-run'], recording);

      expect(result.exitCode).toBe(0);
      const { data } = parse<{ dryRun: boolean; bundle: string; key: string; files: string[] }>(result.stdout);
      expect(data.dryRun).toBe(true);
      expect(data.key).toBe(installedKey());
      expect(data.files).toEqual([path.join('prompts', 'hello.prompt.md')]);
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('lists nothing to remove, and the reason, for an unmanaged record', async () => {
      const reason = 'destination could not be proven from bundle-relative path';
      await writeManaged('prompts/kept.prompt.md');
      await writeV3({
        'src-a/local-foo': record({
          sourceId: 'src-a',
          state: 'unmanaged',
          unmanagedReason: reason,
          files: [{ path: 'prompts/kept.prompt.md' }]
        })
      });
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo', '--dry-run'], recording);

      const { data } = parse<{ files: string[]; unmanagedReason: string }>(result.stdout);
      expect(data.files).toEqual([]);
      expect(data.unmanagedReason).toBe(reason);
      expect(recording.writes).toEqual([]);
    });

    it('over a v2 lockfile previews without migrating: nothing to uninstall is reported and nothing is written', async () => {
      await seedV2('local-foo', []);
      const before = await readFile(paths().userLockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo', '--dry-run'], recording);

      expect(result.exitCode).toBe(0);
      expect(parse<unknown>(result.stdout).status).toBe('warning');
      expect(recording.writes).toEqual([]);
      await expect(readFile(paths().userLockfile, 'utf8')).resolves.toBe(before);
      expect(await exists(paths().userLocalLockfile)).toBe(false);
    });

    it('names the orphaned desired entry it would drop after an interrupted uninstall', async () => {
      await install();
      const desiredBytes = await readFile(paths().userLockfile, 'utf8');
      const local = await readLocal();
      local.targets = {};
      await writeFile(paths().userLocalLockfile, JSON.stringify(local, null, 2));
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo', '--dry-run'], recording);

      expect(result.exitCode).toBe(0);
      const { data } = parse<{ key: string; files: string[]; orphaned: boolean }>(result.stdout);
      expect(data).toMatchObject({ key: installedKey(), files: [], orphaned: true });
      expect(recording.writes).toEqual([]);
      await expect(readFile(paths().userLockfile, 'utf8')).resolves.toBe(desiredBytes);
    });

    it('--all lists the managed files and the unmanaged records it would leave, and writes nothing', async () => {
      const reason = 'unrecoverable source descriptor';
      await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      await writeV3({
        'src-a/managed-one': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-a/legacy-one': record({
          sourceId: 'src-a',
          state: 'unmanaged',
          unmanagedReason: reason,
          files: [{ path: 'prompts/b.prompt.md' }]
        })
      });
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--all', '--dry-run'], recording);

      expect(result.exitCode).toBe(0);
      const { data } = parse<{
        dryRun: boolean;
        bundles: string[];
        files: string[];
        unmanaged: { key: string; reason: string }[];
      }>(result.stdout);
      expect(data.dryRun).toBe(true);
      expect(data.bundles).toEqual(['src-a/managed-one', 'src-a/legacy-one']);
      expect(data.files).toEqual([path.join('prompts', 'a.prompt.md')]);
      expect(data.unmanaged).toEqual([{ key: 'src-a/legacy-one', reason }]);
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
    });
  });

  describe('--all', () => {
    // Three coexisting bundles in the target, plus a neighbour file and a record held by another target.
    const seedBulk = async (): Promise<{
      installed: { key: string; file: string }[];
      neighbour: string;
      otherFile: string;
    }> => {
      const installed = [await installBundle('alpha'), await installBundle('beta')];
      const neighbour = path.join(copilotDir(), 'prompts', 'mine.prompt.md');
      await writeFile(neighbour, '# mine\n');
      const otherFile = path.join(workspace, 'elsewhere', 'prompts', 'other.prompt.md');
      await mkdir(path.dirname(otherFile), { recursive: true });
      await writeFile(otherFile, '# other\n');
      const local = await readLocal();
      local.targets.elsewhere = {
        baseDir: path.join(workspace, 'elsewhere'),
        bundles: { 'src-x/other': record({ sourceId: 'src-x', files: [{ path: 'prompts/other.prompt.md' }] }) }
      };
      await writeFile(paths().userLocalLockfile, JSON.stringify(local, null, 2));
      return { installed, neighbour, otherFile };
    };

    it('removes every bundle the target holds and nothing else', async () => {
      const { installed, neighbour, otherFile } = await seedBulk();

      const result = await uninstall(['--all']);

      expect(result.exitCode).toBe(0);
      const { data } = parse<UninstallAllData>(result.stdout);
      expect(data.target).toBe('my-vscode');
      expect(data.uninstalled).toBe(2);
      expect(data.bundles).toEqual(installed.map((b) => ({ id: b.key, removed: 1, skipped: 0 })));
      for (const bundle of installed) {
        expect(await exists(bundle.file)).toBe(false);
      }
      await expect(readFile(neighbour, 'utf8')).resolves.toBe('# mine\n');
      await expect(readFile(otherFile, 'utf8')).resolves.toBe('# other\n');
      expect(Object.keys((await readLocal()).targets.elsewhere.bundles)).toEqual(['src-x/other']);
      expect(Object.keys((await readLocal()).targets['my-vscode']?.bundles ?? {})).toEqual([]);
    });

    it('says what it removed in text mode', async () => {
      await seedBulk();

      const result = await run(['uninstall', '--all', '--target', 'my-vscode']);

      expect(result.stdout).toContain('Uninstalled 2 bundles from target "my-vscode".');
    });

    it('reports the bundles removed so far, the failing key and its reason, exits non-zero, and leaves later bundles untouched', async () => {
      const alpha = await installBundle('alpha');
      const beta = await installBundle('beta');
      const gamma = await installBundle('gamma');
      const recording = new RecordingFs();
      recording.failOnce('remove', (file) => file === beta.file, new Error('EIO: simulated remove failure'));

      const result = await uninstall(['--all'], recording);

      expect(result.exitCode).toBe(1);
      const envelope = parse<UninstallAllData & { failure: { key: string; reason: string } }>(result.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data.uninstalled).toBe(1);
      expect(envelope.data.bundles).toEqual([{ id: alpha.key, removed: 1, skipped: 0 }]);
      expect(envelope.data.failure).toEqual({ key: beta.key, reason: 'EIO: simulated remove failure' });
      expect(envelope.warnings).toEqual([`${beta.key}: EIO: simulated remove failure`]);
      expect(await exists(alpha.file)).toBe(false);
      expect(await exists(beta.file)).toBe(true);
      expect(await exists(gamma.file)).toBe(true);
      expect(Object.keys((await readLocal()).targets['my-vscode'].bundles)).toEqual([beta.key, gamma.key]);

      const retry = await uninstall(['--all']);

      expect(retry.exitCode).toBe(0);
      expect(parse<UninstallAllData>(retry.stdout).data.uninstalled).toBe(2);
      expect(await listTree(copilotDir())).toEqual([]);
    });

    it('says in text mode which bundle failed, why, and how many later bundles were not attempted', async () => {
      const alpha = await installBundle('alpha');
      const beta = await installBundle('beta');
      await installBundle('gamma');
      const recording = new RecordingFs();
      recording.failOnce('remove', (file) => file === beta.file, new Error('EIO: simulated remove failure'));

      const result = await run(['uninstall', '--all', '--target', 'my-vscode'], flagOn, recording);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Uninstalled 1 bundle from target "my-vscode".');
      expect(result.stdout).toContain(`Failed on ${beta.key}: EIO: simulated remove failure. 1 later bundle not attempted.`);
      expect(await exists(alpha.file)).toBe(false);
    });

    it('reports an unmanaged record\'s reason per bundle, in JSON and in text, while removing the managed ones', async () => {
      const reason = 'unrecoverable source descriptor';
      const [managedFile, keptFile] = await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      const bundles = {
        'src-a/managed-one': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-a/legacy-one': record({
          sourceId: 'src-a',
          state: 'unmanaged',
          unmanagedReason: reason,
          files: [{ path: 'prompts/b.prompt.md' }]
        })
      };
      await writeV3(bundles);

      const json = await uninstall(['--all']);

      expect(json.exitCode).toBe(0);
      const { data } = parse<UninstallAllData>(json.stdout);
      expect(data.uninstalled).toBe(2);
      expect(data.bundles).toEqual([
        { id: 'src-a/managed-one', removed: 1, skipped: 0 },
        { id: 'src-a/legacy-one', removed: 0, skipped: 1, unmanagedReason: reason }
      ]);
      expect(await exists(managedFile)).toBe(false);
      expect(await exists(keptFile)).toBe(true);

      await writeManaged('prompts/a.prompt.md');
      await writeV3(bundles);
      const text = await run(['uninstall', '--all', '--target', 'my-vscode']);

      expect(text.stdout).toContain('src-a/legacy-one');
      expect(text.stdout).toContain(reason);
      expect(await exists(keptFile)).toBe(true);
    });

    it('is a no-op that creates no lockfile when nothing is installed', async () => {
      const recording = new RecordingFs();

      const result = await uninstall(['--all'], recording);

      expect(result.exitCode).toBe(0);
      expect(parse<{ uninstalled: number }>(result.stdout).data.uninstalled).toBe(0);
      expect(recording.writes).toEqual([]);
      expect(await exists(paths().userLockfile)).toBe(false);
      expect(await exists(paths().userLocalLockfile)).toBe(false);
    });
  });

  describe('v2 lockfile', () => {
    const reasonFragment = 'destination could not be proven from bundle-relative path';
    // An interrupted migration: v2 desired file plus a v3 local file without the completion marker.
    const seedInterruptedMigration = async (bundles: Record<string, V3Record>): Promise<void> => {
      await seedV2('older-bundle', []);
      await writeFile(paths().userLocalLockfile, JSON.stringify({
        version: '3.0.0',
        generatedAt: '2026-01-01T00:00:00.000Z',
        generatedBy: 'test',
        targets: {
          'my-vscode': {
            targetType: 'vscode',
            scope: 'user',
            baseDir: path.join(workspace, 'managed'),
            bundles
          }
        }
      }, null, 2));
    };

    it('leaves a v2-only store byte-identical, with nothing written, when the bundle is not installed in the target', async () => {
      await mkdir(path.dirname(destination()), { recursive: true });
      await writeFile(destination(), '# legacy\n');
      await seedV2('local-foo', [{ path: 'prompts/hello.prompt.md', checksum: 'sha256:abc' }]);
      const before = await readFile(paths().userLockfile, 'utf8');
      const recording = new RecordingFs();

      const json = await uninstall(['--bundle', 'local-foo'], recording);

      expect(json.exitCode).toBe(0);
      const envelope = parse<{ reason: string }>(json.stdout);
      expect(envelope.status).toBe('warning');
      expect(envelope.data.reason).toBe('not found in lockfile');
      expect(recording.writes).toEqual([]);
      await expect(readFile(paths().userLockfile, 'utf8')).resolves.toBe(before);
      expect(await exists(paths().userLocalLockfile)).toBe(false);
      await expect(readFile(destination(), 'utf8')).resolves.toBe('# legacy\n');
    });

    it('--all over a v2-only store removes nothing and writes nothing', async () => {
      await seedV2('local-foo', []);
      const before = await readFile(paths().userLockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await uninstall(['--all'], recording);

      expect(result.exitCode).toBe(0);
      expect(parse<UninstallAllData>(result.stdout).data.uninstalled).toBe(0);
      expect(recording.writes).toEqual([]);
      await expect(readFile(paths().userLockfile, 'utf8')).resolves.toBe(before);
      expect(await exists(paths().userLocalLockfile)).toBe(false);
    });

    it('refuses an id with two matching records without migrating the store', async () => {
      await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      await seedInterruptedMigration({
        'src-a/local-foo': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-b/local-foo': record({ sourceId: 'src-b', files: [{ path: 'prompts/b.prompt.md' }] })
      });
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo'], recording);

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.AMBIGUOUS_ID');
      expect(errors[0].message).toContain('src-a/local-foo');
      expect(errors[0].message).toContain('src-b/local-foo');
      expect(recording.writes).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
    });

    it('surfaces the migration, with its reasons, alongside a real removal when an interrupted migration resumes', async () => {
      const [file] = await writeManaged('prompts/a.prompt.md');
      await seedInterruptedMigration({
        'src-a/local-foo': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] })
      });

      const result = await uninstall(['--bundle', 'local-foo']);

      expect(result.exitCode).toBe(0);
      const { data } = parse<UninstallData>(result.stdout);
      expect(data.removed).toEqual([file]);
      expect(data.migration?.unmanaged).toHaveLength(1);
      expect(data.migration?.unmanaged[0].key).toBe('legacy-source/older-bundle');
      expect(data.migration?.unmanaged[0].reason).toBe(reasonFragment);
      expect(await exists(file)).toBe(false);
    });

    it('--all surfaces the migration reasons in JSON and in text when an interrupted migration resumes', async () => {
      const [fileA, fileB] = await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      const bundles = {
        'src-a/one': record({ sourceId: 'src-a', files: [{ path: 'prompts/a.prompt.md' }] }),
        'src-a/two': record({ sourceId: 'src-a', files: [{ path: 'prompts/b.prompt.md' }] })
      };
      await seedInterruptedMigration(bundles);

      const json = await uninstall(['--all']);

      expect(json.exitCode).toBe(0);
      const { data } = parse<UninstallAllData>(json.stdout);
      expect(data.uninstalled).toBe(2);
      expect(data.migration?.unmanaged).toEqual([{ key: 'legacy-source/older-bundle', reason: reasonFragment }]);
      expect(await exists(fileA)).toBe(false);
      expect(await exists(fileB)).toBe(false);

      await writeManaged('prompts/a.prompt.md', 'prompts/b.prompt.md');
      await rm(paths().userLockfile);
      await rm(paths().userLocalLockfile);
      await seedInterruptedMigration(bundles);
      const text = await run(['uninstall', '--all', '--target', 'my-vscode']);

      expect(text.exitCode).toBe(0);
      expect(text.stdout).toContain(`Left unmanaged: legacy-source/older-bundle (${reasonFragment}).`);
    });
  });

  describe('lockfile-driven uninstall', () => {
    const expectRefused = (
      result: Awaited<ReturnType<typeof runCommand>>,
      recording: RecordingFs,
      lockfile: string
    ): void => {
      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(errors[0].message).toContain('uninstall: lockfile-driven uninstall');
      expect(errors[0].message).toContain(lockfile);
      expect(errors[0].message).toContain('uninstall --bundle <id> --target <name>');
      expect(errors[0].message).toContain('uninstall --all --target <name>');
      expect(errors[0].hint).toBe('Unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to use the current repository-scope path.');
      expect(recording.writes).toEqual([]);
      expect(recording.contentReads.filter((p) => p.endsWith('.lock.json'))).toEqual([]);
    };
    // A repository v2 lockfile (as the legacy writer left it) that tracks a file the legacy uninstall would delete.
    const seedRepositoryLockfile = async (): Promise<{ lockfile: string; tracked: string }> => {
      const lockfile = path.join(workspace, 'prompt-registry.lock.json');
      const tracked = path.join(workspace, 'tracked.prompt.md');
      await writeFile(tracked, '# tracked\n');
      let legacy = emptyLockfile('ai-primitives-hub-cli');
      legacy = upsertBundleEntry(legacy, 'tracked-bundle', {
        version: '1.0.0',
        sourceId: 'legacy-source',
        sourceType: 'github',
        installedAt: '2026-01-01T00:00:00.000Z',
        files: [{ path: 'tracked.prompt.md', checksum: 'abc' }]
      });
      await writeLockfile(lockfile, legacy, new NodeFileSystem());
      return { lockfile, tracked };
    };

    it('refuses an explicit --lockfile naming the user desired file, reading and writing nothing', async () => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await run(['uninstall', '--lockfile', paths().userLockfile, '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expectRefused(result, recording, paths().userLockfile);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('refuses an explicit --lockfile naming a repository lockfile, leaving it and the files it tracks alone', async () => {
      const { lockfile, tracked } = await seedRepositoryLockfile();
      const before = await readFile(lockfile, 'utf8');
      const recording = new RecordingFs();

      const result = await run(['uninstall', '--lockfile', lockfile, '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expectRefused(result, recording, lockfile);
      await expect(readFile(lockfile, 'utf8')).resolves.toBe(before);
      await expect(readFile(tracked, 'utf8')).resolves.toBe('# tracked\n');
    });

    it('refuses a bare uninstall whose detection selects a project prompt-registry.lock.json', async () => {
      const { lockfile, tracked } = await seedRepositoryLockfile();
      await install();
      const before = await readFile(lockfile, 'utf8');
      const userBefore = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await run(['uninstall', '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expectRefused(result, recording, lockfile);
      await expect(readFile(lockfile, 'utf8')).resolves.toBe(before);
      await expect(readFile(tracked, 'utf8')).resolves.toBe('# tracked\n');
      expect(await lockfileBytes()).toEqual(userBefore);
    });

    it('refuses a bare uninstall whose detection selects the v3 user lockfile', async () => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await run(['uninstall', '--target', 'my-vscode', '-o', 'json'], flagOn, recording);

      expectRefused(result, recording, paths().userLockfile);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('still asks for a mode when a bare uninstall detects no lockfile at all', async () => {
      const result = await uninstall([]);

      expect(result.exitCode).toBe(1);
      expect(parse<null>(result.stdout).errors[0].code).toBe('USAGE.MISSING_FLAG');
    });
  });

  describe('scope and flag gating', () => {
    it.each(['repository', 'workspace', 'bogus'])('refuses scope "%s" with BUNDLE.UNSUPPORTED_SCOPE before reading or writing anything (--bundle)', async (scope) => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--bundle', 'local-foo', '--scope', scope], recording);

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(errors[0].message).toContain(`uninstall: scope "${scope}"`);
      expect(recording.writes).toEqual([]);
      expect(recording.reads.filter((p) => p === paths().userLockfile || p === paths().userLocalLockfile)).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it.each(['repository', 'workspace', 'bogus'])('refuses scope "%s" with BUNDLE.UNSUPPORTED_SCOPE before reading or writing anything (--all)', async (scope) => {
      await install();
      const before = await lockfileBytes();
      const recording = new RecordingFs();

      const result = await uninstall(['--all', '--scope', scope], recording);

      expect(result.exitCode).toBe(1);
      expect(parse<null>(result.stdout).errors[0].code).toBe('BUNDLE.UNSUPPORTED_SCOPE');
      expect(recording.writes).toEqual([]);
      expect(recording.reads.filter((p) => p === paths().userLockfile || p === paths().userLocalLockfile)).toEqual([]);
      expect(await lockfileBytes()).toEqual(before);
      await expect(readFile(destination(), 'utf8')).resolves.toContain('Hello Prompt');
    });

    it('reports an unrecognized AI_PRIMITIVES_HUB_UNIFIED_DEPLOY value as USAGE.INVALID_FLAG', async () => {
      const result = await run(['uninstall', '--bundle', 'local-foo', '--target', 'my-vscode', '-o', 'json'], {
        AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: 'maybe'
      });

      expect(result.exitCode).toBe(1);
      const { errors } = parse<null>(result.stdout);
      expect(errors[0].code).toBe('USAGE.INVALID_FLAG');
      expect(errors[0].message).toContain('AI_PRIMITIVES_HUB_UNIFIED_DEPLOY');
    });
  });
});
