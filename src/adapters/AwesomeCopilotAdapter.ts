/**
 * Awesome Copilot Collection Adapter
 * 
 * Adapter for github/awesome-copilot style collection repositories.
 * Discovers .collection.yml files and exposes them as Prompt Registry bundles.
 * 
 * Collection Format:
 * ```yaml
 * id: azure-cloud-development
 * name: Azure & Cloud Development
 * description: Comprehensive Azure cloud development tools...
 * tags: [azure, cloud, infrastructure]
 * items:
 *   - path: prompts/azure-resource-health.prompt.md
 *     kind: prompt
 *   - path: instructions/bicep-best-practices.instructions.md
 *     kind: instruction
 *   - path: chatmodes/azure-architect.chatmode.md
 *     kind: chat-mode
 * ```
 */

import * as https from 'https';
import * as yaml from 'js-yaml';
import archiver from 'archiver';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, RegistrySource, ValidationResult, SourceMetadata } from '../types/registry';
import { Logger } from '../utils/logger';

/**
 * Awesome Copilot Collection Schema
 */
interface CollectionManifest {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    items: CollectionItem[];
    display?: {
        ordering?: string;
        show_badge?: boolean;
    };
}

interface CollectionItem {
    path: string;
    kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent';
}

/**
 * GitHub API response for directory listing
 */
interface GitHubContent {
    name: string;
    path: string;
    type: 'file' | 'dir';
    download_url: string;
}

/**
 * AwesomeCopilotAdapter Configuration
 */
export interface AwesomeCopilotConfig {
    /** Branch name (default: main) */
    branch?: string;
    /** Collections directory (default: collections) */
    collectionsPath?: string;
}

/**
 * AwesomeCopilotAdapter
 * 
 * Fetches bundles from awesome-copilot style collection repositories.
 * 
 * Features:
 * - Configurable repository URL (not hardcoded)
 * - Automatic collection discovery
 * - Content type mapping (prompt/instruction/chatmode/agent)
 * - Cache for performance
 * - GitHub API integration
 * 
 * Usage:
 * ```typescript
 * const source: RegistrySource = {
 *   id: 'awesome-copilot',
 *   name: 'Awesome Copilot',
 *   url: 'https://github.com/github/awesome-copilot',
 *   type: 'awesome-copilot',
 *   config: { branch: 'main', collectionsPath: 'collections' }
 * };
 * const adapter = new AwesomeCopilotAdapter(source);
 * const bundles = await adapter.listBundles();
 * ```
 */
export class AwesomeCopilotAdapter extends RepositoryAdapter {
    readonly type = 'awesome-copilot';
    private config: Required<AwesomeCopilotConfig>;
    private collectionsCache: Map<string, { bundles: Bundle[]; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    protected logger: Logger;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        
        // Parse config
        const userConfig = (source as any).config || {};
        this.config = {
            branch: userConfig.branch || 'main',
            collectionsPath: userConfig.collectionsPath || 'collections'
        };

        this.logger.info(`AwesomeCopilotAdapter initialized for: ${source.url}`);
    }

    /**
     * Fetch list of available bundles from the source (required by IRepositoryAdapter)
     */
    async fetchBundles(): Promise<Bundle[]> {
        this.logger.debug('Listing bundles from awesome-copilot repository');

        // Check cache
        const cacheKey = `${this.source.url}-${this.config.branch}`;
        const cached = this.collectionsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.logger.debug('Using cached collections');
            return cached.bundles;
        }

