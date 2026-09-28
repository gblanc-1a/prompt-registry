/**
 * Domain layer — the migration cleanup journal (U1 owns it, U4 drives it).
 *
 * The journal is deliberately **not** shaped like the registry. The registry
 * describes steady state and outlives every operation; the journal describes one
 * destructive operation *in flight* and is deleted when it commits (BR5.1,
 * BR5.4). It references registry-owned identity and fingerprints rather than
 * copying inventories, so there is one source of truth for what is managed
 * (BR5.3).
 *
 * Two rules decide everything else:
 *
 *   - **Durable before the action.** A state change is persisted before the
 *     filesystem action it authorises (BR5.2), which is why a repeated transition
 *     into `legacy-delete-pending` is legal and expected: that is how per-artifact
 *     deletion progress becomes durable (BR5.10).
 *   - **Evidence is never inherited.** A persisted `verified-identical` progress
 *     record authorises nothing on its own; a resumed entry re-verifies current
 *     bytes immediately before each delete (BR5.5), and the first-pass transition
 *     needs a token bound to the live entry generation (BR5.6).
 *
 * Pure domain: no IO, no framework imports.
 * @module domain/install/cleanup-journal
 */
import {
  isContainedPath,
} from './address';

/**
 * The states one destructive cleanup passes through.
 */
export type CleanupJournalState =
  | 'prepared'
  | 'target-verified'
  | 'legacy-delete-pending'
  | 'committed';

/**
 * Per-artifact progress inside one entry.
 *
 * There is no post-deletion state: BR4.6 requires absence to be verified before
 * `deleted` is recorded at all, so a recorded `deleted` already means "removed
 * and verified absent".
 */
export type CleanupArtifactState = 'pending' | 'verified-identical' | 'deleted' | 'preserved';

/**
 * One legacy artifact's progress within a cleanup operation.
 */
export interface CleanupArtifactProgress {
  readonly legacyPath: string;
  readonly expectedTargetPath: string;
  /**
   * Optional: the journal references the fingerprint the managed artifact holds
   * rather than copying it (BR5.3). When absent, the expected value is read from
   * the registry at verification time.
   */
  readonly expectedFingerprint?: string;
  readonly progressState: CleanupArtifactState;
}

/**
 * Restart-safety record for one in-flight destructive cleanup.
 */
export interface CleanupJournalEntry {
  /** Minted once at creation; never reused for a later operation. */
  readonly entryId: string;
  /** Starts at 1; incremented on every authoritative change (BR5.6). */
  readonly generation: number;
  /** At most one live entry per installation key. */
  readonly installationKey: string;
  readonly state: CleanupJournalState;
  /** The verified root every legacy path must resolve inside (BR5.7). */
  readonly legacySourceRoot: string;
  readonly updatedAt: string;
  readonly progress: readonly CleanupArtifactProgress[];
}

/** The forward transitions the journal permits. */
const LEGAL_TRANSITIONS: Readonly<Record<CleanupJournalState, readonly CleanupJournalState[]>> = {
  prepared: ['target-verified'],
  'target-verified': ['legacy-delete-pending'],
  // Same-state is the per-artifact durability mechanism, not an error (BR5.10).
  'legacy-delete-pending': ['legacy-delete-pending', 'committed'],
  committed: []
};

/**
 * Whether a journal state change is legal.
 * @param from - Current state.
 * @param to - Requested state.
 * @returns True only for a permitted forward transition.
 */
