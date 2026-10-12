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
});
