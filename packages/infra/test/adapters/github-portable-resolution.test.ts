import * as crypto from 'node:crypto';
import type {
  BundleExtractor,
  PortableBundlePayload,
  PortableBundleSelection,
  PortableSourceDescriptor,
  RegistrySource,
} from '@ai-primitives-hub/core';
import {
  sourceKey,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  AwesomeCopilotAdapter,
} from '../../src/adapters/awesome-copilot-adapter';
import {
  GitHubAdapter,
} from '../../src/adapters/github-adapter';
import {
  resolveGitHubSourceIdentity,
} from '../../src/adapters/github-portable-resolution';
import {
  SkillsAdapter,
} from '../../src/adapters/skills-adapter';
import {
  FakeGitHubApi,
} from '../helpers/fake-github-api';
import {
  FixedClock,
} from '../helpers/fixed-clock';
import {
  RecordingGitHubApi,
} from '../helpers/recording-github-api';

const encoder = new TextEncoder();

function makeSource(type: RegistrySource['type'], overrides: Partial<RegistrySource> = {}): RegistrySource {
  return {
    id: `${type}-test`,
    name: 'Portable source test',
    type,
    url: 'https://github.com/owner/repo',
    enabled: true,
    priority: 0,
    ...overrides
  };
}

function makeExpectedSource(type: 'github' | 'skills' | 'awesome-copilot', ref?: string): PortableSourceDescriptor {
  return {
    type,
    identity: type === 'github'
      ? { kind: 'github-releases', origin: 'https://github.com', repositoryId: '123' }
      : {
        kind: 'github-tree',
        origin: 'https://github.com',
        repositoryId: '123',
        ref: ref ?? 'main',
        ...(type === 'skills' ? { skillsPath: 'skills' } : { collectionsPath: 'collections' })
      },
    locator: 'https://github.com/owner/repo'
  };
}

class TestExtractor implements BundleExtractor {
  public received: Uint8Array | undefined;

  public constructor(private readonly filesForBytes: (bytes: Uint8Array) => ReadonlyMap<string, Uint8Array>) {}

  public extract(bytes: Uint8Array): Promise<ReadonlyMap<string, Uint8Array>> {
    this.received = bytes;
    return Promise.resolve(this.filesForBytes(bytes));
  }
}

function makeRelease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 91,
    tag_name: 'v1.2.3',
    name: 'Bundle release',
    body: '',
    assets: [
      {
        id: 92,
        name: 'bundle.zip',
        browser_download_url: 'https://github.com/owner/repo/releases/download/v1.2.3/bundle.zip',
        url: 'https://api.github.com/repos/owner/repo/releases/assets/92',
        size: 32
      }
    ],
    published_at: '2026-10-13T00:00:00Z',
    ...overrides
  };
}

function manifestFiles(id: string, version: string): ReadonlyMap<string, Uint8Array> {
  return new Map([
    ['deployment-manifest.yml', encoder.encode(`id: ${id}\nname: ${id}\nversion: ${version}\n`)]
  ]);
}

function invokePortableResolution(
  adapter: object,
  selection: PortableBundleSelection
): Promise<PortableBundlePayload | null> {
  const resolver = (adapter as {
    resolvePortableBundle?: (selection: PortableBundleSelection) => Promise<PortableBundlePayload | null>;
  }).resolvePortableBundle;
  expect(resolver).toBeTypeOf('function');
  return resolver ? resolver.call(adapter, selection) : Promise.resolve(null);
}

function seedRepository(api: FakeGitHubApi, overrides: Record<string, unknown> = {}): FakeGitHubApi {
  return api.seedJson('/repos/owner/repo', {
    id: 123,
    name: 'repo',
    full_name: 'owner/repo',
    html_url: 'https://github.com/owner/repo',
    default_branch: 'main',
    ...overrides
  });
}

