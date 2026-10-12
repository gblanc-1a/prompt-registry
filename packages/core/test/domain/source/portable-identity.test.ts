import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  RegistryError,
} from '../../../src/domain/registry-error';
import {
  assertSourceKey,
  sameSourceIdentity,
  sourceKey,
} from '../../../src/domain/source/portable-identity';
import type {
  PortableSourceDescriptor,
  SourceIdentity,
} from '../../../src/domain/source/portable-identity';

const releaseIdentity = (
  origin: string,
  repositoryId: string
): SourceIdentity => ({
  kind: 'github-releases',
  origin,
  repositoryId
});

const sourceAt = (
  locator: string,
  credentialRef = 'github-token'
): PortableSourceDescriptor => ({
  type: 'github',
  identity: releaseIdentity('https://github.com', '42'),
  locator,
  config: { credentialRef, authMode: 'bearer', ref: 'display-tag' }
});

const treeIdentity = (ref: string): SourceIdentity => ({
  kind: 'github-tree',
  origin: 'https://github.com',
  repositoryId: '42',
  ref,
  collectionsPath: 'collections'
});

const azureIdentity = (repositoryId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'): SourceIdentity => ({
  kind: 'azure-devops-tree',
  namespace: 'contoso/agent-tools',
  repositoryId,
  ref: 'main',
  collectionsPath: 'collections'
});

