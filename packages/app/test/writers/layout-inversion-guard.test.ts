/**
 * The §4.3 guard: inverting every built-in layout must be unambiguous,
 * and no built-in may carry a key the kind vocabulary cannot resolve.
 * A future layout edit that breaks either property fails here rather
 * than silently misplacing files.
 */
import {
  invertKindRoutes,
  TARGET_TYPES,
} from '@ai-primitives-hub/core';
import {
  defaultLayouts,
} from '@ai-primitives-hub/infra';
import {
  describe,
  expect,
  it,
} from 'vitest';

const SCOPES = ['user', 'repository'] as const;

describe('built-in layout inversion', () => {
  for (const targetType of TARGET_TYPES) {
    for (const scope of SCOPES) {
      it(`${targetType} / ${scope} inverts to one directory per kind`, () => {
        const def = defaultLayouts.layouts[targetType];
        expect(def, `no built-in layout for ${targetType}`).toBeDefined();
        const scoped = scope === 'repository' ? (def.repository ?? def.user) : def.user;

        const result = invertKindRoutes(scoped.kindRoutes);

        expect(result.unknownKeys).toEqual([]);
        expect(result.byKind.size).toBeGreaterThan(0);
      });
    }
  }

  it('covers every declared target type', () => {
    for (const targetType of TARGET_TYPES) {
      expect(Object.keys(defaultLayouts.layouts)).toContain(targetType);
    }
  });
});
