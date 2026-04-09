/**
 * Models: HubCommands calls registerCommands() from its constructor.
 * Since constructor is a framework method (skipped), the analyzer doesn't
 * see registerCommands() as called. But it IS reachable because the class
 * is instantiated externally.
 */
export class HubCommands {
  constructor() {
    this.registerCommands();
  }

  /**
   * Called from constructor — should NOT be flagged as dead.
   */
  public registerCommands(): void {
    // register commands here
  }

  /**
   * Truly dead — not called from constructor or anywhere.
   */
  public trulyDeadMethod(): void {
    // never called
  }
}
