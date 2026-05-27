/**
 * Registry HubConfig.
 *
 * Mirrors the extension's `src/types/hub.ts` `HubConfig` shape
 * additively. The lib variant intentionally omits the
 * extension-only UI-state fields (`ConflictResolutionDialog`,
 * `formatChangeSummary`, etc.) and any `vscode.*`-bound members.
 *
 * Same field names + shapes as the extension; same JSON-schema
 * (`schemas/hub-config.schema.json`) is re-usable as the validator.
 * @module domain/registry/hub-config
 */

import type {
  Profile,
} from './profile';
import type {
  RegistrySource,
} from './registry-source';

/**
 * Reference to a hub location (where the hub config lives).
 * `local` is also used internally for the synthetic default-local
 * hub and for unit-tested fixtures.
 */
export interface HubReference {
  type: 'github' | 'local' | 'url';
  /** owner/repo (github), absolute path (local), or full URL (url). */
  location: string;
  /** Git ref (branch/tag/commit) for github sources; defaults to `main`. */
  ref?: string;
  /** Whether this hub auto-syncs (advisory; lib does not enforce). */
  autoSync?: boolean;
}

/** Hub metadata (mirrors extension). */
export interface HubMetadata {
  name: string;
  description: string;
  maintainer: string;
  /** ISO-8601 timestamp of last hub-config update. */
  updatedAt: string;
  /** Optional integrity hash for fetched configs (`sha256:<hex>`). */
  checksum?: string;
}

/**
 * Optional registry configuration block carried by hub configs.
 * Mirrors the extension's `RegistryConfiguration`. None of these
 * fields are enforced by lib; they are advisory metadata for UI
 * consumers.
 */
export interface RegistryConfiguration {
  autoSync?: boolean;
  /** Suggested sync interval in seconds. */
  syncInterval?: number;
  /** Strict mode — see extension's `HubManager` for semantics. */
  strictMode?: boolean;
}

/**
 * The on-disk shape of `hub-config.yml`. Top-level container for
 * sources + profiles published by a hub maintainer.
 */
export interface HubConfig {
  /** Hub-config schema version (semver string). */
  version: string;
  metadata: HubMetadata;
  /** Sources curated by this hub. */
  sources: RegistrySource[];
  /** Profiles curated by this hub. */
  profiles: Profile[];
  configuration?: RegistryConfiguration;
}

/**
 * The synthetic default-local hub identifier. Reserved; users
 * cannot create a hub with this id via `hub add`.
 */
export const DEFAULT_LOCAL_HUB_ID = 'default-local';

/**
 * Sanitize a hub identifier to the same rules the extension uses
 * (lowercase, alnum + dash). Throws on inputs that cannot be made
 * compliant (empty after sanitization).
 *
 * Mirrors `sanitizeHubId` in `src/types/hub.ts` so a hub id minted
 * here is interchangeable with one minted by the extension.
 * @param id Candidate hub identifier.
 * @returns Sanitized id.
 */
export const sanitizeHubId = (id: string): string => {
  const sanitized = id
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  if (sanitized.length === 0) {
    throw new Error(`Invalid hub id (empty after sanitization): ${id}`);
  }
  if (sanitized.length > 64) {
    throw new Error(`Invalid hub id (>64 chars after sanitization): ${sanitized}`);
  }
  return sanitized;
};

/**
 * Type guard for `HubReference`. Pure; no IO.
 * @param x Candidate value.
 * @returns true iff `x` is a valid HubReference.
 */
export const isHubReference = (x: unknown): x is HubReference => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  if (obj.type !== 'github' && obj.type !== 'local' && obj.type !== 'url') {
    return false;
  }
  return typeof obj.location === 'string' && obj.location.length > 0;
};

/**
 * Type guard for `HubConfig`. Pure; no IO.
 * Validates the **structural** shape only; full schema validation
 * (e.g. semver of `version`, ISO-8601 of `updatedAt`) is left to
 * the JSON-schema validator.
 * @param x Candidate value.
 * @returns true iff `x` is a structurally-valid HubConfig.
 */
export const isHubConfig = (x: unknown): x is HubConfig => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  if (typeof obj.version !== 'string') {
    return false;
  }
  if (obj.metadata === null || typeof obj.metadata !== 'object') {
    return false;
  }
  if (!Array.isArray(obj.sources) || !Array.isArray(obj.profiles)) {
    return false;
  }
  return true;
};
