/**
 * Application layer barrel — use-case orchestrators that depend only
 * on domain types and port interfaces. No concrete adapters here.
 * @module app
 */

// Context detection
export * from './context-detection';

// Collection
export * from './collection/generate-skill';
export * from './collection/read-collection';

// Discovery
export * from './discovery/recommendation-engine';

// Install
export * from './install';
export * from './install/uninstall-pipeline';
export * from './install/layout-resolver';

// Registry
export * from './registry';

// Search
export * from './search/export-profile';

// Transform
export * from './transform/transformer-registry';

// Writers (moved from infra due to CLI dependencies)
export * from './writers/file-tree-writer';

// Stores (moved from infra due to CLI dependencies)
export * from './stores/json-lockfile-store';
export * from './stores/active-hub-store';
export * from './stores/yaml-hub-store';

// Resolvers (moved from infra due to CLI dependencies)
export * from './resolvers/resolver-registry';
