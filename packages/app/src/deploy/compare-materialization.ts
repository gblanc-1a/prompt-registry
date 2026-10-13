/**
 * Compare portable desired state with a recorded target materialization.
 * @module deploy/compare-materialization
 */
import {
  parseLogicalBundleKey,
  sameArtifactResolution,
} from '@ai-primitives-hub/core';
import type {
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  LockfileV3DesiredEntry,
  ManagedMaterialization,
} from '../stores/lockfile-v3';

/**
 * Compare only the portable identity and artifact actually deployed. Locator display data,
 * layout and other placement configuration deliberately do not participate.
 * @param input Desired and actual state.
 * @param input.key
 * @param input.desired
 * @param input.targetType
 * @param input.actual
 * @param input.actual.key
 * @param input.actual.targetType
 * @param input.actual.record
 * @returns True when the actual record still materializes the desired artifact on this target.
 */
export const sameMaterialization = (input: {
  key: string;
  desired: LockfileV3DesiredEntry;
  targetType: TargetType;
  actual?: {
    key: string;
    targetType: TargetType;
    record: ManagedMaterialization;
  };
}): boolean => {
  const actual = input.actual;
  if (actual === undefined || actual.key !== input.key || actual.targetType !== input.targetType) {
    return false;
  }
  const keyParts = parseLogicalBundleKey(input.key);
  return keyParts !== null
    && keyParts.sourceKey === input.desired.sourceKey
    && keyParts.sourceKey === actual.record.sourceKey
    && input.desired.version === actual.record.version
    && sameArtifactResolution(input.desired.resolution, actual.record.resolution);
};
