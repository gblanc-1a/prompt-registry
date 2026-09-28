/**
 * Tests for domain/install/governed-manifest.ts — the governed projection and
 * the BR1.5 write-candidate rule.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  GovernableManifestSource,
} from '../../../src/domain/install/governed-manifest';
import {
  indexFileRecords,
  installableItems,
  isInstallableItem,
  projectGovernedManifest,
} from '../../../src/domain/install/governed-manifest';

const source = (
  overrides: Partial<GovernableManifestSource> = {}
): GovernableManifestSource => ({
  formatVersion: 1,
  id: 'acme-prompts',
  version: '1.2.3',
  name: 'Acme prompts',
  description: 'A small governed bundle',
  items: [
    { id: 'i1', path: 'prompts/review.prompt.md', kind: 'prompt' },
    { id: 'i2', path: 'docs/notes.md', kind: 'instruction' }
  ],
  files: [
    { path: 'prompts/review.prompt.md', role: 'installable', size: 12, sha256: `sha256:${'a'.repeat(64)}` },
    { path: 'docs/notes.md', role: 'metadata', size: 4, sha256: `sha256:${'b'.repeat(64)}` }
  ],
  provenance: {
    source: 'https://github.com/acme/prompts',
    revision: 'deadbeef',
    license: 'Apache-2.0'
  },
  ...overrides
});

describe('projectGovernedManifest', () => {
  it('projects manifest identity, items, file records, and provenance', () => {
    const bundle = projectGovernedManifest(source());

    expect(bundle.manifest).toStrictEqual({
      bundleId: 'acme-prompts',
      version: '1.2.3',
      formatVersion: 1,
      name: 'Acme prompts',
      description: 'A small governed bundle'
    });
    expect(bundle.items.map((item) => item.itemId)).toStrictEqual(['i1', 'i2']);
    expect(bundle.items[0]?.archivePath).toBe('prompts/review.prompt.md');
    expect(bundle.fileRecords[1]).toStrictEqual({
      archivePath: 'docs/notes.md',
      role: 'metadata',
      size: 4,
      contentDigest: `sha256:${'b'.repeat(64)}`
    });
    expect(bundle.provenance.license).toBe('Apache-2.0');
  });

  it('omits optional fields the manifest did not declare', () => {
    const bundle = projectGovernedManifest(source({
      description: undefined,
      items: [{ id: 'i1', path: 'prompts/a.prompt.md', kind: 'prompt' }],
      files: [{ path: 'prompts/a.prompt.md', role: 'installable', size: 1 }]
    }));

    expect('description' in bundle.manifest).toBe(false);
    expect('contentHash' in (bundle.items[0] ?? {})).toBe(false);
    expect('contentDigest' in (bundle.fileRecords[0] ?? {})).toBe(false);
  });

  it('preserves an optional per-item content hash (BR1.3)', () => {
    const contentHash = `sha256:${'c'.repeat(64)}`;
    const bundle = projectGovernedManifest(source({
      items: [{ id: 'i1', path: 'prompts/a.prompt.md', kind: 'prompt', contentHash }],
      files: [{ path: 'prompts/a.prompt.md', role: 'installable', size: 1 }]
    }));

    expect(bundle.items[0]?.contentHash).toBe(contentHash);
  });

  it('keeps manifest declaration order for items and file records', () => {
    const bundle = projectGovernedManifest(source({
      items: [
        { id: 'z', path: 'prompts/z.prompt.md', kind: 'prompt' },
        { id: 'a', path: 'prompts/a.prompt.md', kind: 'prompt' }
      ],
      files: [
        { path: 'prompts/z.prompt.md', role: 'installable', size: 1 },
        { path: 'prompts/a.prompt.md', role: 'installable', size: 1 }
      ]
    }));

    expect(bundle.items.map((item) => item.itemId)).toStrictEqual(['z', 'a']);
    expect(bundle.fileRecords.map((record) => record.archivePath))
      .toStrictEqual(['prompts/z.prompt.md', 'prompts/a.prompt.md']);
  });
});

describe('write candidates (BR1.5)', () => {
  it('indexes file records by archive path', () => {
    const records = indexFileRecords(projectGovernedManifest(source()));

    expect(records.get('docs/notes.md')?.role).toBe('metadata');
    expect(records.size).toBe(2);
  });

  it('treats only installable-roled items as write candidates', () => {
    const bundle = projectGovernedManifest(source());

    expect(installableItems(bundle).map((item) => item.itemId)).toStrictEqual(['i1']);
  });

  it('never makes an ignored-roled item a write candidate', () => {
    const bundle = projectGovernedManifest(source({
      items: [{ id: 'i1', path: 'extras/scratch.txt', kind: 'prompt' }],
      files: [{ path: 'extras/scratch.txt', role: 'ignored', size: 3 }]
    }));

    expect(installableItems(bundle)).toStrictEqual([]);
  });

  it('never resolves a candidate for an item with no matching file record', () => {
    const bundle = projectGovernedManifest(source({
      items: [{ id: 'orphan', path: 'prompts/missing.prompt.md', kind: 'prompt' }],
      files: [{ path: 'prompts/other.prompt.md', role: 'installable', size: 1 }]
    }));
    const records = indexFileRecords(bundle);

    expect(isInstallableItem(bundle.items[0] as never, records)).toBe(false);
    expect(installableItems(bundle)).toStrictEqual([]);
  });
});
