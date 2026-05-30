/**
 * Node.js filesystem adapter for CLI tests.
 * Wraps node:fs/promises to match the FileSystem interface.
 */

import * as fs from 'node:fs/promises';
import type {
  FileSystem,
} from '@prompt-registry/core';

/**
 * Create a real filesystem adapter using node:fs/promises.
 */
export function createNodeFsAdapter(): FileSystem {
  return {
    readFile: async (path: string): Promise<string> => {
      return await fs.readFile(path, 'utf8');
    },
    writeFile: async (path: string, content: string): Promise<void> => {
      await fs.writeFile(path, content, 'utf8');
    },
    readJson: async <T = unknown>(path: string): Promise<T> => {
      const content = await fs.readFile(path, 'utf8');
      return JSON.parse(content) as T;
    },
    writeJson: async (path: string, data: unknown): Promise<void> => {
      await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
    },
    exists: async (path: string): Promise<boolean> => {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path: string): Promise<void> => {
      await fs.mkdir(path, { recursive: true });
    },
    readDir: async (path: string): Promise<string[]> => {
      const entries = await fs.readdir(path, { withFileTypes: true });
      return entries.map((e) => e.name);
    },
    remove: async (path: string): Promise<void> => {
      await fs.rm(path, { recursive: true, force: true });
    }
  };
}
