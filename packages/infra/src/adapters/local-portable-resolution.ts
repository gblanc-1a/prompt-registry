/**
 * Portable identity and raw-file acquisition for retained local adapters.
 * @module adapters/local-portable-resolution
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  assertResolutionSourceCompatibility,
  assertResolutionVersion,
  RegistryError,
  sameSourceIdentity,
  sourceContentDigest,
  sourceKey,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
  DirEntry,
  ExtractedFiles,
  FileSystem,
  LocalSourceLocation,
  PortableBundleSelection,
  PortableSourceDescriptor,
  RegistrySource,
  RetainedSourceType,
  SourceIdentity,
} from '@ai-primitives-hub/core';
import {
  isValidLocalUrl,
  resolveLocalPath,
} from './local-path';

const LOCAL_TYPES = new Set<RegistrySource['type']>(['local', 'local-awesome-copilot', 'local-skills']);

const localResolutionError = (code: string, message: string, hint: string): RegistryError => new RegistryError({
  code,
  message,
  hint
});

const requireLocalType = (source: RegistrySource): RetainedSourceType => {
  if (!LOCAL_TYPES.has(source.type)) {
    throw localResolutionError(
      'BUNDLE.INVALID_SOURCE_IDENTITY',
      `Source type "${source.type}" is not a retained local adapter.`,
      'Use local, local-awesome-copilot, or local-skills with an explicit runtime location.'
    );
  }
  return source.type as RetainedSourceType;
};

const requireAbsoluteRoot = (root: string, label: string): string => {
  if (root.trim() === '' || root.includes('\0') || !path.isAbsolute(root)) {
    throw localResolutionError(
      'CONFIG.INVALID_SOURCE_LOCATOR',
      `${label} must be an absolute filesystem path supplied by the runtime configuration.`,
      'Pass the selected workspace root or the explicit local binding root; relative paths are not resolved against process CWD.'
    );
  }
  return path.resolve(root);
};

const effectiveSelector = (
  source: RegistrySource,
  key: 'collectionsPath' | 'skillsPath',
  fallback: string
): string => {
  const value = source.config?.[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw localResolutionError(
      'BUNDLE.INVALID_SOURCE_IDENTITY',
      `Local source selector "${key}" must be a non-empty relative path.`,
      'Configure a canonical relative POSIX path for the local source selector.'
    );
  }
  return value;
};

const sourceRelativeToWorkspace = (source: RegistrySource, workspaceRoot: string): string => {
  if (!isValidLocalUrl(source.url)) {
    throw localResolutionError(
      'CONFIG.INVALID_SOURCE_LOCATOR',
      `Configured local source locator ${JSON.stringify(source.url)} is not a supported filesystem path.`,
      'Use a file URL, absolute path, ~/ path, or ./ path in the local source configuration.'
    );
  }
  const resolvedSourcePath = resolveLocalPath(source.url);
  const absoluteSourceRoot = path.isAbsolute(resolvedSourcePath)
    ? path.resolve(resolvedSourcePath)
    : path.resolve(workspaceRoot, resolvedSourcePath);
  const relative = path.relative(workspaceRoot, absoluteSourceRoot);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw localResolutionError(
      'CONFIG.INVALID_SOURCE_LOCATOR',
      `Configured local source path ${JSON.stringify(source.url)} is outside the selected workspace.`,
      'Select a source inside the workspace or configure it through an explicit named local binding.'
    );
  }
  return relative === '' ? '.' : relative.split(path.sep).join('/');
};

const requireAssociatedBindingRoot = (source: RegistrySource, location: Extract<LocalSourceLocation, { kind: 'binding' }>): string => {
  const bindingRoot = requireAbsoluteRoot(location.root, 'Explicit local binding root');
  const configuredPath = resolveLocalPath(source.url);
  if (!path.isAbsolute(configuredPath)) {
    throw localResolutionError(
      'CONFIG.UNVERIFIABLE_LOCAL_BINDING',
      `Relative configured source ${JSON.stringify(source.url)} cannot be associated with external binding "${location.name}" without a workspace root.`,
      'Resolve the source with its selected workspace root or configure an absolute source path that matches the explicit binding root.'
    );
  }
  if (path.resolve(configuredPath) !== bindingRoot) {
    throw localResolutionError(
      'CONFIG.CONFLICTING_LOCAL_BINDING',
      `Explicit local binding "${location.name}" points to ${JSON.stringify(bindingRoot)}, but the configured source points to ${JSON.stringify(path.resolve(configuredPath))}.`,
      'Update the delivery source configuration or binding so both identify the same local source root.'
    );
  }
  return bindingRoot;
};

/**
 * Resolve a configured local source to a portable descriptor without storing its runtime root.
 * @param source - Delivery configuration for a retained local adapter.
 * @param location - Selected workspace root or explicit named runtime binding.
 */
