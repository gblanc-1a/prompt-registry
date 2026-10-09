import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';

/** Mutating operations a {@link RecordingFs} can be told to fail. */
export type FailableOp = 'writeFile' | 'writeFileBytes' | 'mkdir' | 'rename' | 'remove';

interface InjectedFailure {
  op: FailableOp;
  matches: (file: string) => boolean;
  error: Error;
}

/**
 * Real filesystem that records which paths a run read and which it mutated, and can be told
 * to fail one chosen mutation. A failed mutation is not recorded in `writes` and does not
 * reach the disk.
 */
export class RecordingFs extends NodeFileSystem {
  public readonly reads: string[] = [];
  /** Subset of `reads` that read contents (not mere existence probes). */
  public readonly contentReads: string[] = [];
  public readonly writes: string[] = [];
  private readonly injected: InjectedFailure[] = [];

  private maybeFail(op: FailableOp, file: string): void {
    const index = this.injected.findIndex((rule) => rule.op === op && rule.matches(file));
    if (index !== -1) {
      const [rule] = this.injected.splice(index, 1);
      throw rule.error;
    }
  }

  /**
   * Fail the next `op` whose target path satisfies `matches` (for `rename`, the destination).
   * The injection fires once, then is spent.
   * @param op The mutation to fail.
   * @param matches Predicate over the path the mutation targets.
   * @param error Error to throw.
   */
  public failOnce(op: FailableOp, matches: (file: string) => boolean, error: Error): void {
    this.injected.push({ op, matches, error });
  }

  public override async readFile(file: string): Promise<string> {
    this.reads.push(file);
    this.contentReads.push(file);
    return await super.readFile(file);
  }

  public override async readFileBytes(file: string): Promise<Uint8Array> {
    this.reads.push(file);
    this.contentReads.push(file);
    return await super.readFileBytes(file);
  }

  public override async exists(file: string): Promise<boolean> {
    this.reads.push(file);
    return await super.exists(file);
  }

  public override async readDir(dir: string): Promise<string[]> {
    this.reads.push(dir);
    return await super.readDir(dir);
  }

  public override async writeFile(file: string, contents: string): Promise<void> {
    this.maybeFail('writeFile', file);
    this.writes.push(file);
    await super.writeFile(file, contents);
  }

  public override async writeFileBytes(file: string, bytes: Uint8Array): Promise<void> {
    this.maybeFail('writeFileBytes', file);
    this.writes.push(file);
    await super.writeFileBytes(file, bytes);
  }

  public override async mkdir(dir: string, opts?: { recursive?: boolean }): Promise<void> {
    this.maybeFail('mkdir', dir);
    this.writes.push(dir);
    await super.mkdir(dir, opts);
  }

  public override async rename(from: string, to: string): Promise<void> {
    this.maybeFail('rename', to);
    this.writes.push(to);
    await super.rename(from, to);
  }

  public override async remove(file: string, opts?: { recursive?: boolean }): Promise<void> {
    this.maybeFail('remove', file);
    this.writes.push(file);
    await super.remove(file, opts);
  }
}
