/**
 * Bundle ID Generation Utilities
 * 
 * IMPORTANT: This logic MUST stay in sync with the runtime implementation in:
 * src/utils/bundleNameUtils.ts (generateBuildScriptBundleId function)
 * 
 * The bundle ID format is: {owner}-{repo}-{collectionId}-v{version}
 * 
 * Any changes here should be mirrored in bundleNameUtils.ts and vice versa.
 */

/**
 * Generate canonical bundle ID for consistency with runtime.
 * 
 * @param {string} repoSlug - Repository slug (owner/repo or owner-repo)
 * @param {string} collectionId - Collection identifier
 * @param {string} version - Version string (without 'v' prefix)
 * @returns {string} Canonical bundle ID
 * 
 * @example
 * generateBundleId('owner/repo', 'my-collection', '1.0.0')
 * // Returns: 'owner-repo-my-collection-v1.0.0'
 */
function generateBundleId(repoSlug, collectionId, version) {
  // Normalize repo slug to use hyphens (consistent with runtime)
  const normalizedSlug = repoSlug.replace('/', '-');
  return `${normalizedSlug}-${collectionId}-v${version}`;
}

module.exports = {
  generateBundleId
};
