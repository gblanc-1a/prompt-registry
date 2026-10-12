import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PortableSourceDescriptor,
} from '@ai-primitives-hub/core';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  emptyDesiredLockfileV3,
  emptyLocalLockfileV3,
  LOCKFILE_V3_VERSION,
  LockfileGenerationMismatchError,
  readLockfileV3Pair,
  removeMaterialization,
  upsertDesiredBundle,
  upsertDesiredSource,
  upsertMaterialization,
  writeLockfileV3Pair,
} from '../../src/stores/lockfile-v3';

const NOW = '2026-10-09T12:00:00.000Z';
const DEFAULTS = { generatedBy: 'ai-primitives-hub-cli', now: NOW };
const PORTABLE_SOURCE_KEY = 'src-2cb1d562d89c91736315d553fae7344944e240230121f4191354c32f76495503';
const PORTABLE_BUNDLE_KEY = `${PORTABLE_SOURCE_KEY}/web-dev`;
const ARTIFACTORY_SOURCE_KEY = 'src-6a0f9c94835f5073761b364a48e51babe3f5d743bf6dbeb746b93b73a5908b76';
const PORTABLE_SOURCE = {
  type: 'github',
  identity: {
    kind: 'github-releases',
    origin: 'https://github.com',
    repositoryId: '12345'
  },
  locator: 'https://github.com/example/repo'
} as const;
const PINNED_RESOLUTION = {
  kind: 'pinned',
  provider: 'github-release',
  version: '1.0.0',
  releaseId: '123',
  assetId: '456',
  archiveSha256: 'a'.repeat(64)
} as const;

const fakeFs = () => {
  const files = new Map<string, string>();
  const order: string[] = [];
  const renames: [string, string][] = [];
  return {
    files,
    order,
    renames,
    readFile: async (p: string) => {
      const value = files.get(p);
      if (value === undefined) {
        throw new Error(`ENOENT ${p}`);
      }
      return value;
    },
    writeFile: async (p: string, contents: string) => {
      files.set(p, contents);
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => undefined,
    remove: async (p: string) => {
      files.delete(p);
    },
    rename: async (from: string, to: string) => {
      renames.push([from, to]);
      order.push(to);
      files.set(to, files.get(from) as string);
      files.delete(from);
    }
  };
};

/** The same pair shape at either scope; only these two strings differ. */
const userPaths = {
  desiredFile: '/cfg/ai-primitives-hub/ai-primitives-hub.lock.json',
  localFile: '/cfg/ai-primitives-hub/ai-primitives-hub.local.lock.json'
};
const repoPaths = {
  desiredFile: '/work/ai-primitives-hub.lock.json',
  localFile: '/work/ai-primitives-hub.local.lock.json'
};

const binding = {
  targetName: 'my-vscode',
  targetType: 'vscode' as const,
  scope: 'user' as const,
  baseDir: '/home/u/.copilot'
};

const record = () => ({
  version: '1.0.0',
  sourceKey: PORTABLE_SOURCE_KEY,
  resolution: PINNED_RESOLUTION,
  installedAt: NOW,
  files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
});

describe('empty pair', () => {
  it('splits the roles: desired carries no generated metadata', () => {
    const desired = emptyDesiredLockfileV3();

    expect(desired.version).toBe(LOCKFILE_V3_VERSION);
    expect(desired.bundles).toEqual({});
    expect(desired.sources).toEqual({});
    expect('generatedAt' in desired).toBe(false);
    expect('generatedBy' in desired).toBe(false);
    expect('targets' in desired).toBe(false);
  });

  it('splits the roles: local carries materialization and the churn fields', () => {
    const local = emptyLocalLockfileV3('cli', NOW);

    expect(local.version).toBe(LOCKFILE_V3_VERSION);
    expect(local.generatedAt).toBe(NOW);
    expect(local.generatedBy).toBe('cli');
    expect(local.targets).toEqual({});
    expect('bundles' in local).toBe(false);
    expect('sources' in local).toBe(false);
    expect('$schema' in local).toBe(false);
  });
});

describe('readLockfileV3Pair', () => {
  it('returns an empty pair when neither file exists, and reports that', async () => {
    const { pair, desiredExists, localExists } = await readLockfileV3Pair(userPaths, fakeFs(), DEFAULTS);

    expect(desiredExists).toBe(false);
    expect(localExists).toBe(false);
    expect(pair.desired.bundles).toEqual({});
    expect(pair.local.targets).toEqual({});
  });

  it('reads a half-present pair — local written, desired not yet (the §8.4 interruption)', async () => {
    const mockFs = fakeFs();
    mockFs.files.set(userPaths.localFile, JSON.stringify(
      upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record())
    ));

    const { pair, desiredExists, localExists } = await readLockfileV3Pair(userPaths, mockFs, DEFAULTS);

    expect(desiredExists).toBe(false);
    expect(localExists).toBe(true);
    expect(pair.local.targets['my-vscode'].bundles[PORTABLE_BUNDLE_KEY]).toBeDefined();
  });

  it('refuses a v2 file so the caller migrates instead of misreading it', async () => {
    const mockFs = fakeFs();
    mockFs.files.set(userPaths.desiredFile, JSON.stringify({ version: '2.0.0', bundles: {}, sources: {} }));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS))
      .rejects.toThrow(LockfileGenerationMismatchError);
  });

  it('refuses an unknown major loudly', async () => {
    const mockFs = fakeFs();
    mockFs.files.set(userPaths.localFile, JSON.stringify({ version: '9.0.0' }));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });

  it('round-trips a written pair', async () => {
    const mockFs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle({
        ...emptyDesiredLockfileV3(),
        sources: { [PORTABLE_SOURCE_KEY]: PORTABLE_SOURCE }
      }, PORTABLE_BUNDLE_KEY, {
        version: '1.0.0', sourceKey: PORTABLE_SOURCE_KEY, resolution: PINNED_RESOLUTION
      }),
      local: upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record())
    };
    await writeLockfileV3Pair(userPaths, pair, mockFs);

    expect((await readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).pair).toEqual(pair);
  });
});

