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

/**
 * Select the bundled hub list or use the supplied fallback when it is empty.
 * @param configuredHubs - Statically imported, repository-owned configuration.
 * @param fallbackHubs - Hardcoded defaults used when no hubs are configured.
 * @param onLog - Optional sink for the selected source.
 */
export function resolveDefaultHubs(
  configuredHubs: DefaultHubConfig[],
  fallbackHubs: DefaultHubConfig[],
  onLog?: OnLogEvent
): DefaultHubConfig[] {
  if (configuredHubs.length > 0) {
    onLog?.({
      level: 'debug',
      message: `Loaded ${String(configuredHubs.length)} default hub(s) from bundled default-hubs.json.`
    });
    return configuredHubs;
  }

  onLog?.({
    level: 'warn',
    message: `Bundled default-hubs.json is empty; loaded ${String(fallbackHubs.length)} hardcoded default hub(s).`
  });
  return fallbackHubs;
}
