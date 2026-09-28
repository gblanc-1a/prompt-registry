import AdmZip from 'adm-zip';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  ArchiveAdmissionError,
  ZipBundleExtractor,
} from '../../src/extractors/zip-bundle-extractor';
import {
  buildZip,
} from '../../src/writers/zip-writer';

describe('ZipBundleExtractor', () => {
  it('round-trips a zip built by buildZip back into an identical file map', async () => {
    const entries = [
      { path: 'deployment-manifest.yml', bytes: new TextEncoder().encode('id: my-bundle\nversion: 1.0.0\nname: My Bundle\n') },
      { path: 'prompts/foo.prompt.md', bytes: new TextEncoder().encode('# Foo prompt') }
    ];
    const zipBytes = buildZip(entries);

    const files = await new ZipBundleExtractor().extract(zipBytes);

    expect(files.size).toBe(2);
    expect(new TextDecoder().decode(files.get('deployment-manifest.yml'))).toBe(
      'id: my-bundle\nversion: 1.0.0\nname: My Bundle\n'
    );
    expect(new TextDecoder().decode(files.get('prompts/foo.prompt.md'))).toBe('# Foo prompt');
  });

  it('round-trips a larger, deflate-compressed entry correctly', async () => {
    // Varied lines: still deflate-compressed, but not the >100:1 expansion an
    // archive bomb shows, which admission refuses by default (NFR1.6).
    const largeContent = Array.from(
      { length: 500 },
      (_unused, index) => `line ${index} of mostly unique text ${index * 7} ${(index * 31).toString(36)}`
    ).join('\n');
    const zipBytes = buildZip([{ path: 'large.md', bytes: new TextEncoder().encode(largeContent) }]);

    const files = await new ZipBundleExtractor().extract(zipBytes);

    expect(new TextDecoder().decode(files.get('large.md'))).toBe(largeContent);
  });

  it('excludes directory entries from the resulting map', async () => {
    const zipBytes = buildZip([{ path: 'nested/file.md', bytes: new TextEncoder().encode('content') }]);

    const files = await new ZipBundleExtractor().extract(zipBytes);

    for (const key of files.keys()) {
      expect(key.endsWith('/')).toBe(false);
    }
  });

  it('rejects with a descriptive error when the bytes are not a valid zip', async () => {
    const garbage = new TextEncoder().encode('not a zip file');

    await expect(new ZipBundleExtractor().extract(garbage)).rejects.toThrow(/Failed to extract bundle/);
  });

  it('rejects archive entries that escape the bundle root', async () => {
    const zipBytes = buildZip([{ path: '../outside.txt', bytes: new TextEncoder().encode('unsafe') }]);

    await expect(new ZipBundleExtractor().extract(zipBytes)).rejects.toThrow(/Unsafe ZIP path/);
  });
});

describe('ZipBundleExtractor archive admission (NFR1.6, NFR1.7)', () => {
  /**
   * Symbolic-link unix mode (0o120777 = 0xA1FF) placed in the high half of a
   * ZIP entry's external attributes: 0xA1FF * 65536.
   */
  const SYMLINK_ATTR = 2_717_843_456;

  it('refuses an archive above a tightened entry-count limit', async () => {
    const zipBytes = buildZip([
      { path: 'a.md', bytes: new TextEncoder().encode('a') },
      { path: 'b.md', bytes: new TextEncoder().encode('b') },
      { path: 'c.md', bytes: new TextEncoder().encode('c') }
    ]);

    const extractor = new ZipBundleExtractor({ limits: { maxEntries: 2 } });

    await expect(extractor.extract(zipBytes)).rejects.toThrow(ArchiveAdmissionError);
    await expect(extractor.extract(zipBytes)).rejects.toThrow(/above the limit of 2/);
  });

  it('admits an archive exactly at a tightened entry-count limit', async () => {
    const zipBytes = buildZip([
      { path: 'a.md', bytes: new TextEncoder().encode('a') },
      { path: 'b.md', bytes: new TextEncoder().encode('b') }
    ]);

    const files = await new ZipBundleExtractor({ limits: { maxEntries: 2 } }).extract(zipBytes);

    expect(files.size).toBe(2);
  });

  it('refuses a decompression bomb above the default compression ratio', async () => {
    const zipBytes = buildZip([
      { path: 'bomb.txt', bytes: new TextEncoder().encode('a'.repeat(1_000_000)) }
    ]);

    await expect(new ZipBundleExtractor().extract(zipBytes))
      .rejects.toThrow(/compression ratio above 100:1/);
  });

  it('refuses a limit override that is not a tightening', async () => {
    const zipBytes = buildZip([{ path: 'a.md', bytes: new TextEncoder().encode('a') }]);

    await expect(new ZipBundleExtractor({ limits: { maxCompressionRatio: 1000 } }).extract(zipBytes))
      .rejects.toThrow(/may only be tightened/);
    await expect(new ZipBundleExtractor({ limits: { maxEntries: 0 } }).extract(zipBytes))
      .rejects.toThrow(/greater than zero/);
  });

  it('refuses an archive carrying a symbolic-link entry', async () => {
    const zip = new AdmZip();
    zip.addFile('prompts/a.prompt.md', Buffer.from('# a'));
    zip.addFile('prompts/link.md', Buffer.from('a.prompt.md'));
    // `addFile`'s attribute argument is not persisted by this adm-zip version;
    // the entry's own `attr` is, and that is what the reader classifies from.
    const linkEntry = zip.getEntries().find((entry) => entry.entryName === 'prompts/link.md');
    (linkEntry as unknown as { attr: number }).attr = SYMLINK_ATTR;

    await expect(new ZipBundleExtractor().extract(zip.toBuffer()))
      .rejects.toThrow(/not a regular file or directory/);
  });

  it('materialises no entry when admission fails', async () => {
    const zipBytes = buildZip([
      { path: 'a.md', bytes: new TextEncoder().encode('a') },
      { path: 'bomb.txt', bytes: new TextEncoder().encode('b'.repeat(500_000)) }
    ]);

    const extractor = new ZipBundleExtractor();
    let extracted: unknown = 'not-called';
    try {
      extracted = await extractor.extract(zipBytes);
    } catch (error) {
      expect(error).toBeInstanceOf(ArchiveAdmissionError);
    }
    expect(extracted).toBe('not-called');
  });
});