describe('writeLockfileV3Pair', () => {
  it('writes the local file before the desired file (§8.4 ordering)', async () => {
    const mockFs = fakeFs();

    await writeLockfileV3Pair(userPaths, {
      desired: emptyDesiredLockfileV3(),
      local: emptyLocalLockfileV3('cli', NOW)
    }, mockFs);

    expect(mockFs.order).toEqual([userPaths.localFile, userPaths.desiredFile]);
  });

  it('writes through a unique temp file per write', async () => {
    const mockFs = fakeFs();
    const pair = { desired: emptyDesiredLockfileV3(), local: emptyLocalLockfileV3('cli', NOW) };

    await writeLockfileV3Pair(userPaths, pair, mockFs);
    await writeLockfileV3Pair(userPaths, pair, mockFs);

    const temps = mockFs.renames.map(([from]) => from);
    expect(new Set(temps).size).toBe(temps.length);
    expect(temps[0]).toContain(`${userPaths.localFile}.`);
  });

  it('refuses a payload that is not 3.0.0, writing nothing', async () => {
    const mockFs = fakeFs();

    await expect(writeLockfileV3Pair(userPaths, {
      desired: { ...emptyDesiredLockfileV3(), version: '2.0.0' },
      local: emptyLocalLockfileV3('cli', NOW)
    }, mockFs)).rejects.toThrow(LockfileGenerationMismatchError);
    expect(mockFs.files.size).toBe(0);
  });

  it('does not re-stamp an unknown-major payload', async () => {
    const mockFs = fakeFs();

    await expect(writeLockfileV3Pair(userPaths, {
      desired: { ...emptyDesiredLockfileV3(), version: '9.0.0' },
      local: emptyLocalLockfileV3('cli', NOW)
    }, mockFs)).rejects.toThrow(/newer version/i);
    expect(mockFs.files.size).toBe(0);
  });

  it('ends each file with a trailing newline, like the v2 writer', async () => {
    const mockFs = fakeFs();

    await writeLockfileV3Pair(userPaths, {
      desired: emptyDesiredLockfileV3(),
      local: emptyLocalLockfileV3('cli', NOW)
    }, mockFs);

    expect(mockFs.files.get(userPaths.desiredFile)?.endsWith('}\n')).toBe(true);
    expect(mockFs.files.get(userPaths.localFile)?.endsWith('}\n')).toBe(true);
  });

  it('behaves identically at repository paths — only the destination differs', async () => {
    const userFs = fakeFs();
    const repoFs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle({
        ...emptyDesiredLockfileV3(),
        sources: { [PORTABLE_SOURCE_KEY]: PORTABLE_SOURCE }
      }, PORTABLE_BUNDLE_KEY, {
        version: '1.0.0', sourceKey: PORTABLE_SOURCE_KEY, resolution: PINNED_RESOLUTION
      }),
      local: upsertMaterialization(
        emptyLocalLockfileV3('cli', NOW),
        { ...binding, scope: 'repository', baseDir: '/work' },
        PORTABLE_BUNDLE_KEY,
        record()
      )
    };

    await writeLockfileV3Pair(userPaths, pair, userFs);
    await writeLockfileV3Pair(repoPaths, pair, repoFs);

    expect(repoFs.files.get(repoPaths.desiredFile)).toBe(userFs.files.get(userPaths.desiredFile));
    expect(repoFs.files.get(repoPaths.localFile)).toBe(userFs.files.get(userPaths.localFile));
  });
});

