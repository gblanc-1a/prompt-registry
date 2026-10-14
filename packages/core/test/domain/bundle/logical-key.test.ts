import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  InvalidLogicalBundleKeyError,
  logicalBundleKey,
  logicalKeyFromLegacyId,
  parseLegacyLogicalBundleKey,
  parseLogicalBundleKey,
} from '../../../src/domain/bundle/logical-key';

const sourceKey = `src-${'a'.repeat(64)}`;

describe('logicalBundleKey', () => {
  it('builds a portable source-qualified key', () => {
    expect(logicalBundleKey({ sourceKey, logicalBundleId: 'web-dev' }))
      .toBe(`${sourceKey}/web-dev`);
  });

  it('keeps two portable sources offering the same id distinct', () => {
    const otherSourceKey = `src-${'b'.repeat(64)}`;
    expect(logicalBundleKey({ sourceKey, logicalBundleId: 'shared' }))
      .not.toBe(logicalBundleKey({ sourceKey: otherSourceKey, logicalBundleId: 'shared' }));
  });

  it('rejects a non-portable source key, empty id, or slash in the id', () => {
    expect(() => logicalBundleKey({ sourceKey: 'github-legacy', logicalBundleId: 'web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
    expect(() => logicalBundleKey({ sourceKey, logicalBundleId: '' }))
      .toThrow(InvalidLogicalBundleKeyError);
    expect(() => logicalBundleKey({ sourceKey, logicalBundleId: 'team/web-dev' }))
      .toThrow(InvalidLogicalBundleKeyError);
  });
});

describe('parseLogicalBundleKey', () => {
  it('returns the portable key components', () => {
    expect(parseLogicalBundleKey(`${sourceKey}/web-dev`))
      .toEqual({ sourceKey, logicalBundleId: 'web-dev' });
  });

  it('rejects unresolved, legacy, and ambiguous keys', () => {
    expect(parseLogicalBundleKey('unresolved/evidence')).toBeNull();
    expect(parseLogicalBundleKey('github-legacy/web-dev')).toBeNull();
    expect(parseLogicalBundleKey(`${sourceKey}/team/web-dev`)).toBeNull();
    expect(parseLogicalBundleKey('web-dev')).toBeNull();
  });
});

describe('legacy logical bundle keys', () => {
  it('decodes existing keys without treating them as active portable keys', () => {
    expect(parseLegacyLogicalBundleKey('github-legacy/web-dev'))
      .toEqual({ sourceId: 'github-legacy', manifestId: 'web-dev' });
    expect(parseLegacyLogicalBundleKey('unresolved/evidence'))
      .toEqual({ sourceId: 'unresolved', manifestId: 'evidence' });
  });

  it('keeps the legacy extension-id version suffix behavior isolated', () => {
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-1.0.0', 'github-legacy'))
      .toBe('github-legacy/owner-repo-web-dev');
    expect(logicalKeyFromLegacyId('owner-repo-web-dev-v1.0.0', 'github-legacy'))
      .toBe('github-legacy/owner-repo-web-dev');
    expect(logicalKeyFromLegacyId('web-dev-next', 'github-legacy'))
      .toBe('github-legacy/web-dev-next');
  });
});
