/**
 * Portable source identities used by shared desired state.
 * @module domain/source/portable-identity
 */
import {
  createHash,
} from 'node:crypto';
import {
  RegistryError,
} from '../registry-error';

/** Source types still supported by the portable lifecycle contract. */
export type RetainedSourceType =
  | 'github'
  | 'local'
  | 'awesome-copilot'
  | 'local-awesome-copilot'
  | 'skills'
  | 'local-skills'
  | 'azure-devops'
  | 'artifactory';

/** Non-secret options understood by retained source adapters. */
export interface PortableSourceConfig {
  ref?: string;
  collectionsPath?: string;
  skillsPath?: string;
  indexFile?: string;
  authMode?: 'anonymous' | 'bearer';
  credentialRef?: string;
}

interface GithubReleasesIdentity {
  kind: 'github-releases';
  origin: string;
  repositoryId: string;
}

interface GithubTreeIdentity {
  kind: 'github-tree';
  origin: string;
  repositoryId: string;
  ref: string;
  collectionsPath?: string;
  skillsPath?: string;
  indexFile?: string;
}

interface AzureDevOpsTreeIdentity {
  kind: 'azure-devops-tree';
  namespace: string;
  repositoryId: string;
  ref: string;
  collectionsPath: string;
}

interface ArtifactoryIndexIdentity {
  kind: 'artifactory-index';
  root: string;
  indexFile: string;
}

interface WorkspaceLocalIdentity {
  kind: 'workspace-local';
  root: string;
  collectionsPath?: string;
  skillsPath?: string;
  indexFile?: string;
}

interface ExternalLocalIdentity {
  kind: 'external-local';
  bindingName: string;
  collectionsPath?: string;
  skillsPath?: string;
  indexFile?: string;
}

/** Structured identity; selector fields are only those consumed by its adapter. */
export type SourceIdentity =
  | GithubReleasesIdentity
  | GithubTreeIdentity
  | AzureDevOpsTreeIdentity
  | ArtifactoryIndexIdentity
  | WorkspaceLocalIdentity
  | ExternalLocalIdentity;

/** Portable descriptor stored alongside shared desired state. */
export interface PortableSourceDescriptor {
  type: RetainedSourceType;
  identity: SourceIdentity;
  /** Local locators are portable roots or binding names, never machine-local roots. */
  locator: string;
  config?: PortableSourceConfig;
}

/** Runtime-only location of a local source. */
export type LocalSourceLocation =
  | { kind: 'workspace'; root: string }
  | { kind: 'binding'; name: string; root: string };

const SOURCE_KEY_PATTERN = /^src-[a-f0-9]{64}$/;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const CREDENTIAL_QUERY_KEY = /(token|password|passwd|secret|signature|credential|auth|api[_-]?key)/i;
const LEGACY_KEY_QUERY_PARAMETER = /(^|[_-])(?:api[_-]?)?key/i;
const GITHUB_REPOSITORY_ID_PATTERN = /^[1-9]\d*$/;
const AZURE_REPOSITORY_ID_PATTERN = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const LOCAL_SOURCE_TYPES = new Set<RetainedSourceType>([
  'local', 'local-awesome-copilot', 'local-skills'
]);

/**
 * Check an HTTP(S) locator for embedded or query-string credentials.
 * @param value
 */
export const isCredentialFreeHttpUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return HTTP_PROTOCOLS.has(url.protocol)
    && url.username === ''
    && url.password === ''
    && ![...url.searchParams.keys()].some((key) => (
      CREDENTIAL_QUERY_KEY.test(key) || LEGACY_KEY_QUERY_PARAMETER.test(key)
    ));
};

const invalidIdentity = (message: string): RegistryError => new RegistryError({
  code: 'BUNDLE.INVALID_SOURCE_IDENTITY',
  message,
  hint: 'Use a retained adapter and include only its validated provider identity and effective selectors.'
});

const invalidLocator = (message: string): RegistryError => new RegistryError({
  code: 'CONFIG.INVALID_SOURCE_LOCATOR',
  message,
  hint: 'Use a valid credential-free source locator; keep credentials in the configured credential reference.'
});

const requireText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidIdentity(`${label} must be a non-empty string.`);
  }
  return value;
};

