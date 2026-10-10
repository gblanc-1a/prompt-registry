import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  InvalidLogicalBundleKeyError,
  logicalBundleKey,
  logicalKeyFromLegacyId,
  parseLogicalBundleKey,
} from '../../../src/domain/bundle/logical-key';

describe('logicalBundleKey', () => {
  it('is source-qualified and version-independent', () => {
    expect(logicalBundleKey({ sourceId: 'github-abc123def456', manifestId: 'web-dev' }))
      .toBe('github-abc123def456/web-dev');
  });

  it('is source-qualified even with a single source — adding a second rekeys nothing', () => {
    // The withdrawn shorthand would have written "web-dev" here (design 5.13).
    expect(logicalBundleKey({ sourceId: 'only-source', manifestId: 'web-dev' }))
      .toBe('only-source/web-dev');
  });

  it('keeps two sources offering the same manifest id as two keys', () => {
    const a = logicalBundleKey({ sourceId: 'src-a', manifestId: 'shared' });
    const b = logicalBundleKey({ sourceId: 'src-b', manifestId: 'shared' });

    expect(a).not.toBe(b);
  });

  it('rejects a sourceId containing a slash (Review Focus 4)', () => {
    expect(() => logicalBundleKey({ sourceId: 'owner/repo', manifestId: 'web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });

  it('rejects a manifestId containing a slash (Review Focus 4)', () => {
    expect(() => logicalBundleKey({ sourceId: 'src', manifestId: 'team/web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });

  it('rejects an empty half', () => {
    expect(() => logicalBundleKey({ sourceId: '', manifestId: 'web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
    expect(() => logicalBundleKey({ sourceId: 'src', manifestId: '' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });
});

describe('parseLogicalBundleKey', () => {
  it('round-trips a well-formed key', () => {
    expect(parseLogicalBundleKey('src/web-dev')).toEqual({ sourceId: 'src', manifestId: 'web-dev' });
  });

  it('returns null for a key with no separator or more than one', () => {
    expect(parseLogicalBundleKey('web-dev')).toBeNull();
    expect(parseLogicalBundleKey('a/b/c')).toBeNull();
  });
});

describe('logicalKeyFromLegacyId', () => {
  it('strips an extension version suffix so both layers reach one key', () => {
    // Extension runtime id (github-adapter.ts:214) vs the bare CLI manifest.id.
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-1.0.0', 'src'))
      .toBe(logicalKeyFromLegacyId('owner-repo-web-dev', 'src'));
  });

  it('strips a v-prefixed version suffix too', () => {
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-v1.0.0', 'src'))
      .toBe('src/owner-repo-web-dev');
  });

  it('leaves a bare id untouched', () => {
    expect(logicalKeyFromLegacyId('web-dev', 'src')).toBe('src/web-dev');
  });

  it('does not strip a trailing segment that is not a version', () => {
    expect(logicalKeyFromLegacyId('web-dev-next', 'src')).toBe('src/web-dev-next');
  });
});
