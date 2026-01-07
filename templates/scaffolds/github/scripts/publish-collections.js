#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');

let yauzl;
try {
  // Optional dependency for listing ZIP entries in dry-run mode.
  // Expected in CI/test environments but gracefully degraded if missing.
  yauzl = require('yauzl');
} catch (err) {
  // Log but do not fail; zip listing is optional.
  console.debug('yauzl dependency not found or failed to load; zip listing unavailable.', err?.message || err);
  yauzl = null;
}

/**
 * Custom error class for publish-related failures.
 * Provides structured error information for better error handling upstream.
 */
class PublishError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Error code (e.g., 'MISSING_ASSET', 'RELEASE_EXISTS')
   * @param {Object} [context] - Additional context
   */
  constructor(message, code, context = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Parse CLI arguments for publish-collections script.
 * @param {string[]} argv - Command line arguments
 * @returns {{changedPaths: string[], changedPathsFile: string|undefined, dryRun: boolean, repoSlug: string|undefined}}
 */
function parseArgs(argv) {
  const out = {
    changedPaths: [],
    changedPathsFile: undefined,
    dryRun: false,
    repoSlug: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--changed-path' && argv[i + 1]) {
      out.changedPaths.push(argv[i + 1]);
      i++;
    } else if (a === '--changed-paths-file' && argv[i + 1]) {
      out.changedPathsFile = argv[i + 1];
      i++;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--repo-slug' && argv[i + 1]) {
      out.repoSlug = argv[i + 1];
      i++;
    }
  }

  return out;
}

/**
 * Execute a command synchronously with error handling.
 * @param {string} cmd - Command to execute
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @param {Object} [env] - Environment variables
 * @returns {string} Command stdout
 * @throws {Error} If command exits with non-zero status
 */
function execCommand(cmd, args, cwd, env) {
  const spawnSync = arguments.length >= 5 && arguments[4] ? arguments[4] : childProcess.spawnSync;
  const res = spawnSync(cmd, args, { cwd, env: env || process.env, encoding: 'utf8' });
  if (res.status !== 0) {
    const err = res.stderr || res.stdout || `${cmd} ${args.join(' ')}`;
    throw new Error(err.trim());
  }
  return res.stdout;
}

/**
 * Normalize an array of file paths to repo-relative format.
 * @param {string[]} paths - Array of file paths
 * @returns {string[]} Deduplicated, normalized paths
 */
