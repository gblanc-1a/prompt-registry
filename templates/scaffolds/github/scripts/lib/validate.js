/**
 * Collection validation utilities.
 * @module lib/validate
 * 
 * Shared validation logic for collection files.
 * Used by validate-collections.js, build-collection-bundle.js, and publish-collections.js
 * to ensure consistent validation across all components (per Requirement 12.2).
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Load valid item kinds from the JSON schema (single source of truth).
 * Falls back to a default list if schema cannot be loaded.
 * @returns {string[]} Array of valid item kinds
 */
function loadItemKindsFromSchema() {
  try {
    const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'collection.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const kinds = schema?.properties?.items?.items?.properties?.kind?.enum;
    if (Array.isArray(kinds) && kinds.length > 0) {
      return kinds;
    }
  } catch (e) {
    // Schema unavailable or malformed, use fallback
  }
  return ['prompt', 'instruction', 'agent', 'skill'];
}

/**
 * Validation rules for collections.
 * These rules are shared across all validation components for consistency.
 * Item kinds are loaded from the JSON schema for single source of truth.
 * @constant {Object}
 */
const VALIDATION_RULES = {
  collectionId: {
    maxLength: 100,
    pattern: /^[a-z0-9-]+$/,
    description: 'lowercase letters, numbers, and hyphens only'
  },
  version: {
    pattern: /^\d+\.\d+\.\d+$/,
    default: '1.0.0',
    description: 'semantic versioning format (X.Y.Z)'
  },
  itemKinds: loadItemKindsFromSchema(),
  deprecatedKinds: {
    'chatmode': 'agent',
    'chat-mode': 'agent'
  }
};

/**
 * Validate a collection ID.
 * @param {string} id - Collection ID to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateCollectionId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Collection ID is required and must be a string' };
  }

  if (id.length > VALIDATION_RULES.collectionId.maxLength) {
    return { 
      valid: false, 
      error: `Collection ID must be at most ${VALIDATION_RULES.collectionId.maxLength} characters (got ${id.length})` 
    };
  }

  if (!VALIDATION_RULES.collectionId.pattern.test(id)) {
    return { 
      valid: false, 
      error: `Collection ID must contain only ${VALIDATION_RULES.collectionId.description}` 
    };
  }

  return { valid: true };
}

/**
 * Validate a version string.
 * @param {string} version - Version string to validate
 * @returns {{valid: boolean, error?: string, normalized?: string}} Validation result
 */
function validateVersion(version) {
  // If no version provided, use default
  if (version === undefined || version === null) {
    return { valid: true, normalized: VALIDATION_RULES.version.default };
  }

  if (typeof version !== 'string') {
    return { valid: false, error: 'Version must be a string' };
  }

  if (!VALIDATION_RULES.version.pattern.test(version)) {
    return { 
      valid: false, 
      error: `Version must follow ${VALIDATION_RULES.version.description} (got "${version}")` 
    };
  }

  return { valid: true, normalized: version };
}

/**
 * Validate an item kind.
 * @param {string} kind - Item kind to validate
 * @returns {{valid: boolean, error?: string, deprecated?: boolean, replacement?: string}} Validation result
 */
function validateItemKind(kind) {
  if (!kind || typeof kind !== 'string') {
    return { valid: false, error: 'Item kind is required and must be a string' };
  }

  const normalizedKind = kind.toLowerCase();

  // Check for deprecated kinds (chatmode)
  if (VALIDATION_RULES.deprecatedKinds[normalizedKind]) {
    const replacement = VALIDATION_RULES.deprecatedKinds[normalizedKind];
    return { 
      valid: false, 
      error: `Item kind '${kind}' is deprecated. Use '${replacement}' instead`,
      deprecated: true,
      replacement
    };
  }

  // Check for valid kinds
  if (!VALIDATION_RULES.itemKinds.includes(normalizedKind)) {
    return { 
      valid: false, 
      error: `Invalid item kind '${kind}'. Must be one of: ${VALIDATION_RULES.itemKinds.join(', ')}` 
    };
  }

  return { valid: true };
}

/**
 * Normalize a path to be repo-root relative.
 * Uses POSIX normalization since collection paths are repo-root relative
 * and should work consistently across platforms.
 * @param {string} p - Path to normalize
 * @returns {string} Normalized repo-relative path
 * @throws {Error} If path is empty, traverses outside repo, or is absolute
 */
