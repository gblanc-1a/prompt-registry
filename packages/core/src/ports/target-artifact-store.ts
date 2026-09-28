/**
 * TargetArtifactStorePort — writes, reads, and removes one target artifact, with
 * containment and symbolic-link safety.
 *
 * Every operation is refused before touching the filesystem when the path
 * escapes its destination root or any component under that root is a symbolic
 * link (BR2.2, NFR1.1.1). Writes go through one durable replacement primitive:
 * temp file in the final directory, `fsync`, atomic same-filesystem `rename`,
 * parent-directory `fsync` where supported — so a final path is never observed
 * torn (NFR1.1.2).
 *
 * The store writes bytes; it never decides whether a write is *allowed* by
 * lifecycle policy. Local-change detection, overwrite consent, and ownership
 * claims are the lifecycle's job.
 *
 * Concrete adapters live in `infra`.
 * @module ports/target-artifact-store
 */

/**
 * Why a store operation was refused.
 */
export type TargetArtifactStoreRefusal = 'safety-blocked' | 'retryable-failure';

/**
 * Outcome of one store operation.
 */
export type TargetArtifactStoreResult<TValue = undefined> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'safety-blocked'; readonly detail: string }
  | { readonly kind: 'retryable-failure'; readonly detail: string };

/**
 * One write request: the exact bytes to place at one contained destination.
 */
export interface TargetArtifactWrite {
  readonly destinationRoot: string;
  readonly destinationPath: string;
  /** The exact byte sequence to write, already transformed. */
  readonly bytes: Uint8Array;
}

/**
 * Reads, writes, and removes target artifacts safely.
 */
export interface TargetArtifactStorePort {
  /**
   * Write bytes durably and read them back for verification.
   *
   * The caller compares the returned bytes against what it intended: the store
   * reports what is on disk, it does not decide whether that is acceptable.
   * @param request Destination root, destination path, and bytes.
   * @returns The bytes read back after the write.
   */
  writeAndReadBack(request: TargetArtifactWrite): Promise<TargetArtifactStoreResult<Uint8Array>>;

  /**
   * Read the current bytes at a destination.
   * @param destinationRoot Verified destination root.
   * @param destinationPath Contained destination path.
   * @returns The bytes, or `null` when the path does not exist.
   */
  read(
    destinationRoot: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult<Uint8Array | null>>;

  /**
   * Remove a destination and confirm it is absent afterwards (BR4.6).
   * @param destinationRoot Verified destination root.
   * @param destinationPath Contained destination path.
   * @returns `ok` only when the path is verified absent after the call.
   */
  removeAndVerifyAbsent(
    destinationRoot: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult>;
}
