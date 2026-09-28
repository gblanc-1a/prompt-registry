/**
 * ExclusiveLockPort — single-holder mutual exclusion for one key.
 *
 * Two safety rules need it: journal access is exclusive per installation key
 * (BR5.9), and a destination hand-off spans two persistence stores and must be
 * serialised under one lock (NFR1.1.3, NFR1.1.5). A second holder is refused —
 * it never shares the lock and never waits indefinitely — so the caller returns
 * `retryable-failure` instead of both believing they hold authority.
 *
 * Concrete adapters live in `infra` (a `mkdir`-based lock directory carrying
 * holder and acquisition-time metadata).
 * @module ports/exclusive-lock
 */

/**
 * A held lock. Releasing is idempotent.
 */
export interface LockHandle {
  readonly key: string;
  /** Who holds it, for diagnostics only — never for authority. */
  readonly holder: string;
  /** When it was acquired, ISO-8601. Diagnostic, never a takeover trigger. */
  readonly acquiredAt: string;
  release(): Promise<void>;
}

/**
 * Acquires exclusive access to a key.
 */
export interface ExclusiveLockPort {
  /**
   * Try to acquire the lock without waiting.
   * @param key Lock key, typically an installation key.
   * @returns The handle, or `null` when another holder has it.
   */
  tryAcquire(key: string): Promise<LockHandle | null>;
}
