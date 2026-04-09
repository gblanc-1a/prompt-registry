/**
 * External consumer that instantiates HubCommands.
 * This makes constructor run, which calls registerCommands().
 */
import { HubCommands } from './hub-commands';

export function activate(): void {
  new HubCommands();
}
