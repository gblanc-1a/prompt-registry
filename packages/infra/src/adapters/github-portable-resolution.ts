/**
 * Shared GitHub identity and immutable-ref helpers for retained source adapters.
 * @module adapters/github-portable-resolution
 */
import type {
  GitHubApi,
  PortableSourceDescriptor,
  RegistrySource,
} from '@ai-primitives-hub/core';
import {
  isCredentialFreeHttpUrl,
  RegistryError,
} from '@ai-primitives-hub/core';

interface GitHubRepository {
  id: number | string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches the GitHub REST API response shape
  full_name?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches the GitHub REST API response shape
  html_url?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches the GitHub REST API response shape
  default_branch?: string;
}

export interface GitHubRepositoryCoordinates {
  origin: string;
  owner: string;
  repo: string;
  locator: string;
}

export interface GitHubTreeEntry {
  path: string;
  type: string;
  sha?: string;
}

const identityError = (message: string): RegistryError => new RegistryError({
  code: 'BUNDLE.SOURCE_IDENTITY_MISMATCH',
  message,
  hint: 'Confirm the GitHub repository locator and its recorded provider repository ID.'
});

const invalidLocator = (locator: string): RegistryError => new RegistryError({
  code: 'CONFIG.INVALID_SOURCE_LOCATOR',
  message: `GitHub repository locator ${JSON.stringify(locator)} is invalid or contains credentials.`,
  hint: 'Use a credential-free GitHub repository URL with an owner and repository path.'
});

const requireNonEmptyText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw identityError(`${label} must be present in the GitHub API response.`);
  }
  return value;
};

const requireRepositoryId = (value: unknown): string => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
    throw identityError('GitHub repository metadata did not contain a safely representable provider repository ID.');
  }
  const id = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^[1-9]\d*$/.test(id)) {
    throw identityError('GitHub repository metadata did not contain a valid provider repository ID.');
  }
  return id;
};

/**
 * Parse a GitHub repository locator while preserving its origin and path case.
 * SSH locators are represented portably by their credential-free HTTPS URL.
 * @param value - Configured or canonical repository locator.
 */
export const parseGitHubRepositoryLocator = (value: string): GitHubRepositoryCoordinates => {
  if (value.startsWith('git@github.com:')) {
    const match = /^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?$/.exec(value);
    if (!match) {
      throw invalidLocator(value);
    }
    const sshOwner = match[1];
    const sshRepo = match[2];
    return {
      origin: 'https://github.com',
      owner: sshOwner,
      repo: sshRepo,
      locator: `https://github.com/${sshOwner}/${sshRepo}`
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidLocator(value);
  }
  if (!isCredentialFreeHttpUrl(value) || url.search !== '' || url.hash !== '') {
    throw invalidLocator(value);
  }
  const pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const segments = pathname.startsWith('/') ? pathname.slice(1).split('/') : [];
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0) || url.hostname !== 'github.com') {
    throw invalidLocator(value);
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!owner || !repo) {
    throw invalidLocator(value);
  }
  const origin = url.origin;
  return {
    origin,
    owner,
    repo,
    locator: `${origin}/${owner}/${repo}`
  };
};

function normalizeRepositoryLocator(
  value: string | undefined,
  configured: GitHubRepositoryCoordinates
): GitHubRepositoryCoordinates {
  if (value === undefined) {
    return configured;
  }
  const canonical = parseGitHubRepositoryLocator(value);
  if (canonical.origin !== configured.origin) {
    throw identityError('GitHub repository metadata changed the provider origin.');
  }
  return canonical;
}

function isGitHubSourceType(source: RegistrySource): source is RegistrySource & {
  type: 'github' | 'skills' | 'awesome-copilot';
} {
  return source.type === 'github' || source.type === 'skills' || source.type === 'awesome-copilot';
}

