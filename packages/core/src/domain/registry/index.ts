/**
 * Registry domain barrel.
 *
 * The "registry" namespace covers the **install-side** Hub / Source /
 * Profile primitives — distinct from the awesome-copilot-flavored
 * "hub" concept under `domain/hub/` (which models hub *harvesters*
 * for the primitive-index feature, not registry config).
 *
 * Naming policy: types here are prefixed with `Registry` only when
 * their unprefixed name would clash with an install-layer
 * type. Otherwise we use the plain noun (`Hub`, `Profile`).
 * @module domain/registry
 */
export type {
  HubConfig,
  HubMetadata,
  HubReference,
  RegistryConfiguration,
} from './hub-config';
export {
  DEFAULT_LOCAL_HUB_ID,
  isHubConfig,
  isHubReference,
  sanitizeHubId,
} from './hub-config';
export type {
  Profile,
  ProfileActivationState,
  ProfileBundle,
} from './profile';
export {
  isProfile,
  isProfileBundle,
} from './profile';
export type {
  RegistrySource,
  RegistrySourceType,
} from './registry-source';
export {
  isRegistrySource,
} from './registry-source';
