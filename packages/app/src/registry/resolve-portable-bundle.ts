/**
 * Shared orchestration for portable source acquisition.
 * @module registry/resolve-portable-bundle
 */
import {
  createHash,
} from 'node:crypto';
import {
  assertResolutionSourceCompatibility,
  assertResolutionVersion,
  assertSourceKey,
  RegistryError,
  sameSourceIdentity,
  sourceContentDigest,
  sourceKey,
} from '@ai-primitives-hub/core';
import type {
  PortableBundlePayload,
  PortableBundleSelection,
  RegistrySource,
} from '@ai-primitives-hub/core';
import type {
  SourceAdapterFactoryDeps,
} from './create-source-adapter';
import {
  createSourceAdapter,
} from './create-source-adapter';

const unsupported = (source: RegistrySource): RegistryError => new RegistryError({
  code: 'BUNDLE.UNSUPPORTED_PORTABLE_RESOLUTION',
  message: `Source "${source.name}" (${source.type}) does not support portable bundle resolution.`,
  hint: 'Use a retained source adapter that implements resolvePortableBundle, or disable unifiedDeploy for this source.'
});

const missing = (source: RegistrySource, bundleId: string, version?: string): RegistryError => new RegistryError({
  code: 'BUNDLE.PORTABLE_BUNDLE_NOT_FOUND',
  message: `Bundle "${bundleId}"${version === undefined ? '' : `@${version}`} was not found in source "${source.name}".`,
  hint: 'Check the configured source and exact bundle selector; pinned replay never falls back to another version.'
});

const integrityError = (detail: string): RegistryError => new RegistryError({
  code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
  message: detail,
  hint: 'Restore the artifact matching the recorded digest or explicitly resolve a new version.'
});

const expectedArchiveDigest = (payload: PortableBundlePayload): string | undefined => {
  if (payload.resolution.kind === 'pinned') {
    if (payload.resolution.provider === 'github-release' || payload.resolution.provider === 'artifactory-object') {
      return payload.resolution.archiveSha256;
    }
    return undefined;
  }
  return payload.resolution.kind === 'unpinned'
    ? payload.resolution.evidence?.knownDigests?.archiveSha256
    : undefined;
};

const expectedContentDigest = (payload: PortableBundlePayload): string | undefined => {
  if (payload.resolution.kind === 'pinned') {
    return payload.resolution.provider === 'github-tree'
      || payload.resolution.provider === 'azure-devops-tree'
      || payload.resolution.provider === 'local-snapshot'
      ? payload.resolution.sourceContentSha256
      : undefined;
  }
  return payload.resolution.kind === 'unpinned'
    ? payload.resolution.evidence?.knownDigests?.sourceContentSha256
    : undefined;
};

/**
 * Resolve a configured source selection and verify its returned portable identity and content
 * before the payload can be passed to deployment.
 * @param source - Explicit delivery configuration for the source.
 * @param selection - Logical bundle, exact version and optional replay evidence.
 * @param deps - Source adapter factory dependencies supplied by the delivery layer.
 * @returns Verified portable payload, including original archive bytes where applicable.
 */
export const resolvePortableBundle = async (
  source: RegistrySource,
  selection: PortableBundleSelection,
  deps: SourceAdapterFactoryDeps
): Promise<PortableBundlePayload> => {
  const adapter = createSourceAdapter(source, deps);
  if (typeof adapter.resolvePortableBundle !== 'function') {
    throw unsupported(source);
  }
  const payload = await adapter.resolvePortableBundle(selection);
  if (payload === null) {
    throw missing(source, selection.bundleId, selection.version);
  }

  if (typeof payload.logicalBundleId !== 'string' || payload.logicalBundleId.trim() === '') {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_LOGICAL_KEY',
      message: 'Portable bundle resolution did not return a logical bundle ID.'
    });
  }
  if (typeof payload.manifestId !== 'string' || payload.manifestId.trim() === '') {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_DEPLOYMENT_MANIFEST',
      message: 'Portable bundle resolution did not return a manifest ID.'
    });
  }
  if (selection.version !== undefined && selection.version !== 'latest' && payload.version !== selection.version) {
    throw new RegistryError({
      code: 'BUNDLE.RESOLUTION_VERSION_MISMATCH',
      message: `Resolved version "${payload.version}" does not match requested version "${selection.version}".`,
      hint: 'Resolve the exact requested version; do not substitute latest.'
    });
  }
  assertSourceKey(sourceKey(payload.source.identity, payload.source.type), payload.source);
  assertResolutionSourceCompatibility(payload.source, payload.resolution);
  assertResolutionVersion(payload.resolution, payload.version);
  if (selection.expectedSource !== undefined && !sameSourceIdentity(payload.source, selection.expectedSource)) {
    throw new RegistryError({
      code: 'BUNDLE.SOURCE_IDENTITY_MISMATCH',
      message: 'Resolved source identity does not match the portable source recorded for this bundle.',
      hint: 'Bind the configured source to the recorded provider identity before retrying.'
    });
  }

  const archiveDigest = expectedArchiveDigest(payload);
  if (archiveDigest !== undefined) {
    if (payload.bytes === undefined) {
      throw new RegistryError({
        code: 'BUNDLE.UNSUPPORTED_INTEGRITY_CHECK',
        message: `The ${payload.resolution.kind === 'pinned' ? payload.resolution.provider : 'unpinned'} archive digest cannot be verified because the adapter did not return original archive bytes.`
      });
    }
    const rawSha = createHash('sha256').update(payload.bytes).digest('hex');
    if (rawSha !== archiveDigest) {
      throw integrityError(`Resolved archive digest ${rawSha} does not match recorded SHA-256 ${archiveDigest}.`);
    }
  }

  const contentDigest = expectedContentDigest(payload);
  if (contentDigest !== undefined && sourceContentDigest(payload.sourceFiles ?? payload.files) !== contentDigest) {
    throw integrityError('Resolved source files do not match the recorded source-content SHA-256 digest.');
  }

  const manifestDigest = payload.resolution.kind === 'unpinned'
    ? payload.resolution.evidence?.knownDigests?.manifestSha256
    : undefined;
  if (manifestDigest !== undefined) {
    const manifestBytes = payload.files.get('deployment-manifest.yml');
    if (manifestBytes === undefined) {
      throw new RegistryError({
        code: 'BUNDLE.UNSUPPORTED_INTEGRITY_CHECK',
        message: 'The recorded manifest SHA-256 cannot be verified because the resolved files do not include deployment-manifest.yml.'
      });
    }
    const actual = createHash('sha256').update(manifestBytes).digest('hex');
    if (actual !== manifestDigest) {
      throw integrityError('Resolved deployment manifest does not match the recorded raw-byte SHA-256 digest.');
    }
  }

  return payload;
};
