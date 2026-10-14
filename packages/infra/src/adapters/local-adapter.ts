/**
 * Local filesystem source adapter.
 *
 * Re-implementation of `src/adapters/local-adapter.ts`'s behavior against
 * `@ai-primitives-hub/core`'s `SourceAdapter` port and `FileSystem` port —
 * no direct `node:fs` access, so the whole adapter is testable with an
 * in-memory double (`test/helpers/in-memory-filesystem.ts`). `node:path` is
 * used directly: pure path arithmetic has no state to mock.
 *
 * One behavioral difference from `main`: `downloadBundle` builds the ZIP by
 * reading each file through the injected `FileSystem` (text-mode) rather
 * than pointing `archiver` at a real directory on disk. This keeps the
 * whole adapter unit-testable without a real filesystem, at the cost of
 * not yet supporting binary files in a bundle — everything in the
 * `prompt`/`instruction`/`chat-mode`/`agent`/`skill` primitive kinds is
 * text today. The portable resolver uses `FileSystem.readFileBytes` for
 * raw snapshot inventories; this legacy ZIP path retains its text behavior.
 * @module adapters/local-adapter
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
  filesBelow,
  readLocalSourceEntries,
  readLocalSourceFiles,
  recordedLocalBundleSelector,
  resolveLocalBundleResolution,
  resolveLocalSource,
} from './local-portable-resolution';

interface LocalManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  environments?: string[];
  tags?: string[];
  size?: string;
  dependencies?: {
    bundleId: string;
    versionRange: string;
    optional: boolean;
  }[];
  license?: string;
}

const MANIFEST_FILE_NAME = 'deployment-manifest.yml';
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

const isDirectBundleSelector = (selector: string): boolean => selector.length > 0
  && selector !== '.'
  && selector !== '..'
  && !selector.startsWith('/')
  && !/^[a-zA-Z]:/.test(selector)
  && !selector.includes('/')
  && !selector.includes('\\')
  && !selector.includes('\0');

export class LocalAdapter extends BaseSourceAdapter {
  public readonly type = 'local';

  public constructor(
    source: RegistrySource,
    private readonly fs: FileSystem
  ) {
    super(source);
    if (!LocalAdapter.isValidLocalUrl(source.url)) {
      throw new Error(`Invalid local path: ${source.url}`);
    }
  }

  private getLocalPath(): string {
    return resolveLocalPath(this.source.url);
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    if (!(await this.fs.exists(dirPath))) {
      return false;
    }
    const stats = await this.fs.stat(dirPath);
    return stats.isDirectory;
  }

  private async getBundleDirectories(): Promise<string[]> {
    const localPath = this.getLocalPath();
    if (!(await this.directoryExists(localPath))) {
      throw new Error(`Cannot access local directory: ${localPath}`);
    }

    const entries = await this.fs.readDirEntries(localPath);
    const bundleDirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) {
        continue;
      }
      const bundleDir = path.join(localPath, entry.name);
      if (await this.fs.exists(path.join(bundleDir, MANIFEST_FILE_NAME))) {
        bundleDirs.push(bundleDir);
      }
    }
    return bundleDirs;
  }

  /**
   * Relative file paths (POSIX-style `/` separators) under `dirPath`.
   * @param dirPath - Directory to walk, as an absolute path.
   * @param relativePrefix - Path prefix accumulated so far during recursion;
   * callers should omit this and let recursive calls populate it.
   */
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

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    const relativeFilePaths = await this.listFilesRecursively(dirPath);
    let totalSize = 0;
    for (const relativePath of relativeFilePaths) {
      const stats = await this.fs.stat(path.join(dirPath, relativePath));
      totalSize += stats.size;
    }
    return totalSize;
  }

  /**
   * Check if a URL/path is an acceptable local-adapter source: a `file://`
   * URL, an absolute path, or a `~/`/`./`-relative path.
   * @param url - Candidate source URL.
   */
  public static isValidLocalUrl(url: string): boolean {
    return isValidLocalUrl(url);
  }

  public requiresAuthentication(): boolean {
    return false;
  }

  public getManifestUrl(bundleId: string): string {
    return toFileUrl(path.join(this.getLocalPath(), bundleId, MANIFEST_FILE_NAME));
  }

  public getDownloadUrl(bundleId: string): string {
    return toFileUrl(path.join(this.getLocalPath(), bundleId));
  }

  public async fetchMetadata(): Promise<SourceMetadata> {
    const localPath = this.getLocalPath();
    if (!(await this.directoryExists(localPath))) {
      throw new Error(`Directory does not exist: ${localPath}`);
    }

    const bundleDirs = await this.getBundleDirectories();
    let metadata = {
      name: path.basename(localPath),
      description: 'Local bundle registry',
      version: '1.0.0'
    };

    const registryPath = path.join(localPath, 'registry.json');
    if (await this.fs.exists(registryPath)) {
      const registryData = await this.fs.readJson<Partial<typeof metadata>>(registryPath);
      metadata = {
        name: registryData.name ?? metadata.name,
        description: registryData.description ?? metadata.description,
        version: registryData.version ?? metadata.version
      };
    }

    const stats = await this.fs.stat(localPath);
    return {
      name: metadata.name,
      description: metadata.description,
      bundleCount: bundleDirs.length,
      lastUpdated: new Date(stats.mtimeMs).toISOString(),
      version: metadata.version
    };
  }

  public async fetchBundles(): Promise<Bundle[]> {
    const bundleDirs = await this.getBundleDirectories();
    const bundles: Bundle[] = [];

    for (const bundleDir of bundleDirs) {
      const manifestPath = path.join(bundleDir, MANIFEST_FILE_NAME);
      try {
        const manifest = yaml.load(await this.fs.readFile(manifestPath)) as LocalManifest;
        // Stat the manifest file, not the bundle directory: directory mtime
        // is unreliable (many filesystems only bump it when entries are
        // added/removed, not when a nested file's contents change).
        const stats = await this.fs.stat(manifestPath);
        const size = await this.calculateDirectorySize(bundleDir);
        const declaredSize = manifest.size;

        bundles.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          sourceId: this.source.id,
          environments: manifest.environments ?? [],
          tags: manifest.tags ?? [],
          lastUpdated: new Date(stats.mtimeMs).toISOString(),
          size: declaredSize !== undefined && declaredSize !== '' ? declaredSize : formatSize(size),
          dependencies: manifest.dependencies ?? [],
          license: manifest.license ?? 'Unknown',
          downloadUrl: toFileUrl(bundleDir),
          manifestUrl: toFileUrl(manifestPath)
        });
      } catch {
        // Skip bundles with an unreadable/malformed manifest; other bundles
        // in the same source should still load.
        continue;
      }
    }

    return bundles;
  }

  /**
   * Resolve a manifest-selected local bundle into a portable raw-file snapshot.
   * @param selection - Requested manifest ID, version and optional replay pin.
   */
  public async resolvePortableBundle(selection: PortableBundleSelection): Promise<PortableBundlePayload | null> {
    const resolved = resolveLocalSource(this.source, selection.localLocation, selection.expectedSource);
    assertLocalResolutionCompatible(resolved.source, selection.resolution);
    const recordedSelector = recordedLocalBundleSelector(selection.resolution);
    const selectedSelector = selection.bundleSelector ?? recordedSelector;
    if (selection.bundleSelector !== undefined && !isDirectBundleSelector(selection.bundleSelector)) {
      throw new RegistryError({
        code: 'BUNDLE.INVALID_SOURCE_CONTENT_PATH',
        message: `Selected local bundle selector ${JSON.stringify(selection.bundleSelector)} is not a direct child of the configured source.`,
        hint: 'Select the bundle directory itself beneath the configured local source.'
      });
    }
    if (recordedSelector !== undefined && (!isDirectBundleSelector(recordedSelector)
      || (selection.bundleSelector !== undefined && selection.bundleSelector !== recordedSelector))) {
      throw new RegistryError({
        code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
        message: `Recorded local bundle selector ${JSON.stringify(recordedSelector)} does not match the selected local bundle directory.`,
        hint: 'Use the direct bundle directory selector recorded by the local-snapshot pin.'
      });
    }
    const sourceFiles = new Map<string, Uint8Array>();
    const addBundleFiles = async (bundleSelector: string): Promise<void> => {
      const bundleRoot = path.join(resolved.root, bundleSelector);
      const bundleFiles = await readLocalSourceFiles(this.fs, bundleRoot);
      for (const [filePath, bytes] of bundleFiles) {
        sourceFiles.set(`${bundleSelector}/${filePath}`, bytes);
      }
    };
    if (selectedSelector === undefined) {
      for (const entry of await readLocalSourceEntries(this.fs, resolved.root)) {
        if (entry.name.length === 0 || entry.name === '.' || entry.name === '..'
          || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')) {
          throw new RegistryError({
            code: 'BUNDLE.INVALID_SOURCE_CONTENT_PATH',
            message: `Local source entry ${JSON.stringify(entry.name)} is not a portable file or directory name.`,
            hint: 'Local source inventories support canonical POSIX-relative paths only.'
          });
        }
        if (!entry.isDirectory) {
          continue;
        }
        const bundleRoot = path.join(resolved.root, entry.name);
        const stat = await this.fs.lstat(bundleRoot);
        if (stat.isSymbolicLink || !stat.isDirectory
          || !await this.fs.exists(path.join(bundleRoot, MANIFEST_FILE_NAME))) {
          continue;
        }
        await addBundleFiles(entry.name);
      }
    } else {
      await addBundleFiles(selectedSelector);
    }
    const selectorCandidates = selectedSelector === undefined
      ? [...new Set([...sourceFiles.keys()]
        .filter((filePath) => filePath.endsWith(`/${MANIFEST_FILE_NAME}`) && filePath.split('/').length === 2)
        .map((filePath) => filePath.split('/')[0]))]
      : [selectedSelector];
    const matches: { selector: string; manifest: LocalManifest }[] = [];

    for (const candidateSelector of selectorCandidates) {
      if (!isDirectBundleSelector(candidateSelector)) {
        continue;
      }
      const manifestPath = `${candidateSelector}/${MANIFEST_FILE_NAME}`;
      const bytes = sourceFiles.get(manifestPath);
      if (bytes === undefined) {
        continue;
      }
      let candidateManifest: LocalManifest | undefined;
      try {
        const parsed = yaml.load(Buffer.from(bytes).toString('utf8')) as Partial<LocalManifest> | undefined;
        if (parsed && typeof parsed.id === 'string' && parsed.id.trim() !== ''
          && typeof parsed.version === 'string' && parsed.version.trim() !== '') {
          candidateManifest = parsed as LocalManifest;
        }
      } catch {
        candidateManifest = undefined;
      }
      if (candidateManifest !== undefined
        && (selection.bundleId === '' || candidateManifest.id === selection.bundleId)) {
        matches.push({ selector: candidateSelector, manifest: candidateManifest });
      } else if (recordedSelector !== undefined) {
        throw new RegistryError({
          code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
          message: `Recorded local bundle selector ${JSON.stringify(candidateSelector)} does not contain requested bundle "${selection.bundleId}".`,
          hint: 'Restore the bundle at the recorded selector or explicitly resolve a new local snapshot.'
        });
      }
    }

    if (matches.length === 0) {
      if (recordedSelector !== undefined) {
        throw new RegistryError({
          code: 'BUNDLE.ARTIFACT_PIN_MISMATCH',
          message: `Recorded local bundle selector ${JSON.stringify(recordedSelector)} is missing from the configured source.`,
          hint: 'Restore the bundle at the recorded selector or explicitly resolve a new local snapshot.'
        });
      }
      return null;
    }
    if (matches.length > 1) {
      throw new RegistryError({
        code: 'BUNDLE.AMBIGUOUS_LOCAL_BUNDLE',
        message: `More than one local bundle has manifest ID "${selection.bundleId}".`,
        hint: 'Remove the duplicate or select a source with a unique deployment-manifest.yml ID.'
      });
    }

    const [{ selector, manifest }] = matches;
    const files = filesBelow(sourceFiles, selector);
    const resolution = resolveLocalBundleResolution(
      resolved.source,
      selection,
      selector,
      manifest.version,
      files,
      files.get(MANIFEST_FILE_NAME)
    );
    return {
      source: resolved.source,
      logicalBundleId: manifest.id,
      manifestId: manifest.id,
      version: manifest.version,
      resolution,
      files,
      sourceFiles: files
    };
  }

  public async validate(): Promise<ValidationResult> {
    const localPath = this.getLocalPath();
    if (!(await this.directoryExists(localPath))) {
      return { valid: false, errors: [`Directory does not exist: ${localPath}`], warnings: [] };
    }

    const bundleDirs = await this.getBundleDirectories();
    if (bundleDirs.length === 0) {
      return { valid: true, errors: [], warnings: ['No bundles found in directory'] };
    }

    return { valid: true, errors: [], warnings: [] };
  }

  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    const bundlePath = resolveLocalPath(bundle.downloadUrl);
    if (!(await this.directoryExists(bundlePath))) {
      throw new Error(`Bundle directory not found: ${bundlePath}`);
    }

    const relativeFilePaths = await this.listFilesRecursively(bundlePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(new Error(`Failed to create ZIP archive: ${err.message}`)));
    });

    for (const relativePath of relativeFilePaths) {
      const contents = await this.fs.readFile(path.join(bundlePath, relativePath));
      archive.append(contents, { name: relativePath });
    }
    await archive.finalize();

    return finished;
  }
}

function formatSize(bytes: number): string {
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${SIZE_UNITS[unitIndex]}`;
}
