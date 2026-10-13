import {
  sourceKey,
} from '@ai-primitives-hub/core';
import type {
  PortableSourceDescriptor,
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
  convertV2ToPair,
  migrateLockfileIfNeeded,
  planLockfileMigration,
  UNMANAGED_TARGET_KEY,
} from '../../src/stores/migrate-lockfile-v3';

const NOW = '2026-10-09T12:00:00.000Z';
const OPTS = { generatedBy: 'ai-primitives-hub-cli', now: NOW };

const userSources = {
  desiredFile: '/cfg/ai-primitives-hub/ai-primitives-hub.lock.json',
  localFile: '/cfg/ai-primitives-hub/ai-primitives-hub.local.lock.json',
  legacyFiles: [] as const
};

const v2WithOneBundle = () => ({
  $schema: 'https://example.com/lockfile.schema.json',
  version: '2.0.0',
  generatedAt: '2026-01-01T00:00:00.000Z',
  generatedBy: 'ai-primitives-hub-cli',
  bundles: {
    'web-dev': {
      version: '1.0.0',
      sourceId: 'github-abc123',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      checksum: 'a'.repeat(64),
      files: [{ path: 'prompts/hello.prompt.md', checksum: 'b'.repeat(64) }]
    }
  },
  sources: {
    'github-abc123': { type: 'github', url: 'https://github.com/owner/repo', branch: 'main' }
  }
});

const fakeFs = () => {
  const files = new Map<string, string>();
  const order: string[] = [];
  return {
    files,
    order,
    readFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error(`ENOENT ${p}`);
      }
      return v;
    },
    writeFile: async (p: string, c: string) => {
      files.set(p, c);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => undefined,
    remove: async (p: string) => {
      order.push(`delete:${p}`);
      files.delete(p);
    },
    rename: async (from: string, to: string) => {
      order.push(`write:${to}`);
      files.set(to, files.get(from) as string);
      files.delete(from);
    }
  };
};

const verifiedSource: PortableSourceDescriptor = {
  type: 'github',
  identity: {
    kind: 'github-releases',
    origin: 'https://github.com',
    repositoryId: '12345'
  },
  locator: 'https://github.com/acme/agents'
};
const verifiedLogicalKey = `${sourceKey(verifiedSource.identity, verifiedSource.type)}/reviewer`;
const legacyRuntimeKey = 'computer-specific/acme.reviewer@1.0.0';
const ARCHIVE_DIGEST = 'a'.repeat(64);
const FILE_DIGEST = 'b'.repeat(64);
const INSTALLED_DIGEST = 'c'.repeat(64);
const verifiedIdentityEvidence = [{
  legacyKey: legacyRuntimeKey,
  proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
}];

const branchEraV3Pair = () => ({
  desired: {
    version: '3.0.0',
    generatedAt: NOW,
    generatedBy: OPTS.generatedBy,
    migration: { lockfileV3: 'complete' },
    bundles: {
      [legacyRuntimeKey]: {
        version: '1.0.0',
        sourceId: 'computer-specific',
        archiveSha: ARCHIVE_DIGEST
      }
    },
    sources: {
      'computer-specific': {
        type: 'github',
        url: 'https://github.com/acme/agents',
        branch: 'main'
      }
    },
    hubs: { shared: { name: 'Shared', url: 'https://example.com/hub.yml' } },
    profiles: { defaults: { name: 'Defaults', bundleIds: [legacyRuntimeKey] } }
  },
  local: {
    version: '3.0.0',
    generatedAt: NOW,
    generatedBy: OPTS.generatedBy,
    migration: { lockfileV3: 'complete' },
    targets: {
      'cursor-user': {
        targetType: 'cursor',
        scope: 'user',
        baseDir: '/home/user/.cursor',
        bundles: {
          [legacyRuntimeKey]: {
            version: '1.0.0',
            sourceId: 'computer-specific',
            installedAt: NOW,
            commitMode: 'local-only',
            files: [{
              path: 'agents/reviewer.md',
              checksum: FILE_DIGEST,
              installedChecksum: INSTALLED_DIGEST
            }],
            mcpConfigPath: '.copilot/mcp-config.json',
            mcpServers: ['reviewer-mcp']
          }
        }
      }
    }
  }
});

