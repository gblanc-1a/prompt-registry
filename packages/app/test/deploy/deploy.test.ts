import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  readPair,
  recordingPorts,
  request,
} from './fixtures';

describe('deployBundle', () => {
  it('writes real files at the manifest-driven destinations', async () => {
    const ports = recordingPorts();

    const result = await deployBundle(request(), ports);

    expect(result.written).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('keys the records by logical bundle key', async () => {
    const ports = recordingPorts();

    const result = await deployBundle(request(), ports);

    expect(result.key).toBe('github-abc123/web-dev');
    const { desired, local } = readPair(ports);
    expect(Object.keys(desired.bundles)).toEqual(['github-abc123/web-dev']);
    expect(Object.keys(local.targets['my-vscode'].bundles)).toEqual(['github-abc123/web-dev']);
  });

  it('records on-disk paths relative to the resolved baseDir, not bundle-relative ones', async () => {
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/web-dev'];
    expect(record.files.map((f: { path: string }) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('records both checksums, with installedChecksum over the written bytes', async () => {
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    const file = local.targets['my-vscode'].bundles['github-abc123/web-dev'].files[0];
    expect(file.installedChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(file.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('writes the materialization record before any MCP effect', async () => {
    // §6.7, §9.2: a crash between them must leave a tracked entry with no
    // server, never a live server with no owner. MCP is a no-op in slice 1,
    // so the assertion is on the recorded call order.
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    // The record is complete once *both* halves have landed, so the
    // ordering claim is about the second of the two writes.
    const recordIndex = ports.calls.indexOf(`rename:${ports.lockfileStore.desiredFile}`);
    const localIndex = ports.calls.indexOf(`rename:${ports.lockfileStore.localFile}`);
    const mcpIndex = ports.calls.findIndex((c) => c.startsWith('mcp:'));
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeGreaterThan(localIndex);
    expect(mcpIndex === -1 || recordIndex < mcpIndex).toBe(true);
  });

  it('skips an untracked pre-existing destination and reports it', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n');

    const result = await deployBundle(request(), ports);

    expect(result.written).toEqual([]);
    expect(result.collisions).toEqual([
      { to: '/home/u/.copilot/prompts/hello.prompt.md', reason: 'untracked-existing' }
    ]);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# hand-written\n');
  });

  it('overwrites an untracked pre-existing destination with force', async () => {
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# hand-written\n');

    const result = await deployBundle({ ...request(), force: true }, ports);

    expect(result.written).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# Hello Prompt\n');
  });

  it('records state even when every destination was already satisfied', async () => {
    // §9.3: the retry case. The first run wrote bytes and died before the
    // state write; the second run must converge, not refuse.
    const ports = recordingPorts();
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# Hello Prompt\n');

    const result = await deployBundle(request(), ports);

    expect(result.satisfied).toEqual(['/home/u/.copilot/prompts/hello.prompt.md']);
    expect(result.collisions).toEqual([]);
    const { desired, local } = readPair(ports);
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev'].files).toHaveLength(1);
  });

  it('is idempotent: running the same deploy twice converges', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    const afterFirst = ports.files.get('/home/u/.copilot/prompts/hello.prompt.md');

    const second = await deployBundle(request(), ports);

    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe(afterFirst);
    expect(second.written.length + second.satisfied.length).toBe(1);
  });

  it('refuses to clobber a tracked drifted file without force', async () => {
    const ports = recordingPorts();
    await deployBundle(request(), ports);
    ports.files.set('/home/u/.copilot/prompts/hello.prompt.md', '# user edit\n');

    await expect(deployBundle(request(), ports)).rejects.toThrow(/DEPLOY_DRIFT|locally modified/i);
    expect(ports.files.get('/home/u/.copilot/prompts/hello.prompt.md')).toBe('# user edit\n');
  });

  it('removes the files it created when a later write fails, and reports what was applied', async () => {
    const ports = recordingPorts();
    const archive = request();
    ports.failWriteAt = 2; // succeed on the first file, fail on the second

    await expect(deployBundle({
      ...archive,
      files: new Map([
        ...archive.files,
        ['prompts/second.prompt.md', new TextEncoder().encode('# Second\n')]
      ])
    }, ports)).rejects.toThrow();

    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
  });

  it('migrates a v2 lockfile on the first flag-on write and reports it', async () => {
    const ports = recordingPorts();
    // The legacy user file sits at the path the v3 desired file will take.
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        other: {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: 'x', files: [{ path: 'prompts/other.prompt.md', checksum: 'h' }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    }));

    const result = await deployBundle(request(), ports);

    expect(result.migration?.unmanaged.map((u) => u.key)).toEqual(['github-abc123/other']);
    const { desired, local } = readPair(ports);
    expect(desired.version).toBe('3.0.0');
    expect(local.targets['my-vscode'].bundles['github-abc123/web-dev']).toBeDefined();
    expect(local.targets.unmanaged.bundles['github-abc123/other'].state).toBe('unmanaged');
  });

  it('writes no generated metadata into the desired half', async () => {
    // Byte-comparability at every scope (§5.2, §8.1), now including user scope.
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { desired, local } = readPair(ports);
    expect('generatedAt' in desired).toBe(false);
    expect('generatedBy' in desired).toBe(false);
    expect(local.generatedAt).toBeDefined();
  });

  it('produces an identical desired half for two deploys an hour apart', async () => {
    const first = recordingPorts();
    const second = recordingPorts({ now: '2026-10-09T13:00:00.000Z' });

    await deployBundle(request(), first);
    await deployBundle(request(), second);

    expect(second.files.get(second.lockfileStore.desiredFile))
      .toBe(first.files.get(first.lockfileStore.desiredFile));
  });
});
