import {
  logicalBundleKey,
  parseLogicalBundleKey,
  sourceKey,
} from '@ai-primitives-hub/core';
import type {
  BundleResolution,
  PortableSourceDescriptor,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  listTargetBundles as listTargetBundlesActual,
  resolveUndeployKey,
} from '../../src/deploy/resolve-undeploy-key';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  portableKeyFor,
  recordingPorts,
  type RecordingPorts,
  request,
  TEST_SOURCE_KEY,
} from './fixtures';

const MUTATING = /^(writeFile|writeFileBytes|rename|remove|mkdir):/;

interface SeedRecord {
  version?: string;
  sourceId: string;
}

const sourceFor = (sourceId: string): PortableSourceDescriptor => ({
  type: 'github',
  identity: {
    kind: 'github-releases',
    origin: 'https://github.com',
    repositoryId: sourceId === 'src-b' ? '102' : (sourceId === 'src-a' ? '101' : '103')
  },
  locator: `https://github.com/owner/${sourceId}`
});
const sourceKeyFor = (sourceId: string): string => sourceKey(sourceFor(sourceId).identity, 'github');
const key = (sourceId: string, logicalBundleId: string): string =>
  logicalBundleKey({ sourceKey: sourceKeyFor(sourceId), logicalBundleId });
const canonicalTestKey = (candidate: string): string => {
  if (candidate.startsWith('github-abc123/')) {
    return portableKeyFor(candidate.slice('github-abc123/'.length));
  }
  const match = /^src-([abc])\/(.+)$/.exec(candidate);
  return match === null ? candidate : key(`src-${match[1]}`, match[2]);
};
const displayTestKey = (candidate: string): string => {
  const parts = parseLogicalBundleKey(candidate);
  if (parts === null) {
    return candidate;
  }
  let sourceId = 'src-c';
  switch (parts.sourceKey) {
    case TEST_SOURCE_KEY: {
      sourceId = 'github-abc123';

      break;
    }
    case sourceKeyFor('src-a'): {
      sourceId = 'src-a';

      break;
    }
    case sourceKeyFor('src-b'): {
      sourceId = 'src-b';

      break;
    }
  // No default
  }
  return `${sourceId}/${parts.logicalBundleId}`;
};
const displayResolution = (result: Awaited<ReturnType<typeof resolveUndeployKey>>) => {
  if ('key' in result) {
    return { ...result, key: displayTestKey(result.key) };
  }
  return result.kind === 'ambiguous'
    ? { ...result, keys: result.keys.map((entryKey) => displayTestKey(entryKey)) }
    : result;
};
const resolutionFor = (version: string): BundleResolution => ({
  kind: 'unpinned',
  reason: 'test fixture',
  evidence: { manifestVersion: version }
});

const record = (seed: SeedRecord, unmanaged = false): object => ({
  version: seed.version ?? '1.0.0',
  sourceKey: sourceKeyFor(seed.sourceId),
  resolution: resolutionFor(seed.version ?? '1.0.0'),
  installedAt: '2026-10-09T12:00:00.000Z',
  files: [{ path: 'prompts/hello.prompt.md', installedChecksum: '0'.repeat(64) }],
  ...(unmanaged ? { state: 'unmanaged', unmanagedReason: 'test retained record' } : {})
});

