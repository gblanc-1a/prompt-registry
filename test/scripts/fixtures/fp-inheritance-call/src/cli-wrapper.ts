/**
 * Models: CliWrapper (abstract parent) defines installWithProgress,
 * NpmCliWrapper (child) extends it. Call site uses NpmCliWrapper instance.
 */
export abstract class CliWrapper {
  public async installWithProgress(cwd: string): Promise<boolean> {
    return true;
  }

  public async installInTerminal(cwd: string): Promise<boolean> {
    return true;
  }
}

export class NpmCliWrapper extends CliWrapper {
  private static instance: NpmCliWrapper;

  public static getInstance(): NpmCliWrapper {
    if (!NpmCliWrapper.instance) {
      NpmCliWrapper.instance = new NpmCliWrapper();
    }
    return NpmCliWrapper.instance;
  }
}
