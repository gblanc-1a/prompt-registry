/**
 * UserScopeInstallationRegistry — the user-scope `InstallationRegistryPort`
 * adapter (BR3.4).
 *
 * User-scope records live in shared application data, resolved through the
 * injected `AppStorage` port (ADR-0005) — never through a VS Code extension
 * storage path, and never inside a repository. Destination claims live beside
 * them in the same application-data tree for **both** scopes, because a claim
 * coordinates writers across stores and a repository lockfile holds installation
 * records only (NFR1.1.4).
 *
 * Every write goes through the one durable replacement primitive, so a record is
 * never observed half-written (NFR1.1.2).
 * @module registry/user-scope-installation-registry
 */
import {
  createHash,
} from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import {
  join,
} from 'node:path';
import type {
  AppStorage,
  DestinationOwnership,
  DestinationOwnershipClaim,
  DestinationOwnershipQuery,
  InstallationRegistryPort,
  InstallationRekeyRequest,
  ManagedInstallation,
} from '@ai-primitives-hub/core';
import {
  deriveClaimKey,
} from '@ai-primitives-hub/core';
import {
  replaceJsonDurably,
} from '../storage/durable-file';

/**
 * Resolve the lifecycle sub-roots from an `AppStorage` root.
 *
 * Derived here rather than added to `AppStoragePaths`, so no existing
 * `AppStorage` implementor has to change to support the shared lifecycle.
 * @param storage - The injected application storage.
 * @returns Absolute roots for records, claims, journal entries, and locks.
 */
export function lifecycleRoots(storage: AppStorage): {
  readonly installations: string;
  readonly claims: string;
  readonly journal: string;
  readonly locks: string;
  readonly coordinator: string;
} {
  const root = join(storage.getPaths().root, 'lifecycle');
  return {
    installations: join(root, 'installations'),
    claims: join(root, 'claims'),
    journal: join(root, 'journal'),
    locks: join(root, 'locks'),
    coordinator: join(root, 'coordinator')
  };
}

/**
 * Options accepted by {@link UserScopeInstallationRegistry}.
 */
export interface UserScopeInstallationRegistryOptions {
  readonly storage: AppStorage;
}

/**
 * User-scope managed installations and the shared claim namespace.
 */
export class UserScopeInstallationRegistry implements InstallationRegistryPort {
  private readonly roots: ReturnType<typeof lifecycleRoots>;

  /**
   * Create a UserScopeInstallationRegistry.
   * @param opts Injected application storage.
   */
  public constructor(opts: UserScopeInstallationRegistryOptions) {
    this.roots = lifecycleRoots(opts.storage);
  }

  /**
   * Read a JSON document, treating an unreadable file as absent.
   * @param path - Absolute file path.
   * @returns The parsed value, or `null`.
   */
  private static async readJsonOrNull<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * Absolute path of one record file.
   * @param key - Installation key.
   * @returns The record path.
   */
  private recordPath(key: string): string {
    return join(this.roots.installations, `${digestName(key)}.json`);
  }

  /**
   * Absolute path of one claim file.
   * @param claimKey - Claim key.
   * @returns The claim path.
   */
  private claimPath(claimKey: string): string {
    return join(this.roots.claims, `${digestName(claimKey)}.json`);
  }

  public async get(key: string): Promise<ManagedInstallation | null> {
    return UserScopeInstallationRegistry.readJsonOrNull<ManagedInstallation>(this.recordPath(key));
  }

  public async list(): Promise<readonly ManagedInstallation[]> {
    let names: string[];
    try {
      names = await readdir(this.roots.installations);
    } catch {
      return [];
    }
    const records: ManagedInstallation[] = [];
    for (const name of names.filter((candidate) => candidate.endsWith('.json'))) {
      const record = await UserScopeInstallationRegistry.readJsonOrNull<ManagedInstallation>(
        join(this.roots.installations, name)
      );
      if (record !== null) {
        records.push(record);
      }
    }
    return records;
  }

  public async put(installation: ManagedInstallation): Promise<void> {
    await mkdir(this.roots.installations, { recursive: true });
    await replaceJsonDurably(this.recordPath(installation.installationKey), installation);
  }

  public async delete(key: string): Promise<void> {
    await rm(this.recordPath(key), { force: true });
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
    await this.put(request.installation);
    if (request.previousKey !== request.installation.installationKey) {
      await this.delete(request.previousKey);
    }
  }

  public async readClaim(claimKey: string): Promise<DestinationOwnershipClaim | null> {
    return UserScopeInstallationRegistry.readJsonOrNull<DestinationOwnershipClaim>(
      this.claimPath(claimKey)
    );
  }

  public async putClaim(claim: DestinationOwnershipClaim): Promise<void> {
    await mkdir(this.roots.claims, { recursive: true });
    await replaceJsonDurably(
      this.claimPath(deriveClaimKey(claim.target, claim.scope, claim.destinationPath)),
      claim
    );
  }

  public async deleteClaim(claimKey: string): Promise<void> {
    await rm(this.claimPath(claimKey), { force: true });
  }
}

/**
 * A filesystem-safe file name for a registry key.
 *
 * An installation or claim key contains path separators and other characters a
 * file name cannot carry, so the name is a digest; the key itself is stored
 * inside the document.
 * @param key - Registry key.
 * @returns Hex digest usable as a file name.
 */
export function digestName(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
