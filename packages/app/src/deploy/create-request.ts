/**
 * Construct a validated deploy request from a portable source payload.
 * @module deploy/create-request
 */
import {
  sourceKey as computeSourceKey,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
  PortableBundlePayload,
} from '@ai-primitives-hub/core';
import type {
  DeployRequest,
  PlacementContext,
} from './types';

const archiveDigest = (resolution: BundleResolution): string | undefined => {
  if (resolution.kind === 'pinned'
    && (resolution.provider === 'github-release' || resolution.provider === 'artifactory-object')) {
    return resolution.archiveSha256;
  }
  return resolution.kind === 'unpinned' ? resolution.evidence?.knownDigests?.archiveSha256 : undefined;
};

/**
 * Build the common portable request so delivery commands cannot invent identity or pin rules.
 * @param input Payload and placement/runtime delivery values.
 * @param input.payload
 * @param input.targetName
 * @param input.runtimeAssetRoot
 * @param input.placement
 * @param input.force
 * @returns Request that keeps logical ID separate from manifest ID and preserves archive bytes.
 */
export const createDeployRequest = (input: {
  payload: PortableBundlePayload;
  targetName: string;
  runtimeAssetRoot: string;
  placement: PlacementContext;
  force?: boolean;
}): DeployRequest => ({
  files: input.payload.files,
  ...(input.payload.sourceFiles === undefined ? {} : { sourceFiles: input.payload.sourceFiles }),
  ...(input.payload.bytes === undefined ? {} : { bytes: input.payload.bytes }),
  ...(archiveDigest(input.payload.resolution) === undefined
    ? {}
    : { expectedArchiveSha: `sha256:${archiveDigest(input.payload.resolution)}` }),
  bundle: { bundleId: input.payload.logicalBundleId, version: input.payload.version },
  manifestId: input.payload.manifestId,
  source: {
    sourceKey: computeSourceKey(input.payload.source.identity, input.payload.source.type),
    descriptor: input.payload.source
  },
  resolution: input.payload.resolution,
  targetName: input.targetName,
  runtimeAssetRoot: input.runtimeAssetRoot,
  placement: input.placement,
  ...(input.force === undefined ? {} : { force: input.force })
});