function normalizePaths(paths) {
  const normalized = (paths || [])
    .map(p => String(p).replace(/\\/g, '/').replace(/^\//, '').trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

/**
 * Check if a git commit exists in the repository.
 * @param {string} cwd - Repository path
 * @param {string} ref - Git reference to check
 * @returns {boolean} True if commit exists
 */
function commitExists(cwd, ref) {
  const spawnSync = arguments.length >= 3 && arguments[2] ? arguments[2] : childProcess.spawnSync;
  const res = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res.status === 0;
}

/**
 * Compute changed file paths between two git commits.
 * Handles edge cases like initial commits and force-pushes.
 * @param {{repoRoot: string, base: string, head: string, env: Object}} options
 * @returns {{paths: string[], isInitialCommit: boolean}} Changed file paths and initial commit flag
 */
function computeChangedPathsFromGitDiff({ repoRoot, base, head, env, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  if (!head) return { paths: [], isInitialCommit: false };

  // GitHub push can provide an all-zero "before" SHA on first push or force-push,
  // OR an empty string on initial push to a new repository.
  // When that happens, fall back to HEAD~1 if it exists; otherwise signal initial commit
  // so that all collections can be published.
  const isEmptyOrZeroBase = !base || base.trim() === '' || base === '0000000000000000000000000000000000000000';
  if (isEmptyOrZeroBase) {
    const fallbackBase = `${head}~1`;
    if (!commitExists(repoRoot, fallbackBase, spawnSync)) {
      // Initial commit or orphan: cannot diff; signal initial commit mode.
      console.log('Initial commit detected (base SHA is empty/zeros and no previous commit exists)');
      return { paths: [], isInitialCommit: true };
    }
    base = fallbackBase;
  }

  // Check if base commit exists (handles force-push where old commit was replaced)
  if (!commitExists(repoRoot, base, spawnSync)) {
    // Base commit doesn't exist (e.g., force-push after amending initial commit)
    // Fall back to HEAD~1 if it exists; otherwise treat as initial commit
    const fallbackBase = `${head}~1`;
    if (!commitExists(repoRoot, fallbackBase, spawnSync)) {
      console.log('Initial commit detected (base commit does not exist and no previous commit)');
      return { paths: [], isInitialCommit: true };
    }
    console.log(`Base commit ${base} not found (force-push?), falling back to ${fallbackBase}`);
    base = fallbackBase;
  }

  const out = execCommand('git', ['diff', '--name-only', base, head], repoRoot, env, spawnSync);
  const paths = out
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  return { paths: normalizePaths(paths), isInitialCommit: false };
}

/**
 * Read changed paths from CLI args, file, or git diff.
 * @param {{repoRoot: string, args: Object, env: Object, spawnSync: Function}} options
 * @returns {{paths: string[], isInitialCommit: boolean}} Changed paths and initial commit flag
 */
function readChangedPaths({ repoRoot, args, env, spawnSync }) {
  let paths = [...args.changedPaths];
  let isInitialCommit = false;
  
  if (args.changedPathsFile) {
    const content = fs.readFileSync(path.join(repoRoot, args.changedPathsFile), 'utf8');
    content
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(p => paths.push(p));
  }

  // If not provided via CLI/file, compute from git diff using env vars.
  if (paths.length === 0) {
    const base = env.GITHUB_BASE_SHA;
    const head = env.GITHUB_HEAD_SHA;
    const result = computeChangedPathsFromGitDiff({ repoRoot, base, head, env, spawnSync });
    paths = result.paths;
    isInitialCommit = result.isInitialCommit;
  }

  return { paths: normalizePaths(paths), isInitialCommit };
}

function detectAffected({ repoRoot, changedPaths, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  if (changedPaths.length === 0) return [];
  const script = path.join(__dirname, 'detect-affected-collections.js');
  const args = [];
  changedPaths.forEach(p => args.push('--changed-path', p));
  const out = execCommand('node', [script, ...args], repoRoot, undefined, spawnSync);
  const parsed = JSON.parse(out);
  return parsed.affected || [];
}

/**
 * Get all collection files in the repository.
 * Uses the collections library listCollectionFiles function.
 * @param {string} repoRoot - Repository root path
 * @returns {Array<{id: string, file: string}>} Array of collection info objects
 */
function getAllCollectionFiles(repoRoot) {
  const { listCollectionFiles, readCollection } = require('./lib/collections');
  const collectionFiles = listCollectionFiles(repoRoot);
  return collectionFiles.map(file => {
    const collection = readCollection(repoRoot, file);
    return { id: collection.id, file };
  });
}

function computeVersion({ repoRoot, collectionFile, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  const script = path.join(__dirname, 'compute-collection-version.js');
  const out = execCommand('node', [script, '--collection-file', collectionFile], repoRoot, undefined, spawnSync);
  return JSON.parse(out);
}

function buildBundle({ repoRoot, repoSlug, collectionFile, version, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  const script = path.join(__dirname, 'build-collection-bundle.js');
  const out = execCommand(
    'node',
    [
      script,
      '--collection-file',
      collectionFile,
      '--version',
      version,
      '--repo-slug',
      repoSlug,
      '--out-dir',
      'dist',
    ],
    repoRoot,
    undefined,
    spawnSync,
  );
  return JSON.parse(out);
}

function ghReleaseExists({ repoRoot, tag, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  const res = spawnSync('gh', ['release', 'view', tag], { cwd: repoRoot, stdio: 'ignore' });
  return res.status === 0;
}

/**
 * Publish a GitHub release with the given assets.
 * @param {{repoRoot: string, tag: string, manifestAsset: string, zipAsset: string}} options
 * @throws {PublishError} If assets are missing or release already exists
 */
function publishRelease({ repoRoot, tag, manifestAsset, zipAsset, spawnSync }) {
  spawnSync = spawnSync || childProcess.spawnSync;
  const absManifest = path.isAbsolute(manifestAsset) ? manifestAsset : path.join(repoRoot, manifestAsset);
  const absZip = path.isAbsolute(zipAsset) ? zipAsset : path.join(repoRoot, zipAsset);

  if (!fs.existsSync(absManifest)) {
    throw new PublishError(`Missing manifest asset: ${absManifest}`, 'MISSING_ASSET', { asset: 'manifest', path: absManifest });
  }
  if (!fs.existsSync(absZip)) {
    throw new PublishError(`Missing zip asset: ${absZip}`, 'MISSING_ASSET', { asset: 'zip', path: absZip });
  }

  if (ghReleaseExists({ repoRoot, tag, spawnSync })) {
    throw new PublishError(`Release already exists: ${tag}`, 'RELEASE_EXISTS', { tag });
  }

  execCommand('gh', ['release', 'create', tag, '--title', tag, '--notes', '', absZip, absManifest], repoRoot, undefined, spawnSync);
}

function sha256File(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function listZipEntries(absZip) {
  if (!yauzl) {
    return Promise.resolve({ entries: [], note: 'Zip listing unavailable (missing yauzl dependency).' });
  }

  return new Promise((resolve, reject) => {
    yauzl.open(absZip, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const entries = [];

      const finish = (maybeErr) => {
        try {
          zipfile.close();
        } catch {
          // ignore
        }
        if (maybeErr) reject(maybeErr);
        else resolve({ entries });
      };

      zipfile.readEntry();
      zipfile.on('entry', entry => {
        entries.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on('end', () => finish());
      zipfile.on('error', finish);
    });
  });
}

/**
 * Get file info (size and SHA256 hash) for dry-run summary.
 * @param {string} absPath - Absolute file path
 * @returns {Promise<{size: number, sha256: string}>}
 */
async function getFileInfo(absPath) {
  const st = fs.statSync(absPath);
  const sha = await sha256File(absPath);
  return { size: st.size, sha256: sha };
}

/**
 * Format asset summary line for dry-run output.
 * @param {string} label - Asset label (e.g., 'manifest', 'zip')
 * @param {string} absPath - Absolute file path
 * @param {string} repoRoot - Repository root for relative path display
 * @returns {Promise<string>} Formatted summary line
 */
async function formatAssetSummary(label, absPath, repoRoot) {
  if (!fs.existsSync(absPath)) {
    return `  ${label}: MISSING (${path.relative(repoRoot, absPath)})`;
  }
  const info = await getFileInfo(absPath);
  return `  ${label}: ${path.relative(repoRoot, absPath)} (${info.size} bytes, sha256 ${info.sha256})`;
}

/**
 * Format zip entries list for dry-run output.
 * @param {string} absZip - Absolute path to zip file
 * @returns {Promise<string[]>} Array of log lines
 */
async function formatZipEntries(absZip) {
  const lines = [];
  try {
    const { entries, note } = await listZipEntries(absZip);
    if (note) {
      lines.push(`  zip_entries: ${note}`);
    } else {
      lines.push('  zip_entries:');
      entries.forEach(e => lines.push(`    - ${e}`));
    }
  } catch (e) {
    lines.push(`  zip_entries: ERROR (${e.message})`);
  }
  return lines;
}

/**
 * Log dry-run summary for a collection release.
 * @param {{logger: Object, collectionId: string, tag: string, nextVersion: string, manifestAsset: string, zipAsset: string, repoRoot: string}} options
 */
async function logDryRunSummary({ logger, collectionId, tag, nextVersion, manifestAsset, zipAsset, repoRoot }) {
  const absManifest = path.isAbsolute(manifestAsset) ? manifestAsset : path.join(repoRoot, manifestAsset);
  const absZip = path.isAbsolute(zipAsset) ? zipAsset : path.join(repoRoot, zipAsset);

  logger.log(`DRY RUN: ${collectionId}`);
  logger.log(`  release_tag: ${tag}`);
  logger.log(`  version: ${nextVersion}`);

  logger.log(await formatAssetSummary('manifest', absManifest, repoRoot));
  logger.log(await formatAssetSummary('zip', absZip, repoRoot));

  if (fs.existsSync(absZip)) {
    const zipLines = await formatZipEntries(absZip);
    zipLines.forEach(line => logger.log(line));
  }
}

async function processAffectedCollection({ repoRoot, repoSlug, args, logger, affectedCollection, spawnSync }) {
  const versionInfo = computeVersion({ repoRoot, collectionFile: affectedCollection.file, spawnSync });
  const bundle = buildBundle({
    repoRoot,
    repoSlug,
    collectionFile: affectedCollection.file,
    version: versionInfo.nextVersion,
    spawnSync,
  });

  if (args.dryRun) {
    await logDryRunSummary({
      logger,
      collectionId: affectedCollection.id,
      tag: versionInfo.tag,
      nextVersion: versionInfo.nextVersion,
      manifestAsset: bundle.manifestAsset,
      zipAsset: bundle.zipAsset,
      repoRoot,
    });
    return;
  }

  logger.log(`Collection ${affectedCollection.id}: tag ${versionInfo.tag}`);

  publishRelease({
    repoRoot,
    tag: versionInfo.tag,
    manifestAsset: bundle.manifestAsset,
    zipAsset: bundle.zipAsset,
    spawnSync,
  });
}

async function main(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const argv = opts.argv || process.argv.slice(2);
  const env = opts.env || process.env;
  const logger = opts.logger || console;
  const spawnSync = opts.spawnSync || childProcess.spawnSync;

  const args = parseArgs(argv);

  const repoSlug =
    args.repoSlug || (env.GITHUB_REPOSITORY || '').replace(/\//g, '-') || path.basename(repoRoot);

  const { paths: changedPaths, isInitialCommit } = readChangedPaths({ repoRoot, args, env, spawnSync });
  
  let affected;
  if (isInitialCommit) {
    // On initial commit, publish all collections
    logger.log('Initial commit mode: publishing all collections');
    affected = getAllCollectionFiles(repoRoot);
  } else {
    affected = detectAffected({ repoRoot, changedPaths, spawnSync });
  }

  if (affected.length === 0) {
    logger.log('No affected collections; skipping publish.');
    return;
  }

  // Ensure tags are available
  try {
    execCommand('git', ['fetch', '--tags', '--force'], repoRoot, undefined, spawnSync);
  } catch (e) {
    // Log but do not fail; useful for local dry runs in repos without remotes
    console.error(`Warning: git fetch --tags failed - ${e?.message || e}`);
  }

  for (const a of affected) {
    await processAffectedCollection({ repoRoot, repoSlug, args, logger, affectedCollection: a, spawnSync });
  }
}

module.exports = {
  main,
  parseArgs,
  commitExists,
  computeChangedPathsFromGitDiff,
  readChangedPaths,
  getAllCollectionFiles,
  listZipEntries,
  logDryRunSummary,
  PublishError,
};

if (require.main === module) {
  main().catch(e => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
