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
} from './fixtures';

const undeployRequest = () => ({
  key: 'github-abc123/web-dev',
  bundle: { bundleId: 'web-dev', version: '1.0.0' },
  scope: 'user' as const,
  targetName: 'my-vscode'
});

describe('undeployBundle', () => {
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
    // The record is the only source of truth for removal (§5.7). An
    // undeploy with no bundle bytes in hand must still remove the files.
    const ports = recordingPorts();
    await deployBundle(request(), ports);

    const result = await undeployBundle(undeployRequest(), ports);

    expect(result.removed).toHaveLength(1);
    expect(ports.calls.some((c) => c.startsWith('extract:'))).toBe(false);
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

    const result = await undeployBundle({ ...undeployRequest(), key: 'github-abc123/absent' }, ports);

    expect(result.removed).toEqual([]);
    const { local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
  });

  it('leaves another target holding the same bundle untouched', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    await deployBundle({ ...request(), targetName: 'other-vscode' }, ports);

    await undeployBundle(undeployRequest(), ports);

    const { local } = readPair(ports);
    expect(local.targets['other-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
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

  it('does not remove files for an unmanaged record', async () => {
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
  });
});