export const resolveLocalSourceIdentity = (
  source: RegistrySource,
  location: LocalSourceLocation
): PortableSourceDescriptor => {
  const type = requireLocalType(source);
  if (!isValidLocalUrl(source.url)) {
    throw localResolutionError(
      'CONFIG.INVALID_SOURCE_LOCATOR',
      `Configured local source locator ${JSON.stringify(source.url)} is not a supported filesystem path.`,
      'Use a file URL, absolute path, ~/ path, or ./ path in the local source configuration.'
    );
  }
  let identity: SourceIdentity;
  if (location.kind === 'workspace') {
    const workspaceRoot = requireAbsoluteRoot(location.root, 'Selected workspace root');
    identity = {
      kind: 'workspace-local',
      root: sourceRelativeToWorkspace(source, workspaceRoot),
      ...(type === 'local-awesome-copilot'
        ? { collectionsPath: effectiveSelector(source, 'collectionsPath', 'collections') }
        : {}),
      ...(type === 'local-skills'
        ? { skillsPath: effectiveSelector(source, 'skillsPath', 'skills') }
        : {})
    };
  } else if (location.kind === 'binding') {
    requireAssociatedBindingRoot(source, location);
    identity = {
      kind: 'external-local',
      bindingName: location.name,
      ...(type === 'local-awesome-copilot'
        ? { collectionsPath: effectiveSelector(source, 'collectionsPath', 'collections') }
        : {}),
      ...(type === 'local-skills'
        ? { skillsPath: effectiveSelector(source, 'skillsPath', 'skills') }
        : {})
    };
  } else {
    throw localResolutionError(
      'CONFIG.MISSING_LOCAL_BINDING',
      'A selected workspace root or an explicit local binding is required to resolve this local source.',
      'Pass localLocation with kind "workspace" and an absolute root, or kind "binding" with an explicit name and root.'
    );
  }

  sourceKey(identity, type);
  const locator = identity.kind === 'workspace-local' ? identity.root : identity.bindingName;
  return { type, identity, locator };
};

/**
 * Resolve the actual acquisition root. Workspace-relative source URLs are anchored to the supplied workspace.
 * @param source - Delivery configuration for a retained local adapter.
 * @param location - Selected workspace root or explicit named runtime binding.
 */
export const resolveLocalSourceRoot = (
  source: RegistrySource,
  location: LocalSourceLocation
): string => {
  requireLocalType(source);
  if (location.kind === 'workspace') {
    const workspaceRoot = requireAbsoluteRoot(location.root, 'Selected workspace root');
    const relativeRoot = sourceRelativeToWorkspace(source, workspaceRoot);
    return relativeRoot === '.' ? workspaceRoot : path.resolve(workspaceRoot, ...relativeRoot.split('/'));
  }
  if (location.kind === 'binding') {
    return requireAssociatedBindingRoot(source, location);
  }
  throw localResolutionError(
    'CONFIG.MISSING_LOCAL_BINDING',
    'A selected workspace root or an explicit local binding is required to resolve this local source.',
    'Pass localLocation with kind "workspace" and an absolute root, or kind "binding" with an explicit name and root.'
  );
};

