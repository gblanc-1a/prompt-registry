/**
 * InstallationRegistryPort — reads and writes managed installations, their
 * artifacts, and the destination-ownership claims that serialise writes.
 *
 * One schema, two adapters (BR3.4): the user-scope adapter persists through
 * shared application data, the repository-scope adapter through the repository's
 * own lockfile. Neither reaches into the other's storage. A caller selects an
 * adapter by scope and never learns where the bytes live.
 *
 * Destination claims, however, are **registry-wide within a target and scope**:
 * `queryDestinationOwnership` answers "does another installation already own
 * this destination", which is what stops one bundle silently overwriting
 * another's content (R-02, BR3.6).
 *
 * Concrete adapters live in `infra`.
 * @module ports/installation-registry
 */
import type {
  DestinationOwnershipClaim,
  ManagedInstallation,
  ManagedInstallationIdentity,
} from '../domain/install/managed-installation';
import type {
  InstallationScope,
} from '../domain/install/types';

/**
 * Which installation currently owns one destination.
 */
export interface DestinationOwnership {
  readonly destinationPath: string;
  /** The installation key that manages this destination. */
  readonly installationKey: string;
  /** The live claim, when one exists. */
  readonly claim?: DestinationOwnershipClaim;
}

/**
 * A destination-ownership question, scoped to one target and scope.
 */
export interface DestinationOwnershipQuery {
  readonly destinationPaths: readonly string[];
  readonly target: string;
  readonly scope: InstallationScope;
}

/**
 * An atomic re-key: persist the record under a new identity and remove the old
 * key in the same operation, so no duplicate remains (BR6.5).
 */
export interface InstallationRekeyRequest {
  readonly previousKey: string;
  readonly installation: ManagedInstallation;
}

/**
 * Reads and writes the shared installation registry.
 */
export interface InstallationRegistryPort {
  /**
   * Read one record.
   * @param key Derived installation key.
   * @returns The record, or `null` when none exists.
   */
  get(key: string): Promise<ManagedInstallation | null>;

  /**
   * Read every record this adapter holds.
   *
   * Needed for the registry-wide destination-ownership question; an adapter
   * answers only for its own storage location.
   * @returns Every record, in no guaranteed order.
   */
  list(): Promise<readonly ManagedInstallation[]>;

  /**
   * Persist one record, replacing any record under the same key.
   * @param installation The record to persist.
   */
  put(installation: ManagedInstallation): Promise<void>;

  /**
   * Delete one record.
   * @param key Derived installation key.
   */
  delete(key: string): Promise<void>;

  /**
   * Which installations own the given destinations at this target and scope.
   * @param query Destinations, target, and scope.
   * @returns One entry per owned destination; unowned destinations are omitted.
   */
  queryDestinationOwnership(query: DestinationOwnershipQuery): Promise<readonly DestinationOwnership[]>;

  /**
   * Move a record onto a new identity's key, removing the old key atomically.
   * @param request Previous key and the record under its new identity.
   */
  rekey(request: InstallationRekeyRequest): Promise<void>;

  /**
   * Read the live claim for one destination.
   * @param claimKey Derived claim key.
   * @returns The claim, or `null` when the destination is unclaimed.
   */
  readClaim(claimKey: string): Promise<DestinationOwnershipClaim | null>;

  /**
   * Persist a claim, replacing any claim under the same key.
   * @param claim The claim to persist.
   */
  putClaim(claim: DestinationOwnershipClaim): Promise<void>;

  /**
   * Release a claim.
   * @param claimKey Derived claim key.
   */
  deleteClaim(claimKey: string): Promise<void>;
}

/**
 * Selects the registry adapter for a scope (BR3.4).
 *
 * The composition root supplies this so a use case never decides where bytes
 * live, and a repository-scope call cannot reach user-scope storage.
 */
export type InstallationRegistrySelector = (
  identity: Pick<ManagedInstallationIdentity, 'scope'>
) => InstallationRegistryPort;
