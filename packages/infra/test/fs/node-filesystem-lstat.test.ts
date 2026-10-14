import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  NodeFileSystem,
} from '../../src/fs/node-filesystem';

describe('NodeFileSystem.lstat', () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'aph-lstat-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports a regular file as not a symlink', async () => {
    const file = path.join(root, 'real.md');
    await writeFile(file, 'x', 'utf8');

    const stat = await fs.lstat(file);

    expect(stat.isSymbolicLink).toBe(false);
    expect(stat.isFile).toBe(true);
  });

  it('reports a symlink as a symlink without following it', async () => {
    const target = path.join(root, 'real.md');
    const link = path.join(root, 'link.md');
    await writeFile(target, 'x', 'utf8');
    await symlink(target, link);

    const stat = await fs.lstat(link);

    expect(stat.isSymbolicLink).toBe(true);
    // The distinction that matters: stat() follows, lstat() does not.
    expect((await fs.stat(link)).isFile).toBe(true);
  });

  it('reports a directory symlink as a symlink, not a directory', async () => {
    // This is the §4.8 case a per-file lstat misses: a child path under a
    // symlinked *directory* lstats as an ordinary file.
    const realDir = path.join(root, 'source');
    const linkDir = path.join(root, 'linked');
    await mkdir(realDir, { recursive: true });
    await writeFile(path.join(realDir, 'SKILL.md'), 'x', 'utf8');
    await symlink(realDir, linkDir, 'dir');

    expect((await fs.lstat(linkDir)).isSymbolicLink).toBe(true);
    expect((await fs.lstat(path.join(linkDir, 'SKILL.md'))).isSymbolicLink).toBe(false);
  });
});

describe('NodeFileSystem.rename', () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'aph-rename-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('moves a file from source to destination', async () => {
    const source = path.join(root, 'old.txt');
    const dest = path.join(root, 'new.txt');
    await writeFile(source, 'content', 'utf8');

    await fs.rename(source, dest);

    expect(await fs.exists(dest)).toBe(true);
    expect(await fs.readFile(dest)).toBe('content');
  });

  it('leaves no file at the source path after rename', async () => {
    const source = path.join(root, 'old.txt');
    const dest = path.join(root, 'new.txt');
    await writeFile(source, 'content', 'utf8');

    await fs.rename(source, dest);

    expect(await fs.exists(source)).toBe(false);
  });
});
