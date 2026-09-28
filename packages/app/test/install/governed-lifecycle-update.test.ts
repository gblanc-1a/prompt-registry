/**
 * Tests for the update half of install/governed-lifecycle.ts — the omitted-artifact
 * rule and the outcome it reports (BR4.2, BR4.3, BR4.4, BR4.8, NFR1.8).
 *
 * Update is a specialisation of install, so these tests assert the cases that only
 * a *second* pass can produce: an artifact the new manifest no longer names.
 */
import type {
  BundleSource,
  Clock,
  DestinationOwnershipClaim,
  GovernedManifestResult,
  InstallationRegistryPort,
  LockHandle,
  ManagedInstallation,
  ManifestGovernancePort,
  Target,
  TargetArtifactStorePort,
  TargetArtifactStoreResult,
  TargetArtifactWrite,
  TargetRoutingPort,
  TargetRoutingRequest,
  TargetRoutingResolution,
} from '@ai-primitives-hub/core';
import {
  deriveClaimKey,
  deriveInstallationKey,
  projectGovernedManifest,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DestinationClaimTransaction,
} from '../../src/install/destination-claim';
import {
  fingerprint,
  GovernedLifecycle,
} from '../../src/install/governed-lifecycle';

const ROOT = '/home/u/.copilot';
const KEPT_PATH = `${ROOT}/prompts/kept.md`;
const OMITTED_PATH = `${ROOT}/prompts/omitted.md`;
const KEPT_BYTES = new TextEncoder().encode('# kept\n');
const OMITTED_BYTES = new TextEncoder().encode('# omitted\n');

const TARGET: Target = { name: 'copilot', type: 'vscode', scope: 'user' };
const IDENTITY = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;
const KEY = deriveInstallationKey(IDENTITY);

const newManifest = (): GovernedManifestResult => ({
  kind: 'governed',
  bundle: projectGovernedManifest({
    formatVersion: 1,
    id: 'acme',
    version: '2.0.0',
    name: 'Acme',
    items: [{ id: 'kept', path: 'prompts/kept.md', kind: 'prompt' }],
    files: [{ path: 'prompts/kept.md', role: 'installable', size: KEPT_BYTES.byteLength }],
    provenance: { source: 's', revision: 'r', license: 'Apache-2.0' }
  }),
  files: new Map([['prompts/kept.md', KEPT_BYTES]])
});

class FakeGovernance implements ManifestGovernancePort {
  public async validate(_source: BundleSource): Promise<GovernedManifestResult> {
    return newManifest();
  }
}

class FakeRouting implements TargetRoutingPort {
  public async resolve(request: TargetRoutingRequest): Promise<TargetRoutingResolution> {
    return {
      kind: 'resolved',
      address: {
        destinationRoot: ROOT,
        itemKind: request.itemKind,
        destinationPath: `${ROOT}/prompts/${request.archivePath.split('/').at(-1) ?? ''}`
      }
    };
  }
}

class FakeArtifactStore implements TargetArtifactStorePort {
  public readonly disk = new Map<string, Uint8Array>();
  public readonly removed: string[] = [];

  public async writeAndReadBack(
    request: TargetArtifactWrite
  ): Promise<TargetArtifactStoreResult<Uint8Array>> {
    this.disk.set(request.destinationPath, request.bytes);
    return { kind: 'ok', value: request.bytes };
  }