function assertExpectedSourceType(
  source: RegistrySource,
  expected: PortableSourceDescriptor
): void {
  if (source.type !== expected.type) {
    throw identityError(`Recorded source type "${expected.type}" does not match adapter type "${source.type}".`);
  }
  const expectedKind = source.type === 'github' ? 'github-releases' : 'github-tree';
  if (expected.identity.kind !== expectedKind) {
    throw identityError(`Recorded GitHub identity kind "${expected.identity.kind}" is not valid for "${source.type}".`);
  }
}

function selectorPath(value: unknown, fallback: string, label: string): string {
  const path = value === undefined ? fallback : requireNonEmptyText(value, label);
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw identityError(`${label} must be a canonical relative POSIX path.`);
  }
  return path;
}

/**
 * Resolve a source locator to a provider repository ID and effective selectors.
 * A prior descriptor is checked before its locator is updated, so a renamed
 * repository keeps its key while a different repository at the old URL fails.
 * @param source - Configured GitHub source.
 * @param api - Injected GitHub API boundary.
 * @param expected - Previously recorded portable source, if any.
 */
export const resolveGitHubSourceIdentity = async (
  source: RegistrySource,
  api: GitHubApi,
  expected?: PortableSourceDescriptor
): Promise<PortableSourceDescriptor> => {
  if (!isGitHubSourceType(source)) {
    throw identityError(`Source type "${source.type}" is not a retained GitHub adapter.`);
  }
  if (expected !== undefined) {
    assertExpectedSourceType(source, expected);
  }

  const configured = parseGitHubRepositoryLocator(source.url);
  const repository = await api.getJson<GitHubRepository>(`/repos/${configured.owner}/${configured.repo}`);
  const repositoryId = requireRepositoryId(repository.id);
  const requestedIdentity = expected?.identity;
  const expectedGitHubIdentity = requestedIdentity?.kind === 'github-releases'
    || requestedIdentity?.kind === 'github-tree'
    ? requestedIdentity
    : undefined;
  if (expectedGitHubIdentity) {
    if (expectedGitHubIdentity.origin !== configured.origin) {
      throw identityError('The configured GitHub origin does not match the recorded portable source.');
    }
    if (expectedGitHubIdentity.repositoryId !== repositoryId) {
      throw identityError(
        `GitHub repository identity changed at ${JSON.stringify(configured.locator)}: expected provider repository ID ${expectedGitHubIdentity.repositoryId}, received ${repositoryId}.`
      );
    }
  }

  const returnedLocator = normalizeRepositoryLocator(repository.html_url, configured);
  if (source.type === 'github') {
    const releaseConfig = portableAuthConfig(source, expected);
    return {
      type: source.type,
      identity: {
        kind: 'github-releases',
        origin: configured.origin,
        repositoryId
      },
      locator: returnedLocator.locator,
      ...(Object.keys(releaseConfig).length > 0 ? { config: releaseConfig } : {})
    };
  }

  const expectedTreeIdentity = requestedIdentity?.kind === 'github-tree' ? requestedIdentity : undefined;
  const configuredRef = typeof source.config?.branch === 'string' && source.config.branch.trim() !== ''
    ? source.config.branch
    : undefined;
  const recordedRef = expectedTreeIdentity?.ref;
  if (configuredRef !== undefined && recordedRef !== undefined && configuredRef !== recordedRef) {
    throw identityError(`Configured Git ref "${configuredRef}" does not match recorded effective ref "${recordedRef}".`);
  }
  const effectiveRef = configuredRef
    ?? recordedRef
    ?? (typeof repository.default_branch === 'string' && repository.default_branch.trim() !== ''
      ? repository.default_branch
      : undefined);
  if (!effectiveRef) {
    throw identityError('GitHub repository metadata did not contain a default branch and no Git ref was configured.');
  }

  const selectors = source.type === 'skills'
    ? {
      skillsPath: selectorPath(
        source.config?.skillsPath ?? expectedTreeIdentity?.skillsPath,
        'skills',
        'Skills path'
      )
    }
    : {
      collectionsPath: selectorPath(
        source.config?.collectionsPath ?? expectedTreeIdentity?.collectionsPath,
        'collections',
        'Collections path'
      )
    };
  if (expectedTreeIdentity) {
    const expectedSelector = source.type === 'skills'
      ? expectedTreeIdentity.skillsPath
      : expectedTreeIdentity.collectionsPath;
    const actualSelector = source.type === 'skills' ? selectors.skillsPath : selectors.collectionsPath;
    if (expectedSelector !== undefined && expectedSelector !== actualSelector) {
      throw identityError(`Configured GitHub content path "${actualSelector}" does not match the recorded path "${expectedSelector}".`);
    }
  }

  const config = {
    ref: effectiveRef,
    ...selectors,
    ...portableAuthConfig(source, expected)
  };
  return {
    type: source.type,
    identity: {
      kind: 'github-tree',
      origin: configured.origin,
      repositoryId,
      ref: effectiveRef,
      ...selectors
    },
    locator: returnedLocator.locator,
    config
  };
};

