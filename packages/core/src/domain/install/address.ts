/**
 * Domain layer — destination addressing for a governed item (U1).
 *
 * A destination is derived from three things and nothing else: the selected
 * target, the installation scope, and the item's **kind** (BR2.1). It is never
 * derived from the archive's internal directory names, which is what made the
 * old CLI path rigid, and it never embeds a runtime root in lifecycle policy.
 *
 * Containment is decided twice, on purpose. This module decides it *lexically*
 * (no `..` escape, no absolute redirect) so a pure test can prove the rule;
 * `infra` decides it again against the real filesystem, where symbolic links
 * exist (BR2.2, NFR1.1.1). Both must pass.
 *
 * Pure domain: no IO, no framework imports.
 * @module domain/install/address
 */
import type {
  PrimitiveKind,
} from '../primitive/types';
import {
  normalizePrimitiveKind,
} from '../primitive/types';
import type {
  KindRoutes,
} from './layout';
import type {
  InstallationScope,
} from './types';

/**
 * The resolved, contained destination for one item.
 *
 * Produced by routing; never stored as lifecycle policy.
 */
export interface InstallationAddress {
  /** Absolute and fully resolved: no unresolved path token may remain. */
  readonly destinationRoot: string;
  readonly itemKind: PrimitiveKind;
  /** Contained within {@link destinationRoot}. */
  readonly destinationPath: string;
}

/**
 * Which scope layout a target's scope routes through.
 *
 * `workspace` deliberately routes through the repository-scope layout when a
 * root path is present, rather than introducing a third routing rule.
 * @param scope - The requested installation scope.
 * @param hasRootPath - Whether the target supplies a workspace/repository root.
 * @returns The layout scope to resolve against.
 */
export function layoutScopeFor(
  scope: InstallationScope,
  hasRootPath: boolean
): 'user' | 'repository' {
  if (scope === 'repository') {
    return 'repository';
  }
  if (scope === 'workspace' && hasRootPath) {
    return 'repository';
  }
  return 'user';
}

/**
 * Find the output sub-path a kind routes to, by **kind** rather than by the
 * archive's directory name.
 *
 * Layout route keys are authored as directory forms (`"prompts/"`), so each key
 * is normalised to its canonical kind before comparison. The longest matching
 * key wins, which keeps a more specific route ahead of a general one.
 * @param kind - Canonical item kind from the manifest's `items[]`.
 * @param routes - The resolved layout's kind routes.
 * @returns The output sub-path, or `null` when this target routes no such kind.
 */
export function routeForKind(kind: PrimitiveKind, routes: KindRoutes): string | null {
  const candidates = Object.entries(routes)
    .filter(([routeKey]) => normalizePrimitiveKind(routeKey.replace(/\/+$/, '')) === kind)
    .toSorted((left, right) => right[0].length - left[0].length);
  return candidates[0]?.[1] ?? null;
}

/**
 * The sub-path an item keeps under its kind's route.
 *
 * A nested primitive keeps its tree (`skills/my-skill/SKILL.md` under a
 * `skills/` route stays `my-skill/SKILL.md`), because a skill is a directory of
 * files. A flat item contributes only its file name, so an archive that happens
 * to nest a prompt under an unrelated folder cannot smuggle that folder into the
 * target.
 * @param archivePath - The item's archive-relative path.
 * @param kind - Canonical item kind.
 * @returns The path fragment to append to the kind's route.
 */
export function destinationTail(archivePath: string, kind: PrimitiveKind): string {
  const segments = archivePath.split('/').filter((segment) => segment.length > 0);
  if (segments.length > 1 && normalizePrimitiveKind(segments[0] ?? '') === kind) {
    return segments.slice(1).join('/');
  }
  return segments.at(-1) ?? '';
}

/**
 * Whether a candidate path stays inside a root, lexically.
 *
 * Rejects an absolute candidate, any `..` segment that climbs out, and a root or
 * candidate that is empty. Both inputs are compared with `/` separators so a
 * Windows-style path cannot sidestep the check.
 * @param root - The destination root the candidate must stay inside.
 * @param candidate - The candidate absolute path.
 * @returns True when the candidate resolves inside the root.
 */
export function isContainedPath(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeSeparators(root);
  const normalizedCandidate = normalizeSeparators(candidate);
  if (normalizedRoot.length === 0 || normalizedCandidate.length === 0) {
    return false;
  }
  const rootSegments = resolveSegments(normalizedRoot);
  const candidateSegments = resolveSegments(normalizedCandidate);
  if (rootSegments === null || candidateSegments === null) {
    return false;
  }
  if (candidateSegments.length <= rootSegments.length) {
    return false;
  }
  return rootSegments.every((segment, index) => candidateSegments[index] === segment);
}

/**
 * Compose a destination path under a root, refusing any escape.
 *
 * The relative fragment must be relative and traversal-free: a fragment that is
 * absolute, empty, or climbs out of the root yields `null` so the caller returns
 * `safety-blocked` instead of writing.
 * @param root - Destination root.
 * @param relativeFragment - Route plus item tail, `/`-separated.
 * @returns The contained absolute path, or `null` when it would escape.
 */
export function containedJoin(root: string, relativeFragment: string): string | null {
  const fragment = normalizeSeparators(relativeFragment);
  if (fragment.length === 0 || fragment.startsWith('/') || /^[A-Za-z]:\//.test(fragment)) {
    return null;
  }
  const root_ = normalizeSeparators(root).replace(/\/+$/, '');
  const candidate = `${root_}/${fragment}`;
  const segments = resolveSegments(candidate);
  if (segments === null) {
    return null;
  }
  const resolved = rejoin(candidate, segments);
  return isContainedPath(root_, resolved) ? resolved : null;
}

/**
 * Replace backslashes with `/` so one comparison covers both separator styles.
 * @param value - Raw path.
 * @returns Path with `/` separators.
 */
function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * Resolve `.` and `..` segments without touching the filesystem.
 * @param value - `/`-separated path.
 * @returns The resolved segments, or `null` when the path climbs above its root.
 */
function resolveSegments(value: string): string[] | null {
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/**
 * Rebuild a path from resolved segments, preserving a leading `/`.
 * @param original - The path the segments came from.
 * @param segments - Resolved segments.
 * @returns The rebuilt path.
 */
function rejoin(original: string, segments: readonly string[]): string {
  const joined = segments.join('/');
  return original.startsWith('/') ? `/${joined}` : joined;
}
