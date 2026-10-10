import * as posix from 'node:path/posix';
import * as win32 from 'node:path/win32';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  readPair,
  recordingPorts,
  request,
  seedLocal,
  skillRequest,
  symlinkPorts,
} from './fixtures';

const undeployRequest = () => ({
  key: 'github-abc123/web-dev',
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  scope: 'user' as const,
  targetName: 'my-vscode'
});

/** A valid v3 desired file matching `undeployRequest()`'s bundle, for tests that hand-seed the local file. */
const desiredSnapshot = (): string => JSON.stringify({
  $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
  version: '3.0.0',
  bundles: { 'github-abc123/web-dev': { version: '1.0.0', sourceId: 'github-abc123' } },
  sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
});

/**
 * Count successful fs writes recorded so far (writeFile/writeFileBytes calls).
 * @param calls
 */
const writeCallCount = (calls: string[]): number =>
  calls.filter((c) => c.startsWith('writeFile:') || c.startsWith('writeFileBytes:')).length;

describe('undeployBundle', () => {
  it('reports an applied migration local write when undeploy fails before migration finishes', async () => {
    const ports = recordingPorts({ failWriteAt: 2 });
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      version: '2.0.0', generatedAt: ports.now, generatedBy: 'test', bundles: {}, sources: {}
    }));
    await expect(undeployBundle(undeployRequest(), ports)).rejects.toMatchObject({
      code: 'BUNDLE.UNDEPLOY_FAILED',
      context: { appliedEffects: { stage: 'migrate', written: [ports.lockfileStore.localFile], removed: [] } },
      cause: expect.any(Error)
    });
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

  it('rejects Windows traversal before reaching a native-normalizing remove boundary', async () => {
    const ports = recordingPorts();
    const outside = win32.normalize('C:/outside.txt');
    ports.files.set(outside, '# outside\n');
    ports.files.set(ports.lockfileStore.desiredFile, desiredSnapshot());
    ports.files.set(ports.lockfileStore.localFile, seedLocal([
      { path: '..\\outside.txt', installedChecksum: 'h' }
    ]).replace('/home/u/.copilot', 'C:/root'));
    const exists = ports.fs.exists.bind(ports.fs);
    ports.fs.exists = async (destination) => ports.files.has(win32.normalize(destination)) || exists(destination);
    ports.fs.remove = (destination) => {
      ports.files.delete(win32.normalize(destination));
      return Promise.resolve();
    };
    const result = await undeployBundle(undeployRequest(), ports);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(ports.files.get(outside)).toBe('# outside\n');
  });

  const unsafeRecords = ['C:relative.txt', 'C:/absolute.txt', '\\\\server\\share\\file', 'nested\\file', 'a/../file', './file', 'a//file', ''];
  it.each(unsafeRecords)('does not remove the noncanonical recorded path %s', async (recordedPath) => {
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, desiredSnapshot());
    ports.files.set(ports.lockfileStore.localFile, seedLocal([{ path: recordedPath, installedChecksum: 'h' }]));
    const protectedPath = posix.join('/home/u/.copilot', recordedPath);
    ports.files.set(protectedPath, '# protected\n');
    const remove = ports.fs.remove.bind(ports.fs);
    ports.fs.remove = async (destination, options) => {
      if (!destination.includes('.lock.json')) {
        throw new Error('unsafe path reached removal');
      }
      return remove(destination, options);
    };
    const result = await undeployBundle(undeployRequest(), ports);
    expect(result.removed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(ports.files.get(protectedPath)).toBe('# protected\n');
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
      ...undeployRequest(), key: 'github-abc123/skills'
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
    expect(readPair(ports).local.targets['my-vscode'].bundles['github-abc123/skills']).toBeDefined();
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
    expect(desired.bundles['github-abc123/web-dev']).toBeUndefined();
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
      seedLocal([{ path: 'prompts/renamed-by-manifest.prompt.md', installedChecksum: 'h' }])
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

  it('does not remove a recorded path that is absolute or escapes baseDir, but still removes a normal one', async () => {
    // Recorded paths are contract-relative to baseDir (§5.7). `posix.join`
    // would silently re-prefix an absolute recorded path onto baseDir
    // (leaving the real file untouched while the record is dropped), and a
    // '..'-escaping path would reach outside the target's tree entirely.
    // Neither is acted on.
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, desiredSnapshot());
    ports.files.set(ports.lockfileStore.localFile, seedLocal([
      { path: '/home/u/.copilot/prompts/absolute-leftover.prompt.md', installedChecksum: 'a' },
      { path: '../outside/escape.prompt.md', installedChecksum: 'b' },
      { path: 'prompts/hello.prompt.md', installedChecksum: 'c' }
    ]));
    ports.files.set('/home/u/.copilot/prompts/absolute-leftover.prompt.md', '# absolute leftover\n');
    ports.files.set('/home/u/outside/escape.prompt.md', '# escape leftover\n');
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hello\n');

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(result.skipped).toEqual(expect.arrayContaining([
      '/home/u/.copilot/prompts/absolute-leftover.prompt.md',
      '/home/u/outside/escape.prompt.md'
    ]));
    expect(result.skipped).toHaveLength(2);
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.get('/home/u/.copilot/prompts/absolute-leftover.prompt.md')).toBe('# absolute leftover\n');
    expect(ports.files.get('/home/u/outside/escape.prompt.md')).toBe('# escape leftover\n');
  });

  it('does not remove a recorded path that resolves to baseDir itself (., a/.., a/../)', async () => {
    // A recorded path that normalizes away to baseDir (via `.`, a same-level
    // `..`, or either with a trailing slash) must not reach
    // `fs.remove(baseDir)`: the real filesystem's non-recursive remove
    // (infra/fs/node-filesystem.ts) rejects a directory, which would throw
    // before the record could ever be dropped. A real file nested under
    // baseDir is required so the mock's prefix-based `exists` reports
    // baseDir as existing, the same way a real directory with contents does
    // — otherwise this would pass vacuously via the "already absent" path.
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, desiredSnapshot());
    ports.files.set(ports.lockfileStore.localFile, seedLocal([
      { path: '.', installedChecksum: 'a' },
      { path: 'a/..', installedChecksum: 'b' },
      { path: 'a/../', installedChecksum: 'c' }
    ]));
    ports.files.set('/home/u/.copilot/prompts/unrelated.prompt.md', '# unrelated\n');

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(ports.calls.filter((c) => c.startsWith('remove:'))).toEqual([]);
    expect(ports.calls).not.toContain('remove:/home/u/.copilot');
    expect(ports.files.get('/home/u/.copilot/prompts/unrelated.prompt.md')).toBe('# unrelated\n');
    // Still drops the record: the user asked to uninstall, even though none
    // of its recorded paths were safe to act on.
    const { local } = readPair(ports);
    expect(local.targets['my-vscode']).toBeUndefined();
  });

  it('is a no-op for a bundle that is not recorded', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const writesBefore = writeCallCount(ports.calls);
    const localBefore = ports.files.get(ports.lockfileStore.localFile);
    const desiredBefore = ports.files.get(ports.lockfileStore.desiredFile);

    const result = await undeployBundle({ ...undeployRequest(), key: 'github-abc123/absent' }, ports);

    expect(result.removed).toEqual([]);
    const { local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
    // An uninstall of a never-installed key is a true no-op: it rewrites
    // nothing, not even redundantly with unchanged content.
    expect(writeCallCount(ports.calls)).toBe(writesBefore);
    expect(ports.files.get(ports.lockfileStore.localFile)).toBe(localBefore);
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(desiredBefore);
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
    expect(afterFailure.desired.bundles['github-abc123/web-dev']).toBeDefined();

    ports.failWriteAt = undefined;
    const result = await undeployBundle(undeployRequest(), ports);

    const afterRetry = readPair(ports);
    expect(afterRetry.desired.bundles['github-abc123/web-dev']).toBeUndefined();
    expect(result.removed).toEqual([]);
  });

  it('leaves another target holding the same bundle untouched', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { local } = readPair(ports);
    expect(local.targets['other-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
    expect(await ports.fs.readFile('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('skips a shared physical destination owned by another logical bundle', async () => {
    const ports = recordingPorts();
    const req = request();
    const first = await deployBundle(req, ports);
    const other = await deployBundle({
      ...req, source: { ...req.source, sourceId: 'github-other' }
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
    expect(desired.bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('migrates a v2 lockfile before an uninstall, since uninstall is a migration trigger', async () => {
    // FR-16 permits migration on install, update *and* uninstall; a flag-on
    // uninstall must be able to find records a v2 install left behind.
    const ports = recordingPorts();
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        'web-dev': {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: 'x', files: [{ path: 'prompts/hello.prompt.md', checksum: 'h' }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    }));

    const result = await undeployBundle(undeployRequest(), ports);

    const { desired } = readPair(ports);
    expect(desired.version).toBe('3.0.0');
    // The record went unmanaged (bundle-relative path, unprovable), so the
    // files are left alone and reported rather than guessed at.
    expect(result.removed).toEqual([]);
    expect(result.migration?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/web-dev']);
  });

  it('does not remove files for an unmanaged record, surfaces the reason, and still drops the record', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# pre-existing\n');
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {},
      sources: {}
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
            'github-abc123/web-dev': {
              version: '1.0.0', sourceId: 'github-abc123', installedAt: 'x',
              state: 'unmanaged', unmanagedReason: 'destination could not be proven',
              files: [{ path: 'prompts/hello.prompt.md' }]
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
      { ...undeployRequest(), key: 'github-abc123/skills', bundle: { bundleId: 'skills', version: '1.0.0' } },
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
