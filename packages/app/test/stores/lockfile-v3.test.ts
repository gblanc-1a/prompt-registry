import * as fs from 'node:fs';
import * as path from 'node:path';
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
  upsertMaterialization,
  writeLockfileV3Pair,
} from '../../src/stores/lockfile-v3';

const NOW = '2026-10-09T12:00:00.000Z';
const DEFAULTS = { generatedBy: 'ai-primitives-hub-cli', now: NOW };

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
  sourceId: 'src',
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
    fs.files.set(userPaths.localFile, JSON.stringify(
      upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record())
    ));

    const { pair, desiredExists, localExists } = await readLockfileV3Pair(userPaths, mockFs, DEFAULTS);

    expect(desiredExists).toBe(false);
    expect(localExists).toBe(true);
    expect(pair.local.targets['my-vscode'].bundles['src/web-dev']).toBeDefined();
  });

  it('refuses a v2 file so the caller migrates instead of misreading it', async () => {
    const mockFs = fakeFs();
    fs.files.set(userPaths.desiredFile, JSON.stringify({ version: '2.0.0', bundles: {}, sources: {} }));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS))
      .rejects.toThrow(LockfileGenerationMismatchError);
  });

  it('refuses an unknown major loudly', async () => {
    const mockFs = fakeFs();
    fs.files.set(userPaths.localFile, JSON.stringify({ version: '9.0.0' }));

    await expect(readLockfileV3Pair(userPaths, mockFs, DEFAULTS))
      .rejects.toThrow(/newer version of AI Primitives Hub/);
  });

  it('round-trips a written pair', async () => {
    const mockFs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', { version: '1.0.0', sourceId: 'src' }),
      local: upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record())
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

    expect(fs.order).toEqual([userPaths.localFile, userPaths.desiredFile]);
  });

  it('writes through a unique temp file per write', async () => {
    const mockFs = fakeFs();
    const pair = { desired: emptyDesiredLockfileV3(), local: emptyLocalLockfileV3('cli', NOW) };

    await writeLockfileV3Pair(userPaths, pair, mockFs);
    await writeLockfileV3Pair(userPaths, pair, mockFs);

    const temps = fs.renames.map(([from]) => from);
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

  it('ends each file with a trailing newline, like the v2 writer', async () => {
    const mockFs = fakeFs();

    await writeLockfileV3Pair(userPaths, {
      desired: emptyDesiredLockfileV3(),
      local: emptyLocalLockfileV3('cli', NOW)
    }, mockFs);

    expect(fs.files.get(userPaths.desiredFile)?.endsWith('}\n')).toBe(true);
    expect(fs.files.get(userPaths.localFile)?.endsWith('}\n')).toBe(true);
  });

  it('behaves identically at repository paths — only the destination differs', async () => {
    const userFs = fakeFs();
    const repoFs = fakeFs();
    const pair = {
      desired: upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', { version: '1.0.0', sourceId: 'src' }),
      local: upsertMaterialization(
        emptyLocalLockfileV3('cli', NOW),
        { ...binding, scope: 'repository', baseDir: '/work' },
        'src/web-dev',
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
  it('upsertDesiredBundle does not mutate its input', () => {
    const before = emptyDesiredLockfileV3();

    const after = upsertDesiredBundle(before, 'src/web-dev', { version: '1.0.0', sourceId: 'src' });

    expect(before.bundles).toEqual({});
    expect(after.bundles['src/web-dev']).toEqual({ version: '1.0.0', sourceId: 'src' });
  });

  it('a desired entry carries only version, sourceId and optional archiveSha', () => {
    const lock = upsertDesiredBundle(emptyDesiredLockfileV3(), 'src/web-dev', {
      version: '1.0.0', sourceId: 'src', archiveSha: 'sha256:deadbeef'
    });

    expect(Object.keys(lock.bundles['src/web-dev']).toSorted())
      .toEqual(['archiveSha', 'sourceId', 'version']);
  });

  it('upsertMaterialization creates the target record on first use', () => {
    const local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record());

    expect(local.targets['my-vscode'].targetType).toBe('vscode');
    expect(local.targets['my-vscode'].baseDir).toBe('/home/u/.copilot');
    expect(local.targets['my-vscode'].bundles['src/web-dev'].files).toHaveLength(1);
  });

  it('carries commitMode only when the caller supplies it', () => {
    const withoutMode = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'k', record());
    const withMode = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      { ...binding, scope: 'repository', baseDir: '/work', commitMode: 'local-only' },
      'k',
      record()
    );

    expect('commitMode' in withoutMode.targets['my-vscode']).toBe(false);
    expect(withMode.targets['my-vscode'].commitMode).toBe('local-only');
  });

  it('removeMaterialization drops the bundle and prunes an emptied target', () => {
    const seeded = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/web-dev', record());

    expect(removeMaterialization(seeded, 'my-vscode', 'src/web-dev').targets['my-vscode']).toBeUndefined();
  });

  it('removeMaterialization keeps a target that still holds another bundle', () => {
    let local = upsertMaterialization(emptyLocalLockfileV3('cli', NOW), binding, 'src/a', record());
    local = upsertMaterialization(local, binding, 'src/b', record());

    expect(Object.keys(removeMaterialization(local, 'my-vscode', 'src/a').targets['my-vscode'].bundles))
      .toEqual(['src/b']);
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
        sources: { src: { type: 'github', url: 'https://github.com/example/repo' } },
        hubs: { hub1: { name: 'Test Hub', url: 'https://example.com/hub' } },
        profiles: { profile1: { name: 'Test Profile', bundleIds: ['src/web-dev'] } }
      },
      'src/web-dev',
      { version: '1.0.0', sourceId: 'src', archiveSha: 'sha256:deadbeef' }
    );
    const local = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      { ...binding, commitMode: 'commit', scope: 'repository' },
      'src/web-dev',
      {
        ...record(),
        state: 'unmanaged',
        unmanagedReason: 'Test',
        linked: true,
        mcpConfigPath: 'mcp.json',
        mcpServers: ['server-a', 'server-b'],
        complete: true
      }
    );

    expect(validate(desired)).toBe(true);
    expect(validate(local)).toBe(true);
  });

  it('rejects mcpServers as an object (design §6.5: server names only)', () => {
    const local = upsertMaterialization(
      emptyLocalLockfileV3('cli', NOW),
      binding,
      'src/web-dev',
      {
        ...record(),
        mcpServers: { 'server-a': { config: 'data' } } as unknown as string[]
      }
    );

    expect(validate(local)).toBe(false);
    expect(validate.errors?.some((e) => e.instancePath.includes('mcpServers'))).toBe(true);
  });
});