describe('portable source identity', () => {
  it('hashes canonical identity into a full portable source key', () => {
    expect(sourceKey(releaseIdentity('https://github.com', '42'), 'github'))
      .toMatch(/^src-[a-f0-9]{64}$/);

    const forwardOrder: SourceIdentity = {
      kind: 'github-releases',
      origin: 'https://github.com',
      repositoryId: '42'
    };
    const reverseOrder: SourceIdentity = {
      repositoryId: '42',
      origin: 'https://github.com',
      kind: 'github-releases'
    };
    expect(sourceKey(forwardOrder, 'github')).toBe(sourceKey(reverseOrder, 'github'));
  });

  it('keeps repository renames, credentials, and display configuration out of identity', () => {
    expect(sameSourceIdentity(sourceAt('https://github.com/old/repo'), sourceAt('https://github.com/new/repo', 'other-token')))
      .toBe(true);
  });

  it('does not equate different effective refs or adapters', () => {
    const main = treeIdentity('main');
    const master = treeIdentity('master');
    expect(sourceKey(main, 'skills')).not.toBe(sourceKey(master, 'skills'));
    expect(sourceKey(main, 'skills')).not.toBe(sourceKey(main, 'awesome-copilot'));
  });

  it('hashes only content selectors consumed by the selected tree adapter', () => {
    const skillsWithUnusedCollectionsPath: SourceIdentity = {
      kind: 'github-tree',
      origin: 'https://github.com',
      repositoryId: '42',
      ref: 'main',
      skillsPath: 'skills',
      collectionsPath: 'unused-a'
    };
    const skillsWithAnotherUnusedCollectionsPath: SourceIdentity = {
      ...skillsWithUnusedCollectionsPath,
      collectionsPath: 'unused-b'
    };
    expect(sourceKey(skillsWithUnusedCollectionsPath, 'skills'))
      .toBe(sourceKey(skillsWithAnotherUnusedCollectionsPath, 'skills'));
    expect(sourceKey(skillsWithUnusedCollectionsPath, 'awesome-copilot'))
      .not.toBe(sourceKey(skillsWithAnotherUnusedCollectionsPath, 'awesome-copilot'));
  });

  it('ignores indexFile for the Awesome Copilot adapter', () => {
    const awesomeTree = (indexFile: string): SourceIdentity => ({
      kind: 'github-tree',
      origin: 'https://github.com',
      repositoryId: '42',
      ref: 'main',
      collectionsPath: 'collections',
      indexFile
    });

    expect(sourceKey(awesomeTree('index-a.yml'), 'awesome-copilot'))
      .toBe(sourceKey(awesomeTree('index-b.yml'), 'awesome-copilot'));
  });

  it('ignores indexFile for the local Awesome Copilot adapter', () => {
    const localAwesomeTree = (indexFile: string): SourceIdentity => ({
      kind: 'workspace-local',
      root: 'awesome-copilot',
      collectionsPath: 'collections',
      indexFile
    });

    expect(sourceKey(localAwesomeTree('index-a.yml'), 'local-awesome-copilot'))
      .toBe(sourceKey(localAwesomeTree('index-b.yml'), 'local-awesome-copilot'));
  });

  it('preserves scheme, effective port, and case-sensitive source paths', () => {
    const https = releaseIdentity('https://github.com', '42');
    const http = releaseIdentity('http://github.com', '42');
    const alternatePort = releaseIdentity('https://github.com:8443', '42');
    expect(sourceKey(https, 'github')).not.toBe(sourceKey(http, 'github'));
    expect(sourceKey(https, 'github')).not.toBe(sourceKey(alternatePort, 'github'));

    const upperPath: SourceIdentity = {
      kind: 'artifactory-index',
      root: 'https://repo.example/artifacts/Team',
      indexFile: 'index-v1.json'
    };
    const lowerPath: SourceIdentity = {
      kind: 'artifactory-index',
      root: 'https://repo.example/artifacts/team',
      indexFile: 'index-v1.json'
    };
    expect(sourceKey(upperPath, 'artifactory')).not.toBe(sourceKey(lowerPath, 'artifactory'));
  });

  it('requires GitHub repository IDs to be canonical positive decimal IDs', () => {
    expect(() => sourceKey(releaseIdentity('https://github.com', 'not-a-provider-id'), 'github'))
      .toThrow(RegistryError);
  });

  it('rejects non-canonical decimal GitHub repository IDs', () => {
    expect(() => sourceKey(releaseIdentity('https://github.com', '042'), 'github'))
      .toThrow(RegistryError);
  });

  it('normalizes Azure DevOps UUID repository IDs', () => {
    expect(sourceKey(azureIdentity(), 'azure-devops'))
      .toBe(sourceKey(azureIdentity('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), 'azure-devops'));
  });

  it('rejects non-UUID Azure DevOps repository IDs', () => {
    expect(() => sourceKey(azureIdentity('not-a-provider-id'), 'azure-devops'))
      .toThrow(RegistryError);
  });

  it('keeps Azure DevOps effective refs in identity', () => {
    expect(sourceKey(azureIdentity(), 'azure-devops'))
      .not.toBe(sourceKey({ ...azureIdentity(), ref: 'master' }, 'azure-devops'));
  });

  it('rejects invalid or credential-bearing source locators', () => {
    const key = sourceKey(releaseIdentity('https://github.com', '42'), 'github');
    const credentialBearingLocator = new URL('https://github.com/team/repo');
    credentialBearingLocator.username = 'test-user';
    credentialBearingLocator.password = 'test-password';
    expect(() => assertSourceKey(key, sourceAt(credentialBearingLocator.toString())))
      .toThrow(RegistryError);
    expect(() => assertSourceKey(key, sourceAt('https://[invalid')))
      .toThrow(RegistryError);
    expect(() => assertSourceKey(key, sourceAt('https://github.com/team/repo?access_token=secret')))
      .toThrow(RegistryError);
    expect(() => assertSourceKey(`src-${'0'.repeat(64)}`, sourceAt('https://github.com/team/repo')))
      .toThrow(RegistryError);
  });

  it('rejects identity paths that cannot be safely represented', () => {
    const invalidIdentity: SourceIdentity = {
      kind: 'artifactory-index',
      root: 'https://repo.example/team/repo',
      indexFile: '../index.json'
    };
    expect(() => sourceKey(invalidIdentity, 'artifactory')).toThrow(RegistryError);
  });

  it('keeps workspace-local identity roots relative to the selected workspace', () => {
    const localRoot = (root: string): SourceIdentity => ({
      kind: 'workspace-local',
      root
    });
    expect(() => sourceKey(localRoot('/Users/alice/repo/prompts'), 'local'))
      .toThrow(RegistryError);
    expect(() => sourceKey(localRoot('../outside'), 'local'))
      .toThrow(RegistryError);
  });

  it('accepts only matching workspace-relative locators', () => {
    const workspaceSource = (locator: string): PortableSourceDescriptor => ({
      type: 'local',
      identity: { kind: 'workspace-local', root: 'prompts' },
      locator
    });

    const workspaceKey = sourceKey({ kind: 'workspace-local', root: 'prompts' }, 'local');
    expect(() => assertSourceKey(workspaceKey, workspaceSource('prompts'))).not.toThrow();
    expect(() => assertSourceKey(workspaceKey, workspaceSource('/Users/alice/prompts')))
      .toThrow(RegistryError);
    expect(() => assertSourceKey(workspaceKey, workspaceSource('different-prompts')))
      .toThrow(RegistryError);
  });

  it('accepts only matching external-binding locators', () => {
    const externalSource = (locator: string): PortableSourceDescriptor => ({
      type: 'local',
      identity: { kind: 'external-local', bindingName: 'team-prompts' },
      locator
    });
    const externalKey = sourceKey({ kind: 'external-local', bindingName: 'team-prompts' }, 'local');
    expect(() => assertSourceKey(externalKey, externalSource('team-prompts'))).not.toThrow();
    expect(() => assertSourceKey(externalKey, externalSource('/Users/alice/prompts')))
      .toThrow(RegistryError);
    expect(() => assertSourceKey(externalKey, externalSource('other-binding')))
      .toThrow(RegistryError);
  });

  it('includes external-local binding names and consumed selectors in identity', () => {
    const externalSource = (bindingName: string, collectionsPath: string): SourceIdentity => ({
      kind: 'external-local',
      bindingName,
      collectionsPath,
      indexFile: 'unused-index.yml'
    });

    expect(sourceKey(externalSource('team-prompts', 'collections'), 'local-awesome-copilot'))
      .not.toBe(sourceKey(externalSource('other-prompts', 'collections'), 'local-awesome-copilot'));
    expect(sourceKey(externalSource('team-prompts', 'collections'), 'local-awesome-copilot'))
      .not.toBe(sourceKey(externalSource('team-prompts', 'other-collections'), 'local-awesome-copilot'));
    expect(sourceKey(externalSource('team-prompts', 'collections'), 'local-awesome-copilot'))
      .toBe(sourceKey({ ...externalSource('team-prompts', 'collections'), indexFile: 'another-index.yml' }, 'local-awesome-copilot'));
  });
});
