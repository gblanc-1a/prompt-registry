import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  resolveRecordedPath,
} from '../../src/deploy/safety';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  portableKeyFor,
  readPair,
  recordingPorts,
  request,
  seedLocal,
  skillRequest,
  symlinkPorts,
  TEST_SOURCE,
  TEST_SOURCE_KEY,
} from './fixtures';

const undeployRequest = () => ({
  key: portableKeyFor('web-dev'),
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  scope: 'user' as const,
  targetName: 'my-vscode'
});

/** A valid v3 desired file matching `undeployRequest()`'s bundle, for tests that hand-seed the local file. */
const desiredSnapshot = (): string => JSON.stringify({
  $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
  version: '3.0.0',
  bundles: {
    [portableKeyFor('web-dev')]: {
      version: '1.0.0', sourceKey: TEST_SOURCE_KEY, resolution: request().resolution
    }
  },
  sources: { [TEST_SOURCE_KEY]: TEST_SOURCE }
});

/**
 * Count successful fs writes recorded so far (writeFile/writeFileBytes calls).
 * @param calls
 */
const writeCallCount = (calls: string[]): number =>
  calls.filter((c) => c.startsWith('writeFile:') || c.startsWith('writeFileBytes:')).length;

describe('undeployBundle', () => {
  it('does not migrate an empty legacy store when an uninstall lookup has no match', async () => {
    const ports = recordingPorts({ failWriteAt: 2 });
    const legacy = JSON.stringify({
      version: '2.0.0', generatedAt: ports.now, generatedBy: 'test', bundles: {}, sources: {}
    });
    ports.files.set(ports.lockfileStore.desiredFile, legacy);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(result.migration).toBeNull();
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(legacy);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
    expect(writeCallCount(ports.calls)).toBe(0);
  });
  it.each(['destination', 'ancestor'])('skips recorded paths reached through a linked %s', async (scenario) => {
    const ports = symlinkPorts();
    await deployBundle(request(), ports);
    const destination = '/home/u/.copilot/prompts/hello.prompt.md';
    const unsafe = scenario === 'destination' ? destination : '/home/u/.copilot/prompts';
    const sourcePath = scenario === 'destination' ? '/live/prompt.md' : '/live/prompts/hello.prompt.md';
    ports.links.set(unsafe, scenario === 'destination' ? sourcePath : '/live/prompts');
    ports.files.set(sourcePath, '# live source\n');
    const result = await undeployBundle(undeployRequest(), ports);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toContain(destination);
    expect(ports.files.get(sourcePath)).toBe('# live source\n');
  });

  it.each([
    'C:relative.txt',
    'C:/absolute.txt',
    '\\\\server\\share\\file',
    'nested\\file',
    'a/../file',
    './file',
    'a//file',
    '',
    '/home/u/.copilot/prompts/absolute-leftover.prompt.md',
    '../outside/escape.prompt.md',
    '.',
    'a/..',
    'a/../'
  ])('rejects noncanonical or escaping recorded paths before removal: %s', (recordedPath) => {
    expect(resolveRecordedPath('/home/u/.copilot', recordedPath).safe).toBe(false);
  });
  it.each([
    'C:\\outside\\escape.prompt.md',
    '..\\outside\\escape.prompt.md'
  ])('refuses an invalid Windows recorded path through public undeploy without mutation: %s', async (recordedPath) => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const local = readPair(ports).local;
    local.targets['my-vscode'].bundles[portableKeyFor('web-dev')].files[0].path = recordedPath;
    ports.files.set(ports.lockfileStore.localFile, JSON.stringify(local));
    const protectedFile = '/outside/escape.prompt.md';
    ports.files.set(protectedFile, '# keep\n');
    const before = [...ports.files];
    const callsBefore = ports.calls.length;

    await expect(undeployBundle(undeployRequest(), ports))
      .rejects.toMatchObject({ code: 'CONFIG.INVALID_LOCKFILE_V3' });

    expect([...ports.files]).toEqual(before);
    expect(ports.files.get(protectedFile)).toBe('# keep\n');
    expect(ports.calls.slice(callsBefore).filter((call) =>
      /^(writeFile|writeFileBytes|rename|remove|mkdir):/.test(call))).toEqual([]);
  });
  it('reports the paths already removed when a later removal fails', async () => {
    const ports = recordingPorts();
    await deployBundle(skillRequest(), ports);
    const remove = ports.fs.remove.bind(ports.fs);
    const first = '/home/u/.copilot/skills/my-skill/SKILL.md';
    ports.fs.remove = async (destination) => {
      if (destination.endsWith('config.json')) {
        throw new Error('removal refused');
      }
      return remove(destination);
    };

    await expect(undeployBundle({
      ...undeployRequest(), key: portableKeyFor('skills')
    }, ports)).rejects.toMatchObject({
      code: 'BUNDLE.UNDEPLOY_FAILED',
      cause: expect.any(Error),
      context: { appliedEffects: {
        stage: 'remove',
        removed: [first],
        written: [],
        created: [],
        cleanedUp: [],
        cleanupFailures: []
      } }
    });
    expect(ports.files.has(first)).toBe(false);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/config.json')).toBe(true);
    expect(readPair(ports).local.targets['my-vscode'].bundles[portableKeyFor('skills')]).toBeDefined();
  });
  it('removes exactly the recorded paths and nothing else', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/unrelated.prompt.md', '# mine\n');
    await deployBundle(request(), ports);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.get('/home/u/.copilot/prompts/unrelated.prompt.md')).toBe('# mine\n');
  });

  it('drops both the desired entry and the materialization', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);

    await undeployBundle(undeployRequest(), ports);

    const { desired, local } = readPair(ports);
    expect(desired.bundles[portableKeyFor('web-dev')]).toBeUndefined();
    expect(local.targets['my-vscode']).toBeUndefined();
  });

  it('does not recompute destinations from the manifest', async () => {
    // The record is the only source of truth for removal (§5.7): a path a
    // manifest-driven rename would never have produced must still be
    // removed, and any attempt to consult a bundle/manifest/layout boundary
    // (here, `layoutLoader`, the only such boundary on DeployPorts) throws —
    // proving undeployBundle never reaches for one.
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, desiredSnapshot());
    ports.files.set(
      ports.lockfileStore.localFile,
      seedLocal([{ path: 'prompts/renamed-by-manifest.prompt.md', installedChecksum: 'a'.repeat(64) }])
    );
    ports.files.set('/home/u/.copilot/prompts/renamed-by-manifest.prompt.md', '# hi\n');
    ports.layoutLoader = new Proxy({}, {
      get: (): never => {
        throw new Error('layoutLoader must not be touched by undeployBundle');
      }
    });

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual(['/home/u/.copilot/prompts/renamed-by-manifest.prompt.md']);
  });

  it('reports a recorded path that is already gone as skipped, not an error', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    ports.files.delete('/home/u/.copilot/prompts/hello.prompt.md');

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
  });

  it('is a no-op for a bundle that is not recorded', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const writesBefore = writeCallCount(ports.calls);
    const localBefore = ports.files.get(ports.lockfileStore.localFile);
    const desiredBefore = ports.files.get(ports.lockfileStore.desiredFile);

    const result = await undeployBundle({ ...undeployRequest(), key: portableKeyFor('absent') }, ports);

    expect(result.removed).toEqual([]);
    const { local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles[portableKeyFor('web-dev')]).toBeDefined();
    // An uninstall of a never-installed key is a true no-op: it rewrites
    // nothing, not even redundantly with unchanged content.
    expect(writeCallCount(ports.calls)).toBe(writesBefore);
    expect(ports.files.get(ports.lockfileStore.localFile)).toBe(localBefore);
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(desiredBefore);
  });

  it('does not persist legacy migration when an offline uninstall lookup matches nothing', async () => {
    const ports = recordingPorts();
    const legacy = JSON.stringify({
      version: '2.0.0',
      generatedAt: ports.now,
      generatedBy: 'test',
      bundles: {
        'historical-agent': {
          version: '1.0.0',
          sourceId: 'machine-source',
          sourceType: 'github',
          installedAt: ports.now,
          checksum: 'a'.repeat(64),
          files: [{ path: 'agents/historical.md', checksum: 'b'.repeat(64) }]
        }
      },
      sources: {
        'machine-source': { type: 'github', url: 'https://github.com/acme/agents' }
      }
    });
    ports.files.set(ports.lockfileStore.desiredFile, legacy);

    const result = await undeployBundle({ ...undeployRequest(), key: 'unrelated/absent' }, ports);

    expect(result.removed).toEqual([]);
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(legacy);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
    expect(writeCallCount(ports.calls)).toBe(0);
  });

  it('creates no lockfile files when undeploying from a fresh store', async () => {
    const ports = recordingPorts();
    // No prior deploy: this store has never had a lockfile written at all.

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
    expect(ports.files.has(ports.lockfileStore.desiredFile)).toBe(false);
    expect(writeCallCount(ports.calls)).toBe(0);
  });

  it('converges a failed desired write on retry instead of silently no-opping', async () => {
    // §8.4: the pair write is local-then-desired, not one transaction. If a
    // prior attempt's local write succeeded but its desired write failed, the
    // naive early-return (record absent → no-op) would leave desired
    // permanently requesting an uninstalled bundle.
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const writesSoFar = writeCallCount(ports.calls);
    // The undeploy's pair write is local (writesSoFar+1) then desired
    // (writesSoFar+2); fail exactly the desired write.
    ports.failWriteAt = writesSoFar + 2;

    await expect(undeployBundle(undeployRequest(), ports)).rejects.toThrow();

    // Proves the injection fired on the intended write: local already lost
    // the record, but desired still carries the now-orphaned entry.
    const afterFailure = readPair(ports);
    expect(afterFailure.local.targets['my-vscode']).toBeUndefined();
    expect(afterFailure.desired.bundles[portableKeyFor('web-dev')]).toBeDefined();

    ports.failWriteAt = undefined;
    const result = await undeployBundle(undeployRequest(), ports);

    const afterRetry = readPair(ports);
    expect(afterRetry.desired.bundles[portableKeyFor('web-dev')]).toBeUndefined();
    expect(result.removed).toEqual([]);
  });

  it('leaves another target holding the same bundle untouched', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { local } = readPair(ports);
    expect(local.targets['other-vscode'].bundles[portableKeyFor('web-dev')]).toBeDefined();
    expect(await ports.fs.readFile('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('skips a shared physical destination owned by another logical bundle', async () => {
    const ports = recordingPorts();
    const req = request();
    const first = await deployBundle(req, ports);
    const other = await deployBundle({
      ...req, bundle: { ...req.bundle, bundleId: 'another-logical-id' }
    }, ports);
    const destination = '/home/u/.copilot/prompts/hello.prompt.md';
    const result = await undeployBundle(undeployRequest(), ports);
    expect(result.removed).toEqual([]);
    expect(result.shared).toEqual([destination]);
    expect(result.skipped).toEqual([destination]);
    expect(await ports.fs.readFile(destination)).toBe('# Hello Prompt\n');
    expect(readPair(ports).local.targets[req.targetName].bundles[other.key]).toBeDefined();
    expect(readPair(ports).local.targets[req.targetName].bundles[first.key]).toBeUndefined();
    await undeployBundle({ ...undeployRequest(), key: other.key }, ports);
    expect(ports.files.has(destination)).toBe(false);
  });

  it('keeps the desired entry while another target still materializes the bundle', async () => {
    // Desired state is per repository/machine, not per target; dropping it
    // while a second target still holds files would orphan that record.
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { desired } = readPair(ports);
    expect(desired.bundles[portableKeyFor('web-dev')]).toBeDefined();
  });

  it('does not persist unrelated v2 intent when an uninstall cannot prove an ownership match', async () => {
    const ports = recordingPorts();
    const legacy = JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        'web-dev': {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: ports.now, files: [{ path: 'prompts/hello.prompt.md', checksum: 'a'.repeat(64) }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    });
    ports.files.set(ports.lockfileStore.desiredFile, legacy);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(result.migration).toBeNull();
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(legacy);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
    expect(writeCallCount(ports.calls)).toBe(0);
  });

  it('does not remove files for an unmanaged record, surfaces the reason, and still drops the record', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# pre-existing\n');
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {},
      sources: { [TEST_SOURCE_KEY]: TEST_SOURCE }
    }));
    ports.files.set(ports.lockfileStore.localFile, JSON.stringify({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        unmanaged: {
          targetType: 'vscode', scope: 'user', baseDir: '/home/u/.copilot',
          bundles: {
            [portableKeyFor('web-dev')]: {
              version: '1.0.0',
              sourceKey: TEST_SOURCE_KEY,
              resolution: request().resolution,
              installedAt: '2026-10-09T12:00:00.000Z',
              state: 'unmanaged', unmanagedReason: 'destination could not be proven',
              files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
            }
          }
        }
      }
    }));

    const result = await undeployBundle({ ...undeployRequest(), targetName: 'unmanaged' }, ports);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# pre-existing\n');
    expect(result.unmanagedReason).toBe('destination could not be proven');
    // §8.3 retains the record for cleanup/refcounting only until an explicit
    // uninstall; the user asked to uninstall, so the record itself goes.
    const { local } = readPair(ports);
    expect(local.targets.unmanaged).toBeUndefined();
  });

  it('removes every recorded subtree file for a directory-kind bundle, leaving an untracked sibling alone', async () => {
    const ports = recordingPorts();
    await deployBundle(skillRequest(), ports);
    // Untracked sibling living inside the same skill directory, never recorded.
    ports.files.set('/home/u/.copilot/skills/my-skill/untracked.txt', '# not ours\n');

    const result = await undeployBundle(
      { ...undeployRequest(), key: portableKeyFor('skills'), bundle: { bundleId: 'skills', version: '1.0.0' } },
      ports
    );

    expect(result.removed.toSorted()).toEqual([
      '/home/u/.copilot/skills/my-skill/SKILL.md',
      '/home/u/.copilot/skills/my-skill/binary.dat',
      '/home/u/.copilot/skills/my-skill/config.json'
    ].toSorted());
    expect(ports.files.get('/home/u/.copilot/skills/my-skill/untracked.txt')).toBe('# not ours\n');
    // Removal is per recorded file, never per directory: no remove call
    // targets the directory path itself, and exactly one remove call exists
    // per recorded file (observed: this leaves the now-empty
    // `skills/my-skill/` directory behind — §5.7 forbids recomputing which
    // directories became empty, so undeployBundle does not prune it).
    const removeCalls = ports.calls.filter((c) => c.startsWith('remove:'));
    expect(removeCalls).toHaveLength(3);
    expect(removeCalls).not.toContain('remove:/home/u/.copilot/skills/my-skill');
  });
});