describe('convertV2ToPair', () => {
  it('retains unverified legacy refs instead of creating portable source IDs from old URLs', () => {
    const v2: Lockfile = v2WithOneBundle();
    v2.bundles['web-dev'].sourceId = 'constructor';
    v2.sources = {};
    const { pair, report } = convertV2ToPair(v2, OPTS);
    expect(report.unmanaged).toHaveLength(1);
    expect(pair.desired.sources).toEqual({});
    expect(pair.desired.bundles).toEqual({});
    expect(pair.desired.unresolved?.[0]).toMatchObject({
      originalKey: 'web-dev',
      sourceRef: 'constructor',
      version: '1.0.0'
    });
  });
  it('splits one v2 file into the two role halves', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(pair.desired.version).toBe('3.0.0');
    expect(pair.local.version).toBe('3.0.0');
    expect('targets' in pair.desired).toBe(false);
    expect('bundles' in pair.local).toBe(false);
  });

  it('does not project malformed legacy file checksums into strict v3 materializations', () => {
    const legacy = v2WithOneBundle();
    legacy.bundles['web-dev'].files[0].checksum = 'archivehash';

    const { pair } = convertV2ToPair(legacy, OPTS);
    const [record] = Object.values(pair.local.targets[UNMANAGED_TARGET_KEY].bundles);

    expect(pair.desired.unresolved).toHaveLength(1);
    expect(record.files).toEqual([{ path: 'prompts/hello.prompt.md' }]);
  });

  it('preserves original desired intent as unresolved when source and manifest proof are absent', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(pair.desired.bundles).toEqual({});
    expect(pair.desired.sources).toEqual({});
    expect(pair.desired.unresolved).toHaveLength(1);
    expect(pair.desired.unresolved?.[0]).toMatchObject({
      originalKey: 'web-dev',
      sourceRef: 'github-abc123',
      version: '1.0.0',
      knownResolution: {
        kind: 'unpinned',
        evidence: { knownDigests: { archiveSha256: 'a'.repeat(64) } }
      }
    });
  });

  it('uses deterministic reserved keys for unproven materializations', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);
    const materializations = pair.local.targets[UNMANAGED_TARGET_KEY].bundles;

    expect(Object.keys(pair.desired.bundles)).toEqual([]);
    expect(Object.keys(materializations)).toHaveLength(1);
    expect(Object.keys(materializations)[0]).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    expect(materializations[Object.keys(materializations)[0]]).toMatchObject({
      state: 'unmanaged',
      legacy: { originalKey: 'web-dev', sourceRef: 'github-abc123' }
    });
  });

  it('preserves recorded file hashes without pretending they are installed-byte baselines', () => {
    const { pair, report } = convertV2ToPair(v2WithOneBundle(), OPTS);
    const [key] = Object.keys(pair.local.targets[UNMANAGED_TARGET_KEY].bundles);
    const record = pair.local.targets[UNMANAGED_TARGET_KEY].bundles[key];

    expect(report.unmanaged).toHaveLength(1);
    expect(report.unmanaged[0].key).toBe(key);
    expect(record.files.map((entry) => entry.path)).toEqual(['prompts/hello.prompt.md']);
    const file = record.files[0];
    expect(file.checksum).toBe('b'.repeat(64));
    expect(file.installedChecksum).toBeUndefined();
  });

  it('carries commitMode when present (§8.3)', () => {
    const v2 = v2WithOneBundle();
    v2.bundles['web-dev'].commitMode = 'local-only';

    const { pair } = convertV2ToPair(v2, OPTS);

    const [key] = Object.keys(pair.local.targets[UNMANAGED_TARGET_KEY].bundles);
    expect(pair.local.targets[UNMANAGED_TARGET_KEY].bundles[key].commitMode).toBe('local-only');
  });

  it('marks a bundle whose source descriptor is missing as unmanaged for that reason', () => {
    const broken = { ...v2WithOneBundle(), sources: {} };

    const { report } = convertV2ToPair(broken, OPTS);

    expect(report.unmanaged[0].reason).toContain('verified');
  });

  it('omits only a proven triggering bundle from materialization', () => {
    const portableKey = `${sourceKey(verifiedSource.identity, verifiedSource.type)}/web-dev`;
    const { pair, report } = convertV2ToPair(v2WithOneBundle(), {
      ...OPTS,
      triggeredByKey: portableKey,
      identityEvidence: [{
        legacyKey: 'web-dev',
        sourceId: 'github-abc123',
        version: '1.0.0',
        proven: { source: verifiedSource, logicalBundleId: 'web-dev' }
      }]
    });

    expect(report.unmanaged).toEqual([]);
    expect(report.migrated).toEqual([portableKey]);
    expect(pair.local.targets[UNMANAGED_TARGET_KEY]).toBeUndefined();
    expect(pair.desired.bundles[portableKey]).toBeDefined();
  });

  it('carries hubs and profiles into the desired half untouched', () => {
    const v2 = {
      ...v2WithOneBundle(),
      hubs: { h: { name: 'Hub', url: 'https://example.com/hub.yml' } },
      profiles: { p: { name: 'P', bundleIds: ['web-dev'] } }
    };

    const { pair } = convertV2ToPair(v2, OPTS);

    expect(pair.desired.hubs).toEqual(v2.hubs);
    expect(pair.desired.profiles).toEqual(v2.profiles);
  });

  it('converts an empty v2 file into an empty pair', () => {
    const v2 = { ...v2WithOneBundle(), bundles: {}, sources: {} };

    const { pair, report } = convertV2ToPair(v2, OPTS);

    expect(pair.desired.bundles).toEqual({});
    expect(pair.local.targets).toEqual({});
    expect(report).toEqual({ migrated: [], unmanaged: [] });
  });

  it('produces identical bytes for identical input — no wall-clock in the desired half', () => {
    const first = convertV2ToPair(v2WithOneBundle(), OPTS);
    const second = convertV2ToPair(v2WithOneBundle(), {
      ...OPTS, now: '2027-05-05T05:05:05.000Z'
    });

    expect(JSON.stringify(first.pair.desired)).toBe(JSON.stringify(second.pair.desired));
    expect(first.pair.local.generatedAt).not.toBe(second.pair.local.generatedAt);
  });
});

