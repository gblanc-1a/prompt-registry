/**
 * Tests for install/destination-claim.ts — the reservation, hand-off, and
 * recovery sequence (BR3.6, NFR1.1.3, NFR2.1).
 *
 * The invariants under test: exactly one writer, no live record naming two
 * owners after a hand-off commits, a compensated rollback restoring the ceding
 * pre-image, an interrupted-but-materialized write finishing rather than being
 * undone, and an unclassifiable destination staying blocked with its evidence.
 */
import type {
  Clock,
  DestinationOwnershipClaim,
  ExclusiveLockPort,
  HandoffCoordinatorPort,
  HandoffCoordinatorRecord,
  InstallationRegistryPort,
  LockHandle,
  ManagedArtifact,
  ManagedInstallation,
} from '@ai-primitives-hub/core';
import {
  deriveClaimKey,
  deriveInstallationKey,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DestinationClaimTransaction,
} from '../../src/install/destination-claim';

const DESTINATION = '/home/u/.copilot/prompts/a.md';
const CLAIM_KEY = deriveClaimKey('copilot', 'user', DESTINATION);

const acquiringIdentity = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;
const cedingIdentity = { bundleId: 'legacy', target: 'copilot', scope: 'user' } as const;
const ACQUIRING_KEY = deriveInstallationKey(acquiringIdentity);
const CEDING_KEY = deriveInstallationKey(cedingIdentity);

const artifact = (fingerprint: string): ManagedArtifact => ({
  destinationPath: DESTINATION,
  itemKind: 'prompt',
  installedFingerprint: fingerprint,
  sizeInBytes: 4
});

const installation = (
  key: string,
  identity: typeof acquiringIdentity | typeof cedingIdentity,
  artifacts: ManagedArtifact[]
): ManagedInstallation => ({
  ...identity,
  installationKey: key,
  manifestVersion: '1.0.0',
  installedAt: '2026-09-28T00:00:00.000Z',
  artifacts
});

class FakeRegistry implements InstallationRegistryPort {
  public readonly records = new Map<string, ManagedInstallation>();
  public readonly claims = new Map<string, DestinationOwnershipClaim>();

  public async get(key: string): Promise<ManagedInstallation | null> {
    return this.records.get(key) ?? null;
  }

  public async list(): Promise<readonly ManagedInstallation[]> {
    return [...this.records.values()];
  }

  public async put(installationRecord: ManagedInstallation): Promise<void> {
    this.records.set(installationRecord.installationKey, installationRecord);
  }

  public async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  public async queryDestinationOwnership(query: {
    destinationPaths: readonly string[];
    target: string;
    scope: string;
  }): Promise<readonly { destinationPath: string; installationKey: string }[]> {
    const wanted = new Set(query.destinationPaths);
    const owners: { destinationPath: string; installationKey: string }[] = [];
    for (const candidate of this.records.values()) {
      if (candidate.target !== query.target || candidate.scope !== query.scope) {
        continue;
      }
      for (const owned of candidate.artifacts) {
        if (wanted.has(owned.destinationPath)) {
          owners.push({
            destinationPath: owned.destinationPath,
            installationKey: candidate.installationKey
          });
        }
      }
    }
    return owners;
  }

  public async rekey(): Promise<void> {
    throw new Error('not used in these tests');
  }

  public async readClaim(claimKey: string): Promise<DestinationOwnershipClaim | null> {
    return this.claims.get(claimKey) ?? null;
  }

  public async putClaim(claim: DestinationOwnershipClaim): Promise<void> {
    this.claims.set(deriveClaimKey(claim.target, claim.scope, claim.destinationPath), claim);
  }

  public async deleteClaim(claimKey: string): Promise<void> {
    this.claims.delete(claimKey);
  }
}

class FakeCoordinator implements HandoffCoordinatorPort {
  public readonly phases: string[] = [];
  private record: HandoffCoordinatorRecord | null = null;

  public async read(): Promise<HandoffCoordinatorRecord | null> {
    return this.record;
  }

  public async persist(record: HandoffCoordinatorRecord): Promise<void> {
    this.record = record;
    this.phases.push(record.phase);
  }

  public async clear(): Promise<void> {
    this.record = null;
    this.phases.push('cleared');
  }

  public seed(record: HandoffCoordinatorRecord): void {
    this.record = record;
  }
}

class FakeLock implements ExclusiveLockPort {
  public readonly held = new Set<string>();
  public acquisitions = 0;

  public async tryAcquire(key: string): Promise<LockHandle | null> {
    if (this.held.has(key)) {
      return null;
    }
    this.held.add(key);
    this.acquisitions += 1;
    return {
      key,
      holder: 'test',
      acquiredAt: '2026-09-28T10:00:00.000Z',
      release: async (): Promise<void> => {
        this.held.delete(key);
      }
    };
  }
}

