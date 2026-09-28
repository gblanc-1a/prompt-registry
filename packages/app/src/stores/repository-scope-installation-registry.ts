/**
 * RepositoryScopeInstallationRegistry — the repository-scope
 * `InstallationRegistryPort` adapter (BR3.4).
 *
 * Repository-scope records stay in the repository's own lockfile, which is the
 * repository-scope *serialisation* of the same shared record: the file's path
 * already implies the scope and the repository identity, so neither is repeated
 * inside an entry. The **target** is not implied — one repository can install the
 * same bundle for several targets — so it is stored explicitly (BR3.1, R-03).
 *
 * A `2.0.0` entry carries no installed fingerprint. Its artifacts are reported as
 * **unverifiable** (fingerprint `''`) rather than being handed the archive-side
 * `checksum`, which would silently claim that an untransformed archive hash
 * describes the bytes on disk (BR3.3).
 *
 * Claims, journal entries, coordinator records, and locks are NOT stored here:
 * they live in shared application data for both scopes (NFR1.1.4), so this
 * adapter delegates every claim operation to an injected claim store.
 *
 * It lives beside `json-lockfile-store.ts` because that store — the repository
 * serialisation this adapter composes — lives in `app` today. Moving both into
 * `infra` is a follow-up that touches every current lockfile consumer.
 * @module stores/repository-scope-installation-registry
 */
import type {
  DestinationOwnership,
  DestinationOwnershipClaim,
  DestinationOwnershipQuery,
  InstallationRegistryPort,
  InstallationRekeyRequest,
  ManagedArtifact,
  ManagedInstallation,
  PrimitiveKind,
  RepositoryIdentity,
} from '@ai-primitives-hub/core';
import {
  deriveClaimKey,
  deriveInstallationKey,
  isPrimitiveKind,
} from '@ai-primitives-hub/core';
import type {
  Lockfile,
  LockfileBundleEntry,
  LockfileFs,
  RepositoryCommitMode,
} from './json-lockfile-store';
import {
  emptyLockfile,
  getLockfilePathForMode,
  isUnverifiableFileEntry,
  lockfileSchemaIsReadable,
  readLockfile,
  removeBundleEntry,
  upsertBundleEntry,
  writeLockfile,
} from './json-lockfile-store';

/** The claim operations this adapter delegates to shared application data. */
export type ClaimStore = Pick<
  InstallationRegistryPort,
  'readClaim' | 'putClaim' | 'deleteClaim'
>;

/**
 * Options accepted by {@link RepositoryScopeInstallationRegistry}.
 */
export interface RepositoryScopeInstallationRegistryOptions {
  readonly fs: LockfileFs;
  /** Repository root; both lockfile variants live here. */
  readonly repositoryPath: string;
  /** Identity every record in this repository belongs to. */
  readonly repositoryIdentity: RepositoryIdentity;
  /** Which physical lockfile to write; reads consider both. */
  readonly commitMode: RepositoryCommitMode;
  /** Shared claim namespace (application data, both scopes). */
  readonly claims: ClaimStore;
  /** Tool identifier recorded in a newly created lockfile. */
  readonly generatedBy?: string;
}

const COMMIT_MODES: readonly RepositoryCommitMode[] = ['commit', 'local-only'];

/**
 * Repository-scope managed installations, backed by the repository lockfile.
 */
export class RepositoryScopeInstallationRegistry implements InstallationRegistryPort {
  /**
   * Create a RepositoryScopeInstallationRegistry.
   * @param opts Lockfile adapter, repository identity, commit mode, claim store.
   */
  public constructor(private readonly opts: RepositoryScopeInstallationRegistryOptions) {}

  /**
   * Every readable lockfile in the repository, with its commit mode.
   * @returns One entry per physical lockfile that exists and is readable.
   */
  private async readAll(): Promise<{ mode: RepositoryCommitMode; lock: Lockfile }[]> {
    const locks: { mode: RepositoryCommitMode; lock: Lockfile }[] = [];
    for (const mode of COMMIT_MODES) {
      const lock = await readLockfile(getLockfilePathForMode(this.opts.repositoryPath, mode), this.opts.fs);
      if (lock !== null && lockfileSchemaIsReadable(lock)) {
        locks.push({ mode, lock });
      }
    }
    return locks;
  }

  /**
   * Project one lockfile entry onto the shared record.
   * @param bundleId - Bundle identifier, the entry's key.
   * @param entry - The lockfile entry.
   * @returns The shared record, or `null` when the entry names no target.
   */
  private toManagedInstallation(
    bundleId: string,
    entry: LockfileBundleEntry
  ): ManagedInstallation | null {
    if (entry.target === undefined || entry.target.length === 0) {
      // A 2.0.0 entry names no target. Never guess one: an ambiguous entry is
      // reported by the importer, not resolved by convention.
      return null;
    }
    const identity = {
      bundleId,
      target: entry.target,
      scope: 'repository' as const,
      repositoryIdentity: this.opts.repositoryIdentity
    };
    return {
      ...identity,
      installationKey: deriveInstallationKey(identity),
      manifestVersion: entry.version,
      installedAt: entry.installedAt,
      ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
      artifacts: entry.files.map((file) => toManagedArtifact(file))
    };
  }

