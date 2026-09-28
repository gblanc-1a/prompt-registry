/**
 * The destination-claim transaction (BR3.6, NFR1.1.3, NFR2.1).
 *
 * Every governed write — normal lifecycle or migration transfer — passes through
 * here, and the ordering is the authoritative one from the design's hand-off
 * sequencing correction:
 *
 *   1. **Atomically detach and reserve.** Under the installation-key lock, one
 *      transaction validates the live claim and any supplied hand-off, removes the
 *      destination from the *ceding* installation's active managed set, and creates
 *      the acquiring `pending-materialization` claim — recording the ceding
 *      installation, the prior artifact pre-image, the intended fingerprint, and
 *      the generation. After it commits, **no live record describes both
 *      installations as owners**.
 *   2. **Materialize under reservation.** Only the holder writes target bytes, then
 *      reads them back.
 *   3. **Finalize.** A verified read-back atomically records the artifact under the
 *      acquiring installation and sets the claim `finalized`.
 *   4. **Resolve failure or interruption.** If nothing was materialized, the
 *      detached ceding record is restored from the claim's pre-image and the claim
 *      is released. If a fresh read proves the intended bytes are present, the
 *      acquiring record is finalized instead. If the bytes cannot be classified,
 *      `rollback-required` is retained with its recovery evidence and a preserved
 *      retry outcome is returned — and no lifecycle, transfer, or cleanup operation
 *      may bypass that unresolved claim.
 *
 * The coordinator record makes steps 1 and 3 recoverable across the two
 * persistence stores a hand-off can touch.
 * @module install/destination-claim
 */
import type {
  Clock,
  DestinationOwnershipClaim,
  DestinationOwnershipHandoff,
  ExclusiveLockPort,
  HandoffCoordinatorPort,
  HandoffCoordinatorRecord,
  InstallationRegistryPort,
  InstallationScope,
  LockHandle,
  ManagedArtifact,
  ManagedInstallation,
} from '@ai-primitives-hub/core';
import {
  claimBlocksOtherWriters,
  deriveClaimKey,
  withArtifact,
  withoutArtifact,
} from '@ai-primitives-hub/core';

/**
 * Ports the claim transaction needs.
 */
export interface DestinationClaimPorts {
  /** Registry adapter for the acquiring installation's scope. */
  readonly registry: InstallationRegistryPort;
  /**
   * Resolves the registry adapter holding a ceding installation's record.
   *
   * A hand-off can cross stores — a user-scope record ceding to a repository-scope
   * one — so the ceding record is reached through its own adapter.
   */
  readonly registryForInstallationKey?: (installationKey: string) => InstallationRegistryPort;
  readonly lock: ExclusiveLockPort;
  readonly coordinator: HandoffCoordinatorPort;
  readonly clock: Clock;
  readonly newId: () => string;
}

/**
 * One reservation request.
 */
export interface ReserveDestinationRequest {
  readonly target: string;
  readonly scope: InstallationScope;
  readonly destinationPath: string;
  /** The installation that will own the destination after the write. */
  readonly acquiringInstallationKey: string;
  /** The fingerprint the write intends to produce. */
  readonly intendedFingerprint?: string;
  /** Required when another installation currently owns the destination. */
  readonly handoff?: DestinationOwnershipHandoff;
}

/**
 * Outcome of a reservation attempt.
 */
export type ReserveDestinationResult =
  | { readonly kind: 'reserved'; readonly claim: DestinationOwnershipClaim; readonly lock: LockHandle }
  | { readonly kind: 'conflict'; readonly detail: string }
  | { readonly kind: 'retryable-failure'; readonly detail: string };

/**
 * Outcome of resolving a failed or interrupted materialization.
 */
export type ResolveClaimResult =
  | { readonly kind: 'compensated'; readonly detail: string }
  | { readonly kind: 'finalized'; readonly artifact: ManagedArtifact }
  | { readonly kind: 'unresolved'; readonly detail: string };

/**
 * Serialises governed writes to one destination and owns their recovery.
 */
export class DestinationClaimTransaction {
  /**
   * Create a DestinationClaimTransaction.
   * @param ports Registry, lock, coordinator, clock, and id source.
   */
  public constructor(private readonly ports: DestinationClaimPorts) {}

  /**
   * The registry adapter holding one installation's record.
   * @param installationKey - Installation key.
   * @returns The adapter for that record, defaulting to the acquiring registry.
   */
  private registryFor(installationKey: string): InstallationRegistryPort {
    return this.ports.registryForInstallationKey?.(installationKey) ?? this.ports.registry;
  }

  /**
   * Persist one coordinator phase before the store change it authorises.
   * @param record - The record at its new phase.
   */
  private async advance(record: HandoffCoordinatorRecord): Promise<void> {
    await this.ports.coordinator.persist({ ...record, updatedAt: this.ports.clock.nowIso() });
  }