describe('pure record helpers', () => {
  it('refuses materialization upsert when an existing target root would be rebound', () => {
    const local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record());
    expect(() => upsertMaterialization(local, { ...binding, baseDir: '/different/root' }, PORTABLE_BUNDLE_KEY, record()))
      .toThrow(/uninstall first|restore the target path/i);
  });
  it('upsertDesiredBundle does not mutate its input', () => {
    const before = emptyDesiredLockfileV3();

    const entry = { version: '1.0.0', sourceKey: PORTABLE_SOURCE_KEY, resolution: PINNED_RESOLUTION };
    const after = upsertDesiredBundle(before, PORTABLE_BUNDLE_KEY, entry);

    expect(before.bundles).toEqual({});
    expect(after.bundles[PORTABLE_BUNDLE_KEY]).toEqual(entry);
  });

  it('a desired entry carries version, portable source key, and resolution', () => {
    const lock = upsertDesiredBundle(emptyDesiredLockfileV3(), PORTABLE_BUNDLE_KEY, {
      version: '1.0.0', sourceKey: PORTABLE_SOURCE_KEY, resolution: PINNED_RESOLUTION
    });

    expect(Object.keys(lock.bundles[PORTABLE_BUNDLE_KEY]).toSorted())
      .toEqual(['resolution', 'sourceKey', 'version']);
  });

  it('upsertMaterialization creates the target record on first use', () => {
    const local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record());

    expect(local.targets['my-vscode'].targetType).toBe('vscode');
    expect(local.targets['my-vscode'].baseDir).toBe('/home/u/.copilot');
    expect(local.targets['my-vscode'].bundles[PORTABLE_BUNDLE_KEY].files).toHaveLength(1);
  });
  it('carries commitMode only when the caller supplies it', () => {
    const withoutMode = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record());
    const withMode = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      { ...binding, scope: 'repository', baseDir: '/work', commitMode: 'local-only' },
      PORTABLE_BUNDLE_KEY,
      record()
    );

    expect('commitMode' in withoutMode.targets['my-vscode']).toBe(false);
    expect(withMode.targets['my-vscode'].commitMode).toBe('local-only');
  });

  it('removeMaterialization drops the bundle and prunes an emptied target', () => {
    const seeded = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, PORTABLE_BUNDLE_KEY, record());

    expect(removeMaterialization(seeded, 'my-vscode', PORTABLE_BUNDLE_KEY).targets['my-vscode']).toBeUndefined();
  });

  it('removeMaterialization keeps a target that still holds another bundle', () => {
    let local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, `${PORTABLE_SOURCE_KEY}/a`, record());
    local = upsertMaterialization(local, binding, `${PORTABLE_SOURCE_KEY}/b`, record());

    expect(Object.keys(removeMaterialization(local, 'my-vscode', `${PORTABLE_SOURCE_KEY}/a`).targets['my-vscode'].bundles))
      .toEqual([`${PORTABLE_SOURCE_KEY}/b`]);
  });
});