function normalizeRepoRelativePath(p) {
  if (!p || typeof p !== 'string') throw new Error('path must be a non-empty string');

  const s = String(p).trim().replace(/\\/g, '/').replace(/^\//, '');
  if (!s) throw new Error('path must be a non-empty string');

  // Use posix normalization since collection paths are repo-root relative.
  const normalized = path.posix.normalize(s);
  if (normalized.startsWith('../') || normalized === '..') throw new Error('path must not traverse outside repo');
  if (normalized.startsWith('/')) throw new Error('path must be repo-root relative');
  return normalized;
}

/**
 * Check if a path is a safe repo-relative path.
 * @param {string} p - Path to check
 * @returns {boolean} True if path is valid and safe
 */
function isSafeRepoRelativePath(p) {
  try {
    normalizeRepoRelativePath(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a collection object structure.
 * @param {Object} collection - Parsed collection object
 * @param {string} sourceLabel - Label for error messages
 * @returns {{ok: boolean, errors: string[]}} Validation result
 */
function validateCollectionObject(collection, sourceLabel) {
  const errors = [];

  if (!collection || typeof collection !== 'object') {
    return { ok: false, errors: [`${sourceLabel}: YAML did not parse to an object`] };
  }

  // Validate collection ID
  if (!collection.id || typeof collection.id !== 'string') {
    errors.push(`${sourceLabel}: Missing required field: id`);
  } else {
    const idResult = validateCollectionId(collection.id);
    if (!idResult.valid) {
      errors.push(`${sourceLabel}: ${idResult.error}`);
    }
  }

  if (!collection.name || typeof collection.name !== 'string') {
    errors.push(`${sourceLabel}: Missing required field: name`);
  }

  // Validate version if present
  if (collection.version !== undefined) {
    const versionResult = validateVersion(collection.version);
    if (!versionResult.valid) {
      errors.push(`${sourceLabel}: ${versionResult.error}`);
    }
  }

  if (!Array.isArray(collection.items)) {
    errors.push(`${sourceLabel}: Missing required field: items (array)`);
  }

  if (Array.isArray(collection.items)) {
    collection.items.forEach((item, idx) => {
      const prefix = `${sourceLabel}: items[${idx}]`;
      if (!item || typeof item !== 'object') {
        errors.push(`${prefix}: must be an object`);
        return;
      }
      if (!item.path || typeof item.path !== 'string') {
        errors.push(`${prefix}: Missing required field: path`);
      } else {
        try {
          normalizeRepoRelativePath(item.path);
        } catch {
          errors.push(`${prefix}: Invalid path (must be repo-root relative): ${item.path}`);
        }
      }
      if (!item.kind || typeof item.kind !== 'string') {
        errors.push(`${prefix}: Missing required field: kind`);
      } else {
        // Validate item kind (including chatmode rejection)
        const kindResult = validateItemKind(item.kind);
        if (!kindResult.valid) {
          errors.push(`${prefix}: ${kindResult.error}`);
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a collection file from disk.
 * Checks YAML syntax, required fields, and referenced file existence.
 * @param {string} repoRoot - Repository root path
 * @param {string} collectionFile - Collection file path (absolute or repo-relative)
 * @returns {{ok: boolean, errors: string[], collection?: Object}} Validation result with parsed collection
 */
function validateCollectionFile(repoRoot, collectionFile) {
  const rel = collectionFile.replace(/\\/g, '/');
  const abs = path.isAbsolute(collectionFile)
    ? collectionFile
    : path.join(repoRoot, collectionFile);

  const errors = [];

  if (!fs.existsSync(abs)) {
    return { ok: false, errors: [`${rel}: Collection file not found`] };
  }

  let collection;
  try {
    collection = yaml.load(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`${rel}: YAML parse error: ${e.message}`] };
  }

  const schema = validateCollectionObject(collection, rel);
  errors.push(...schema.errors);

  if (Array.isArray(collection?.items)) {
    collection.items.forEach((item, idx) => {
      if (!item?.path || typeof item.path !== 'string') return;
      let relPath;
      try {
        relPath = normalizeRepoRelativePath(item.path);
      } catch {
        return;
      }

      const itemAbs = path.join(repoRoot, relPath);
      if (!fs.existsSync(itemAbs)) {
        errors.push(`${rel}: items[${idx}] referenced file not found: ${relPath}`);
      }
    });
  }

  return { ok: errors.length === 0, errors, collection };
}

/**
 * Validate all collections in a repository, including duplicate detection.
 * @param {string} repoRoot - Repository root path
 * @param {string[]} collectionFiles - Array of collection file paths (repo-relative)
 * @returns {{ok: boolean, errors: string[], fileResults: Object[]}} Validation result
 */
function validateAllCollections(repoRoot, collectionFiles) {
  const errors = [];
  const fileResults = [];
  const seenIds = new Map(); // id -> file path
  const seenNames = new Map(); // name -> file path

  for (const file of collectionFiles) {
    const result = validateCollectionFile(repoRoot, file);
    fileResults.push({ file, ...result });
    errors.push(...result.errors);

    // Check for duplicate IDs and names
    if (result.collection) {
      const { id, name } = result.collection;
      
      if (id && seenIds.has(id)) {
        errors.push(`${file}: Duplicate collection ID '${id}' (also in ${seenIds.get(id)})`);
      } else if (id) {
        seenIds.set(id, file);
      }

      if (name && seenNames.has(name)) {
        errors.push(`${file}: Duplicate collection name '${name}' (also in ${seenNames.get(name)})`);
      } else if (name) {
        seenNames.set(name, file);
      }
    }
  }

  return { ok: errors.length === 0, errors, fileResults };
}

/**
 * Generate markdown content for PR comment from validation result.
 * @param {Object} result - Result from validateAllCollections
 * @param {number} totalFiles - Total number of collection files
 * @returns {string} Markdown content
 */
function generateMarkdown(result, totalFiles) {
  let md = '## 📋 Collection Validation Results\n\n';
  
  if (result.ok) {
    md += `✅ **All ${totalFiles} collection(s) validated successfully!**\n`;
  } else {
    md += `❌ **Validation failed with ${result.errors.length} error(s)**\n\n`;
    md += '### Errors\n\n';
    result.errors.forEach(err => {
      md += `- ${err}\n`;
    });
  }
  
  return md;
}

module.exports = {
  // Validation rules (for consistency across components)
  VALIDATION_RULES,
  
  // Individual validators
  validateCollectionId,
  validateVersion,
  validateItemKind,
  
  // Path utilities
  normalizeRepoRelativePath,
  isSafeRepoRelativePath,
  
  // Collection validators
  validateCollectionFile,
  validateCollectionObject,
  validateAllCollections,
  
  // Output formatters
  generateMarkdown,
};
