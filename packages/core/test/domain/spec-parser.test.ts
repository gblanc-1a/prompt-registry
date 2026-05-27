/**
 * Coverage tests for domain/spec-parser.ts.
 *
 * Tests parseBundleSpec and BundleSpecParseError.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  BundleSpecParseError,
  parseBundleSpec,
} from '../../src/domain/spec-parser';

describe('parseBundleSpec', () => {
  it('parses bundleId only', () => {
    const result = parseBundleSpec('my-bundle');
    expect(result).toEqual({ bundleId: 'my-bundle' });
  });

  it('parses sourceId:bundleId', () => {
    const result = parseBundleSpec('owner/repo:my-bundle');
    expect(result).toEqual({ sourceId: 'owner/repo', bundleId: 'my-bundle' });
  });

  it('parses sourceId:bundleId@version', () => {
    const result = parseBundleSpec('owner/repo:my-bundle@1.0.0');
    expect(result).toEqual({ sourceId: 'owner/repo', bundleId: 'my-bundle', bundleVersion: '1.0.0' });
  });

  it('parses bundleId@version', () => {
    const result = parseBundleSpec('my-bundle@1.0.0');
    expect(result).toEqual({ bundleId: 'my-bundle', bundleVersion: '1.0.0' });
  });

  it('accepts "latest" as version', () => {
    const result = parseBundleSpec('my-bundle@latest');
    expect(result).toEqual({ bundleId: 'my-bundle', bundleVersion: 'latest' });
  });

  it('trims whitespace', () => {
    const result = parseBundleSpec('  my-bundle  ');
    expect(result).toEqual({ bundleId: 'my-bundle' });
  });

  it('throws error for empty string', () => {
    expect(() => parseBundleSpec('')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('')).toThrow('bundle spec is empty');
  });

  it('throws error for whitespace-only string', () => {
    expect(() => parseBundleSpec('   ')).toThrow(BundleSpecParseError);
  });

  it('throws error for non-string input', () => {
    expect(() => parseBundleSpec(null as unknown as string)).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec(undefined as unknown as string)).toThrow(BundleSpecParseError);
  });

  it('throws error for invalid bundleId (uppercase)', () => {
    expect(() => parseBundleSpec('MyBundle')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('MyBundle')).toThrow('must match');
  });

  it('throws error for invalid bundleId (special chars)', () => {
    expect(() => parseBundleSpec('my_bundle')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('my.bundle')).toThrow(BundleSpecParseError);
  });

  it('throws error for malformed @version (empty version)', () => {
    expect(() => parseBundleSpec('my-bundle@')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('my-bundle@')).toThrow('malformed @version suffix');
  });

  it('throws error for malformed @version (empty head)', () => {
    expect(() => parseBundleSpec('@1.0.0')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('@1.0.0')).toThrow('malformed @version suffix');
  });

  it('throws error for malformed sourceId:bundleId (empty sourceId)', () => {
    expect(() => parseBundleSpec(':my-bundle')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec(':my-bundle')).toThrow('malformed sourceId:bundleId pair');
  });

  it('throws error for malformed sourceId:bundleId (empty bundleId)', () => {
    expect(() => parseBundleSpec('owner/repo:')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('owner/repo:')).toThrow('malformed sourceId:bundleId pair');
  });

  it('accepts bundleId with hyphens and numbers', () => {
    const result = parseBundleSpec('my-bundle-123');
    expect(result).toEqual({ bundleId: 'my-bundle-123' });
  });

  it('accepts bundleId starting with number', () => {
    const result = parseBundleSpec('123-bundle');
    expect(result).toEqual({ bundleId: '123-bundle' });
  });

  it('accepts sourceId with slashes', () => {
    const result = parseBundleSpec('owner/repo/subdir:my-bundle');
    expect(result).toEqual({ sourceId: 'owner/repo/subdir', bundleId: 'my-bundle' });
  });

  it('handles multiple @ signs (last one is version delimiter)', () => {
    const result = parseBundleSpec('owner@repo:my-bundle@1.0.0');
    expect(result).toEqual({ sourceId: 'owner@repo', bundleId: 'my-bundle', bundleVersion: '1.0.0' });
  });

  it('throws error for sourceId containing colon (fails on bundleId validation first)', () => {
    expect(() => parseBundleSpec('owner:repo:my-bundle')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('owner:repo:my-bundle')).toThrow('must match');
  });

  it('preserves raw input in error', () => {
    try {
      parseBundleSpec('');
    } catch (e) {
      expect(e).toBeInstanceOf(BundleSpecParseError);
      if (e instanceof BundleSpecParseError) {
        expect(e.raw).toBe('');
      }
    }
  });
});

describe('BundleSpecParseError', () => {
  it('creates error with message and raw input', () => {
    const error = new BundleSpecParseError('test message', 'raw-input');
    expect(error.message).toBe('test message');
    expect(error.raw).toBe('raw-input');
    expect(error.name).toBe('BundleSpecParseError');
  });
});