const clock: Clock = {
  now: () => Date.parse('2026-09-28T10:00:00.000Z'),
  nowIso: () => '2026-09-28T10:00:00.000Z'
};

const setup = (): {
  registry: FakeRegistry;
  coordinator: FakeCoordinator;
  lock: FakeLock;
  transaction: DestinationClaimTransaction;
} => {
  const registry = new FakeRegistry();
  const coordinator = new FakeCoordinator();
  const lock = new FakeLock();
  let sequence = 0;
  const transaction = new DestinationClaimTransaction({
    registry,
    lock,
    coordinator,
    clock,
    newId: () => {
      sequence += 1;
      return `id-${sequence}`;
    }
  });
  return { registry, coordinator, lock, transaction };
};

describe('DestinationClaimTransaction.reserve', () => {
  it('reserves an unowned destination and records the pending claim', async () => {
    const { registry, coordinator, transaction } = setup();

    const result = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      intendedFingerprint: `sha256:${'a'.repeat(64)}`
    });

    expect(result.kind).toBe('reserved');
    expect(registry.claims.get(CLAIM_KEY)?.state).toBe('pending-materialization');
    expect(coordinator.phases).toStrictEqual(['prepared', 'acquiring-pending']);
  });

  it('refuses a second writer while a reservation is held', async () => {
    const { transaction } = setup();
    await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY
    });

    const second = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: 'other-key'
    });

    expect(second.kind).toBe('retryable-failure');
  });

  it('returns conflict when another installation owns the destination and no hand-off is supplied', async () => {
    const { registry, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, [artifact(`sha256:${'b'.repeat(64)}`)]));

    const result = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY
    });

    expect(result.kind).toBe('conflict');
    expect(registry.claims.size).toBe(0);
    expect(registry.records.get(CEDING_KEY)?.artifacts).toHaveLength(1);
  });

  it('rejects a hand-off that names a different destination or ceding installation', async () => {
    const { registry, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, [artifact(`sha256:${'b'.repeat(64)}`)]));

    const wrongDestination = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      handoff: {
        destinationPath: '/home/u/.copilot/prompts/other.md',
        cedingInstallationKey: CEDING_KEY,
        acquiringInstallationKey: ACQUIRING_KEY
      }
    });
    const wrongCeding = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      handoff: {
        destinationPath: DESTINATION,
        cedingInstallationKey: 'someone-else',
        acquiringInstallationKey: ACQUIRING_KEY
      }
    });

    expect(wrongDestination.kind).toBe('conflict');
    expect(wrongCeding.kind).toBe('conflict');
  });

  it('detaches the ceding artifact before reserving, so no record names two owners', async () => {
    const { registry, coordinator, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, [artifact(`sha256:${'b'.repeat(64)}`)]));
    await registry.put(installation(ACQUIRING_KEY, acquiringIdentity, []));

    const result = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      intendedFingerprint: `sha256:${'a'.repeat(64)}`,
      handoff: {
        destinationPath: DESTINATION,
        cedingInstallationKey: CEDING_KEY,
        acquiringInstallationKey: ACQUIRING_KEY
      }
    });

    expect(result.kind).toBe('reserved');
    expect(registry.records.get(CEDING_KEY)?.artifacts).toStrictEqual([]);
    expect(registry.records.get(ACQUIRING_KEY)?.artifacts).toStrictEqual([]);
    expect(coordinator.phases).toStrictEqual(['prepared', 'ceding-detached', 'acquiring-pending']);
    if (result.kind === 'reserved') {
      expect(result.claim.cedingInstallation).toBe(CEDING_KEY);
      expect(result.claim.priorManagedArtifact?.installedFingerprint)
        .toBe(`sha256:${'b'.repeat(64)}`);
    }
  });

  it('refuses a write while a rollback-required claim is unresolved', async () => {
    const { registry, transaction } = setup();
    registry.claims.set(CLAIM_KEY, {
      claimId: 'c1',
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      ownerInstallation: ACQUIRING_KEY,
      generation: 4,
      state: 'rollback-required',
      updatedAt: '2026-09-28T00:00:00.000Z'
    });

    const result = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY
    });

    expect(result.kind).toBe('retryable-failure');
  });
});

describe('DestinationClaimTransaction.finalize', () => {
  it('records the verified artifact, settles the claim, and clears the coordinator', async () => {
    const { registry, coordinator, lock, transaction } = setup();
    await registry.put(installation(ACQUIRING_KEY, acquiringIdentity, []));
    const reserved = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      intendedFingerprint: `sha256:${'a'.repeat(64)}`
    });
    if (reserved.kind !== 'reserved') {
      throw new Error('expected a reservation');
    }

    const updated = await transaction.finalize(
      reserved.claim,
      installation(ACQUIRING_KEY, acquiringIdentity, []),
      artifact(`sha256:${'a'.repeat(64)}`),
      reserved.lock
    );

    expect(updated.artifacts).toHaveLength(1);
    expect(registry.claims.get(CLAIM_KEY)?.state).toBe('finalized');
    expect(coordinator.phases.at(-1)).toBe('cleared');
    expect(lock.held.size).toBe(0);
  });
});