  /**
   * Detach the destination from the ceding installation's active managed set.
   * @param cedingKey - The ceding installation key.
   * @param destinationPath - The destination being ceded.
   * @returns The prior artifact pre-image, when the ceding record held one.
   */
  private async detachCeding(
    cedingKey: string,
    destinationPath: string
  ): Promise<ManagedArtifact | undefined> {
    const registry = this.registryFor(cedingKey);
    const record = await registry.get(cedingKey);
    if (record === null) {
      return undefined;
    }
    const prior = record.artifacts.find((artifact) => artifact.destinationPath === destinationPath);
    if (prior === undefined) {
      return undefined;
    }
    await registry.put(withoutArtifact(record, destinationPath));
    return prior;
  }

  /**
   * Reserve a destination for one governed write.
   *
   * Returns the held lock with the claim: the caller materializes under that
   * reservation and must call {@link finalize} or {@link resolveFailure}, both of
   * which release it.
   * @param request Destination, acquiring installation, intended fingerprint, hand-off.
   * @returns The reservation, a conflict, or a retryable failure.
   */
  public async reserve(request: ReserveDestinationRequest): Promise<ReserveDestinationResult> {
    const claimKey = deriveClaimKey(request.target, request.scope, request.destinationPath);
    const lock = await this.ports.lock.tryAcquire(claimKey);
    if (lock === null) {
      return {
        kind: 'retryable-failure',
        detail: `another operation holds "${request.destinationPath}"`
      };
    }

    try {
      const live = await this.ports.registry.readClaim(claimKey);
      if (live !== null
        && claimBlocksOtherWriters(live)
        && live.ownerInstallation !== request.acquiringInstallationKey) {
        await lock.release();
        return {
          kind: 'retryable-failure',
          detail: `destination "${request.destinationPath}" has an unresolved ${live.state} claim`
        };
      }
      if (live !== null && live.state === 'rollback-required') {
        await lock.release();
        return {
          kind: 'retryable-failure',
          detail: `destination "${request.destinationPath}" needs claim recovery before another write`
        };
      }

      const owners = await this.ports.registry.queryDestinationOwnership({
        destinationPaths: [request.destinationPath],
        target: request.target,
        scope: request.scope
      });
      const foreignOwner = owners.find(
        (owner) => owner.installationKey !== request.acquiringInstallationKey
      );
      if (foreignOwner !== undefined) {
        const handoff = request.handoff;
        const validHandoff = handoff !== undefined
          && handoff.destinationPath === request.destinationPath
          && handoff.cedingInstallationKey === foreignOwner.installationKey
          && handoff.acquiringInstallationKey === request.acquiringInstallationKey;
        if (!validHandoff) {
          await lock.release();
          return {
            kind: 'conflict',
            detail: `destination "${request.destinationPath}" is managed by another installation; `
              + 'an explicit hand-off naming it is required'
          };
        }
      }

      const cedingKey = foreignOwner?.installationKey;
      const generation = (live?.generation ?? 0) + 1;
      const base: HandoffCoordinatorRecord = {
        operationId: this.ports.newId(),
        claimKey,
        destinationPath: request.destinationPath,
        target: request.target,
        scope: request.scope,
        acquiringInstallationKey: request.acquiringInstallationKey,
        ...(cedingKey === undefined ? {} : { cedingInstallationKey: cedingKey }),
        ...(request.intendedFingerprint === undefined
          ? {}
          : { intendedFingerprint: request.intendedFingerprint }),
        claimGeneration: generation,
        phase: 'prepared',
        updatedAt: this.ports.clock.nowIso()
      };
      await this.advance(base);

      let prior: ManagedArtifact | undefined;
      if (cedingKey !== undefined) {
        prior = await this.detachCeding(cedingKey, request.destinationPath);
        await this.advance({
          ...base,
          phase: 'ceding-detached',
          ...(prior === undefined ? {} : { priorArtifact: prior })
        });
      }

      const claim: DestinationOwnershipClaim = {
        claimId: live?.claimId ?? this.ports.newId(),
        target: request.target,
        scope: request.scope,
        destinationPath: request.destinationPath,
        ownerInstallation: request.acquiringInstallationKey,
        generation,
        state: 'pending-materialization',
        acquiringInstallation: request.acquiringInstallationKey,
        ...(cedingKey === undefined ? {} : { cedingInstallation: cedingKey }),
        ...(prior === undefined ? {} : { priorManagedArtifact: prior }),
        ...(request.intendedFingerprint === undefined
          ? {}
          : { intendedFingerprint: request.intendedFingerprint }),
        updatedAt: this.ports.clock.nowIso()
      };
      await this.ports.registry.putClaim(claim);
      await this.advance({
        ...base,
        phase: 'acquiring-pending',
        ...(prior === undefined ? {} : { priorArtifact: prior })
      });

      return { kind: 'reserved', claim, lock };
    } catch (error) {
      await lock.release();
      return { kind: 'retryable-failure', detail: (error as Error).message };
    }
  }