const seedV3 = (
  ports: RecordingPorts,
  targets: Record<string, Record<string, SeedRecord>>,
  desired: Record<string, SeedRecord> = Object.fromEntries(
    Object.values(targets).flatMap((bundles) => Object.entries(bundles))
  )
): void => {
  const sourceIds = new Set([
    ...Object.values(targets).flatMap((bundles) => Object.values(bundles).map((seed) => seed.sourceId)),
    ...Object.values(desired).map((seed) => seed.sourceId)
  ]);
  ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
    $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
    version: '3.0.0',
    bundles: Object.fromEntries(Object.entries(desired).map(([bundleKey, seed]) => [canonicalTestKey(bundleKey), {
      version: seed.version ?? '1.0.0',
      sourceKey: sourceKeyFor(seed.sourceId),
      resolution: resolutionFor(seed.version ?? '1.0.0')
    }])),
    sources: Object.fromEntries([...sourceIds].map((sourceId) => [sourceKeyFor(sourceId), sourceFor(sourceId)]))
  }));
  ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
    version: '3.0.0',
    generatedAt: '2026-10-09T12:00:00.000Z',
    generatedBy: 'test',
    migration: { lockfileV3: 'complete' },
    targets: Object.fromEntries(Object.entries(targets).map(([name, bundles]) => [name, {
      targetType: 'vscode',
      scope: 'user',
      baseDir: '/home/u/.copilot',
      bundles: Object.fromEntries(Object.entries(bundles).map(([bundleKey, seed]) => [
        canonicalTestKey(bundleKey),
        record(seed, name === 'unmanaged')
      ]))
    }]))
  }));
};

const seedV2 = (ports: RecordingPorts, bundleIds: string[]): void => {
  ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
    version: '2.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    generatedBy: 'ai-primitives-hub-cli',
    bundles: Object.fromEntries(bundleIds.map((id) => [id, {
      version: '1.0.0',
      sourceId: 'legacy-source',
      sourceType: 'github',
      installedAt: '2026-01-01T00:00:00.000Z',
      files: [{ path: 'prompts/hello.prompt.md', checksum: 'abc' }]
    }])),
    sources: { 'legacy-source': { type: 'github', url: 'https://github.com/o/r' } }
  }));
};

const seedUnresolved = (
  ports: RecordingPorts,
  entries: { key: string; originalKey: string; version: string }[],
  targetName = 'unmanaged'
): void => {
  ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
    $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
    version: '3.0.0',
    bundles: {},
    sources: {},
    unresolved: entries.map(({ originalKey, version }) => ({
      originalKey, version, reason: 'Portable identity could not be proven.'
    }))
  }));
  ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
    version: '3.0.0',
    generatedAt: '2026-10-09T12:00:00.000Z',
    generatedBy: 'test',
    migration: { lockfileV3: 'complete' },
    targets: {
      [targetName]: {
        baseDir: '/home/u/.copilot',
        bundles: Object.fromEntries(entries.map(({ key: unresolvedKey, originalKey, version }) => [
          unresolvedKey,
          {
            version,
            installedAt: '2026-10-09T12:00:00.000Z',
            state: 'unmanaged',
            unmanagedReason: 'Portable identity could not be proven.',
            legacy: { originalKey, version },
            files: [{ path: 'prompts/legacy.prompt.md', installedChecksum: 'a'.repeat(64) }]
          }
        ]))
      }
    }
  }));
};

const snapshot = (ports: RecordingPorts): [string, string][] =>
  [...ports.files.entries()].map(([file, content]) => [file, typeof content === 'string' ? content : new TextDecoder().decode(content)]);

const mutations = (ports: RecordingPorts): string[] => ports.calls.filter((call) => MUTATING.test(call));

const resolve = (ports: RecordingPorts, typed: string, targetName = 'my-vscode') =>
  resolveUndeployKey({ targetName, typed: canonicalTestKey(typed) }, ports).then(displayResolution);
const listTargetBundles = async (targetName: string, ports: RecordingPorts) => {
  const listing = await listTargetBundlesActual(targetName, ports);
  return {
    ...listing,
    bundles: listing.bundles.map((bundle) => ({ ...bundle, key: displayTestKey(bundle.key) })),
    desiredOnly: listing.desiredOnly.map((entryKey) => displayTestKey(entryKey))
  };
};

