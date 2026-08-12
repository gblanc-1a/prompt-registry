import type {
  HubReference,
  OnLogEvent,
} from '@ai-primitives-hub/core';

export interface DefaultHubConfig {
  name: string;
  description: string;
  icon: string;
  codicon?: string;
  reference: HubReference;
  recommended?: boolean;
  enabled?: boolean;
}

function isDefaultHubConfig(value: unknown): value is DefaultHubConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const hub = value as Partial<DefaultHubConfig>;
  const reference = hub.reference as Partial<HubReference> | undefined;
  return typeof hub.name === 'string'
    && typeof hub.description === 'string'
    && typeof hub.icon === 'string'
    && typeof reference?.type === 'string'
    && typeof reference.location === 'string';
}

/**
 *
 * @param configuredHubs
 * @param fallbackHubs
 */
/**
 * Select a valid configured hub list or use the supplied fallback.
 * @param configuredHubs - Statically imported configuration to validate.
 * @param fallbackHubs - Hardcoded defaults used when configuration is invalid.
 * @param onLog
 */
export function resolveDefaultHubs(
  configuredHubs: unknown,
  fallbackHubs: DefaultHubConfig[],
  onLog?: OnLogEvent
): DefaultHubConfig[] {
  if (Array.isArray(configuredHubs) && configuredHubs.length > 0
    && configuredHubs.every((hub) => isDefaultHubConfig(hub))) {
    onLog?.({
      level: 'debug',
      message: `Loaded ${String(configuredHubs.length)} default hub(s) from bundled default-hubs.json.`
    });
    return configuredHubs;
  }

  onLog?.({
    level: 'warn',
    message: `Bundled default-hubs.json is empty or invalid; loaded ${String(fallbackHubs.length)} hardcoded default hub(s).`
  });
  return fallbackHubs;
}
