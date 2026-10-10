import * as posix from 'node:path/posix';
import {
  decodeUtf8Strict,
  getInstallableBundleFiles,
  nameShapeForKind,
  normalizeManifestItems,
  RegistryError,
  resolveDestinations,
  validateManifest,
} from '@ai-primitives-hub/core';
import type {
  PlacementDestination,
} from '@ai-primitives-hub/core';
import type {
  DeployPorts,
  DeployRequest,
} from './types';

/** One validated physical file, shared by planning, placement and recording. */
export interface DeployFile extends PlacementDestination {
  sourceBytes: Uint8Array;
  installedBytes: Uint8Array;
}

/**
 * Expand validated, role-filtered directory inventories and retain the first claim
 * to each physical destination. Directory entries never grant ownership of siblings.
 * @param req Deployment request.
 * @param ports Transformer boundary.
 * @returns Resolved items and their physical file inventory.
 */
export function prepareDeployFiles(req: DeployRequest, ports: DeployPorts) {
  if (req.files === undefined) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
      message: 'Archive extraction not yet implemented in slice 1'
    });
  }
  const manifest = validateManifest(req.files, {});
  const installable = getInstallableBundleFiles(req.files, manifest);
  const normalized = normalizeManifestItems(manifest);
  const resolved = resolveDestinations(normalized.items, {
    baseRoot: req.placement.baseRoot,
    kindRoutes: req.placement.resolvedLayout.kindRoutes,
    allowedKinds: req.placement.allowedKinds
  });
  const files: DeployFile[] = [];
  const seen = new Map<string, string>();
  const duplicates = [...resolved.duplicates];
  const destinations: PlacementDestination[] = [];
  const seenItems = new Set<string>();
  for (const dest of resolved.destinations) {
    if (seenItems.has(dest.to)) {
      continue;
    }
    seenItems.add(dest.to);
    destinations.push(dest);
    const id = normalized.items.find((item) => item.sourcePath === dest.from && item.kind === dest.kind)?.id ?? dest.from;
    const directory = nameShapeForKind(dest.kind) === 'directory';
    const dirname = posix.dirname(dest.from);
    const prefix = dirname === '.' ? '' : `${dirname}/`;
    const subtree = directory
      ? [...installable].filter(([from]) => from !== 'deployment-manifest.yml' && from.startsWith(prefix))
      : [...installable].filter(([from]) => from === dest.from);
    if (directory && subtree.length === 0) {
      throw new RegistryError({
        code: 'BUNDLE.INVALID_DEPLOY_REQUEST',
        message: `Cannot deploy directory "${dest.to}": its installable inventory is empty`
      });
    }
    for (const [from, sourceBytes] of subtree) {
      const to = directory ? posix.join(dest.to, from.slice(prefix.length)) : dest.to;
      if (seen.has(to)) {
        const duplicate = duplicates.find((entry) => entry.to === to);
        if (duplicate === undefined) {
          duplicates.push({ to, ids: [seen.get(to)!, id] });
        } else if (!duplicate.ids.includes(id)) {
          duplicate.ids.push(id);
        }
        continue;
      }
      seen.set(to, id);
      let installedBytes = sourceBytes;
      const text = directory ? null : decodeUtf8Strict(sourceBytes);
      if (text !== null && ports.transformer !== undefined) {
        try {
          const result = ports.transformer.transform({
            target: { name: req.targetName, type: req.placement.targetType, scope: req.placement.scope },
            filePath: from,
            content: text
          });
          installedBytes = new TextEncoder().encode(result.content);
        } catch {
          // Preserve the existing untransformed fallback.
        }
      }
      files.push({ kind: dest.kind, from, to, sourceBytes, installedBytes });
    }
  }
  return {
    files,
    destinations,
    skipped: [...normalized.rejected, ...resolved.skipped].map((entry) => ({
      from: entry.sourcePath, reason: entry.reason
    })),
    duplicates,
    unknownLayoutKeys: resolved.unknownLayoutKeys
  };
}