  public async read(
    _root: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult<Uint8Array | null>> {
    return { kind: 'ok', value: this.disk.get(destinationPath) ?? null };
  }

  public async removeAndVerifyAbsent(
    _root: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult> {
    this.removed.push(destinationPath);
    this.disk.delete(destinationPath);
    return { kind: 'ok', value: undefined };
  }
}

class FakeRegistry implements InstallationRegistryPort {
  public readonly records = new Map<string, ManagedInstallation>();
  private readonly claims = new Map<string, DestinationOwnershipClaim>();

  public async get(key: string): Promise<ManagedInstallation | null> {
    return this.records.get(key) ?? null;
  }

  public async list(): Promise<readonly ManagedInstallation[]> {
    return [...this.records.values()];
  }

  public async put(record: ManagedInstallation): Promise<void> {
    this.records.set(record.installationKey, record);
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
    for (const record of this.records.values()) {
      if (record.target !== query.target || record.scope !== query.scope) {
        continue;
      }
      for (const artifact of record.artifacts) {
        if (wanted.has(artifact.destinationPath)) {
          owners.push({
            destinationPath: artifact.destinationPath,
            installationKey: record.installationKey
          });
        }
      }
    }
    return owners;
  }

  public async rekey(): Promise<void> {
    throw new Error('not used');
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

const clock: Clock = {
  now: () => Date.parse('2026-09-28T10:00:00.000Z'),
  nowIso: () => '2026-09-28T10:00:00.000Z'
};

const setup = (): {
  lifecycle: GovernedLifecycle;
  registry: FakeRegistry;
  artifacts: FakeArtifactStore;
} => {
  const registry = new FakeRegistry();
  const artifacts = new FakeArtifactStore();
  const held = new Set<string>();
  let sequence = 0;
  const claims = new DestinationClaimTransaction({
    registry,
    lock: {
      tryAcquire: async (key: string): Promise<LockHandle | null> => {
        if (held.has(key)) {
          return null;
        }
        held.add(key);
        return {
          key,
          holder: 'test',
          acquiredAt: '2026-09-28T10:00:00.000Z',
          release: async (): Promise<void> => {
            held.delete(key);
          }
        };
      }
    },
    coordinator: {
      read: async () => null,
      persist: async () => undefined,
      clear: async () => undefined
    },
    clock,
    newId: () => {
      sequence += 1;
      return `id-${sequence}`;
    }
  });
  const lifecycle = new GovernedLifecycle({
    governance: new FakeGovernance(),
    routing: new FakeRouting(),
    registry,
    artifacts,
    claims,
    clock
  });
  return { lifecycle, registry, artifacts };
};

const priorRecord = (): ManagedInstallation => ({
  ...IDENTITY,
  installationKey: KEY,
  manifestVersion: '1.0.0',
  installedAt: '2026-09-01T00:00:00.000Z',
  artifacts: [
    {
      destinationPath: KEPT_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(KEPT_BYTES),
      sizeInBytes: KEPT_BYTES.byteLength
    },
    {
      destinationPath: OMITTED_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(OMITTED_BYTES),
      sizeInBytes: OMITTED_BYTES.byteLength
    }
  ]
});

const updateRequest = (): Parameters<GovernedLifecycle['update']>[0] => ({
  source: { kind: 'extracted', files: new Map([['prompts/kept.md', KEPT_BYTES]]) },
  target: TARGET,
  scope: 'user'
});

describe('GovernedLifecycle.update', () => {
  it('removes an omitted artifact whose bytes still match its fingerprint (BR4.2)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.disk.set(OMITTED_PATH, OMITTED_BYTES);

    const outcome = await lifecycle.update(updateRequest());

    expect(outcome.kind).toBe('success');
    expect(artifacts.removed).toStrictEqual([OMITTED_PATH]);
    expect(registry.records.get(KEY)?.artifacts.map((a) => a.destinationPath))
      .toStrictEqual([KEPT_PATH]);
  });

  it('preserves a locally changed omitted artifact and de-manages it (BR4.2, BR4.3)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.disk.set(OMITTED_PATH, new TextEncoder().encode('# user edited\n'));

    const outcome = await lifecycle.update(updateRequest());

    expect(outcome.kind).toBe('success');
    expect(outcome.preservedArtifacts).toStrictEqual([{ destinationPath: OMITTED_PATH }]);
    expect(artifacts.removed).toStrictEqual([]);
    expect(new TextDecoder().decode(artifacts.disk.get(OMITTED_PATH))).toBe('# user edited\n');
    expect(registry.records.get(KEY)?.artifacts.map((a) => a.destinationPath))
      .toStrictEqual([KEPT_PATH]);
  });

  it('leaves a preserved artifact untouched by a later uninstall (BR4.3 + BR4.5)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.disk.set(OMITTED_PATH, new TextEncoder().encode('# user edited\n'));
    await lifecycle.update(updateRequest());

    const outcome = await lifecycle.uninstall({
      bundleId: 'acme',
      target: TARGET,
      scope: 'user'
    });

    expect(outcome.kind).toBe('success');
    expect(outcome.removedArtifacts).toStrictEqual([{ destinationPath: KEPT_PATH }]);
    expect(artifacts.disk.has(OMITTED_PATH)).toBe(true);
    expect(registry.records.get(KEY)).toBeUndefined();
  });

  it('refreshes the fingerprint and manifest version of a rewritten artifact', async () => {
    const { lifecycle, registry, artifacts } = setup();
    const changedBytes = new TextEncoder().encode('# kept v2\n');
    await registry.put({
      ...priorRecord(),
      artifacts: [{
        destinationPath: KEPT_PATH,
        itemKind: 'prompt',
        installedFingerprint: fingerprint(changedBytes),
        sizeInBytes: changedBytes.byteLength
      }]
    });
    artifacts.disk.set(KEPT_PATH, changedBytes);

    const outcome = await lifecycle.update({
      ...updateRequest(),
      overwriteConsent: 'confirmed'
    });

    expect(outcome.kind).toBe('success');
    const record = registry.records.get(KEY);
    expect(record?.manifestVersion).toBe('2.0.0');
    expect(record?.artifacts[0]?.installedFingerprint).toBe(fingerprint(KEPT_BYTES));
  });

  it('drops a record entry whose file has vanished from disk', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);

    const outcome = await lifecycle.update(updateRequest());

    expect(outcome.kind).toBe('success');
    expect(registry.records.get(KEY)?.artifacts.map((a) => a.destinationPath))
      .toStrictEqual([KEPT_PATH]);
  });
});

