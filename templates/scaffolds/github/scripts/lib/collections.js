/**
 * Collection file utilities.
 * @module lib/collections
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { normalizeRepoRelativePath } = require('./validate');

/**
 * List all collection files in the repository.
 * @param {string} repoRoot - Repository root path
 * @returns {string[]} Array of collection file paths (repo-relative)
 */
function listCollectionFiles(repoRoot) {
  const collectionsDir = path.join(repoRoot, 'collections');
  return fs
    .readdirSync(collectionsDir)
    .filter(f => f.endsWith('.collection.yml'))
    .map(f => path.join('collections', f));
}

/**
 * Read and parse a collection YAML file.
 * @param {string} repoRoot - Repository root path
 * @param {string} collectionFile - Collection file path (absolute or repo-relative)
 * @returns {Object} Parsed collection object
 * @throws {Error} If file is invalid YAML or not an object
 */
function readCollection(repoRoot, collectionFile) {
  const abs = path.isAbsolute(collectionFile)
    ? collectionFile
    : path.join(repoRoot, collectionFile);
  const content = fs.readFileSync(abs, 'utf8');
  const collection = yaml.load(content);

  if (!collection || typeof collection !== 'object') {
    throw new Error(`Invalid collection YAML: ${collectionFile}`);
  }

  return collection;
}

/**
 * Recursively list all files in a directory.
 * @param {string} dirPath - Absolute path to directory
 * @param {string} basePath - Base path for relative paths
 * @returns {string[]} Array of repo-relative file paths
 */
function listFilesRecursively(dirPath, basePath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(fullPath, basePath));
    } else {
      const relPath = path.relative(basePath, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Resolve all item paths referenced in a collection.
 * For skills, expands the skill directory to include all files.
 * @param {string} repoRoot - Repository root path
 * @param {Object} collection - Parsed collection object
 * @returns {string[]} Array of normalized repo-relative paths
 */
function resolveCollectionItemPaths(repoRoot, collection) {
  const items = Array.isArray(collection.items) ? collection.items : [];
  const allPaths = [];

  for (const item of items) {
    if (!item || !item.path) continue;

    const normalizedPath = normalizeRepoRelativePath(item.path);

    if (item.kind === 'skill') {
      // For skills, the path points to SKILL.md but we need the entire directory
      const skillDir = path.dirname(path.join(repoRoot, normalizedPath));
      if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
        const skillFiles = listFilesRecursively(skillDir, repoRoot);
        allPaths.push(...skillFiles);
      } else {
        // Fallback: just include the path as-is if directory doesn't exist
        allPaths.push(normalizedPath);
      }
    } else {
      allPaths.push(normalizedPath);
    }
  }

  return allPaths;
}

module.exports = {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
};