  public async get(key: string): Promise<ManagedInstallation | null> {
    for (const record of await this.list()) {
      if (record.installationKey === key) {
        return record;
      }
    }
    return null;
  }

  public async list(): Promise<readonly ManagedInstallation[]> {
    const records: ManagedInstallation[] = [];
    for (const { lock } of await this.readAll()) {
      for (const [bundleId, entry] of Object.entries(lock.bundles)) {
        const record = this.toManagedInstallation(bundleId, entry);
        if (record !== null) {
          records.push(record);
        }
      }
    }
    return records;
  }

  public async put(installation: ManagedInstallation): Promise<void> {
    const file = getLockfilePathForMode(this.opts.repositoryPath, this.opts.commitMode);
    const existing = await readLockfile(file, this.opts.fs);
    const lock = existing ?? emptyLockfile(this.opts.generatedBy ?? 'ai-primitives-hub');
    const previous = lock.bundles[installation.bundleId];
    const entry: LockfileBundleEntry = {
      version: installation.manifestVersion,
      sourceId: installation.sourceId ?? previous?.sourceId ?? '',
      sourceType: previous?.sourceType ?? '',
      installedAt: installation.installedAt,
      target: installation.target,
      ...(previous?.commitMode === undefined ? {} : { commitMode: previous.commitMode }),
      ...(previous?.checksum === undefined ? {} : { checksum: previous.checksum }),
      files: installation.artifacts.map((artifact) => ({
        path: artifact.destinationPath,
        checksum: artifact.installedFingerprint,
        destinationPath: artifact.destinationPath,
        installedFingerprint: artifact.installedFingerprint,
        sizeInBytes: artifact.sizeInBytes,
        itemKind: artifact.itemKind
      }))
    };
    await writeLockfile(file, upsertBundleEntry(lock, installation.bundleId, entry), this.opts.fs);
  }

  public async delete(key: string): Promise<void> {
    for (const { mode, lock } of await this.readAll()) {
      for (const [bundleId, entry] of Object.entries(lock.bundles)) {
        const record = this.toManagedInstallation(bundleId, entry);
        if (record?.installationKey !== key) {
          continue;
        }
        await writeLockfile(
          getLockfilePathForMode(this.opts.repositoryPath, mode),
          removeBundleEntry(lock, bundleId),
          this.opts.fs
        );
        return;
      }
    }
  }

  public async queryDestinationOwnership(
    query: DestinationOwnershipQuery
  ): Promise<readonly DestinationOwnership[]> {
    const wanted = new Set(query.destinationPaths);
    const owners: DestinationOwnership[] = [];
    for (const record of await this.list()) {
      if (record.target !== query.target || record.scope !== query.scope) {
        continue;
      }
      for (const artifact of record.artifacts) {
        if (!wanted.has(artifact.destinationPath)) {
          continue;
        }
        const claim = await this.readClaim(
          deriveClaimKey(query.target, query.scope, artifact.destinationPath)
        );
        owners.push({
          destinationPath: artifact.destinationPath,
          installationKey: record.installationKey,
          ...(claim === null ? {} : { claim })
        });
      }
    }
    for (const destinationPath of wanted) {
      if (owners.some((owner) => owner.destinationPath === destinationPath)) {
        continue;
      }
      const claim = await this.readClaim(deriveClaimKey(query.target, query.scope, destinationPath));
      if (claim !== null) {
        owners.push({ destinationPath, installationKey: claim.ownerInstallation, claim });
      }
    }
    return owners;
  }

  public async rekey(request: InstallationRekeyRequest): Promise<void> {
    // A repository-scope record's key derives from the repository identity, which
    // this adapter holds for the whole file: re-keying it means the record now
    // belongs to a different repository and therefore to a different lockfile.
    // Removing the old entry and writing the new one is the same operation here.
    await this.delete(request.previousKey);
    await this.put(request.installation);
  }

  public async readClaim(claimKey: string): Promise<DestinationOwnershipClaim | null> {
    return this.opts.claims.readClaim(claimKey);
  }

  public async putClaim(claim: DestinationOwnershipClaim): Promise<void> {
    await this.opts.claims.putClaim(claim);
  }

  public async deleteClaim(claimKey: string): Promise<void> {
    await this.opts.claims.deleteClaim(claimKey);
  }
}

/**
 * Project one lockfile file entry onto a managed artifact.
 *
 * A `2.0.0` entry yields an empty fingerprint, which every comparison treats as
 * unverifiable: it can never accidentally match current bytes.
 * @param file - Lockfile file entry.
 * @param file.path
 * @param file.checksum
 * @param file.destinationPath
 * @param file.installedFingerprint
 * @param file.sizeInBytes
 * @param file.itemKind
 * @returns The managed artifact.
 */
function toManagedArtifact(file: {
  path: string;
  checksum: string;
  destinationPath?: string;
  installedFingerprint?: string;
  sizeInBytes?: number;
  itemKind?: string;
}): ManagedArtifact {
  const kind: PrimitiveKind = isPrimitiveKind(file.itemKind) ? file.itemKind : 'prompt';
  return {
    destinationPath: file.destinationPath ?? file.path,
    itemKind: kind,
    installedFingerprint: isUnverifiableFileEntry(file) ? '' : file.installedFingerprint ?? '',
    sizeInBytes: file.sizeInBytes ?? 0
  };
}
