import * as path from 'node:path';
import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';

/**
 * Real filesystem whose existence probes cannot see outside `root`.
 *
 * Project config and lockfile discovery walk upward from `cwd` with no boundary, so a temp
 * directory created under a tree that carries its own `ai-primitives-hub.yml` or
 * `prompt-registry*.lock.json` (for example `TMPDIR` inside a checkout) would otherwise read
 * those files, and `target add` would write to the ancestor config. Discovery is built on
 * `exists`, so hiding everything outside `root` stops the walk at the temp directory.
 */
export class BoundedFs extends NodeFileSystem {
  public constructor(private readonly root: string) {
    super();
  }

  public override async exists(file: string): Promise<boolean> {
    const relative = path.relative(this.root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return false;
    }
    return await super.exists(file);
  }
}
