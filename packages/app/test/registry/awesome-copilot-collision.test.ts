import type {
  Clock,
  EtaggedResult,
  GitHubApi,
  RegistrySource,
} from '@ai-primitives-hub/core';
import {
  AwesomeCopilotAdapter,
} from '@ai-primitives-hub/infra';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createDeployRequest,
} from '../../src/deploy/create-request';
import {
  planDeploy,
} from '../../src/deploy/plan';
import {
  recordingPorts,
} from '../deploy/fixtures';

const commitSha = 'a'.repeat(40);
const externalUrl = 'https://example.com/prompts/review.prompt.md';
const source: RegistrySource = {
  id: 'remote-collection',
  name: 'Remote collection',
  type: 'awesome-copilot',
  url: 'https://github.com/owner/repo',
  enabled: true,
  priority: 0,
  config: { branch: 'main', collectionsPath: 'collections' }
};

class FixedClock implements Clock {
  public now(): number {
    return 0;
  }

  public nowIso(): string {
    return '2026-10-14T12:00:00.000Z';
  }
}

class CollectionGitHubApi implements GitHubApi {
  private readonly content = new Map<string, Uint8Array>();

  public constructor(items: { path: string; kind: string }[]) {
    this.content.set(
      `https://raw.githubusercontent.com/owner/repo/${commitSha}/collections/demo.collection.yml`,
      new TextEncoder().encode([
        'id: demo',
        'name: Demo',
        'description: Demo collection',
        'version: 1.0.0',
        'items:',
        ...items.flatMap(({ path, kind }) => [`  - path: ${path}`, `    kind: ${kind}`])
      ].join('\n'))
    );
    for (const [path, body] of [
      ['a/review.prompt.md', '# first repository input\n'],
      ['b/review.prompt.md', '# second repository input\n'],
      [externalUrl, '# external input\n']
    ]) {
      this.content.set(
        path.startsWith('http')
          ? path
          : `https://raw.githubusercontent.com/owner/repo/${commitSha}/${path}`,
        new TextEncoder().encode(body)
      );
    }
  }

  public async getJson<T>(path: string): Promise<T> {
    if (path === '/repos/owner/repo') {
      return {
        id: 123,
        html_url: 'https://github.com/owner/repo',
        default_branch: 'main'
      } as T;
    }
    if (path === '/repos/owner/repo/commits/main') {
      return { sha: commitSha } as T;
    }
    if (path === `/repos/owner/repo/git/trees/${commitSha}?recursive=1`) {
      return {
        tree: [
          { path: 'collections/demo.collection.yml', type: 'blob' },
          { path: 'a/review.prompt.md', type: 'blob' },
          { path: 'b/review.prompt.md', type: 'blob' }
        ]
      } as T;
    }
    throw new Error(`Unexpected GitHub API path: ${path}`);
  }

  public async getText(path: string): Promise<string> {
    throw new Error(`Unexpected GitHub text request: ${path}`);
  }

  public async download(path: string): Promise<Uint8Array> {
    const bytes = this.content.get(path);
    if (bytes === undefined) {
      throw new Error(`Unexpected GitHub download: ${path}`);
    }
    return bytes;
  }

  public async getJsonWithEtag<T>(path: string): Promise<EtaggedResult<T>> {
    return { status: 'ok', value: await this.getJson<T>(path), etag: undefined };
  }
}

describe('remote collection output collisions', () => {
  it.each([
    {
      label: 'repository inputs',
      items: [
        { path: 'a/review.prompt.md', kind: 'prompt' },
        { path: 'b/review.prompt.md', kind: 'prompt' }
      ]
    },
    {
      label: 'repository and external inputs',
      items: [
        { path: 'a/review.prompt.md', kind: 'prompt' },
        { path: externalUrl, kind: 'prompt' }
      ]
    }
  ])('refuses $label collisions before request planning or mutation', async ({ items }) => {
    const ports = recordingPorts();
    const adapter = new AwesomeCopilotAdapter(source, new CollectionGitHubApi(items), new FixedClock());

    await expect(async () => {
      const payload = await adapter.resolvePortableBundle({ bundleId: 'demo', version: '1.0.0' });
      if (payload === null) {
        throw new Error('Expected the selected collection to resolve.');
      }
      const request = createDeployRequest({
        payload,
        targetName: 'my-vscode',
        runtimeAssetRoot: '/runtime',
        placement: {
          scope: 'user',
          targetType: 'vscode',
          resolvedLayout: {
            baseDir: '${HOME}/.copilot',
            kindRoutes: { 'prompts/': 'prompts/' },
            skipPaths: ['deployment-manifest.yml']
          },
          baseRoot: '/home/u/.copilot',
          env: { HOME: '/home/u' }
        }
      });
      await planDeploy(request, ports);
    }).rejects.toMatchObject({ code: 'BUNDLE.OUTPUT_PATH_COLLISION' });

    expect(ports.calls.filter((call) => /^(writeFile|writeFileBytes|rename|remove|mkdir):/.test(call)))
      .toEqual([]);
  });
});