describe('GitHub portable source identity', () => {
  it('rejects credential-bearing repository locators before contacting GitHub', async () => {
    const recordingApi = new RecordingGitHubApi(new FakeGitHubApi());

    await expect(resolveGitHubSourceIdentity(
      makeSource('github', { url: 'https://user:secret@github.com/owner/repo' }),
      recordingApi
    )).rejects.toThrow(/invalid or contains credentials/i);

    expect(recordingApi.calls).toEqual([]);
  });

  it('keeps the portable key through a repository rename and reuses the metadata lookup', async () => {
    const oldSource = makeExpectedSource('github');
    const api = seedRepository(new FakeGitHubApi(), {
      name: 'renamed-repo',
      full_name: 'owner/renamed-repo',
      html_url: 'https://github.com/owner/renamed-repo'
    })
      .seedJson('/repos/owner/renamed-repo/releases/tags/v1.2.3', makeRelease({
        assets: [{
          id: 92,
          name: 'bundle.zip',
          browser_download_url: 'https://github.com/owner/renamed-repo/releases/download/v1.2.3/bundle.zip',
          url: 'https://api.github.com/repos/owner/renamed-repo/releases/assets/92',
          size: 32
        }]
      }))
      .seedBytes('https://api.github.com/repos/owner/renamed-repo/releases/assets/92', new Uint8Array([1, 2, 3]));
    const recordingApi = new RecordingGitHubApi(api);
    const extractor = new TestExtractor(() => manifestFiles('portable-id', '1.2.3'));
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi, extractor);

    const payload = await invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-1.2.3',
      version: '1.2.3',
      expectedSource: oldSource
    });

    expect(payload?.logicalBundleId).toBe('portable-id');
    expect(payload?.source.locator).toBe('https://github.com/owner/renamed-repo');
    expect(sourceKey(payload!.source.identity, payload!.source.type)).toBe(sourceKey(oldSource.identity, oldSource.type));
    expect(recordingApi.calls.filter((call) => call.pathOrUrl === '/repos/owner/repo')).toHaveLength(1);
  });

  it('rejects a replaced repository at the old locator before requesting release content', async () => {
    const api = seedRepository(new FakeGitHubApi(), { id: 456 });
    const recordingApi = new RecordingGitHubApi(api);
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi);

    await expect(invokePortableResolution(adapter, {
      bundleId: 'portable-id',
      version: '1.2.3',
      expectedSource: makeExpectedSource('github')
    })).rejects.toThrow(/repository identity|repository ID/i);

    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/releases'))).toBe(false);
    expect(recordingApi.countOf('download')).toBe(0);
  });

  it('directly resolves known releases and keeps one logical ID across distinct release pins', async () => {
    const bytesByAsset = new Map([
      ['https://api.github.com/repos/owner/repo/releases/assets/92', new Uint8Array([1, 2, 3])],
      ['https://api.github.com/repos/owner/repo/releases/assets/94', new Uint8Array([4, 5, 6])]
    ]);
    const api = seedRepository(new FakeGitHubApi())
      .seedJson('/repos/owner/repo/releases/tags/v1.2.3', makeRelease())
      .seedJson('/repos/owner/repo/releases/tags/v2.0.0', makeRelease({
        id: 93,
        tag_name: 'v2.0.0',
        assets: [{
          id: 94,
          name: 'bundle.zip',
          browser_download_url: 'https://github.com/owner/repo/releases/download/v2.0.0/bundle.zip',
          url: 'https://api.github.com/repos/owner/repo/releases/assets/94',
          size: 32
        }]
      }));
    for (const [url, bytes] of bytesByAsset) {
      api.seedBytes(url, bytes);
    }
    const recordingApi = new RecordingGitHubApi(api);
    const extractor = new TestExtractor((bytes) => manifestFiles(
      'portable-id',
      bytes[0] === 1 ? '1.2.3' : '2.0.0'
    ));
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi, extractor);

    const first = await invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-1.2.3',
      version: '1.2.3',
      expectedSource: makeExpectedSource('github')
    });
    const second = await invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-2.0.0',
      version: '2.0.0',
      expectedSource: makeExpectedSource('github')
    });

    expect(first?.logicalBundleId).toBe('portable-id');
    expect(second?.logicalBundleId).toBe('portable-id');
    expect(first?.resolution).toMatchObject({ provider: 'github-release', releaseId: '91', assetId: '92' });
    expect(second?.resolution).toMatchObject({ provider: 'github-release', releaseId: '93', assetId: '94' });
    expect(first?.resolution).not.toEqual(second?.resolution);
    expect((first?.resolution as { archiveSha256?: string }).archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((second?.resolution as { archiveSha256?: string }).archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((first?.resolution as { archiveSha256?: string }).archiveSha256).not.toBe(
      (second?.resolution as { archiveSha256?: string }).archiveSha256
    );
    expect(recordingApi.calls.some((call) => call.pathOrUrl === '/repos/owner/repo/releases')).toBe(false);
  });

  it('replays a recorded release and asset ID, verifies archive bytes and manifest version, and never falls back', async () => {
    const archiveBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2]);
    const archiveSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
    const api = seedRepository(new FakeGitHubApi())
      .seedJson('/repos/owner/repo/releases/91', makeRelease())
      .seedBytes('https://api.github.com/repos/owner/repo/releases/assets/92', archiveBytes);
    const recordingApi = new RecordingGitHubApi(api);
    const extractor = new TestExtractor(() => manifestFiles('portable-id', '1.2.3'));
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi, extractor);

    const payload = await invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-1.2.3',
      version: '1.2.3',
      expectedSource: makeExpectedSource('github'),
      resolution: {
        kind: 'pinned',
        provider: 'github-release',
        version: '1.2.3',
        releaseId: '91',
        assetId: '92',
        archiveSha256,
        tag: 'v1.2.3'
      }
    });

    expect(payload?.bytes).toEqual(Buffer.from(archiveBytes));
    expect(payload?.files.get('deployment-manifest.yml')).toEqual(manifestFiles('portable-id', '1.2.3').get('deployment-manifest.yml'));
    expect(payload?.resolution).toMatchObject({ releaseId: '91', assetId: '92', archiveSha256 });
    expect(extractor.received).toEqual(archiveBytes);
    expect(recordingApi.calls.map((call) => call.pathOrUrl)).toContain('/repos/owner/repo/releases/91');
    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/releases/tags/'))).toBe(false);
    expect(recordingApi.calls.some((call) => call.pathOrUrl === '/repos/owner/repo/releases')).toBe(false);
  });

  it('fails a replaced pinned asset ID without selecting another release or asset', async () => {
    const archiveBytes = new Uint8Array([1, 2, 3]);
    const archiveSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
    const api = seedRepository(new FakeGitHubApi()).seedJson(
      '/repos/owner/repo/releases/91',
      makeRelease({
        assets: [{
          id: 999,
          name: 'bundle.zip',
          browser_download_url: 'https://github.com/owner/repo/releases/download/v1.2.3/bundle.zip',
          url: 'https://api.github.com/repos/owner/repo/releases/assets/999',
          size: 32
        }]
      })
    );
    const recordingApi = new RecordingGitHubApi(api);
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi);

    await expect(invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-1.2.3',
      version: '1.2.3',
      expectedSource: makeExpectedSource('github'),
      resolution: {
        kind: 'pinned',
        provider: 'github-release',
        version: '1.2.3',
        releaseId: '91',
        assetId: '92',
        archiveSha256,
        tag: 'v1.2.3'
      }
    })).rejects.toThrow(/asset.*(missing|ID|pin)|pinned asset/i);

    expect(recordingApi.countOf('download')).toBe(0);
    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/releases/tags/'))).toBe(false);
    expect(recordingApi.calls.some((call) => call.pathOrUrl === '/repos/owner/repo/releases')).toBe(false);
  });

  it('rejects changed archive bytes before extraction or any catalog fallback', async () => {
    const archiveBytes = new Uint8Array([9, 8, 7]);
    const api = seedRepository(new FakeGitHubApi())
      .seedJson('/repos/owner/repo/releases/91', makeRelease())
      .seedBytes('https://api.github.com/repos/owner/repo/releases/assets/92', archiveBytes);
    const recordingApi = new RecordingGitHubApi(api);
    const adapter = new GitHubAdapter(makeSource('github'), recordingApi);

    await expect(invokePortableResolution(adapter, {
      bundleId: 'owner-repo-portable-id-1.2.3',
      version: '1.2.3',
      expectedSource: makeExpectedSource('github'),
      resolution: {
        kind: 'pinned',
        provider: 'github-release',
        version: '1.2.3',
        releaseId: '91',
        assetId: '92',
        archiveSha256: '0'.repeat(64),
        tag: 'v1.2.3'
      }
    })).rejects.toThrow(/SHA-256/);

    expect(recordingApi.countOf('download')).toBe(1);
    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/releases/tags/'))).toBe(false);
    expect(recordingApi.calls.some((call) => call.pathOrUrl === '/repos/owner/repo/releases')).toBe(false);
  });

  it('rejects a release archive whose manifest version differs from the recorded pin', async () => {
    const archiveBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04]);
    const archiveSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
    const api = seedRepository(new FakeGitHubApi())
      .seedJson('/repos/owner/repo/releases/91', makeRelease())
      .seedBytes('https://api.github.com/repos/owner/repo/releases/assets/92', archiveBytes);
    const adapter = new GitHubAdapter(
      makeSource('github'),
      api,
      new TestExtractor(() => manifestFiles('portable-id', '2.0.0'))
    );

    await expect(invokePortableResolution(adapter, {
      bundleId: 'portable-id',
      expectedSource: makeExpectedSource('github'),
      resolution: {
        kind: 'pinned',
        provider: 'github-release',
        version: '1.2.3',
        releaseId: '91',
        assetId: '92',
        archiveSha256
      }
    })).rejects.toThrow(/recorded version/i);
  });
});

