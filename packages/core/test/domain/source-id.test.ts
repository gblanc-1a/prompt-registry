/**
 * Coverage tests for domain/source-id.ts.
 *
 * Tests source ID generation functions: normalizeUrl, generateSourceId, generateHubKey.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  generateHubKey,
  generateSourceId,
  normalizeUrl,
} from '../../src/domain/source-id';

describe('normalizeUrl', () => {
  it('normalizes HTTPS URL', () => {
    expect(normalizeUrl('https://github.com/owner/repo')).toBe('github.com/owner/repo');
  });

  it('normalizes HTTP URL', () => {
    expect(normalizeUrl('http://github.com/owner/repo')).toBe('github.com/owner/repo');
  });

  it('lowercases host and path', () => {
    expect(normalizeUrl('https://GitHub.com/Owner/Repo')).toBe('github.com/owner/repo');
  });

  it('removes trailing slashes', () => {
    expect(normalizeUrl('https://github.com/owner/repo/')).toBe('github.com/owner/repo');
  });

  it('removes multiple trailing slashes', () => {
    expect(normalizeUrl('https://github.com/owner/repo///')).toBe('github.com/owner/repo');
  });

  it('handles invalid URL with regex fallback', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('handles malformed URL with regex fallback', () => {
    expect(normalizeUrl('ht://invalid')).toBe('invalid');
  });

  it('strips protocol with regex fallback', () => {
    expect(normalizeUrl('github.com/owner/repo')).toBe('github.com/owner/repo');
  });
});

describe('generateSourceId', () => {
  it('generates stable sourceId for github source', () => {
    const id = generateSourceId('github', 'https://github.com/owner/repo');
    expect(id).toMatch(/^github-[a-f0-9]{12}$/);
  });

  it('generates same ID for same source regardless of URL case', () => {
    const id1 = generateSourceId('github', 'https://GitHub.com/Owner/Repo');
    const id2 = generateSourceId('github', 'https://github.com/owner/repo');
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different source types', () => {
    const githubId = generateSourceId('github', 'https://github.com/owner/repo');
    const apmId = generateSourceId('apm', 'https://github.com/owner/repo');
    expect(githubId).not.toBe(apmId);
  });

  it('includes branch in hash', () => {
    const mainId = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'main' });
    const devId = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'develop' });
    expect(mainId).not.toBe(devId);
  });

  it('canonicalizes master to main', () => {
    const masterId = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'master' });
    const mainId = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'main' });
    const defaultId = generateSourceId('github', 'https://github.com/owner/repo');
    expect(masterId).toBe(mainId);
    expect(defaultId).toBe(mainId);
  });

  it('includes collectionsPath in hash', () => {
    const defaultId = generateSourceId('github', 'https://github.com/owner/repo');
    const customId = generateSourceId('github', 'https://github.com/owner/repo', { collectionsPath: 'custom-collections' });
    expect(defaultId).not.toBe(customId);
  });
});

describe('generateHubKey', () => {
  it('generates 12-char hash for main branch', () => {
    const key = generateHubKey('https://github.com/owner/repo', 'main');
    expect(key).toMatch(/^[a-f0-9]{12}$/);
  });

  it('generates 12-char hash for master branch (canonicalized)', () => {
    const key = generateHubKey('https://github.com/owner/repo', 'master');
    expect(key).toMatch(/^[a-f0-9]{12}$/);
  });

  it('generates 12-char hash for no branch (defaults to main)', () => {
    const key = generateHubKey('https://github.com/owner/repo');
    expect(key).toMatch(/^[a-f0-9]{12}$/);
  });

  it('generates hash-branch format for non-main branches', () => {
    const key = generateHubKey('https://github.com/owner/repo', 'develop');
    expect(key).toMatch(/^[a-f0-9]{12}-develop$/);
  });

  it('generates same key for main and master', () => {
    const mainKey = generateHubKey('https://github.com/owner/repo', 'main');
    const masterKey = generateHubKey('https://github.com/owner/repo', 'master');
    expect(mainKey).toBe(masterKey);
  });

  it('generates same key for no branch and main', () => {
    const noBranchKey = generateHubKey('https://github.com/owner/repo');
    const mainKey = generateHubKey('https://github.com/owner/repo', 'main');
    expect(noBranchKey).toBe(mainKey);
  });

  it('generates different keys for different branches', () => {
    const mainKey = generateHubKey('https://github.com/owner/repo', 'main');
    const devKey = generateHubKey('https://github.com/owner/repo', 'develop');
    expect(mainKey).not.toBe(devKey);
  });
});