describe('migrateLockfileIfNeeded', () => {
  it.each([
    { label: 'v4', content: JSON.stringify({ version: '4.0.0', targets: { valuable: {} } }), error: 'UnsupportedLockfileVersionError' },
    { label: 'missing version', content: JSON.stringify({ targets: {} }), error: 'UnsupportedLockfileVersionError' },
    { label: 'v2 local half', content: JSON.stringify({ version: '2.0.0', bundles: {} }), error: 'LockfileGenerationMismatchError' },
    { label: 'malformed JSON', content: '{', error: 'SyntaxError' }
  ])('refuses an existing $label local half before any migration write', async ({ content, error }) => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    fs.files.set(userSources.localFile, content);
    const before = [...fs.files];

    await expect(migrateLockfileIfNeeded(userSources, fs, OPTS)).rejects.toMatchObject({ name: error });
    expect([...fs.files]).toEqual(before);
    expect(fs.order).toEqual([]);
  });
  it('returns a local-only v3 pair (no desired, no legacy) as it stands, with a null report and no write', async () => {
    const fs = fakeFs();
    const activeSourceKey = sourceKey(verifiedSource.identity, verifiedSource.type);
    const local = {
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        'my-vscode': {
          baseDir: '/home/u/.copilot',
          bundles: {
            [verifiedLogicalKey]: {
              version: '1.0.0',
              sourceKey: activeSourceKey,
              resolution: { kind: 'unpinned', reason: 'not pinned' },
              installedAt: '2026-10-09T12:00:00.000Z',
              files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'c'.repeat(64) }]
            }
          }
        }
      }
    };
    fs.files.set(userSources.localFile, JSON.stringify(local));
    const before = [...fs.files.entries()];

    const { pair, report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(report).toBeNull();
    expect(pair.local).toEqual(local);
    expect(pair.desired.bundles).toEqual({});
    expect([...fs.files.entries()]).toEqual(before);
    expect(fs.order).toEqual([]);
  });

  it('returns an empty pair when nothing exists, writing nothing', async () => {
    const fs = fakeFs();

    const { pair, report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(pair.desired.version).toBe('3.0.0');
    expect(report).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('migrates a v2 file in place on the first call', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));

    const { report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(report?.unmanaged).toHaveLength(1);
    expect(report?.unmanaged[0].key).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    expect(JSON.parse(fs.files.get(userSources.desiredFile) as string).version).toBe('3.0.0');
    expect(JSON.parse(fs.files.get(userSources.desiredFile) as string).unresolved[0].originalKey)
      .toBe('web-dev');
    expect(JSON.parse(fs.files.get(userSources.localFile) as string).version).toBe('3.0.0');
  });

  it('follows §8.4 order: local, desired, legacy deletions, then the marker', async () => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json', '/work/prompt-registry.local.lock.json']
    };
    fs.files.set('/work/prompt-registry.lock.json', JSON.stringify(v2WithOneBundle()));

    await migrateLockfileIfNeeded(repoSources, fs, OPTS);

    expect(fs.order).toEqual([
      'write:/work/ai-primitives-hub.local.lock.json',
      'write:/work/ai-primitives-hub.lock.json',
      'delete:/work/prompt-registry.lock.json',
      'write:/work/ai-primitives-hub.local.lock.json'
    ]);
  });

  it('writes the completion marker only after the legacy files are gone', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));

    await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(JSON.parse(fs.files.get(userSources.localFile) as string).migration)
      .toEqual({ lockfileV3: 'complete' });
  });

  it('is a no-op on the second call (Review Focus 5: converges)', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    await migrateLockfileIfNeeded(userSources, fs, OPTS);
    const afterFirst = [fs.files.get(userSources.desiredFile), fs.files.get(userSources.localFile)];

    const { report } = await migrateLockfileIfNeeded(userSources, fs, {
      ...OPTS, now: '2026-12-31T00:00:00.000Z'
    });

    expect(report).toBeNull();
    expect([fs.files.get(userSources.desiredFile), fs.files.get(userSources.localFile)])
      .toEqual(afterFirst);
  });

  it('preserves already-portable materializations while retaining unrelated v2 rows', async () => {
    const fs = fakeFs();
    const v2 = v2WithOneBundle();
    v2.bundles['other-bundle'] = {
      version: '2.0.0',
      sourceId: 'github-abc123',
      sourceType: 'github',
      installedAt: '2026-02-01T00:00:00.000Z',
      checksum: 'd'.repeat(64),
      files: [{ path: 'other.md', checksum: 'e'.repeat(64) }]
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(v2));

    const activeSourceKey = sourceKey(verifiedSource.identity, verifiedSource.type);
    const partialLocal = {
      version: '3.0.0',
      generatedAt: OPTS.now,
      generatedBy: OPTS.generatedBy,
      targets: {
        'real-target': {
          targetType: 'cursor',
          scope: 'user',
          baseDir: '/real/path',
          bundles: {
            [verifiedLogicalKey]: {
              version: '1.0.0',
              sourceKey: activeSourceKey,
              resolution: { kind: 'unpinned', reason: 'existing verified identity' },
              installedAt: '2026-01-01T00:00:00.000Z',
              files: [{
                path: 'hello.prompt.md',
                checksum: 'f'.repeat(64),
                installedChecksum: '1'.repeat(64)
              }]
            }
          }
        }
      }
    };
    fs.files.set(userSources.localFile, JSON.stringify(partialLocal));

    const { pair } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(pair.local.targets['real-target'].bundles[verifiedLogicalKey].files[0].installedChecksum)
      .toBe('1'.repeat(64));
    expect(Object.keys(pair.local.targets[UNMANAGED_TARGET_KEY].bundles)).toHaveLength(2);
    expect(pair.desired.unresolved?.map((intent) => intent.originalKey))
      .toEqual(['other-bundle', 'web-dev']);
    expect(JSON.parse(fs.files.get(userSources.localFile) as string).migration)
      .toEqual({ lockfileV3: 'complete' });
  });

  it('leaves the v2 file intact when the local write fails', async () => {
    const fs = fakeFs();
    const original = JSON.stringify(v2WithOneBundle());
    fs.files.set(userSources.desiredFile, original);
    fs.rename = async () => {
      throw new Error('disk full');
    };

    await expect(migrateLockfileIfNeeded(userSources, fs, OPTS)).rejects.toThrow('disk full');
    expect(fs.files.get(userSources.desiredFile)).toBe(original);
  });

  it('returns the existing pair untouched when already v3', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    await migrateLockfileIfNeeded(userSources, fs, OPTS);
    const before = fs.files.get(userSources.desiredFile);

    const { report } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(report).toBeNull();
    expect(fs.files.get(userSources.desiredFile)).toBe(before);
  });

  it('refuses an unknown major instead of migrating it', async () => {
    const fs = fakeFs();
    fs.files.set(userSources.desiredFile, JSON.stringify({ version: '9.0.0' }));

    await expect(migrateLockfileIfNeeded(userSources, fs, OPTS))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });

  it('leaves the marker unwritten when a legacy deletion fails', async () => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json']
    };
    fs.files.set('/work/prompt-registry.lock.json', JSON.stringify(v2WithOneBundle()));
    let deleteAttempted = false;
    fs.remove = async (_p: string) => {
      deleteAttempted = true;
      throw new Error('permission denied');
    };

    await expect(migrateLockfileIfNeeded(repoSources, fs, OPTS))
      .rejects.toThrow('permission denied');
    expect(deleteAttempted).toBe(true);
    // Local file was written in step 3, but without the marker.
    const local = JSON.parse(fs.files.get(repoSources.localFile) as string);
    expect(local.migration).toBeUndefined();
  });

  it('fails when legacyFiles is non-empty but fs.remove is missing', async () => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json']
    };
    fs.files.set('/work/prompt-registry.lock.json', JSON.stringify(v2WithOneBundle()));
    delete (fs as { remove?: unknown }).remove;

    await expect(migrateLockfileIfNeeded(repoSources, fs, OPTS))
      .rejects.toThrow(/fs\.remove is required/);
  });
});

