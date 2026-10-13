/**
 * Local Awesome Copilot source adapter — discovers `.collection.yml`
 * files (the same format as `AwesomeCopilotAdapter`) from a local
 * directory instead of a GitHub repository. Useful for authoring and
 * testing collections before publishing.
 *
 * Ported from `src/adapters/local-awesome-copilot-adapter.ts`. Uses the
 * shared `resolveLocalPath`/`isValidLocalUrl` from `./local-path` (see
 * that module's doc for why `LocalAdapter` itself isn't touched here).
 * All disk I/O goes through the injected `FileSystem` port; archive
 * creation uses `archiver`, reading each file as text (matching
 * `LocalAdapter`'s own documented text-only limitation — `FileSystem`
 * has no binary-safe read). The portable resolver uses the binary-safe
 * `readFileBytes` port for its raw source inventory.
 *
 * Deliberate deviations from `main`:
 * - `getLocalPath` now expands a `~/` prefix. `isValidUrl` already
 *   accepted `~/`-prefixed sources, but the original `getLocalPath`
 *   never actually expanded them, silently normalizing the literal
 *   `~/...` string into a nonexistent path.
 * - `collectionFile` is recovered by parsing `Bundle.downloadUrl`
 *   instead of an ad hoc `(bundle as any).collectionFile` field that
 *   doesn't exist on `Bundle`'s real type - same fix as the remote
 *   `AwesomeCopilotAdapter`'s `collectionFile` recovery.
 * - No caching (`main`'s 5-minute `fetchBundles` cache), matching
 *   `LocalAdapter`'s own precedent - for a source explicitly meant for
 *   iterating on local edits, a stale cache actively works against the
 *   use case.
 * - Ported: the ad hoc `breakdown`/`mcpServers` fields attached to the
 *   returned `Bundle` purely for the Marketplace webview's
 *   content-breakdown UI - same reasoning as the remote
 *   `AwesomeCopilotAdapter`, kept as the same ad hoc cast rather than a
 *   real `Bundle` field since neither is part of its actual type.
 * @module adapters/local-awesome-copilot-adapter
 */
import * as path from 'node:path';
import type {
  Bundle,
  FileSystem,
  PortableBundlePayload,
  PortableBundleSelection,
  RegistrySource,
  SourceMetadata,
  ValidationResult,
} from '@ai-primitives-hub/core';
import {
  RegistryError,
} from '@ai-primitives-hub/core';
import archiver from 'archiver';
import * as yaml from 'js-yaml';
import {
  BaseSourceAdapter,
} from './base-source-adapter';
import {
  isValidLocalUrl,
  resolveLocalPath,
  toFileUrl,
} from './local-path';
import {
  assertLocalResolutionCompatible,
  readLocalSourceFiles,
  recordedLocalBundleSelector,
  resolveLocalBundleResolution,
  resolveLocalSource,
} from './local-portable-resolution';

const DEFAULT_COLLECTIONS_PATH = 'collections';

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

const isCanonicalLocalPath = (value: string): boolean => value.length > 0
  && !value.includes('\0')
  && !value.includes('\\')
  && !value.startsWith('/')
  && !/^[a-zA-Z]:/.test(value)
  && !value.includes('://')
  && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

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

export class LocalAwesomeCopilotAdapter extends BaseSourceAdapter {
  public readonly type = 'local-awesome-copilot';

  private readonly collectionsPath: string;

  public constructor(
    source: RegistrySource,
    private readonly fs: FileSystem
  ) {
    super(source);
    if (!isValidLocalUrl(source.url)) {
      throw new Error(`Invalid local path: ${source.url}`);
    }
    this.collectionsPath = source.config?.collectionsPath ?? DEFAULT_COLLECTIONS_PATH;
  }

  private getLocalPath(): string {
    return resolveLocalPath(this.source.url);
  }

  private getCollectionsDir(): string {
    return path.join(this.getLocalPath(), this.collectionsPath);
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    if (!(await this.fs.exists(dirPath))) {
      return false;
    }
    return (await this.fs.stat(dirPath)).isDirectory;
  }

