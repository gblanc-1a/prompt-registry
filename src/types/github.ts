/**
 * GitHub release asset information
 */
export interface GitHubAsset {
  id: number;
  name: string;
  label: string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API property name
  content_type: string;
  size: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  download_count: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  updated_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  browser_download_url: string;
}

/**
 * GitHub release information
 */
export interface GitHubRelease {
  id: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  published_at: string;
  assets: GitHubAsset[];
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  html_url: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  tarball_url: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  zipball_url: string;
}

/**
 * Parsed version information from release
 */
export interface VersionInfo {
  version: string;
  tagName?: string; // Original tag name from GitHub (e.g., "v1.0.0" or "1.0.0")
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  isPrerelease: boolean;
}

/**
 * Platform-specific bundle information
 */
export interface BundleInfo {
  platform: string;
  version: string;
  asset: GitHubAsset;
  downloadUrl: string;
  filename: string;
  size: number;
}