export function isLegalJournalTransition(
  from: CleanupJournalState,
  to: CleanupJournalState
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Whether an entry may be abandoned (BR5.11).
 *
 * Only before deletion has begun. From `legacy-delete-pending` the operation must
 * reach `committed` through post-deletion absence verification, because deletion
 * is already in flight and abandoning would discard the record of it.
 * @param state - Current state.
 * @returns True when abandoning is permitted.
 */
export function canAbandon(state: CleanupJournalState): boolean {
  return state === 'prepared' || state === 'target-verified';
}

/**
 * Whether every legacy path in a progress set stays inside the entry's verified
 * legacy source root (BR5.7).
 * @param legacySourceRoot - The entry's verified legacy root.
 * @param progress - The per-artifact progress set.
 * @returns The first escaping legacy path, or `null` when all are contained.
 */
export function firstEscapingLegacyPath(
  legacySourceRoot: string,
  progress: readonly CleanupArtifactProgress[]
): string | null {
  for (const entry of progress) {
    if (!isContainedPath(legacySourceRoot, entry.legacyPath)) {
      return entry.legacyPath;
    }
  }
  return null;
}

/**
 * Whether the entry may advance to `committed`.
 *
 * Only once no managed legacy artifact remains: every progress record is either
 * `deleted` (removed and verified absent) or `preserved` (intentionally retained
 * and never to be retried as a deletion) — BR4.6.
 * @param progress - The per-artifact progress set.
 * @returns True when nothing is left to delete.
 */
export function isCleanupComplete(progress: readonly CleanupArtifactProgress[]): boolean {
  return progress.every(
    (entry) => entry.progressState === 'deleted' || entry.progressState === 'preserved'
  );
}

/**
 * Whether deletion may be attempted for one artifact.
 *
 * Only from `verified-identical`, and even then the caller must re-verify current
 * bytes immediately before the filesystem action (BR5.5).
 * @param progress - One artifact's progress record.
 * @returns True when this artifact is eligible for a delete attempt.
 */
export function isDeletionEligible(progress: CleanupArtifactProgress): boolean {
  return progress.progressState === 'verified-identical';
}

/**
 * The evidence a first-pass `prepared -> target-verified` transition requires.
 *
 * Minted by `verifyManagedArtifacts` only when the **complete** expected set is
 * present and byte-identical, and bound to one live entry generation so it cannot
 * be replayed after the entry changes (BR5.6, NFR1.1.6, NFR1.1.7).
 */
export interface VerificationResultToken {
  readonly installationKey: string;
  readonly entryId: string;
  readonly generation: number;
  /** Digest over the complete expected artifact/fingerprint set. */
  readonly artifactSetDigest: string;
  /** Monotonic marker of the read that produced this token. */
  readonly readVersion: string;
  readonly issuedAt: string;
  /** HMAC over the canonical serialisation of every field above. */
  readonly signature: string;
}

/**
 * The canonical string a verification token's signature covers.
 *
 * Deterministic and separator-escaped, so no field value can forge another
 * field's boundary and two different token bodies can never share a signature
 * input.
 * @param token - The token fields, without the signature.
 * @returns The canonical serialisation to sign or verify.
 */
export function canonicalTokenPayload(token: Omit<VerificationResultToken, 'signature'>): string {
  return [
    token.installationKey,
    token.entryId,
    String(token.generation),
    token.artifactSetDigest,
    token.readVersion,
    token.issuedAt
  ]
    .map((field) => field.replaceAll('\\', '\\\\').replaceAll('\u0000', '\\0'))
    .join('\u0000');
}

/**
 * Whether a token is structurally bound to one live entry.
 *
 * Structure only: authenticity (the signature) and currency (a fresh read) are
 * checked by the journal, which owns the key and the filesystem.
 * @param token - The supplied token.
 * @param entry - The live journal entry.
 * @returns True when the token names this entry at its current generation.
 */
export function tokenMatchesEntry(
  token: VerificationResultToken,
  entry: CleanupJournalEntry
): boolean {
  return token.installationKey === entry.installationKey
    && token.entryId === entry.entryId
    && token.generation === entry.generation;
}

/**
 * The canonical digest input for an expected artifact set.
 *
 * Sorted by destination path so an identical set always produces one value, and a
 * subset, superset, or altered fingerprint always produces a different one.
 * @param expected - Destination paths with their expected fingerprints.
 * @returns The canonical string to digest.
 */
export function canonicalArtifactSetPayload(
  expected: readonly { readonly destinationPath: string; readonly expectedFingerprint: string }[]
): string {
  return expected
    .map((entry) => `${entry.destinationPath}\u0000${entry.expectedFingerprint}`)
    .toSorted()
    .join('\u0001');
}
