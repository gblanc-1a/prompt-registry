/**
 * XdgHandoffCoordinator — the `HandoffCoordinatorPort` implementation.
 *
 * Records live in shared application data for **both** scopes (NFR1.1.4), so one
 * coordination namespace covers a hand-off between a repository lockfile and a
 * user-scope claim. Each write is a durable replacement, so a restart reads
 * either the previous phase or the new one, never a partial record (NFR1.1.2).
 * @module registry/handoff-coordinator
 */
import {
  readFile,
  rm,
} from 'node:fs/promises';
import {
  join,
} from 'node:path';
import type {
  AppStorage,
  HandoffCoordinatorPort,
  HandoffCoordinatorRecord,
} from '@ai-primitives-hub/core';
import {
  replaceJsonDurably,
} from '../storage/durable-file';
import {
  digestName,
  lifecycleRoots,
} from './user-scope-installation-registry';

/**
 * Options accepted by {@link XdgHandoffCoordinator}.
 */
export interface XdgHandoffCoordinatorOptions {
  readonly storage: AppStorage;
}

/**
 * Durable cross-store hand-off ordering in shared application data.
 */
export class XdgHandoffCoordinator implements HandoffCoordinatorPort {
  private readonly root: string;

  /**
   * Create an XdgHandoffCoordinator.
   * @param opts Injected application storage.
   */
  public constructor(opts: XdgHandoffCoordinatorOptions) {
    this.root = lifecycleRoots(opts.storage).coordinator;
  }

  /**
   * Absolute path of one coordinator record.
   * @param claimKey - Derived claim key.
   * @returns The record path.
   */
  private recordPath(claimKey: string): string {
    return join(this.root, `${digestName(claimKey)}.json`);
  }

  public async read(claimKey: string): Promise<HandoffCoordinatorRecord | null> {
    try {
      return JSON.parse(await readFile(this.recordPath(claimKey), 'utf8')) as HandoffCoordinatorRecord;
    } catch {
      return null;
    }
  }

  public async persist(record: HandoffCoordinatorRecord): Promise<void> {
    await replaceJsonDurably(this.recordPath(record.claimKey), record);
  }

  public async clear(claimKey: string): Promise<void> {
    await rm(this.recordPath(claimKey), { force: true });
  }
}
