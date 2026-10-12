import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  assertResolutionVersion,
  sameArtifactResolution,
} from '../../../src/domain/bundle/resolution';
import type {
  BundleResolution,
} from '../../../src/domain/bundle/resolution';
import {
  RegistryError,
} from '../../../src/domain/registry-error';

const releaseResolution = (
  tag: string,
  assetId = 'asset-9',
  archiveSha256 = 'a'.repeat(64)
): BundleResolution => ({
  kind: 'pinned',
  provider: 'github-release',
  version: '1.2.3',
  releaseId: 'release-7',
  assetId,
  archiveSha256,
  tag
});

describe('artifact resolution', () => {
  it('treats a display-only release tag change as the same artifact', () => {
    expect(sameArtifactResolution(
      releaseResolution('v1.2.3'),
      releaseResolution('release-1.2.3')
    )).toBe(true);
  });

  it('distinguishes same-version artifacts when a selected asset or digest changes', () => {
    expect(sameArtifactResolution(
      releaseResolution('v1.2.3'),
      releaseResolution('v1.2.3', 'asset-10')
    )).toBe(false);
    expect(sameArtifactResolution(
      releaseResolution('v1.2.3'),
      releaseResolution('v1.2.3', 'asset-9', 'b'.repeat(64))
    )).toBe(false);
  });

  it('distinguishes pinned tree content at the same manifest version', () => {
    const first: BundleResolution = {
      kind: 'pinned',
      provider: 'github-tree',
      version: '1.2.3',
      commitSha: '1111111111111111111111111111111111111111',
      bundlePath: 'collections/example',
      sourceContentSha256: 'a'.repeat(64)
    };
    const changed: BundleResolution = {
      ...first,
      sourceContentSha256: 'b'.repeat(64)
    };
    expect(sameArtifactResolution(first, changed)).toBe(false);
  });

  it('compares Artifactory published-object coordinates and local snapshot content', () => {
    const artifactory: BundleResolution = {
      kind: 'pinned',
      provider: 'artifactory-object',
      version: '1.2.3',
      manifestPath: 'bundles/example/deployment-manifest.yml',
      manifestSize: 80,
      manifestSha256: 'a'.repeat(64),
      archivePath: 'bundles/example/1.2.3.zip',
      archiveSize: 1024,
      archiveSha256: 'b'.repeat(64)
    };
    expect(sameArtifactResolution(artifactory, {
      ...artifactory,
      archiveSize: 1025
    })).toBe(false);

    const snapshot: BundleResolution = {
      kind: 'pinned',
      provider: 'local-snapshot',
      version: '1.2.3',
      bundleSelector: 'example',
      sourceContentSha256: 'c'.repeat(64)
    };
    expect(sameArtifactResolution(snapshot, {
      ...snapshot,
      sourceContentSha256: 'd'.repeat(64)
    })).toBe(false);
  });

  it('compares live bundle selectors without claiming an immutable pin', () => {
    expect(sameArtifactResolution(
      { kind: 'live', selector: 'skills/example' },
      { kind: 'live', selector: 'skills/example' }
    )).toBe(true);
    expect(sameArtifactResolution(
      { kind: 'live', selector: 'skills/example' },
      { kind: 'live', selector: 'skills/other' }
    )).toBe(false);
  });

  it('rejects a version that disagrees with verified resolution evidence', () => {
    expect(() => assertResolutionVersion(releaseResolution('v1.2.3'), '2.0.0'))
      .toThrow(RegistryError);
  });

  it('does not invent a historical version pin for unpinned evidence', () => {
    const legacy: BundleResolution = {
      kind: 'unpinned',
      reason: 'Historical artifact coordinates were not recorded.'
    };
    expect(() => assertResolutionVersion(legacy, '1.2.3')).not.toThrow();
    expect(legacy).toEqual({
      kind: 'unpinned',
      reason: 'Historical artifact coordinates were not recorded.'
    });
  });

  it('checks a known manifest version retained on an unpinned resolution', () => {
    const legacy: BundleResolution = {
      kind: 'unpinned',
      reason: 'The provider did not expose a complete artifact pin.',
      evidence: { manifestVersion: '1.2.3', knownDigests: { archiveSha256: 'a'.repeat(64) } }
    };
    expect(() => assertResolutionVersion(legacy, '1.2.3')).not.toThrow();
    expect(() => assertResolutionVersion(legacy, '2.0.0')).toThrow(RegistryError);
  });
});
