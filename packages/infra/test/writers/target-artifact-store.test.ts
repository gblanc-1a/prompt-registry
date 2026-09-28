/**
 * Tests for writers/target-artifact-store.ts — containment, symbolic-link
 * refusal, durable writes, read-back evidence, and verified removal
 * (BR2.2, BR4.1, BR4.6, NFR1.1.1, NFR1.1.2).
 *
 * Run against the real filesystem: symbolic links and atomic renames are exactly
 * what an in-memory double would fail to model.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  NodePathInspector,
} from '../../src/fs/node-path-inspector';
import {
  SafeTargetArtifactStore,
} from '../../src/writers/target-artifact-store';
import {
  createTempDir,
} from '../helpers/temp-dir';

const BYTES = new TextEncoder().encode('# prompt\n');

describe('SafeTargetArtifactStore', () => {
  let dir: string;
  let cleanup: () => void;
  let root: string;
  let store: SafeTargetArtifactStore;

  beforeEach(() => {
    [dir, cleanup] = createTempDir('artifact-store-');
    root = join(dir, 'target');
    mkdirSync(root, { recursive: true });
    store = new SafeTargetArtifactStore({ pathInspector: new NodePathInspector() });
  });

  afterEach(() => {
    cleanup();
  });

  it('writes bytes and reads back exactly what it wrote', async () => {
    const destination = join(root, 'prompts', 'a.md');

    const result = await store.writeAndReadBack({
      destinationRoot: root,
      destinationPath: destination,
      bytes: BYTES
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect([...result.value]).toStrictEqual([...BYTES]);
    }
    expect(readFileSync(destination, 'utf8')).toBe('# prompt\n');
  });

  it('writes binary payloads verbatim', async () => {
    const binary = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0xFF, 0xFE, 0x00]);
    const destination = join(root, 'assets', 'deck.pptx');

    const result = await store.writeAndReadBack({
      destinationRoot: root,
      destinationPath: destination,
      bytes: binary
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect([...result.value]).toStrictEqual([...binary]);
    }
  });

  it('refuses a destination outside its root, writing nothing', async () => {
    const outside = join(dir, 'outside.md');

    const result = await store.writeAndReadBack({
      destinationRoot: root,
      destinationPath: outside,
      bytes: BYTES
    });

    expect(result.kind).toBe('safety-blocked');
    expect(existsSync(outside)).toBe(false);
  });

  it('refuses a symbolic-link component under the root, even one resolving inside it', async () => {
    const realDir = join(root, 'real');
    mkdirSync(realDir);
    symlinkSync(realDir, join(root, 'linked'));

    const result = await store.writeAndReadBack({
      destinationRoot: root,
      destinationPath: join(root, 'linked', 'a.md'),
      bytes: BYTES
    });

    expect(result.kind).toBe('safety-blocked');
    expect(existsSync(join(realDir, 'a.md'))).toBe(false);
  });

  it('refuses to read or remove through a symbolic link', async () => {
    const realDir = join(root, 'real2');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'a.md'), 'secret');
    symlinkSync(realDir, join(root, 'linked2'));

    const read = await store.read(root, join(root, 'linked2', 'a.md'));
    const removal = await store.removeAndVerifyAbsent(root, join(root, 'linked2', 'a.md'));

    expect(read.kind).toBe('safety-blocked');
    expect(removal.kind).toBe('safety-blocked');
    expect(readFileSync(join(realDir, 'a.md'), 'utf8')).toBe('secret');
  });

  it('reports an absent file as null rather than a failure', async () => {
    const result = await store.read(root, join(root, 'prompts', 'missing.md'));

    expect(result).toStrictEqual({ kind: 'ok', value: null });
  });

  it('replaces existing content completely', async () => {
    const destination = join(root, 'prompts', 'a.md');
    mkdirSync(join(root, 'prompts'));
    writeFileSync(destination, 'previous');

    await store.writeAndReadBack({
      destinationRoot: root,
      destinationPath: destination,
      bytes: BYTES
    });

    expect(readFileSync(destination, 'utf8')).toBe('# prompt\n');
  });

  it('removes a file and verifies its absence (BR4.6)', async () => {
    const destination = join(root, 'prompts', 'a.md');
    await store.writeAndReadBack({ destinationRoot: root, destinationPath: destination, bytes: BYTES });

    const result = await store.removeAndVerifyAbsent(root, destination);

    expect(result.kind).toBe('ok');
    expect(existsSync(destination)).toBe(false);
  });

  it('treats removing an already-absent path as verified absent', async () => {
    const result = await store.removeAndVerifyAbsent(root, join(root, 'prompts', 'gone.md'));

    expect(result.kind).toBe('ok');
  });
});