describe('DestinationClaimTransaction.resolveFailure', () => {
  it('restores the detached ceding record when nothing was materialized', async () => {
    const { registry, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, [artifact(`sha256:${'b'.repeat(64)}`)]));
    const reserved = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      handoff: {
        destinationPath: DESTINATION,
        cedingInstallationKey: CEDING_KEY,
        acquiringInstallationKey: ACQUIRING_KEY
      }
    });
    if (reserved.kind !== 'reserved') {
      throw new Error('expected a reservation');
    }

    const resolved = await transaction.resolveFailure(
      reserved.claim,
      { materialized: false, classifiable: true },
      reserved.lock
    );

    expect(resolved.kind).toBe('compensated');
    expect(registry.records.get(CEDING_KEY)?.artifacts[0]?.installedFingerprint)
      .toBe(`sha256:${'b'.repeat(64)}`);
    expect(registry.claims.get(CLAIM_KEY)).toBeUndefined();
  });

  it('keeps rollback-required with its evidence when the bytes cannot be classified', async () => {
    const { registry, transaction } = setup();
    const reserved = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      intendedFingerprint: `sha256:${'a'.repeat(64)}`
    });
    if (reserved.kind !== 'reserved') {
      throw new Error('expected a reservation');
    }

    const resolved = await transaction.resolveFailure(
      reserved.claim,
      { materialized: false, classifiable: false },
      reserved.lock
    );

    expect(resolved.kind).toBe('unresolved');
    const claim = registry.claims.get(CLAIM_KEY);
    expect(claim?.state).toBe('rollback-required');
    expect(claim?.intendedFingerprint).toBe(`sha256:${'a'.repeat(64)}`);
  });

  it('finishes the interrupted step when a fresh read proves the intended bytes exist', async () => {
    const { registry, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, [artifact(`sha256:${'b'.repeat(64)}`)]));
    const reserved = await transaction.reserve({
      target: 'copilot',
      scope: 'user',
      destinationPath: DESTINATION,
      acquiringInstallationKey: ACQUIRING_KEY,
      handoff: {
        destinationPath: DESTINATION,
        cedingInstallationKey: CEDING_KEY,
        acquiringInstallationKey: ACQUIRING_KEY
      }
    });
    if (reserved.kind !== 'reserved') {
      throw new Error('expected a reservation');
    }

    const resolved = await transaction.resolveFailure(
      reserved.claim,
      { materialized: true, classifiable: true },
      reserved.lock
    );

    expect(resolved.kind).toBe('finalized');
    expect(registry.claims.get(CLAIM_KEY)?.state).toBe('finalized');
    expect(registry.records.get(CEDING_KEY)?.artifacts).toStrictEqual([]);
  });
});

describe('DestinationClaimTransaction.recover', () => {
  it('reports nothing to recover when no hand-off is in flight', async () => {
    const { transaction } = setup();

    expect(await transaction.recover(CLAIM_KEY, { materialized: false, classifiable: true }))
      .toBeNull();
  });

  it('compensates a detached ceding record whose reservation never became live', async () => {
    const { registry, coordinator, transaction } = setup();
    await registry.put(installation(CEDING_KEY, cedingIdentity, []));
    coordinator.seed({
      operationId: 'op-1',
      claimKey: CLAIM_KEY,
      destinationPath: DESTINATION,
      target: 'copilot',
      scope: 'user',
      acquiringInstallationKey: ACQUIRING_KEY,
      cedingInstallationKey: CEDING_KEY,
      priorArtifact: artifact(`sha256:${'b'.repeat(64)}`),
      claimGeneration: 1,
      phase: 'ceding-detached',
      updatedAt: '2026-09-28T00:00:00.000Z'
    });

    const resolved = await transaction.recover(CLAIM_KEY, { materialized: false, classifiable: true });

    expect(resolved?.kind).toBe('compensated');
    expect(registry.records.get(CEDING_KEY)?.artifacts[0]?.installedFingerprint)
      .toBe(`sha256:${'b'.repeat(64)}`);
  });

  it('refuses to recover while another holder has the lock', async () => {
    const { coordinator, lock, transaction } = setup();
    coordinator.seed({
      operationId: 'op-2',
      claimKey: CLAIM_KEY,
      destinationPath: DESTINATION,
      target: 'copilot',
      scope: 'user',
      acquiringInstallationKey: ACQUIRING_KEY,
      claimGeneration: 1,
      phase: 'acquiring-pending',
      updatedAt: '2026-09-28T00:00:00.000Z'
    });
    await lock.tryAcquire(CLAIM_KEY);

    const resolved = await transaction.recover(CLAIM_KEY, { materialized: false, classifiable: true });

    expect(resolved?.kind).toBe('unresolved');
  });
});
