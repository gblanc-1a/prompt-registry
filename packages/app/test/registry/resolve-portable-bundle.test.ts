import {
  createHash,
} from 'node:crypto';
import {
  sourceContentDigest,
  sourceKey,
} from '@ai-primitives-hub/core';
import type {
  Clock,
  HttpClient,
  ProcessRunner,
  RegistrySource,
  TokenProvider,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createDeployRequest,
} from '../../src/deploy/create-request';
import type {
  SourceAdapterFactoryDeps,
} from '../../src/registry/create-source-adapter';
import {
  resolvePortableBundle,
} from '../../src/registry/resolve-portable-bundle';
import {
  InMemoryFileSystem,
} from '../helpers/in-memory-filesystem';

const workspace = '/workspace';
const files = new Map<string, Uint8Array>([
  ['bundles/selected/deployment-manifest.yml', new TextEncoder().encode(
    'id: manifest-id\nversion: 1.2.3\nname: Selected\nprompts:\n  - id: hello\n    file: prompts/hello.md\n    type: prompt\n'
  )],
  ['bundles/selected/prompts/hello.md', new TextEncoder().encode('# Hello\n')]
]);

class SourceFileSystem extends InMemoryFileSystem {
  public async lstat(filePath: string) {
    if (filePath === '/') {
      return { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, mtimeMs: 0 };
    }
    const entry = await this.stat(filePath);
    return { ...entry, isSymbolicLink: false };
  }
}

class NoClock implements Clock {
  public now(): number {
    return 0;
  }

  public nowIso(): string {
    return '2026-10-13T00:00:00.000Z';
  }
}

class NoHttp implements HttpClient {
  public async fetch(): Promise<never> {
    throw new Error('HTTP is not expected');
  }
}

class NoProcess implements ProcessRunner {
  public async exec(): Promise<never> {
    throw new Error('Processes are not expected');
  }
}

class NoToken implements TokenProvider {
  public async getToken(): Promise<undefined> {
    return undefined;
  }
}

const depsFor = (fs = new SourceFileSystem()): SourceAdapterFactoryDeps => ({
  fs,
  clock: new NoClock(),
  httpClient: new NoHttp(),
  processRunner: new NoProcess(),
  fallbackTokenProviders: [new NoToken()]
});

const localSource = (id: string, name: string): RegistrySource => ({
  id,
  name,
  type: 'local',
  url: './bundles',
  enabled: true,
  priority: 0
});

const seed = (fs: SourceFileSystem): void => {
  for (const [filePath, content] of files) {
    fs.seed(`${workspace}/${filePath}`, content);
  }
};

describe('resolvePortableBundle', () => {
  it('resolves through the source adapter and returns identity independent of registry aliases', async () => {
    const firstFs = new SourceFileSystem();
    const secondFs = new SourceFileSystem();
    seed(firstFs);
    seed(secondFs);
    const selection = {
      bundleId: 'manifest-id',
      version: '1.2.3',
      localLocation: { kind: 'workspace' as const, root: workspace }
    };

    const first = await resolvePortableBundle(localSource('registry-a', 'Friendly A'), selection, depsFor(firstFs));
    const second = await resolvePortableBundle(localSource('registry-b', 'Friendly B'), selection, depsFor(secondFs));

    expect(first.logicalBundleId).toBe('manifest-id');
    expect(first.manifestId).toBe('manifest-id');
    expect(first.source).toEqual(second.source);
    expect(first.sourceFiles).toEqual(new Map([
      ['deployment-manifest.yml', files.get('bundles/selected/deployment-manifest.yml')],
      ['prompts/hello.md', files.get('bundles/selected/prompts/hello.md')]
    ]));
    expect(sourceKey(first.source.identity, first.source.type)).toBe(
      sourceKey(second.source.identity, second.source.type)
    );
    expect(first.resolution).toEqual({
      kind: 'pinned',
      provider: 'local-snapshot',
      version: '1.2.3',
      bundleSelector: 'selected',
      sourceContentSha256: sourceContentDigest(first.sourceFiles!)
    });
  });

  it('rejects an adapter without portable resolution capability', async () => {
    await expect(resolvePortableBundle({
      id: 'legacy-source',
      name: 'Legacy source',
      type: 'apm',
      url: 'https://github.com/owner/repo',
      enabled: true,
      priority: 0
    }, { bundleId: 'bundle' }, depsFor())).rejects.toMatchObject({
      code: 'BUNDLE.UNSUPPORTED_PORTABLE_RESOLUTION'
    });
  });

  it('fails closed when a pinned local content digest does not match', async () => {
    const fs = new SourceFileSystem();
    seed(fs);

    await expect(resolvePortableBundle(localSource('registry', 'Registry'), {
      bundleId: 'manifest-id',
      version: '1.2.3',
      localLocation: { kind: 'workspace', root: workspace },
      resolution: {
        kind: 'pinned',
        provider: 'local-snapshot',
        version: '1.2.3',
        bundleSelector: 'selected',
        sourceContentSha256: '0'.repeat(64)
      }
    }, depsFor(fs))).rejects.toMatchObject({ code: 'BUNDLE.ARTIFACT_PIN_MISMATCH' });
  });

  it('carries original archive bytes and the verified digest into the deploy request', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
    const descriptor = {
      type: 'github' as const,
      identity: { kind: 'github-releases' as const, origin: 'https://github.com', repositoryId: '123' },
      locator: 'https://github.com/owner/repo'
    };
    const payload = {
      source: descriptor,
      logicalBundleId: 'catalog-id',
      manifestId: 'manifest-id',
      version: '1.2.3',
      resolution: {
        kind: 'pinned' as const,
        provider: 'github-release' as const,
        version: '1.2.3',
        releaseId: '10',
        assetId: '20',
        archiveSha256
      },
      files,
      bytes
    };

    const request = createDeployRequest({
      payload,
      targetName: 'my-vscode',
      runtimeAssetRoot: '/runtime',
      placement: {
        scope: 'user',
        targetType: 'vscode',
        resolvedLayout: { baseDir: '/target', kindRoutes: {}, skipPaths: [] },
        baseRoot: '/target',
        env: {}
      }
    });

    expect(request.bundle).toEqual({ bundleId: 'catalog-id', version: '1.2.3' });
    expect(request.manifestId).toBe('manifest-id');
    expect(request.source.sourceKey).toBe(sourceKey(descriptor.identity, descriptor.type));
    expect(request.source.descriptor).toEqual(descriptor);
    expect(request.bytes).toBe(bytes);
    expect(request.files).toBe(files);
    expect(request.expectedArchiveSha).toBe(`sha256:${archiveSha256}`);
  });
});
