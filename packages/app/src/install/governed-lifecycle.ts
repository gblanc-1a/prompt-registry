/**
 * The shared, manifest-driven installation lifecycle (U1).
 *
 * One policy, one write path, both delivery surfaces. `install`, `update`, and
 * `uninstall` are the Contract 3 operations; `applyGovernedArtifacts` is the
 * internal write-verify-record primitive they share with the migration transfer
 * boundary, and is deliberately **not** a callable Contract 3 operation.
 *
 * The order of the install sequence is load-bearing:
 *
 *   1. validate the bundle (nothing is written on a refusal);
 *   2. derive the repository identity — offline — because it is part of the
 *      installation key;
 *   3. resolve every installable item's destination, refusing an escape;
 *   4. read the prior record;
 *   5. **before the first write**, check cross-installation destination ownership
 *      and check still-named artifacts for local changes (BR4.7) — a locally
 *      changed file is never overwritten and then reported;
 *   6. write, read back, fingerprint the same sequence, record;
 *   7. reconcile artifacts the new manifest no longer names;
 *   8. return the outcome.
 *
 * Every expected condition is a value from the shared result vocabulary, so a
 * delivery adapter maps it to its own presentation instead of catching an error.
 * @module install/governed-lifecycle
 */
import {
  createHash,
} from 'node:crypto';
import type {
  ArtifactReference,
  Clock,
  DestinationOwnershipHandoff,
  ExtractedFiles,
  GovernedBundle,
  InstallationRegistryPort,
  InstallationScope,
  LifecycleOutcome,
  ManagedArtifact,
  ManagedInstallation,
  ManagedInstallationIdentity,
  ManifestGovernancePort,
  ManifestItem,
  RepositoryIdentity,
  ResourceTransformer,
  Target,
  TargetArtifactStorePort,
  TargetRoutingPort,
} from '@ai-primitives-hub/core';
import {
  bytesEqual,
  decodeUtf8Strict,
  deriveInstallationKey,
  indexFileRecords,
  installableItems,
  withArtifact,
  withoutArtifact,
} from '@ai-primitives-hub/core';
import type {
  DestinationClaimTransaction,
} from './destination-claim';

/**
 * Ports the governed lifecycle needs. Every one of them is injected: the
 * lifecycle performs no I/O of its own and makes no network call.
 */
export interface GovernedLifecyclePorts {
  readonly governance: ManifestGovernancePort;
  readonly routing: TargetRoutingPort;
  readonly registry: InstallationRegistryPort;
  readonly artifacts: TargetArtifactStorePort;
  readonly claims: DestinationClaimTransaction;
  readonly clock: Clock;
  /** Optional per-target content transformation, applied to text payloads only. */
  readonly transformer?: ResourceTransformer;
}

/**
 * Explicit consent to overwrite content the lifecycle still manages but that no
 * longer matches its fingerprint (BR4.7).
 */
export type OverwriteConsent = 'confirmed';

/**
 * One install or update request.
 */
export interface GovernedInstallRequest {
  /** The bundle source: archive bytes, or already-extracted contents. */
  readonly source:
    | { readonly kind: 'archive'; readonly bytes: Uint8Array }
    | { readonly kind: 'extracted'; readonly files: ExtractedFiles };
  readonly target: Target;
  readonly scope: InstallationScope;
  /** Repository identity for repository scope; derived offline by the caller. */
  readonly repositoryIdentity?: RepositoryIdentity;
  readonly overwriteConsent?: OverwriteConsent;
  /** Hand-offs authorising this install to take destinations another record owns. */
  readonly handoffs?: readonly DestinationOwnershipHandoff[];
  readonly sourceId?: string;
  readonly expectedBundleId?: string;
  readonly expectedVersion?: string;
}

/** A resolved item ready to be written. */
interface ResolvedItem {
  readonly item: ManifestItem;
  readonly destinationRoot: string;
  readonly destinationPath: string;
  readonly bytes: Uint8Array;
}

/**
 * The shared, manifest-driven lifecycle both delivery surfaces call.
 */
export class GovernedLifecycle {
  /**
   * Create a GovernedLifecycle.
   * @param ports Injected governance, routing, registry, artifact store, claims, clock.
   */
  public constructor(private readonly ports: GovernedLifecyclePorts) {}

