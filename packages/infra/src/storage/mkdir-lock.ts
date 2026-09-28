/**
 * MkdirLock — the `ExclusiveLockPort` implementation (NFR1.1.5).
 *
 * `mkdir` is the portable atomic primitive: creating a directory either succeeds
 * for exactly one caller or fails with `EEXIST` for every other. The lock
 * directory carries holder and acquisition-time metadata, and that metadata is
 * **diagnostic only**: a stale-looking timestamp never authorises a takeover,
 * because a second holder that assumed the first was dead would give two
 * processes deletion authority over the same artifacts. Recovery from a truly
 * abandoned lock is a human action informed by this metadata, not an automatic
 * one.
 * @module storage/mkdir-lock
 */
import {
  createHash,
} from 'node:crypto';
import {
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  join,
} from 'node:path';
import type {
  ExclusiveLockPort,
  LockHandle,
} from '@ai-primitives-hub/core';

/**
 * Options accepted by {@link MkdirLock}.
 */
export interface MkdirLockOptions {
  /** Directory the lock directories are created in. */
  readonly lockRoot: string;
  /** Holder label recorded in the metadata; defaults to the process id. */
  readonly holder?: string;
  /** Clock, injected so tests are deterministic. */
  readonly now?: () => Date;
}

/**
 * Portable single-holder locking through atomic `mkdir`.
 */
export class MkdirLock implements ExclusiveLockPort {
  /**
   * Create a MkdirLock.
   * @param opts Lock root, holder label, and clock.
   */
  public constructor(private readonly opts: MkdirLockOptions) {}

  /**
   * Try to acquire the lock for a key without waiting.
   * @param key Lock key, typically an installation key.
   * @returns The handle, or `null` when another holder has it.
   */
  public async tryAcquire(key: string): Promise<LockHandle | null> {
    const lockDir = join(this.opts.lockRoot, `${lockDirectoryName(key)}.lock`);
    await mkdir(this.opts.lockRoot, { recursive: true });
    try {
      await mkdir(lockDir);
    } catch {
      return null;
    }
    const holder = this.opts.holder ?? `pid:${process.pid}`;
    const acquiredAt = (this.opts.now?.() ?? new Date()).toISOString();
    try {
      await writeFile(
        join(lockDir, 'holder.json'),
        `${JSON.stringify({ key, holder, acquiredAt }, null, 2)}\n`,
        'utf8'
      );
    } catch {
      // Metadata is diagnostic; a metadata failure must not hand the lock to a
      // second holder, so the lock stays held.
    }
    let released = false;
    return {
      key,
      holder,
      acquiredAt,
      release: async (): Promise<void> => {
        if (released) {
          return;
        }
        released = true;
        await rm(lockDir, { recursive: true, force: true });
      }
    };
  }
}

/**
 * A filesystem-safe, collision-free directory name for a lock key.
 *
 * An installation key contains path separators and other characters a directory
 * name cannot carry, so the name is a digest. The key itself is recorded in the
 * metadata for diagnosis.
 * @param key - Lock key.
 * @returns Hex digest usable as a directory name.
 */
export function lockDirectoryName(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