export interface ResolvedLocalSource {
  source: PortableSourceDescriptor;
  root: string;
}

/**
 * Resolve a local source and validate the recorded identity against this machine's configuration.
 * @param source - Delivery configuration for a retained local adapter.
 * @param location - Selected workspace root or explicit named runtime binding.
 * @param expectedSource - Previously recorded portable descriptor, when replaying desired state.
 */
export const resolveLocalSource = (
  source: RegistrySource,
  location: LocalSourceLocation | undefined,
  expectedSource?: PortableSourceDescriptor
): ResolvedLocalSource => {
  if (location === undefined) {
    throw localResolutionError(
      'CONFIG.MISSING_LOCAL_BINDING',
      'A selected workspace root or an explicit local binding is required to resolve this local source.',
      'Pass localLocation with kind "workspace" and an absolute root, or kind "binding" with an explicit name and root.'
    );
  }
  const portableSource = resolveLocalSourceIdentity(source, location);
  if (expectedSource !== undefined && !sameSourceIdentity(portableSource, expectedSource)) {
    throw localResolutionError(
      'BUNDLE.SOURCE_IDENTITY_MISMATCH',
      `Configured local source does not match recorded portable identity ${JSON.stringify(expectedSource.identity)}.`,
      'Check the source selectors and selected workspace root or explicit binding name against the lockfile.'
    );
  }
  return {
    source: portableSource,
    root: resolveLocalSourceRoot(source, location)
  };
};

const invalidInventoryPath = (name: string): RegistryError => localResolutionError(
  'BUNDLE.INVALID_SOURCE_CONTENT_PATH',
  `Local source entry ${JSON.stringify(name)} is not a portable file or directory name.`,
  'Local source inventories support canonical POSIX-relative paths only.'
);

const assertSafeLocalSourceRoot = async (fs: FileSystem, root: string): Promise<string> => {
  if (root.trim() === '' || !path.isAbsolute(root)) {
    throw localResolutionError(
      'CONFIG.INVALID_SOURCE_LOCATOR',
      'Local source inventory root must be an absolute filesystem path.',
      'Resolve local source paths against the selected workspace root or explicit binding; do not use process CWD.'
    );
  }
  const absoluteRoot = path.resolve(root);
  const fileSystemRoot = path.parse(absoluteRoot).root;
  const components = absoluteRoot.slice(fileSystemRoot.length).split(path.sep).filter(Boolean);
  const directories: string[] = [];
  let currentDirectory = fileSystemRoot;
  for (const component of components) {
    currentDirectory = path.join(currentDirectory, component);
    directories.push(currentDirectory);
  }
  if (directories.length === 0) {
    directories.push(fileSystemRoot);
  }
  let rootStat;
  try {
    for (const directory of directories) {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink) {
        throw localResolutionError(
          'FS.LOCAL_SOURCE_UNAVAILABLE',
          `Local source root ${JSON.stringify(absoluteRoot)} traverses symbolic-link ancestor ${JSON.stringify(directory)}.`,
          'Configure the real source directory path instead of a path beneath a symbolic link.'
        );
      }
      if (directory !== absoluteRoot && !stat.isDirectory) {
        throw localResolutionError(
          'FS.LOCAL_SOURCE_UNAVAILABLE',
          `Local source root ${JSON.stringify(absoluteRoot)} has non-directory ancestor ${JSON.stringify(directory)}.`,
          'Configure an existing directory path for the local source.'
        );
      }
      rootStat = stat;
    }
  } catch (error) {
    if (error instanceof RegistryError) {
      throw error;
    }
    throw localResolutionError(
      'FS.LOCAL_SOURCE_UNAVAILABLE',
      `Cannot inspect local source root ${JSON.stringify(absoluteRoot)}: ${error instanceof Error ? error.message : String(error)}`,
      'Check that the configured local source exists and is readable.'
    );
  }
  if (rootStat === undefined || rootStat.isSymbolicLink || !rootStat.isDirectory) {
    throw localResolutionError(
      'FS.LOCAL_SOURCE_UNAVAILABLE',
      `Local source root ${JSON.stringify(absoluteRoot)} must be a directory and cannot itself be a symbolic link.`,
      'Configure the real source directory as the workspace path or explicit local binding root.'
    );
  }
  return absoluteRoot;
};

