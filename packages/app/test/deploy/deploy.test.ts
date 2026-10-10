import {
  createHash,
} from 'node:crypto';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  deployBundle,
} from '../../src/deploy/deploy';
import {
  planDeploy,
} from '../../src/deploy/plan';
import {
  undeployBundle,
} from '../../src/deploy/undeploy';
import {
  governedSkillArchive,
  promptArchive,
  readPair,
  recordingPorts,
  request,
  skillArchiveVersioned,
  skillRequest,
  symlinkPorts,
  twoItemArchive,
  upgradePromptRequest,
  upgradeSkillRequest,
} from './fixtures';

describe('deployBundle', () => {
  it('preserves archive checksum refusal before migration for a mismatched bytes-only request', async () => {
    const ports = recordingPorts();
    const legacy = JSON.stringify({
      version: '2.0.0', generatedAt: ports.now, generatedBy: 'test', bundles: {}, sources: {}
    });
    ports.files.set(ports.lockfileStore.desiredFile, legacy);
    const bytes = new TextEncoder().encode('archive bytes');
    const expectedArchiveSha = `sha256:${createHash('sha256').update('other archive bytes').digest('hex')}`;
    await expect(deployBundle({ ...request(), files: undefined, bytes, expectedArchiveSha }, ports))
      .rejects.toMatchObject({ code: 'BUNDLE.ARCHIVE_MISMATCH' });
    expect([...ports.files]).toEqual([[ports.lockfileStore.desiredFile, legacy]]);
    expect(ports.calls).toEqual([]);
  });
  for (const scenario of ['destination', 'ancestor'] as const) {
    it(`refuses a symbolic-link ${scenario} before any effect, even with force`, async () => {
      const ports = symlinkPorts();
      const req = scenario === 'destination' ? request() : skillRequest();
      const unsafe = scenario === 'destination'
        ? '/home/u/.copilot/prompts/hello.prompt.md'
        : '/home/u/.copilot/skills';
      const source = '/live/source';
      ports.links.set(unsafe, source);
      ports.files.set(scenario === 'destination' ? source : `${source}/my-skill/SKILL.md`, '# live source\n');
      ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
        version: '2.0.0', generatedAt: ports.now, generatedBy: 'test', bundles: {}, sources: {}
      }));
      const before = [...ports.files];

      await expect(planDeploy({ ...req, force: true }, ports)).rejects.toMatchObject({
        code: 'BUNDLE.UNSAFE_DESTINATION', message: expect.stringContaining(unsafe)
      });
      await expect(deployBundle({ ...req, force: true }, ports)).rejects.toMatchObject({
        code: 'BUNDLE.UNSAFE_DESTINATION'
      });
      expect([...ports.files]).toEqual(before);
      expect(ports.calls.filter((call) => !call.startsWith('event:'))).toEqual([]);
    });
  }

  it('allows the configured baseRoot itself to be a symbolic link', async () => {
    const ports = symlinkPorts();
    ports.links.set(request().placement.baseRoot, '/configured/root');
    const result = await deployBundle(request(), ports);
    expect(result.written).toHaveLength(1);
    expect(await ports.fs.readFile(result.written[0])).toBe('# Hello Prompt\n');
    expect(ports.files.has('/configured/root/prompts/hello.prompt.md')).toBe(true);
  });

  it('rechecks destination link identity when the filesystem changes during planning', async () => {
    const ports = symlinkPorts();
    const destination = '/home/u/.copilot/prompts/hello.prompt.md';
    ports.files.set(destination, '# existing\n');
    ports.files.set('/live/prompt.md', '# live source\n');
    const read = ports.fs.readFileBytes.bind(ports.fs);
    ports.fs.readFileBytes = async (filePath) => {
      const bytes = await read(filePath);
      if (filePath === destination) {
        ports.links.set(destination, '/live/prompt.md');
      }
      return bytes;
    };
    await expect(deployBundle({ ...request(), force: true }, ports)).rejects.toMatchObject({
      code: 'BUNDLE.UNSAFE_DESTINATION'
    });
    expect(ports.files.get('/live/prompt.md')).toBe('# live source\n');
    expect(ports.calls.filter((call) => !call.startsWith('event:'))).toEqual([]);
  });
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

    const { local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/web-dev'];
    expect(record.files.map((f: { path: string }) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('records both checksums, with installedChecksum over the written bytes', async () => {
    const ports = recordingPorts();
    const source = request().files!.get('prompts/hello.prompt.md')!;
    const transformed = '# Transformed prompt\n';
    ports.transformer = {
      transform: () => ({ content: transformed, modified: true })
    };

    await deployBundle(request(), ports);

    const { local } = readPair(ports);
    const file = local.targets['my-vscode'].bundles['github-abc123/web-dev'].files[0];
    expect(file.installedChecksum).toBe(createHash('sha256').update(transformed).digest('hex'));
    expect(file.checksum).toBe(createHash('sha256').update(source).digest('hex'));
    expect(file.installedChecksum).not.toBe(file.checksum);
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
    const stateWriteIndex = ports.calls.findIndex((c) => c.includes('"kind":"state-write"'));
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeGreaterThan(localIndex);
    expect(mcpIndex === -1 || recordIndex < mcpIndex).toBe(true);

    // Strengthen: all place events precede state-write.
    const placeIndices = ports.calls
      .map((c, i) => (c.includes('"kind":"place"') ? i : -1))
      .filter((i) => i >= 0);
    for (const placeIndex of placeIndices) {
      expect(placeIndex).toBeLessThan(stateWriteIndex);
    }
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
    const { local } = readPair(ports);
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
    const ports = recordingPorts({ failWriteAt: 3 });
    const created = '/home/u/.copilot/prompts/hello.prompt.md';
    const existing = '/home/u/.copilot/prompts/second.prompt.md';
    ports.files.set(existing, '# user-owned before this call\n');

    await expect(deployBundle({
      ...request(),
      files: twoItemArchive(),
      force: true
    }, ports)).rejects.toMatchObject({
      code: 'BUNDLE.DEPLOY_FAILED',
      message: expect.stringContaining('Simulated write failure'),
      cause: expect.any(Error),
      context: {
        appliedEffects: {
          stage: 'state-write',
          written: [created, existing],
          created: [created],
          cleanedUp: [created],
          cleanupFailures: [],
          removed: []
        }
      }
    });

    expect(ports.files.has(created)).toBe(false);
    expect(new TextDecoder().decode(await ports.fs.readFileBytes(existing))).toBe('# Second Prompt\n');
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(false);
  });

  it('cleans only confirmed new files when the second placement fails after the first succeeded', async () => {
    const ports = recordingPorts({ failWriteAt: 2 });
    const first = '/home/u/.copilot/prompts/hello.prompt.md';
    const second = '/home/u/.copilot/prompts/second.prompt.md';
    const unrelated = '/home/u/.copilot/prompts/user.prompt.md';
    ports.files.set(unrelated, '# user-owned\n');
    await expect(deployBundle({ ...request(), files: twoItemArchive() }, ports)).rejects.toMatchObject({
      code: 'BUNDLE.DEPLOY_FAILED',
      context: { appliedEffects: {
        stage: 'place', written: [first], created: [first], cleanedUp: [first], cleanupFailures: []
      } }
    });
    expect(ports.files.has(first)).toBe(false);
    expect(ports.files.has(second)).toBe(false);
    expect(ports.files.get(unrelated)).toBe('# user-owned\n');
  });

  it('preserves a pre-existing clean prompt after an upgrade fails at state-write', async () => {
    const ports = recordingPorts();
    await deployBundle(upgradePromptRequest(promptArchive('1.0.0', '# V1\n'), '1.0.0'), ports);
    ports.onEvent = (event) => {
      if (event.kind === 'state-write') {
        throw new Error('state-write refused');
      }
    };
    await expect(deployBundle(upgradePromptRequest(promptArchive('2.0.0', '# V2\n'), '2.0.0'), ports))
      .rejects.toThrow('state-write refused');
    expect(await ports.fs.readFile('/home/u/.copilot/prompts/test-prompt.prompt.md')).toBe('# V2\n');
  });

  it('cleans a tracked-but-missing prompt created by a failed upgrade', async () => {
    const ports = recordingPorts();
    await deployBundle(upgradePromptRequest(promptArchive('1.0.0', '# V1\n'), '1.0.0'), ports);
    const destination = '/home/u/.copilot/prompts/test-prompt.prompt.md';
    ports.files.delete(destination);
    ports.onEvent = (event) => {
      if (event.kind === 'state-write') {
        throw new Error('state-write refused');
      }
    };
    await expect(deployBundle(upgradePromptRequest(promptArchive('2.0.0', '# V2\n'), '2.0.0'), ports))
      .rejects.toThrow('state-write refused');
    expect(ports.files.has(destination)).toBe(false);
  });

  it('cleans a newly placed file when read-back verification fails', async () => {
    const ports = recordingPorts();
    const read = ports.fs.readFileBytes.bind(ports.fs);
    ports.fs.readFileBytes = async (destination) => {
      if (destination.endsWith('hello.prompt.md') && ports.files.has(destination)) {
        throw new Error('read-back refused');
      }
      return read(destination);
    };
    await expect(deployBundle(request(), ports)).rejects.toMatchObject({
      context: { appliedEffects: {
        written: ['/home/u/.copilot/prompts/hello.prompt.md'],
        created: ['/home/u/.copilot/prompts/hello.prompt.md'],
        cleanedUp: ['/home/u/.copilot/prompts/hello.prompt.md']
      } }
    });
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
  });

  it('retains a native filesystem error as cause instead of trying to use ENOSPC as a RegistryError code', async () => {
    const ports = recordingPorts();
    const cause = Object.assign(new Error('disk full at state write'), { code: 'ENOSPC' });
    ports.onEvent = (event) => {
      if (event.kind === 'state-write') {
        throw cause;
      }
    };
    await expect(deployBundle(request(), ports)).rejects.toMatchObject({
      code: 'BUNDLE.DEPLOY_FAILED',
      message: cause.message,
      cause,
      context: { appliedEffects: { written: ['/home/u/.copilot/prompts/hello.prompt.md'] } }
    });
  });

  it('reports an applied migration local write when the desired migration write fails', async () => {
    const ports = recordingPorts({ failWriteAt: 2 });
    const legacy = JSON.stringify({
      version: '2.0.0', generatedAt: ports.now, generatedBy: 'test', bundles: {}, sources: {}
    });
    ports.files.set(ports.lockfileStore.desiredFile, legacy);
    await expect(deployBundle(request(), ports)).rejects.toMatchObject({
      code: 'BUNDLE.DEPLOY_FAILED',
      cause: expect.any(Error),
      context: { appliedEffects: {
        stage: 'migrate', written: [ports.lockfileStore.localFile], created: [ports.lockfileStore.localFile], removed: []
      } }
    });
    expect(ports.files.get(ports.lockfileStore.desiredFile)).toBe(legacy);
    expect(ports.files.has(ports.lockfileStore.localFile)).toBe(true);
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

  it('deploys directory-kind subtrees byte-for-byte, records all files, and re-deploy converges', async () => {
    const ports = recordingPorts();

    // First deploy
    const result = await deployBundle(skillRequest(), ports);

    // 1. Relative-path preservation for nested files
    expect(result.written).toContain('/home/u/.copilot/skills/my-skill/SKILL.md');
    expect(result.written).toContain('/home/u/.copilot/skills/my-skill/config.json');
    expect(result.written).toContain('/home/u/.copilot/skills/my-skill/binary.dat');
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/SKILL.md')).toBe(true);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/config.json')).toBe(true);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/binary.dat')).toBe(true);

    // 2. Byte-for-byte fidelity of binary payload (decodeUtf8Strict rejects)
    const binaryBytes = ports.files.get('/home/u/.copilot/skills/my-skill/binary.dat');
    expect(binaryBytes).toBeDefined();
    expect(binaryBytes).toBeInstanceOf(Uint8Array);
    // Verify binary payload matches source: [0xff, 0xfe, 0x00]
    const binaryArray = binaryBytes as Uint8Array;
    expect(binaryArray[0]).toBe(0xFF);
    expect(binaryArray[1]).toBe(0xFE);
    expect(binaryArray[2]).toBe(0x00);

    // 3. Record enumerates every subtree file, not just the entry point
    const { local } = readPair(ports);
    expect(local.targets['my-vscode']).toBeDefined();
    expect(local.targets['my-vscode'].bundles['github-abc123/skills']).toBeDefined();
    const skillRecord = local.targets['my-vscode'].bundles['github-abc123/skills'];
    expect(skillRecord.files).toHaveLength(3); // SKILL.md, config.json, binary.dat
    const recordedPaths = skillRecord.files.map((f: { path: string }) => f.path).toSorted();
    expect(recordedPaths).toEqual([
      'skills/my-skill/SKILL.md',
      'skills/my-skill/binary.dat',
      'skills/my-skill/config.json'
    ]);

    // 4. Re-deploy converges (the C3 regression guard)
    const secondResult = await deployBundle(skillRequest(), ports);

    // Second deploy should find all files satisfied (all 3 subtree files already placed)
    expect(secondResult.satisfied.toSorted()).toEqual([
      '/home/u/.copilot/skills/my-skill/SKILL.md',
      '/home/u/.copilot/skills/my-skill/binary.dat',
      '/home/u/.copilot/skills/my-skill/config.json'
    ]);

    // Record's files array must remain intact, not empty
    const { local: localAfterSecond } = readPair(ports);
    const recordAfterSecond = localAfterSecond.targets['my-vscode'].bundles['github-abc123/skills'];
    expect(recordAfterSecond.files).toHaveLength(3);
    expect(recordAfterSecond.files.map((f: { path: string }) => f.path).toSorted()).toEqual(recordedPaths);
  });

  it('upgrades file-kind bundle content when version changes', async () => {
    const ports = recordingPorts();

    // Deploy v1
    const v1Content = '# V1\n';
    const v1Files = promptArchive('1.0.0', v1Content);
    await deployBundle(upgradePromptRequest(v1Files, '1.0.0'), ports);

    // Deploy v2 with changed content
    const v2Content = '# V2\n';
    const v2Files = promptArchive('2.0.0', v2Content);
    const v2Result = await deployBundle(upgradePromptRequest(v2Files, '2.0.0'), ports);

    // Assert v2 bytes are on disk
    const onDisk = ports.files.get('/home/u/.copilot/prompts/test-prompt.prompt.md');
    expect(onDisk).toBeDefined();
    const onDiskText = typeof onDisk === 'string' ? onDisk : new TextDecoder().decode(onDisk);
    expect(onDiskText).toBe(v2Content);

    // Assert installedChecksum matches v2's hash (computed from the same literal)
    const v2Hash = createHash('sha256').update(new TextEncoder().encode(v2Content)).digest('hex');
    const { local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/upgrade-test'];
    expect(record.files).toHaveLength(1);
    expect(record.files[0].installedChecksum).toBe(v2Hash);

    // v2 should have been written, not satisfied
    expect(v2Result.written).toContain('/home/u/.copilot/prompts/test-prompt.prompt.md');
  });

  it('upgrades directory-kind bundle content when version changes', async () => {
    const ports = recordingPorts();

    // Deploy v1
    const v1Content = '# Skill V1\n';
    const v1Files = skillArchiveVersioned('1.0.0', v1Content);
    await deployBundle(upgradeSkillRequest(v1Files, '1.0.0'), ports);

    // Deploy v2 with changed content
    const v2Content = '# Skill V2\n';
    const v2Files = skillArchiveVersioned('2.0.0', v2Content);
    const v2Result = await deployBundle(upgradeSkillRequest(v2Files, '2.0.0'), ports);

    // Assert v2 bytes are on disk for the main skill file
    const onDisk = ports.files.get('/home/u/.copilot/skills/upgrade-skill/SKILL.md');
    expect(onDisk).toBeDefined();
    const onDiskText = typeof onDisk === 'string' ? onDisk : new TextDecoder().decode(onDisk);
    expect(onDiskText).toBe(v2Content);

    // Assert installedChecksum matches v2's hash (computed from the same literal)
    const v2Hash = createHash('sha256').update(new TextEncoder().encode(v2Content)).digest('hex');
    const { local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/skills'];
    const skillFile = record.files.find((f: { path: string }) => f.path === 'skills/upgrade-skill/SKILL.md');
    expect(skillFile).toBeDefined();
    expect(skillFile!.installedChecksum).toBe(v2Hash);

    // v2 should have been written, not satisfied
    expect(v2Result.written).toContain('/home/u/.copilot/skills/upgrade-skill/SKILL.md');
  });

  it('does not overwrite a new skill asset colliding with an untracked child', async () => {
    const ports = recordingPorts();
    await deployBundle(skillRequest(), ports);
    const userPath = '/home/u/.copilot/skills/my-skill/user.json';
    ports.files.set(userPath, '{"user":true}');
    const files = skillRequest().files!;
    files.set('skills/my-skill/user.json', new TextEncoder().encode('{"bundle":true}'));
    const req = { ...skillRequest(), files };

    expect((await planDeploy(req, ports)).collisions).toEqual([{ to: userPath, reason: 'untracked-existing' }]);
    const result = await deployBundle(req, ports);
    expect(result.collisions).toEqual([{ to: userPath, reason: 'untracked-existing' }]);
    expect(ports.files.get(userPath)).toBe('{"user":true}');
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files.map((file) => file.path))
      .not.toContain('skills/my-skill/user.json');
  });

  it('satisfies an untracked byte-identical skill subtree without force', async () => {
    const ports = recordingPorts();
    const req = skillRequest();
    for (const [from, bytes] of req.files!) {
      if (from.startsWith('skills/')) {
        ports.files.set(`${req.placement.baseRoot}/${from}`, bytes);
      }
    }
    const result = await deployBundle(req, ports);
    expect(result.collisions).toEqual([]);
    expect(result.written).toEqual([]);
    expect(result.satisfied).toHaveLength(3);
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files).toHaveLength(3);
  });

  it('installs and records only installable inventory entries below a governed skill root', async () => {
    const ports = recordingPorts();
    const req = { ...skillRequest(), files: governedSkillArchive() };
    const result = await deployBundle(req, ports);
    expect(result.written).toEqual(['/home/u/.copilot/skills/my-skill/SKILL.md']);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/private.json')).toBe(false);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/notes.md')).toBe(false);
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files.map((file) => file.path))
      .toEqual(['skills/my-skill/SKILL.md']);
  });

  it('expands a root-level SKILL.md into a non-empty recorded inventory', async () => {
    const ports = recordingPorts();
    const files = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode(
        'id: skills\nversion: 1.0.0\nname: Root skill\nprompts:\n  - id: my-skill\n    file: SKILL.md\n    type: skill\n'
      )],
      ['SKILL.md', new TextEncoder().encode('# Root skill\n')],
      ['config.json', new TextEncoder().encode('{}')]
    ]);
    const result = await deployBundle({ ...skillRequest(), files }, ports);
    expect(result.written).toEqual([
      '/home/u/.copilot/skills/my-skill/SKILL.md',
      '/home/u/.copilot/skills/my-skill/config.json'
    ]);
    expect(readPair(ports).local.targets['my-vscode'].bundles[result.key].files).toHaveLength(2);
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/deployment-manifest.yml')).toBe(false);
  });

  it('keeps the first normalized destination and reports the later duplicate', async () => {
    const ports = recordingPorts();
    const first = '# First\n';
    const files = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode(
        'id: web-dev\nversion: 1.0.0\nname: Duplicates\nprompts:\n'
        + '  - id: hello world\n    file: prompts/first.md\n    type: prompt\n'
        + '  - id: hello-world\n    file: prompts/second.md\n    type: prompt\n'
      )],
      ['prompts/first.md', new TextEncoder().encode(first)],
      ['prompts/second.md', new TextEncoder().encode('# Last\n')]
    ]);
    const result = await deployBundle({ ...request(), files }, ports);
    expect(result.duplicates).toHaveLength(1);
    expect(result.written).toEqual(['/home/u/.copilot/prompts/hello-world.prompt.md']);
    expect(await ports.fs.readFile(result.written[0])).toBe(first);
    expect(readPair(ports).local.targets['my-vscode'].bundles[result.key].files).toHaveLength(1);
  });

  it('does not record directory ownership for a nested file when its skill files collided', async () => {
    const ports = recordingPorts();
    const root = '/home/u/.copilot/skills/my-skill';
    ports.files.set(`${root}/SKILL.md`, '# user skill\n');
    const files = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode(
        'id: web-dev\nversion: 1.0.0\nname: Nested\nprompts:\n  - id: my-skill\n    file: skills/my-skill/SKILL.md\n    type: skill\n  - id: child\n    file: prompts/child.md\n    type: prompt\n'
      )],
      ['skills/my-skill/SKILL.md', new TextEncoder().encode('# bundle skill\n')],
      ['prompts/child.md', new TextEncoder().encode('# child\n')]
    ]);
    const req = request();
    const result = await deployBundle({
      ...req, files,
      placement: { ...req.placement, resolvedLayout: {
        ...req.placement.resolvedLayout,
        kindRoutes: { 'skills/': 'skills/', 'prompts/': 'skills/my-skill/' }
      } }
    }, ports);
    expect(result.written).toEqual([`${root}/child.prompt.md`]);
    expect(readPair(ports).local.targets['my-vscode'].bundles[result.key].files.map((file) => file.path))
      .toEqual(['skills/my-skill/child.prompt.md']);
    await undeployBundle({ key: result.key, bundle: req.bundle, targetName: req.targetName, scope: 'user' }, ports);
    expect(ports.files.get(`${root}/SKILL.md`)).toBe('# user skill\n');
  });

  it('reports a physical duplicate between a skill asset and a nested file item while keeping the first bytes', async () => {
    const ports = recordingPorts();
    const req = request();
    const files = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode(
        'id: web-dev\nversion: 1.0.0\nname: Overlap\nprompts:\n'
        + '  - id: my-skill\n    file: skills/my-skill/SKILL.md\n    type: skill\n'
        + '  - id: child\n    file: prompts/child.md\n    type: prompt\n'
      )],
      ['skills/my-skill/SKILL.md', new TextEncoder().encode('# skill\n')],
      ['skills/my-skill/child.prompt.md', new TextEncoder().encode('# skill asset\n')],
      ['prompts/child.md', new TextEncoder().encode('# later file\n')]
    ]);
    const result = await deployBundle({
      ...req, files,
      placement: { ...req.placement, resolvedLayout: {
        ...req.placement.resolvedLayout,
        kindRoutes: { 'skills/': 'skills/', 'prompts/': 'skills/my-skill/' }
      } }
    }, ports);
    const destination = '/home/u/.copilot/skills/my-skill/child.prompt.md';
    expect(result.duplicates).toEqual([{ to: destination, ids: ['my-skill', 'child'] }]);
    expect(await ports.fs.readFile(destination)).toBe('# skill asset\n');
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files).toHaveLength(2);
  });

  it('refuses a directory item whose validated archive expands to no installable files', async () => {
    const ports = recordingPorts();
    const files = new Map([['deployment-manifest.yml', new TextEncoder().encode(
      'id: skills\nversion: 1.0.0\nname: Empty\nprompts:\n  - id: my-skill\n    file: skills/my-skill/SKILL.md\n    type: skill\n'
    )]]);
    await expect(deployBundle({ ...skillRequest(), files }, ports)).rejects.toMatchObject({
      code: 'BUNDLE.INVALID_DEPLOY_REQUEST', message: expect.stringContaining('inventory is empty')
    });
    expect(ports.calls).toEqual([]);
    expect(ports.files.size).toBe(0);
  });

  const upgradeCases = [
    { kind: 'file', make: (version: string) => upgradePromptRequest(promptArchive(version, `# ${version}\n`), version) },
    { kind: 'directory', make: (version: string) => upgradeSkillRequest(skillArchiveVersioned(version, `# ${version}\n`), version) }
  ];
  for (const { kind, make } of upgradeCases) {
    for (const boundary of ['state-event', 'local-write', 'local-rename', 'desired-write', 'desired-rename']) {
      it(`converges an identical ${kind} upgrade after failure at ${boundary} without force`, async () => {
        const ports = recordingPorts();
        await deployBundle(make('1.0.0'), ports);
        const v2 = make('2.0.0');
        const originalEvent = ports.onEvent;
        const originalWrite = ports.fs.writeFile.bind(ports.fs);
        const originalRename = ports.fs.rename.bind(ports.fs);
        ports.onEvent = (event) => {
          if (boundary === 'state-event' && event.kind === 'state-write') {
            throw new Error(boundary);
          }
          originalEvent?.(event);
        };
        ports.fs.writeFile = async (destination, content) => {
          const half = boundary === 'local-write' ? ports.lockfileStore.localFile : ports.lockfileStore.desiredFile;
          if (boundary.endsWith('-write') && destination.startsWith(`${half}.`)) {
            throw new Error(boundary);
          }
          return originalWrite(destination, content);
        };
        ports.fs.rename = async (from, to) => {
          const half = boundary === 'local-rename' ? ports.lockfileStore.localFile : ports.lockfileStore.desiredFile;
          if (boundary.endsWith('-rename') && to === half) {
            throw new Error(boundary);
          }
          return originalRename(from, to);
        };
        await expect(deployBundle(v2, ports)).rejects.toThrow(boundary);
        ports.onEvent = originalEvent;
        ports.fs.writeFile = originalWrite;
        ports.fs.rename = originalRename;
        const result = await deployBundle(v2, ports);
        expect(result.written).toEqual([]);
        expect(result.satisfied.length).toBe(kind === 'file' ? 1 : 2);
        expect(readPair(ports).local.targets[v2.targetName].bundles[result.key].version).toBe(v2.bundle.version);
      });
    }
  }

  it.each(['constructor', '__proto__', 'toString'])('deploys to the own target named %s', async (targetName) => {
    const ports = recordingPorts();
    const result = await deployBundle({ ...request(), targetName }, ports);
    expect(result.written).toHaveLength(1);
    expect(Object.hasOwn(readPair(ports).local.targets, targetName)).toBe(true);
    expect(readPair(ports).local.targets[targetName].bundles[result.key].files).toHaveLength(1);
  });

  it('refuses a changed target root before writing any files or state', async () => {
    const ports = recordingPorts();
    const req = request();
    await deployBundle(req, ports);
    const before = [...ports.files];
    const callsBefore = ports.calls.length;
    const rebound = { ...req, placement: { ...req.placement, baseRoot: '/new/root' } };
    await expect(planDeploy(rebound, ports)).rejects.toMatchObject({ code: 'BUNDLE.TARGET_REBOUND' });
    await expect(deployBundle(rebound, ports)).rejects.toMatchObject({
      code: 'BUNDLE.TARGET_REBOUND',
      message: expect.stringMatching(/uninstall first|restore the target path/i)
    });
    expect([...ports.files]).toEqual(before);
    expect(ports.calls.slice(callsBefore).filter((call) => !call.startsWith('event:'))).toEqual([]);
  });

  it('retires unchanged removed skill assets so upgrade and uninstall leave no owned files', async () => {
    const ports = recordingPorts();
    const req = skillRequest();
    await deployBundle(req, ports);
    const shrunk = skillRequest().files!;
    shrunk.delete('skills/my-skill/binary.dat');
    const result = await deployBundle({ ...req, files: shrunk }, ports);
    const retired = '/home/u/.copilot/skills/my-skill/binary.dat';
    expect(ports.files.has(retired)).toBe(false);
    expect(result.retired).toEqual([retired]);
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files).toHaveLength(2);
    await undeployBundle({ key: result.key, bundle: req.bundle, targetName: req.targetName, scope: 'user' }, ports);
    expect([...ports.files.keys()].filter((file) => file.startsWith(req.placement.baseRoot))).toEqual([]);
  });

  it('retains a modified removed skill asset on disk and in the record and reports it', async () => {
    const ports = recordingPorts();
    const req = skillRequest();
    await deployBundle(req, ports);
    const retained = '/home/u/.copilot/skills/my-skill/config.json';
    ports.files.set(retained, '{"user":true}');
    const shrunk = skillRequest().files!;
    shrunk.delete('skills/my-skill/config.json');
    const result = await deployBundle({ ...req, files: shrunk }, ports);
    expect(result.retained).toEqual([retained]);
    expect(ports.files.get(retained)).toBe('{"user":true}');
    expect(readPair(ports).local.targets[req.targetName].bundles[result.key].files.map((file) => file.path))
      .toContain('skills/my-skill/config.json');
  });

  it('does not retire old inventory paths when the redeploy state write failed', async () => {
    const ports = recordingPorts();
    await deployBundle(skillRequest(), ports);
    const shrunk = skillRequest().files!;
    shrunk.delete('skills/my-skill/binary.dat');
    ports.onEvent = (event) => {
      if (event.kind === 'state-write') {
        throw new Error('state write refused');
      }
    };
    await expect(deployBundle({ ...skillRequest(), files: shrunk }, ports)).rejects.toThrow('state write refused');
    expect(ports.files.has('/home/u/.copilot/skills/my-skill/binary.dat')).toBe(true);
  });

  it('preserves a verified archive pin on files-only redeploy at the same key and version', async () => {
    const ports = recordingPorts();
    const req = request();
    const first = await deployBundle(req, ports);
    const pair = readPair(ports);
    const archiveSha = `sha256:${createHash('sha256').update('verified remote artifact').digest('hex')}`;
    pair.desired.bundles[first.key].archiveSha = archiveSha;
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify(pair.desired));
    await deployBundle(req, ports);
    expect(readPair(ports).desired.bundles[first.key].archiveSha).toBe(archiveSha);
  });

  it('drops an old archive pin when the logical bundle version changes', async () => {
    const ports = recordingPorts();
    const v1 = upgradePromptRequest(promptArchive('1.0.0', '# V1\n'), '1.0.0');
    const first = await deployBundle(v1, ports);
    const pair = readPair(ports);
    pair.desired.bundles[first.key].archiveSha = `sha256:${createHash('sha256').update('v1 artifact').digest('hex')}`;
    ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify(pair.desired));
    await deployBundle(upgradePromptRequest(promptArchive('2.0.0', '# V2\n'), '2.0.0'), ports);
    expect(readPair(ports).desired.bundles[first.key].archiveSha).toBeUndefined();
  });

  it.each(['type', 'url'] as const)('refuses a conflicting source %s while another desired key still references it', async (field) => {
    const ports = recordingPorts();
    const first = request();
    await deployBundle(first, ports);
    const second = upgradePromptRequest(promptArchive('1.0.0', '# second\n'), '1.0.0');
    second.source = { ...second.source, [field]: field === 'type' ? 'local' : '/different/project' };
    const before = [...ports.files];
    await expect(planDeploy(second, ports)).rejects.toMatchObject({ code: 'BUNDLE.SOURCE_CONFLICT' });
    await expect(deployBundle(second, ports)).rejects.toMatchObject({
      code: 'BUNDLE.SOURCE_CONFLICT', message: expect.stringContaining('distinct source path')
    });
    expect([...ports.files]).toEqual(before);
  });

  describe('desired source descriptor', () => {
    it('records the source descriptor next to the bundle entry that references it', async () => {
      const ports = recordingPorts();
      const req = request();

      await deployBundle(req, ports);

      const { desired } = readPair(ports);
      expect(desired.sources).toEqual({
        [req.source.sourceId]: { type: req.source.type, url: req.source.url }
      });
      expect(desired.bundles['github-abc123/web-dev'].sourceId).toBe(req.source.sourceId);
    });

    it('writes branch and collectionsPath only when the request carries them', async () => {
      const plain = recordingPorts();
      const rich = recordingPorts();
      const req = request();

      await deployBundle(req, plain);
      await deployBundle({ ...req, source: { ...req.source, branch: 'release', collectionsPath: 'collections' } }, rich);

      expect(Object.keys(readPair(plain).desired.sources[req.source.sourceId]).toSorted()).toEqual(['type', 'url']);
      expect(readPair(rich).desired.sources[req.source.sourceId]).toEqual({
        type: req.source.type,
        url: req.source.url,
        branch: 'release',
        collectionsPath: 'collections'
      });
    });

    it('keeps the descriptor on re-deploy', async () => {
      const ports = recordingPorts();
      const req = request();

      await deployBundle(req, ports);
      const first = readPair(ports).desired.sources;
      expect(first[req.source.sourceId]).toBeDefined();
      await deployBundle(req, ports);

      expect(readPair(ports).desired.sources).toEqual(first);
    });

    it('does not duplicate or clobber the descriptor when a second bundle shares the source', async () => {
      const ports = recordingPorts();
      const first = request();
      const second = upgradePromptRequest(promptArchive('1.0.0', '# second\n'), '1.0.0');
      expect(second.source).toEqual(first.source);

      await deployBundle(first, ports);
      await deployBundle(second, ports);

      const { desired } = readPair(ports);
      expect(Object.keys(desired.sources)).toEqual([first.source.sourceId]);
      expect(desired.sources[first.source.sourceId]).toEqual({ type: first.source.type, url: first.source.url });
      expect(Object.keys(desired.bundles)).toHaveLength(2);
    });

    it('replaces the owned fields wholesale: a conflicting descriptor keeps no stale branch or collectionsPath', async () => {
      const ports = recordingPorts();
      const req = request();
      ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
        $schema: 'x',
        version: '3.0.0',
        bundles: {},
        sources: {
          [req.source.sourceId]: { type: 'github', url: 'https://old.example/repo', branch: 'old', collectionsPath: 'old' }
        }
      }));

      await deployBundle(req, ports);

      expect(readPair(ports).desired.sources[req.source.sourceId]).toEqual({
        type: req.source.type,
        url: req.source.url
      });
    });

    const unusableUrls: [string, string][] = [['empty', ''], ['spaces', '   '], ['tab and newline', '\t\n']];
    const legacyV2 = JSON.stringify({
      $schema: 'x', version: '2.0.0', generatedAt: 'x', generatedBy: 'x',
      bundles: {
        other: {
          version: '1.0.0', sourceId: 'github-abc123', sourceType: 'github',
          installedAt: 'x', files: [{ path: 'prompts/other.prompt.md', checksum: 'h' }]
        }
      },
      sources: { 'github-abc123': { type: 'github', url: 'https://github.com/owner/repo' } }
    });

    it.each(unusableUrls)('deployBundle refuses a %s url before any write, including the migration', async (_label, url) => {
      const ports = recordingPorts();
      ports.files.set(ports.lockfileStore.desiredFile, legacyV2);
      const req = request();

      await expect(deployBundle({ ...req, source: { ...req.source, url } }, ports))
        .rejects.toMatchObject({ code: 'BUNDLE.INVALID_DEPLOY_REQUEST' });

      expect(ports.calls.filter((c) => !c.startsWith('event:'))).toEqual([]);
      expect([...ports.files.entries()]).toEqual([[ports.lockfileStore.desiredFile, legacyV2]]);
    });

    it.each(unusableUrls)('planDeploy refuses a %s url too, so a dry run reports it, and writes nothing', async (_label, url) => {
      const ports = recordingPorts();
      ports.files.set(ports.lockfileStore.desiredFile, legacyV2);
      const req = request();

      await expect(planDeploy({ ...req, source: { ...req.source, url } }, ports))
        .rejects.toMatchObject({ code: 'BUNDLE.INVALID_DEPLOY_REQUEST' });

      expect(ports.calls.filter((c) => !c.startsWith('event:'))).toEqual([]);
      expect([...ports.files.entries()]).toEqual([[ports.lockfileStore.desiredFile, legacyV2]]);
    });

    it('preserves descriptor fields it does not own', async () => {
      const ports = recordingPorts();
      const req = request();
      ports.files.set(ports.lockfileStore.desiredFile, JSON.stringify({
        $schema: 'x',
        version: '3.0.0',
        bundles: {},
        sources: { [req.source.sourceId]: { type: 'github', url: 'https://old.example/repo', indexFile: 'index.json' } }
      }));

      await deployBundle(req, ports);

      expect(readPair(ports).desired.sources[req.source.sourceId]).toEqual({
        type: req.source.type,
        url: req.source.url,
        indexFile: 'index.json'
      });
    });
  });
});