describe('upsertDesiredSource', () => {
  it('stores the full portable descriptor, including non-identity Artifactory config', () => {
    const artifactoryKey = ARTIFACTORY_SOURCE_KEY;
    const artifactory = {
      type: 'artifactory' as const,
      identity: {
        kind: 'artifactory-index' as const,
        root: 'https://packages.example/repository/ai',
        indexFile: 'index-v1.json'
      },
      locator: 'https://packages.example/repository/ai',
      config: {
        indexFile: 'index-v1.json',
        authMode: 'bearer' as const,
        credentialRef: 'keychain://ai-primitives-hub/artifactory'
      }
    };
    const updated = upsertDesiredSource(emptyDesiredLockfileV3(), artifactoryKey, artifactory);

    expect(updated.sources[artifactoryKey]).toEqual(artifactory);
  });

  it('preserves Artifactory auth and credential-reference config when refreshing the descriptor', () => {
    const artifactoryKey = ARTIFACTORY_SOURCE_KEY;
    const existing: PortableSourceDescriptor = {
      type: 'artifactory',
      identity: {
        kind: 'artifactory-index',
        root: 'https://packages.example/repository/ai',
        indexFile: 'index-v1.json'
      },
      locator: 'https://packages.example/repository/ai',
      config: {
        indexFile: 'index-v1.json',
        authMode: 'bearer',
        credentialRef: 'keychain://ai-primitives-hub/artifactory'
      }
    };
    const refreshed = {
      ...existing,
      config: { indexFile: 'index-v1.json' }
    };
    const base = upsertDesiredSource(emptyDesiredLockfileV3(), artifactoryKey, existing);

    const updated = upsertDesiredSource(base, artifactoryKey, refreshed);

    expect(updated.sources[artifactoryKey].config).toEqual({
      indexFile: 'index-v1.json',
      authMode: 'bearer',
      credentialRef: 'keychain://ai-primitives-hub/artifactory'
    });
  });

  it('rejects a descriptor stored under a non-matching portable source key', () => {
    expect(() => upsertDesiredSource(emptyDesiredLockfileV3(), 'src-'.concat('0'.repeat(64)), PORTABLE_SOURCE))
      .toThrow(/does not match|source key/i);
  });

  it('accepts workspace-relative roots and external named bindings as local locators', async () => {
    const workspaceKey = 'src-782808a1f37bec2cf97ff69519794ac0652b1ee185c677b8d90adff5e806b7eb';
    const bindingKey = 'src-22bce37a11bd1ba0cdc0016ae63212512570abaa39ac0b7f3334206a438a18aa';
    const desired = {
      ...emptyDesiredLockfileV3(),
      sources: {
        [workspaceKey]: {
          type: 'local' as const,
          identity: { kind: 'workspace-local' as const, root: '.' },
          locator: '.'
        },
        [bindingKey]: {
          type: 'local' as const,
          identity: { kind: 'external-local' as const, bindingName: 'team-source' },
          locator: 'team-source'
        }
      }
    };
    const mockFs = fakeFs();
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));

    const { pair } = await readLockfileV3Pair(userPaths, mockFs, DEFAULTS);

    expect(pair.desired.sources[workspaceKey].locator).toBe('.');
    expect(pair.desired.sources[bindingKey].locator).toBe('team-source');

    desired.sources[workspaceKey].locator = 'other-root';
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));
    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();
  });
});

