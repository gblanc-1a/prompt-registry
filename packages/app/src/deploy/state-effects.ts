import type {
  FileSystem,
} from '@ai-primitives-hub/core';
import type {
  LockfileFsWithRename,
  LockfileV3Paths,
} from '../stores/lockfile-v3';
import {
  LifecycleError,
} from './lifecycle-error';
import type {
  AppliedEffects,
} from './lifecycle-error';

/** State-file effects stay recoverable; they are reported, never rolled back. */
export interface StateEffects {
  fs: LockfileFsWithRename;
  started: boolean;
  written: string[];
  created: string[];
  removed: string[];
  cleanedUp: string[];
  cleanupFailures: AppliedEffects['cleanupFailures'];
}

/**
 * Observe atomic state-file publication and temporary-file cleanup through the
 * existing filesystem boundary, without changing the store's ordering or policy.
 * @param fs Filesystem boundary.
 * @param paths Pair and legacy paths.
 * @returns Store facade and accumulated effects.
 */
export function trackStateEffects(fs: FileSystem, paths: LockfileV3Paths & { legacyFiles?: readonly string[] }): StateEffects {
  const persistent = new Set([paths.desiredFile, paths.localFile, ...paths.legacyFiles ?? []]);
  const state: StateEffects = {
    started: false, written: [], created: [], removed: [], cleanedUp: [], cleanupFailures: [],
    fs: {
      readFile: (file) => fs.readFile(file),
      exists: (file) => fs.exists(file),
      writeFile: async (file, content) => {
        state.started = true;
        await fs.writeFile(file, content);
      },
      mkdir: async (directory, options) => {
        state.started = true;
        await fs.mkdir(directory, options);
      },
      rename: async (from, to) => {
        const existed = await fs.exists(to);
        state.started = true;
        await fs.rename(from, to);
        if (!state.written.includes(to)) {
          state.written.push(to);
        }
        if (!existed && !state.created.includes(to)) {
          state.created.push(to);
        }
      },
      remove: async (file) => {
        const existed = await fs.exists(file);
        state.started = true;
        try {
          await fs.remove(file);
          if (existed) {
            (persistent.has(file) ? state.removed : state.cleanedUp).push(file);
          }
        } catch (cause) {
          if (existed && !persistent.has(file)) {
            state.cleanupFailures.push({ path: file, message: cause instanceof Error ? cause.message : String(cause) });
          }
          throw cause;
        }
      }
    }
  };
  return state;
}

/**
 * Wrap a failed state stage only after a mutation began. Reads and version-gate
 * refusals remain their original errors.
 * @param operation Lifecycle operation.
 * @param stage Failing stage.
 * @param state Accumulated state effects.
 * @param run State operation.
 * @returns State operation result.
 */
export async function runStateStage<T>(
  operation: 'deploy' | 'undeploy',
  stage: string,
  state: StateEffects,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (!state.started) {
      throw cause;
    }
    throw new LifecycleError(operation, cause, {
      stage, written: state.written, created: state.created, removed: state.removed,
      cleanedUp: state.cleanedUp, cleanupFailures: state.cleanupFailures
    });
  }
}