describe('planLockfileMigration', () => {
  it('computes the migrated pair and report for a v2 file without writing or deleting anything', async () => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json']
    };
    fs.files.set('/work/prompt-registry.lock.json', JSON.stringify(v2WithOneBundle()));
    const before = [...fs.files.entries()];

    const plan = await planLockfileMigration(repoSources, fs, OPTS);

    expect(plan.pendingWrite).toBe(true);
    expect(plan.report?.unmanaged).toHaveLength(1);
    expect(plan.report?.unmanaged[0].key).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    expect(Object.keys(plan.pair.desired.bundles)).toEqual([]);
    expect(plan.pair.desired.unresolved?.[0].originalKey).toBe('web-dev');
    expect([...fs.files.entries()]).toEqual(before);
    expect(fs.order).toEqual([]);
  });

  it('reports nothing pending for an absent store and for a v3 pair', async () => {
    const fs = fakeFs();
    expect((await planLockfileMigration(userSources, fs, OPTS)).pendingWrite).toBe(false);
    fs.files.set(userSources.desiredFile, JSON.stringify(v2WithOneBundle()));
    await migrateLockfileIfNeeded(userSources, fs, OPTS);

    const plan = await planLockfileMigration(userSources, fs, OPTS);

    expect(plan).toMatchObject({ pendingWrite: false, report: null });
  });
});

