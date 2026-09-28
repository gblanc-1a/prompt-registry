/**
 * Tests for domain/install/lifecycle-outcome.ts — the shared result vocabulary
 * and the migration-boundary mapping (BR4.4, BR4.8, functional-spec mapping table).
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  LifecycleOutcome,
  LifecycleOutcomeKind,
} from '../../../src/domain/install/lifecycle-outcome';
import {
  isLifecycleSuccess,
  mapLifecycleOutcomeToTransfer,
} from '../../../src/domain/install/lifecycle-outcome';

describe('isLifecycleSuccess', () => {
  it('is true only for success', () => {
    expect(isLifecycleSuccess({ kind: 'success' })).toBe(true);
    expect(isLifecycleSuccess({ kind: 'preserved-content' })).toBe(false);
    expect(isLifecycleSuccess({ kind: 'conflict' })).toBe(false);
  });

  it('stays true for a success that preserved artifacts (BR4.4)', () => {
    const outcome: LifecycleOutcome = {
      kind: 'success',
      preservedArtifacts: [{ destinationPath: '/t/kept.md' }]
    };

    expect(isLifecycleSuccess(outcome)).toBe(true);
    expect(outcome.preservedArtifacts).toHaveLength(1);
  });
});

describe('mapLifecycleOutcomeToTransfer', () => {
  it('maps success to transferred and carries the written artifacts', () => {
    const result = mapLifecycleOutcomeToTransfer({
      kind: 'success',
      writtenArtifacts: [{ destinationPath: '/t/a.md' }, { destinationPath: '/t/b.md' }]
    });

    expect(result.kind).toBe('transferred');
    expect(result.transferredArtifacts).toHaveLength(2);
  });

  it('maps retryable-failure to retry-required', () => {
    expect(mapLifecycleOutcomeToTransfer({ kind: 'retryable-failure' }).kind)
      .toBe('retry-required');
  });

  it('maps both conflict and preserved-content to preserved-conflict', () => {
    expect(mapLifecycleOutcomeToTransfer({ kind: 'conflict' }).kind)
      .toBe('preserved-conflict');
    expect(mapLifecycleOutcomeToTransfer({ kind: 'preserved-content' }).kind)
      .toBe('preserved-conflict');
  });

  it('maps safety-blocked and validation-error to their boundary kinds', () => {
    expect(mapLifecycleOutcomeToTransfer({ kind: 'safety-blocked' }).kind)
      .toBe('safety-blocked');
    expect(mapLifecycleOutcomeToTransfer({ kind: 'validation-error' }).kind)
      .toBe('skipped');
  });

  it('carries the detail so the caller can report which installation is affected', () => {
    const result = mapLifecycleOutcomeToTransfer({
      kind: 'conflict',
      detail: 'acme-prompts: /t/a.md changed locally'
    });

    expect(result.detail).toBe('acme-prompts: /t/a.md changed locally');
  });

  it('never returns a bare lifecycle kind for any member of the union', () => {
    const kinds: LifecycleOutcomeKind[] = [
      'success',
      'validation-error',
      'conflict',
      'preserved-content',
      'retryable-failure',
      'safety-blocked'
    ];
    const transferKinds = new Set([
      'transferred',
      'verified-duplicate',
      'preserved-conflict',
      'retry-required',
      'skipped',
      'safety-blocked'
    ]);

    for (const kind of kinds) {
      expect(transferKinds.has(mapLifecycleOutcomeToTransfer({ kind }).kind)).toBe(true);
    }
  });

  it('throws on an unhandled kind, because that is a programmer defect', () => {
    expect(() => mapLifecycleOutcomeToTransfer({ kind: 'nonsense' as LifecycleOutcomeKind }))
      .toThrow(TypeError);
  });
});
