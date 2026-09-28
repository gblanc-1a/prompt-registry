/**
 * The one durable file-replacement primitive (NFR1.1.2).
 *
 * Every final path this unit owns — target artifacts, registry records, journal
 * entries, ownership claims, coordinator records — is replaced the same way:
 *
 *   1. create a restrictive temporary file in the **final parent directory**, so
 *      the later rename stays on one filesystem;
 *   2. write the complete bytes and `fsync` the file, so the data is on the
 *      device before anything points at it;
 *   3. `rename` atomically over the final path;
 *   4. `fsync` the parent directory where the platform supports it, so the
 *      directory entry survives a crash too.
 *
 * Direct overwrite writes are prohibited: a reader must always observe either the
 * previous complete file or the intended complete file, never a partial one.
 * @module storage/durable-file
 */
import {
  randomUUID,
} from 'node:crypto';
import {
  constants as fsConstants,
} from 'node:fs';
import {
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  join,
} from 'node:path';

/** Restrictive mode for the temporary file: owner read/write only. */
const TEMP_FILE_MODE = 0o600;

/**
 * Replace a file durably.
 *
 * Creates the parent directory when absent. The temporary file is removed on any
 * failure, so a failed write leaves no debris and never a partial final file.
 * @param path - Absolute final path.
 * @param bytes - The complete bytes to place there.
 */
export async function replaceFileDurably(path: string, bytes: Uint8Array): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.tmp-${randomUUID()}`);
  try {
    await writeFile(tempPath, bytes, { mode: TEMP_FILE_MODE, flag: 'wx' });
    await syncPath(tempPath);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  await syncDirectory(parent);
}

/**
 * Replace a JSON file durably, with a trailing newline.
 * @param path - Absolute final path.
 * @param value - Value to serialise.
 */
export async function replaceJsonDurably(path: string, value: unknown): Promise<void> {
  await replaceFileDurably(path, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}

/**
 * `fsync` one file so its data reaches the device before the rename.
 * @param path - Absolute file path.
 */
async function syncPath(path: string): Promise<void> {
  const handle = await open(path, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * `fsync` a directory so the renamed entry survives a crash.
 *
 * Best effort by contract: several platforms refuse to open a directory for
 * syncing, and that refusal is not a write failure.
 * @param path - Absolute directory path.
 */
async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, fsConstants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Unsupported on this platform; the file itself is already synced.
  }
}
