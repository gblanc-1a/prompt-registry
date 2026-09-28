/**
 * MigrationCleanupJournalPort — the four operations U4 drives and U1 makes
 * durable (Contract 3).
 *
 * U1 owns the data model, the transitions, and the persistence boundary; U4 owns
 * the migration transaction that drives them. That split is what keeps the
 * journal a *safety-progress contract* rather than a second lifecycle: U4 can
 * never invent a transition, and U1 never decides migration policy.
 *
 * Reading grants no authority. Only `created` and `resumed` hand back an entry at
 * all, and even a `resumed` entry must re-verify current bytes before a
 * destructive action (BR5.5).
 *
 * Concrete adapters live in `infra`.
 * @module ports/migration-cleanup-journal
 */
import type {
  CleanupArtifactProgress,
  CleanupJournalEntry,
  CleanupJournalState,
  VerificationResultToken,
} from '../domain/install/cleanup-journal';
import type {
  CleanupJournalCloseResult,
  CleanupJournalEntryResult,
} from '../domain/install/lifecycle-outcome';

/**
 * Open or resume the single entry for one installation key.
 */
export interface OpenCleanupJournalEntryRequest {
  readonly installationKey: string;
  /** The verified root every legacy path must resolve inside (BR5.7). */
  readonly legacySourceRoot: string;
  readonly progress: readonly CleanupArtifactProgress[];
}

/**
 * Advance an entry, persisting before the action the new state authorises.
 */
export interface RecordCleanupTransitionRequest {
  readonly installationKey: string;
  readonly entryId: string;
  /** The generation the caller believes is live; a mismatch is refused. */
  readonly expectedGeneration: number;
  readonly toState: CleanupJournalState;
  /** The updated progress set, when this transition carries progress. */
  readonly progress?: readonly CleanupArtifactProgress[];
  /** Required for `prepared -> target-verified` (BR5.6). */
  readonly token?: VerificationResultToken;
}

/**
 * Close an entry: `committed` as the final step, or `abandoned` before deletion.
 */
export interface CloseCleanupJournalEntryRequest {
  readonly installationKey: string;
  readonly entryId: string;
  readonly disposition: 'committed' | 'abandoned';
}

/**
 * The journal's four declared operations.
 */
export interface MigrationCleanupJournalPort {
  /**
   * Open a new entry, or resume the live one for this key.
   * @param request Installation key, verified legacy root, progress set.
   * @returns `created`, `resumed`, `source-root-mismatch`, or a refusal.
   */
  openCleanupJournalEntry(
    request: OpenCleanupJournalEntryRequest
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>>;

  /**
   * Advance the entry, persisting the new state before its action.
   * @param request Entry identity, expected generation, target state, evidence.
   * @returns The advanced entry, or a refusal that changed nothing.
   */
  recordCleanupTransition(
    request: RecordCleanupTransitionRequest
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>>;

  /**
   * Read the live entry for resumption. Grants no deletion authority.
   * @param installationKey Installation key.
   * @returns The entry, or `absent` when none is live.
   */
  readCleanupJournalEntry(
    installationKey: string
  ): Promise<CleanupJournalEntryResult<CleanupJournalEntry>>;

  /**
   * Delete a `committed` entry as the final step of its operation, or release an
   * abandoned one.
   * @param request Entry identity and disposition.
   * @returns `closed`, `absent`, or a refusal.
   */
  closeCleanupJournalEntry(
    request: CloseCleanupJournalEntryRequest
  ): Promise<CleanupJournalCloseResult>;
}
