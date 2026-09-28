/**
 * Tests for install/governed-lifecycle.ts — the shared install path
 * (BR3.3, BR3.5, BR4.1, BR4.7, NFR1.5, NFR1.8, R-02).
 *
 * Boundaries are faked at the port level only. The artifact-store fake records
 * every write and can inject a read-back mismatch, which is how "no artifact is
 * recorded after a failed verification" is proven rather than assumed.
 */
import type {
  BundleSource,
  Clock,
  DestinationOwnershipClaim,
  GovernedManifestResult,
  InstallationRegistryPort,
  LockHandle,
  ManagedArtifact,
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
const PROMPT_PATH = `${ROOT}/prompts/review.prompt.md`;
const PROMPT_BYTES = new TextEncoder().encode('# Review\n');

const TARGET: Target = { name: 'copilot', type: 'vscode', scope: 'user' };

const IDENTITY = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;
const KEY = deriveInstallationKey(IDENTITY);

const governedBundle = (): GovernedManifestResult => ({
  kind: 'governed',
  bundle: projectGovernedManifest({
    formatVersion: 1,
    id: 'acme',
    version: '1.2.3',
    name: 'Acme',
    items: [{ id: 'i1', path: 'prompts/review.prompt.md', kind: 'prompt' }],
    files: [{ path: 'prompts/review.prompt.md', role: 'installable', size: PROMPT_BYTES.byteLength }],
    provenance: { source: 's', revision: 'r', license: 'Apache-2.0' }
  }),
  files: new Map([['prompts/review.prompt.md', PROMPT_BYTES]])
});

class FakeGovernance implements ManifestGovernancePort {
  public constructor(private readonly result: GovernedManifestResult = governedBundle()) {}

  public async validate(_source: BundleSource): Promise<GovernedManifestResult> {
    return this.result;
  }
}

class FakeRouting implements TargetRoutingPort {
  public constructor(private readonly resolution?: TargetRoutingResolution) {}

  public async resolve(request: TargetRoutingRequest): Promise<TargetRoutingResolution> {
    return this.resolution ?? {
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
  public readonly writes: string[] = [];
  public readBackOverride?: Uint8Array;
  public failWrite?: 'safety-blocked' | 'retryable-failure';

  public async writeAndReadBack(
    request: TargetArtifactWrite
  ): Promise<TargetArtifactStoreResult<Uint8Array>> {
    if (this.failWrite !== undefined) {
      return { kind: this.failWrite, detail: 'injected failure' };
    }
    this.writes.push(request.destinationPath);
    this.disk.set(request.destinationPath, request.bytes);
    return { kind: 'ok', value: this.readBackOverride ?? request.bytes };
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
    this.disk.delete(destinationPath);
    return { kind: 'ok', value: undefined };
  }
}

class FakeRegistry implements InstallationRegistryPort {
  public readonly records = new Map<string, ManagedInstallation>();
  public readonly claims = new Map<string, DestinationOwnershipClaim>();

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

const lockPort = {
  held: new Set<string>(),
  tryAcquire: async (key: string): Promise<LockHandle | null> => {
    if (lockPort.held.has(key)) {
      return null;
    }
    lockPort.held.add(key);
    return {
      key,
      holder: 'test',
      acquiredAt: '2026-09-28T10:00:00.000Z',
      release: async (): Promise<void> => {
        lockPort.held.delete(key);
      }
    };
  }
};

const setup = (options: {
  governance?: ManifestGovernancePort;
  routing?: TargetRoutingPort;
} = {}): {
  lifecycle: GovernedLifecycle;
  registry: FakeRegistry;
  artifacts: FakeArtifactStore;
} => {
  const registry = new FakeRegistry();
  const artifacts = new FakeArtifactStore();
  lockPort.held.clear();
  let sequence = 0;
  const claims = new DestinationClaimTransaction({
    registry,
    lock: lockPort,
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
    governance: options.governance ?? new FakeGovernance(),
    routing: options.routing ?? new FakeRouting(),
    registry,
    artifacts,
    claims,
    clock
  });
  return { lifecycle, registry, artifacts };
};

const installRequest = (overrides: Record<string, unknown> = {}): Parameters<GovernedLifecycle['install']>[0] => ({
  source: { kind: 'extracted', files: new Map([['prompts/review.prompt.md', PROMPT_BYTES]]) },
  target: TARGET,
  scope: 'user',
  ...overrides
});

const managed = (artifact: ManagedArtifact): ManagedInstallation => ({
  ...IDENTITY,
  installationKey: KEY,
  manifestVersion: '1.0.0',
  installedAt: '2026-09-01T00:00:00.000Z',
  artifacts: [artifact]
});

describe('GovernedLifecycle.install', () => {
  it('installs a governed bundle and records the fingerprint of the bytes as written', async () => {
    const { lifecycle, registry, artifacts } = setup();

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('success');
    expect(artifacts.writes).toStrictEqual([PROMPT_PATH]);
    const record = registry.records.get(KEY);
    expect(record?.manifestVersion).toBe('1.2.3');
    expect(record?.artifacts[0]?.installedFingerprint).toBe(fingerprint(PROMPT_BYTES));
    expect(record?.artifacts[0]?.sizeInBytes).toBe(PROMPT_BYTES.byteLength);
  });

  it('returns validation-error and writes nothing when governance refuses', async () => {
    const { lifecycle, registry, artifacts } = setup({
      governance: new FakeGovernance({
        kind: 'validation-error',
        outcome: { kind: 'validation-error', detail: 'no root manifest' }
      })
    });

    const outcome = await lifecycle.install(installRequest());

    expect(outcome).toStrictEqual({ kind: 'validation-error', detail: 'no root manifest' });
    expect(artifacts.writes).toStrictEqual([]);
    expect(registry.records.size).toBe(0);
  });

  it('returns safety-blocked and writes nothing when routing refuses a destination', async () => {
    const { lifecycle, artifacts } = setup({
      routing: new FakeRouting({ kind: 'safety-blocked', detail: 'would escape' })
    });

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('safety-blocked');
    expect(artifacts.writes).toStrictEqual([]);
  });

  it('records no artifact when read-back does not match the intended bytes (NFR1.5)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    artifacts.readBackOverride = new TextEncoder().encode('corrupted');

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('retryable-failure');
    expect(registry.records.get(KEY)?.artifacts ?? []).toStrictEqual([]);
  });

  it('refuses to overwrite a locally changed still-named artifact without consent (BR4.7)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(managed({
      destinationPath: PROMPT_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(PROMPT_BYTES),
      sizeInBytes: PROMPT_BYTES.byteLength
    }));
    artifacts.disk.set(PROMPT_PATH, new TextEncoder().encode('# Edited by the user\n'));

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('conflict');
    expect(outcome.detail).toContain('changed locally');
    expect(artifacts.writes).toStrictEqual([]);
    expect(new TextDecoder().decode(artifacts.disk.get(PROMPT_PATH)))
      .toBe('# Edited by the user\n');
  });

  it('replaces the locally changed artifact when consent is given', async () => {
    const { lifecycle, registry, artifacts } = setup();
    await registry.put(managed({
      destinationPath: PROMPT_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(PROMPT_BYTES),
      sizeInBytes: PROMPT_BYTES.byteLength
    }));
    artifacts.disk.set(PROMPT_PATH, new TextEncoder().encode('# Edited by the user\n'));

    const outcome = await lifecycle.install(installRequest({ overwriteConsent: 'confirmed' }));

    expect(outcome.kind).toBe('success');
    expect(artifacts.writes).toStrictEqual([PROMPT_PATH]);
    expect(registry.records.get(KEY)?.artifacts[0]?.installedFingerprint)
      .toBe(fingerprint(PROMPT_BYTES));
  });

  it('returns conflict when another installation owns the destination and no hand-off is supplied (R-02)', async () => {
    const { lifecycle, registry, artifacts } = setup();
    const foreignIdentity = { bundleId: 'other', target: 'copilot', scope: 'user' } as const;
    await registry.put({
      ...foreignIdentity,
      installationKey: deriveInstallationKey(foreignIdentity),
      manifestVersion: '1.0.0',
      installedAt: '2026-09-01T00:00:00.000Z',
      artifacts: [{
        destinationPath: PROMPT_PATH,
        itemKind: 'prompt',
        installedFingerprint: fingerprint(PROMPT_BYTES),
        sizeInBytes: PROMPT_BYTES.byteLength
      }]
    });

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('conflict');
    expect(outcome.detail).toContain('managed by another installation');
    expect(artifacts.writes).toStrictEqual([]);
  });

  it('takes over a destination when a matching hand-off is supplied', async () => {
    const { lifecycle, registry } = setup();
    const foreignIdentity = { bundleId: 'other', target: 'copilot', scope: 'user' } as const;
    const foreignKey = deriveInstallationKey(foreignIdentity);
    await registry.put({
      ...foreignIdentity,
      installationKey: foreignKey,
      manifestVersion: '1.0.0',
      installedAt: '2026-09-01T00:00:00.000Z',
      artifacts: [{
        destinationPath: PROMPT_PATH,
        itemKind: 'prompt',
        installedFingerprint: fingerprint(PROMPT_BYTES),
        sizeInBytes: PROMPT_BYTES.byteLength
      }]
    });

    const outcome = await lifecycle.install(installRequest({
      handoffs: [{
        destinationPath: PROMPT_PATH,
        cedingInstallationKey: foreignKey,
        acquiringInstallationKey: KEY
      }]
    }));

    expect(outcome.kind).toBe('success');
    expect(registry.records.get(foreignKey)?.artifacts).toStrictEqual([]);
    expect(registry.records.get(KEY)?.artifacts).toHaveLength(1);
  });

  it('propagates a write failure without recording the artifact', async () => {
    const { lifecycle, registry, artifacts } = setup();
    artifacts.failWrite = 'retryable-failure';

    const outcome = await lifecycle.install(installRequest());

    expect(outcome.kind).toBe('retryable-failure');
    expect(registry.records.get(KEY)?.artifacts ?? []).toStrictEqual([]);
  });
});
