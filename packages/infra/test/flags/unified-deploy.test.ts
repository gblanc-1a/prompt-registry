import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isUnifiedDeployEnabled,
  UNIFIED_DEPLOY_ENABLED,
} from '../../src/flags/unified-deploy';

describe('isUnifiedDeployEnabled', () => {
  it('defaults to off when unset or empty', () => {
    expect(isUnifiedDeployEnabled({})).toBe(false);
    expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: '' })).toBe(false);
  });

  it('accepts the three truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
      expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: value })).toBe(true);
    }
  });

  it('accepts the three falsy spellings', () => {
    for (const value of ['0', 'false', 'FALSE', 'no', 'No']) {
      expect(isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: value })).toBe(false);
    }
  });

  it('throws on an unrecognized value rather than guessing', () => {
    expect(() => isUnifiedDeployEnabled({ [UNIFIED_DEPLOY_ENABLED]: 'maybe' }))
      .toThrow(/AI_PRIMITIVES_HUB_UNIFIED_DEPLOY/);
  });
});