function portableAuthConfig(
  source: RegistrySource,
  expected?: PortableSourceDescriptor
): { authMode?: 'anonymous' | 'bearer'; credentialRef?: string } {
  const authMode = source.config?.authMode ?? expected?.config?.authMode;
  const credentialRef = source.config?.credentialRef ?? expected?.config?.credentialRef;
  return {
    ...(authMode === 'anonymous' || authMode === 'bearer' ? { authMode } : {}),
    ...(typeof credentialRef === 'string' && credentialRef.trim() !== '' ? { credentialRef } : {})
  };
}

/**
 * Resolve a mutable ref to its immutable commit SHA.
 * @param api - Injected GitHub API boundary.
 * @param coordinates - Resolved repository coordinates.
 * @param ref - Effective Git ref.
 */
export const resolveGitHubCommit = async (
  api: GitHubApi,
  coordinates: GitHubRepositoryCoordinates,
  ref: string
): Promise<string> => {
  const commit = await api.getJson<{ sha?: string }>(
    `/repos/${coordinates.owner}/${coordinates.repo}/commits/${encodeURIComponent(ref)}`
  );
  const sha = requireNonEmptyText(commit.sha, `Commit SHA for ref ${JSON.stringify(ref)}`);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) {
    throw identityError(`GitHub returned an invalid commit SHA for ref ${JSON.stringify(ref)}.`);
  }
  return sha;
};

/**
 * Read a repository tree at an immutable commit.
 * @param api - Injected GitHub API boundary.
 * @param coordinates - Resolved repository coordinates.
 * @param commitSha - Immutable commit SHA.
 */
export const readGitHubTreeAtCommit = async (
  api: GitHubApi,
  coordinates: GitHubRepositoryCoordinates,
  commitSha: string
): Promise<GitHubTreeEntry[]> => {
  const result = await api.getJson<{ tree?: GitHubTreeEntry[]; truncated?: boolean }>(
    `/repos/${coordinates.owner}/${coordinates.repo}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`
  );
  if (result.truncated) {
    throw identityError(`GitHub returned a truncated repository tree at commit ${commitSha}; refusing an incomplete bundle.`);
  }
  return result.tree ?? [];
};

/**
 * Build an unauthenticated raw-content URL at an immutable commit.
 * The injected GitHubApi remains responsible for auth and redirect policy.
 * @param coordinates - Resolved repository coordinates.
 * @param commitSha - Immutable commit SHA.
 * @param path - Repository-relative POSIX path.
 */
export const githubRawFileUrl = (
  coordinates: GitHubRepositoryCoordinates,
  commitSha: string,
  path: string
): string => `https://raw.githubusercontent.com/${coordinates.owner}/${coordinates.repo}/${commitSha}/${path}`;
