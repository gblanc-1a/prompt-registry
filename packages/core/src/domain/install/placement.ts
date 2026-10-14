/**
 * Domain layer — manifest-driven placement.
 *
 * Routing is manifest-driven, always; source-path-prefix routing is
 * retired (design 4.1). Both manifest formats are reached in production
 * — governed release manifests express `items[]` with canonical `kind`
 * and `path`, legacy manifests express `prompts[]` with `type` and
 * `file` plus filename detection — so the shared contract is a
 * **normalized placement item**, not `item.type`: making the legacy
 * shape the contract would bake one of the two formats into the new
 * writer.
 *
 * Destination resolution is pure over an explicit context (design 4.6),
 * which is what lets verification re-derive it rather than re-reading
 * mutable configuration.
 *
 * Three rejection reasons are kept distinct because the writer must
 * treat them differently (design 4.7): `unsupported-by-target` (the
 * layout has no route for this kind), `invalid-kind` (the manifest
 * declared something outside the vocabulary), `filtered` (excluded by
 * `allowedKinds`).
 * @module domain/install/placement
 */
import * as posix from 'node:path/posix';
import type {
  ValidatedManifest,
} from '../collection/manifest-validator';
import {
  isReleaseDeploymentManifest,
} from '../collection/manifest-validator';
import {
  invertKindRoutes,
} from '../primitive/route-kinds';
import type {
  PrimitiveKind,
} from '../primitive/types';
import {
  normalizePrimitiveKind,
} from '../primitive/types';
import {
  destinationNameForKind,
  determineFileType,
  nameShapeForKind,
} from './copilot-file-type';
import type {
  KindRoutes,
} from './layout';

/** A normalized placement item from either manifest format. */
export interface NormalizedPlacementItem {
  /** Manifest item ID. */
  id: string;
  /** Canonical primitive kind. */
  kind: PrimitiveKind;
  /** Bundle-relative source path. */
  sourcePath: string;
}

/** A placement rejection reason. */
export type PlacementRejection = {
  /** Bundle-relative source path. */
  sourcePath: string;
  /** Rejection reason. */
  reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered';
};

/** A resolved placement destination. */
export interface PlacementDestination {
  /** Canonical primitive kind. */
  kind: PrimitiveKind;
  /** Bundle-relative source path. */
  from: string;
  /** Absolute destination path. */
  to: string;
}

/** Context for resolving placements. */
export interface PlacementResolutionContext {
  /** Absolute root of the target. */
  baseRoot: string;
  /** Layout's kind routes. */
  kindRoutes: KindRoutes;
  /** Optional filter of allowed kinds. */
  allowedKinds?: PrimitiveKind[];
}

/** Result of normalizing a manifest's items. */
export interface NormalizeManifestItemsResult {
  /** Normalized placement items. */
  items: NormalizedPlacementItem[];
  /** Items rejected as invalid-kind. */
  rejected: PlacementRejection[];
}

/** Result of resolving destinations. */
export interface ResolveDestinationsResult {
  /** Resolved destinations. */
  destinations: PlacementDestination[];
  /** Items skipped (unsupported-by-target or filtered). */
  skipped: PlacementRejection[];
  /** Destinations claimed by more than one id. */
  duplicates: { to: string; ids: string[] }[];
  /** Unrecognized layout keys. */
  unknownLayoutKeys: string[];
}

/**
 * Normalize a manifest's items into a common placement contract.
 * @param manifest - The validated manifest.
 * @returns Normalized items and any invalid-kind rejections.
 */
export function normalizeManifestItems(
  manifest: ValidatedManifest
): NormalizeManifestItemsResult {
  const items: NormalizedPlacementItem[] = [];
  const rejected: PlacementRejection[] = [];

  if (isReleaseDeploymentManifest(manifest)) {
    // Governed manifest: use canonical items[] with declared kind.
    for (const item of manifest.items ?? []) {
      const kind = normalizePrimitiveKind(item.kind);
      if (kind === null) {
        rejected.push({ sourcePath: item.path, reason: 'invalid-kind' });
        continue;
      }
      items.push({ id: item.id, kind, sourcePath: item.path });
    }
  } else {
    // Legacy manifest: use prompts[] with type and filename detection.
    const prompts = manifest.prompts as {
      id: string;
      file: string;
      type?: string;
      tags?: string[];
    }[] | undefined;
    for (const prompt of prompts ?? []) {
      let kindStr: string;
      if (prompt.type) {
        kindStr = prompt.type;
      } else {
        const fileType = determineFileType(prompt.file, prompt.tags);
        kindStr = fileType;
      }
      const kind = normalizePrimitiveKind(kindStr);
      if (kind === null) {
        rejected.push({ sourcePath: prompt.file, reason: 'invalid-kind' });
        continue;
      }
      items.push({ id: prompt.id, kind, sourcePath: prompt.file });
    }
  }

  return { items, rejected };
}

/**
 * Resolve destinations for normalized placement items.
 * @param items - Normalized placement items.
 * @param context - Placement context (baseRoot, kindRoutes, allowedKinds).
 * @returns Destinations, skipped items, duplicates, and unknown layout keys.
 */
export function resolveDestinations(
  items: NormalizedPlacementItem[],
  context: PlacementResolutionContext
): ResolveDestinationsResult {
  const { baseRoot, kindRoutes, allowedKinds } = context;
  const { byKind, unknownKeys } = invertKindRoutes(kindRoutes);

  const destinations: PlacementDestination[] = [];
  const skipped: PlacementRejection[] = [];
  const destinationMap = new Map<string, string[]>();

  for (const item of items) {
    // 1. Check allowedKinds filter first.
    if (allowedKinds && !allowedKinds.includes(item.kind)) {
      skipped.push({ sourcePath: item.sourcePath, reason: 'filtered' });
      continue;
    }

    // 2. Check if the layout has a route for this kind.
    const outputDir = byKind.get(item.kind);
    if (outputDir === undefined) {
      skipped.push({ sourcePath: item.sourcePath, reason: 'unsupported-by-target' });
      continue;
    }

    // 3. Check if this kind is placed (nameShapeForKind).
    if (nameShapeForKind(item.kind) === 'not-placed') {
      skipped.push({ sourcePath: item.sourcePath, reason: 'unsupported-by-target' });
      continue;
    }

    // 4. Compute destination.
    const basename = posix.basename(item.sourcePath);
    const destinationName = destinationNameForKind(item.kind, item.id, basename);
    if (destinationName === null) {
      skipped.push({ sourcePath: item.sourcePath, reason: 'unsupported-by-target' });
      continue;
    }

    const to = posix.join(baseRoot, outputDir, destinationName);
    destinations.push({ kind: item.kind, from: item.sourcePath, to });

    // Track for duplicate detection.
    const ids = destinationMap.get(to) ?? [];
    ids.push(item.id);
    destinationMap.set(to, ids);
  }

  // Find duplicates.
  const duplicates: { to: string; ids: string[] }[] = [];
  for (const [to, ids] of destinationMap) {
    if (ids.length > 1) {
      duplicates.push({ to, ids });
    }
  }

  return {
    destinations,
    skipped,
    duplicates,
    unknownLayoutKeys: unknownKeys
  };
}