describe('resolveUndeployKey', () => {
  it('resolves retained originalKey evidence in the selected named target without writing', async () => {
    const ports = recordingPorts();
    const unresolvedKey = `unresolved/${'c'.repeat(64)}`;
    seedUnresolved(ports, [{ key: unresolvedKey, originalKey: 'legacy-bundle', version: '1.0.0' }], 'my-vscode');
    const before = snapshot(ports);

    expect(await resolve(ports, 'legacy-bundle')).toEqual({
      kind: 'unmanaged',
      key: unresolvedKey,
      version: '1.0.0',
      targetName: 'my-vscode'
    });
    expect(await resolve(ports, 'legacy-bundle', 'other-vscode')).toEqual({ kind: 'none' });
    expect(snapshot(ports)).toEqual(before);
    expect(mutations(ports)).toEqual([]);
  });

  it('merges active logical IDs and retained aliases so a historical alias cannot shadow a live key', async () => {
    const ports = recordingPorts();
    seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });
    const desired = JSON.parse(ports.files.get(ports.lockfileStore.desiredFile) as string) as Record<string, unknown>;
    desired.unresolved = [{
      originalKey: 'web-dev',
      version: '1.0.0',
      reason: 'Portable identity could not be proven.'
    }];
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify(desired));
    const local = JSON.parse(ports.files.get(ports.lockfileStore.localFile) as string) as {
      targets: Record<string, { baseDir: string; bundles: Record<string, Record<string, unknown>> }>;
    };
    const unresolvedKey = `unresolved/${'d'.repeat(64)}`;
    local.targets.unmanaged = {
      baseDir: '/home/u/.copilot',
      bundles: {
        [unresolvedKey]: {
          version: '1.0.0',
          installedAt: '2026-10-09T12:00:00.000Z',
          state: 'unmanaged',
          unmanagedReason: 'Portable identity could not be proven.',
          legacy: { originalKey: 'web-dev', version: '1.0.0' },
          files: [{ path: 'prompts/legacy.prompt.md', installedChecksum: 'a'.repeat(64) }]
        }
      }
    };
    ports.files.set(ports.lockfileStore.localFile, JSON.stringify(local));
    const before = snapshot(ports);

    expect(await resolve(ports, 'web-dev')).toEqual({
      kind: 'ambiguous',
      keys: ['src-a/web-dev', unresolvedKey]
    });
    expect(await resolve(ports, 'src-a/web-dev')).toMatchObject({
      kind: 'match',
      key: 'src-a/web-dev'
    });
    expect(snapshot(ports)).toEqual(before);
    expect(mutations(ports)).toEqual([]);
  });

  it('resolves a desired-only unresolved intent by exact originalKey for retry cleanup', async () => {
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {},
      sources: {},
      unresolved: [{
        originalKey: 'legacy-bundle',
        version: '1.0.0',
        reason: 'Portable identity could not be proven.'
      }]
    }));
    ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'test',
      migration: { lockfileV3: 'complete' },
      targets: {}
    }));
    const before = snapshot(ports);

    expect(await resolve(ports, 'legacy-bundle')).toEqual({
      kind: 'intent',
      key: 'legacy-bundle',
      version: '1.0.0',
      evidence: { originalKey: 'legacy-bundle', version: '1.0.0' }
    });
    expect(snapshot(ports)).toEqual(before);
    expect(mutations(ports)).toEqual([]);
  });

  describe('reserved unmanaged records', () => {
    it('resolves an exact retained originalKey to its unresolved record without writing', async () => {
      const ports = recordingPorts();
      const unresolvedKey = `unresolved/${'a'.repeat(64)}`;
      seedUnresolved(ports, [{ key: unresolvedKey, originalKey: 'legacy-bundle-1.0.0', version: '1.0.0' }]);
      const before = snapshot(ports);

      expect(await resolve(ports, 'legacy-bundle-1.0.0')).toEqual({
        kind: 'unmanaged', key: unresolvedKey, version: '1.0.0'
      });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('keeps exact originalKey lookup ambiguous when retained evidence has multiple records', async () => {
      const ports = recordingPorts();
      seedUnresolved(ports, [
        { key: `unresolved/${'a'.repeat(64)}`, originalKey: 'legacy-bundle', version: '1.0.0' },
        { key: `unresolved/${'b'.repeat(64)}`, originalKey: 'legacy-bundle', version: '2.0.0' }
      ]);
      const before = snapshot(ports);

      expect(await resolve(ports, 'legacy-bundle')).toEqual({
        kind: 'ambiguous',
        keys: [`unresolved/${'a'.repeat(64)}`, `unresolved/${'b'.repeat(64)}`]
      });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it.each(['src-a/web-dev', 'web-dev'])('resolves %s found only under unmanaged without writing', async (typed) => {
      const ports = recordingPorts();
      seedV3(ports, { unmanaged: { 'src-a/web-dev': { sourceId: 'src-a' } } });
      const before = snapshot(ports);
      expect(await resolve(ports, typed)).toEqual({ kind: 'unmanaged', key: 'src-a/web-dev', version: '1.0.0' });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('prefers a real-target bare-id match over an unmanaged match from another source', async () => {
      const ports = recordingPorts();
      seedV3(ports, {
        'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } },
        unmanaged: { 'src-b/web-dev': { sourceId: 'src-b' } }
      });
      expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev' });
    });

    it('does not select unmanaged when another real target owns that same key', async () => {
      const ports = recordingPorts();
      seedV3(ports, {
        other: { 'src-a/web-dev': { sourceId: 'src-a' } },
        unmanaged: { 'src-a/web-dev': { sourceId: 'src-a' } }
      });
      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
    });

    it('keeps ambiguity between two unmanaged source-qualified keys', async () => {
      const ports = recordingPorts();
      seedV3(ports, { unmanaged: {
        'src-a/web-dev': { sourceId: 'src-a' }, 'src-b/web-dev': { sourceId: 'src-b' }
      } });
      expect(await resolve(ports, 'web-dev')).toEqual({
        kind: 'ambiguous', keys: ['src-a/web-dev', 'src-b/web-dev']
      });
    });
  });
  describe('match', () => {
    it('resolves an exact full key to the recorded version and record', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a', version: '2.3.4' } } });

      const result = await resolve(ports, 'src-a/web-dev');

      expect(result).toMatchObject({ kind: 'match', key: 'src-a/web-dev', version: '2.3.4' });
      expect(result.kind === 'match' && result.record.sourceKey).toBe(sourceKeyFor('src-a'));
    });

    it('resolves a bare bundle id to its key', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev', version: '1.0.0' });
    });

    it('does not strip a version suffix from a bare id', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev-1.0.0')).toEqual({ kind: 'none' });
    });

    it('resolves active portable keys from a v3 inventory', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev' });
    });

    it('does not match a key recorded under another target', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'other-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
      expect(await resolve(ports, 'src-a/web-dev')).toEqual({ kind: 'none' });
    });
  });

  describe('none and ambiguous', () => {
    it('is none, and writes nothing, against an empty store', async () => {
      const ports = recordingPorts();

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
      expect(ports.files.size).toBe(0);
      expect(mutations(ports)).toEqual([]);
    });

    it('is none for an id that is not installed, leaving a populated store byte-identical', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });
      const before = snapshot(ports);

      expect(await resolve(ports, 'absent')).toEqual({ kind: 'none' });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('is ambiguous, naming every key, when two sources offer the bare id', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' }, 'src-b/web-dev': { sourceId: 'src-b' } } });
      const before = snapshot(ports);

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'ambiguous', keys: ['src-a/web-dev', 'src-b/web-dev'] });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('lets the full key disambiguate', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' }, 'src-b/web-dev': { sourceId: 'src-b' } } });

      expect(await resolve(ports, 'src-b/web-dev')).toMatchObject({ kind: 'match', key: 'src-b/web-dev' });
    });
  });

  describe('inherited property names', () => {
    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])('never matches the typed id "%s"', async (typed) => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, typed)).toEqual({ kind: 'none' });
    });

    it.each(['constructor', 'toString', '__proto__'])('treats a target named "%s" that is not recorded as holding nothing', async (targetName) => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev', targetName)).toEqual({ kind: 'none' });
      expect((await listTargetBundles(targetName, ports)).bundles).toEqual([]);
    });

    it('resolves a real bundle whose id is "constructor" by bare id and by full key', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/constructor': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'constructor')).toMatchObject({ kind: 'match', key: 'src-a/constructor' });
      expect(await resolve(ports, 'src-a/constructor')).toMatchObject({ kind: 'match', key: 'src-a/constructor' });
    });
  });

  describe('v2 store', () => {
    it('previews the migration in memory and resolves an exact retained original key without writes', async () => {
      const ports = recordingPorts();
      seedV2(ports, ['older-bundle']);
      const before = snapshot(ports);

      expect(await resolve(ports, 'older-bundle')).toMatchObject({
        kind: 'unmanaged',
        key: expect.stringMatching(/^unresolved\/[a-f0-9]{64}$/)
      });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
      expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
    });

    it('resolves against the previewed records of an interrupted migration, without committing it', async () => {
      const ports = recordingPorts();
      seedV2(ports, ['older-bundle']);
      ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
        version: '3.0.0',
        generatedAt: '2026-10-09T12:00:00.000Z',
        generatedBy: 'test',
        targets: { 'my-vscode': { baseDir: '/home/u/.copilot', bundles: { [key('src-a', 'web-dev')]: record({ sourceId: 'src-a' }) } } }
      }));
      const before = snapshot(ports);

      expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev' });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('is ambiguous over an interrupted migration holding two matches, and still writes nothing', async () => {
      const ports = recordingPorts();
      seedV2(ports, ['older-bundle']);
      ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
        version: '3.0.0',
        generatedAt: '2026-10-09T12:00:00.000Z',
        generatedBy: 'test',
        targets: {
          'my-vscode': {
            baseDir: '/home/u/.copilot',
            bundles: { [key('src-a', 'web-dev')]: record({ sourceId: 'src-a' }), [key('src-b', 'web-dev')]: record({ sourceId: 'src-b' }) }
          }
        }
      }));
      const before = snapshot(ports);

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'ambiguous', keys: ['src-a/web-dev', 'src-b/web-dev'] });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('lists nothing for a v2-only store, since its records belong to no real target', async () => {
      const ports = recordingPorts();
      seedV2(ports, ['older-bundle']);
      const before = snapshot(ports);

      expect(await listTargetBundles('my-vscode', ports)).toEqual({ bundles: [], desiredOnly: [] });
      expect(snapshot(ports)).toEqual(before);
    });
  });

  describe('orphaned desired entry', () => {
    const interruptedUninstall = async (): Promise<RecordingPorts> => {
      const ports = recordingPorts();
      await deployBundle(request(), ports);
      const writesSoFar = ports.calls.filter((c) => c.startsWith('writeFile:') || c.startsWith('writeFileBytes:')).length;
      // The undeploy's pair write is local then desired; fail exactly the desired write.
      ports.failWriteAt = writesSoFar + 2;
      await expect(undeployBundle({
        key: portableKeyFor('web-dev'),
        bundle: { bundleId: 'web-dev', version: '1.0.0' },
        scope: 'user',
        targetName: 'my-vscode'
      }, ports)).rejects.toThrow();
      ports.failWriteAt = undefined;
      ports.calls.length = 0;
      return ports;
    };

    it('is an orphan, with the desired entry\'s version, after a desired write failed behind a successful local write', async () => {
      const ports = await interruptedUninstall();
      const local = JSON.parse(ports.files.get(ports.lockfileStore.localFile) as string) as { targets: Record<string, unknown> };
      expect(local.targets['my-vscode']).toBeUndefined();

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'orphan', key: 'github-abc123/web-dev', version: '1.0.0' });
      expect(await resolve(ports, portableKeyFor('web-dev'))).toEqual({ kind: 'orphan', key: 'github-abc123/web-dev', version: '1.0.0' });
      expect(mutations(ports)).toEqual([]);
    });

    it('lets undeployBundle repair the orphan the resolver found', async () => {
      const ports = await interruptedUninstall();
      const resolved = await resolve(ports, 'web-dev');
      expect(resolved.kind).toBe('orphan');

      await undeployBundle({
        key: portableKeyFor('web-dev'),
        bundle: { bundleId: 'web-dev', version: resolved.kind === 'orphan' ? resolved.version : '' },
        scope: 'user',
        targetName: 'my-vscode'
      }, ports);

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
    });

    it('is ambiguous when an orphan and a materialized record share the bare id', async () => {
      const ports = recordingPorts();
      seedV3(
        ports,
        { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } },
        { 'src-a/web-dev': { sourceId: 'src-a' }, 'src-b/web-dev': { sourceId: 'src-b' } }
      );

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'ambiguous', keys: ['src-a/web-dev', 'src-b/web-dev'] });
    });

    it('is ambiguous when two orphans share the bare id', async () => {
      const ports = recordingPorts();
      seedV3(ports, {}, { 'src-a/web-dev': { sourceId: 'src-a' }, 'src-b/web-dev': { sourceId: 'src-b' } });

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'ambiguous', keys: ['src-a/web-dev', 'src-b/web-dev'] });
    });

    it('is not an orphan while another target still materializes the key', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'other-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
      expect(await resolve(ports, 'src-a/web-dev')).toEqual({ kind: 'none' });
    });

    it('does not treat an inherited property name as an orphan', async () => {
      const ports = recordingPorts();
      seedV3(ports, {}, { 'src-a/web-dev': { sourceId: 'src-a' } });

      expect(await resolve(ports, 'constructor')).toEqual({ kind: 'none' });
      expect(await resolve(ports, '__proto__')).toEqual({ kind: 'none' });
    });
  });
});

