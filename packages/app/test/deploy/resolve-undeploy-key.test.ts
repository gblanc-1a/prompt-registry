import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  listTargetBundles,
  resolveUndeployKey,
} from '../../src/deploy/resolve-undeploy-key';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  type RecordingPorts,
  recordingPorts,
  request,
} from './fixtures';

const MUTATING = /^(writeFile|writeFileBytes|rename|remove|mkdir):/;

interface SeedRecord {
  version?: string;
  sourceId: string;
}

const record = (seed: SeedRecord): object => ({
  version: seed.version ?? '1.0.0',
  sourceId: seed.sourceId,
  installedAt: '2026-10-09T12:00:00.000Z',
  files: [{ path: 'prompts/hello.prompt.md' }]
});

const seedV3 = (
  ports: RecordingPorts,
  targets: Record<string, Record<string, SeedRecord>>,
  desired: Record<string, SeedRecord> = Object.fromEntries(
    Object.values(targets).flatMap((bundles) => Object.entries(bundles))
  )
): void => {
  ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
    version: '3.0.0',
    bundles: Object.fromEntries(Object.entries(desired).map(([key, seed]) => [key, { version: seed.version ?? '1.0.0', sourceId: seed.sourceId }])),
    sources: {}
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
      bundles: Object.fromEntries(Object.entries(bundles).map(([key, seed]) => [key, record(seed)]))
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

const snapshot = (ports: RecordingPorts): [string, string][] =>
  [...ports.files.entries()].map(([file, content]) => [file, typeof content === 'string' ? content : new TextDecoder().decode(content)]);

const mutations = (ports: RecordingPorts): string[] => ports.calls.filter((call) => MUTATING.test(call));

const resolve = (ports: RecordingPorts, typed: string, targetName = 'my-vscode') =>
  resolveUndeployKey({ targetName, typed }, ports);

describe('resolveUndeployKey', () => {
  describe('match', () => {
    it('resolves an exact full key to the recorded version and record', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a', version: '2.3.4' } } });

      const result = await resolve(ports, 'src-a/web-dev');

      expect(result).toMatchObject({ kind: 'match', key: 'src-a/web-dev', version: '2.3.4' });
      expect(result.kind === 'match' && result.record.sourceId).toBe('src-a');
    });

    it('resolves a bare bundle id to its key', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev')).toMatchObject({ kind: 'match', key: 'src-a/web-dev', version: '1.0.0' });
    });

    it('strips a legacy version suffix from a bare id', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'src-a/web-dev': { sourceId: 'src-a' } } });

      expect(await resolve(ports, 'web-dev-1.0.0')).toMatchObject({ kind: 'match', key: 'src-a/web-dev' });
    });

    it('skips record keys that are not source/bundle keys instead of failing', async () => {
      const ports = recordingPorts();
      seedV3(ports, { 'my-vscode': { 'no-slash': { sourceId: 'x' }, 'a/b/c': { sourceId: 'x' }, 'src-a/web-dev': { sourceId: 'src-a' } } });

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
    it('previews the migration in memory: no match leaves the store byte-identical and writes nothing', async () => {
      const ports = recordingPorts();
      seedV2(ports, ['older-bundle']);
      const before = snapshot(ports);

      expect(await resolve(ports, 'older-bundle')).toEqual({ kind: 'none' });
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
        targets: { 'my-vscode': { baseDir: '/home/u/.copilot', bundles: { 'src-a/web-dev': record({ sourceId: 'src-a' }) } } }
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
            bundles: { 'src-a/web-dev': record({ sourceId: 'src-a' }), 'src-b/web-dev': record({ sourceId: 'src-b' }) }
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
        key: 'github-abc123/web-dev',
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
      expect(await resolve(ports, 'github-abc123/web-dev')).toEqual({ kind: 'orphan', key: 'github-abc123/web-dev', version: '1.0.0' });
      expect(mutations(ports)).toEqual([]);
    });

    it('lets undeployBundle repair the orphan the resolver found', async () => {
      const ports = await interruptedUninstall();
      const resolved = await resolve(ports, 'web-dev');
      expect(resolved.kind).toBe('orphan');

      await undeployBundle({
        key: 'github-abc123/web-dev',
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
        key: 'github-abc123/web-dev',
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
      key: 'src-a/web-dev',
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
      key: 'src-a/web-dev',
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
      key: 'src-a/web-dev',
      bundle: { bundleId: 'web-dev', version: '1.0.0' },
      scope: 'user',
      targetName
    }, ports);

    expect(await resolve(ports, 'web-dev')).toEqual({ kind: 'none' });
    expect(JSON.parse(ports.files.get(ports.lockfileStore.desiredFile) as string)).toMatchObject({ bundles: {} });
  });
});
