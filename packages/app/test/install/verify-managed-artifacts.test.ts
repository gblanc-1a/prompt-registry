/**
 * Tests for install/verify-managed-artifacts.ts — read-only verification, the
 * aggregate rule, and token minting (NFR1.1.6, NFR1.1.7, BR5.6, BR5.7).
 */
import type {
  Clock,
  DestinationOwnershipClaim,
  InstallationRegistryPort,
  ManagedInstallation,
  TargetArtifactStorePort,
  TargetArtifactStoreResult,
} from '@ai-primitives-hub/core';
import {
  deriveInstallationKey,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  fingerprint,
} from '../../src/install/governed-lifecycle';
import {
  ManagedArtifactVerifier,
} from '../../src/install/verify-managed-artifacts';

const ROOT = '/home/u/.copilot';
const A_PATH = `${ROOT}/prompts/a.md`;
const B_PATH = `${ROOT}/prompts/b.md`;
const A_BYTES = new TextEncoder().encode('# a\n');
const B_BYTES = new TextEncoder().encode('# b\n');

const IDENTITY = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;
const KEY = deriveInstallationKey(IDENTITY);

class ReadOnlyRegistry implements InstallationRegistryPort {
  public constructor(private readonly stored: ManagedInstallation | null) {}

  public async get(): Promise<ManagedInstallation | null> {
    return this.stored;
  }

  public async list(): Promise<readonly ManagedInstallation[]> {
    return this.stored === null ? [] : [this.stored];
  }

  public async put(): Promise<void> {
    throw new Error('verification must not write');
  }

  public async delete(): Promise<void> {
    throw new Error('verification must not write');
  }

  public async queryDestinationOwnership(): Promise<readonly never[]> {
    return [];
  }

  public async rekey(): Promise<void> {
    throw new Error('verification must not write');
  }

  public async readClaim(): Promise<DestinationOwnershipClaim | null> {
    return null;
  }

  public async putClaim(): Promise<void> {
    throw new Error('verification must not write');
  }

  public async deleteClaim(): Promise<void> {
    throw new Error('verification must not write');
  }
}

class ReadOnlyStore implements TargetArtifactStorePort {
  public constructor(private readonly disk: Map<string, Uint8Array>) {}

  public async writeAndReadBack(): Promise<TargetArtifactStoreResult<Uint8Array>> {
    throw new Error('verification must not write');
  }

  public async read(
    _root: string,
    destinationPath: string
  ): Promise<TargetArtifactStoreResult<Uint8Array | null>> {
    if (destinationPath.includes('unsafe')) {
      return { kind: 'safety-blocked', detail: 'symbolic link' };
    }
    return { kind: 'ok', value: this.disk.get(destinationPath) ?? null };
  }

  public async removeAndVerifyAbsent(): Promise<TargetArtifactStoreResult> {
    throw new Error('verification must not delete');
  }
}

const clock: Clock = {
  now: () => Date.parse('2026-09-28T10:00:00.000Z'),
  nowIso: () => '2026-09-28T10:00:00.000Z'
};

const record = (): ManagedInstallation => ({
  ...IDENTITY,
  installationKey: KEY,
  manifestVersion: '1.0.0',
  installedAt: '2026-09-01T00:00:00.000Z',
  artifacts: [
    {
      destinationPath: A_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(A_BYTES),
      sizeInBytes: A_BYTES.byteLength
    },
    {
      destinationPath: B_PATH,
      itemKind: 'prompt',
      installedFingerprint: fingerprint(B_BYTES),
      sizeInBytes: B_BYTES.byteLength
    }
  ]
});

const verifier = (disk: Map<string, Uint8Array>, signingKey?: Uint8Array): ManagedArtifactVerifier =>
  new ManagedArtifactVerifier({
    registry: new ReadOnlyRegistry(record()),
    artifacts: new ReadOnlyStore(disk),
    clock,
    ...(signingKey === undefined ? {} : { signingKey })
  });

const expected = [
  { destinationRoot: ROOT, destinationPath: A_PATH },
  { destinationRoot: ROOT, destinationPath: B_PATH }
];

