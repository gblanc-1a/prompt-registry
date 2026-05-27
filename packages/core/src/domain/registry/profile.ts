/**
 * Profile (lib variant).
 *
 * A **Profile** is a User-level grouping of bundles that drives
 * atomic (un)install. It reflects a role / assignment-type / domain
 * (e.g. "backend developer", "DevSecOps", "tech writer"). Profiles
 * are **target-agnostic**: the same profile activates against
 * whichever user-level targets the user has configured.
 *
 * There is one **active profile globally** at any time;
 * activating a new one deactivates the previous one.
 * @module domain/registry/profile
 */

/**
 * Reference to a bundle inside a profile. The `source` field is the
 * stable sourceId (12-hex form) the resolver will use to dispatch
 * the install. The `version` field accepts `'latest'` or an exact
 * semver string.
 */
export interface ProfileBundle {
  /** Bundle id (matches `deployment-manifest.yml` `id`). */
  id: string;
  /** Bundle version (`'latest'` or exact `X.Y.Z`). */
  version: string;
  /** Source id this bundle is fetched from. */
  source: string;
  /** Whether this bundle is required (advisory; rollback uses it as a hint). */
  required: boolean;
}

/**
 * On-disk shape of a profile entry. Lives inside a `HubConfig`'s
 * `profiles[]`; identifiable globally by `(hubId, profileId)`.
 */
export interface Profile {
  /** Profile id; sanitized like `sanitizeHubId`. */
  id: string;
  /** Display name. */
  name: string;
  /** Optional UI icon hint. */
  icon?: string;
  /** Optional description (free-form markdown). */
  description?: string;
  /** Bundles in this profile (`required` ones drive rollback hints). */
  bundles: ProfileBundle[];
  /**
   * Optional path for nested profile organization (extension UI
   * uses it for tree grouping; lib carries it verbatim).
   */
  path?: string[];
  /** Whether this profile is currently active. Set by the activation engine. */
  active?: boolean;
}

/**
 * Profile activation state, persisted at the user level under
 * `<XDG_CONFIG_HOME>/prompt-registry/profile-activations/{hubId}_{profileId}.json`.
 *
 * Mirrors the extension's `ProfileActivationState` so an extension-
 * activated profile can be deactivated by the CLI and vice versa
 * (modulo the storage location difference).
 */
export interface ProfileActivationState {
  /** Schema version for migration support. */
  schemaVersion: 1;
  hubId: string;
  profileId: string;
  /** ISO-8601 timestamp of activation. */
  activatedAt: string;
  /** Bundle ids that were installed by this activation. */
  syncedBundles: string[];
  /** Bundle id -> exact installed version. */
  syncedBundleVersions: Record<string, string>;
  /**
   * Per-target write log: which targets actually received bytes
   * during this activation. Drives deactivation (uninstall undoes
   * exactly this set, no more, no less).
   */
  syncedTargets: string[];
}

/**
 * Type guard for `ProfileBundle`. Pure; no IO.
 * @param x Candidate.
 * @returns true iff `x` is a ProfileBundle.
 */
export const isProfileBundle = (x: unknown): x is ProfileBundle => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.id === 'string' && obj.id.length > 0
    && typeof obj.version === 'string' && obj.version.length > 0
    && typeof obj.source === 'string' && obj.source.length > 0
    && typeof obj.required === 'boolean'
  );
};

/**
 * Type guard for `Profile`. Pure; no IO.
 * @param x Candidate.
 * @returns true iff `x` is a Profile.
 */
export const isProfile = (x: unknown): x is Profile => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return false;
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return false;
  }
  if (!Array.isArray(obj.bundles)) {
    return false;
  }
  return obj.bundles.every((b) => isProfileBundle(b));
};
