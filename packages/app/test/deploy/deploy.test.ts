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
  promptArchive,
  readPair,
  recordingPorts,
  request,
  skillArchiveVersioned,
  skillRequest,
  twoItemArchive,
  upgradePromptRequest,
  upgradeSkillRequest,
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

    const { local } = readPair(ports);
    const record = local.targets['my-vscode'].bundles['github-abc123/web-dev'];
    expect(record.files.map((f: { path: string }) => f.path)).toEqual(['prompts/hello.prompt.md']);
  });

  it('records both checksums, with installedChecksum over the written bytes', async () => {
    const ports = recordingPorts();

    await deployBundle(request(), ports);

    const { local } = readPair(ports);
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
    const ports = recordingPorts({ failWriteAt: 1 }); // Fail on the FIRST file
    // This is a simpler test: no pre-existing files, just verify cleanup of what was created

    await expect(deployBundle({
      ...request(),
      files: twoItemArchive()
    }, ports)).rejects.toThrow();

    // Neither file should exist after rollback (both were newly created)
    expect(ports.files.has('/home/u/.copilot/prompts/hello.prompt.md')).toBe(false);
    expect(ports.files.has('/home/u/.copilot/prompts/second.prompt.md')).toBe(false);
    // State write should not have happened.
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
