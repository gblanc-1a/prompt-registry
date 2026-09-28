/**
 * Tests for storage/mkdir-lock.ts — exactly one holder per key, no timestamp
 * takeover, and diagnostic-only metadata (NFR1.1.5, BR5.9).
 */
import {
  existsSync,
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
  lockDirectoryName,
  MkdirLock,
} from '../../src/storage/mkdir-lock';
import {
  createTempDir,
} from '../helpers/temp-dir';

describe('MkdirLock', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('mkdir-lock-');
  });

  afterEach(() => {
    cleanup();
  });

  const lock = (holder: string): MkdirLock => new MkdirLock({
    lockRoot: join(dir, 'locks'),
    holder,
    now: () => new Date('2026-09-28T10:00:00.000Z')
  });

  it('grants the lock to one holder', async () => {
    const handle = await lock('first').tryAcquire('install-key');

    expect(handle).not.toBeNull();
    expect(handle?.holder).toBe('first');
    expect(handle?.acquiredAt).toBe('2026-09-28T10:00:00.000Z');
  });

  it('refuses a second holder rather than sharing or waiting', async () => {
    const first = await lock('first').tryAcquire('install-key');

    const second = await lock('second').tryAcquire('install-key');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('lets a different key be held at the same time', async () => {
    const first = await lock('first').tryAcquire('key-a');
    const second = await lock('second').tryAcquire('key-b');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });

  it('releases so the next holder can acquire, and release is idempotent', async () => {
    const first = await lock('first').tryAcquire('install-key');
    await first?.release();
    await first?.release();

    const second = await lock('second').tryAcquire('install-key');

    expect(second).not.toBeNull();
  });

  it('records holder metadata for diagnosis only', async () => {
    await lock('first').tryAcquire('install-key');

    const metadataPath = join(dir, 'locks', `${lockDirectoryName('install-key')}.lock`, 'holder.json');

    expect(existsSync(metadataPath)).toBe(true);
    expect(JSON.parse(readFileSync(metadataPath, 'utf8'))).toStrictEqual({
      key: 'install-key',
      holder: 'first',
      acquiredAt: '2026-09-28T10:00:00.000Z'
    });
  });

  it('refuses a takeover based on a stale acquisition timestamp alone', async () => {
    await lock('first').tryAcquire('install-key');
    const metadataPath = join(dir, 'locks', `${lockDirectoryName('install-key')}.lock`, 'holder.json');
    writeFileSync(metadataPath, JSON.stringify({
      key: 'install-key',
      holder: 'first',
      acquiredAt: '1999-01-01T00:00:00.000Z'
    }));

    const second = await lock('second').tryAcquire('install-key');

    expect(second).toBeNull();
  });

  it('derives a filesystem-safe name for a key containing separators', () => {
    const name = lockDirectoryName('acme|copilot|user|/work/repo');

    expect(name).toMatch(/^[0-9a-f]{32}$/);
    expect(lockDirectoryName('acme|copilot|user|/work/repo')).toBe(name);
    expect(lockDirectoryName('other')).not.toBe(name);
  });
});
