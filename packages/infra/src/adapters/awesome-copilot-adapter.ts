/**
 * Awesome Copilot source adapter — fetches bundles from `github/awesome-copilot`
 * style collection repositories (a `.collection.yml` file per bundle,
 * referencing a set of prompt/instruction/chatmode/agent/skill files by
 * path, built into a ZIP on demand).
 *
 * Ported from `src/adapters/awesome-copilot-adapter.ts`. As with
 * `GitHubAdapter`, all raw HTTP/auth now lives behind the injected
 * `GitHubApi` port. Three further deliberate deviations, each fixing a
 * latent issue while porting rather than carrying it forward uninspected:
 *
 * - `collectionFile` is recovered by parsing `Bundle.downloadUrl` (which
 *   already encodes it), instead of an ad hoc `(bundle as any).collectionFile`
 *   field that doesn't exist on `Bundle`'s real type - same reasoning as
 *   `GitHubAdapter`'s module doc for the `prompts`/`mcpServers` fields, but
 *   here the field was load-bearing (`downloadBundle`'s own fallback
 *   depended on it), not just a UI decoration, so it needs a real
 *   replacement rather than a drop.
 * - Item/skill file content is fetched as bytes (`GitHubApi.download`)
 *   rather than concatenated as a string (`GitHubApi.getText`) before being
 *   appended to the archive - main's `data += chunk` on a `Buffer` mangles
 *   non-UTF8 bytes, and skill directories aren't guaranteed to contain only
 *   text files.
 * - The cache is a plain nullable field instead of a `Map`: it was always
 *   keyed by `${source.url}-${branch}`, which can only ever take one value
 *   for a given adapter instance (both are fixed at construction), so the
 *   `Map` never held more than one entry.
 *
 * Ported (as with `GitHubAdapter`): the ad hoc `breakdown`/`mcpServers`
 * fields attached to the returned `Bundle` purely for the Marketplace
 * webview's content-breakdown UI. Neither is part of `Bundle`'s actual
 * type, so both stay the same ad hoc cast rather than becoming a real
 * `Bundle` field - a pure behavior-parity fix, not a type-system change.
 * @module adapters/awesome-copilot-adapter
 */
import * as crypto from 'node:crypto';
import type {
  Bundle,
  BundleResolution,
  Clock,
  ExternalInputPin,
  GitHubApi,
  PortableBundlePayload,
  PortableBundleSelection,
  RegistrySource,
  SourceMetadata,
  ValidationResult,
} from '@ai-primitives-hub/core';
import {
  assertResolutionSourceCompatibility,
  assertResolutionVersion,
  isCredentialFreeHttpUrl,
  RegistryError,
  sourceContentDigest,
} from '@ai-primitives-hub/core';
import archiver from 'archiver';
import * as yaml from 'js-yaml';
import {
  BaseSourceAdapter,
} from './base-source-adapter';
import {
  assertSupportedKnownDigests,
  githubRawFileUrl,
  parseGitHubRepositoryLocator,
  readGitHubTreeAtCommit,
  resolveGitHubCommit,
  resolveGitHubSourceIdentity,
} from './github-portable-resolution';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BRANCH = 'main';
const DEFAULT_COLLECTIONS_PATH = 'collections';
/** Collection files are fetched this many at a time, mirroring `GitHubAdapter`'s manifest-download batching. */
const COLLECTION_FETCH_CONCURRENCY = 5;

type ItemKind = 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';
type ManifestPromptType = 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill';

interface CollectionItem {
  path: string;
  kind: ItemKind;
}

interface CollectionManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  readme?: {
    path?: string;
  };
  items: CollectionItem[];
  mcpServers?: Record<string, unknown>;
  mcp?: {
    items?: Record<string, unknown>;
  };
}

interface GitHubContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

function portableCollectionError(code: string, message: string): RegistryError {
  return new RegistryError({
    code,
    message,
    hint: 'Resolve the requested collection at its recorded GitHub commit and verify every selected input.'
  });
}