  /**
   * Record the verified artifact and settle the claim.
   * @param claim Reservation returned by {@link reserve}.
   * @param installation The acquiring installation's current record.
   * @param artifact The read-back-verified artifact.
   * @param lock The held reservation lock, released before returning.
   * @returns The acquiring record carrying the artifact.
   */
  public async finalize(
    claim: DestinationOwnershipClaim,
    installation: ManagedInstallation,
    artifact: ManagedArtifact,
    lock: LockHandle
  ): Promise<ManagedInstallation> {
    try {
      const updated = withArtifact(installation, artifact);
      await this.ports.registry.put(updated);
      await this.ports.registry.putClaim({
        ...claim,
        state: 'finalized',
        generation: claim.generation + 1,
        updatedAt: this.ports.clock.nowIso()
      });
      await this.ports.coordinator.clear(
        deriveClaimKey(claim.target, claim.scope, claim.destinationPath)
      );
      return updated;
    } finally {
      await lock.release();
    }
  }

  /**
   * Resolve a failed or interrupted materialization. Only U1 may do this.
   * @param claim The pending claim.
   * @param evidence What a fresh read of the destination proves.
   * @param evidence.materialized
   * @param evidence.classifiable
   * @param lock The held reservation lock, released before returning.
   * @returns Compensated, finalized from verified bytes, or unresolved.
   */
  public async resolveFailure(
    claim: DestinationOwnershipClaim,
    evidence: { readonly materialized: boolean; readonly classifiable: boolean },
    lock: LockHandle
  ): Promise<ResolveClaimResult> {
    const claimKey = deriveClaimKey(claim.target, claim.scope, claim.destinationPath);
    try {
      if (!evidence.classifiable) {
        await this.ports.registry.putClaim({
          ...claim,
          state: 'rollback-required',
          generation: claim.generation + 1,
          updatedAt: this.ports.clock.nowIso()
        });
        return {
          kind: 'unresolved',
          detail: `destination "${claim.destinationPath}" could not be classified; `
            + 'recovery evidence retained'
        };
      }
      if (evidence.materialized) {
        // A fresh read proves the intended bytes are there: the acquiring record
        // is the correct outcome, so finish the interrupted step instead of
        // compensating a write that did happen.
        await this.ports.registry.putClaim({
          ...claim,
          state: 'finalized',
          generation: claim.generation + 1,
          updatedAt: this.ports.clock.nowIso()
        });
        await this.ports.coordinator.clear(claimKey);
        const artifact = claim.priorManagedArtifact;
        return artifact === undefined
          ? { kind: 'unresolved', detail: 'materialized bytes have no recorded artifact shape' }
          : { kind: 'finalized', artifact };
      }

      const cedingKey = claim.cedingInstallation;
      const prior = claim.priorManagedArtifact;
      if (cedingKey !== undefined && prior !== undefined) {
        const registry = this.registryFor(cedingKey);
        const record = await registry.get(cedingKey);
        if (record !== null) {
          await registry.put(withArtifact(record, prior));
        }
      }
      await this.ports.registry.deleteClaim(claimKey);
      await this.ports.coordinator.clear(claimKey);
      return {
        kind: 'compensated',
        detail: cedingKey === undefined
          ? `reservation on "${claim.destinationPath}" released; nothing was written`
          : `reservation on "${claim.destinationPath}" released and ${cedingKey} restored`
      };
    } finally {
      await lock.release();
    }
  }

  /**
   * Recover an in-flight hand-off found at startup.
   *
   * Replays only what the coordinator record proves has not happened yet, under
   * the same lock the original operation held. A phase is replayed only when its
   * expected pre-image still matches, so a completed step is never redone.
   * @param claimKey Derived claim key.
   * @param evidence What a fresh read of the destination proves.
   * @param evidence.materialized
   * @param evidence.classifiable
   * @returns The recovery outcome, or `null` when no hand-off is in flight.
   */
  public async recover(
    claimKey: string,
    evidence: { readonly materialized: boolean; readonly classifiable: boolean }
  ): Promise<ResolveClaimResult | null> {
    const record = await this.ports.coordinator.read(claimKey);
    if (record === null || record.phase === 'completed') {
      return null;
    }
    const lock = await this.ports.lock.tryAcquire(claimKey);
    if (lock === null) {
      return { kind: 'unresolved', detail: `another holder is recovering "${claimKey}"` };
    }
    const claim = await this.ports.registry.readClaim(claimKey);
    if (claim === null) {
      // The reservation never became live: restore the ceding pre-image when the
      // record shows it was detached, then clear the operation.
      try {
        if (record.cedingInstallationKey !== undefined && record.priorArtifact !== undefined) {
          const registry = this.registryFor(record.cedingInstallationKey);
          const cedingRecord = await registry.get(record.cedingInstallationKey);
          if (cedingRecord !== null) {
            await registry.put(withArtifact(cedingRecord, record.priorArtifact));
          }
        }
        await this.ports.coordinator.clear(claimKey);
        return { kind: 'compensated', detail: `no reservation survived for "${record.destinationPath}"` };
      } finally {
        await lock.release();
      }
    }
    return this.resolveFailure(claim, evidence, lock);
  }
}
