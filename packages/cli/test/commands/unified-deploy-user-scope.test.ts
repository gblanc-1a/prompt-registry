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
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
  bundles: Record<string, { version: string; sourceId: string }>;
  sources: Record<string, { type: string; url: string }>;
  generatedAt?: string;
  targets?: unknown;
}

interface LocalRecord {
  state?: string;
  installedAt: string;
  unmanagedReason?: string;
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
    fs: NodeFileSystem = new BoundedFs(workspace)
  ): ReturnType<typeof runCommand> => runCommand(
    argv.map((arg) => (arg === '<bundleDir>' ? bundleDir : arg)),
    {
      commandClasses: [TargetAddCommand, InstallCommand, UninstallCommand, StatusCommand, UpdateCommand],
      context: {
        cwd: workspace,
        fs,
        env: { ...env, ...(flag === 'on' ? { AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1' } : {}) }
      }
    }
  );
  const runFlagOn = (argv: string[], fs?: NodeFileSystem): ReturnType<typeof runCommand> => runWith('on', argv, fs);
  const runFlagOff = (argv: string[], fs?: NodeFileSystem): ReturnType<typeof runCommand> => runWith('off', argv, fs);

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
    workspace = await mkdtemp(path.join(os.tmpdir(), 'cli-unified-e2e-'));
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

    expect(result.exitCode).toBe(0);
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

    const sourceId = `local-${path.basename(bundleDir)}`;
    const key = `${sourceId}/web-dev`;
    // The desired half is shareable: exactly these fields, so no `generatedAt`, `generatedBy`,
    // `targets`, `installedAt`, `baseDir`, `files` or checksums can appear at any depth.
    expect(await readDesired()).toEqual({
      $schema: expect.stringContaining('lockfile-v3.schema.json'),
      version: '3.0.0',
      bundles: { [key]: { version: '1.0.0', sourceId } },
      sources: { [sourceId]: { type: 'local', url: bundleDir } }
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
            sourceId,
            installedAt: expect.any(String),
            files: expect.any(Array)
          }
        }
      }
    });
    const recordedFiles = local.targets['my-vscode'].bundles[key].files;
    expect(recordedFiles.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual(expectedFiles);
  });

  it('uninstall removes exactly those paths and nothing else', async () => {
    await runFlagOn(INSTALL_ARGV);
    await writeFile(path.join(copilotDir, 'prompts', 'mine.prompt.md'), '# mine\n', 'utf8');

    const result = await runFlagOn(['uninstall', '--bundle', 'web-dev', '--target', 'my-vscode']);

    expect(result.exitCode).toBe(0);
    expect(await listTree(copilotDir)).toEqual(['prompts/mine.prompt.md']);
    expect((await readDesired()).bundles).toEqual({});
    // An emptied target is pruned from the local half.
    expect((await readLocal()).targets).toEqual({});
  });

  it('migrates an existing v2 XDG lockfile into the pair on that first write', async () => {
    await seedV2Lockfile();

    const result = await runFlagOn([...INSTALL_ARGV, '-o', 'json']);

    expect(result.exitCode).toBe(0);
    const { migration } = parseJson<{ migration: { migrated: string[]; unmanaged: { key: string; reason: string }[] } }>(result.stdout).data;
    const desired = await readDesired();
    const local = await readLocal();
    expect(desired.version).toBe('3.0.0');
    expect(desired.bundles['local-old/legacy']).toBeDefined();
    expect(local.targets.unmanaged.bundles['local-old/legacy'].state).toBe('unmanaged');
    expect(local.migration).toEqual({ lockfileV3: 'complete' });
    expect(migration.unmanaged).toEqual([
      { key: 'local-old/legacy', reason: local.targets.unmanaged.bundles['local-old/legacy'].unmanagedReason }
    ]);
    expect(migration.unmanaged[0].reason).not.toBe('');
    expect(await listTree(copilotDir)).toEqual(EXPECTED_TREE);
  });

  it('shows the migration reason in text output', async () => {
    await seedV2Lockfile();

    const result = await runFlagOn(INSTALL_ARGV);

    expect(result.exitCode).toBe(0);
    const reason = (await readLocal()).targets.unmanaged.bundles['local-old/legacy'].unmanagedReason;
    expect(reason).toBeTruthy();
    expect(result.stdout + result.stderr).toContain('local-old/legacy');
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
});