describe('listTargetBundles', () => {
  it('lists the target\'s records in recorded order and excludes other targets', async () => {
    const ports = recordingPorts();
    seedV3(ports, {
      'my-vscode': { 'src-a/one': { sourceId: 'src-a', version: '1.1.0' }, 'src-b/two': { sourceId: 'src-b', version: '2.0.0' } },
      'other-vscode': { 'src-c/three': { sourceId: 'src-c' } }
    });

    const { bundles } = await listTargetBundles('my-vscode', ports);

    expect(bundles.map((b) => [b.key, b.version])).toEqual([['src-a/one', '1.1.0'], ['src-b/two', '2.0.0']]);
  });

  it('is empty for an absent store and writes nothing', async () => {
    const ports = recordingPorts();

    expect(await listTargetBundles('my-vscode', ports)).toEqual({ bundles: [], desiredOnly: [] });
    expect(ports.files.size).toBe(0);
  });

  describe('desiredOnly', () => {
    it('names desired keys that no target materializes, leaving ones another target holds out', async () => {
      const ports = recordingPorts();
      seedV3(
        ports,
        { 'my-vscode': { 'src-a/kept': { sourceId: 'src-a' } }, 'other-vscode': { 'src-c/theirs': { sourceId: 'src-c' } } },
        {
          'src-a/kept': { sourceId: 'src-a' },
          'src-c/theirs': { sourceId: 'src-c' },
          'src-b/lonely': { sourceId: 'src-b' }
        }
      );

      expect((await listTargetBundles('my-vscode', ports)).desiredOnly).toEqual(['src-b/lonely']);
    });

    it('lists the desired-only keys of an empty target and writes nothing', async () => {
      const ports = recordingPorts();
      seedV3(ports, {}, { 'src-b/lonely': { sourceId: 'src-b' } });
      const before = snapshot(ports);

      expect(await listTargetBundles('my-vscode', ports)).toEqual({ bundles: [], desiredOnly: ['src-b/lonely'] });
      expect(snapshot(ports)).toEqual(before);
      expect(mutations(ports)).toEqual([]);
    });

    it('is empty when every desired key is materialized', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/kept': { sourceId: 'src-a' } } });

      expect((await listTargetBundles('my-vscode', ports)).desiredOnly).toEqual([]);
    });

    it('finds the orphan an interrupted uninstall left behind', async () => {
      const ports = recordingPorts();
      await deployBundle(request(), ports);
      const writesSoFar = ports.calls.filter((c) => c.startsWith('writeFile:') || c.startsWith('writeFileBytes:')).length;
      ports.failWriteAt = writesSoFar + 2;
      await expect(undeployBundle({
        key: portableKeyFor('web-dev'),
        bundle: { bundleId: 'web-dev', version: '1.0.0' },
        scope: 'user',
        targetName: 'my-vscode'
      }, ports)).rejects.toThrow();
      ports.failWriteAt = undefined;

      expect(await listTargetBundles('my-vscode', ports)).toEqual({ bundles: [], desiredOnly: ['github-abc123/web-dev'] });
    });
  });
});