const relativeSelector = (value: unknown, label: string, allowRoot = false): string => {
  const text = requireText(value, label);
  if (allowRoot && text === '.') {
    return text;
  }
  if (text.startsWith('/') || /^[a-zA-Z]:/.test(text) || text.includes('\\')
    || text.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalidIdentity(`${label} must be a canonical relative POSIX path.`);
  }
  return text;
};

const githubRepositoryId = (value: unknown): string => {
  const repositoryId = requireText(value, 'GitHub repository ID');
  if (!GITHUB_REPOSITORY_ID_PATTERN.test(repositoryId)) {
    throw invalidIdentity('GitHub repository ID must be a positive decimal provider ID.');
  }
  return repositoryId;
};

const azureRepositoryId = (value: unknown): string => {
  const repositoryId = requireText(value, 'Azure DevOps repository ID');
  if (!AZURE_REPOSITORY_ID_PATTERN.test(repositoryId)) {
    throw invalidIdentity('Azure DevOps repository ID must use the provider UUID form.');
  }
  return repositoryId.toLowerCase();
};

const externalBindingName = (value: unknown): string => {
  const bindingName = requireText(value, 'External source binding name');
  if (bindingName === '.' || bindingName === '..' || bindingName.includes('/')
    || bindingName.includes('\\') || bindingName.includes('\0') || /^[a-zA-Z]:/.test(bindingName)) {
    throw invalidIdentity('External source binding name must be a portable name, not a filesystem path.');
  }
  return bindingName;
};

const isPortableRelativeLocator = (locator: string, allowRoot: boolean): boolean => (
  (allowRoot && locator === '.')
  || (
    locator.length > 0
    && !locator.includes('\0')
    && !locator.includes('\\')
    && !locator.startsWith('/')
    && !/^[a-zA-Z]:/.test(locator)
    && !locator.includes('://')
    && locator.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
);

const providerOrigin = (value: unknown): string => {
  const text = requireText(value, 'Provider origin');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalidIdentity(`Provider origin ${JSON.stringify(text)} is not a valid URL.`);
  }
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username !== '' || url.password !== ''
    || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw invalidIdentity(`Provider origin ${JSON.stringify(text)} must contain only an HTTP(S) origin.`);
  }
  return url.origin;
};

const artifactoryRoot = (value: unknown): string => {
  const text = requireText(value, 'Artifactory source root');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalidIdentity(`Artifactory source root ${JSON.stringify(text)} is not a valid URL.`);
  }
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    throw invalidIdentity('Artifactory source root must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.protocol}//${url.host}${pathname}`;
};

const adapterMatchesKind = (type: RetainedSourceType, kind: SourceIdentity['kind']): boolean => {
  switch (kind) {
    case 'github-releases': {
      return type === 'github';
    }
    case 'github-tree': {
      return type === 'skills' || type === 'awesome-copilot';
    }
    case 'azure-devops-tree': {
      return type === 'azure-devops';
    }
    case 'artifactory-index': {
      return type === 'artifactory';
    }
    case 'workspace-local':
    case 'external-local': {
      return LOCAL_SOURCE_TYPES.has(type);
    }
  }
};

const selectors = (
  identity: Record<string, unknown>,
  names: readonly string[],
  pathNames: readonly string[] = []
): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const name of names) {
    const value = identity[name];
    if (value !== undefined) {
      output[name] = pathNames.includes(name)
        ? relativeSelector(value, `Identity selector "${name}"`)
        : requireText(value, `Identity selector "${name}"`);
    }
  }
  return output;
};

const contentSelectors = (
  type: RetainedSourceType,
  identity: Record<string, unknown>
): Record<string, string> => {
  switch (type) {
    case 'skills':
    case 'local-skills': {
      return selectors(identity, ['skillsPath'], ['skillsPath']);
    }
    case 'awesome-copilot':
    case 'local-awesome-copilot': {
      return selectors(identity, ['collectionsPath'], ['collectionsPath']);
    }
    case 'github':
    case 'local':
    case 'azure-devops':
    case 'artifactory': {
      return {};
    }
  }
};

