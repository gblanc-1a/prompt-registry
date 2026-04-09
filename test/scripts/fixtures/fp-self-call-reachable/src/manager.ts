/**
 * Models: Manager has public methods called externally, which internally
 * call private-like helpers. The helpers are self-call-only but reachable.
 */
export class Manager {
  /**
   * Called externally from consumer.ts
   */
  public process(): void {
    this.validate();
    this.transform();
  }

  /**
   * Self-call-only helper — called by process() which is externally reachable.
   * Should NOT be flagged as dead.
   */
  public validate(): boolean {
    return true;
  }

  /**
   * Self-call-only helper — called by process() which is externally reachable.
   * Should NOT be flagged as dead.
   */
  public transform(): void {
    this.formatOutput();
  }

  /**
   * Transitive self-call — called by transform() which is called by process().
   * Should NOT be flagged as dead (2 levels deep but still reachable).
   */
  public formatOutput(): void {
    // do something
  }

  /**
   * Truly dead — not called by anything.
   */
  public trulyDeadMethod(): void {
    // never called
  }

  /**
   * Self-call-only AND caller is also dead → transitively dead.
   * Should still be flagged as dead.
   */
  public deadHelper(): void {
    // called only by trulyDeadCaller
  }
}
