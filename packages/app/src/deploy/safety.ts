import * as posix from 'node:path/posix';
import {
  RegistryError,
} from '@ai-primitives-hub/core';
import type {
  FileSystem,
} from '@ai-primitives-hub/core';

/**
 * Resolve only canonical POSIX-relative record paths. Native separators, drive
 * forms and normalization-dependent paths must never reach a removal boundary.
 * @param baseDir Recorded target root.
 * @param recordedPath Recorded relative path.
 * @returns Safe destination or a path to report without acting on it.
 */
export function resolveRecordedPath(
  baseDir: string,
  recordedPath: string
): { safe: true; absolutePath: string } | { safe: false; reportPath: string } {
  const joined = posix.normalize(posix.join(baseDir, recordedPath));
  if (recordedPath === '' || recordedPath.includes('\\') || recordedPath.includes(':')
    || posix.isAbsolute(recordedPath) || recordedPath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return {
      safe: false,
      reportPath: posix.isAbsolute(recordedPath) || recordedPath.includes('\\') || recordedPath.includes(':')
        ? recordedPath
        : joined
    };
  }
  const relative = posix.relative(baseDir, joined);
  if (relative === '' || relative === '..' || relative.startsWith('../')) {
    return { safe: false, reportPath: joined };
  }
  return { safe: true, absolutePath: joined };
}

/**
 * Inspect link identity of every component below the configured root. The
 * root itself may be a user-configured directory link; its children may not.
 * @param fs Filesystem boundary.
 * @param baseRoot Configured placement root.
 * @param destination Physical destination.
 * @returns The unsafe component, or undefined.
 */
export async function unsafeDestination(fs: FileSystem, baseRoot: string, destination: string): Promise<string | undefined> {
  const relative = posix.relative(baseRoot, destination);
  if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) {
    return destination;
  }
  let current = baseRoot;
  for (const component of relative.split('/').filter(Boolean)) {
    current = posix.join(current, component);
    try {
      if ((await fs.lstat(current)).isSymbolicLink) {
        return current;
      }
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) {
        throw cause;
      }
    }
  }
  return undefined;
}

/**
 * Refuse unsafe placement before writes.
 * @param fs Filesystem boundary.
 * @param baseRoot Configured placement root.
 * @param destinations Physical paths and directory destinations.
 */
export async function assertSafeDestinations(fs: FileSystem, baseRoot: string, destinations: readonly string[]): Promise<void> {
  for (const destination of new Set(destinations)) {
    const unsafe = await unsafeDestination(fs, baseRoot, destination);
    if (unsafe !== undefined) {
      throw new RegistryError({
        code: 'BUNDLE.UNSAFE_DESTINATION',
        message: `Cannot deploy through unsafe destination "${unsafe}". Remove the symbolic link or choose a different target path.`
      });
    }
  }
}