function isCanonicalRepoPath(value: string): boolean {
  return value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && !/^[a-zA-Z]:/.test(value)
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parsePortableCollection(bytes: Uint8Array): CollectionManifest {
  let parsed: unknown;
  try {
    parsed = yaml.load(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw portableCollectionError(
      'BUNDLE.INVALID_COLLECTION_MANIFEST',
      `Failed to parse GitHub collection manifest: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw portableCollectionError('BUNDLE.INVALID_COLLECTION_MANIFEST', 'GitHub collection manifest must be an object.');
  }
  const collection = parsed as CollectionManifest;
  if (typeof collection.id !== 'string' || collection.id.trim() === '' || collection.id.includes('/')
    || typeof collection.name !== 'string' || collection.name.trim() === ''
    || typeof collection.description !== 'string' || !Array.isArray(collection.items)) {
    throw portableCollectionError(
      'BUNDLE.INVALID_COLLECTION_MANIFEST',
      'GitHub collection manifest must declare id, name, description and an items array.'
    );
  }
  if (collection.items.some((item) => (
    typeof item !== 'object'
    || item === null
    || typeof item.path !== 'string'
    || !['prompt', 'instruction', 'chat-mode', 'agent', 'skill'].includes(item.kind)
  ))) {
    throw portableCollectionError('BUNDLE.INVALID_COLLECTION_MANIFEST', 'Collection items must declare a valid path and supported kind.');
  }
  return collection;
}

function externalOutputPath(input: string, kind: ItemKind): string {
  const url = new URL(input);
  const filename = url.pathname.split('/').findLast(Boolean) ?? 'external-input';
  if (kind === 'skill') {
    return `skills/${filename}`;
  }
  return `prompts/${filename}`;
}

const KIND_TO_MANIFEST_TYPE: Record<ItemKind, ManifestPromptType> = {
  prompt: 'prompt',
  instruction: 'instructions',
  'chat-mode': 'chatmode',
  agent: 'agent',
  skill: 'skill'
};

const TAG_TO_ENVIRONMENT: Record<string, string> = {
  azure: 'cloud',
  aws: 'cloud',
  gcp: 'cloud',
  frontend: 'web',
  backend: 'server',
  database: 'data',
  devops: 'infrastructure',
  testing: 'testing'
};

function inferEnvironments(tags: string[]): string[] {
  const environments = new Set<string>();
  for (const tag of tags) {
    const environment = TAG_TO_ENVIRONMENT[tag.toLowerCase()];
    if (environment) {
      environments.add(environment);
    }
  }
  return environments.size > 0 ? [...environments] : ['general'];
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Content breakdown by item kind, plus an MCP server count - read by the
 * Marketplace webview's content-breakdown UI (`bundle.breakdown`).
 * @param items - Collection items to count by kind.
 * @param mcpServers - Raw MCP server config map, if the collection declares any.
 */
function calculateBreakdown(items: CollectionItem[], mcpServers?: Record<string, unknown>): Record<string, number> {
  const breakdown = {
    prompts: 0,
    instructions: 0,
    chatmodes: 0,
    agents: 0,
    skills: 0,
    mcpServers: mcpServers ? Object.keys(mcpServers).length : 0
  };

  for (const item of items) {
    switch (item.kind) {
      case 'prompt': {
        breakdown.prompts++;
        break;
      }
      case 'instruction': {
        breakdown.instructions++;
        break;
      }
      case 'chat-mode': {
        breakdown.chatmodes++;
        break;
      }
      case 'agent': {
        breakdown.agents++;
        break;
      }
      case 'skill': {
        breakdown.skills++;
        break;
      }
    }
  }

  return breakdown;
}

export class AwesomeCopilotAdapter extends BaseSourceAdapter {
  public readonly type = 'awesome-copilot';

  private readonly branch: string;
  private readonly collectionsPath: string;
  private cache: { bundles: Bundle[]; cachedAtMs: number } | undefined;

  public constructor(
    source: RegistrySource,
    private readonly githubApi: GitHubApi,
    private readonly clock: Clock
  ) {
    super(source);
    this.branch = source.config?.branch ?? DEFAULT_BRANCH;
    this.collectionsPath = source.config?.collectionsPath ?? DEFAULT_COLLECTIONS_PATH;
  }

  private parseGitHubUrl(): { owner: string; repo: string } {
    const url = this.source.url.replace(/\.git$/, '');
    const match = /github\.com[/:]([^/]+)\/([^/]+)/.exec(url);
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${this.source.url}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  private buildApiPath(path: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    return `/repos/${owner}/${repo}/contents/${path}?ref=${this.branch}`;
  }

  private buildRawUrl(path: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    return `https://raw.githubusercontent.com/${owner}/${repo}/${this.branch}/${path}`;
  }

  private async getBranchHeadSha(): Promise<string> {
    const { owner, repo } = this.parseGitHubUrl();
    try {
      const commit = await this.githubApi.getJson<{ sha: string }>(`/repos/${owner}/${repo}/commits/${this.branch}`);
      return commit.sha;
    } catch {
      return this.branch;
    }
  }

  private async listCollectionFiles(): Promise<string[]> {
    const entries = await this.githubApi.getJson<GitHubContentEntry[]>(this.buildApiPath(this.collectionsPath));
    return entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.collection.yml')).map((entry) => entry.name);
  }

  /**
   * File paths (relative to the repo root) under `dirPath`, recursed via
   * repeated Contents-API calls (one per subdirectory). Silently returns
   * whatever was found so far on failure, matching `main`'s behavior of
   * degrading a single skill's file list rather than failing the archive.
   * @param dirPath - Directory to walk, relative to the repo root.
   */
  private async listDirectoryFilesRecursively(dirPath: string): Promise<string[]> {
    const filePaths: string[] = [];
    let entries: GitHubContentEntry[];
    try {
      entries = await this.githubApi.getJson<GitHubContentEntry[]>(this.buildApiPath(dirPath));
    } catch {
      return filePaths;
    }
    for (const entry of entries) {
      if (entry.type === 'file') {
        filePaths.push(entry.path);
      } else {
        filePaths.push(...(await this.listDirectoryFilesRecursively(entry.path)));
      }
    }
    return filePaths;
  }

  private async fetchCollection(collectionFile: string): Promise<CollectionManifest> {
    const yamlContent = await this.githubApi.getText(this.buildRawUrl(`${this.collectionsPath}/${collectionFile}`));
    return yaml.load(yamlContent) as CollectionManifest;
  }

  private buildBundle(collection: CollectionManifest, collectionFile: string, readmeRevision: string): Bundle {
    const { owner } = this.parseGitHubUrl();
    const rawUrl = this.buildRawUrl(`${this.collectionsPath}/${collectionFile}`);
    const readmeUrl = collection.readme?.path
      ? this.buildRawUrl(collection.readme.path)
      : undefined;
    const bundle: Bundle = {
      id: collection.id,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description,
      author: collection.author ?? owner,
      sourceId: this.source.id,
      repository: this.source.url,
      tags: collection.tags ?? [],
      environments: inferEnvironments(collection.tags ?? []),
      manifestUrl: rawUrl,
      downloadUrl: rawUrl,
      lastUpdated: this.clock.nowIso(),
      size: `${collection.items.length} items`,
      dependencies: [],
      license: 'MIT',
      readmeUrl,
      readmeRevision
    };

    // Attach a content breakdown + raw MCP servers for the Marketplace
    // webview's content-breakdown UI. Not part of `Bundle`'s real type -
    // see this module's own doc.
    const mcpServers = collection.mcpServers ?? collection.mcp?.items;
    (bundle as Bundle & { breakdown?: unknown }).breakdown = calculateBreakdown(collection.items, mcpServers);
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      (bundle as Bundle & { mcpServers?: unknown }).mcpServers = mcpServers;
    }

    return bundle;
  }

  private createDeploymentManifest(
    collection: CollectionManifest,
    itemOutputPaths?: ReadonlyMap<string, string>
  ): Record<string, unknown> {
    const prompts = collection.items.map((item) => {
      const resolvedFile = itemOutputPaths?.get(item.path);
      if (item.kind === 'skill') {
        const skillMatch = /skills\/([^/]+)\/SKILL\.md/.exec(resolvedFile ?? item.path);
        const skillName = skillMatch ? skillMatch[1] : 'unknown-skill';
        return {
          id: skillName,
          name: titleCase(skillName.replace(/-/g, ' ')),
          description: `Skill from ${collection.name}`,
          file: resolvedFile ?? item.path,
          type: 'skill' as const,
          tags: collection.tags ?? []
        };
      }

      const filename = item.path.split('/').pop() ?? 'unknown';
      const id = filename.replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '').replace(/\.md$/, '');
      return {
        id,
        name: titleCase(id.replace(/-/g, ' ')),
        description: `From ${collection.name}`,
        file: resolvedFile ?? `prompts/${filename}`,
        type: KIND_TO_MANIFEST_TYPE[item.kind],
        tags: collection.tags ?? []
      };
    });

    const mcpServers = collection.mcpServers ?? collection.mcp?.items;
    const { owner } = this.parseGitHubUrl();

    return {
      id: collection.id,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description,
      author: collection.author ?? owner,
      repository: this.source.url,
      license: 'MIT',
      tags: collection.tags ?? [],
      prompts,
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {})
    };
  }

  private async createBundleArchive(collection: CollectionManifest): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(new Error(`Failed to create ZIP archive: ${err.message}`)));
    });

    const manifestYaml = yaml.dump(this.createDeploymentManifest(collection));
    archive.append(manifestYaml, { name: 'deployment-manifest.yml' });

    for (const item of collection.items) {
      if (item.kind === 'skill') {
        const skillDir = item.path.slice(0, item.path.lastIndexOf('/'));
        const skillFiles = await this.listDirectoryFilesRecursively(skillDir);
        for (const filePath of skillFiles) {
          const content = await this.githubApi.download(this.buildRawUrl(filePath));
          archive.append(Buffer.from(content), { name: filePath });
        }
      } else {
        const content = await this.githubApi.download(this.buildRawUrl(item.path));
        const filename = item.path.split('/').pop() ?? 'unknown';
        archive.append(Buffer.from(content), { name: `prompts/${filename}` });
      }
    }
    await archive.finalize();

    return finished;
  }

  private async findCollectionPath(
    coordinates: ReturnType<typeof parseGitHubRepositoryLocator>,
    collectionRoot: string,
    bundleId: string,
    commitSha: string,
    tree: { path: string; type: string }[]
  ): Promise<string | undefined> {
    const candidates = tree.filter((entry) => (
      entry.type === 'blob'
      && entry.path.startsWith(`${collectionRoot}/`)
      && entry.path.slice(collectionRoot.length + 1).split('/').length === 1
      && entry.path.endsWith('.collection.yml')
    ));
    for (const candidate of candidates) {
      const bytes = await this.githubApi.download(githubRawFileUrl(
        coordinates,
        commitSha,
        candidate.path
      ));
      try {
        if (parsePortableCollection(bytes).id === bundleId) {
          return candidate.path;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  public async fetchBundles(): Promise<Bundle[]> {
    if (this.cache && this.clock.now() - this.cache.cachedAtMs < CACHE_TTL_MS) {
      return this.cache.bundles;
    }

    let collectionFiles: string[];
    try {
      collectionFiles = await this.listCollectionFiles();
    } catch (error) {
      throw new Error(`Failed to list awesome-copilot collections: ${error instanceof Error ? error.message : error}`);
    }

    const bundles: Bundle[] = [];
    const readmeRevision = await this.getBranchHeadSha();
    for (let i = 0; i < collectionFiles.length; i += COLLECTION_FETCH_CONCURRENCY) {
      const batch = collectionFiles.slice(i, i + COLLECTION_FETCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (collectionFile) => this.buildBundle(await this.fetchCollection(collectionFile), collectionFile, readmeRevision))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          bundles.push(result.value);
        }
      }
    }

    this.cache = { bundles, cachedAtMs: this.clock.now() };
    return bundles;
  }

  /**
   * Resolve a collection and all selected inputs from one immutable repository commit.
   * @param selection - Requested collection ID, version and optional replay pin.
   */
  public async resolvePortableBundle(selection: PortableBundleSelection): Promise<PortableBundlePayload | null> {
    if (selection.resolution && selection.version !== undefined) {
      assertResolutionVersion(selection.resolution, selection.version);
    }
    const portableSource = await resolveGitHubSourceIdentity(
      this.source,
      this.githubApi,
      selection.expectedSource,
      this.branch
    );
    if (selection.resolution) {
      assertResolutionSourceCompatibility(portableSource, selection.resolution);
    }
    if (portableSource.identity.kind !== 'github-tree') {
      throw portableCollectionError('BUNDLE.INVALID_SOURCE_IDENTITY', 'Collection resolution requires a GitHub tree source identity.');
    }
    const coordinates = parseGitHubRepositoryLocator(portableSource.locator);
    const pinned = selection.resolution?.kind === 'pinned'
      && selection.resolution.provider === 'github-tree'
      ? selection.resolution
      : undefined;
    const unpinnedEvidence = selection.resolution?.kind === 'unpinned'
      ? selection.resolution.evidence
      : undefined;
    assertSupportedKnownDigests(
      unpinnedEvidence,
      ['sourceContentSha256'],
      'Awesome Copilot GitHub tree resolution'
    );
    const collectionRoot = portableSource.identity.collectionsPath ?? this.collectionsPath;
    const recordedCommitSha = pinned?.commitSha ?? unpinnedEvidence?.knownPins?.commitSha;
    const recordedCollectionPath = pinned?.bundlePath
      ?? unpinnedEvidence?.knownPins?.bundlePath
      ?? unpinnedEvidence?.knownPins?.collectionPath;
    if (recordedCommitSha !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(recordedCommitSha)) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `Recorded GitHub commit ID "${recordedCommitSha}" is invalid.`);
    }
    const commitSha = recordedCommitSha
      ?? await resolveGitHubCommit(this.githubApi, coordinates, portableSource.identity.ref);
    const tree = await readGitHubTreeAtCommit(this.githubApi, coordinates, commitSha);
    const collectionPath = recordedCollectionPath ?? await this.findCollectionPath(
      coordinates,
      collectionRoot,
      selection.bundleId,
      commitSha,
      tree
    );
    if (!collectionPath) {
      return null;
    }
    if (!collectionPath.startsWith(`${collectionRoot}/`) || !isCanonicalRepoPath(collectionPath)) {
      throw portableCollectionError('BUNDLE.INVALID_COLLECTION_PATH', `Collection path ${JSON.stringify(collectionPath)} is not a safe path under ${collectionRoot}.`);
    }
    const manifestEntry = tree.find((entry) => entry.type === 'blob' && entry.path === collectionPath);
    if (!manifestEntry) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `Pinned collection path ${collectionPath} is missing at commit ${commitSha}.`);
    }
    const manifestBytes = await this.githubApi.download(githubRawFileUrl(coordinates, commitSha, collectionPath));
    const collection = parsePortableCollection(manifestBytes);
    if (collection.id !== selection.bundleId) {
      if (recordedCollectionPath !== undefined) {
        throw portableCollectionError(
          'BUNDLE.LOGICAL_BUNDLE_MISMATCH',
          `Collection manifest ID "${collection.id}" does not match requested bundle "${selection.bundleId}".`
        );
      }
      return null;
    }
    const version = collection.version ?? '1.0.0';
    if (selection.version !== undefined && selection.version !== version) {
      throw portableCollectionError(
        'BUNDLE.RESOLUTION_VERSION_MISMATCH',
        `Requested version "${selection.version}" does not match collection manifest version "${version}".`
      );
    }
    const recordedVersion = pinned?.version ?? unpinnedEvidence?.manifestVersion;
    if (recordedVersion !== undefined && recordedVersion !== version) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `Collection manifest at ${collectionPath} does not match its recorded pin.`);
    }
    if (recordedCollectionPath !== undefined && recordedCollectionPath !== collectionPath) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `Collection manifest at ${collectionPath} does not match its recorded path.`);
    }

    const inputFiles = new Map<string, Uint8Array>([[collectionPath, manifestBytes]]);
    const outputFiles = new Map<string, Uint8Array>();
    const itemOutputPaths = new Map<string, string>();
    const externalPinsByIdentity = new Map<string, ExternalInputPin>();
    const externalLimitations: string[] = [];
    const recordedExternalPins = pinned?.externalInputs ?? [];
    const consumedExternalIdentities = new Set<string>();

    for (const item of collection.items) {
      if (typeof item.path !== 'string' || item.path.trim() === '') {
        throw portableCollectionError('BUNDLE.INVALID_COLLECTION_MANIFEST', 'Collection items must have non-empty paths.');
      }
      if (/^https?:\/\//i.test(item.path)) {
        if (!isCredentialFreeHttpUrl(item.path)) {
          throw portableCollectionError('CONFIG.INVALID_SOURCE_LOCATOR', 'External collection input URL contains credentials or is invalid.');
        }
        const bytes = await this.githubApi.download(item.path);
        const digest = sha256(bytes);
        const recorded = recordedExternalPins.find((candidate) => candidate.identity === item.path);
        if (pinned && (!recorded || recorded.sourceContentSha256 !== digest)) {
          throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `External input ${item.path} does not match its recorded digest.`);
        }
        if (recorded) {
          consumedExternalIdentities.add(recorded.identity);
        }
        externalPinsByIdentity.set(item.path, { identity: item.path, sourceContentSha256: digest });
        externalLimitations.push(item.path);
        const outputPath = externalOutputPath(item.path, item.kind);
        const urlPath = new URL(item.path).pathname;
        const filename = urlPath.split('/').findLast(Boolean) ?? 'external-input';
        const digestPath = `external/${sha256(Buffer.from(item.path, 'utf8'))}/${filename}`;
        inputFiles.set(digestPath, bytes);
        outputFiles.set(outputPath, bytes);
        itemOutputPaths.set(item.path, outputPath);
        continue;
      }
      if (!isCanonicalRepoPath(item.path)) {
        throw portableCollectionError('BUNDLE.INVALID_COLLECTION_PATH', `Collection item path ${JSON.stringify(item.path)} is not a safe repository-relative path.`);
      }
      if (item.kind === 'skill') {
        const skillDirectory = item.path.slice(0, item.path.lastIndexOf('/'));
        const files = tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(`${skillDirectory}/`));
        if (files.length === 0) {
          throw portableCollectionError('BUNDLE.MISSING_COLLECTION_INPUT', `Collection skill input ${item.path} is missing at commit ${commitSha}.`);
        }
        for (const entry of files) {
          const bytes = await this.githubApi.download(githubRawFileUrl(coordinates, commitSha, entry.path));
          inputFiles.set(entry.path, bytes);
          outputFiles.set(entry.path, bytes);
        }
      } else {
        const entry = tree.find((candidate) => candidate.type === 'blob' && candidate.path === item.path);
        if (!entry) {
          throw portableCollectionError('BUNDLE.MISSING_COLLECTION_INPUT', `Collection input ${item.path} is missing at commit ${commitSha}.`);
        }
        const bytes = await this.githubApi.download(githubRawFileUrl(coordinates, commitSha, item.path));
        inputFiles.set(item.path, bytes);
        const filename = item.path.split('/').at(-1) ?? 'bundle-item';
        outputFiles.set(`prompts/${filename}`, bytes);
      }
    }
    if (pinned && consumedExternalIdentities.size !== recordedExternalPins.length) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', 'The recorded external-input pins do not match the collection inputs.');
    }

    const externalPins = [...externalPinsByIdentity.values()];
    const sourceContentSha256 = sourceContentDigest(inputFiles);
    if (pinned && pinned.sourceContentSha256 !== sourceContentSha256) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `Collection content at commit ${commitSha} does not match its recorded digest.`);
    }
    if (selection.resolution?.kind === 'unpinned'
      && selection.resolution.evidence?.knownDigests?.sourceContentSha256 !== undefined
      && selection.resolution.evidence.knownDigests.sourceContentSha256 !== sourceContentSha256) {
      throw portableCollectionError('BUNDLE.ARTIFACT_PIN_MISMATCH', 'Collection content does not match its recorded source-content digest.');
    }

    const deploymentManifest = this.createDeploymentManifest(collection, itemOutputPaths);
    const manifestPrompts = deploymentManifest.prompts;
    if (Array.isArray(manifestPrompts)) {
      const missingFiles: string[] = [];
      for (const prompt of manifestPrompts as unknown[]) {
        if (typeof prompt !== 'object' || prompt === null) {
          continue;
        }
        const path = (prompt as { file?: unknown }).file;
        if (typeof path === 'string' && !outputFiles.has(path)) {
          missingFiles.push(path);
        }
      }
      if (missingFiles.length > 0) {
        throw portableCollectionError(
          'BUNDLE.MISSING_COLLECTION_INPUT',
          `Generated collection manifest references files that were not acquired: ${missingFiles.join(', ')}.`
        );
      }
    }
    outputFiles.set('deployment-manifest.yml', Buffer.from(yaml.dump(deploymentManifest), 'utf8'));
    const resolution: BundleResolution = externalLimitations.length > 0 && !pinned
      ? {
        kind: 'unpinned',
        reason: 'External collection inputs are mutable URLs and cannot be covered by the repository commit pin.',
        evidence: {
          knownPins: { commitSha, collectionPath },
          knownDigests: { sourceContentSha256 },
          manifestVersion: version,
          externalInputLimitations: [...new Set(externalLimitations)]
        }
      }
      : {
        kind: 'pinned',
        provider: 'github-tree',
        version,
        commitSha,
        bundlePath: collectionPath,
        sourceContentSha256,
        ...(externalPins.length > 0 ? { externalInputs: externalPins } : {})
      };
    return {
      source: portableSource,
      logicalBundleId: collection.id,
      manifestId: collection.id,
      version,
      resolution,
      files: outputFiles
    };
  }

  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    try {
      const collectionFile = bundle.downloadUrl.split('/').pop();
      if (!collectionFile) {
        throw new Error(`Cannot determine collection file from downloadUrl: ${bundle.downloadUrl}`);
      }
      const collection = await this.fetchCollection(collectionFile);
      return await this.createBundleArchive(collection);
    } catch (error) {
      throw new Error(`Failed to download bundle: ${error instanceof Error ? error.message : error}`);
    }
  }

  public async downloadReadme(bundle: Bundle): Promise<string | null> {
    if (!bundle.readmeUrl) {
      return null;
    }
    try {
      return await this.githubApi.getText(bundle.readmeUrl);
    } catch {
      return null;
    }
  }

  public async fetchMetadata(): Promise<SourceMetadata> {
    try {
      const { owner, repo } = this.parseGitHubUrl();
      const collectionFiles = await this.listCollectionFiles();
      return {
        name: `${owner}/${repo}`,
        description: `Awesome Copilot collections from ${this.source.url}`,
        bundleCount: collectionFiles.length,
        lastUpdated: this.clock.nowIso(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch metadata: ${error instanceof Error ? error.message : error}`);
    }
  }

  public getManifestUrl(bundleId: string): string {
    return this.buildRawUrl(`${this.collectionsPath}/${bundleId}.collection.yml`);
  }

  public getDownloadUrl(bundleId: string): string {
    return this.getManifestUrl(bundleId);
  }

  public async validate(): Promise<ValidationResult> {
    try {
      const collectionFiles = await this.listCollectionFiles();
      if (collectionFiles.length === 0) {
        return { valid: false, errors: ['No .collection.yml files found in collections directory'], warnings: [], bundlesFound: 0 };
      }
      return { valid: true, errors: [], warnings: [], bundlesFound: collectionFiles.length };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to validate repository: ${error instanceof Error ? error.message : error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  /**
   * Clear the collections cache. Called by consumers (e.g. a manual,
   * user-initiated source re-sync) that need to guarantee fresh data
   * rather than whatever was cached from an earlier `fetchBundles` call -
   * same reasoning as `GitHubAdapter.clearManifestCache`.
   */
  public clearCache(): void {
    this.cache = undefined;
  }
}