describe('strict amended v3 wire contract', () => {
  const strictDesired = () => ({
    ...emptyDesiredLockfileV3(),
    sources: { [PORTABLE_SOURCE_KEY]: PORTABLE_SOURCE },
    bundles: {
      [PORTABLE_BUNDLE_KEY]: {
        version: '1.0.0',
        sourceKey: PORTABLE_SOURCE_KEY,
        resolution: PINNED_RESOLUTION
      }
    }
  });
  const strictLocal = () => ({
    ...emptyLocalLockfileV3('cli', NOW),
    targets: {
      'my-vscode': {
        targetType: 'vscode' as const,
        scope: 'user' as const,
        baseDir: '/home/u/.copilot',
        bundles: {
          [PORTABLE_BUNDLE_KEY]: {
            version: '1.0.0',
            sourceKey: PORTABLE_SOURCE_KEY,
            resolution: PINNED_RESOLUTION,
            installedAt: NOW,
            files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
          }
        }
      }
    }
  });

  it('reads a valid portable desired and managed local entry', async () => {
    const mockFs = fakeFs();
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(strictDesired()));
    mockFs.files.set(userPaths.localFile, JSON.stringify(strictLocal()));

    const { pair } = await readLockfileV3Pair(userPaths, mockFs, DEFAULTS);

    expect(pair.desired.bundles[PORTABLE_BUNDLE_KEY].sourceKey).toBe(PORTABLE_SOURCE_KEY);
    expect(pair.local.targets['my-vscode'].bundles[PORTABLE_BUNDLE_KEY].sourceKey).toBe(PORTABLE_SOURCE_KEY);
  });

  it('rejects a local generatedAt value that is not an ISO date-time', async () => {
    const mockFs = fakeFs();
    const local = strictLocal();
    local.generatedAt = '2026-10-12';
    mockFs.files.set(userPaths.localFile, JSON.stringify(local));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow(/ISO date-time/i);
  });

  it('rejects active sourceId fields in desired and local records', async () => {
    const mockFs = fakeFs();
    const desired = strictDesired();
    (desired.bundles[PORTABLE_BUNDLE_KEY] as unknown as Record<string, unknown>).sourceId = 'legacy-source';
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));
    mockFs.files.set(userPaths.localFile, JSON.stringify(strictLocal()));
    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();

    mockFs.files.set(userPaths.desiredFile, JSON.stringify(strictDesired()));
    const local = strictLocal();
    (local.targets['my-vscode'].bundles[PORTABLE_BUNDLE_KEY] as unknown as Record<string, unknown>).sourceId = 'legacy-source';
    mockFs.files.set(userPaths.localFile, JSON.stringify(local));
    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();
  });

  it('rejects a bundle key that does not match its source descriptor and sourceKey', async () => {
    const mockFs = fakeFs();
    const desired = strictDesired();
    (desired.sources[PORTABLE_SOURCE_KEY].identity as { repositoryId: string }).repositoryId = '99999';
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();
  });

  it('rejects a desired version that disagrees with its pinned resolution', async () => {
    const mockFs = fakeFs();
    const desired = strictDesired();
    desired.bundles[PORTABLE_BUNDLE_KEY] = {
      ...desired.bundles[PORTABLE_BUNDLE_KEY],
      version: '2.0.0'
    };
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();
  });

  it('rejects runtime absolute roots as portable local descriptor locators', async () => {
    const mockFs = fakeFs();
    const desired = strictDesired();
    desired.sources = {
      [PORTABLE_SOURCE_KEY]: {
        type: 'local',
        identity: { kind: 'workspace-local', root: '/Users/alice/project' },
        locator: '/Users/alice/project'
      } as never
    };
    mockFs.files.set(userPaths.desiredFile, JSON.stringify(desired));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow();
  });

  it('retains an unmanaged record without portable fields only under its unresolved key', async () => {
    const mockFs = fakeFs();
    const makeUnmanagedLocal = (key: string) => {
      const local = strictLocal();
      const bundles = local.targets['my-vscode'].bundles as Record<string, unknown>;
      delete bundles[PORTABLE_BUNDLE_KEY];
      bundles[key] = {
        version: '1.0.0',
        installedAt: NOW,
        state: 'unmanaged',
        unmanagedReason: 'The source identity could not be proven.',
        legacy: { originalKey: 'legacy-source/web-dev', version: '1.0.0' },
        files: [{ path: 'prompts/hello.prompt.md' }]
      };
      return local;
    };

    mockFs.files.set(userPaths.localFile, JSON.stringify(makeUnmanagedLocal(`unresolved/${'e'.repeat(64)}`)));
    const { pair } = await readLockfileV3Pair(userPaths, mockFs, DEFAULTS);
    expect(pair.local.targets['my-vscode'].bundles[`unresolved/${'e'.repeat(64)}`])
      .toMatchObject({ state: 'unmanaged' });

    mockFs.files.set(userPaths.localFile, JSON.stringify(makeUnmanagedLocal(PORTABLE_BUNDLE_KEY)));
    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS)).rejects.toThrow(/unresolved key/i);
  });

  it('validates both complete shapes before writing either half', async () => {
    const mockFs = fakeFs();
    const local = strictLocal();
    (local.targets['my-vscode'].bundles[PORTABLE_BUNDLE_KEY] as unknown as Record<string, unknown>).sourceId = 'legacy-source';

    await expect(writeLockfileV3Pair(userPaths, {
      desired: strictDesired(),
      local
    }, mockFs)).rejects.toThrow();
    expect(mockFs.files.size).toBe(0);
  });

  it('rejects an invalid desired shape before writing a valid local half', async () => {
    const mockFs = fakeFs();
    const desired = strictDesired();
    (desired.bundles[PORTABLE_BUNDLE_KEY] as unknown as Record<string, unknown>).archiveSha = 'legacy-pin';

    await expect(writeLockfileV3Pair(userPaths, {
      desired,
      local: strictLocal()
    }, mockFs)).rejects.toThrow();
    expect(mockFs.files.size).toBe(0);
  });
});

