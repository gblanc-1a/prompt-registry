/**
 * Tests for stores/repository-scope-installation-registry.ts — the
 * repository-scope registry adapter over the lockfile (BR3.1, BR3.3, BR3.4,
 * R-03), including the `2.0.0` compatibility read that must never mistake an
 * archive checksum for an installed fingerprint.
 */
import type {
  DestinationOwnershipClaim,
  ManagedInstallation,
  RepositoryIdentity,
} from '@ai-primitives-hub/core';
import {
  deriveInstallationKey,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Lockfile,
} from '../../src/stores/json-lockfile-store';
import {
  LOCKFILE_SCHEMA_VERSION,
} from '../../src/stores/json-lockfile-store';
import {
  RepositoryScopeInstallationRegistry,
} from '../../src/stores/repository-scope-installation-registry';

const REPOSITORY_IDENTITY: RepositoryIdentity = { identityValue: 'github.com/acme/repo' };

class MemoryLockfileFs {
  public readonly files = new Map<string, string>();

  public async readFile(p: string): Promise<string> {
    const value = this.files.get(p);
    if (value === undefined) {
      throw new Error(`ENOENT: ${p}`);
    }
    return value;
  }

  public async writeFile(p: string, contents: string): Promise<void> {
    this.files.set(p, contents);
  }

  public async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }

  public async mkdir(): Promise<void> {
    // No directories in this fake.
  }

  public async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
}

const claimStore = (): {
  claims: Map<string, DestinationOwnershipClaim>;
  readClaim: (key: string) => Promise<DestinationOwnershipClaim | null>;
  putClaim: (claim: DestinationOwnershipClaim) => Promise<void>;
  deleteClaim: (key: string) => Promise<void>;
} => {
  const claims = new Map<string, DestinationOwnershipClaim>();
  return {
    claims,
    readClaim: async (key) => claims.get(key) ?? null,
    putClaim: async (claim) => {
      claims.set(`${claim.target}|${claim.scope}|${claim.destinationPath}`, claim);
    },
    deleteClaim: async (key) => {
      claims.delete(key);
    }
  };
};

const registryWith = (fs: MemoryLockfileFs): RepositoryScopeInstallationRegistry =>
  new RepositoryScopeInstallationRegistry({
    fs,
    repositoryPath: '/repo',
    repositoryIdentity: REPOSITORY_IDENTITY,
    commitMode: 'commit',
    claims: claimStore()
  });

const identity = {
  bundleId: 'acme',
  target: 'copilot',
  scope: 'repository',
  repositoryIdentity: REPOSITORY_IDENTITY
} as const;

const record = (overrides: Partial<ManagedInstallation> = {}): ManagedInstallation => ({
  ...identity,
  installationKey: deriveInstallationKey(identity),
  manifestVersion: '1.2.3',
  installedAt: '2026-09-28T00:00:00.000Z',
  artifacts: [{
    destinationPath: '/repo/.github/prompts/a.md',
    itemKind: 'prompt',
    installedFingerprint: `sha256:${'a'.repeat(64)}`,
    sizeInBytes: 5
  }],
  ...overrides
});

const legacyLockfile: Lockfile = {
  $schema: 'https://example.invalid/lockfile.schema.json',
  version: '2.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  generatedBy: 'prompt-registry@1.0.0',
  bundles: {
    legacy: {
      version: '0.9.0',
      sourceId: 'acme',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      target: 'copilot',
      files: [{ path: '.github/prompts/legacy.md', checksum: `sha256:${'c'.repeat(64)}` }]
    },
    untargeted: {
      version: '0.9.0',
      sourceId: 'acme',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      files: [{ path: '.github/prompts/other.md', checksum: `sha256:${'d'.repeat(64)}` }]
    }
  },
  sources: {}
};

