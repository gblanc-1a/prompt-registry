/**
 * GitHub source adapter — fetches bundles from a repository's GitHub
 * Releases.
 *
 * Ported from `src/adapters/github-adapter.ts`. The biggest structural
 * change: all raw HTTP (redirects, auth headers, error parsing) moves to
 * an injected `GitHubApi` (backed by `GitHubApiClient` + `NodeHttpClient`
 * in production), so this class only ever deals with GitHub's REST API
 * shapes. See `http/github-api-client.ts`'s module doc for the two
 * behaviors deliberately not ported (HTML-error scraping, multi-strategy
 * auth retry) and why.
 *
 * Ported, deliberately unchanged in shape from `main`: the ad hoc
 * `(bundle as any).prompts`/`.mcpServers` attachment the Marketplace
 * webview's content-breakdown UI reads (`ui/marketplace-view-provider.ts`'s
 * `getContentBreakdown`). Neither field is part of `Bundle`'s real type
 * (see `src/types/registry.ts`'s `DeploymentManifest`, not `Bundle`) — kept
 * as the same ad hoc cast rather than promoted to a real `Bundle` field,
 * to land this as a pure behavior-parity fix, not a type-system change.
 * @module adapters/github-adapter
 */
import * as crypto from 'node:crypto';
import type {
  Bundle,
  BundleExtractor,
  BundleResolution,
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
  generateGitHubReleaseBundleId,
  isCredentialFreeHttpUrl,
  isManifestIdMatch,
  RegistryError,
} from '@ai-primitives-hub/core';
import * as yaml from 'js-yaml';
import {
  ZipBundleExtractor,
} from '../extractors/zip-bundle-extractor';
import {
  BaseSourceAdapter,
} from './base-source-adapter';
import {
  parseGitHubRepositoryLocator,
  resolveGitHubSourceIdentity,
} from './github-portable-resolution';

/**
 * Manifest downloads are fetched in parallel, this many at a time, to
 * bound concurrent outbound requests. Mirrors
 * `CONCURRENCY_CONSTANTS.MANIFEST_DOWNLOAD_CONCURRENCY` from
 * `src/utils/constants.ts` (GitHub's authenticated rate limit is 5000
 * requests/hour, so this is about throughput, not staying under it).
 */
const MANIFEST_DOWNLOAD_CONCURRENCY = 10;

interface GitHubReleaseAsset {
  id?: number | string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  browser_download_url: string;
  /** API endpoint for downloading the asset (requires Accept: application/octet-stream). */
  url: string;
  size: number;
}

interface GitHubRelease {
  id?: number | string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  tag_name: string;
  name: string;
  body: string;
  assets: GitHubReleaseAsset[];
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  published_at: string;
}

interface GitHubRepo {
  name: string;
  description: string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  updated_at: string;
}

interface DeploymentManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  environments?: string[];
  tags?: string[];
  dependencies?: Bundle['dependencies'];
  license?: string;
  /** Name of the README asset on the release, if any. */
  readme?: string;
  /** Read only for the Marketplace webview's content-breakdown UI - see this module's own doc. */
  prompts?: unknown[];
  /** Read only for the Marketplace webview's content-breakdown UI - see this module's own doc. */
  mcpServers?: Record<string, unknown>;
  /** Read only for the Marketplace webview's content-breakdown UI - see this module's own doc. */
  mcpInputs?: unknown[];
}

function isManifestAssetName(name: string): boolean {
  return name === 'deployment-manifest.yml' || name === 'deployment-manifest.yaml' || name === 'deployment-manifest.json';
}

function isBundleAssetName(name: string): boolean {
  return name.endsWith('.zip') || name.endsWith('.tar.gz');
}

function portableResolutionError(code: string, message: string): RegistryError {
  return new RegistryError({
    code,
    message,
    hint: 'Resolve the exact recorded GitHub release and asset; do not substitute another release or artifact.'
  });
}

function requireProviderId(value: unknown, label: string): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
    throw portableResolutionError('BUNDLE.INVALID_ARTIFACT_PIN', `GitHub ${label} ID cannot be represented safely.`);
  }
  const id = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^[1-9]\d*$/.test(id)) {
    throw portableResolutionError('BUNDLE.INVALID_ARTIFACT_PIN', `GitHub ${label} did not include a valid provider ID.`);
  }
  return id;
}