  /**
   * Validate the bundle and resolve every installable item's destination.
   * @param request - The install request.
   * @returns The governed bundle with resolved items, or a refusing outcome.
   */
  private async prepare(request: GovernedInstallRequest): Promise<
    | { outcome: LifecycleOutcome }
    | { bundle: GovernedBundle; resolved: ResolvedItem[]; identity: ManagedInstallationIdentity }
  > {
    const governed = await this.ports.governance.validate(
      request.source.kind === 'archive'
        ? {
          kind: 'archive',
          bytes: request.source.bytes,
          ...(request.expectedBundleId === undefined
            ? {}
            : { expectedBundleId: request.expectedBundleId }),
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion })
        }
        : {
          kind: 'extracted',
          files: request.source.files,
          ...(request.expectedBundleId === undefined
            ? {}
            : { expectedBundleId: request.expectedBundleId }),
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion })
        }
    );
    if (governed.kind === 'validation-error') {
      return { outcome: governed.outcome };
    }

    const identity: ManagedInstallationIdentity = {
      bundleId: governed.bundle.manifest.bundleId,
      target: request.target.name,
      scope: request.scope,
      ...(request.repositoryIdentity === undefined
        ? {}
        : { repositoryIdentity: request.repositoryIdentity })
    };

    const resolved: ResolvedItem[] = [];
    const records = indexFileRecords(governed.bundle);
    for (const item of installableItems(governed.bundle)) {
      const routing = await this.ports.routing.resolve({
        target: request.target,
        scope: request.scope,
        itemKind: item.kind,
        archivePath: item.archivePath
      });
      if (routing.kind === 'safety-blocked') {
        return { outcome: { kind: 'safety-blocked', detail: routing.detail } };
      }
      if (routing.kind === 'unsupported') {
        // A target that routes no such kind installs nothing for it; the item
        // stays in the archive rather than being forced somewhere.
        continue;
      }
      const bytes = governed.files.get(item.archivePath);
      if (bytes === undefined || records.get(item.archivePath) === undefined) {
        return {
          outcome: {
            kind: 'validation-error',
            detail: `governed item "${item.archivePath}" is missing from the archive`
          }
        };
      }
      resolved.push({
        item,
        destinationRoot: routing.address.destinationRoot,
        destinationPath: routing.address.destinationPath,
        bytes
      });
    }
    return { bundle: governed.bundle, resolved, identity };
  }

  /**
   * Everything that must refuse **before** the first write.
   *
   * Cross-installation ownership first (BR3.6), then BR4.7 for artifacts this
   * record still manages: both write nothing at all when they refuse.
   * @param request - The install request.
   * @param identity - This record's identity.
   * @param resolved - Resolved items.
   * @param prior - The prior record, when one exists.
   * @returns A refusing outcome, or `null` when the write may proceed.
   */
  private async refuseBeforeWriting(
    request: GovernedInstallRequest,
    identity: ManagedInstallationIdentity,
    resolved: readonly ResolvedItem[],
    prior: ManagedInstallation | null
  ): Promise<LifecycleOutcome | null> {
    const key = deriveInstallationKey(identity);
    const owners = await this.ports.registry.queryDestinationOwnership({
      destinationPaths: resolved.map((entry) => entry.destinationPath),
      target: identity.target,
      scope: identity.scope
    });
    const foreign = owners.filter((owner) => owner.installationKey !== key);
    const unauthorised = foreign.filter((owner) => !(request.handoffs ?? []).some(
      (handoff) => handoff.destinationPath === owner.destinationPath
        && handoff.cedingInstallationKey === owner.installationKey
        && handoff.acquiringInstallationKey === key
    ));
    if (unauthorised.length > 0) {
      return {
        kind: 'conflict',
        detail: `${identity.bundleId}: ${unauthorised
          .map((owner) => owner.destinationPath)
          .join(', ')} ${unauthorised.length === 1 ? 'is' : 'are'} managed by another installation`
      };
    }

    if (prior === null || request.overwriteConsent === 'confirmed') {
      return null;
    }
    const changed: string[] = [];
    for (const entry of resolved) {
      const managed = prior.artifacts
        .find((artifact) => artifact.destinationPath === entry.destinationPath);
      if (managed === undefined) {
        continue;
      }
      const current = await this.ports.artifacts.read(entry.destinationRoot, entry.destinationPath);
      if (current.kind === 'safety-blocked') {
        return { kind: 'safety-blocked', detail: current.detail };
      }
      if (current.kind === 'retryable-failure') {
        return { kind: 'retryable-failure', detail: current.detail };
      }
      if (current.value === null) {
        continue;
      }
      if (fingerprint(current.value) !== managed.installedFingerprint) {
        changed.push(entry.destinationPath);
      }
    }
    if (changed.length > 0) {
      return {
        kind: 'conflict',
        detail: `${identity.bundleId}: ${changed.join(', ')} changed locally; `
          + 'explicit overwrite consent is required'
      };
    }
    return null;
  }

  /**
   * The exact byte sequence to write, and therefore to fingerprint.
   *
   * A binary payload is written verbatim; a text payload goes through the
   * transformer first, and the UTF-8 encoding of the transformed content is what
   * gets written *and* fingerprinted — which is what stops a transformed file
   * looking permanently user-edited (BR3.3).
   * @param target - The install target, for the transformer context.
   * @param entry - The resolved item.
   * @returns The intended byte sequence.
   */
  private intendedBytes(target: Target, entry: ResolvedItem): Uint8Array {
    const text = decodeUtf8Strict(entry.bytes);
    if (text === null || this.ports.transformer === undefined) {
      return entry.bytes;
    }
    const transformed = this.ports.transformer.transform({
      target,
      filePath: entry.item.archivePath,
      content: text
    });
    return new TextEncoder().encode(transformed.content);
  }

  /**
   * Handle artifacts the new manifest no longer names (BR4.2, BR4.3, BR4.6).
   * @param installation - The record after writing.
   * @param resolved - Resolved items of the new manifest.
   * @param prior - The prior record, when one exists.
   * @returns The reconciled record, what was preserved and removed, or a refusal.
   */
  private async reconcileOmitted(
    installation: ManagedInstallation,
    resolved: readonly ResolvedItem[],
    prior: ManagedInstallation | null
  ): Promise<{
    installation: ManagedInstallation;
    preserved: ArtifactReference[];
    removed: ArtifactReference[];
    outcome: LifecycleOutcome | null;
  }> {
    const preserved: ArtifactReference[] = [];
    const removed: ArtifactReference[] = [];
    if (prior === null) {
      return { installation, preserved, removed, outcome: null };
    }
    const stillNamed = new Set(resolved.map((entry) => entry.destinationPath));
    let record = installation;

    for (const artifact of prior.artifacts) {
      if (stillNamed.has(artifact.destinationPath)) {
        continue;
      }
      const root = destinationRootOf(artifact.destinationPath);
      const current = await this.ports.artifacts.read(root, artifact.destinationPath);
      if (current.kind === 'safety-blocked') {
        return {
          installation: record,
          preserved,
          removed,
          outcome: { kind: 'safety-blocked', detail: current.detail }
        };
      }
      if (current.kind === 'retryable-failure') {
        return {
          installation: record,
          preserved,
          removed,
          outcome: { kind: 'retryable-failure', detail: current.detail }
        };
      }
      if (current.value === null) {
        record = withoutArtifact(record, artifact.destinationPath);
        continue;
      }
      if (fingerprint(current.value) === artifact.installedFingerprint) {
        const removal = await this.ports.artifacts
          .removeAndVerifyAbsent(root, artifact.destinationPath);
        if (removal.kind !== 'ok') {
          return {
            installation: record,
            preserved,
            removed,
            outcome: { kind: removal.kind, detail: removal.detail }
          };
        }
        removed.push({ destinationPath: artifact.destinationPath });
        record = withoutArtifact(record, artifact.destinationPath);
        continue;
      }
      // Locally changed and no longer named: keep the file, stop managing it, so
      // a later uninstall leaves it alone.
      preserved.push({ destinationPath: artifact.destinationPath });
      record = withoutArtifact(record, artifact.destinationPath);
    }
    return { installation: record, preserved, removed, outcome: null };
  }

  /**
   * The internal write-verify-record primitive install, update, and the migration
   * transfer boundary share.
   *
   * For each governed item: reserve the destination, write the intended sequence,
   * read it back and compare, fingerprint that same sequence, and admit the
   * artifact only after its write verified (BR3.3, BR3.5, BR4.1).
   * @param request - The install request.
   * @param identity - This record's identity.
   * @param resolved - Resolved items.
   * @param prior - The prior record, when one exists.
   * @param bundle - The governed bundle, for its manifest version.
   * @returns The outcome, the updated record, and what was written.
   */
  private async applyGovernedArtifacts(
    request: GovernedInstallRequest,
    identity: ManagedInstallationIdentity,
    resolved: readonly ResolvedItem[],
    prior: ManagedInstallation | null,
    bundle: GovernedBundle
  ): Promise<{
    outcome: LifecycleOutcome;
    installation: ManagedInstallation;
    written: ArtifactReference[];
  }> {
    const key = deriveInstallationKey(identity);
    let installation: ManagedInstallation = prior ?? {
      ...identity,
      installationKey: key,
      manifestVersion: bundle.manifest.version,
      installedAt: this.ports.clock.nowIso(),
      ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
      artifacts: []
    };
    installation = { ...installation, manifestVersion: bundle.manifest.version };
    const written: ArtifactReference[] = [];

    for (const entry of resolved) {
      const intended = this.intendedBytes(request.target, entry);
      const handoff = (request.handoffs ?? [])
        .find((candidate) => candidate.destinationPath === entry.destinationPath);
      const reservation = await this.ports.claims.reserve({
        target: identity.target,
        scope: identity.scope,
        destinationPath: entry.destinationPath,
        acquiringInstallationKey: key,
        intendedFingerprint: fingerprint(intended),
        ...(handoff === undefined ? {} : { handoff })
      });
      if (reservation.kind === 'conflict') {
        return {
          outcome: { kind: 'conflict', detail: reservation.detail },
          installation,
          written
        };
      }
      if (reservation.kind === 'retryable-failure') {
        return {
          outcome: { kind: 'retryable-failure', detail: reservation.detail },
          installation,
          written
        };
      }

      const result = await this.ports.artifacts.writeAndReadBack({
        destinationRoot: entry.destinationRoot,
        destinationPath: entry.destinationPath,
        bytes: intended
      });
      if (result.kind !== 'ok') {
        await this.ports.claims.resolveFailure(
          reservation.claim,
          { materialized: false, classifiable: result.kind === 'safety-blocked' },
          reservation.lock
        );
        return {
          outcome: { kind: result.kind, detail: result.detail },
          installation,
          written
        };
      }
      if (!bytesEqual(result.value, intended)) {
        await this.ports.claims.resolveFailure(
          reservation.claim,
          { materialized: false, classifiable: true },
          reservation.lock
        );
        return {
          outcome: {
            kind: 'retryable-failure',
            detail: `read-back of "${entry.destinationPath}" did not match the intended bytes`
          },
          installation,
          written
        };
      }

      const artifact: ManagedArtifact = {
        destinationPath: entry.destinationPath,
        itemKind: entry.item.kind,
        installedFingerprint: fingerprint(intended),
        sizeInBytes: intended.byteLength
      };
      installation = await this.ports.claims.finalize(
        reservation.claim,
        installation,
        artifact,
        reservation.lock
      );
      installation = withArtifact(installation, artifact);
      written.push({ destinationPath: artifact.destinationPath });
    }

    return { outcome: { kind: 'success' }, installation, written };
  }

  /**
   * Install a bundle at one target and scope.
   * @param request Bundle source, target, scope, identity, consent, hand-offs.
   * @returns The lifecycle outcome; nothing is written on a refusal.
   */
  public async install(request: GovernedInstallRequest): Promise<LifecycleOutcome> {
    const prepared = await this.prepare(request);
    if ('outcome' in prepared) {
      return prepared.outcome;
    }
    const { bundle, resolved, identity } = prepared;

    const prior = await this.ports.registry.get(deriveInstallationKey(identity));
    const guard = await this.refuseBeforeWriting(request, identity, resolved, prior);
    if (guard !== null) {
      return guard;
    }

    const applied = await this.applyGovernedArtifacts(request, identity, resolved, prior, bundle);
    if (applied.outcome.kind !== 'success') {
      return applied.outcome;
    }

    const reconciled = await this.reconcileOmitted(applied.installation, resolved, prior);
    if (reconciled.outcome !== null) {
      return reconciled.outcome;
    }
    await this.ports.registry.put(reconciled.installation);

    return {
      kind: 'success',
      writtenArtifacts: applied.written,
      ...(reconciled.preserved.length === 0 ? {} : { preservedArtifacts: reconciled.preserved }),
      ...(reconciled.removed.length === 0 ? {} : { removedArtifacts: reconciled.removed })
    };
  }

}

/**
 * SHA-256 over an exact byte sequence, lower-case hex, `sha256:` prefixed.
 * @param bytes - The exact sequence written to, or read from, the target.
 * @returns The fingerprint.
 */
export function fingerprint(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * The destination root of a recorded artifact path.
 *
 * A recorded artifact carries its absolute path but not its root, and removal
 * still has to be containment-checked. The immediate parent directory is the
 * narrowest root that permits the operation without widening it to an ancestor
 * the record never named.
 * @param destinationPath - Absolute artifact path.
 * @returns The root used for the containment check.
 */
function destinationRootOf(destinationPath: string): string {
  const normalised = destinationPath.replaceAll('\\', '/');
  const index = normalised.lastIndexOf('/');
  return index <= 0 ? normalised : normalised.slice(0, index);
}
