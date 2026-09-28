/**
 * Domain layer — the shared result vocabulary of the installation lifecycle (U1).
 *
 * Expected conditions are **values, not exceptions**: a delivery adapter maps
 * them to its own presentation. Only programmer defects throw. The unions are
 * kept separate on purpose, because each boundary has outcomes the others have
 * no vocabulary for:
 *
 *   - {@link LifecycleOutcome} — install, update, uninstall.
 *   - {@link MigrationTransferOutcome} — `transferThroughLifecycle`, which adds
 *     "already a verified duplicate" and "deliberately left alone".
 *   - {@link ArtifactVerificationResult} — evidence, never an operation result.
 *   - {@link CleanupJournalEntryResult} / {@link CleanupJournalCloseResult} —
 *     the journal boundary, which adds resuming, finding nothing, and refusing
 *     a mismatched legacy source root.
 *   - {@link RepositoryReconciliationResult} — where every ambiguous or offline
 *     case is a *skip with a reason* rather than an error.
 *
 * Pure domain: no IO, no framework imports.
 * @module domain/install/lifecycle-outcome
 */

/**
 * The minimum an outcome needs to name an artifact it acted on.
 *
 * Structurally satisfied by `ManagedArtifact`, so an outcome can carry real
 * records without this module depending on the registry model.
 */
export interface ArtifactReference {
  readonly destinationPath: string;
}

/**
 * Result kinds of one normal lifecycle operation.
 *
 * `preserved-content` is reserved for an operation that could **not** proceed
 * (BR4.8); a successful operation that preserved some artifacts returns
 * `success` carrying `preservedArtifacts` (BR4.4).
 */
export type LifecycleOutcomeKind =
  | 'success'
  | 'validation-error'
  | 'conflict'
  | 'preserved-content'
  | 'retryable-failure'
  | 'safety-blocked';

/**
 * The explicit result of one install, update, or uninstall.
 */
export interface LifecycleOutcome {
  readonly kind: LifecycleOutcomeKind;
  /** Artifacts retained because their bytes no longer matched their fingerprint. */
  readonly preservedArtifacts?: readonly ArtifactReference[];
  /** Destinations whose files were removed and verified absent. */
  readonly removedArtifacts?: readonly ArtifactReference[];
  /** Destinations deliberately left untouched because they are unmanaged. */
  readonly skippedArtifacts?: readonly ArtifactReference[];
  /** Artifacts written and verified by this operation. */
  readonly writtenArtifacts?: readonly ArtifactReference[];
  /** Identifies the affected bundle and artifact where applicable. */
  readonly detail?: string;
}

/**
 * Result kinds of one `transferThroughLifecycle` call.
 *
 * Legacy content is intact for every kind except `transferred`, where it
 * becomes eligible for journaled cleanup.
 */
export type MigrationTransferOutcomeKind =
  | 'transferred'
  | 'verified-duplicate'
  | 'preserved-conflict'
  | 'retry-required'
  | 'skipped'
  | 'safety-blocked';

/**
 * The result of one migration transfer at the U1-to-U4 boundary.
 */
export interface MigrationTransferOutcome {
  readonly kind: MigrationTransferOutcomeKind;
  /** Present on `transferred`: the artifacts now verified at the target. */
  readonly transferredArtifacts?: readonly ArtifactReference[];
  /**
   * Required on `preserved-conflict`, `retry-required`, `skipped`, and
   * `safety-blocked` so the caller can report which installation is affected.
   */
  readonly detail?: string;
}

/**
 * Per-artifact verdict from one verification pass.
 */
export type ArtifactVerdictKind =
  | 'present-identical'
  | 'present-different'
  | 'absent'
  | 'safety-blocked';

/**
 * One artifact's verdict, naming the destination it describes.
 */
export interface ArtifactVerdict {
  readonly destinationPath: string;
  readonly verdict: ArtifactVerdictKind;
}

/**
 * The result of one `verifyManagedArtifacts` call.
 *
 * Evidence, not an operation outcome: it authorises nothing by itself, and a
 * verdict is never carried across operations as standing authority (BR5.5).
 */
export interface ArtifactVerificationResult {
  /** True only when every requested artifact verified as `present-identical`. */
  readonly allVerified: boolean;
  readonly artifactVerdicts: readonly ArtifactVerdict[];
  readonly detail?: string;
}

/**
 * Result kinds of the three entry-returning cleanup-journal operations.
 *
 * No kind other than `created` or `resumed` grants any deletion authority, and
 * a `resumed` entry still re-verifies current bytes before a destructive action.
 */
