/**
 * LayoutTargetRouting — the `TargetRoutingPort` implementation.
 *
 * It resolves a destination from the target, the scope, and the item's **kind**
 * (BR2.1), then proves containment twice:
 *
 *   1. lexically, through `core`'s pure `containedJoin` (no `..` escape, no
 *      absolute redirect);
 *   2. against the real filesystem, by resolving the destination root to its
 *      real path and refusing any symbolic-link component *under* that root
 *      (BR2.2, NFR1.1.1).
 *
 * The root itself is *verified* rather than refused: resolving it through
 * `realPath` is what makes it a trustworthy boundary, and refusing a root whose
 * own ancestry contains a link would refuse ordinary systems (a symlinked home
 * directory, macOS's `/tmp`). Everything the bundle can influence — every
 * segment below the root — must be a real directory or file.
 *
 * Layout merging stays in `app`, so the merged layout arrives as an injected
 * resolver rather than an import: `infra` must not depend on `app`.
 * @module routing/layout-target-routing
 */
import type {
  PathInspector,
  Target,
  TargetLayout,
  TargetRoutingPort,
  TargetRoutingRequest,
  TargetRoutingResolution,
} from '@ai-primitives-hub/core';
import {
  containedJoin,
  destinationTail,
  expandPath,
  isPrimitiveKind,
  layoutScopeFor,
  routeForKind,
} from '@ai-primitives-hub/core';

/**
 * Resolves the merged layout for one target at one layout scope.
 *
 * Supplied by the composition root, which owns the layout layers and `app`'s
 * merge logic.
 */
export type LayoutResolver = (
  target: Target,
  layoutScope: 'user' | 'repository'
) => Promise<TargetLayout | null> | TargetLayout | null;

/**
 * Options accepted by {@link LayoutTargetRouting}.
 */
export interface LayoutTargetRoutingOptions {
  readonly resolveLayout: LayoutResolver;
  readonly pathInspector: PathInspector;
  /** Environment used to expand `${VAR}` tokens in `baseDir`. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Kind-driven, containment-checked destination routing.
 */
export class LayoutTargetRouting implements TargetRoutingPort {
  private readonly env: Record<string, string | undefined>;

  /**
   * Create a LayoutTargetRouting.
   * @param opts Injected layout resolver, path inspector, and environment.
   */
  public constructor(private readonly opts: LayoutTargetRoutingOptions) {
    this.env = opts.env ?? process.env;
  }

  /**
   * The first `${TOKEN}` in a template the environment cannot fill.
   *
   * `expandPath` substitutes an empty string for an unknown variable, which
   * would silently turn `${MISSING}/x` into the absolute path `/x` — a write
   * outside any intended root. Checking first keeps that from reaching disk.
   * @param template - The layout's `baseDir` template.
   * @returns The offending token, or `null` when every token has a value.
   */
  private firstUnresolvedToken(template: string): string | null {
    for (const match of template.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      const name = match[1] ?? '';
      const value = this.env[name];
      if (value === undefined || value === '') {
        return `\${${name}}`;
      }
    }
    if (template.startsWith('~')) {
      const home = this.env.HOME ?? this.env.USERPROFILE ?? '';
      if (home === '') {
        return '~';
      }
    }
    return null;
  }

  /**
   * Resolve the destination root to its real path when it exists.
   *
   * A root that does not exist yet stays lexical: it will be created under a
   * real ancestor, and every component below it is link-checked before a write.
   * @param root - The expanded destination root.
   * @returns The verified root path.
   */
  private async verifyRoot(root: string): Promise<string> {
    return await this.opts.pathInspector.realPath(root) ?? root;
  }

  /**
   * The first existing component under the root that is a symbolic link.
   * @param root - Verified destination root.
   * @param destinationPath - Contained destination path.
   * @returns The offending path, or `null` when no component is a link.
   */
  private async firstSymbolicLinkComponent(
    root: string,
    destinationPath: string
  ): Promise<string | null> {
    const relative = destinationPath.slice(root.length).split('/').filter((s) => s.length > 0);
    let current = root;
    for (const segment of relative) {
      current = `${current}/${segment}`;
      if (await this.opts.pathInspector.isSymbolicLink(current)) {
        return current;
      }
    }
    return null;
  }

  /**
   * Resolve the destination for one governed item.
   * @param request Target, scope, item kind, and the item's archive path.
   * @returns The resolved address, an `unsupported` kind, or `safety-blocked`.
   */
  public async resolve(request: TargetRoutingRequest): Promise<TargetRoutingResolution> {
    const { target, scope, itemKind, archivePath } = request;
    if (!isPrimitiveKind(itemKind)) {
      return { kind: 'unsupported', detail: `"${String(itemKind)}" is not a primitive kind` };
    }
    if (target.allowedKinds !== undefined && !target.allowedKinds.includes(itemKind)) {
      return {
        kind: 'unsupported',
        detail: `target "${target.name}" does not accept ${itemKind} content`
      };
    }

    const layoutScope = layoutScopeFor(scope, (target.rootPath ?? target.path) !== undefined);
    const layout = await this.opts.resolveLayout(target, layoutScope);
    if (layout === null) {
      return {
        kind: 'unsupported',
        detail: `no ${layoutScope}-scope layout is defined for target type "${target.type}"`
      };
    }

    const route = routeForKind(itemKind, layout.kindRoutes);
    if (route === null) {
      return {
        kind: 'unsupported',
        detail: `target "${target.name}" routes no ${itemKind} content at ${layoutScope} scope`
      };
    }

    const unresolved = this.firstUnresolvedToken(layout.baseDir);
    if (unresolved !== null) {
      return {
        kind: 'safety-blocked',
        detail: `destination root "${layout.baseDir}" has no value for token "${unresolved}"`
      };
    }
    const destinationRoot = expandPath(layout.baseDir, this.env);
    if (destinationRoot.length === 0 || destinationRoot.includes('${')) {
      return {
        kind: 'safety-blocked',
        detail: `destination root "${layout.baseDir}" still carries an unresolved token`
      };
    }

    const verifiedRoot = await this.verifyRoot(destinationRoot);
    const tail = destinationTail(archivePath, itemKind);
    if (tail.length === 0) {
      return { kind: 'safety-blocked', detail: `item "${archivePath}" has no destination file name` };
    }
    const destinationPath = containedJoin(verifiedRoot, `${route}/${tail}`);
    if (destinationPath === null) {
      return {
        kind: 'safety-blocked',
        detail: `destination for "${archivePath}" would escape "${verifiedRoot}"`
      };
    }

    const linkComponent = await this.firstSymbolicLinkComponent(verifiedRoot, destinationPath);
    if (linkComponent !== null) {
      return {
        kind: 'safety-blocked',
        detail: `destination component "${linkComponent}" is a symbolic link`
      };
    }

    return { kind: 'resolved', address: { destinationRoot: verifiedRoot, itemKind, destinationPath } };
  }
}
