/**
 * Node `fs/promises`-backed implementation of the `PathInspector` port.
 *
 * Two questions, both safety-critical and both unanswerable through the
 * `FileSystem` port: what a path really resolves to (`realpath`), and whether a
 * path is itself a symbolic link (`lstat`, which must not follow it). A missing
 * path is not an error here — a destination that does not exist yet is the
 * normal case on a first install.
 * @module fs/node-path-inspector
 */
import {
  lstat,
  realpath,
} from 'node:fs/promises';
import type {
  PathInspector,
} from '@ai-primitives-hub/core';

export class NodePathInspector implements PathInspector {
  public async realPath(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch {
      return null;
    }
  }

  public async isSymbolicLink(path: string): Promise<boolean> {
    try {
      const stats = await lstat(path);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }
}
