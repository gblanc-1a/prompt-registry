/**
 * External consumer that calls Manager.process() — making process()
 * externally reachable, which in turn makes validate(), transform(),
 * and formatOutput() reachable via the self-call chain.
 */
import { Manager } from './manager';

export function runPipeline(): void {
  const mgr = new Manager();
  mgr.process();
}
