import {
  realpathSync,
} from 'node:fs';
import * as path from 'node:path';
import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';

/**
 * Build the inside/outside predicate for a directory that exists.
 *
 * `path.relative` makes it immune to trailing separators and to sibling prefixes (`/x-evil` is
 * outside `/x`). Both the given spelling and the realpath of the root count as inside, so a
 * symlinked temp directory (macOS `/var` → `/private/var`) is inside whichever way it is spelled.
 * @param root Existing directory the boundary encloses.
 * @returns Whether a path is the root or lies beneath it.
 */
export const createBoundary = (root: string): ((file: string) => boolean) => {
  const roots = [...new Set([path.resolve(root), realpathSync(root)])];
  return (file) => roots.some((enclosing) => {
    const relative = path.relative(enclosing, path.resolve(file));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  });
};

/**
 * Real filesystem whose existence probes cannot see outside `root`.
 *
 * Project config, layouts and lockfile discovery walk upward from `cwd` with no boundary, so a
 * temp directory created under a tree that carries its own `ai-primitives-hub.yml`,
 * `ai-primitives-hub-layouts.yml` or `prompt-registry*.lock.json` (for example `TMPDIR` inside a
 * checkout) would otherwise read those files, and `target add` would write to the ancestor
 * config. Discovery is built on `exists`, so hiding everything outside `root` stops the walk at
 * the temp directory. `RecordingFs` takes the same boundary for failure-injection runs.
 */
export class BoundedFs extends NodeFileSystem {
  private readonly isInside: (file: string) => boolean;

  public constructor(root: string) {
    super();
    this.isInside = createBoundary(root);
  }

  public override async exists(file: string): Promise<boolean> {
    return this.isInside(file) && await super.exists(file);
  }
}