export type CleanupJournalEntryResultKind =
  | 'created'
  | 'resumed'
  | 'absent'
  | 'source-root-mismatch'
  | 'validation-error'
  | 'retryable-failure'
  | 'safety-blocked';

/**
 * Result of `openCleanupJournalEntry`, `recordCleanupTransition`, and
 * `readCleanupJournalEntry`.
 *
 * `entry` is typed by the caller because the journal entry model lives in
 * `domain/install/cleanup-journal.ts`; this union stays independent of it.
 * @template TEntry - The journal entry shape carried on `created` / `resumed`.
 */
export interface CleanupJournalEntryResult<TEntry = unknown> {
  readonly kind: CleanupJournalEntryResultKind;
  /** Present on `created` and `resumed`: the live entry with its progress set. */
  readonly entry?: TEntry;
  /**
   * Required on `source-root-mismatch` (naming both roots),
   * `validation-error`, and `retryable-failure`.
   */
  readonly detail?: string;
}

/**
 * Result of `closeCleanupJournalEntry`, whether committed or abandoned.
 */
export interface CleanupJournalCloseResult {
  readonly kind: 'closed' | 'absent' | 'retryable-failure' | 'validation-error';
  readonly detail?: string;
}

/**
 * Why `reconcileRepositoryIdentity` left a record untouched.
 *
 * A skip is never an error: it is the expected outcome offline and whenever the
 * evidence is not unambiguous.
 */
export type RepositoryReconciliationSkipReason =
  | 'no-record'
  | 'no-candidates'
  | 'no-confirmation'
  | 'ambiguous-confirmation'
  | 'redirect-unavailable'
  | 'no-redirect-port';

/**
 * The result of `reconcileRepositoryIdentity`.
 *
 * Managed artifacts and their fingerprints are never altered by reconciliation;
 * only the record's key changes (BR6.5).
 * @template TIdentity - The repository identity shape carried on `rekeyed`.
 */
export interface RepositoryReconciliationResult<TIdentity = unknown> {
  readonly kind: 'rekeyed' | 'skipped' | 'validation-error' | 'retryable-failure';
  /** Present on `rekeyed`: the identity the record was keyed under before. */
  readonly previousIdentity?: TIdentity;
  /** Present on `rekeyed`: the confirmed identity the record now uses. */
  readonly newIdentity?: TIdentity;
  /** Required on `skipped` so the caller can tell offline from ambiguous. */
  readonly skipReason?: RepositoryReconciliationSkipReason;
  readonly detail?: string;
}

/**
 * Whether a lifecycle outcome completed every requested write and removal.
 * @param outcome - Outcome to classify.
 * @returns True only for `success`.
 */
export function isLifecycleSuccess(outcome: LifecycleOutcome): boolean {
  return outcome.kind === 'success';
}

/**
 * Map an inner {@link LifecycleOutcome} onto the migration boundary's union.
 *
 * `preserved-content` maps to `preserved-conflict`, because a transfer that
 * preservation left unachievable leaves both locations intact.
 * @param outcome - The inner lifecycle result.
 * @returns The migration-boundary outcome. Never returns a bare lifecycle kind.
 */
export function mapLifecycleOutcomeToTransfer(
  outcome: LifecycleOutcome
): MigrationTransferOutcome {
  const detail = outcome.detail === undefined ? {} : { detail: outcome.detail };
  switch (outcome.kind) {
    case 'success': {
      return {
        kind: 'transferred',
        ...(outcome.writtenArtifacts === undefined
          ? {}
          : { transferredArtifacts: outcome.writtenArtifacts }),
        ...detail
      };
    }
    case 'retryable-failure': {
      return { kind: 'retry-required', ...detail };
    }
    case 'conflict':
    case 'preserved-content': {
      return { kind: 'preserved-conflict', ...detail };
    }
    case 'safety-blocked': {
      return { kind: 'safety-blocked', ...detail };
    }
    case 'validation-error': {
      return { kind: 'skipped', ...detail };
    }
    default: {
      return assertNever(outcome.kind);
    }
  }
}

/**
 * Exhaustiveness guard for the lifecycle union.
 * @param value - The value the compiler proved unreachable.
 * @throws {TypeError} Always; reaching this is a programmer defect.
 */
function assertNever(value: never): never {
  throw new TypeError(`unhandled lifecycle outcome kind: ${String(value)}`);
}