describe('offline portable identity migration', () => {
  it('unions remaining legacy intent with an already-written desired generation', async () => {
    const fs = fakeFs();
    const oldLockfilePath = '/work/prompt-registry.lock.json';
    const oldLocalLockfilePath = '/work/prompt-registry.local.lock.json';
    const sourceId = sourceKey(verifiedSource.identity, verifiedSource.type);
    const currentDesired = {
      version: '3.0.0',
      bundles: {
        [verifiedLogicalKey]: {
          version: '9.0.0',
          sourceKey: sourceId,
          resolution: { kind: 'unpinned', reason: 'verified newer intent' }
        }
      },
      sources: { [sourceId]: verifiedSource }
    };
    const oldLocalLockfile = v2WithOneBundle();
    oldLocalLockfile.bundles = {
      'local-only': {
        ...oldLocalLockfile.bundles['web-dev'],
        installedAt: '2026-03-01T00:00:00.000Z'
      }
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(currentDesired));
    fs.files.set(oldLockfilePath, JSON.stringify(v2WithOneBundle()));
    fs.files.set(oldLocalLockfilePath, JSON.stringify(oldLocalLockfile));

    const plan = await planLockfileMigration({
      ...userSources,
      legacyFiles: [oldLockfilePath, oldLocalLockfilePath]
    }, fs, OPTS);

    expect(plan.pendingWrite).toBe(true);
    expect(plan.pair.desired.bundles[verifiedLogicalKey].version).toBe('9.0.0');
    expect(plan.pair.desired.unresolved).toEqual([
      expect.objectContaining({ originalKey: 'web-dev', version: '1.0.0' })
    ]);
  });

  it('retains conflicting baselines as separate complete materializations', async () => {
    const fs = fakeFs();
    const repoSources = {
      ...userSources,
      legacyFiles: ['/work/older-local.lock.json']
    };
    const branchPair = branchEraV3Pair();
    const firstLocal = branchPair.local;
    const secondLocal = structuredClone(branchPair.local);
    const secondRecord = secondLocal.targets['cursor-user'].bundles[legacyRuntimeKey];
    secondRecord.files = [{
      path: 'agents/reviewer.md',
      checksum: 'd'.repeat(64),
      installedChecksum: 'e'.repeat(64)
    }];
    fs.files.set(repoSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(repoSources.localFile, JSON.stringify(firstLocal));
    fs.files.set(repoSources.legacyFiles[0], JSON.stringify(secondLocal));

    const plan = await planLockfileMigration(repoSources, fs, {
      ...OPTS,
      identityEvidence: [{
        legacyKey: legacyRuntimeKey,
        version: '1.0.0',
        sourceId: 'computer-specific',
        proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
      }]
    });

    const retained = Object.entries(plan.pair.local.targets['cursor-user'].bundles)
      .filter(([key]) => key.startsWith('unresolved/'));
    expect(retained).toHaveLength(2);
    expect(retained.map(([, record]) => record.files[0].checksum).toSorted())
      .toEqual([FILE_DIGEST, 'd'.repeat(64)].toSorted());
    expect(retained.map(([, record]) => record.files[0].installedChecksum).toSorted())
      .toEqual([INSTALLED_DIGEST, 'e'.repeat(64)].toSorted());
  });

  it('preserves the local historical pin when it disagrees with desired intent', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    const desiredPin = {
      kind: 'pinned' as const,
      provider: 'github-release' as const,
      version: '1.0.0',
      releaseId: '1',
      assetId: '11',
      archiveSha256: ARCHIVE_DIGEST
    };
    const localPin = {
      ...desiredPin,
      releaseId: '3',
      assetId: '33',
      archiveSha256: 'd'.repeat(64)
    };
    branchPair.desired.bundles[legacyRuntimeKey].resolution = desiredPin;
    branchPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].resolution = localPin;
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, {
      ...OPTS,
      identityEvidence: [{
        legacyKey: legacyRuntimeKey,
        version: '1.0.0',
        sourceId: 'computer-specific',
        proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
      }]
    });

    expect(plan.pair.desired.unresolved).toEqual([
      expect.objectContaining({ originalKey: legacyRuntimeKey, knownResolution: desiredPin })
    ]);
    const localRecord = Object.values(plan.pair.local.targets['cursor-user'].bundles)
      .find((record) => record.files.some((file) => file.path === 'agents/reviewer.md'));
    expect(localRecord?.state).toBe('unmanaged');
    expect(localRecord?.legacy?.knownResolution).toEqual(localPin);
  });

  it('downgrades noncanonical legacy pins to strict evidence without losing their digest', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    branchPair.desired.bundles[legacyRuntimeKey].resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: 'release-123',
      assetId: 'asset-456',
      archiveSha256: `sha256:${ARCHIVE_DIGEST}`,
      legacyMetadata: 'branch-era'
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const result = await migrateLockfileIfNeeded(userSources, fs, {
      ...OPTS,
      identityEvidence: verifiedIdentityEvidence
    });

    expect(result.pair.desired.bundles[verifiedLogicalKey].resolution).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownPins: {
          provider: 'github-release',
          releaseId: 'release-123',
          assetId: 'asset-456'
        },
        knownDigests: { archiveSha256: ARCHIVE_DIGEST }
      }
    });
  });

  it('rekeys branch-era v3 state using supplied proof and preserves ownership and known evidence', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, {
      ...OPTS,
      identityEvidence: verifiedIdentityEvidence
    });

    expect(plan.pendingWrite).toBe(true);
    expect(plan.pair.desired.bundles[verifiedLogicalKey]).toEqual({
      version: '1.0.0',
      sourceKey: sourceKey(verifiedSource.identity, verifiedSource.type),
      resolution: {
        kind: 'unpinned',
        reason: expect.any(String),
        evidence: { knownDigests: { archiveSha256: ARCHIVE_DIGEST } }
      }
    });
    expect(plan.pair.desired.sources[sourceKey(verifiedSource.identity, verifiedSource.type)])
      .toEqual(verifiedSource);
    expect(plan.pair.desired.hubs).toEqual(branchPair.desired.hubs);
    expect(plan.pair.desired.profiles).toEqual(branchPair.desired.profiles);
    const record = plan.pair.local.targets['cursor-user'].bundles[verifiedLogicalKey];
    expect(record).toMatchObject({
      version: '1.0.0',
      sourceKey: sourceKey(verifiedSource.identity, verifiedSource.type),
      commitMode: 'local-only',
      mcpConfigPath: '.copilot/mcp-config.json',
      mcpServers: ['reviewer-mcp'],
      files: [{
        path: 'agents/reviewer.md',
        checksum: FILE_DIGEST,
        installedChecksum: INSTALLED_DIGEST
      }],
      legacy: {
        originalKey: legacyRuntimeKey,
        portableDescriptor: verifiedSource
      }
    });
    expect(JSON.stringify(record.legacy)).toContain('computer-specific');
    expect(fs.order).toEqual([]);
  });

  it('ignores stale old-generation ownership after amended v3 completion', async () => {
    const fs = fakeFs();
    const oldLockfilePath = '/work/prompt-registry.lock.json';
    const sourceId = sourceKey(verifiedSource.identity, verifiedSource.type);
    const desired = {
      version: '3.0.0',
      bundles: {
        [verifiedLogicalKey]: {
          version: '1.0.0',
          sourceKey: sourceId,
          resolution: { kind: 'unpinned', reason: 'already converted' }
        }
      },
      sources: { [sourceId]: verifiedSource }
    };
    const local = {
      version: '3.0.0',
      generatedAt: NOW,
      generatedBy: OPTS.generatedBy,
      migration: { lockfileV3: 'complete' },
      targets: {}
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(desired));
    fs.files.set(userSources.localFile, JSON.stringify(local));
    fs.files.set(oldLockfilePath, JSON.stringify(v2WithOneBundle()));

    const plan = await planLockfileMigration({
      ...userSources,
      legacyFiles: [oldLockfilePath]
    }, fs, OPTS);

    expect(plan.pendingWrite).toBe(true);
    expect(plan.pair.desired.bundles[verifiedLogicalKey]).toEqual(desired.bundles[verifiedLogicalKey]);
    expect(plan.pair.desired.unresolved).toBeUndefined();
    expect(Object.values(plan.pair.local.targets).flatMap((target) => Object.values(target.bundles)))
      .toEqual([]);
  });

  it('preserves digests embedded only in a partial historical resolution', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    const entry = branchPair.desired.bundles[legacyRuntimeKey] as {
      archiveSha?: string;
      resolution?: unknown;
    };
    delete entry.archiveSha;
    entry.resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '7',
      assetId: '77',
      archiveSha256: '3'.repeat(64),
      sourceContentSha256: '4'.repeat(64),
      manifestSha256: '5'.repeat(64)
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);

    expect(plan.pair.desired.unresolved?.[0].knownResolution).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownDigests: {
          archiveSha256: '3'.repeat(64),
          sourceContentSha256: '4'.repeat(64),
          manifestSha256: '5'.repeat(64)
        }
      }
    });
  });

  it('unions embedded content digests with an independently known outer archive digest', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    branchPair.desired.bundles[legacyRuntimeKey].resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '7',
      assetId: '77',
      sourceContentSha256: '4'.repeat(64),
      manifestSha256: '5'.repeat(64)
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);

    expect(plan.pair.desired.unresolved?.[0].knownResolution).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownDigests: {
          archiveSha256: ARCHIVE_DIGEST,
          sourceContentSha256: '4'.repeat(64),
          manifestSha256: '5'.repeat(64)
        }
      }
    });
  });

  it('retains both hashes when embedded and outer archive digests conflict', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    const embeddedArchiveDigest = 'd'.repeat(64);
    branchPair.desired.bundles[legacyRuntimeKey].resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '7',
      assetId: '77',
      archiveSha256: embeddedArchiveDigest
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);
    const evidence = plan.pair.desired.unresolved?.[0].knownResolution;

    expect(evidence).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownPins: {
          conflictingArchiveSha256Embedded: embeddedArchiveDigest,
          conflictingArchiveSha256Outer: ARCHIVE_DIGEST
        }
      }
    });
    expect(evidence?.kind === 'unpinned' ? evidence.evidence?.knownDigests?.archiveSha256 : undefined)
      .toBeUndefined();
  });

  it('normalizes every historical digest alias before retaining conflicts', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    const entry = branchPair.desired.bundles[legacyRuntimeKey] as Record<string, unknown>;
    entry.archiveSha256 = 'malformed-archive-sha256';
    entry.archiveSha = 'a'.repeat(64);
    entry.checksum = 'b'.repeat(64);
    entry.sourceContentSha256 = 'c'.repeat(64);
    entry.manifestSha256 = 'd'.repeat(64);
    entry.resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '7',
      assetId: '77',
      archiveSha256: 'e'.repeat(64),
      archiveSha: 'f'.repeat(64),
      checksum: '0'.repeat(64),
      sourceContentSha256: 'malformed-source-content-sha256',
      manifestSha256: 'malformed-manifest-sha256',
      evidence: {
        knownDigests: {
          archiveSha256: '1'.repeat(64),
          archiveSha: '2'.repeat(64),
          checksum: '3'.repeat(64),
          sourceContentSha256: '4'.repeat(64),
          manifestSha256: '5'.repeat(64)
        }
      }
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);
    const evidence = plan.pair.desired.unresolved?.[0].knownResolution;

    expect(evidence).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownPins: {
          conflictingArchiveSha256OuterLegacyArchive: 'a'.repeat(64),
          conflictingArchiveSha256OuterChecksum: 'b'.repeat(64),
          conflictingArchiveSha256Embedded: 'e'.repeat(64),
          conflictingArchiveSha256EmbeddedLegacyArchive: 'f'.repeat(64),
          conflictingArchiveSha256EmbeddedChecksum: '0'.repeat(64),
          conflictingArchiveSha256Evidence: '1'.repeat(64),
          conflictingArchiveSha256EvidenceLegacyArchive: '2'.repeat(64),
          conflictingArchiveSha256EvidenceChecksum: '3'.repeat(64),
          conflictingSourceContentSha256Outer: 'c'.repeat(64),
          conflictingSourceContentSha256Evidence: '4'.repeat(64),
          conflictingManifestSha256Outer: 'd'.repeat(64),
          conflictingManifestSha256Evidence: '5'.repeat(64)
        }
      }
    });
    expect(evidence?.kind === 'unpinned' ? evidence.evidence?.knownDigests : undefined).toBeUndefined();
  });

  it('retains independently known outer digests beside a partial resolution', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    branchPair.desired.bundles[legacyRuntimeKey].resolution = {
      kind: 'pinned',
      provider: 'github-release',
      version: '1.0.0',
      releaseId: '7',
      assetId: '77'
    };
    branchPair.desired.bundles[legacyRuntimeKey].sourceContentSha256 = '1'.repeat(64);
    branchPair.desired.bundles[legacyRuntimeKey].manifestSha256 = '2'.repeat(64);
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);

    expect(plan.pair.desired.unresolved?.[0].knownResolution).toMatchObject({
      kind: 'unpinned',
      evidence: {
        knownPins: {
          provider: 'github-release',
          releaseId: '7',
          assetId: '77'
        },
        knownDigests: {
          archiveSha256: ARCHIVE_DIGEST,
          sourceContentSha256: '1'.repeat(64),
          manifestSha256: '2'.repeat(64)
        }
      }
    });
  });

  it('retains incompatible MCP destinations under separate local keys', async () => {
    const fs = fakeFs();
    const repoSources = {
      ...userSources,
      legacyFiles: ['/work/older-local.lock.json']
    };
    const branchPair = branchEraV3Pair();
    const secondLocal = structuredClone(branchPair.local);
    const secondRecord = secondLocal.targets['cursor-user'].bundles[legacyRuntimeKey];
    secondRecord.mcpConfigPath = '.config/second-mcp.json';
    secondRecord.mcpServers = ['second-server'];
    branchPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].mcpConfigPath = '.config/first-mcp.json';
    branchPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].mcpServers = ['first-server'];
    fs.files.set(repoSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(repoSources.localFile, JSON.stringify(branchPair.local));
    fs.files.set(repoSources.legacyFiles[0], JSON.stringify(secondLocal));

    const plan = await planLockfileMigration(repoSources, fs, {
      ...OPTS,
      identityEvidence: [{
        legacyKey: legacyRuntimeKey,
        version: '1.0.0',
        sourceId: 'computer-specific',
        proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
      }]
    });

    const retained = Object.entries(plan.pair.local.targets['cursor-user'].bundles)
      .filter(([key]) => key.startsWith('unresolved/'));
    expect(retained).toHaveLength(2);
    expect(retained.map(([, record]) => record.mcpConfigPath).toSorted())
      .toEqual(['.config/first-mcp.json', '.config/second-mcp.json']);
    expect(retained.map(([, record]) => record.mcpServers?.[0]).toSorted())
      .toEqual(['first-server', 'second-server']);
  });

  it('retains legacy MCP ownership separately when it conflicts with an existing portable destination', async () => {
    const fs = fakeFs();
    const repoSources = {
      ...userSources,
      legacyFiles: ['/work/older-local.lock.json']
    };
    const sourceId = sourceKey(verifiedSource.identity, verifiedSource.type);
    const resolution = {
      kind: 'pinned' as const,
      provider: 'github-release' as const,
      version: '1.0.0',
      releaseId: '7',
      assetId: '77',
      archiveSha256: ARCHIVE_DIGEST
    };
    const currentDesired = {
      version: '3.0.0',
      bundles: {
        [verifiedLogicalKey]: { version: '1.0.0', sourceKey: sourceId, resolution }
      },
      sources: { [sourceId]: verifiedSource }
    };
    const currentLocal = {
      version: '3.0.0',
      generatedAt: NOW,
      generatedBy: OPTS.generatedBy,
      targets: {
        'cursor-user': {
          targetType: 'cursor',
          scope: 'user',
          baseDir: '/home/user/.cursor',
          bundles: {
            [verifiedLogicalKey]: {
              version: '1.0.0',
              sourceKey: sourceId,
              resolution,
              installedAt: NOW,
              files: [{
                path: 'agents/reviewer.md',
                checksum: FILE_DIGEST,
                installedChecksum: INSTALLED_DIGEST
              }],
              mcpConfigPath: '.copilot/mcp-config.json',
              mcpServers: ['portable-server']
            }
          }
        }
      }
    };
    const legacyPair = branchEraV3Pair();
    legacyPair.desired.bundles[legacyRuntimeKey].resolution = resolution;
    legacyPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].resolution = resolution;
    legacyPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].mcpConfigPath = '.config/legacy-mcp.json';
    legacyPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].mcpServers = ['legacy-server'];
    fs.files.set(repoSources.desiredFile, JSON.stringify(currentDesired));
    fs.files.set(repoSources.localFile, JSON.stringify(currentLocal));
    fs.files.set(repoSources.legacyFiles[0], JSON.stringify(legacyPair.local));

    const plan = await planLockfileMigration(repoSources, fs, {
      ...OPTS,
      identityEvidence: [{
        legacyKey: legacyRuntimeKey,
        version: '1.0.0',
        sourceId: 'computer-specific',
        proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
      }]
    });

    const target = plan.pair.local.targets['cursor-user'].bundles;
    const retained = Object.entries(target).filter(([key]) => key.startsWith('unresolved/'));
    expect(target[verifiedLogicalKey].mcpConfigPath).toBe('.copilot/mcp-config.json');
    expect(retained).toHaveLength(1);
    expect(retained[0][1]).toMatchObject({
      state: 'unmanaged',
      mcpConfigPath: '.config/legacy-mcp.json',
      mcpServers: ['legacy-server']
    });
  });

  it('removes temporary mappings but retains permanent unmanaged evidence', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    branchPair.local.targets['cursor-user'].bundles[legacyRuntimeKey].files = [{
      path: 'agents/reviewer.md',
      checksum: FILE_DIGEST
    }];
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const migrated = await migrateLockfileIfNeeded(userSources, fs, {
      ...OPTS,
      identityEvidence: [{
        legacyKey: legacyRuntimeKey,
        version: '1.0.0',
        sourceId: 'computer-specific',
        proven: { source: verifiedSource, logicalBundleId: 'reviewer' }
      }]
    });
    const record = migrated.pair.local.targets['cursor-user'].bundles[verifiedLogicalKey];
    const resumed = await planLockfileMigration(userSources, fs, OPTS);

    expect(record.state).toBe('unmanaged');
    expect(record.legacy?.originalKey).toBe(legacyRuntimeKey);
    expect(record.legacy?.portableDescriptor).toBeUndefined();
    expect(resumed.pendingWrite).toBe(false);
  });

  it('retains unproven old-v3 identity and complete materialization without publishing fake sources', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));

    const plan = await planLockfileMigration(userSources, fs, OPTS);

    expect(plan.pendingWrite).toBe(true);
    expect(plan.pair.desired.bundles).toEqual({});
    expect(plan.pair.desired.sources).toEqual({});
    expect(plan.pair.desired.unresolved).toHaveLength(1);
    expect(plan.pair.desired.unresolved?.[0]).toMatchObject({
      originalKey: legacyRuntimeKey,
      sourceRef: 'computer-specific',
      version: '1.0.0'
    });
    const unresolvedKey = Object.keys(plan.pair.local.targets['cursor-user'].bundles)[0];
    expect(unresolvedKey).toMatch(/^unresolved\/[a-f0-9]{64}$/);
    expect(plan.pair.local.targets['cursor-user'].bundles[unresolvedKey]).toMatchObject({
      state: 'unmanaged',
      files: [{
        path: 'agents/reviewer.md',
        checksum: FILE_DIGEST,
        installedChecksum: INSTALLED_DIGEST
      }],
      mcpConfigPath: '.copilot/mcp-config.json',
      mcpServers: ['reviewer-mcp']
    });
    const sharedEvidence = JSON.stringify(plan.pair.desired);
    expect(sharedEvidence).not.toContain('/home/user');
    expect(sharedEvidence).not.toContain('secret');
    expect(sharedEvidence).not.toContain('token');
  });

  it('restarts offline after the local-first write despite a stale complete marker', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));
    const rename = fs.rename;
    let failAfterLocalWrite = true;
    fs.rename = async (from: string, to: string) => {
      await rename(from, to);
      if (to === userSources.localFile && failAfterLocalWrite) {
        failAfterLocalWrite = false;
        throw new Error('simulated interruption after local write');
      }
    };

    await expect(migrateLockfileIfNeeded(userSources, fs, {
      ...OPTS,
      identityEvidence: verifiedIdentityEvidence
    })).rejects.toThrow('simulated interruption');
    const pendingLocal = JSON.parse(fs.files.get(userSources.localFile) as string);
    expect(pendingLocal.migration).toBeUndefined();
    expect(JSON.parse(fs.files.get(userSources.desiredFile) as string).bundles[legacyRuntimeKey])
      .toBeDefined();

    fs.rename = rename;
    const resumed = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    expect(resumed.pair.desired.bundles[verifiedLogicalKey]).toBeDefined();
    expect(resumed.pair.local.targets['cursor-user'].bundles[verifiedLogicalKey].mcpServers)
      .toEqual(['reviewer-mcp']);
    expect(resumed.pair.local.targets['cursor-user'].bundles[verifiedLogicalKey].legacy)
      .toBeUndefined();
    expect(resumed.pair.local.migration).toEqual({ lockfileV3: 'complete' });
  });

  it('previews legacy state without writes and returns deterministic desired bytes across clocks', async () => {
    const fs = fakeFs();
    const branchPair = branchEraV3Pair();
    fs.files.set(userSources.desiredFile, JSON.stringify(branchPair.desired));
    fs.files.set(userSources.localFile, JSON.stringify(branchPair.local));
    const before = [...fs.files.entries()];

    const first = await planLockfileMigration(userSources, fs, {
      ...OPTS,
      identityEvidence: verifiedIdentityEvidence
    });
    const second = await planLockfileMigration(userSources, fs, {
      ...OPTS,
      now: '2027-05-05T05:05:05.000Z',
      identityEvidence: verifiedIdentityEvidence
    });

    expect(first.pendingWrite).toBe(true);
    expect(JSON.stringify(first.pair.desired)).toBe(JSON.stringify(second.pair.desired));
    expect([...fs.files.entries()]).toEqual(before);
    expect(fs.order).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])('restarts offline after migration effect %i and preserves ownership', async (failAfter) => {
    const fs = fakeFs();
    const repoSources = {
      desiredFile: '/work/ai-primitives-hub.lock.json',
      localFile: '/work/ai-primitives-hub.local.lock.json',
      legacyFiles: ['/work/prompt-registry.lock.json', '/work/prompt-registry.local.lock.json']
    };
    fs.files.set(repoSources.legacyFiles[0], JSON.stringify(v2WithOneBundle()));
    fs.files.set(repoSources.legacyFiles[1], JSON.stringify({
      ...v2WithOneBundle(),
      bundles: {}
    }));
    const rename = fs.rename;
    const remove = fs.remove;
    let effect = 0;
    const interruptAfterEffect = (): void => {
      effect += 1;
      if (effect === failAfter) {
        throw new Error(`interrupted after effect ${failAfter}`);
      }
    };
    fs.rename = async (from: string, to: string) => {
      await rename(from, to);
      interruptAfterEffect();
    };
    fs.remove = async (path: string) => {
      await remove(path);
      interruptAfterEffect();
    };

    await expect(migrateLockfileIfNeeded(repoSources, fs, OPTS))
      .rejects.toThrow(`interrupted after effect ${failAfter}`);

    fs.rename = rename;
    fs.remove = remove;
    const restarted = await migrateLockfileIfNeeded(repoSources, fs, OPTS);
    const intent = restarted.pair.desired.unresolved?.find((item) => item.originalKey === 'web-dev');
    const localRecord = Object.values(restarted.pair.local.targets)
      .flatMap((target) => Object.values(target.bundles))
      .find((record) => record.files.some((file) => file.path === 'prompts/hello.prompt.md'));

    expect(intent?.version).toBe('1.0.0');
    expect(localRecord?.files[0].checksum).toBe('b'.repeat(64));
    expect(restarted.pair.local.migration).toEqual({ lockfileV3: 'complete' });
    expect(fs.files.has(repoSources.legacyFiles[0])).toBe(false);
    expect(fs.files.has(repoSources.legacyFiles[1])).toBe(false);
  });
});
