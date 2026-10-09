import {
  NodeFileSystem,
} from '@ai-primitives-hub/infra';

/** Real filesystem that records which paths a run read and which it mutated. */
export class RecordingFs extends NodeFileSystem {
  public readonly reads: string[] = [];
  /** Subset of `reads` that read contents (not mere existence probes). */
  public readonly contentReads: string[] = [];
  public readonly writes: string[] = [];

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
    this.writes.push(file);
    await super.writeFile(file, contents);
  }

  public override async writeFileBytes(file: string, bytes: Uint8Array): Promise<void> {
    this.writes.push(file);
    await super.writeFileBytes(file, bytes);
  }

  public override async mkdir(dir: string, opts?: { recursive?: boolean }): Promise<void> {
    this.writes.push(dir);
    await super.mkdir(dir, opts);
  }

  public override async rename(from: string, to: string): Promise<void> {
    this.writes.push(to);
    await super.rename(from, to);
  }

  public override async remove(file: string, opts?: { recursive?: boolean }): Promise<void> {
    this.writes.push(file);
    await super.remove(file, opts);
  }
}
