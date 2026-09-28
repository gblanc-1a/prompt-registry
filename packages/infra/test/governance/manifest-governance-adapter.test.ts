/**
 * Tests for governance/manifest-governance-adapter.ts — the ManifestGovernancePort.
 *
 * Every refusal must be a `validation-error` VALUE (never a throw) and must
 * happen with no target write: this adapter is handed no target store at all,
 * which is the structural proof that nothing could have been written.
 */
import {
  createHash,
} from 'node:crypto';
import type {
  ExtractedFiles,
} from '@ai-primitives-hub/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  ManifestGovernanceAdapter,
} from '../../src/governance/manifest-governance-adapter';
import {
  buildZip,
} from '../../src/writers/zip-writer';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const PROMPT = encode('# Review prompt\n');
const SNAPSHOT = encode('id: acme-prompts\n');
const LICENSE = encode('Apache-2.0\n');

interface ManifestOverrides {
  readonly formatVersion?: string;
  readonly itemContentHash?: string;
  readonly extraFileRecord?: string;
  readonly itemPath?: string;
}

const manifestYaml = (overrides: ManifestOverrides = {}): string => {
  const formatVersion = overrides.formatVersion ?? '1';
  const itemPath = overrides.itemPath ?? 'prompts/review.prompt.md';
  const contentHash = overrides.itemContentHash === undefined
    ? ''
    : `    contentHash: "${overrides.itemContentHash}"\n`;
  const extra = overrides.extraFileRecord === undefined
    ? ''
    : `  - path: "${overrides.extraFileRecord}"\n    role: metadata\n    size: 1\n    sha256: "${sha256(encode('x'))}"\n`;
  return [
    `formatVersion: ${formatVersion}\n`,
    'id: acme-prompts\n',
    'version: 1.2.3\n',
    'name: Acme prompts\n',
    'items:\n',
    '  - id: review\n',
    `    path: "${itemPath}"\n`,
    '    kind: prompt\n',
    contentHash,
    'files:\n',
    `  - path: "prompts/review.prompt.md"\n    role: installable\n    size: ${PROMPT.byteLength}\n    sha256: "${sha256(PROMPT)}"\n`,
    `  - path: "collection.snapshot.yml"\n    role: metadata\n    size: ${SNAPSHOT.byteLength}\n    sha256: "${sha256(SNAPSHOT)}"\n`,
    `  - path: "LICENSE"\n    role: metadata\n    size: ${LICENSE.byteLength}\n    sha256: "${sha256(LICENSE)}"\n`,
    extra,
    'provenance:\n',
    '  source: "https://github.com/acme/prompts"\n',
    '  revision: "deadbeef"\n',
    '  collectionPath: "collections/acme.collection.yml"\n',
    '  sourceSnapshotPath: "collection.snapshot.yml"\n',
    '  license: "Apache-2.0"\n',
    '  licensePath: "LICENSE"\n'
  ].join('');
};

const governedFiles = (overrides: ManifestOverrides = {}): ExtractedFiles => new Map([
  ['deployment-manifest.yml', encode(manifestYaml(overrides))],
  ['prompts/review.prompt.md', PROMPT],
  ['collection.snapshot.yml', SNAPSHOT],
  ['LICENSE', LICENSE]
]);

const governedArchive = (overrides: ManifestOverrides = {}): Uint8Array => buildZip(
  [...governedFiles(overrides)].map(([path, bytes]) => ({ path, bytes }))
);

describe('ManifestGovernanceAdapter', () => {
  it('governs a valid archive and projects its inventory (BR1.1-BR1.5)', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'archive',
      bytes: governedArchive()
    });

    expect(result.kind).toBe('governed');
    if (result.kind !== 'governed') {
      return;
    }
    expect(result.bundle.manifest).toStrictEqual({
      bundleId: 'acme-prompts',
      version: '1.2.3',
      formatVersion: 1,
      name: 'Acme prompts'
    });
    expect(result.bundle.items).toHaveLength(1);
    expect(result.bundle.fileRecords.map((record) => record.role))
      .toStrictEqual(['installable', 'metadata', 'metadata']);
    expect(result.bundle.provenance.revision).toBe('deadbeef');
    expect([...result.files.get('prompts/review.prompt.md') ?? []]).toStrictEqual([...PROMPT]);
  });

  it('verifies a declared per-item content hash (BR1.3, NFR1.2)', async () => {
    const matching = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: governedFiles({ itemContentHash: sha256(PROMPT) })
    });
    const mismatched = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: governedFiles({ itemContentHash: sha256(encode('different')) })
    });

    expect(matching.kind).toBe('governed');
    expect(mismatched.kind).toBe('validation-error');
    if (mismatched.kind === 'validation-error') {
      expect(mismatched.outcome.kind).toBe('validation-error');
      expect(mismatched.outcome.detail).toContain('contentHash does not match');
    }
  });

  it('refuses a bundle with no root manifest (BR1.1)', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: new Map([['prompts/review.prompt.md', PROMPT]])
    });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('missing deployment-manifest.yml');
    }
  });

  it('refuses an inventory that does not exactly cover the archive (BR1.2)', async () => {
    const files = new Map(governedFiles());
    files.set('prompts/undeclared.prompt.md', encode('# undeclared\n'));

    const result = await new ManifestGovernanceAdapter().validate({ kind: 'extracted', files });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('is not declared in files');
    }
  });

  it('refuses a non-canonical, traversal-bearing declared path (BR1.4)', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: governedFiles({ extraFileRecord: '../outside.md' })
    });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('canonical bundle-relative path');
    }
  });

  it('refuses a manifest that declares no governed format', async () => {
    const files = new Map(governedFiles());
    files.set('deployment-manifest.yml', encode('id: acme-prompts\nversion: 1.2.3\nname: Acme\n'));

    const result = await new ManifestGovernanceAdapter().validate({ kind: 'extracted', files });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('does not declare the governed manifest format');
    }
  });

  it('refuses an unsupported manifest format version', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: governedFiles({ formatVersion: '99' })
    });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('unsupported formatVersion');
    }
  });

  it('turns an inadmissible archive into a validation-error rather than a throw (NFR1.6)', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'archive',
      bytes: governedArchive(),
      limits: { maxEntries: 1 }
    });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('archive refused (too-many-entries)');
    }
  });

  it('refuses a bundle whose identity does not match the caller expectation', async () => {
    const result = await new ManifestGovernanceAdapter().validate({
      kind: 'extracted',
      files: governedFiles(),
      expectedBundleId: 'other-bundle'
    });

    expect(result.kind).toBe('validation-error');
    if (result.kind === 'validation-error') {
      expect(result.outcome.detail).toContain('does not match expected');
    }
  });
});
