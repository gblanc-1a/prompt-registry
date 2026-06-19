/**
 * Default Hub Configurations
 *
 * This file contains the default hub configurations offered to users
 * during first-time installation. Each hub configuration is verified
 * for accessibility before being activated.
 */

import {
  type HubReference,
} from '@prompt-registry/core';

export interface DefaultHubConfig {
  /** Display name for the hub */
  name: string;

  /** Description shown in the selector */
  description: string;

  /** Icon identifier (for CLI display, may be emoji or text) */
  icon: string;

  /** Hub reference configuration */
  reference: HubReference;

  /** Whether this is the recommended default */
  recommended?: boolean;

  /** Whether to show this hub in first-run selector */
  enabled?: boolean;
}

/**
 * Default hubs offered during installation (hardcoded fallback)
 *
 * These hubs will be:
 * 1. Verified for accessibility (URL reachable)
 * 2. Shown in the first-run hub selector
 * 3. Imported with proper authentication if selected
 */
const HARDCODED_DEFAULT_HUBS: DefaultHubConfig[] = [
  {
    name: 'Amadeus',
    description: 'Profiles curated by Amadeus',
    icon: '☁️',
    reference: {
      type: 'github',
      location: 'Amadeus-xDLC/genai.prompt-registry-config',
      ref: 'main'
    },
    recommended: true,
    enabled: true
  },
  {
    name: 'Prompt Registry Community Hub',
    description: 'Profiles curated by the Prompt Registry Community',
    icon: '🌐',
    reference: {
      type: 'github',
      location: 'AmadeusITGroup/prompt-registry-config',
      ref: 'main'
    },
    recommended: true,
    enabled: true
  }
];

/**
 * Get all default hubs
 */
export function getDefaultHubs(): DefaultHubConfig[] {
  return HARDCODED_DEFAULT_HUBS;
}

/**
 * Get all enabled default hubs
 */
export function getEnabledDefaultHubs(): DefaultHubConfig[] {
  return getDefaultHubs().filter((hub) => hub.enabled !== false);
}

/**
 * Get the recommended default hub
 */
export function getRecommendedHub(): DefaultHubConfig | undefined {
  return getDefaultHubs().find((hub) => hub.recommended && hub.enabled !== false);
}

/**
 * Find a default hub by name
 * @param name Hub name
 */
export function findDefaultHub(name: string): DefaultHubConfig | undefined {
  return getDefaultHubs().find((hub) => hub.name === name);
}

/**
 * Clear cache (no-op since getDefaultHubs returns hardcoded array)
 * Kept for backward compatibility with tests
 */
export function clearCache(): void {
  // No-op: getDefaultHubs returns HARDCODED_DEFAULT_HUBS directly
}
