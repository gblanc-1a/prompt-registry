/**
 * Tests for registry/user-scope-installation-registry.ts and
 * registry/handoff-coordinator.ts — record round-trips, the registry-wide
 * destination-ownership query, claim storage, and scope isolation
 * (BR3.1, BR3.4, BR3.6, NFR1.1.4).
 */
import {
  existsSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import type {
  AppStorage,
  DestinationOwnershipClaim,
  ManagedInstallation,
} from '@ai-primitives-hub/core';
import {
  deriveClaimKey,
  deriveInstallationKey,
} from '@ai-primitives-hub/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  XdgHandoffCoordinator,
} from '../../src/registry/handoff-coordinator';
import {
  lifecycleRoots,
  UserScopeInstallationRegistry,
} from '../../src/registry/user-scope-installation-registry';
import {
  createTempDir,
} from '../helpers/temp-dir';

const storageFor = (root: string): AppStorage => ({
  getPaths: () => ({
    root,
    config: join(root, 'config.json'),
    cache: join(root, 'cache'),
    sourcesCache: join(root, 'cache', 'sources'),
    bundlesCache: join(root, 'cache', 'bundles'),
    installed: join(root, 'installed'),
    userInstalled: join(root, 'installed', 'user'),
    profilesInstalled: join(root, 'installed', 'profiles'),
    profiles: join(root, 'profiles'),
    logs: join(root, 'logs')
  }),
  getState: async <T>(_key: string, defaultValue: T) => defaultValue,
  setState: async () => undefined
});

const identity = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;

const record = (overrides: Partial<ManagedInstallation> = {}): ManagedInstallation => ({
  ...identity,
  installationKey: deriveInstallationKey(identity),
  manifestVersion: '1.2.3',
  installedAt: '2026-09-28T00:00:00.000Z',
  artifacts: [{
    destinationPath: '/home/u/.copilot/prompts/a.md',
    itemKind: 'prompt',
    installedFingerprint: `sha256:${'a'.repeat(64)}`,
    sizeInBytes: 5
  }],
  ...overrides
});

