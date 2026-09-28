/**
 * Tests for registry/xdg-cleanup-journal.ts — the journal's transitions, its
 * evidence gate, exclusivity, and close rules
 * (BR5.2, BR5.5-BR5.11, BR4.6, NFR1.1.4, NFR1.1.6, NFR1.1.7).
 */
import {
  existsSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import type {
  AppStorage,
  CleanupArtifactProgress,
  CleanupJournalEntry,
  Clock,
  ExclusiveLockPort,
  VerificationResultToken,
} from '@ai-primitives-hub/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  digestName,
  lifecycleRoots,
} from '../../src/registry/user-scope-installation-registry';
import type {
  CleanupEvidenceChecker,
} from '../../src/registry/xdg-cleanup-journal';
import {
  XdgCleanupJournal,
} from '../../src/registry/xdg-cleanup-journal';
import {
  MkdirLock,
} from '../../src/storage/mkdir-lock';
import {
  createTempDir,
} from '../helpers/temp-dir';

const KEY = 'acme|copilot|user|';
const LEGACY_ROOT = '/legacy/root';

const storageFor = (root: string): AppStorage => ({
  getPaths: () => ({
    root,
    config: join(root, 'config.json'),
    cache: join(root, 'cache'),
    sourcesCache: join(root, 'cache', 'sources'),
    bundlesCache: join(root, 'cache', 'bundles'),
    installed: join(root, 'installed'),
    userInstalled: join(root, 'installed', 'user'),
    profilesInstalled: join(root, 'installed', 'profiles'),
    profiles: join(root, 'profiles'),
    logs: join(root, 'logs')
  }),
  getState: async <T>(_key: string, defaultValue: T) => defaultValue,
  setState: async () => undefined
});

const clock: Clock = {
  now: () => Date.parse('2026-09-28T10:00:00.000Z'),
  nowIso: () => '2026-09-28T10:00:00.000Z'
};

const progress = (overrides: Partial<CleanupArtifactProgress> = {}): CleanupArtifactProgress => ({
  legacyPath: `${LEGACY_ROOT}/prompts/a.md`,
  expectedTargetPath: '/home/u/.copilot/prompts/a.md',
  progressState: 'pending',
  ...overrides
});

const acceptingEvidence: CleanupEvidenceChecker = {
  isAuthentic: () => true,
  isStillCurrent: async () => true
};

const tokenFor = (entry: CleanupJournalEntry, overrides: Partial<VerificationResultToken> = {}): VerificationResultToken => ({
  installationKey: entry.installationKey,
  entryId: entry.entryId,
  generation: entry.generation,
  artifactSetDigest: `sha256:${'a'.repeat(64)}`,
  readVersion: '2026-09-28T10:00:00.000Z',
  issuedAt: '2026-09-28T10:00:00.000Z',
  signature: 'signature-1',
  ...overrides
});