function archiveSha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parsePortableManifest(files: ReadonlyMap<string, Uint8Array>): DeploymentManifest {
  const candidate = [
    'deployment-manifest.yml',
    'deployment-manifest.yaml',
    'deployment-manifest.json'
  ].find((name) => files.has(name));
  if (!candidate) {
    throw portableResolutionError('BUNDLE.MISSING_DEPLOYMENT_MANIFEST', 'The GitHub release archive has no root deployment manifest.');
  }

  let parsed: unknown;
  try {
    const text = Buffer.from(files.get(candidate)!).toString('utf8');
    parsed = candidate.endsWith('.json') ? JSON.parse(text) : yaml.load(text);
  } catch (error) {
    throw portableResolutionError(
      'BUNDLE.INVALID_DEPLOYMENT_MANIFEST',
      `Failed to parse the GitHub release deployment manifest: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw portableResolutionError('BUNDLE.INVALID_DEPLOYMENT_MANIFEST', 'The GitHub release deployment manifest must be an object.');
  }
  const manifest = parsed as DeploymentManifest;
  if (typeof manifest.id !== 'string' || manifest.id.trim() === '' || manifest.id.includes('/')
    || typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw portableResolutionError(
      'BUNDLE.INVALID_DEPLOYMENT_MANIFEST',
      'The GitHub release deployment manifest must declare non-empty id and version fields.'
    );
  }
  return manifest;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * First non-empty paragraph of a release body, truncated for use as a description.
 * @param body - Release body (markdown).
 */
function extractDescription(body: string): string {
  if (!body) {
    return '';
  }
  const descLines: string[] = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '' && descLines.length > 0) {
      break;
    }
    if (line.trim()) {
      descLines.push(line.trim());
    }
  }
  return descLines.join(' ').substring(0, 200);
}

function extractListField(body: string, fieldPattern: RegExp): string[] {
  const match = body?.match(fieldPattern);
  if (!match) {
    return [];
  }
  return match[1].split(/[,\s]+/).filter((value) => value.trim());
}

const ENVIRONMENTS_PATTERN = /(?:environments?|platforms?):\s*([^\n]+)/i;
const TAGS_PATTERN = /(?:tags?):\s*([^\n]+)/i;

/**
 * Unlike tags, environments fall back to `['vscode']` when the release body declares none.
 * @param body - Release body (markdown).
 */
function extractEnvironments(body: string): string[] {
  const environments = extractListField(body, ENVIRONMENTS_PATTERN);
  return environments.length > 0 ? environments : ['vscode'];
}

function extractTags(body: string): string[] {
  return extractListField(body, TAGS_PATTERN);
}

export class GitHubAdapter extends BaseSourceAdapter {
  public readonly type = 'github';

  private readonly manifestCache = new Map<string, DeploymentManifest>();
  private readonly portableExtractor: BundleExtractor;

  public constructor(
    source: RegistrySource,
    private readonly githubApi: GitHubApi,
    extractor: BundleExtractor = new ZipBundleExtractor()
  ) {
    super(source);
    this.portableExtractor = extractor;
    if (!GitHubAdapter.isValidGitHubUrl(source.url)) {
      throw new Error(`Invalid GitHub URL: ${source.url}`);
    }
  }

  private static isValidGitHubUrl(url: string): boolean {
    if (url.startsWith('https://')) {
      return url.includes('github.com');
    }
    if (url.startsWith('git@')) {
      return url.includes('github.com:');
    }
    return false;
  }

  private parseGitHubUrl(): { owner: string; repo: string } {
    const url = this.source.url.replace(/\.git$/, '');
    const match = /github\.com[/:]([^/]+)\/([^/]+)/.exec(url);
    if (!match) {
      throw new Error(`Invalid GitHub URL format: ${this.source.url}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  private async fetchManifestWithCache(asset: GitHubReleaseAsset): Promise<DeploymentManifest | undefined> {
    const cached = this.manifestCache.get(asset.url);
    if (cached) {
      return cached;
    }
    const text = await this.githubApi.getText(asset.url);
    const manifest = (asset.name.endsWith('.json') ? JSON.parse(text) : yaml.load(text)) as DeploymentManifest;
    this.manifestCache.set(asset.url, manifest);
    return manifest;
  }

  private async processRelease(release: GitHubRelease, owner: string, repo: string): Promise<Bundle | undefined> {
    const manifestAsset = release.assets.find((asset) => isManifestAssetName(asset.name));
    const bundleAsset = release.assets.find((asset) => isBundleAssetName(asset.name));
    if (!manifestAsset || !bundleAsset) {
      return undefined;
    }

    let manifest: DeploymentManifest | undefined;
    try {
      manifest = await this.fetchManifestWithCache(manifestAsset);
    } catch {
      // Continue without manifest data - the release still counts as a
      // bundle, just with fallback metadata derived from the release itself.
    }

    const bundleId = generateGitHubReleaseBundleId(owner, repo, release.tag_name, manifest?.id, manifest?.version);

    const readmeAsset = manifest?.readme
      ? release.assets.find((asset) => asset.name.toLowerCase() === manifest.readme!.toLowerCase())
      : undefined;

    const bundle: Bundle = {
      id: bundleId,
      name: manifest?.name ?? release.name ?? `${repo} ${release.tag_name}`,
      version: manifest?.version ?? release.tag_name.replace(/^v/, ''),
      description: manifest?.description ?? extractDescription(release.body),
      author: manifest?.author ?? owner,
      sourceId: this.source.id,
      environments: manifest?.environments ?? extractEnvironments(release.body),
      tags: manifest?.tags ?? extractTags(release.body),
      lastUpdated: release.published_at,
      size: formatByteSize(bundleAsset.size),
      dependencies: manifest?.dependencies ?? [],
      license: manifest?.license ?? 'Unknown',
      manifestUrl: manifestAsset.url,
      downloadUrl: bundleAsset.url,
      repository: this.source.url,
      readmeUrl: readmeAsset?.url,
      readmeRevision: release.tag_name
    };

    // Attach prompts/mcpServers from the manifest for the Marketplace
    // webview's content-breakdown UI. Not part of `Bundle`'s real type -
    // see this module's own doc.
    if (manifest?.prompts && Array.isArray(manifest.prompts)) {
      (bundle as Bundle & { prompts?: unknown }).prompts = manifest.prompts;
    }
    if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
      (bundle as Bundle & { mcpServers?: unknown }).mcpServers = manifest.mcpServers;
    }
    if (manifest?.mcpInputs && Array.isArray(manifest.mcpInputs) && manifest.mcpInputs.length > 0) {
      (bundle as Bundle & { mcpInputs?: unknown[] }).mcpInputs = manifest.mcpInputs;
    }

    return bundle;
  }

  private async findCatalogRelease(
    owner: string,
    repo: string,
    selection: PortableBundleSelection,
    requestedVersion?: string
  ): Promise<GitHubRelease | undefined> {
    const releases = await this.githubApi.getJson<GitHubRelease[]>(`/repos/${owner}/${repo}/releases`);
    for (const release of releases) {
      const manifestAsset = release.assets.find((asset) => isManifestAssetName(asset.name));
      if (!manifestAsset) {
        continue;
      }
      try {
        const manifest = await this.fetchManifestWithCache(manifestAsset);
        if (!manifest?.id || !manifest.version || !isManifestIdMatch(manifest.id, manifest.version, selection.bundleId)) {
          continue;
        }
        if (requestedVersion !== undefined && requestedVersion !== 'latest' && manifest.version !== requestedVersion) {
          continue;
        }
        return release;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  public async fetchBundles(): Promise<Bundle[]> {
    const { owner, repo } = this.parseGitHubUrl();

    let releases: GitHubRelease[];
    try {
      releases = await this.githubApi.getJson<GitHubRelease[]>(`/repos/${owner}/${repo}/releases`);
    } catch (error) {
      throw new Error(`Failed to fetch bundles from GitHub: ${error instanceof Error ? error.message : error}`);
    }

    const validReleases = releases.filter(
      (release) => release.assets.some((asset) => isManifestAssetName(asset.name))
        && release.assets.some((asset) => isBundleAssetName(asset.name))
    );

    const bundles: Bundle[] = [];
    for (let i = 0; i < validReleases.length; i += MANIFEST_DOWNLOAD_CONCURRENCY) {
      const batch = validReleases.slice(i, i + MANIFEST_DOWNLOAD_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((release) => this.processRelease(release, owner, repo)));
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          bundles.push(result.value);
        }
      }
    }
    return bundles;
  }

  /**
   * Resolve one selected release into verified portable files and an exact artifact pin.
   * @param selection - Requested logical/public bundle ID, version and optional replay pin.
   */
  public async resolvePortableBundle(selection: PortableBundleSelection): Promise<PortableBundlePayload | null> {
    if (selection.resolution && selection.version !== undefined) {
      assertResolutionVersion(selection.resolution, selection.version);
    }

    const portableSource = await resolveGitHubSourceIdentity(
      this.source,
      this.githubApi,
      selection.expectedSource
    );
    if (selection.resolution) {
      assertResolutionSourceCompatibility(portableSource, selection.resolution);
    }
    const coordinates = parseGitHubRepositoryLocator(portableSource.locator);
    const pinned = selection.resolution?.kind === 'pinned'
      && selection.resolution.provider === 'github-release'
      ? selection.resolution
      : undefined;
    const evidence = selection.resolution?.kind === 'unpinned' ? selection.resolution.evidence : undefined;
    const recordedReleaseId = pinned?.releaseId ?? evidence?.knownPins?.releaseId;
    const recordedAssetId = pinned?.assetId ?? evidence?.knownPins?.assetId;
    const recordedArchiveSha256 = pinned?.archiveSha256 ?? evidence?.knownDigests?.archiveSha256;
    const recordedManifestVersion = pinned?.version ?? evidence?.manifestVersion;

    let release: GitHubRelease | undefined;
    if (recordedReleaseId === undefined) {
      const requestedVersion = selection.version
        ?? recordedManifestVersion;
      const recordedTag = evidence?.knownPins?.tag;
      if (recordedTag !== undefined) {
        release = await this.githubApi.getJson<GitHubRelease>(
          `/repos/${coordinates.owner}/${coordinates.repo}/releases/tags/${encodeURIComponent(recordedTag)}`
        );
      } else if (requestedVersion !== undefined && requestedVersion !== 'latest') {
        const tag = requestedVersion.startsWith('v') ? requestedVersion : `v${requestedVersion}`;
        try {
          release = await this.githubApi.getJson<GitHubRelease>(
            `/repos/${coordinates.owner}/${coordinates.repo}/releases/tags/${encodeURIComponent(tag)}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/\b404\b|not found/i.test(message)) {
            throw error;
          }
          release = await this.findCatalogRelease(coordinates.owner, coordinates.repo, selection, requestedVersion);
        }
      } else {
        release = await this.findCatalogRelease(coordinates.owner, coordinates.repo, selection, requestedVersion);
      }
    } else {
      release = await this.githubApi.getJson<GitHubRelease>(
        `/repos/${coordinates.owner}/${coordinates.repo}/releases/${encodeURIComponent(recordedReleaseId)}`
      );
      if (requireProviderId(release.id, 'release') !== recordedReleaseId) {
        throw portableResolutionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `GitHub returned a different release than recorded ID ${recordedReleaseId}.`);
      }
    }
    if (!release) {
      return null;
    }

    const releaseId = requireProviderId(release.id, 'release');
    const asset = recordedAssetId === undefined
      ? release.assets.find((candidate) => isBundleAssetName(candidate.name))
      : release.assets.find((candidate) => String(candidate.id ?? '') === recordedAssetId);
    if (!asset) {
      if (recordedAssetId !== undefined) {
        throw portableResolutionError(
          'BUNDLE.ARTIFACT_PIN_MISMATCH',
          `Recorded GitHub asset ID ${recordedAssetId} is missing from release ${releaseId}.`
        );
      }
      return null;
    }
    if (!isBundleAssetName(asset.name) || !asset.name.endsWith('.zip')) {
      throw portableResolutionError('BUNDLE.INVALID_ARTIFACT_PIN', `GitHub asset ${asset.name} is not a supported bundle archive.`);
    }
    const assetId = requireProviderId(asset.id, 'bundle asset');
    if (recordedAssetId !== undefined && assetId !== recordedAssetId) {
      throw portableResolutionError(
        'BUNDLE.ARTIFACT_PIN_MISMATCH',
        `GitHub returned asset ID ${assetId}, not recorded asset ID ${recordedAssetId}.`
      );
    }
    if (!isCredentialFreeHttpUrl(asset.url)) {
      throw portableResolutionError('CONFIG.INVALID_SOURCE_LOCATOR', 'GitHub returned a credential-bearing or invalid asset URL.');
    }

    const originalBytes = await this.githubApi.download(asset.url);
    const digest = archiveSha256(originalBytes);
    if (recordedArchiveSha256 !== undefined && digest !== recordedArchiveSha256) {
      throw portableResolutionError(
        'BUNDLE.ARCHIVE_DIGEST_MISMATCH',
        `GitHub release asset ${assetId} failed its recorded SHA-256 digest check.`
      );
    }
    const files = await this.portableExtractor.extract(originalBytes);
    const manifest = parsePortableManifest(files);
    const version = manifest.version!;
    if (selection.version !== undefined && selection.version !== 'latest' && selection.version !== version) {
      throw portableResolutionError(
        'BUNDLE.RESOLUTION_VERSION_MISMATCH',
        `Requested version "${selection.version}" does not match the verified manifest version "${version}".`
      );
    }
    if (pinned && (pinned.releaseId !== releaseId || pinned.assetId !== assetId)) {
      throw portableResolutionError('BUNDLE.ARTIFACT_PIN_MISMATCH', `GitHub release does not match recorded pin ${pinned.releaseId}/${pinned.assetId}.`);
    }
    if (recordedManifestVersion !== undefined && recordedManifestVersion !== version) {
      throw portableResolutionError(
        'BUNDLE.ARTIFACT_PIN_MISMATCH',
        `GitHub release manifest version "${version}" does not match recorded version "${recordedManifestVersion}".`
      );
    }
    if (!isManifestIdMatch(manifest.id!, version, selection.bundleId)) {
      if (pinned) {
        throw portableResolutionError(
          'BUNDLE.LOGICAL_BUNDLE_MISMATCH',
          `The pinned release manifest ID "${manifest.id}" does not match requested bundle "${selection.bundleId}".`
        );
      }
      return null;
    }

    const resolution: BundleResolution = {
      kind: 'pinned',
      provider: 'github-release',
      version,
      releaseId,
      assetId,
      archiveSha256: digest,
      tag: release.tag_name
    };
    return {
      source: portableSource,
      logicalBundleId: manifest.id!,
      manifestId: manifest.id!,
      version,
      resolution,
      files,
      bytes: Buffer.from(originalBytes)
    };
  }

  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    try {
      const bytes = await this.githubApi.download(bundle.downloadUrl);
      return Buffer.from(bytes);
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
    const { owner, repo } = this.parseGitHubUrl();
    try {
      const repoData = await this.githubApi.getJson<GitHubRepo>(`/repos/${owner}/${repo}`);
      const releases = await this.githubApi.getJson<GitHubRelease[]>(`/repos/${owner}/${repo}/releases`);
      return {
        name: repoData.name,
        description: repoData.description ?? '',
        bundleCount: releases.length,
        lastUpdated: repoData.updated_at,
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch GitHub metadata: ${error instanceof Error ? error.message : error}`);
    }
  }

  public async validate(): Promise<ValidationResult> {
    try {
      const { owner, repo } = this.parseGitHubUrl();
      await this.githubApi.getJson(`/repos/${owner}/${repo}`);
      const releases = await this.githubApi.getJson<GitHubRelease[]>(`/repos/${owner}/${repo}/releases`);
      return {
        valid: true,
        errors: [],
        warnings: releases.length === 0 ? ['No releases found in repository'] : [],
        bundlesFound: releases.length
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`GitHub validation failed: ${error instanceof Error ? error.message : error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  public getManifestUrl(_bundleId: string, version?: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    const tag = version ? `v${version}` : 'latest';
    return `https://github.com/${owner}/${repo}/releases/download/${tag}/deployment-manifest.json`;
  }

  public getDownloadUrl(_bundleId: string, version?: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    const tag = version ? `v${version}` : 'latest';
    return `https://github.com/${owner}/${repo}/releases/download/${tag}/bundle.zip`;
  }

  /**
   * Clear the manifest cache. Called by consumers (e.g. a manual,
   * user-initiated source re-sync) that need to guarantee fresh data
   * rather than whatever was cached from an earlier `fetchBundles` call.
   */
  public clearManifestCache(): void {
    this.manifestCache.clear();
  }
}