describe('UserScopeInstallationRegistry', () => {
  let dir: string;
  let cleanup: () => void;
  let registry: UserScopeInstallationRegistry;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('user-registry-');
    registry = new UserScopeInstallationRegistry({ storage: storageFor(dir) });
  });

  afterEach(() => {
    cleanup();
  });

  it('round-trips a record and reports it in the listing', async () => {
    await registry.put(record());

    const read = await registry.get(deriveInstallationKey(identity));

    expect(read?.bundleId).toBe('acme');
    expect(read?.target).toBe('copilot');
    expect(read?.artifacts).toHaveLength(1);
    expect(await registry.list()).toHaveLength(1);
  });

  it('returns null for an unknown key and an empty list before any write', async () => {
    expect(await registry.get('missing')).toBeNull();
    expect(await registry.list()).toStrictEqual([]);
  });

  it('keeps records in shared application data, never in a repository', async () => {
    await registry.put(record());

    expect(existsSync(lifecycleRoots(storageFor(dir)).installations)).toBe(true);
    expect(existsSync(join(dir, 'prompt-registry.lock.json'))).toBe(false);
  });

  it('deletes a record', async () => {
    await registry.put(record());

    await registry.delete(deriveInstallationKey(identity));

    expect(await registry.get(deriveInstallationKey(identity))).toBeNull();
  });

  it('answers destination ownership within one target and scope only (BR2.3)', async () => {
    await registry.put(record());
    const otherTarget = { bundleId: 'other', target: 'kiro', scope: 'user' } as const;
    await registry.put(record({
      ...otherTarget,
      installationKey: deriveInstallationKey(otherTarget),
      artifacts: [{
        destinationPath: '/home/u/.copilot/prompts/a.md',
        itemKind: 'prompt',
        installedFingerprint: `sha256:${'b'.repeat(64)}`,
        sizeInBytes: 5
      }]
    }));

    const owners = await registry.queryDestinationOwnership({
      destinationPaths: ['/home/u/.copilot/prompts/a.md', '/home/u/.copilot/prompts/unowned.md'],
      target: 'copilot',
      scope: 'user'
    });

    expect(owners).toHaveLength(1);
    expect(owners[0]?.installationKey).toBe(deriveInstallationKey(identity));
  });

  it('reports a claimed but unrecorded destination as owned by the claim holder', async () => {
    const claim: DestinationOwnershipClaim = {
      claimId: 'c1',
      target: 'copilot',
      scope: 'user',
      destinationPath: '/home/u/.copilot/prompts/pending.md',
      ownerInstallation: 'pending-key',
      generation: 1,
      state: 'pending-materialization',
      updatedAt: '2026-09-28T00:00:00.000Z'
    };
    await registry.putClaim(claim);

    const owners = await registry.queryDestinationOwnership({
      destinationPaths: ['/home/u/.copilot/prompts/pending.md'],
      target: 'copilot',
      scope: 'user'
    });

    expect(owners[0]?.installationKey).toBe('pending-key');
    expect(owners[0]?.claim?.state).toBe('pending-materialization');
  });

  it('round-trips and releases a claim', async () => {
    const claim: DestinationOwnershipClaim = {
      claimId: 'c2',
      target: 'copilot',
      scope: 'user',
      destinationPath: '/home/u/.copilot/prompts/a.md',
      ownerInstallation: deriveInstallationKey(identity),
      generation: 3,
      state: 'finalized',
      updatedAt: '2026-09-28T00:00:00.000Z'
    };
    const key = deriveClaimKey('copilot', 'user', '/home/u/.copilot/prompts/a.md');

    await registry.putClaim(claim);
    const read = await registry.readClaim(key);
    await registry.deleteClaim(key);

    expect(read?.generation).toBe(3);
    expect(await registry.readClaim(key)).toBeNull();
  });

  it('re-keys a record and removes the old key in the same operation (BR6.5)', async () => {
    await registry.put(record());
    const newIdentity = {
      bundleId: 'acme',
      target: 'copilot',
      scope: 'repository',
      repositoryIdentity: { identityValue: 'github.com/acme/repo' }
    } as const;

    await registry.rekey({
      previousKey: deriveInstallationKey(identity),
      installation: {
        ...record(),
        ...newIdentity,
        installationKey: deriveInstallationKey(newIdentity)
      }
    });

    expect(await registry.get(deriveInstallationKey(identity))).toBeNull();
    const moved = await registry.get(deriveInstallationKey(newIdentity));
    expect(moved?.artifacts[0]?.installedFingerprint).toBe(`sha256:${'a'.repeat(64)}`);
  });
});

describe('XdgHandoffCoordinator', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('coordinator-');
  });

  afterEach(() => {
    cleanup();
  });

  it('persists, reads, and clears one in-flight hand-off', async () => {
    const coordinator = new XdgHandoffCoordinator({ storage: storageFor(dir) });
    const claimKey = deriveClaimKey('copilot', 'user', '/t/a.md');

    await coordinator.persist({
      operationId: 'op-1',
      claimKey,
      destinationPath: '/t/a.md',
      target: 'copilot',
      scope: 'user',
      acquiringInstallationKey: 'acquiring',
      cedingInstallationKey: 'ceding',
      claimGeneration: 2,
      phase: 'ceding-detached',
      updatedAt: '2026-09-28T00:00:00.000Z'
    });
    const read = await coordinator.read(claimKey);
    await coordinator.clear(claimKey);

    expect(read?.phase).toBe('ceding-detached');
    expect(read?.cedingInstallationKey).toBe('ceding');
    expect(await coordinator.read(claimKey)).toBeNull();
  });

  it('reports no record when no hand-off is in flight', async () => {
    const coordinator = new XdgHandoffCoordinator({ storage: storageFor(dir) });

    expect(await coordinator.read('nothing')).toBeNull();
  });
});