describe('GovernedLifecycle.uninstall', () => {
  it('reports success with no removals when there is no record (BR4.5)', async () => {
    const { lifecycle } = setup();

    const outcome = await lifecycle.uninstall({
      bundleId: 'never-installed',
      target: TARGET,
      scope: 'user'
    });

    expect(outcome).toStrictEqual({ kind: 'success', removedArtifacts: [] });
  });

  it('removes only artifacts the record still manages, leaving unmanaged files alone', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.disk.set(OMITTED_PATH, OMITTED_BYTES);
    artifacts.disk.set(`${ROOT}/prompts/unmanaged.md`, new TextEncoder().encode('# not ours\n'));

    await lifecycle.uninstall({ bundleId: 'acme', target: TARGET, scope: 'user' });

    expect(artifacts.disk.has(`${ROOT}/prompts/unmanaged.md`)).toBe(true);
    expect(artifacts.removed.toSorted()).toStrictEqual([KEPT_PATH, OMITTED_PATH].toSorted());
  });

  it('retains the record and returns retryable-failure when a removal cannot be verified', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.removeAndVerifyAbsent = async (): Promise<TargetArtifactStoreResult> =>
      ({ kind: 'retryable-failure', detail: 'still present' });

    const outcome = await lifecycle.uninstall({
      bundleId: 'acme',
      target: TARGET,
      scope: 'user'
    });

    expect(outcome.kind).toBe('retryable-failure');
    expect(registry.records.get(KEY)?.artifacts).toHaveLength(2);
  });

  it('deletes the record once every artifact is verified removed', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(priorRecord());
    artifacts.disk.set(KEPT_PATH, KEPT_BYTES);
    artifacts.disk.set(OMITTED_PATH, OMITTED_BYTES);

    await lifecycle.uninstall({ bundleId: 'acme', target: TARGET, scope: 'user' });

    expect(registry.records.get(KEY)).toBeUndefined();
  });
});
