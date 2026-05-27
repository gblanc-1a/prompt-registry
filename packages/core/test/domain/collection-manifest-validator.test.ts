/**
 * Coverage tests for domain/collection/manifest-validator.ts.
 *
 * Tests validateManifest, ManifestValidationError, MANIFEST_FILENAME.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  MANIFEST_FILENAME,
  ManifestValidationError,
  type ManifestValidationOptions,
  validateManifest,
} from '../../src/domain/collection/manifest-validator';
import type {
  ExtractedFiles,
} from '../../src/ports/bundle-extractor';

describe('validateManifest', () => {
  it('validates manifest with required fields', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    const result = validateManifest(files, opts);
    expect(result.id).toBe('test-bundle');
    expect(result.version).toBe('1.0.0');
    expect(result.name).toBe('Test Bundle');
  });

  it('throws error when manifest is missing', () => {
    const files: ExtractedFiles = new Map();
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_MISSING');
      }
    }
  });

  it('throws error when manifest is invalid YAML', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('invalid: yaml: content: [')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    }
  });

  it('throws error when manifest is not an object', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('["array", "not", "object"]')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    }
  });

  it('throws error when manifest is null', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('null')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
  });

  it('throws error when id field is missing', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('version: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    }
  });

  it('throws error when id field is empty', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: ""\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
  });

  it('throws error when version field is missing', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    }
  });

  it('throws error when version field is empty', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: ""\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
  });

  it('throws error when name field is missing', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    }
  });

  it('throws error when name field is empty', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: ""')]
    ]);
    const opts: ManifestValidationOptions = {};
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
  });

  it('throws error when id does not match expectedId', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: actual-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedId: 'expected-bundle' };
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.ID_MISMATCH');
      }
    }
  });

  it('accepts id when expectedId is undefined', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedId: undefined };
    const result = validateManifest(files, opts);
    expect(result.id).toBe('test-bundle');
  });

  it('throws error when version does not match expectedVersion', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedVersion: '2.0.0' };
    expect(() => validateManifest(files, opts)).toThrow(ManifestValidationError);
    try {
      validateManifest(files, opts);
    } catch (e) {
      if (e instanceof ManifestValidationError) {
        expect(e.code).toBe('BUNDLE.VERSION_MISMATCH');
      }
    }
  });

  it('accepts version when expectedVersion is undefined', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedVersion: undefined };
    const result = validateManifest(files, opts);
    expect(result.version).toBe('1.0.0');
  });

  it('accepts any version when expectedVersion is "latest"', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedVersion: 'latest' };
    const result = validateManifest(files, opts);
    expect(result.version).toBe('1.0.0');
  });

  it('accepts version when it matches expectedVersion', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle')]
    ]);
    const opts: ManifestValidationOptions = { expectedVersion: '1.0.0' };
    const result = validateManifest(files, opts);
    expect(result.version).toBe('1.0.0');
  });

  it('preserves additional fields in manifest', () => {
    const files: ExtractedFiles = new Map([
      ['deployment-manifest.yml', new TextEncoder().encode('id: test-bundle\nversion: 1.0.0\nname: Test Bundle\ndescription: A test bundle')]
    ]);
    const opts: ManifestValidationOptions = {};
    const result = validateManifest(files, opts);
    expect(result.description).toBe('A test bundle');
  });
});

describe('ManifestValidationError', () => {
  it('creates error with message and code', () => {
    const error = new ManifestValidationError('test message', 'TEST_CODE');
    expect(error.message).toBe('test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('ManifestValidationError');
  });
});

describe('MANIFEST_FILENAME', () => {
  it('is deployment-manifest.yml', () => {
    expect(MANIFEST_FILENAME).toBe('deployment-manifest.yml');
  });
});
