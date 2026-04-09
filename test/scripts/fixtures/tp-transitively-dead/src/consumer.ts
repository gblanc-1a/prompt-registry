/**
 * External consumer that only uses readJson — 
 * isDirectory, ensureDirectory, exists, getStats remain dead.
 */
import { FileUtils } from './file-utils';

export function loadConfig(): object {
  return FileUtils.readJson('./config.json');
}
