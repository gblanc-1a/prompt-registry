/**
 * Tests for storage/durable-file.ts — the one durable replacement primitive
 * (NFR1.1.2). Crash injection is modelled by making the write step fail after a
 * previous complete file exists: the final path must still hold the previous
 * complete content, never partial bytes, and no temporary debris may remain.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  replaceFileDurably,
  replaceJsonDurably,
} from '../../src/storage/durable-file';
import {
  createTempDir,
} from '../helpers/temp-dir';

describe('replaceFileDurably', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('durable-file-');
  });

  afterEach(() => {
    cleanup();
  });

  it('creates the file and its parent directory', async () => {
    const target = join(dir, 'nested', 'deeper', 'record.json');

    await replaceFileDurably(target, new TextEncoder().encode('{"a":1}'));

    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
  });

  it('replaces existing content completely', async () => {
    const target = join(dir, 'record.json');
    writeFileSync(target, 'previous');

    await replaceFileDurably(target, new TextEncoder().encode('next'));

    expect(readFileSync(target, 'utf8')).toBe('next');
  });

  it('leaves no temporary file behind on success', async () => {
    const target = join(dir, 'record.json');

    await replaceFileDurably(target, new TextEncoder().encode('x'));

    expect(readdirSync(dir).filter((name) => name.startsWith('.tmp-'))).toStrictEqual([]);
  });

  it('leaves the previous complete file intact when the write fails', async () => {
    const target = join(dir, 'record.json');
    writeFileSync(target, 'previous');
    // A directory at the temp path is impossible to write as a file, which fails
    // the write step after the previous file already exists.
    const blockedDir = join(dir, 'blocked');
    mkdirSync(blockedDir);
    const targetInBlocked = join(blockedDir, 'sub');
    mkdirSync(targetInBlocked);

    await expect(replaceFileDurably(targetInBlocked, new TextEncoder().encode('next')))
      .rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe('previous');
  });

  it('leaves no temporary debris when the write fails', async () => {
    const blockedDir = join(dir, 'blocked2');
    mkdirSync(blockedDir);
    mkdirSync(join(blockedDir, 'sub'));

    await expect(replaceFileDurably(join(blockedDir, 'sub'), new TextEncoder().encode('next')))
      .rejects.toThrow();

    expect(readdirSync(blockedDir).filter((name) => name.startsWith('.tmp-'))).toStrictEqual([]);
  });

  it('writes JSON with a trailing newline through the same primitive', async () => {
    const target = join(dir, 'doc.json');

    await replaceJsonDurably(target, { b: 2 });

    expect(readFileSync(target, 'utf8')).toBe('{\n  "b": 2\n}\n');
  });
});