describe('XdgCleanupJournal', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('cleanup-journal-');
  });

  afterEach(() => {
    cleanup();
  });

  const journalWith = (
    evidence: CleanupEvidenceChecker = acceptingEvidence,
    lock: ExclusiveLockPort = new MkdirLock({ lockRoot: join(dir, 'locks'), now: () => new Date(clock.now()) })
  ): XdgCleanupJournal => new XdgCleanupJournal({
    storage: storageFor(dir),
    lock,
    clock,
    evidence,
    newId: () => 'entry-1'
  });

  const open = async (journal: XdgCleanupJournal): Promise<CleanupJournalEntry> => {
    const opened = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: LEGACY_ROOT,
      progress: [progress()]
    });
    if (opened.entry === undefined) {
      throw new Error(`expected an entry, got ${opened.kind}`);
    }
    return opened.entry;
  };

  it('creates an entry in prepared and stores it in shared application data', async () => {
    const journal = journalWith();

    const opened = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: LEGACY_ROOT,
      progress: [progress()]
    });

    expect(opened.kind).toBe('created');
    expect(opened.entry?.state).toBe('prepared');
    expect(opened.entry?.generation).toBe(1);
    expect(existsSync(join(lifecycleRoots(storageFor(dir)).journal, `${digestName(KEY)}.json`)))
      .toBe(true);
  });

  it('resumes the live entry for the same key and legacy root', async () => {
    const journal = journalWith();
    await open(journal);

    const resumed = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: LEGACY_ROOT,
      progress: [progress()]
    });

    expect(resumed.kind).toBe('resumed');
    expect(resumed.entry?.entryId).toBe('entry-1');
  });

  it('refuses an open naming a different legacy source root, granting no authority (BR5.8)', async () => {
    const journal = journalWith();
    await open(journal);

    const mismatched = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: '/other/root',
      progress: [progress({ legacyPath: '/other/root/a.md' })]
    });

    expect(mismatched.kind).toBe('source-root-mismatch');
    expect(mismatched.entry).toBeUndefined();
  });

  it('refuses an open whose legacy path escapes its root (BR5.7)', async () => {
    const journal = journalWith();

    const escaping = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: LEGACY_ROOT,
      progress: [progress({ legacyPath: `${LEGACY_ROOT}/../elsewhere/a.md` })]
    });

    expect(escaping.kind).toBe('safety-blocked');
  });

  it('refuses a second holder rather than sharing the entry (BR5.9)', async () => {
    const lockRoot = join(dir, 'locks');
    const holder = new MkdirLock({ lockRoot, holder: 'first' });
    const journal = journalWith(acceptingEvidence, holder);
    await holder.tryAcquire(KEY);

    const contended = await journal.openCleanupJournalEntry({
      installationKey: KEY,
      legacySourceRoot: LEGACY_ROOT,
      progress: [progress()]
    });

    expect(contended.kind).toBe('retryable-failure');
  });

  it('advances prepared to target-verified with a bound token and bumps the generation', async () => {
    const journal = journalWith();
    const entry = await open(journal);

    const advanced = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });

    expect(advanced.kind).toBe('resumed');
    expect(advanced.entry?.state).toBe('target-verified');
    expect(advanced.entry?.generation).toBe(2);
  });

  it('refuses target-verified without a token, with a stale generation, or on replay (BR5.6)', async () => {
    const journal = journalWith();
    const entry = await open(journal);

    const noToken = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified'
    });
    const wrongGeneration = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry, { generation: 99 })
    });
    const token = tokenFor(entry);
    await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token
    });
    const replay = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: 2,
      toState: 'target-verified',
      token
    });

    expect(noToken.kind).toBe('validation-error');
    expect(wrongGeneration.kind).toBe('validation-error');
    expect(replay.kind).toBe('validation-error');
  });

  it('refuses target-verified when a fresh read no longer matches (NFR1.1.7)', async () => {
    const journal = journalWith({ isAuthentic: () => true, isStillCurrent: async () => false });
    const entry = await open(journal);

    const stale = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });

    expect(stale.kind).toBe('safety-blocked');
    expect((await journal.readCleanupJournalEntry(KEY)).entry?.state).toBe('prepared');
  });

  it('refuses a forged token signature', async () => {
    const journal = journalWith({ isAuthentic: () => false, isStillCurrent: async () => true });
    const entry = await open(journal);

    const forged = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });

    expect(forged.kind).toBe('validation-error');
  });

  it('refuses an illegal transition and leaves the entry unchanged', async () => {
    const journal = journalWith();
    const entry = await open(journal);

    const illegal = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'committed'
    });

    expect(illegal.kind).toBe('validation-error');
    expect((await journal.readCleanupJournalEntry(KEY)).entry?.state).toBe('prepared');
  });

  it('accepts repeated legacy-delete-pending transitions as per-artifact durability (BR5.10)', async () => {
    const journal = journalWith();
    const entry = await open(journal);
    const verified = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });
    const pending = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: verified.entry?.generation ?? 0,
      toState: 'legacy-delete-pending',
      progress: [progress({ progressState: 'verified-identical' })]
    });

    const again = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: pending.entry?.generation ?? 0,
      toState: 'legacy-delete-pending',
      progress: [progress({ progressState: 'deleted' })]
    });

    expect(again.kind).toBe('resumed');
    expect(again.entry?.progress[0]?.progressState).toBe('deleted');
    expect(again.entry?.generation).toBe(4);
  });

  it('refuses committed while a managed legacy artifact remains (BR4.6)', async () => {
    const journal = journalWith();
    const entry = await open(journal);
    const verified = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });
    const pending = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: verified.entry?.generation ?? 0,
      toState: 'legacy-delete-pending',
      progress: [progress({ progressState: 'verified-identical' })]
    });

    const premature = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: pending.entry?.generation ?? 0,
      toState: 'committed'
    });

    expect(premature.kind).toBe('validation-error');
  });

  it('reports absent for a key with no live entry, and grants no authority on read', async () => {
    const journal = journalWith();

    expect((await journal.readCleanupJournalEntry('unknown')).kind).toBe('absent');
  });

  it('permits abandoning before deletion and refuses it once deletion is in flight (BR5.11)', async () => {
    const journal = journalWith();
    const entry = await open(journal);

    const abandonedEarly = await journal.closeCleanupJournalEntry({
      installationKey: KEY,
      entryId: entry.entryId,
      disposition: 'abandoned'
    });

    expect(abandonedEarly.kind).toBe('closed');
    expect((await journal.readCleanupJournalEntry(KEY)).kind).toBe('absent');

    const reopened = await open(journal);
    const verified = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: reopened.entryId,
      expectedGeneration: reopened.generation,
      toState: 'target-verified',
      token: tokenFor(reopened, { signature: 'signature-2' })
    });
    await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: reopened.entryId,
      expectedGeneration: verified.entry?.generation ?? 0,
      toState: 'legacy-delete-pending',
      progress: [progress({ progressState: 'verified-identical' })]
    });

    const abandonedLate = await journal.closeCleanupJournalEntry({
      installationKey: KEY,
      entryId: reopened.entryId,
      disposition: 'abandoned'
    });

    expect(abandonedLate.kind).toBe('validation-error');
    expect((await journal.readCleanupJournalEntry(KEY)).entry?.state).toBe('legacy-delete-pending');
  });

  it('deletes a committed entry as the final step of its operation (BR5.4)', async () => {
    const journal = journalWith();
    const entry = await open(journal);
    const verified = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });
    const pending = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: verified.entry?.generation ?? 0,
      toState: 'legacy-delete-pending',
      progress: [progress({ progressState: 'deleted' })]
    });
    const committed = await journal.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: pending.entry?.generation ?? 0,
      toState: 'committed',
      progress: [progress({ progressState: 'deleted' })]
    });

    const closed = await journal.closeCleanupJournalEntry({
      installationKey: KEY,
      entryId: entry.entryId,
      disposition: 'committed'
    });

    expect(committed.entry?.state).toBe('committed');
    expect(closed.kind).toBe('closed');
    expect((await journal.readCleanupJournalEntry(KEY)).kind).toBe('absent');
  });

  it('survives a restart at each state, because every transition was persisted first (BR5.2)', async () => {
    const first = journalWith();
    const entry = await open(first);
    await first.recordCleanupTransition({
      installationKey: KEY,
      entryId: entry.entryId,
      expectedGeneration: entry.generation,
      toState: 'target-verified',
      token: tokenFor(entry)
    });

    // A fresh instance models a restarted process: nothing is held in memory.
    const restarted = journalWith();
    const resumed = await restarted.readCleanupJournalEntry(KEY);

    expect(resumed.kind).toBe('resumed');
    expect(resumed.entry?.state).toBe('target-verified');
    expect(resumed.entry?.generation).toBe(2);
  });
});
