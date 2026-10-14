/**
 * Stable digest of an extracted source-file inventory.
 * @module domain/install/source-content-digest
 */
import {
  createHash,
} from 'node:crypto';
import type {
  ExtractedFiles,
} from '../../ports/bundle-extractor';
import {
  RegistryError,
} from '../registry-error';

const invalidPath = (path: string): RegistryError => new RegistryError({
  code: 'BUNDLE.INVALID_SOURCE_CONTENT_PATH',
  message: `Source content path ${JSON.stringify(path)} is not a canonical POSIX-relative path.`,
  hint: 'Use a non-empty relative path with forward slashes and no "." or ".." path segments.'
});

const pathBytes = (path: string): Buffer => {
  if (path.length === 0 || path.includes('\0') || path.includes('\\')
    || path.startsWith('/') || /^[a-zA-Z]:/.test(path)
    || path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalidPath(path);
  }
  const bytes = Buffer.from(path, 'utf8');
  if (bytes.toString('utf8') !== path) {
    throw invalidPath(path);
  }
  return bytes;
};

const updateLength = (hash: ReturnType<typeof createHash>, length: number): void => {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(length));
  hash.update(encoded);
};

/**
 * Hash source paths and raw bytes in deterministic UTF-8 path order.
 * @param files - Extracted relative paths mapped to their original bytes.
 * @returns Lowercase SHA-256 digest.
 */
export const sourceContentDigest = (files: ExtractedFiles): string => {
  const entries = [...files].map(([path, content]) => ({
    path: pathBytes(path),
    content
  }));
  const orderedEntries = entries.toSorted((left, right) => Buffer.compare(left.path, right.path));

  const hash = createHash('sha256');
  for (const entry of orderedEntries) {
    updateLength(hash, entry.path.length);
    hash.update(entry.path);
    updateLength(hash, entry.content.byteLength);
    hash.update(entry.content);
  }
  return hash.digest('hex');
};
