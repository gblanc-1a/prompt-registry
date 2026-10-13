import type {
  LocalSourceLocation,
  PortableBundlePayload,
  PortableBundleSelection,
  RegistrySource,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  LocalAdapter,
} from '../../src/adapters/local-adapter';
import {
  LocalAwesomeCopilotAdapter,
} from '../../src/adapters/local-awesome-copilot-adapter';
import {
  LocalSkillsAdapter,
} from '../../src/adapters/local-skills-adapter';
import {
  FixedClock,
} from '../helpers/fixed-clock';
import {
  InMemoryFileSystem,
} from '../helpers/in-memory-filesystem';

type PortableLocalAdapter = {
  resolvePortableBundle?: (selection: PortableBundleSelection) => Promise<PortableBundlePayload | null>;
};

function makeSource(overrides: Partial<RegistrySource> = {}): RegistrySource {
  return {
    id: 'local-test',
    name: 'Local Test',
    type: 'local',
    url: './registry',
    enabled: true,
    priority: 0,
    ...overrides
  };
}

function workspace(root: string): LocalSourceLocation {
  return { kind: 'workspace', root };
}

function binding(name: string, root: string): LocalSourceLocation {
  return { kind: 'binding', name, root };
}

async function resolve(
  adapter: object,
  selection: PortableBundleSelection
): Promise<PortableBundlePayload | null> {
  const resolver = (adapter as PortableLocalAdapter).resolvePortableBundle;
  expect(resolver).toBeTypeOf('function');
  if (!resolver) {
    throw new Error('Local adapter does not implement portable bundle resolution.');
  }
  return resolver.call(adapter, selection);
}

const deploymentManifest = (id = 'example-bundle', version = '1.0.0'): string => [
  `id: ${id}`,
  'name: Example Bundle',
  `version: ${version}`,
  'description: Portable local bundle',
  'author: test'
].join('\n');

const collectionManifest = (id = 'example-collection'): string => [
  `id: ${id}`,
  'name: Example Collection',
  'description: Portable local collection',
  'items:',
  '  - path: prompts/example.prompt.md',
  '    kind: prompt'
].join('\n');

