/**
 * Tests for domain/install/cleanup-journal.ts — transition legality, abandon
 * rules, legacy containment, completion, and token binding
 * (BR4.6, BR5.5-BR5.11, NFR1.1.6).
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  CleanupArtifactProgress,
  CleanupJournalEntry,
  CleanupJournalState,
  VerificationResultToken,
} from '../../../src/domain/install/cleanup-journal';
import {
  canAbandon,
  canonicalArtifactSetPayload,
  canonicalTokenPayload,
  firstEscapingLegacyPath,
  isCleanupComplete,
  isDeletionEligible,
  isLegalJournalTransition,
  tokenMatchesEntry,
} from '../../../src/domain/install/cleanup-journal';

const STATES: CleanupJournalState[] = [
  'prepared',
  'target-verified',
  'legacy-delete-pending',
  'committed'
];

const progress = (overrides: Partial<CleanupArtifactProgress> = {}): CleanupArtifactProgress => ({
  legacyPath: '/legacy/root/prompts/a.md',
  expectedTargetPath: '/home/u/.copilot/prompts/a.md',
  progressState: 'pending',
  ...overrides
});

const entry = (overrides: Partial<CleanupJournalEntry> = {}): CleanupJournalEntry => ({
  entryId: 'entry-1',
  generation: 3,
  installationKey: 'acme|copilot|user|',
  state: 'prepared',
  legacySourceRoot: '/legacy/root',
  updatedAt: '2026-09-28T00:00:00.000Z',
  progress: [progress()],
  ...overrides
});

describe('isLegalJournalTransition', () => {
  it('permits exactly the forward path through the states', () => {
    expect(isLegalJournalTransition('prepared', 'target-verified')).toBe(true);
    expect(isLegalJournalTransition('target-verified', 'legacy-delete-pending')).toBe(true);
    expect(isLegalJournalTransition('legacy-delete-pending', 'committed')).toBe(true);
  });

  it('permits a repeated legacy-delete-pending transition as per-artifact durability (BR5.10)', () => {
    expect(isLegalJournalTransition('legacy-delete-pending', 'legacy-delete-pending')).toBe(true);
  });

  it('refuses skipping target verification', () => {
    expect(isLegalJournalTransition('prepared', 'legacy-delete-pending')).toBe(false);
    expect(isLegalJournalTransition('prepared', 'committed')).toBe(false);
    expect(isLegalJournalTransition('target-verified', 'committed')).toBe(false);
  });

  it('refuses every backward transition and every move out of committed', () => {
    const backward: [CleanupJournalState, CleanupJournalState][] = [
      ['target-verified', 'prepared'],
      ['legacy-delete-pending', 'target-verified'],
      ['committed', 'legacy-delete-pending']
    ];

    for (const [from, to] of backward) {
      expect(isLegalJournalTransition(from, to)).toBe(false);
    }
    for (const state of STATES) {
      expect(isLegalJournalTransition('committed', state)).toBe(false);
    }
  });
});

describe('canAbandon (BR5.11)', () => {
  it('permits abandoning only before deletion has begun', () => {
    expect(canAbandon('prepared')).toBe(true);
    expect(canAbandon('target-verified')).toBe(true);
    expect(canAbandon('legacy-delete-pending')).toBe(false);
    expect(canAbandon('committed')).toBe(false);
  });
});

describe('firstEscapingLegacyPath (BR5.7)', () => {
  it('accepts paths inside the verified legacy root', () => {
    expect(firstEscapingLegacyPath('/legacy/root', [progress()])).toBeNull();
  });

  it('names the first path that escapes the root', () => {
    const escaping = firstEscapingLegacyPath('/legacy/root', [
      progress(),
      progress({ legacyPath: '/legacy/root/../elsewhere/a.md' })
    ]);

    expect(escaping).toBe('/legacy/root/../elsewhere/a.md');
  });

  it('rejects a sibling root that merely shares a prefix', () => {
    expect(firstEscapingLegacyPath('/legacy/root', [progress({ legacyPath: '/legacy/root-evil/a.md' })]))
      .toBe('/legacy/root-evil/a.md');
  });
});

describe('cleanup completion and deletion eligibility', () => {
  it('is complete only when nothing managed remains (BR4.6)', () => {
    expect(isCleanupComplete([progress({ progressState: 'deleted' })])).toBe(true);
    expect(isCleanupComplete([
      progress({ progressState: 'deleted' }),
      progress({ progressState: 'preserved' })
    ])).toBe(true);
    expect(isCleanupComplete([progress({ progressState: 'pending' })])).toBe(false);
    expect(isCleanupComplete([progress({ progressState: 'verified-identical' })])).toBe(false);
  });

  it('allows a delete attempt only from verified-identical', () => {
    expect(isDeletionEligible(progress({ progressState: 'verified-identical' }))).toBe(true);
    expect(isDeletionEligible(progress({ progressState: 'pending' }))).toBe(false);
    expect(isDeletionEligible(progress({ progressState: 'preserved' }))).toBe(false);
    expect(isDeletionEligible(progress({ progressState: 'deleted' }))).toBe(false);
  });
});

describe('verification token binding', () => {
  const token = (overrides: Partial<VerificationResultToken> = {}): VerificationResultToken => ({
    installationKey: 'acme|copilot|user|',
    entryId: 'entry-1',
    generation: 3,
    artifactSetDigest: `sha256:${'a'.repeat(64)}`,
    readVersion: '2026-09-28T00:00:00.000Z',
    issuedAt: '2026-09-28T00:00:00.000Z',
    signature: 'deadbeef',
    ...overrides
  });

  it('matches only the exact entry at its live generation', () => {
    expect(tokenMatchesEntry(token(), entry())).toBe(true);
    expect(tokenMatchesEntry(token({ generation: 2 }), entry())).toBe(false);
    expect(tokenMatchesEntry(token({ entryId: 'other' }), entry())).toBe(false);
    expect(tokenMatchesEntry(token({ installationKey: 'other' }), entry())).toBe(false);
  });

  it('serialises token fields so no value can forge a boundary', () => {
    const left = canonicalTokenPayload({
      installationKey: 'a',
      entryId: 'b',
      generation: 1,
      artifactSetDigest: 'c',
      readVersion: 'd',
      issuedAt: 'e'
    });
    const right = canonicalTokenPayload({
      installationKey: 'a',
      entryId: 'b',
      generation: 1,
      artifactSetDigest: 'c',
      readVersion: 'd',
      issuedAt: 'f'
    });

    expect(left).not.toBe(right);
  });

  it('digests an artifact set independently of its order', () => {
    const forward = canonicalArtifactSetPayload([
      { destinationPath: '/t/a.md', expectedFingerprint: 'f1' },
      { destinationPath: '/t/b.md', expectedFingerprint: 'f2' }
    ]);
    const reversed = canonicalArtifactSetPayload([
      { destinationPath: '/t/b.md', expectedFingerprint: 'f2' },
      { destinationPath: '/t/a.md', expectedFingerprint: 'f1' }
    ]);

    expect(forward).toBe(reversed);
  });

  it('digests a subset, a superset, and an altered fingerprint differently', () => {
    const full = canonicalArtifactSetPayload([
      { destinationPath: '/t/a.md', expectedFingerprint: 'f1' },
      { destinationPath: '/t/b.md', expectedFingerprint: 'f2' }
    ]);
    const subset = canonicalArtifactSetPayload([
      { destinationPath: '/t/a.md', expectedFingerprint: 'f1' }
    ]);
    const altered = canonicalArtifactSetPayload([
      { destinationPath: '/t/a.md', expectedFingerprint: 'f1' },
      { destinationPath: '/t/b.md', expectedFingerprint: 'CHANGED' }
    ]);

    expect(new Set([full, subset, altered]).size).toBe(3);
  });
});
