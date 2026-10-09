import {
  describe,
  expect,
  it,
} from 'vitest';
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
      checksum: 'sha256:archivebytes',
      files: [{ path: 'prompts/hello.prompt.md', checksum: 'archivehash' }]
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

describe('convertV2ToPair', () => {
  it('splits one v2 file into the two role halves', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(pair.desired.version).toBe('3.0.0');
    expect(pair.local.version).toBe('3.0.0');
    expect('targets' in pair.desired).toBe(false);
    expect('bundles' in pair.local).toBe(false);
  });

  it('carries desired state across with sourceType and installedAt dropped', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(pair.desired.bundles['github-abc123/web-dev'])
      .toEqual({ version: '1.0.0', sourceId: 'github-abc123', archiveSha: 'sha256:archivebytes' });
    expect(pair.desired.sources['github-abc123'].type).toBe('github');
  });

  it('keys both halves by the logical bundle key, not the legacy id', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(Object.keys(pair.desired.bundles)).toEqual(['github-abc123/web-dev']);
    expect(Object.keys(pair.local.targets[UNMANAGED_TARGET_KEY].bundles))
      .toEqual(['github-abc123/web-dev']);
  });

  it('retains a CLI record as unmanaged rather than inventing a destination', () => {
    const { pair, report } = convertV2ToPair(v2WithOneBundle(), OPTS);

    expect(report.unmanaged).toHaveLength(1);
    expect(report.unmanaged[0].key).toBe('github-abc123/web-dev');
    expect(report.unmanaged[0].reason).toContain('destination could not be proven');
    const rec = pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev'];
    expect(rec.state).toBe('unmanaged');
    expect(rec.files.map((f) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('never rebaselines: the archive hash survives as checksum, not installedChecksum', () => {
    const { pair } = convertV2ToPair(v2WithOneBundle(), OPTS);

    const file = pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev'].files[0];
    expect(file.checksum).toBe('archivehash');
    expect(file.installedChecksum).toBeUndefined();
  });

  it('carries commitMode when present (§8.3)', () => {
    const v2 = v2WithOneBundle();
    v2.bundles['web-dev'].commitMode = 'local-only';

    const { pair } = convertV2ToPair(v2, OPTS);

    expect(pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/web-dev'].commitMode)
      .toBe('local-only');
  });

  it('marks a bundle whose source descriptor is missing as unmanaged for that reason', () => {
    const broken = { ...v2WithOneBundle(), sources: {} };

    const { report } = convertV2ToPair(broken, OPTS);

    expect(report.unmanaged[0].reason).toContain('source descriptor');
  });

  it('omits the triggering bundle from materialization — the deploy records it fresh', () => {
    const { pair, report } = convertV2ToPair(v2WithOneBundle(), {
      ...OPTS, triggeredByKey: 'github-abc123/web-dev'
    });

    expect(report.unmanaged).toEqual([]);
    expect(report.migrated).toEqual(['github-abc123/web-dev']);
    expect(pair.local.targets[UNMANAGED_TARGET_KEY]).toBeUndefined();
    expect(pair.desired.bundles['github-abc123/web-dev']).toBeDefined();
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
  it('returns a local-only v3 pair (no desired, no legacy) as it stands, with a null report and no write', async () => {
    const fs = fakeFs();
    const local = {
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        'my-vscode': {
          baseDir: '/home/u/.copilot',
          bundles: {
            'github-abc123/web-dev': {
              version: '1.0.0',
              sourceId: 'github-abc123',
              installedAt: '2026-10-09T12:00:00.000Z',
              files: [{ path: 'prompts/hello.prompt.md' }]
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

    expect(report?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/web-dev']);
    expect(JSON.parse(fs.files.get(userSources.desiredFile) as string).version).toBe('3.0.0');
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

  it('resumes an interruption between the local and desired writes (Review Focus 5)', async () => {
    // §8.4: until the marker is set, materialization is the new local file
    // unioned with legacy, existing-new winning per key — so a half-done
    // migration must preserve the existing-new record and discard the
    // legacy-derived duplicate.
    const fs = fakeFs();
    const v2 = v2WithOneBundle();
    // Add a second bundle that will be in the v2 file.
    v2.bundles['other-bundle'] = {
      version: '2.0.0',
      sourceId: 'github-abc123',
      sourceType: 'github',
      installedAt: '2026-02-01T00:00:00.000Z',
      checksum: 'sha256:otherbytes',
      files: [{ path: 'other.md', checksum: 'otherhash' }]
    };
    fs.files.set(userSources.desiredFile, JSON.stringify(v2));

    // Seed the partial local file with:
    // 1. An existing-new record for web-dev under a real target (with installedChecksum)
    // 2. An existing-new unmanaged record for third-bundle (with installedChecksum) - regression test
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
            'github-abc123/web-dev': {
              version: '1.0.0',
              sourceId: 'github-abc123',
              installedAt: '2026-01-01T00:00:00.000Z',
              files: [{ path: '/real/path/hello.prompt.md', checksum: 'realhash', installedChecksum: 'installedhash' }]
            }
          }
        },
        [UNMANAGED_TARGET_KEY]: {
          baseDir: '',
          bundles: {
            'github-abc123/third-bundle': {
              version: '3.0.0',
              sourceId: 'github-abc123',
              installedAt: '2026-03-01T00:00:00.000Z',
              state: 'unmanaged',
              unmanagedReason: 'carried from first run',
              files: [{ path: 'third.md', checksum: 'thirdhash', installedChecksum: 'thirdinstalled' }]
            }
          }
        }
      }
    };
    fs.files.set(userSources.localFile, JSON.stringify(partialLocal));

    const { pair } = await migrateLockfileIfNeeded(userSources, fs, OPTS);

    // Existing-new record wins (has installedChecksum, is under 'real-target').
    expect(pair.local.targets['real-target'].bundles['github-abc123/web-dev'].files[0].installedChecksum)
      .toBe('installedhash');
    // Legacy-derived unmanaged copy is removed (de-duplicated per bundle key).
    expect(pair.local.targets[UNMANAGED_TARGET_KEY]?.bundles['github-abc123/web-dev']).toBeUndefined();
    // other-bundle still exists in unmanaged (legacy-derived, not de-duplicated).
    expect(pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/other-bundle']).toBeDefined();
    // third-bundle survives with its installedChecksum intact (existing-new unmanaged record).
    expect(pair.local.targets[UNMANAGED_TARGET_KEY].bundles['github-abc123/third-bundle'].files[0].installedChecksum)
      .toBe('thirdinstalled');
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
    expect(plan.report?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/web-dev']);
    expect(Object.keys(plan.pair.desired.bundles)).toEqual(['github-abc123/web-dev']);
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