        try {
            // Step 1: List .collection.yml files
            const collectionFiles = await this.listCollectionFiles();
            this.logger.debug(`Found ${collectionFiles.length} collection files`);

            // Step 2: Parse each collection
            const bundles: Bundle[] = [];
            for (const file of collectionFiles) {
                try {
                    const bundle = await this.parseCollection(file);
                    if (bundle) {
                        bundles.push(bundle);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to parse collection ${file}:`, error as Error);
                }
            }

            // Cache results
            this.collectionsCache.set(cacheKey, { bundles, timestamp: Date.now() });

            return bundles;

        } catch (error) {
            this.logger.error('Failed to list bundles', error as Error);
            throw new Error(`Failed to list awesome-copilot collections: ${(error as Error).message}`);
        }
    }

    /**
     * Download a bundle as a zip archive (required by IRepositoryAdapter)
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        this.logger.debug(`Downloading bundle: ${bundle.id}`);

        try {
            // Find collection file from bundle metadata
            const collectionFile = (bundle as any).collectionFile || `${bundle.id}.collection.yml`;
            this.logger.debug(`Collection file: ${collectionFile}`);
            
            // Parse collection
            const collectionUrl = this.buildRawUrl(`${this.config.collectionsPath}/${collectionFile}`);
            this.logger.debug(`Fetching collection from: ${collectionUrl}`);
            const yamlContent = await this.fetchUrl(collectionUrl);
            const collection = yaml.load(yamlContent) as CollectionManifest;
            this.logger.debug(`Collection loaded: ${collection.name}, items: ${collection.items.length}`);

            // Create zip archive
            const buffer = await this.createBundleArchive(collection, collectionFile);
            this.logger.debug(`Archive created: ${buffer.length} bytes`);
            return buffer;

        } catch (error) {
            this.logger.error('Failed to download bundle', error as Error);
            throw new Error(`Failed to download bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Fetch repository metadata (required by IRepositoryAdapter)
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const { owner, repo } = this.parseGitHubUrl();
            const collectionFiles = await this.listCollectionFiles();

            return {
                name: `${owner}/${repo}`,
                description: `Awesome Copilot collections from ${this.source.url}`,
                bundleCount: collectionFiles.length,
                lastUpdated: new Date().toISOString(),
                version: '1.0.0'
            };
        } catch (error) {
            throw new Error(`Failed to fetch metadata: ${(error as Error).message}`);
        }
    }

    /**
     * Get manifest URL for a bundle (required by IRepositoryAdapter)
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const collectionFile = `${bundleId}.collection.yml`;
        return this.buildRawUrl(`${this.config.collectionsPath}/${collectionFile}`);
    }

    /**
     * Get download URL for a bundle (required by IRepositoryAdapter)
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        // For awesome-copilot, download URL is same as manifest URL
        // (we download and package on the fly)
        return this.getManifestUrl(bundleId, version);
    }

    /**
     * Validate repository structure
     */
    async validate(): Promise<ValidationResult> {
        try {
            // Check if collections directory exists
            const apiUrl = this.buildApiUrl(`${this.config.collectionsPath}`);
            const content = await this.fetchUrl(apiUrl);
            
            const files = JSON.parse(content) as GitHubContent[];
            const collectionFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.collection.yml'));

            if (collectionFiles.length === 0) {
                return {
                    valid: false,
                    errors: ['No .collection.yml files found in collections directory'],
                    warnings: [],
                    bundlesFound: 0
                };
            }

            return {
                valid: true,
                errors: [],
                warnings: [],
                bundlesFound: collectionFiles.length
            };

        } catch (error) {
            return {
                valid: false,
                errors: [`Failed to validate repository: ${(error as Error).message}`],
                warnings: [],
                bundlesFound: 0
            };
        }
    }

    /**
     * List all .collection.yml files in collections directory
     */
    private async listCollectionFiles(): Promise<string[]> {
        const apiUrl = this.buildApiUrl(`${this.config.collectionsPath}`);
        const content = await this.fetchUrl(apiUrl);
        
        const files = JSON.parse(content) as GitHubContent[];
        return files
            .filter(f => f.type === 'file' && f.name.endsWith('.collection.yml'))
            .map(f => f.name);
    }

    /**
     * Parse a collection file into a Bundle
     */
    private async parseCollection(collectionFile: string): Promise<Bundle | null> {
        try {
            const collectionUrl = this.buildRawUrl(`${this.config.collectionsPath}/${collectionFile}`);
            const yamlContent = await this.fetchUrl(collectionUrl);
            const collection = yaml.load(yamlContent) as CollectionManifest;

            // Count items by kind
            const breakdown = this.calculateBreakdown(collection.items);

            const bundle: Bundle = {
                id: collection.id,
                name: collection.name,
                version: '1.0.0',
                description: collection.description,
                author: this.extractRepoOwner(),
                repository: this.source.url,
                tags: collection.tags || [],
                environments: this.inferEnvironments(collection.tags || []),
                sourceId: this.source.id,
                manifestUrl: this.buildRawUrl(`${this.config.collectionsPath}/${collectionFile}`),
                downloadUrl: this.buildRawUrl(`${this.config.collectionsPath}/${collectionFile}`),
                lastUpdated: new Date().toISOString(),
                size: `${collection.items.length} items`,
                dependencies: [],
                license: 'MIT'
            };

            // Store collection file name for download
            (bundle as any).collectionFile = collectionFile;
            (bundle as any).breakdown = breakdown;

            return bundle;

        } catch (error) {
            this.logger.error(`Failed to parse collection ${collectionFile}`, error as Error);
            return null;
        }
    }

    /**
     * Create a zip archive containing collection files
     */
    private async createBundleArchive(collection: CollectionManifest, collectionFile: string): Promise<Buffer> {
        this.logger.debug(`Creating archive for collection: ${collection.name}`);
        
        return new Promise<Buffer>((resolve, reject) => {
            // Use IIFE to handle async operations within Promise executor
            (async () => {
                try {
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    const chunks: Buffer[] = [];
                    let totalSize = 0;

                    // Collect data chunks
                    archive.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                        totalSize += chunk.length;
                    });

                    // Resolve when archive is finalized
                    archive.on('finish', () => {
                        const buffer = Buffer.concat(chunks);
                        this.logger.debug(`Archive finalized: ${buffer.length} bytes (${chunks.length} chunks)`);
                        resolve(buffer);
                    });

                    // Handle errors
                    archive.on('error', (err: Error) => {
                        this.logger.error('Archive error', err);
                        reject(err);
                    });

                    // Log warnings
                    archive.on('warning', (warning: Error) => {
                        this.logger.warn('Archive warning', warning);
                    });

                    // Add deployment-manifest.yml
                    const manifest = this.createDeploymentManifest(collection);
                    const manifestYaml = yaml.dump(manifest);
                    archive.append(manifestYaml, { name: 'deployment-manifest.yml' });
                    this.logger.debug(`Added manifest (${manifestYaml.length} bytes)`);

                    // Add each item file
                    for (const item of collection.items) {
                        const itemUrl = this.buildRawUrl(item.path);
                        const content = await this.fetchUrl(itemUrl);
                        const filename = item.path.split('/').pop() || 'unknown';
                        archive.append(content, { name: `prompts/${filename}` });
                        this.logger.debug(`Added ${filename} (${content.length} bytes)`);
                    }

                    // Finalize the archive (this triggers 'finish' event when complete)
                    this.logger.debug('Finalizing archive...');
                    archive.finalize();

                } catch (error) {
                    this.logger.error('Failed to create archive', error as Error);
                    reject(error);
                }
            })();
        });
    }