describe('schema conformance', () => {
  const schemaPath = path.join(__dirname, '../../../core/src/public/schemas/lockfile-v3.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  it('empty desired lockfile conforms to schema', () => {
    const desired = emptyDesiredLockfileV3();

    expect(validate(desired)).toBe(true);
  });

  it('empty local lockfile conforms to schema', () => {
    const local = emptyLocalLockfileV3('cli', NOW);

    expect(validate(local)).toBe(true);
  });

  it('fully populated pair conforms to schema', () => {
    const desired = upsertDesiredBundle(
      {
        ...emptyDesiredLockfileV3(),
        sources: { [PORTABLE_SOURCE_KEY]: PORTABLE_SOURCE },
        hubs: { hub1: { name: 'Test Hub', url: 'https://example.com/hub' } },
        profiles: { profile1: { name: 'Test Profile', bundleIds: [PORTABLE_BUNDLE_KEY] } }
      },
      PORTABLE_BUNDLE_KEY,
      { version: '1.0.0', sourceKey: PORTABLE_SOURCE_KEY, resolution: PINNED_RESOLUTION }
    );
    const local = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      { ...binding, commitMode: 'commit', scope: 'repository' },
      PORTABLE_BUNDLE_KEY,
      {
        ...record(),
        mcpConfigPath: 'mcp.json',
        mcpServers: ['server-a', 'server-b'],
        complete: true
      }
    );

    expect(validate(desired)).toBe(true);
    expect(validate(local)).toBe(true);
  });

  it('a source descriptor written by upsertDesiredSource conforms to schema, with and without optional fields', () => {
    const artifactoryKey = ARTIFACTORY_SOURCE_KEY;
    const plain: PortableSourceDescriptor = {
      type: 'artifactory',
      identity: {
        kind: 'artifactory-index',
        root: 'https://packages.example/repository/ai',
        indexFile: 'index-v1.json'
      },
      locator: 'https://packages.example/repository/ai'
    };
    const rich: PortableSourceDescriptor = {
      ...plain,
      config: {
        indexFile: 'index-v1.json',
        authMode: 'bearer',
        credentialRef: 'keychain://ai-primitives-hub/artifactory'
      }
    };
    const plainLock = upsertDesiredSource(emptyDesiredLockfileV3(), artifactoryKey, plain);
    const richLock = upsertDesiredSource(emptyDesiredLockfileV3(), artifactoryKey, rich);

    expect(validate(plainLock)).toBe(true);
    expect(validate(richLock)).toBe(true);
    expect(plainLock.sources[artifactoryKey]).toEqual(plain);
  });

  it('rejects mcpServers as an object (design §6.5: server names only)', () => {
    const local = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      binding,
      PORTABLE_BUNDLE_KEY,
      {
        ...record(),
        mcpServers: { 'server-a': { config: 'data' } } as unknown as string[]
      }
    );

    expect(validate(local)).toBe(false);
    expect(validate.errors?.some((e) => e.instancePath.includes('mcpServers'))).toBe(true);
  });
});
