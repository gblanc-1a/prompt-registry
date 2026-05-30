/**
 * `@prompt-registry/collection-scripts`
 *
 * Shared scripts for building, validating, and publishing Copilot prompt collections.
 * @module @prompt-registry/collection-scripts
 *
 * NOTE: CLI utilities, validation, collections, and skills are now imported from local source files
 * to avoid binary execution issues during testing.
 */

// Import CLI utilities from local files
export {
  getPositionalArg,
  hasFlag,
  parseMultiArg,
  parseSingleArg,
} from './cli';

// Import collection utilities
export {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
} from './collections';

// Import skills utilities
export {
  createSkill,
  validateAllSkills,
} from './skills';

// Import validation utilities
export {
  validateCollectionId,
  validateVersion,
  validateItemKind,
  normalizeRepoRelativePath,
  validateCollectionObject,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
} from './validate';

// Import bundle ID utilities
export {
  generateBundleId,
} from './bundle-id';
