import type {
  Bundle,
} from '../../types/registry';
import type {
  GitHubRelease,
} from '../../services/github-client';
import {
  formatByteSize,
  generateGitHubBundleId,
} from '../../utils/bundle-name-utils';

export function extractDescription(body: string): string {
  if (!body) {
    return '';
  }
  const lines = body.split('\n');
  const descLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && descLines.length > 0) {
      break;
    }
    if (line.trim()) {
      descLines.push(line.trim());
    }
  }
  return descLines.join(' ').substring(0, 200);
}

export function extractEnvironments(body: string): string[] {
  const envRegex = /(?:environments?|platforms?):\s*([^\n]+)/i;
  const match = body?.match(envRegex);
  if (match) {
    const envs = match[1].split(/[,\s]+/).filter((e) => e.trim());
    if (envs.length > 0) {
      return envs;
    }
  }
  return ['vscode'];
}

export function extractTags(body: string): string[] {
  const tagRegex = /(?:tags?):\s*([^\n]+)/i;
  const match = body?.match(tagRegex);
  if (match) {
    return match[1].split(/[,\s]+/).filter((t) => t.trim());
  }
  return [];
}

export function hasValidBundleAssets(release: GitHubRelease): boolean {
  const hasManifest = release.assets.some((a) =>
    a.name === 'deployment-manifest.yml'
    || a.name === 'deployment-manifest.yaml'
    || a.name === 'deployment-manifest.json'
  );
  const hasBundle = release.assets.some((a) =>
    a.name.endsWith('.zip')
    || a.name.endsWith('.tar.gz')
  );
  return hasManifest && hasBundle;
}

export function mapReleaseToBundle(
  release: GitHubRelease,
  manifest: any | null,
  owner: string,
  repo: string,
  sourceId: string,
  sourceUrl: string
): Bundle {
  const manifestAsset = release.assets.find((a) =>
    a.name === 'deployment-manifest.yml'
    || a.name === 'deployment-manifest.yaml'
    || a.name === 'deployment-manifest.json'
  )!;
  const bundleAsset = release.assets.find((a) =>
    a.name.endsWith('.zip')
    || a.name.endsWith('.tar.gz')
  )!;
  const bundleId = generateGitHubBundleId(owner, repo, release.tag_name, manifest?.id, manifest?.version);
  const bundle: Bundle = {
    id: bundleId,
    name: manifest?.name || release.name || `${repo} ${release.tag_name}`,
    version: manifest?.version || release.tag_name.replace(/^v/, ''),
    description: manifest?.description || extractDescription(release.body),
    author: manifest?.author || owner,
    sourceId,
    environments: manifest?.environments || extractEnvironments(release.body),
    tags: manifest?.tags || extractTags(release.body),
    lastUpdated: release.published_at,
    size: formatByteSize(bundleAsset.size),
    dependencies: manifest?.dependencies || [],
    license: manifest?.license || 'Unknown',
    manifestUrl: manifestAsset.url,
    downloadUrl: bundleAsset.url,
    repository: sourceUrl,
  };
  if (manifest?.prompts && Array.isArray(manifest.prompts)) {
    (bundle as any).prompts = manifest.prompts;
  }
  if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
    (bundle as any).mcpServers = manifest.mcpServers;
  }
  return bundle;
}