const canonicalIdentity = (identity: SourceIdentity, type: RetainedSourceType): Record<string, unknown> => {
  if (typeof identity !== 'object' || identity === null || typeof identity.kind !== 'string') {
    throw invalidIdentity('Source identity must have a recognized kind.');
  }
  if (!adapterMatchesKind(type, identity.kind)) {
    throw invalidIdentity(`Source identity kind "${identity.kind}" is not supported by adapter "${type}".`);
  }

  switch (identity.kind) {
    case 'github-releases': {
      return {
        kind: identity.kind,
        origin: providerOrigin(identity.origin),
        repositoryId: githubRepositoryId(identity.repositoryId)
      };
    }
    case 'github-tree': {
      return {
        kind: identity.kind,
        origin: providerOrigin(identity.origin),
        repositoryId: githubRepositoryId(identity.repositoryId),
        ref: requireText(identity.ref, 'Effective Git ref'),
        ...contentSelectors(type, identity as unknown as Record<string, unknown>)
      };
    }
    case 'azure-devops-tree': {
      return {
        kind: identity.kind,
        namespace: requireText(identity.namespace, 'Azure DevOps namespace'),
        repositoryId: azureRepositoryId(identity.repositoryId),
        ref: requireText(identity.ref, 'Effective Azure DevOps ref'),
        collectionsPath: relativeSelector(identity.collectionsPath, 'Azure DevOps collections path')
      };
    }
    case 'artifactory-index': {
      return {
        kind: identity.kind,
        root: artifactoryRoot(identity.root),
        indexFile: relativeSelector(identity.indexFile, 'Artifactory index file')
      };
    }
    case 'workspace-local': {
      return {
        kind: identity.kind,
        root: relativeSelector(identity.root, 'Workspace-relative source root', true),
        ...contentSelectors(type, identity as unknown as Record<string, unknown>)
      };
    }
    case 'external-local': {
      return {
        kind: identity.kind,
        bindingName: externalBindingName(identity.bindingName),
        ...contentSelectors(type, identity as unknown as Record<string, unknown>)
      };
    }
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => left < right ? -1 : (left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

const validateLocator = (source: PortableSourceDescriptor): void => {
  const locator = requireText(source.locator, 'Source locator');
  if (LOCAL_SOURCE_TYPES.has(source.type)) {
    if (source.identity.kind === 'workspace-local') {
      if (!isPortableRelativeLocator(locator, true) || locator !== source.identity.root) {
        throw invalidLocator('Workspace-local locator must be the matching workspace-relative root.');
      }
      return;
    }
    if (source.identity.kind === 'external-local') {
      const bindingName = externalBindingName(source.identity.bindingName);
      if (locator !== bindingName) {
        throw invalidLocator('External-local locator must match its explicit source binding name.');
      }
      return;
    }
    throw invalidIdentity(`Local adapter "${source.type}" requires a workspace-local or external-local identity.`);
  }
  if (!isCredentialFreeHttpUrl(locator)) {
    throw invalidLocator('Source locator must be an HTTP(S) URL without embedded credentials.');
  }
};

/**
 * Create the portable source key from adapter type and canonical identity.
 * @param identity
 * @param type
 */
export const sourceKey = (identity: SourceIdentity, type: RetainedSourceType): string => {
  const serialized = JSON.stringify(canonicalize({
    ...canonicalIdentity(identity, type),
    type
  }));
  return `src-${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
};

/**
 * Compare portable identities while validating that both descriptors are usable.
 * @param a
 * @param b
 */
export const sameSourceIdentity = (
  a: PortableSourceDescriptor,
  b: PortableSourceDescriptor
): boolean => {
  validateLocator(a);
  validateLocator(b);
  return sourceKey(a.identity, a.type) === sourceKey(b.identity, b.type);
};

/**
 * Reject a key that does not describe the supplied portable source.
 * @param key
 * @param source
 */
export const assertSourceKey = (key: string, source: PortableSourceDescriptor): void => {
  validateLocator(source);
  if (!SOURCE_KEY_PATTERN.test(key)) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_SOURCE_KEY',
      message: `Source key ${JSON.stringify(key)} is not a portable source key.`,
      hint: 'Portable source keys use the form src- followed by 64 lowercase hexadecimal characters.'
    });
  }
  if (sourceKey(source.identity, source.type) !== key) {
    throw new RegistryError({
      code: 'BUNDLE.SOURCE_KEY_MISMATCH',
      message: `Source key ${JSON.stringify(key)} does not match the supplied source descriptor.`,
      hint: 'Recompute the source key from the descriptor identity; do not silently rewrite a mismatched key.'
    });
  }
};