describe('portable local source resolution', () => {
  it('derives the same workspace-relative identity and raw-content digest from different clone roots', async () => {
    const leftFs = new InMemoryFileSystem();
    leftFs.seed('/clone-a/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    leftFs.seed('/clone-a/registry/example-bundle/assets/icon.bin', new Uint8Array([0, 255, 10]));
    const rightFs = new InMemoryFileSystem();
    rightFs.seed('/clone-b/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    rightFs.seed('/clone-b/registry/example-bundle/assets/icon.bin', new Uint8Array([0, 255, 10]));

    const left = await resolve(
      new LocalAdapter(makeSource(), leftFs),
      { bundleId: 'example-bundle', localLocation: workspace('/clone-a') }
    );
    const right = await resolve(
      new LocalAdapter(makeSource(), rightFs),
      { bundleId: 'example-bundle', localLocation: workspace('/clone-b') }
    );

    expect(left?.source).toEqual(right?.source);
    expect(left?.source).toMatchObject({
      identity: { kind: 'workspace-local', root: 'registry' },
      locator: 'registry'
    });
    expect(left?.source.locator).not.toContain('/clone-a');
    expect(right?.source.locator).not.toContain('/clone-b');
    expect(left?.resolution).toMatchObject({ kind: 'pinned', provider: 'local-snapshot' });
    expect(left?.resolution).toEqual(right?.resolution);
    expect(left?.files.get('assets/icon.bin')).toEqual(new Uint8Array([0, 255, 10]));
  });

  it('keeps workspace roots and effective collection selectors distinct', async () => {
    const fs = new InMemoryFileSystem();
    fs.seed('/workspace/registry-a/example-bundle/deployment-manifest.yml', deploymentManifest());
    fs.seed('/workspace/registry-b/example-bundle/deployment-manifest.yml', deploymentManifest());
    fs.seed('/workspace/collections-a/example.collection.yml', collectionManifest());
    fs.seed('/workspace/collections-b/example.collection.yml', collectionManifest());
    fs.seed('/workspace/prompts/example.prompt.md', '# Example prompt');

    const registryA = await resolve(
      new LocalAdapter(makeSource({ url: './registry-a' }), fs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    );
    const registryB = await resolve(
      new LocalAdapter(makeSource({ url: './registry-b' }), fs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    );
    const collectionsA = await resolve(
      new LocalAwesomeCopilotAdapter(makeSource({
        type: 'local-awesome-copilot',
        url: './',
        config: { collectionsPath: 'collections-a' }
      }), fs),
      { bundleId: 'example-collection', localLocation: workspace('/workspace') }
    );
    const collectionsB = await resolve(
      new LocalAwesomeCopilotAdapter(makeSource({
        type: 'local-awesome-copilot',
        url: './',
        config: { collectionsPath: 'collections-b' }
      }), fs),
      { bundleId: 'example-collection', localLocation: workspace('/workspace') }
    );

    expect(registryA?.source).not.toEqual(registryB?.source);
    expect(collectionsA?.source).not.toEqual(collectionsB?.source);
    expect(collectionsA?.source.identity).toMatchObject({ collectionsPath: 'collections-a' });
    expect(collectionsB?.source.identity).toMatchObject({ collectionsPath: 'collections-b' });
  });

  it('requires explicit external bindings instead of matching same-basename directories', async () => {
    const fs = new InMemoryFileSystem();
    fs.seed('/machine/alice/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    fs.seed('/machine/bob/registry/example-bundle/deployment-manifest.yml', deploymentManifest());

    await expect(resolve(
      new LocalAdapter(makeSource({ url: '/machine/alice/registry' }), fs),
      { bundleId: 'example-bundle' }
    )).rejects.toThrow(/workspace root or an explicit local binding/i);

    const alice = await resolve(
      new LocalAdapter(makeSource({ url: '/machine/alice/registry' }), fs),
      { bundleId: 'example-bundle', localLocation: binding('alice-registry', '/machine/alice/registry') }
    );
    const bob = await resolve(
      new LocalAdapter(makeSource({ url: '/machine/bob/registry' }), fs),
      { bundleId: 'example-bundle', localLocation: binding('bob-registry', '/machine/bob/registry') }
    );

    expect(alice?.source).toMatchObject({
      identity: { kind: 'external-local', bindingName: 'alice-registry' },
      locator: 'alice-registry'
    });
    expect(bob?.source).toMatchObject({
      identity: { kind: 'external-local', bindingName: 'bob-registry' },
      locator: 'bob-registry'
    });
    expect(alice?.source).not.toEqual(bob?.source);
  });

  it('rejects missing and out-of-workspace local locations with actionable diagnostics', async () => {
    const fs = new InMemoryFileSystem();

    await expect(resolve(
      new LocalAdapter(makeSource({ url: './registry' }), fs),
      { bundleId: 'example-bundle' }
    )).rejects.toThrow(/supply.*workspace root|explicit.*binding/i);

    await expect(resolve(
      new LocalAdapter(makeSource({ url: '/machine-a/registry' }), fs),
      {
        bundleId: 'example-bundle',
        localLocation: binding('registry', '/machine-b/registry')
      }
    )).rejects.toMatchObject({ code: 'CONFIG.CONFLICTING_LOCAL_BINDING' });

    await expect(resolve(
      new LocalAdapter(makeSource({ url: './../outside' }), fs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    )).rejects.toThrow(/outside.*workspace|within.*workspace/i);
  });

  it('hashes direct binary reads independently of directory enumeration order', async () => {
    const firstFs = new InMemoryFileSystem();
    firstFs.seed('/workspace/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    firstFs.seed('/workspace/registry/example-bundle/a.bin', new Uint8Array([0, 128, 255]));
    firstFs.seed('/workspace/registry/example-bundle/b.bin', new Uint8Array([17, 18]));
    const secondFs = new InMemoryFileSystem();
    secondFs.seed('/workspace/registry/example-bundle/b.bin', new Uint8Array([17, 18]));
    secondFs.seed('/workspace/registry/example-bundle/a.bin', new Uint8Array([0, 128, 255]));
    secondFs.seed('/workspace/registry/example-bundle/deployment-manifest.yml', deploymentManifest());

    const first = await resolve(
      new LocalAdapter(makeSource(), firstFs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    );
    const second = await resolve(
      new LocalAdapter(makeSource(), secondFs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    );

    expect(first?.files.get('a.bin')).toEqual(new Uint8Array([0, 128, 255]));
    expect(first?.resolution).toEqual(second?.resolution);
  });

  it('does not follow symlinks while building a local snapshot inventory', async () => {
    const linkedPath = '/workspace/registry/example-bundle/linked.bin';
    class FileSystemWithLink extends InMemoryFileSystem {
      public override async readDirEntries(directory: string) {
        if (directory === '/workspace/registry/example-bundle/linked-directory') {
          throw new Error('A symbolic-link directory must not be traversed.');
        }
        const entries = await super.readDirEntries(directory);
        return directory === '/workspace/registry/example-bundle'
          ? [
            ...entries,
            { name: 'linked.bin', isDirectory: false },
            { name: 'linked-directory', isDirectory: false }
          ]
          : entries;
      }

      public override async lstat(filePath: string) {
        if (filePath === linkedPath || filePath === '/workspace/registry/example-bundle/linked-directory') {
          return { isDirectory: false, isFile: false, isSymbolicLink: true, size: 0, mtimeMs: 0 };
        }
        return super.lstat(filePath);
      }
    }
    const fs = new FileSystemWithLink();
    fs.seed('/workspace/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    const readFileBytes = vi.spyOn(fs, 'readFileBytes');

    const payload = await resolve(
      new LocalAdapter(makeSource(), fs),
      { bundleId: 'example-bundle', localLocation: workspace('/workspace') }
    );

    expect(payload?.files.has('linked.bin')).toBe(false);
    expect(readFileBytes).not.toHaveBeenCalledWith(linkedPath);
  });

  it('rejects local snapshot replay when the selected source content digest changed', async () => {
    const fs = new InMemoryFileSystem();
    fs.seed('/workspace/registry/example-bundle/deployment-manifest.yml', deploymentManifest());
    fs.seed('/workspace/registry/example-bundle/content.md', 'before');
    const adapter = new LocalAdapter(makeSource(), fs);
    const initial = await resolve(adapter, {
      bundleId: 'example-bundle',
      localLocation: workspace('/workspace')
    });
    fs.seed('/workspace/registry/example-bundle/content.md', 'after');

    await expect(resolve(adapter, {
      bundleId: 'example-bundle',
      version: initial?.version,
      expectedSource: initial?.source,
      resolution: initial?.resolution,
      localLocation: workspace('/workspace')
    })).rejects.toMatchObject({ code: 'BUNDLE.ARTIFACT_PIN_MISMATCH' });
  });

  it('keeps local-skills live across replay without writing to or copying over its source', async () => {
    const fs = new InMemoryFileSystem();
    fs.seed('/workspace/skills/skills/my-skill/SKILL.md', '---\nname: My Skill\n---\nInstructions');
    fs.seed('/workspace/skills/skills/my-skill/assets/data.bin', new Uint8Array([0, 255]));
    const writeFile = vi.spyOn(fs, 'writeFile');
    const writeFileBytes = vi.spyOn(fs, 'writeFileBytes');
    const adapter = new LocalSkillsAdapter(
      makeSource({ type: 'local-skills', url: './skills' }),
      fs,
      new FixedClock(0)
    );
    const initial = await resolve(adapter, {
      bundleId: 'my-skill',
      localLocation: workspace('/workspace')
    });
    const replayed = await resolve(adapter, {
      bundleId: 'my-skill',
      expectedSource: initial?.source,
      resolution: initial?.resolution,
      localLocation: workspace('/workspace')
    });

    expect(initial?.resolution).toMatchObject({ kind: 'live', selector: 'skills/my-skill' });
    expect(replayed?.resolution).toEqual(initial?.resolution);
    expect(replayed?.files.get('skills/my-skill/assets/data.bin')).toEqual(new Uint8Array([0, 255]));
    expect(writeFile).not.toHaveBeenCalled();
    expect(writeFileBytes).not.toHaveBeenCalled();
  });

  it('does not let a repeated external binding name replay a snapshot over different root content', async () => {
    const firstFs = new InMemoryFileSystem();
    firstFs.seed('/machine-a/prompts/example-bundle/deployment-manifest.yml', deploymentManifest());
    firstFs.seed('/machine-a/prompts/example-bundle/content.md', 'first owner');
    const secondFs = new InMemoryFileSystem();
    secondFs.seed('/machine-b/prompts/example-bundle/deployment-manifest.yml', deploymentManifest());
    secondFs.seed('/machine-b/prompts/example-bundle/content.md', 'second owner');
    const first = await resolve(
      new LocalAdapter(makeSource({ url: '/machine-a/prompts' }), firstFs),
      { bundleId: 'example-bundle', localLocation: binding('shared-name', '/machine-a/prompts') }
    );

    await expect(resolve(
      new LocalAdapter(makeSource({ url: '/machine-b/prompts' }), secondFs),
      {
        bundleId: 'example-bundle',
        expectedSource: first?.source,
        resolution: first?.resolution,
        localLocation: binding('shared-name', '/machine-b/prompts')
      }
    )).rejects.toMatchObject({ code: 'BUNDLE.ARTIFACT_PIN_MISMATCH' });
  });
});