    /**
     * Create deployment manifest from collection
     */
    private createDeploymentManifest(collection: CollectionManifest): any {
        const prompts = collection.items.map(item => {
            const filename = item.path.split('/').pop() || 'unknown';
            const id = filename.replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '');

            return {
                id,
                name: this.titleCase(id.replace(/-/g, ' ')),
                description: `From ${collection.name}`,
                file: `prompts/${filename}`,
                type: this.mapKindToType(item.kind),
                tags: collection.tags || []
            };
        });

        return {
            id: collection.id,
            name: collection.name,
            version: '1.0.0',
            description: collection.description,
            author: this.extractRepoOwner(),
            repository: this.source.url,
            license: 'MIT',
            tags: collection.tags || [],
            prompts
        };
    }

    /**
     * Map collection kind to Prompt Registry type
     */
    private mapKindToType(kind: string): 'prompt' | 'instructions' | 'chatmode' | 'agent' {
        const kindMap: Record<string, 'prompt' | 'instructions' | 'chatmode' | 'agent'> = {
            'prompt': 'prompt',
            'instruction': 'instructions',
            'chat-mode': 'chatmode',
            'agent': 'agent'
        };
        return kindMap[kind] || 'prompt';
    }

    /**
     * Calculate content breakdown from items
     */
    private calculateBreakdown(items: CollectionItem[]): Record<string, number> {
        const breakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0
        };

        for (const item of items) {
            switch (item.kind) {
                case 'prompt':
                    breakdown.prompts++;
                    break;
                case 'instruction':
                    breakdown.instructions++;
                    break;
                case 'chat-mode':
                    breakdown.chatmodes++;
                    break;
                case 'agent':
                    breakdown.agents++;
                    break;
            }
        }

        return breakdown;
    }

    /**
     * Infer environments from tags
     */
    private inferEnvironments(tags: string[]): string[] {
        const envMap: Record<string, string> = {
            'azure': 'cloud',
            'aws': 'cloud',
            'gcp': 'cloud',
            'frontend': 'web',
            'backend': 'server',
            'database': 'data',
            'devops': 'infrastructure',
            'testing': 'testing'
        };

        const environments = new Set<string>();
        for (const tag of tags) {
            const env = envMap[tag.toLowerCase()];
            if (env) {
                environments.add(env);
            }
        }

        return environments.size > 0 ? Array.from(environments) : ['general'];
    }

    /**
     * Build GitHub API URL
     */
    private buildApiUrl(path: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${this.config.branch}`;
    }

    /**
     * Build raw GitHub content URL
     */
    private buildRawUrl(path: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        return `https://raw.githubusercontent.com/${owner}/${repo}/${this.config.branch}/${path}`;
    }

    /**
     * Parse GitHub URL
     */
    private parseGitHubUrl(): { owner: string; repo: string } {
        const url = this.source.url.replace(/\.git$/, '');
        const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
        
        if (!match) {
            throw new Error(`Invalid GitHub URL: ${this.source.url}`);
        }

        return { owner: match[1], repo: match[2] };
    }

    /**
     * Extract repository owner
     */
    private extractRepoOwner(): string {
        const { owner } = this.parseGitHubUrl();
        return owner;
    }

    /**
     * Fetch URL content using https
     */
    private async fetchUrl(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'VSCode-Prompt-Registry' } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Convert kebab-case to Title Case
     */
    private titleCase(str: string): string {
        return str
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
}