describe('deployBundle after an interrupted first deploy', () => {
  const writeCount = (calls: string[]): number =>
    calls.filter((c) => c.startsWith('writeFile:') || c.startsWith('writeFileBytes:')).length;

  it('keeps the first bundle\'s materialization record when the next deploy starts from the local-only pair', async () => {
    // A clean deploy's last write is the desired file (§8.4: local first, then desired).
    const probe = recordingPorts();
    await deployBundle(request(), probe);
    const ports = recordingPorts({ failWriteAt: writeCount(probe.calls) });

    await expect(deployBundle(request(), ports)).rejects.toThrow(/Simulated write failure/);

    // The injection fired on the desired write: local already holds A's record, desired was never written.
    expect(ports.files.has(ports.lockfileStore.desiredFile)).toBe(false);
    const local = JSON.parse(ports.files.get(ports.lockfileStore.localFile) as string) as {
      targets: Record<string, { bundles: Record<string, unknown> }>;
    };
    expect(Object.keys(local.targets['my-vscode'].bundles)).toEqual(['github-abc123/web-dev']);

    ports.failWriteAt = undefined;
    await deployBundle(skillRequest(), ports);

    const { local: after } = readPair(ports);
    expect(Object.keys(after.targets['my-vscode'].bundles).toSorted()).toEqual([
      'github-abc123/skills',
      'github-abc123/web-dev'
    ]);
    expect(after.targets['my-vscode'].bundles['github-abc123/web-dev'].files.map((f) => f.path))
      .toEqual(['prompts/hello.prompt.md']);
  });
});
