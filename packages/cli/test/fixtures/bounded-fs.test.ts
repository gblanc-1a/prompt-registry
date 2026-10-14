/**
 * The boundary hides everything outside the workspace from `exists`, the primitive that config,
 * layouts and lockfile discovery are built on, in both the plain and the failure-injection fs.
 */
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FileSystemLayoutConfigLoader,
} from '@ai-primitives-hub/infra';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  BoundedFs,
} from './bounded-fs';
import {
  RecordingFs,
} from './recording-fs';

const OUTSIDE_LAYOUTS = `
layouts:
  vscode:
    user:
      baseDir: "/outside/vscode"
      kindRoutes:
        "prompts/": "outside-prompts/"
`;

describe('bounded filesystems', () => {
  let outer: string;
  let root: string;
  let sibling: string;

  beforeEach(async () => {
    outer = await mkdtemp(path.join(os.tmpdir(), 'cli-bounded-fs-'));
    root = path.join(outer, 'ws');
    sibling = path.join(outer, 'ws-evil');
    await mkdir(root, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(root, 'inside.txt'), 'in\n');
    await writeFile(path.join(sibling, 'evil.txt'), 'evil\n');
    await writeFile(path.join(outer, 'outside.txt'), 'out\n');
    await writeFile(path.join(outer, 'ai-primitives-hub-layouts.yml'), OUTSIDE_LAYOUTS);
  });

  afterEach(async () => {
    await rm(outer, { recursive: true, force: true });
  });

  it.each([
    ['BoundedFs', (enclosing: string) => new BoundedFs(enclosing)],
    ['RecordingFs with a boundary', (enclosing: string) => new RecordingFs(enclosing)]
  ])('%s sees the workspace and nothing else', async (_name, build) => {
    const fs = build(root);
    const realRoot = await realpath(root);

    expect(await fs.exists(root)).toBe(true);
    expect(await fs.exists(path.join(root, 'inside.txt'))).toBe(true);
    expect(await fs.exists(`${root}${path.sep}inside.txt`)).toBe(true);
    expect(await fs.exists(path.join(realRoot, 'inside.txt'))).toBe(true);
    expect(await fs.exists(path.join(root, 'absent.txt'))).toBe(false);
    // Outside: a parent's file, a sibling that merely shares the prefix, and `..` back out.
    expect(await fs.exists(path.join(outer, 'outside.txt'))).toBe(false);
    expect(await fs.exists(sibling)).toBe(false);
    expect(await fs.exists(path.join(sibling, 'evil.txt'))).toBe(false);
    expect(await fs.exists(path.join(root, '..', 'outside.txt'))).toBe(false);
    expect(await fs.exists(outer)).toBe(false);
  });

  it('keeps an unbounded RecordingFs unchanged', async () => {
    expect(await new RecordingFs().exists(path.join(outer, 'outside.txt'))).toBe(true);
  });

  it('stops the layouts walk at the workspace only when the failure-injection fs is bounded', async () => {
    const load = async (fs: RecordingFs): Promise<number> => (await new FileSystemLayoutConfigLoader({
      cwd: root,
      fs,
      userConfigDir: path.join(root, 'config')
    }).load()).length;

    // Built-in layer plus the layouts file one directory above the workspace.
    expect(await load(new RecordingFs())).toBe(2);
    expect(await load(new RecordingFs(root))).toBe(1);
  });
});
