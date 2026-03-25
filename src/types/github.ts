/**
 * GitHub release asset information
 */
export interface GitHubAsset {
  id: number;
  name: string;
  label: string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  content_type: string;
  size: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  download_count: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  updated_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  browser_download_url: string;
}

/**
 * GitHub release information
 */
export interface GitHubRelease {
  id: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  published_at: string;
  assets: GitHubAsset[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  html_url: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  tarball_url: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
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
