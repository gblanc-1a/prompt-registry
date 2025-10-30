/**
 * GitHub repository adapter
 * Fetches bundles from GitHub repositories
 */

import * as https from 'https';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';

const execAsync = promisify(exec);

/**
 * GitHub API response types
 */
interface GitHubRelease {
    tag_name: string;
    name: string;
    body: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
    }>;
    published_at: string;
}

interface GitHubContent {
    name: string;
    path: string;
    download_url: string;
    type: string;
}

/**
 * GitHub repository adapter implementation
 */
export class GitHubAdapter extends RepositoryAdapter {
    readonly type = 'github';
    private apiBase = 'https://api.github.com';
    private authToken: string | undefined;
    private authMethod: 'vscode' | 'gh-cli' | 'explicit' | 'none' = 'none';

    constructor(source: RegistrySource) {
        super(source);
        
        if (!this.isValidUrl(source.url)) {
            throw new Error(`Invalid GitHub URL: ${source.url}`);
        }
    }

    /**
     * Parse GitHub URL to extract owner and repo
     */
    private parseGitHubUrl(): { owner: string; repo: string } {
        const url = this.source.url.replace(/\.git$/, '');
        const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
        
        if (!match) {
            throw new Error(`Invalid GitHub URL format: ${this.source.url}`);
        }

        return {
            owner: match[1],
            repo: match[2],
        };
    }

    /**
     * Get authentication token using fallback chain:
     * 1. VSCode GitHub API (if user is logged in)
     * 2. gh CLI (if installed and authenticated)
     * 3. Explicit token from source configuration
     */
    private async getAuthenticationToken(): Promise<string | undefined> {
        // Return cached token if already resolved
        if (this.authToken !== undefined) {
            return this.authToken;
        }

        // Try VSCode GitHub authentication first
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
            if (session) {
                this.authToken = session.accessToken;
                this.authMethod = 'vscode';
                console.log('[GitHubAdapter] Using VSCode GitHub authentication');
                return this.authToken;
            }
        } catch (error) {
            // VSCode auth not available, continue to next method
        }

        // Try gh CLI authentication
        try {
            const { stdout } = await execAsync('gh auth token');
            const token = stdout.trim();
            if (token && token.length > 0) {
                this.authToken = token;
                this.authMethod = 'gh-cli';
                console.log('[GitHubAdapter] Using gh CLI authentication');
                return this.authToken;
            }
        } catch (error) {
            // gh CLI not available or not authenticated, continue to next method
        }

        // Fall back to explicit token from source configuration
        const explicitToken = this.getAuthToken();
        if (explicitToken) {
            this.authToken = explicitToken;
            this.authMethod = 'explicit';
            console.log('[GitHubAdapter] Using explicit token from configuration');
            return this.authToken;
        }

