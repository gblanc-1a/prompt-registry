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
 * Resolve all item paths referenced in a collection.
 * @param {string} repoRoot - Repository root path
 * @param {Object} collection - Parsed collection object
 * @returns {string[]} Array of normalized repo-relative paths
 */
function resolveCollectionItemPaths(repoRoot, collection) {
  const items = Array.isArray(collection.items) ? collection.items : [];
  return items
    .map(i => i && i.path)
    .filter(Boolean)
    .map(p => normalizeRepoRelativePath(p));
}

module.exports = {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
};
