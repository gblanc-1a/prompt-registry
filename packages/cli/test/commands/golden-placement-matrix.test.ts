/**
 * Golden placement matrix — the highest-value test in the plan (§10).
 *
 * Slice 1 fills one cell: vscode × user. Each later slice adds rows and
 * columns rather than rewriting this table, and by slice 6 the same
 * expectations are asserted against the extension's output too, which is when
 * this becomes the CLI-vs-extension parity assertion.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
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
  TargetAddCommand,
} from '../../src/commands/target-add';
import {
  runCommand,
} from '../../src/framework';
import {
  writeReleaseArchive,
} from '../fixtures/release-archives';
import {
  createSlice1Bundle,
} from '../fixtures/slice1-bundle';

interface MatrixRow {
  targetType: string;
  scope: 'user';
  /** Directory the deployed tree is rooted at, relative to HOME. */
  baseDir: string;
  /** Full recursive file list under `baseDir`: sorted, baseDir-relative POSIX. */
  expected: string[];
}

const MATRIX: MatrixRow[] = [
  {
    targetType: 'vscode',
    scope: 'user',
    baseDir: '.copilot',
    expected: [
      'agents/reviewer.agent.md',
      'instructions/ts-standards.instructions.md',
      'prompts/hello.prompt.md'
    ]
  }
];

const listTree = async (root: string): Promise<string[]> => {
  try {
    await stat(root);
  } catch {
    return [];
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join(path.posix.sep))
    .toSorted();
};

describe('golden placement matrix', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'cli-golden-matrix-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it.each(MATRIX)('places the slice 1 bundle for $targetType × $scope scope', async (row) => {
    const bundleDir = path.join(home, 'bundle');
    await mkdir(bundleDir, { recursive: true });
    await writeReleaseArchive(bundleDir, createSlice1Bundle());
    const run = (argv: string[]): ReturnType<typeof runCommand> => runCommand(argv, {
      commandClasses: [TargetAddCommand, InstallCommand],
      context: {
        cwd: home,
        fs: new NodeFileSystem(),
        env: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
          XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
          AI_PRIMITIVES_HUB_UNIFIED_DEPLOY: '1'
        }
      }
    });
    expect((await run(['target', 'add', 'matrix-target', '--type', row.targetType, '-o', 'json'])).exitCode).toBe(0);

    const result = await run(['install', '--from', bundleDir, 'web-dev', '--target', 'matrix-target']);

    expect(result.exitCode).toBe(0);
    expect(await listTree(path.join(home, row.baseDir))).toEqual(row.expected);
  });
});