describe('ManagedArtifactVerifier.verify', () => {
  it('reports present-identical for every matching artifact and mints a token', async () => {
    const disk = new Map([[A_PATH, A_BYTES], [B_PATH, B_BYTES]]);

    const outcome = await verifier(disk).verify({
      installationKey: KEY,
      artifacts: expected,
      entryId: 'entry-1',
      generation: 4
    });

    expect(outcome.result.allVerified).toBe(true);
    expect(outcome.result.artifactVerdicts.map((verdict) => verdict.verdict))
      .toStrictEqual(['present-identical', 'present-identical']);
    expect(outcome.token?.entryId).toBe('entry-1');
    expect(outcome.token?.generation).toBe(4);
    expect(outcome.token?.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports present-different and mints no token when bytes have changed', async () => {
    const disk = new Map([[A_PATH, new TextEncoder().encode('# edited\n')], [B_PATH, B_BYTES]]);

    const outcome = await verifier(disk).verify({
      installationKey: KEY,
      artifacts: expected,
      entryId: 'entry-1',
      generation: 4
    });

    expect(outcome.result.allVerified).toBe(false);
    expect(outcome.result.artifactVerdicts[0]?.verdict).toBe('present-different');
    expect(outcome.token).toBeUndefined();
  });

  it('reports absent for a missing artifact', async () => {
    const outcome = await verifier(new Map([[A_PATH, A_BYTES]])).verify({
      installationKey: KEY,
      artifacts: expected
    });

    expect(outcome.result.artifactVerdicts[1]?.verdict).toBe('absent');
    expect(outcome.result.allVerified).toBe(false);
  });

  it('lets one safety-blocked verdict prevent allVerified regardless of the others', async () => {
    const unsafePath = `${ROOT}/unsafe/a.md`;
    const outcome = await verifier(new Map([[A_PATH, A_BYTES]])).verify({
      installationKey: KEY,
      artifacts: [
        { destinationRoot: ROOT, destinationPath: A_PATH },
        { destinationRoot: ROOT, destinationPath: unsafePath }
      ],
      entryId: 'entry-1',
      generation: 4
    });

    expect(outcome.result.allVerified).toBe(false);
    expect(outcome.result.artifactVerdicts[1]?.verdict).toBe('safety-blocked');
    expect(outcome.token).toBeUndefined();
  });

  it('refuses to read a legacy path outside its verified source root (BR5.7)', async () => {
    const outcome = await verifier(new Map([[A_PATH, A_BYTES]])).verify({
      installationKey: KEY,
      artifacts: [{
        destinationRoot: ROOT,
        destinationPath: A_PATH,
        legacySourceRoot: '/legacy/root',
        legacyPath: '/legacy/root/../elsewhere/a.md'
      }]
    });

    expect(outcome.result.artifactVerdicts[0]?.verdict).toBe('safety-blocked');
  });

  it('mints no token when the caller names no journal entry', async () => {
    const disk = new Map([[A_PATH, A_BYTES], [B_PATH, B_BYTES]]);

    const outcome = await verifier(disk).verify({ installationKey: KEY, artifacts: expected });

    expect(outcome.result.allVerified).toBe(true);
    expect(outcome.token).toBeUndefined();
  });

  it('accepts its own token and rejects an altered or foreign-keyed one', async () => {
    const disk = new Map([[A_PATH, A_BYTES], [B_PATH, B_BYTES]]);
    const key = new Uint8Array(32).fill(7);
    const instance = verifier(disk, key);
    const outcome = await instance.verify({
      installationKey: KEY,
      artifacts: expected,
      entryId: 'entry-1',
      generation: 4
    });
    const token = outcome.token;
    if (token === undefined) {
      throw new Error('expected a token');
    }

    expect(instance.isAuthentic(token)).toBe(true);
    expect(instance.isAuthentic({ ...token, generation: 5 })).toBe(false);
    expect(instance.isAuthentic({ ...token, signature: 'f'.repeat(64) })).toBe(false);
    const otherProcess = verifier(disk, new Uint8Array(32).fill(9));
    expect(otherProcess.isAuthentic(token)).toBe(false);
  });

  it('binds the token to the exact expected artifact set', async () => {
    const disk = new Map([[A_PATH, A_BYTES], [B_PATH, B_BYTES]]);
    const key = new Uint8Array(32).fill(7);
    const instance = verifier(disk, key);

    const full = await instance.verify({
      installationKey: KEY,
      artifacts: expected,
      entryId: 'entry-1',
      generation: 4
    });
    const subset = await instance.verify({
      installationKey: KEY,
      artifacts: [expected[0]],
      entryId: 'entry-1',
      generation: 4
    });

    expect(full.token?.artifactSetDigest).not.toBe(subset.token?.artifactSetDigest);
    expect(full.token?.signature).not.toBe(subset.token?.signature);
  });
});