/**
 * List direct children of a source root after checking every ancestor for symlinks.
 * @param fs - Injected filesystem boundary.
 * @param root - Absolute local source root.
 */
export const readLocalSourceEntries = async (fs: FileSystem, root: string): Promise<DirEntry[]> => {
  const absoluteRoot = await assertSafeLocalSourceRoot(fs, root);
  return await fs.readDirEntries(absoluteRoot);
};

/**
 * Read a source tree as raw bytes while refusing to traverse symbolic links.
 * @param fs - Injected filesystem boundary.
 * @param root - Absolute local source root.
 */
export const readLocalSourceFiles = async (fs: FileSystem, root: string): Promise<Map<string, Uint8Array>> => {
  const absoluteRoot = await assertSafeLocalSourceRoot(fs, root);

  const files = new Map<string, Uint8Array>();
  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await fs.readDirEntries(directory);
    for (const entry of entries) {
      if (entry.name.length === 0 || entry.name === '.' || entry.name === '..'
        || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')) {
        throw invalidInventoryPath(entry.name);
      }
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink) {
        continue;
      }
      if (stat.isDirectory) {
        await walk(absolutePath, relativePath);
      } else if (stat.isFile) {
        files.set(relativePath, await fs.readFileBytes(absolutePath));
      }
    }
  };
  await walk(absoluteRoot, '');
  return files;
};

/**
 * Copy source-root-relative files beneath a selected directory into bundle-relative names.
 * @param files
 * @param directory
 */
export const filesBelow = (files: ExtractedFiles, directory: string): Map<string, Uint8Array> => {
  const prefix = `${directory}/`;
  return new Map(
    [...files]
      .filter(([filePath]) => filePath.startsWith(prefix))
      .map(([filePath, bytes]) => [filePath.slice(prefix.length), bytes])
  );
};

/**
 * Check source-family compatibility before local acquisition begins.
 * @param source - Resolved portable source.
 * @param resolution - Previously recorded resolution, if any.
 */
export const assertLocalResolutionCompatible = (
  source: PortableSourceDescriptor,
  resolution: BundleResolution | undefined
): void => {
  if (resolution === undefined) {
    return;
  }
  assertResolutionSourceCompatibility(source, resolution);
  if (source.type === 'local-skills' && resolution.kind !== 'live') {
    throw localResolutionError(
      'BUNDLE.RESOLUTION_SOURCE_MISMATCH',
      'local-skills selections must remain live and cannot be replayed as local snapshots.',
      'Use a live resolution for local-skills; use local or local-awesome-copilot for pinned local snapshots.'
    );
  }
  if (resolution.kind === 'unpinned' && source.type !== 'local-skills') {
    const unsupportedDigests = Object.keys(resolution.evidence?.knownDigests ?? {})
      .filter((name) => !['sourceContentSha256', 'manifestSha256'].includes(name));
    if (unsupportedDigests.length > 0) {
      throw localResolutionError(
        'BUNDLE.UNSUPPORTED_DIGEST_EVIDENCE',
        `Local snapshot resolution cannot verify recorded digest evidence: ${unsupportedDigests.join(', ')}.`,
        'Retain the evidence and use an acquisition path that can verify those digest kinds; do not discard or replace them.'
      );
    }
  }
};

/**
 * Return the recorded local bundle selector, if the supplied evidence has one.
 * @param resolution - Previously recorded resolution, if any.
 */
export const recordedLocalBundleSelector = (resolution: BundleResolution | undefined): string | undefined => {
  if (resolution?.kind === 'pinned' && resolution.provider === 'local-snapshot') {
    return resolution.bundleSelector;
  }
  if (resolution?.kind === 'unpinned') {
    return resolution.evidence?.knownPins?.bundleSelector;
  }
  return undefined;
};

