/**
 * Consumer calls installWithProgress via NpmCliWrapper (subclass) instance.
 * The method is defined on CliWrapper (parent), so the analyzer must
 * propagate call sites through the inheritance chain.
 */
import { NpmCliWrapper } from './cli-wrapper';

export async function scaffoldProject(targetPath: string): Promise<void> {
  const npmWrapper = NpmCliWrapper.getInstance();
  await npmWrapper.installWithProgress(targetPath);
}
