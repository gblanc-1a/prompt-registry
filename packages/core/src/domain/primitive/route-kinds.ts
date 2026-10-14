/**
 * Domain layer — layout prefix ↔ primitive kind routing.
 *
 * Moved out of `app`'s `file-tree-writer.ts`, where `ROUTE_PREFIX_KINDS`
 * and `routeToKind` were module-private. Manifest-driven placement
 * inverts a resolved layout's `kindRoutes` (whose keys are source-path
 * prefixes) into kind → output directory, so this policy has to be
 * public and has to state what happens when the inversion is not a
 * function: a kind reachable through two keys with *different* outputs
 * is an error, while a key this vocabulary does not recognize is a
 * reported omission (design 4.3, 4.7).
 * @module domain/primitive/route-kinds
 */
import type {
  KindRoutes,
} from '../install/layout';
import type {
  PrimitiveKind,
} from './types';
import {
  normalizePrimitiveKind,
} from './types';

/**
 * Host-specific layout prefixes that carry a kind the alias vocabulary
 * cannot derive from the directory name alone.
 */
export const ROUTE_PREFIX_KINDS: Readonly<Record<string, PrimitiveKind>> = {
  '.kiro/steering/': 'steering',
  '.kiro/specs/': 'spec',
  '.claude/commands/': 'command',
  '.claude/output-styles/': 'output-style',
  '.cursor/rules/': 'rule',
  '.cursor/agents/': 'agent',
  '.cursor/skills/': 'skill',
  '.cursor/commands/': 'command',
  '.opencode/tools/': 'tool',
  '.opencode/commands/': 'command',
  '.opencode/agents/': 'agent',
  '.opencode/skills/': 'skill',
  '.opencode/rules/': 'rule',
  '.opencode/hooks/': 'hook',
  '.opencode/plugins/': 'plugin',
  '.devin/knowledge/': 'knowledge',
  '.devin/playbooks/': 'playbook',
  '.devin/powers/': 'power',
  '.devin/prompts/': 'prompt',
  '.devin/instructions/': 'instruction',
  '.devin/agents/': 'agent',
  '.devin/skills/': 'skill',
  '.devin/hooks/': 'hook',
  '.devin/plugins/': 'plugin'
};

/**
 * Map a layout prefix back to the primitive kind it represents.
 * @param prefix - Layout key, with or without its trailing slash.
 * @returns The canonical kind, or null when the prefix is not recognized.
 */
export const routeToKind = (prefix: string): PrimitiveKind | null => {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return normalizePrimitiveKind(prefix.replace(/\/$/, ''))
    ?? ROUTE_PREFIX_KINDS[withSlash]
    ?? null;
};

/** Result of inverting a layout's `kindRoutes`. */
export interface KindRouteInversion {
  /** Canonical kind → output subdirectory, relative to the layout's baseDir. */
  byKind: Map<PrimitiveKind, string>;
  /**
   * Keys whose kind could not be resolved at all. Reported rather than
   * dropped: `kindRoutes` allows arbitrary strings, and a user override
   * with a custom key would otherwise lose its items in silence.
   */
  unknownKeys: string[];
}

/** Thrown when one kind is reachable through two keys with different outputs. */
export class AmbiguousKindRouteError extends Error {
  public readonly code = 'LAYOUT.AMBIGUOUS_KIND_ROUTE';

  /**
   * Create an ambiguous kind route error.
   * @param kind - The kind reachable two ways.
   * @param first - Output directory from the first key seen.
   * @param second - Conflicting output directory.
   */
  public constructor(
    public readonly kind: PrimitiveKind,
    first: string,
    second: string
  ) {
    super(
      `layout maps primitive kind "${kind}" to two different output directories `
      + `("${first}" and "${second}"); fix the layout's kindRoutes so each kind has one destination`
    );
    this.name = 'AmbiguousKindRouteError';
  }
}

/**
 * Invert a resolved layout's `kindRoutes` into kind → output directory.
 * @param routes - The resolved layout's `kindRoutes`.
 * @returns The inversion plus any unrecognized keys.
 * @throws {AmbiguousKindRouteError} When one kind has two different outputs.
 */
export const invertKindRoutes = (routes: KindRoutes): KindRouteInversion => {
  const byKind = new Map<PrimitiveKind, string>();
  const unknownKeys: string[] = [];

  for (const [key, outputDir] of Object.entries(routes)) {
    const kind = routeToKind(key);
    if (kind === null) {
      unknownKeys.push(key);
      continue;
    }
    const existing = byKind.get(kind);
    if (existing !== undefined && existing !== outputDir) {
      throw new AmbiguousKindRouteError(kind, existing, outputDir);
    }
    byKind.set(kind, outputDir);
  }

  return { byKind, unknownKeys };
};