describe('local-only and desired-only v3 pairs', () => {
  const seedLocalOnly = (ports: RecordingPorts): void => {
    seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a', version: '2.0.0' } } });
    ports.files.delete(ports.lockfileStore.desiredFile);
  };
  const seedDesiredOnly = (ports: RecordingPorts): void => {
    seedV3(ports, {}, { 'src-a/web-dev': { sourceId: 'src-a', version: '3.0.0' } });
    ports.files.delete(ports.lockfileStore.localFile);
  };

  it('resolves a local-only pair (desired file absent) by bare id and by full key, writing nothing', async () => {
    const ports = recordingPorts();
    seedLocalOnly(ports);
    const before = snapshot(ports);

    expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev', version: '2.0.0' });
    expect(await resolve(ports, 'src-a/web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev' });
    expect((await listTargetBundles('my-vscode', ports)).bundles.map((b) => b.key)).toEqual(['src-a/web-dev']);
    expect(snapshot(ports)).toEqual(before);
    expect(mutations(ports)).toEqual([]);
  });

  it('resolves a desired-only pair (local file absent) as an orphan when the key is desired, and none otherwise', async () => {
    const ports = recordingPorts();
    seedDesiredOnly(ports);

    expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'orphan', key: 'src-a/web-dev', version: '3.0.0' });
    expect(await resolve(ports, 'src-a/web-dev')).toEqual({ kind: 'orphan', key: 'src-a/web-dev', version: '3.0.0' });
    expect(await resolve(ports, 'absent')).toEqual({ kind: 'none' });
    expect(mutations(ports)).toEqual([]);
  });

  it('undeployBundle removes the recorded files of a local-only pair and drops the record', async () => {
    const ports = recordingPorts();
    seedLocalOnly(ports);
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hello\n');

    const result = await undeployBundle({
      key: key('src-a', 'web-dev'),
      bundle: { bundleId: 'web-dev', version: '2.0.0' },
      scope: 'user',
      targetName: 'my-vscode'
    }, ports);

    expect(result.removed).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
  });
});

describe('undeployBundle with inherited-property target names', () => {
  it.each(['constructor', '__proto__', 'toString'])('treats a missing "%s" target as having no record, without throwing or writing', async (targetName) => {
    const ports = recordingPorts();
    seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });
    const before = snapshot(ports);

    const result = await undeployBundle({
      key: key('src-a', 'web-dev'),
      bundle: { bundleId: 'web-dev', version: '1.0.0' },
      scope: 'user',
      targetName
    }, ports);

    expect(result).toMatchObject({ removed: [], skipped: [] });
    expect(snapshot(ports)).toEqual(before);
    expect(mutations(ports)).toEqual([]);
  });

  it.each(['constructor', '__proto__', 'toString'])('repairs an orphaned desired entry when the target is named "%s"', async (targetName) => {
    const ports = recordingPorts();
    seedV3(ports, {}, { 'src-a/web-dev': { sourceId: 'src-a' } });

    await undeployBundle({
      key: key('src-a', 'web-dev'),
      bundle: { bundleId: 'web-dev', version: '1.0.0' },
      scope: 'user',
      targetName
    }, ports);

    expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
    expect(JSON.parse(ports.files.get(ports.lockfileStore.desiredFile) as string)).toMatchObject({ bundles: {} });
  });
});
