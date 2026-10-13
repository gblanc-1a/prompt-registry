import {
  logicalBundleKey,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  sameMaterialization,
} from '../../src/deploy/compare-materialization';

const sourceKey = `src-${'a'.repeat(64)}`;
const otherSourceKey = `src-${'b'.repeat(64)}`;
const key = logicalBundleKey({ sourceKey, logicalBundleId: 'catalog-id' });

const resolution = (overrides: Partial<Extract<BundleResolution, { kind: 'pinned' }>> = {}): BundleResolution => ({
  kind: 'pinned',
  provider: 'github-release',
  version: '1.0.0',
  releaseId: '10',
  assetId: '20',
  archiveSha256: 'a'.repeat(64),
  tag: 'v1.0.0',
  ...overrides
});

const comparison = (overrides: {
  desiredKey?: string;
  sourceKey?: string;
  resolution?: BundleResolution;
  targetType?: 'vscode' | 'cursor';
  actualKey?: string;
  actualSourceKey?: string;
  actualResolution?: BundleResolution;
  actualTargetType?: 'vscode' | 'cursor';
} = {}) => {
  const desiredResolution = overrides.resolution ?? resolution();
  const actualResolution = overrides.actualResolution ?? desiredResolution;
  const desiredSource = overrides.sourceKey ?? sourceKey;
  const actualSource = overrides.actualSourceKey ?? desiredSource;
  const desiredKey = overrides.desiredKey ?? key;
  return {
    key: desiredKey,
    desired: { version: '1.0.0', sourceKey: desiredSource, resolution: desiredResolution },
    targetType: overrides.targetType ?? 'vscode',
    actual: {
      key: overrides.actualKey ?? desiredKey,
      targetType: overrides.actualTargetType ?? 'vscode',
      record: {
        version: '1.0.0',
        sourceKey: actualSource,
        resolution: actualResolution,
        installedAt: '2026-10-13T00:00:00.000Z',
        files: []
      }
    }
  };
};

describe('sameMaterialization', () => {
  it('ignores display-only release tag changes', () => {
    expect(sameMaterialization(comparison({
      actualResolution: resolution({ tag: 'release-1.0.0' })
    }))).toBe(true);
  });

  it('requires matching artifact coordinates and digests at the same version', () => {
    expect(sameMaterialization(comparison({
      actualResolution: resolution({ assetId: '21' })
    }))).toBe(false);
    expect(sameMaterialization(comparison({
      actualResolution: resolution({ archiveSha256: 'b'.repeat(64) })
    }))).toBe(false);
  });

  it('requires the same portable key, source and target type', () => {
    expect(sameMaterialization(comparison({ actualKey: `${sourceKey}/other` }))).toBe(false);
    expect(sameMaterialization(comparison({ actualSourceKey: otherSourceKey }))).toBe(false);
    expect(sameMaterialization(comparison({ targetType: 'vscode', actualTargetType: 'cursor' }))).toBe(false);
  });
});
