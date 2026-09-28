/**
 * XdgCleanupJournal — the `MigrationCleanupJournalPort` implementation.
 *
 * Entries live in shared application data for both scopes (NFR1.1.4), each write
 * is a durable replacement (NFR1.1.2), and every operation takes the
 * installation-key lock so two extension hosts can never both believe they hold
 * deletion authority (BR5.9).
 *
 * The transition rules are the design's, enforced here because U1 owns them:
 *
 *   - a state change is persisted **before** the action it authorises (BR5.2);
 *   - `prepared -> target-verified` needs a token bound to the live entry and
 *     generation, and that token is single-use (BR5.6);
 *   - a repeated `legacy-delete-pending` transition is legal and is how
 *     per-artifact progress becomes durable (BR5.10);
 *   - `committed` requires that nothing managed remains (BR4.6);
 *   - `abandoned` is permitted only before deletion began (BR5.11);
 *   - an open request naming a different legacy source root gets
 *     `source-root-mismatch` and no authority at all (BR5.8);
 *   - every legacy path must stay inside the entry's verified root (BR5.7).
 * @module registry/xdg-cleanup-journal
 */
import {
  randomUUID,
} from 'node:crypto';
import {
  readFile,
  rm,
} from 'node:fs/promises';
import {
  join,
} from 'node:path';
import type {
  AppStorage,
  CleanupJournalCloseResult,
  CleanupJournalEntry,
  CleanupJournalEntryResult,
  Clock,
  CloseCleanupJournalEntryRequest,
  ExclusiveLockPort,
  MigrationCleanupJournalPort,
  OpenCleanupJournalEntryRequest,
  RecordCleanupTransitionRequest,
  VerificationResultToken,
} from '@ai-primitives-hub/core';
import {
  canAbandon,
  firstEscapingLegacyPath,
  isCleanupComplete,
  isLegalJournalTransition,
  tokenMatchesEntry,
} from '@ai-primitives-hub/core';
import {
  replaceJsonDurably,
} from '../storage/durable-file';
import {
  digestName,
  lifecycleRoots,
} from './user-scope-installation-registry';

/**
 * How the journal confirms that a token is authentic and still current.
 *
 * Authenticity is the verifier's (it owns the ephemeral key); currency is a fresh
 * read of every expected artifact. The journal refuses the transition unless both
 * answer yes, which is what keeps stale, forged, and replayed evidence out.
 */
export interface CleanupEvidenceChecker {
  /** Whether the token was minted by this process and is unaltered. */
  isAuthentic(token: VerificationResultToken): boolean;
  /**
   * Whether a fresh read still finds every expected artifact present and
   * byte-identical for this entry.
   */
  isStillCurrent(token: VerificationResultToken, entry: CleanupJournalEntry): Promise<boolean>;
}

/**
 * Options accepted by {@link XdgCleanupJournal}.
 */
export interface XdgCleanupJournalOptions {
  readonly storage: AppStorage;
  readonly lock: ExclusiveLockPort;
  readonly clock: Clock;
  readonly evidence: CleanupEvidenceChecker;
  readonly newId?: () => string;
}

/**
 * Durable, locked, transition-checked cleanup journal.
 */
export class XdgCleanupJournal implements MigrationCleanupJournalPort {
  private readonly root: string;
  /** Tokens already spent on a transition; a replay is refused (BR5.6). */
  private readonly redeemed = new Set<string>();

  /**
   * Create an XdgCleanupJournal.
   * @param opts Storage, lock, clock, evidence checker, id source.
   */
  public constructor(private readonly opts: XdgCleanupJournalOptions) {
    this.root = lifecycleRoots(opts.storage).journal;
  }

  /**
   * Absolute path of one entry file.
   * @param installationKey - Installation key.
   * @returns The entry path.
   */
  private entryPath(installationKey: string): string {
    return join(this.root, `${digestName(installationKey)}.json`);
  }

  /**
   * Read the live entry for a key, if any.
   * @param installationKey - Installation key.
   * @returns The entry, or `null`.
   */
  private async readEntry(installationKey: string): Promise<CleanupJournalEntry | null> {
    try {
      return JSON.parse(await readFile(this.entryPath(installationKey), 'utf8')) as CleanupJournalEntry;
    } catch {
      return null;
    }
  }

