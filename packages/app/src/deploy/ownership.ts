import * as posix from 'node:path/posix';
import type {
  LocalLockfileV3,
} from '../stores/lockfile-v3';
import {
  resolveRecordedPath,
} from './safety';

/**
 * Collect physical destinations held by every other record, including explicit
 * unmanaged paths. Logical keys and target names do not imply exclusive ownership.
 * @param local Materialization state.
 * @param targetName Target being changed.
 * @param key Bundle record being changed.
 * @returns Other owners' absolute destinations.
 */
export function otherOwnedPaths(local: LocalLockfileV3, targetName: string, key: string): Set<string> {
  const paths = new Set<string>();
  for (const [target, binding] of Object.entries(local.targets)) {
    for (const [bundle, record] of Object.entries(binding.bundles)) {
      if (target === targetName && bundle === key) {
        continue;
      }
      for (const file of record.files) {
        if (posix.isAbsolute(file.path) && !file.path.includes('\\')) {
          paths.add(posix.normalize(file.path));
        } else if (typeof binding.baseDir === 'string') {
          const resolved = resolveRecordedPath(binding.baseDir, file.path);
          if (resolved.safe) {
            paths.add(resolved.absolutePath);
          }
        }
      }
    }
  }
  return paths;
}
