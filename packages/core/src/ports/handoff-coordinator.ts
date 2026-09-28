/**
 * HandoffCoordinatorPort — the durable ordering record for a destination
 * hand-off that spans two persistence stores (NFR1.1.3).
 *
 * A hand-off can change a repository lockfile *and* a shared-application-data
 * claim. Per-file atomic replacement is necessary but does not make those two
 * files one transaction. The coordinator record is what makes the sequence
 * recoverable* instead: it is persisted under the installation-key lock before
 * each store is touched, so a restart can tell which phase completed and either
 * replay the next idempotent step or compensate the ceding pre-image.
 *
 * It is explicitly **not** durable outcome state: it describes one operation in
 * flight and is cleared when that operation completes.
 *
 * Concrete adapters live in `infra` (shared application data, both scopes).
 * @module ports/handoff-coordinator
 */
import type {
  ManagedArtifact,
} from '../domain/install/managed-installation';
import type {
  InstallationScope,
} from '../domain/install/types';

/**
 * How far a cross-store hand-off has progressed.
 *
 * `prepared` — the intent is durable, nothing has been changed yet.
 * `ceding-detached` — the ceding record no longer claims the destination.
 * `acquiring-pending` — the acquiring claim is live; target bytes may be written.
 * `completed` — the acquiring artifact is recorded and the claim finalised.
 */
export type HandoffPhase =
  | 'prepared'
  | 'ceding-detached'
  | 'acquiring-pending'
  | 'completed';

/**
 * One in-flight hand-off.
 */
export interface HandoffCoordinatorRecord {
  readonly operationId: string;
  readonly claimKey: string;
  readonly destinationPath: string;
  readonly target: string;
  readonly scope: InstallationScope;
  readonly acquiringInstallationKey: string;
  /** Absent when the destination was unowned: there is nothing to compensate. */
  readonly cedingInstallationKey?: string;
  /** Recovery pre-image: what the ceding installation had at this destination. */
  readonly priorArtifact?: ManagedArtifact;
  /** The fingerprint the acquiring write intends to produce. */
  readonly intendedFingerprint?: string;
  readonly claimGeneration: number;
  readonly phase: HandoffPhase;
  readonly updatedAt: string;
}

/**
 * Persists the cross-store hand-off ordering record.
 */
export interface HandoffCoordinatorPort {
  /**
   * Read the in-flight record for one destination claim.
   * @param claimKey Derived claim key.
   * @returns The record, or `null` when no hand-off is in flight.
   */
  read(claimKey: string): Promise<HandoffCoordinatorRecord | null>;

  /**
   * Persist a record durably, before the store change it authorises.
   * @param record The record at its new phase.
   */
  persist(record: HandoffCoordinatorRecord): Promise<void>;

  /**
   * Clear the record once its operation has completed or compensated.
   * @param claimKey Derived claim key.
   */
  clear(claimKey: string): Promise<void>;
}