describe('GitHub tree portable acquisition', () => {
  it('resolves the repository default branch, then fetches every skill file at the resolved commit', async () => {
    const skillMd = encoder.encode('---\nname: Demo\ndescription: Portable skill\n---\nInstructions');
    const assetBytes = new Uint8Array([0, 255, 3, 128]);
    const api = seedRepository(new FakeGitHubApi(), { default_branch: 'master' })
      .seedJson('/repos/owner/repo/commits/master', { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      .seedJson('/repos/owner/repo/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?recursive=1', {
        tree: [
          { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'blob-skill' },
          { path: 'skills/demo/assets/data.bin', type: 'blob', sha: 'blob-data' }
        ]
      })
      .seedBytes('https://raw.githubusercontent.com/owner/repo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/demo/SKILL.md', skillMd)
      .seedBytes('https://raw.githubusercontent.com/owner/repo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/demo/assets/data.bin', assetBytes);
    const recordingApi = new RecordingGitHubApi(api);
    const adapter = new SkillsAdapter(makeSource('skills'), recordingApi, new FixedClock(0));

    const payload = await invokePortableResolution(adapter, {
      bundleId: 'skills-owner-repo-demo',
      expectedSource: makeExpectedSource('skills', 'master')
    });

    expect(payload?.source.identity).toMatchObject({ kind: 'github-tree', ref: 'master' });
    expect(payload?.resolution).toMatchObject({
      provider: 'github-tree',
      commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bundlePath: 'skills/demo',
      sourceContentSha256: '498bd0e1bfff8777ac647b2e6c165ace615c3df0ba9e6a6227de4d9049ddd1af'
    });
    expect(payload?.files.get('skills/demo/SKILL.md')).toEqual(skillMd);
    expect(payload?.files.get('skills/demo/assets/data.bin')).toEqual(assetBytes);
    expect(recordingApi.calls.map((call) => call.pathOrUrl)).toContain('/repos/owner/repo/commits/master');
    expect(recordingApi.calls.map((call) => call.pathOrUrl)).toContain(
      '/repos/owner/repo/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?recursive=1'
    );
    expect(recordingApi.calls.filter((call) => call.method === 'download').map((call) => call.pathOrUrl)).toEqual([
      'https://raw.githubusercontent.com/owner/repo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/demo/SKILL.md',
      'https://raw.githubusercontent.com/owner/repo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/skills/demo/assets/data.bin'
    ]);
    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/git/trees/master?'))).toBe(false);
  });

  it('keeps master and main as distinct effective skills source identities', async () => {
    const api = seedRepository(new FakeGitHubApi(), { default_branch: 'master' })
      .seedJson('/repos/owner/repo/commits/master', { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      .seedJson('/repos/owner/repo/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?recursive=1', { tree: [] })
      .seedJson('/repos/owner/repo/commits/main', { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
      .seedJson('/repos/owner/repo/git/trees/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?recursive=1', { tree: [] });
    const master = await resolveGitHubSourceIdentity(makeSource('skills'), api);
    const main = await resolveGitHubSourceIdentity(makeSource('skills', { config: { branch: 'main' } }), api);

    expect(master.identity).toMatchObject({ ref: 'master' });
    expect(main.identity).toMatchObject({ ref: 'main' });
    expect(sourceKey(master.identity, master.type)).not.toBe(
      sourceKey(main.identity, main.type)
    );
  });

  it('fails a tree replay when raw source files do not match the recorded source-content digest', async () => {
    const entries = [
      { path: 'skills/demo/SKILL.md', sha: 'blob-skill' },
      { path: 'skills/demo/assets/data.bin', sha: 'blob-data' }
    ];
    const versionHash = crypto.createHash('sha256');
    for (const entry of entries.toSorted((left, right) => left.path.localeCompare(right.path))) {
      versionHash.update(entry.path).update(':').update(entry.sha).update('|');
    }
    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const api = seedRepository(new FakeGitHubApi(), { default_branch: 'master' })
      .seedJson('/repos/owner/repo/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?recursive=1', {
        tree: entries.map((entry) => ({ ...entry, type: 'blob' }))
      })
      .seedBytes(
        `https://raw.githubusercontent.com/owner/repo/${commitSha}/skills/demo/SKILL.md`,
        encoder.encode('---\nname: Demo\n---\nInstructions')
      )
      .seedBytes(
        `https://raw.githubusercontent.com/owner/repo/${commitSha}/skills/demo/assets/data.bin`,
        new Uint8Array([0, 255, 3, 128])
      );
    const recordingApi = new RecordingGitHubApi(api);
    const adapter = new SkillsAdapter(makeSource('skills'), recordingApi, new FixedClock(0));

    await expect(invokePortableResolution(adapter, {
      bundleId: 'skills-owner-repo-demo',
      expectedSource: makeExpectedSource('skills', 'master'),
      resolution: {
        kind: 'pinned',
        provider: 'github-tree',
        version: `hash:${versionHash.digest('hex')}`,
        commitSha,
        bundlePath: 'skills/demo',
        sourceContentSha256: '0'.repeat(64)
      }
    })).rejects.toThrow(/source content|recorded digest/i);

    expect(recordingApi.calls.some((call) => call.pathOrUrl.includes('/commits/'))).toBe(false);
  });

  it('reports external collection inputs as unpinned instead of claiming a repository-only pin', async () => {
    const collectionYaml = [
      'id: external-bundle',
      'name: External Bundle',
      'description: Uses an external prompt',
      'items:',
      '  - path: https://example.com/prompt.md',
      '    kind: prompt'
    ].join('\n');
    const externalBytes = encoder.encode('# Remote prompt');
    const api = seedRepository(new FakeGitHubApi())
      .seedJson('/repos/owner/repo/commits/main', { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      .seedJson('/repos/owner/repo/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?recursive=1', {
        tree: [{ path: 'collections/external.collection.yml', type: 'blob', sha: 'collection-blob' }]
      })
      .seedBytes(
        'https://raw.githubusercontent.com/owner/repo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/collections/external.collection.yml',
        encoder.encode(collectionYaml)
      )
      .seedBytes('https://example.com/prompt.md', externalBytes);
    const adapter = new AwesomeCopilotAdapter(makeSource('awesome-copilot'), api, new FixedClock(0));

    const payload = await invokePortableResolution(adapter, {
      bundleId: 'external-bundle'
    });

    expect(payload?.resolution.kind).toBe('unpinned');
    if (payload?.resolution.kind === 'unpinned') {
      expect(payload.resolution.reason).toMatch(/external/i);
      expect(payload.resolution.evidence?.externalInputLimitations).toContain('https://example.com/prompt.md');
      expect(payload.resolution.evidence?.knownDigests?.sourceContentSha256).toBe(
        'c5a914bf566abddb5861951f07d49d2f58a996750ef7bbf63190408108c9e7c8'
      );
    }
    expect(payload?.files.get('prompts/prompt.md')).toEqual(externalBytes);
  });
});