        // No authentication available
        this.authMethod = 'none';
        console.log('[GitHubAdapter] No authentication available, API rate limits will apply');
        return undefined;
    }

    /**
     * Make HTTP request to GitHub API
     */
    private async makeRequest(url: string): Promise<any> {
        const headers = this.getHeaders();
        
        // Get authentication token using fallback chain
        const token = await this.getAuthenticationToken();
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }

        return new Promise((resolve, reject) => {
            https.get(url, { headers }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`GitHub API error: ${res.statusCode} ${res.statusMessage}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse GitHub response: ${error}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`GitHub API request failed: ${error.message}`));
            });
        });
    }

    /**
     * Download file from URL
     */
    private async downloadFile(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                const chunks: Buffer[] = [];

                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', (error) => {
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }

    /**
     * Fetch bundles from GitHub releases
     */
    async fetchBundles(): Promise<Bundle[]> {
        const { owner, repo } = this.parseGitHubUrl();
        const url = `${this.apiBase}/repos/${owner}/${repo}/releases`;

        try {
            const releases: GitHubRelease[] = await this.makeRequest(url);
            const bundles: Bundle[] = [];

            for (const release of releases) {
                // Look for deployment manifest in release assets
                const manifestAsset = release.assets.find(a => 
                    a.name === 'deployment-manifest.yml' || 
                    a.name === 'deployment-manifest.yaml'
                );

                if (!manifestAsset) {
                    continue; // Skip releases without manifest
                }

                // Find bundle archive (zip file)
                const bundleAsset = release.assets.find(a => 
                    a.name.endsWith('.zip') || 
                    a.name.endsWith('.tar.gz')
                );

                if (!bundleAsset) {
                    continue; // Skip releases without bundle archive
                }

                // Create bundle metadata
                const bundle: Bundle = {
                    id: `${owner}-${repo}-${release.tag_name}`,
                    name: release.name || `${repo} ${release.tag_name}`,
                    version: release.tag_name.replace(/^v/, ''),
                    description: this.extractDescription(release.body),
                    author: owner,
                    sourceId: this.source.id,
                    environments: this.extractEnvironments(release.body),
                    tags: this.extractTags(release.body),
                    lastUpdated: release.published_at,
                    size: this.formatSize(bundleAsset.size),
                    dependencies: [],
                    license: 'Unknown', // Would need to fetch from repo
                    manifestUrl: manifestAsset.browser_download_url,
                    downloadUrl: bundleAsset.browser_download_url,
                    repository: this.source.url,
                };

                bundles.push(bundle);
            }

            return bundles;
        } catch (error) {
            throw new Error(`Failed to fetch bundles from GitHub: ${error}`);
        }
    }

    /**
     * Download a bundle
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        try {
            return await this.downloadFile(bundle.downloadUrl);
        } catch (error) {
            throw new Error(`Failed to download bundle: ${error}`);
        }
    }

    /**
     * Fetch repository metadata
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        const { owner, repo } = this.parseGitHubUrl();
        const url = `${this.apiBase}/repos/${owner}/${repo}`;

        try {
            const repoData: any = await this.makeRequest(url);
            const releasesUrl = `${this.apiBase}/repos/${owner}/${repo}/releases`;
            const releases: GitHubRelease[] = await this.makeRequest(releasesUrl);

            return {
                name: repoData.name,
                description: repoData.description || '',
                bundleCount: releases.length,
                lastUpdated: repoData.updated_at,
                version: '1.0.0', // Could extract from latest release
            };
        } catch (error) {
            throw new Error(`Failed to fetch metadata from GitHub: ${error}`);
        }
    }

    /**
     * Validate GitHub repository accessibility
     */
    async validate(): Promise<ValidationResult> {
        try {
            const { owner, repo } = this.parseGitHubUrl();
            const url = `${this.apiBase}/repos/${owner}/${repo}`;
            
            await this.makeRequest(url);
            
            // Try to fetch releases
            const releasesUrl = `${this.apiBase}/repos/${owner}/${repo}/releases`;
            const releases: GitHubRelease[] = await this.makeRequest(releasesUrl);

            return {
                valid: true,
                errors: [],
                warnings: releases.length === 0 ? ['No releases found in repository'] : [],
                bundlesFound: releases.length,
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`GitHub validation failed: ${error}`],
                warnings: [],
                bundlesFound: 0,
            };
        }
    }

    /**
     * Get manifest URL for a bundle
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        const tag = version ? `v${version}` : 'latest';
        return `https://github.com/${owner}/${repo}/releases/download/${tag}/deployment-manifest.yml`;
    }

    /**
     * Get download URL for a bundle
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        const tag = version ? `v${version}` : 'latest';
        return `https://github.com/${owner}/${repo}/releases/download/${tag}/bundle.zip`;
    }

    /**
     * Get the authentication method currently in use
     */
    public getAuthenticationMethod(): string {
        return this.authMethod;
    }

    /**
     * Extract description from release body
     */
    private extractDescription(body: string): string {
        if (!body) {
            return '';
        }
        
        // Take first paragraph
        const lines = body.split('\n');
        const descLines = [];
        
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

    /**
     * Extract environments from release body
     */
    private extractEnvironments(body: string): string[] {
        const envs = [];
        const envRegex = /(?:environments?|platforms?):\s*([^\n]+)/i;
        const match = body?.match(envRegex);
        
        if (match) {
            const envString = match[1];
            envs.push(...envString.split(/[,\s]+/).filter(e => e.trim()));
        }
        
        return envs.length > 0 ? envs : ['vscode']; // Default to vscode
    }

    /**
     * Extract tags from release body
     */
    private extractTags(body: string): string[] {
        const tags = [];
        const tagRegex = /(?:tags?):\s*([^\n]+)/i;
        const match = body?.match(tagRegex);
        
        if (match) {
            const tagString = match[1];
            tags.push(...tagString.split(/[,\s]+/).filter(t => t.trim()));
        }
        
        return tags;
    }

    /**
     * Format byte size to human readable
     */
    private formatSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
