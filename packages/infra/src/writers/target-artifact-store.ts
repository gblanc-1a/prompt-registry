/**
 * SafeTargetArtifactStore — the `TargetArtifactStorePort` implementation.
 *
 * Three guarantees, in this order, for every operation:
 *
 *   1. **Containment.** The path must resolve inside its destination root
 *      lexically, and no component under that root may be a symbolic link — even
 *      one that currently resolves inside the root, because a link's target can
 *      change between the check and the write (BR2.2, NFR1.1.1).
 *   2. **Durability.** A write is a temp-file + `fsync` + atomic `rename` +
 *      directory `fsync` replacement, never a direct overwrite (NFR1.1.2).
 *   3. **Evidence.** A write is followed by a read-back, and a removal by an
 *      absence check. The store reports what it observed; whether that is
 *      acceptable is the lifecycle's decision (BR4.1, BR4.6).
 *
 * The store never decides policy: no consent, no local-change detection, no
 * ownership. Those are lifecycle concerns.
 * @module writers/target-artifact-store
 */
import {
  readFile,
  rm,
} from 'node:fs/promises';
import type {
  PathInspector,
  TargetArtifactStorePort,
  TargetArtifactStoreResult,
  TargetArtifactWrite,
} from '@ai-primitives-hub/core';
import {
  isContainedPath,
} from '@ai-primitives-hub/core';
import {
  replaceFileDurably,
} from '../storage/durable-file';

/**
 * Options accepted by {@link SafeTargetArtifactStore}.
 */
export interface SafeTargetArtifactStoreOptions {
  readonly pathInspector: PathInspector;
}

/**
 * Contained, durable, verified target artifact I/O.
 */
export class SafeTargetArtifactStore implements TargetArtifactStorePort {
  /**
   * Create a SafeTargetArtifactStore.
   * @param opts Injected path inspector.
   */
  public constructor(private readonly opts: SafeTargetArtifactStoreOptions) {}

  /**
   * Refuse a path that escapes its root or crosses a symbolic link.
   * @param destinationRoot - Verified destination root.
   * @param destinationPath - Candidate destination path.
   * @returns A refusal detail, or `null` when the path is safe.
   */
  private async refuse(destinationRoot: string, destinationPath: string): Promise<string | null> {
    if (!isContainedPath(destinationRoot, destinationPath)) {
      return `"${destinationPath}" is not contained in "${destinationRoot}"`;
    }
    const segments = destinationPath
      .slice(destinationRoot.length)
      .split('/')
      .filter((segment) => segment.length > 0);
    let current = destinationRoot;
    for (const segment of segments) {
      current = `${current}/${segment}`;
      if (await this.opts.pathInspector.isSymbolicLink(current)) {
        return `"${current}" is a symbolic link`;
      }
    }
    return null;
  }

  public async writeAndReadBack(
    request: TargetArtifactWrite
  ): Promise<TargetArtifactStoreResult<Uint8Array>> {
    const refusal = await this.refuse(request.destinationRoot, request.destinationPath);
    if (refusal !== null) {
      return { kind: 'safety-blocked', detail: refusal };
    }
    try {
      await replaceFileDurably(request.destinationPath, request.bytes);
    } catch (error) {
      return { kind: 'retryable-failure', detail: `write failed: ${(error as Error).message}` };
    }
    // Re-check after the write: a component that became a link while the write
    // was in flight must not be read back through.
    const postRefusal = await this.refuse(request.destinationRoot, request.destinationPath);
    if (postRefusal !== null) {
      return { kind: 'safety-blocked', detail: postRefusal };
    }
    try {
      const written = await readFile(request.destinationPath);
      return {
        kind: 'ok',
        value: new Uint8Array(written.buffer, written.byteOffset, written.byteLength)
      };
    } catch (error) {
      return {
        kind: 'retryable-failure',
        detail: `unreadable after write: ${(error as Error).message}`
      };
    }
  }

  public async read(
    destinationRoot: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult<Uint8Array | null>> {
    const refusal = await this.refuse(destinationRoot, destinationPath);
    if (refusal !== null) {
      return { kind: 'safety-blocked', detail: refusal };
    }
    try {
      const bytes = await readFile(destinationPath);
      return {
        kind: 'ok',
        value: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return { kind: 'ok', value: null };
      }
      return { kind: 'retryable-failure', detail: `unreadable: ${(error as Error).message}` };
    }
  }

  public async removeAndVerifyAbsent(
    destinationRoot: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult> {
    const refusal = await this.refuse(destinationRoot, destinationPath);
    if (refusal !== null) {
      return { kind: 'safety-blocked', detail: refusal };
    }
    try {
      await rm(destinationPath, { force: true });
    } catch (error) {
      return { kind: 'retryable-failure', detail: `removal failed: ${(error as Error).message}` };
    }
    const stillThere = await this.read(destinationRoot, destinationPath);
    if (stillThere.kind === 'safety-blocked' || stillThere.kind === 'retryable-failure') {
      return { kind: stillThere.kind, detail: stillThere.detail };
    }
    if (stillThere.value !== null) {
      return {
        kind: 'retryable-failure',
        detail: `"${destinationPath}" is still present after removal`
      };
    }
    return { kind: 'ok', value: undefined };
  }
}