  private async listCollectionFiles(): Promise<string[]> {
    const collectionsDir = this.getCollectionsDir();
    if (!(await this.directoryExists(collectionsDir))) {
      throw new Error(`Collections directory does not exist: ${collectionsDir}`);
    }
    const entries = await this.fs.readDirEntries(collectionsDir);
    return entries.filter((entry) => !entry.isDirectory && entry.name.endsWith('.collection.yml')).map((entry) => entry.name);
  }

  private async fetchCollection(collectionFile: string): Promise<CollectionManifest> {
    const content = await this.fs.readFile(path.join(this.getCollectionsDir(), collectionFile));
    return yaml.load(content) as CollectionManifest;
  }

  private buildBundle(
    collection: CollectionManifest,
    collectionFile: string,
    mtimeMs: number
  ): Bundle {
    const collectionPath = path.join(this.getCollectionsDir(), collectionFile);
    const readmePath = collection.readme?.path
      ? path.join(this.getLocalPath(), collection.readme.path)
      : undefined;
    const bundle: Bundle = {
      id: collection.id,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description,
      author: collection.author ?? 'Local Developer',
      sourceId: this.source.id,
      repository: this.source.url,
      tags: collection.tags ?? [],
      environments: inferEnvironments(collection.tags ?? []),
      manifestUrl: toFileUrl(collectionPath),
      downloadUrl: toFileUrl(collectionPath),
      lastUpdated: new Date(mtimeMs).toISOString(),
      size: `${collection.items.length} items`,
      dependencies: [],
      license: 'MIT',
      readmeUrl: readmePath ? toFileUrl(readmePath) : undefined
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

  /**
   * Absolute path of the README a local collection declares, if any.
   * Single source of truth for both `readmeUrl` and `readmeRevision`, so the
   * two can never describe different files. Rejects declarations that
   * escape the configured source root (e.g. `../outside.md`) - the local
   * adapter reads manifests directly, so core's schema validation never
   * sees this path.
   * @param collection Parsed local collection manifest.
   * @param itemOutputPaths
   * @returns Absolute README path, or undefined when none is declared or unsafe.
   */
  private createDeploymentManifest(
    collection: CollectionManifest,
    itemOutputPaths?: ReadonlyMap<string, string>
  ): Record<string, unknown> {
    const prompts = collection.items.map((item) => {
      const resolvedFile = itemOutputPaths?.get(item.path);
      if (item.kind === 'skill') {
        const skillMatch = /skills\/([^/]+)\/SKILL\.md/.exec(item.path);
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
    return {
      id: collection.id,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description,
      author: collection.author ?? 'Local Developer',
      repository: this.source.url,
      license: 'MIT',
      tags: collection.tags ?? [],
      prompts,
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {})
    };
  }

  private async listFilesRecursively(dirPath: string, relativePrefix = ''): Promise<string[]> {
    const entries = await this.fs.readDirEntries(dirPath);
    const results: string[] = [];
    for (const entry of entries) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        results.push(...(await this.listFilesRecursively(path.join(dirPath, entry.name), relativePath)));
      } else {
        results.push(relativePath);
      }
    }
    return results;
  }

  private async createBundleArchive(collection: CollectionManifest): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(new Error(`Failed to create ZIP archive: ${err.message}`)));
    });

    archive.append(yaml.dump(this.createDeploymentManifest(collection)), { name: 'deployment-manifest.yml' });

    const localPath = this.getLocalPath();
    for (const item of collection.items) {
      if (item.kind === 'skill') {
        const skillDir = path.join(localPath, path.dirname(item.path));
        const skillDirInArchive = path.dirname(item.path);
        for (const relativePath of await this.listFilesRecursively(skillDir)) {
          const contents = await this.fs.readFile(path.join(skillDir, relativePath));
          archive.append(contents, { name: `${skillDirInArchive}/${relativePath}` });
        }
      } else {
        const content = await this.fs.readFile(path.join(localPath, item.path));
        const filename = path.basename(item.path);
        archive.append(content, { name: `prompts/${filename}` });
      }
    }

    await archive.finalize();
    return finished;
  }

  public requiresAuthentication(): boolean {
    return false;
  }

  public async fetchBundles(): Promise<Bundle[]> {
    let collectionFiles: string[];
    try {
      collectionFiles = await this.listCollectionFiles();
    } catch (error) {
      throw new Error(`Failed to list local awesome-copilot collections: ${error instanceof Error ? error.message : error}`);
    }

    const bundles: Bundle[] = [];
    for (const collectionFile of collectionFiles) {
      try {
        const collectionPath = path.join(this.getCollectionsDir(), collectionFile);
        const collection = await this.fetchCollection(collectionFile);
        const { mtimeMs } = await this.fs.stat(collectionPath);
        bundles.push(this.buildBundle(collection, collectionFile, mtimeMs));
      } catch {
        // Skip a malformed collection file; the rest of the source should still load.
      }
    }
    return bundles;
  }

  /**
   * Resolve one local collection from its portable collection-file selector.
   * @param selection - Requested collection ID, version and optional replay pin.
   */
  public async resolvePortableBundle(selection: PortableBundleSelection): Promise<PortableBundlePayload | null> {
    const resolved = resolveLocalSource(this.source, selection.localLocation, selection.expectedSource);
    assertLocalResolutionCompatible(resolved.source, selection.resolution);
    const sourceFiles = await readLocalSourceFiles(this.fs, resolved.root);
    const collectionsPath = resolved.source.identity.kind === 'workspace-local'
      || resolved.source.identity.kind === 'external-local'
      ? resolved.source.identity.collectionsPath ?? DEFAULT_COLLECTIONS_PATH
      : DEFAULT_COLLECTIONS_PATH;
    const recordedSelector = recordedLocalBundleSelector(selection.resolution);
    const candidates = recordedSelector === undefined
      ? [...sourceFiles.keys()].filter((filePath) => {
        if (!filePath.startsWith(`${collectionsPath}/`) || !filePath.endsWith('.collection.yml')) {
          return false;
        }
        return !filePath.slice(collectionsPath.length + 1).includes('/');
      })
      : [recordedSelector];
    const matches: { selector: string; collection: CollectionManifest }[] = [];

    for (const candidateSelector of candidates) {
      if (!isCanonicalLocalPath(candidateSelector)
        || !candidateSelector.startsWith(`${collectionsPath}/`)
        || candidateSelector.slice(collectionsPath.length + 1).includes('/')) {
        if (recordedSelector !== undefined) {
          throw new RegistryError({
            code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
            message: `Recorded local collection selector ${JSON.stringify(candidateSelector)} is not a direct file under ${JSON.stringify(collectionsPath)}.`,
            hint: 'Use the collection file selector recorded by the local-snapshot pin.'
          });
        }
        continue;
      }
      const bytes = sourceFiles.get(candidateSelector);
      if (bytes === undefined) {
        continue;
      }
      let candidateCollection: CollectionManifest | undefined;
      try {
        const parsed = yaml.load(Buffer.from(bytes).toString('utf8')) as CollectionManifest | undefined;
        if (parsed && typeof parsed.id === 'string' && parsed.id.trim() !== ''
          && Array.isArray(parsed.items)) {
          candidateCollection = parsed;
        }
      } catch {
        candidateCollection = undefined;
      }
      if (candidateCollection?.id === selection.bundleId) {
        matches.push({ selector: candidateSelector, collection: candidateCollection });
      } else if (recordedSelector !== undefined) {
        throw new RegistryError({
          code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
          message: `Recorded local collection selector ${JSON.stringify(candidateSelector)} does not contain requested collection "${selection.bundleId}".`,
          hint: 'Restore the collection at its recorded selector or explicitly resolve a new local snapshot.'
        });
      }
    }

    if (matches.length === 0) {
      if (recordedSelector !== undefined) {
        throw new RegistryError({
          code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
          message: `Recorded local collection selector ${JSON.stringify(recordedSelector)} is missing from the configured source.`,
          hint: 'Restore the collection at its recorded selector or explicitly resolve a new local snapshot.'
        });
      }
      return null;
    }
    if (matches.length > 1) {
      throw new RegistryError({
        code: 'BUNDLE.AMBIGUOUS_LOCAL_BUNDLE',
        message: `More than one local collection has ID "${selection.bundleId}".`,
        hint: 'Remove the duplicate or select a source with a unique collection manifest ID.'
      });
    }

    const [{ selector, collection }] = matches;
    const inputFiles = new Map<string, Uint8Array>([[selector, sourceFiles.get(selector)!]]);
    const outputFiles = new Map<string, Uint8Array>();
    const itemOutputPaths = new Map<string, string>();
    for (const item of collection.items) {
      if (typeof item.path !== 'string' || !isCanonicalLocalPath(item.path)) {
        throw new RegistryError({
          code: 'BUNDLE.INVALID_COLLECTION_PATH',
          message: `Collection input path ${JSON.stringify(item.path)} is not a canonical source-relative path.`,
          hint: 'Use a relative POSIX path contained by the configured local source.'
        });
      }
      const input = sourceFiles.get(item.path);
      if (input === undefined) {
        throw new RegistryError({
          code: 'BUNDLE.MISSING_COLLECTION_INPUT',
          message: `Local collection input ${JSON.stringify(item.path)} is missing or is a symbolic link.`,
          hint: 'Restore the selected input as a regular file inside the configured local source.'
        });
      }
      inputFiles.set(item.path, input);
      if (item.kind === 'skill') {
        const skillDirectory = path.posix.dirname(item.path);
        const prefix = `${skillDirectory}/`;
        const skillFiles = [...sourceFiles].filter(([filePath]) => filePath.startsWith(prefix));
        if (skillFiles.length === 0) {
          throw new RegistryError({
            code: 'BUNDLE.MISSING_COLLECTION_INPUT',
            message: `Local collection skill input ${JSON.stringify(item.path)} has no readable files.`,
            hint: 'Restore the skill files as regular files inside the configured local source.'
          });
        }
        for (const [filePath, bytes] of skillFiles) {
          inputFiles.set(filePath, bytes);
          outputFiles.set(filePath, bytes);
        }
        itemOutputPaths.set(item.path, item.path);
      } else {
        const outputPath = `prompts/${path.posix.basename(item.path)}`;
        outputFiles.set(outputPath, input);
        itemOutputPaths.set(item.path, outputPath);
      }
    }

    const version = collection.version ?? '1.0.0';
    const rawManifest = Buffer.from(yaml.dump(this.createDeploymentManifest(collection, itemOutputPaths)), 'utf8');
    outputFiles.set('deployment-manifest.yml', rawManifest);
    const resolution = resolveLocalBundleResolution(
      resolved.source,
      selection,
      selector,
      version,
      inputFiles
    );
    return {
      source: resolved.source,
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
    const localFile = resolveLocalPath(bundle.readmeUrl);
    try {
      return await this.fs.readFile(localFile);
    } catch {
      return null;
    }
  }

  public async fetchMetadata(): Promise<SourceMetadata> {
    try {
      const localPath = this.getLocalPath();
      const collectionFiles = await this.listCollectionFiles();
      const stats = await this.fs.stat(localPath);
      return {
        name: path.basename(localPath),
        description: `Local Awesome Copilot collections from ${localPath}`,
        bundleCount: collectionFiles.length,
        lastUpdated: new Date(stats.mtimeMs).toISOString(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch metadata: ${error instanceof Error ? error.message : error}`);
    }
  }

  public getManifestUrl(bundleId: string): string {
    return toFileUrl(path.join(this.getCollectionsDir(), `${bundleId}.collection.yml`));
  }

  public getDownloadUrl(bundleId: string): string {
    return this.getManifestUrl(bundleId);
  }

  public async validate(): Promise<ValidationResult> {
    try {
      const collectionsDir = this.getCollectionsDir();
      if (!(await this.directoryExists(collectionsDir))) {
        return { valid: false, errors: [`Collections directory does not exist: ${collectionsDir}`], warnings: [], bundlesFound: 0 };
      }

      const collectionFiles = await this.listCollectionFiles();
      if (collectionFiles.length === 0) {
        return { valid: false, errors: ['No .collection.yml files found in collections directory'], warnings: [], bundlesFound: 0 };
      }

      return { valid: true, errors: [], warnings: [], bundlesFound: collectionFiles.length };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to validate directory: ${error instanceof Error ? error.message : error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }
}