/**
 * Verify a selected local bundle and produce either a digest pin or the local-skills live marker.
 * @param source - Resolved portable source.
 * @param selection - Requested bundle and optional replay evidence.
 * @param selector - Adapter-specific portable bundle selector.
 * @param version - Version parsed from the selected source manifest.
 * @param files - Raw selected source inventory, before deployment transformations.
 * @param manifestBytes
 */
export const resolveLocalBundleResolution = (
  source: PortableSourceDescriptor,
  selection: PortableBundleSelection,
  selector: string,
  version: string,
  files: ExtractedFiles,
  manifestBytes?: Uint8Array
): BundleResolution => {
  const recorded = selection.resolution;
  assertLocalResolutionCompatible(source, recorded);

  if (source.type === 'local-skills') {
    if (recorded?.kind === 'live' && recorded.selector !== selector) {
      throw localResolutionError(
        'BUNDLE.ARTIFACT_PIN_MISMATCH',
        `Recorded live skill selector ${JSON.stringify(recorded.selector)} does not match selected skill ${JSON.stringify(selector)}.`,
        'Resolve the exact local skill path recorded in the live selection.'
      );
    }
    return { kind: 'live', selector };
  }

  if (selection.version !== undefined && selection.version !== 'latest' && selection.version !== version) {
    throw localResolutionError(
      'BUNDLE.RESOLUTION_VERSION_MISMATCH',
      `Requested version "${selection.version}" does not match local manifest version "${version}".`,
      'Select the exact version available in the configured local source.'
    );
  }
  if (recorded !== undefined) {
    assertResolutionVersion(recorded, version);
    const recordedSelector = recordedLocalBundleSelector(recorded);
    if (recordedSelector !== undefined && recordedSelector !== selector) {
      throw localResolutionError(
        'BUNDLE.ARTIFACT_PIN_MISMATCH',
        `Selected local bundle selector ${JSON.stringify(selector)} does not match recorded selector ${JSON.stringify(recordedSelector)}.`,
        'Resolve the exact local bundle path recorded in the snapshot pin.'
      );
    }
  }

  const expectedManifestDigest = recorded?.kind === 'unpinned'
    ? recorded.evidence?.knownDigests?.manifestSha256
    : undefined;
  if (expectedManifestDigest !== undefined) {
    if (manifestBytes === undefined) {
      throw localResolutionError(
        'BUNDLE.UNSUPPORTED_DIGEST_EVIDENCE',
        'Local snapshot resolution cannot verify the recorded raw manifest SHA-256 digest.',
        'Retain the evidence and use an acquisition path that exposes the selected source manifest bytes.'
      );
    }
    const manifestDigest = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    if (expectedManifestDigest !== manifestDigest) {
      throw localResolutionError(
        'BUNDLE.ARTIFACT_PIN_MISMATCH',
        `Local source manifest for ${JSON.stringify(selector)} does not match its recorded raw-byte SHA-256 digest.`,
        'Restore the recorded source manifest or explicitly resolve a new local snapshot.'
      );
    }
  }

  const digest = sourceContentDigest(files);
  const expectedDigest = recorded?.kind === 'pinned' && recorded.provider === 'local-snapshot'
    ? recorded.sourceContentSha256
    : (recorded?.kind === 'unpinned'
      ? recorded.evidence?.knownDigests?.sourceContentSha256
      : undefined);
  if (expectedDigest !== undefined && expectedDigest !== digest) {
    throw localResolutionError(
      'BUNDLE.ARTIFACT_PIN_MISMATCH',
      `Local source content for ${JSON.stringify(selector)} does not match its recorded SHA-256 digest.`,
      'Restore the recorded source content or explicitly resolve a new local snapshot.'
    );
  }

  return {
    kind: 'pinned',
    provider: 'local-snapshot',
    version,
    bundleSelector: selector,
    sourceContentSha256: digest
  };
};
