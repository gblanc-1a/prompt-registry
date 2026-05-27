/**
 * Clock port — time abstraction for deterministic testing.
 *
 * Commands use `ctx.clock.now()` instead of `Date.now()` so tests
 * can inject a fixed or controllable clock. The production adapter
 * simply wraps `Date.now()`.
 * @module ports/clock
 */

/**
 * Minimal clock surface: epoch milliseconds.
 */
export interface Clock {
  now(): number;
}

/**
 * Test-clock extension — the manual `advance()` lever used by golden
 * tests. Production code never sees this type; only the test factory
 * upcasts to `Clock` when handing it to commands.
 */
export interface TestClock extends Clock {
  advance(ms: number): void;
}