describe('RepositoryScopeInstallationRegistry', () => {
  it('writes a record into the repository lockfile with its explicit target (R-03)', async () => {
    const fs = new MemoryLockfileFs();

    await registryWith(fs).put(record());

    const written = JSON.parse(fs.files.get('/repo/prompt-registry.lock.json') ?? '{}') as Lockfile;
    expect(written.version).toBe(LOCKFILE_SCHEMA_VERSION);
    expect(written.bundles.acme?.target).toBe('copilot');
    expect(written.bundles.acme?.files[0]?.installedFingerprint).toBe(`sha256:${'a'.repeat(64)}`);
    expect(written.bundles.acme?.files[0]?.destinationPath).toBe('/repo/.github/prompts/a.md');
    expect(written.bundles.acme?.files[0]?.sizeInBytes).toBe(5);
  });

  it('round-trips the record through the lockfile', async () => {
    const fs = new MemoryLockfileFs();
    const registry = registryWith(fs);
    await registry.put(record());

    const read = await registry.get(deriveInstallationKey(identity));

    expect(read?.target).toBe('copilot');
    expect(read?.scope).toBe('repository');
    expect(read?.repositoryIdentity?.identityValue).toBe('github.com/acme/repo');
    expect(read?.artifacts[0]?.installedFingerprint).toBe(`sha256:${'a'.repeat(64)}`);
  });

  it('reads a 2.0.0 entry as unverifiable rather than trusting its archive checksum (BR3.3)', async () => {
    const fs = new MemoryLockfileFs();
    fs.files.set('/repo/prompt-registry.lock.json', JSON.stringify(legacyLockfile));

    const records = await registryWith(fs).list();

    const legacy = records.find((candidate) => candidate.bundleId === 'legacy');
    expect(legacy?.artifacts[0]?.installedFingerprint).toBe('');
    expect(legacy?.artifacts[0]?.installedFingerprint).not.toContain('c'.repeat(64));
  });

  it('never guesses a target for an entry that names none', async () => {
    const fs = new MemoryLockfileFs();
    fs.files.set('/repo/prompt-registry.lock.json', JSON.stringify(legacyLockfile));

    const records = await registryWith(fs).list();

    expect(records.map((candidate) => candidate.bundleId)).toStrictEqual(['legacy']);
  });

  it('ignores a lockfile whose schema version it cannot read', async () => {
    const fs = new MemoryLockfileFs();
    fs.files.set(
      '/repo/prompt-registry.lock.json',
      JSON.stringify({ ...legacyLockfile, version: '9.0.0' })
    );

    expect(await registryWith(fs).list()).toStrictEqual([]);
  });

  it('answers destination ownership for its own target and scope', async () => {
    const fs = new MemoryLockfileFs();
    const registry = registryWith(fs);
    await registry.put(record());

    const owned = await registry.queryDestinationOwnership({
      destinationPaths: ['/repo/.github/prompts/a.md'],
      target: 'copilot',
      scope: 'repository'
    });
    const otherTarget = await registry.queryDestinationOwnership({
      destinationPaths: ['/repo/.github/prompts/a.md'],
      target: 'kiro',
      scope: 'repository'
    });

    expect(owned[0]?.installationKey).toBe(deriveInstallationKey(identity));
    expect(otherTarget).toStrictEqual([]);
  });

  it('deletes a record by its derived key', async () => {
    const fs = new MemoryLockfileFs();
    const registry = registryWith(fs);
    await registry.put(record());

    await registry.delete(deriveInstallationKey(identity));

    expect(await registry.get(deriveInstallationKey(identity))).toBeNull();
  });

  it('stores claims outside the lockfile (NFR1.1.4)', async () => {
    const fs = new MemoryLockfileFs();
    const claims = claimStore();
    const registry = new RepositoryScopeInstallationRegistry({
      fs,
      repositoryPath: '/repo',
      repositoryIdentity: REPOSITORY_IDENTITY,
      commitMode: 'commit',
      claims
    });

    await registry.putClaim({
      claimId: 'c1',
      target: 'copilot',
      scope: 'repository',
      destinationPath: '/repo/.github/prompts/a.md',
      ownerInstallation: deriveInstallationKey(identity),
      generation: 1,
      state: 'pending-materialization',
      updatedAt: '2026-09-28T00:00:00.000Z'
    });

    expect(claims.claims.size).toBe(1);
    expect(fs.files.size).toBe(0);
  });
});