  /**
   * Refuse first-pass deletion authority unless the evidence is complete, bound,
   * unspent, authentic, and still current (BR5.6).
   * @param token - The supplied token, if any.
   * @param entry - The live entry.
   * @returns A refusing result, or `null` when the evidence holds.
   */
  private async refuseEvidence(
    token: VerificationResultToken | undefined,
    entry: CleanupJournalEntry
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry> | null> {
    if (token === undefined) {
      return {
        kind: 'validation-error',
        detail: 'target-verified requires a verification token'
      };
    }
    if (!tokenMatchesEntry(token, entry)) {
      return {
        kind: 'validation-error',
        detail: 'the token does not name this entry at its live generation'
      };
    }
    if (this.redeemed.has(token.signature)) {
      return { kind: 'validation-error', detail: 'this token has already authorized a transition' };
    }
    if (!this.opts.evidence.isAuthentic(token)) {
      return { kind: 'validation-error', detail: 'the token signature is not valid' };
    }
    if (!(await this.opts.evidence.isStillCurrent(token, entry))) {
      return {
        kind: 'safety-blocked',
        detail: 'a fresh read no longer matches every expected target artifact'
      };
    }
    return null;
  }

  public async openCleanupJournalEntry(
    request: OpenCleanupJournalEntryRequest
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>> {
    const escaping = firstEscapingLegacyPath(request.legacySourceRoot, request.progress);
    if (escaping !== null) {
      return {
        kind: 'safety-blocked',
        detail: `legacy path "${escaping}" is outside "${request.legacySourceRoot}"`
      };
    }
    const lock = await this.opts.lock.tryAcquire(request.installationKey);
    if (lock === null) {
      return {
        kind: 'retryable-failure',
        detail: `another holder has the cleanup journal for "${request.installationKey}"`
      };
    }
    try {
      const live = await this.readEntry(request.installationKey);
      if (live !== null) {
        if (live.legacySourceRoot !== request.legacySourceRoot) {
          return {
            kind: 'source-root-mismatch',
            detail: `live entry names "${live.legacySourceRoot}", request names `
              + `"${request.legacySourceRoot}"`
          };
        }
        return { kind: 'resumed', entry: live };
      }
      const entry: CleanupJournalEntry = {
        entryId: (this.opts.newId ?? randomUUID)(),
        generation: 1,
        installationKey: request.installationKey,
        state: 'prepared',
        legacySourceRoot: request.legacySourceRoot,
        updatedAt: this.opts.clock.nowIso(),
        progress: request.progress
      };
      await replaceJsonDurably(this.entryPath(request.installationKey), entry);
      return { kind: 'created', entry };
    } catch (error) {
      return { kind: 'retryable-failure', detail: (error as Error).message };
    } finally {
      await lock.release();
    }
  }

  public async recordCleanupTransition(
    request: RecordCleanupTransitionRequest
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>> {
    const lock = await this.opts.lock.tryAcquire(request.installationKey);
    if (lock === null) {
      return {
        kind: 'retryable-failure',
        detail: `another holder has the cleanup journal for "${request.installationKey}"`
      };
    }
    try {
      const live = await this.readEntry(request.installationKey);
      if (live === null) {
        return { kind: 'absent', detail: `no live entry for "${request.installationKey}"` };
      }
      if (live.entryId !== request.entryId || live.generation !== request.expectedGeneration) {
        return {
          kind: 'validation-error',
          detail: `entry ${live.entryId} is at generation ${live.generation}; `
            + `request names ${request.entryId} at ${request.expectedGeneration}`
        };
      }
      if (!isLegalJournalTransition(live.state, request.toState)) {
        return {
          kind: 'validation-error',
          detail: `"${live.state}" may not advance to "${request.toState}"`
        };
      }

      const progress = request.progress ?? live.progress;
      const escaping = firstEscapingLegacyPath(live.legacySourceRoot, progress);
      if (escaping !== null) {
        return {
          kind: 'safety-blocked',
          detail: `legacy path "${escaping}" is outside "${live.legacySourceRoot}"`
        };
      }

      if (request.toState === 'target-verified') {
        const refusal = await this.refuseEvidence(request.token, live);
        if (refusal !== null) {
          return refusal;
        }
      }
      if (request.toState === 'committed' && !isCleanupComplete(progress)) {
        return {
          kind: 'validation-error',
          detail: 'a managed legacy artifact still remains, so the entry may not commit'
        };
      }

      const advanced: CleanupJournalEntry = {
        ...live,
        state: request.toState,
        generation: live.generation + 1,
        updatedAt: this.opts.clock.nowIso(),
        progress
      };
      await replaceJsonDurably(this.entryPath(request.installationKey), advanced);
      if (request.token !== undefined) {
        this.redeemed.add(request.token.signature);
      }
      return { kind: 'resumed', entry: advanced };
    } catch (error) {
      return { kind: 'retryable-failure', detail: (error as Error).message };
    } finally {
      await lock.release();
    }
  }

  public async readCleanupJournalEntry(
    installationKey: string
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>> {
    const live = await this.readEntry(installationKey);
    if (live === null) {
      return { kind: 'absent' };
    }
    // Reading grants no authority: a resumed entry still re-verifies before any
    // destructive action (BR5.5).
    return { kind: 'resumed', entry: live };
  }

  public async closeCleanupJournalEntry(
    request: CloseCleanupJournalEntryRequest
  ): Promise<CleanupJournalCloseResult> {
    const lock = await this.opts.lock.tryAcquire(request.installationKey);
    if (lock === null) {
      return {
        kind: 'retryable-failure',
        detail: `another holder has the cleanup journal for "${request.installationKey}"`
      };
    }
    try {
      const live = await this.readEntry(request.installationKey);
      if (live === null) {
        return { kind: 'absent' };
      }
      if (live.entryId !== request.entryId) {
        return { kind: 'validation-error', detail: `entry "${request.entryId}" is not the live entry` };
      }
      if (request.disposition === 'abandoned' && !canAbandon(live.state)) {
        return {
          kind: 'validation-error',
          detail: `an entry in "${live.state}" may not be abandoned; deletion is already in flight`
        };
      }
      if (request.disposition === 'committed' && live.state !== 'committed') {
        return {
          kind: 'validation-error',
          detail: `entry is in "${live.state}", not "committed"`
        };
      }
      await rm(this.entryPath(request.installationKey), { force: true });
      return { kind: 'closed' };
    } catch (error) {
      return { kind: 'retryable-failure', detail: (error as Error).message };
    } finally {
      await lock.release();
    }
  }
}
