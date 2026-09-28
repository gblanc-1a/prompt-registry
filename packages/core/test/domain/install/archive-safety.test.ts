/**
 * Tests for domain/install/archive-safety.ts — the fixed admission limits, the
 * tightening-only override rule, and the entry-type policy (NFR1.6, NFR1.7).
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  ArchiveEntryClaim,
} from '../../../src/domain/install/archive-safety';
import {
  DEFAULT_ARCHIVE_SAFETY_LIMITS,
  isAdmissibleEntryType,
  refuseArchiveAdmission,
  resolveArchiveSafetyLimits,
} from '../../../src/domain/install/archive-safety';

const file = (overrides: Partial<ArchiveEntryClaim> = {}): ArchiveEntryClaim => ({
  entryName: 'prompts/a.prompt.md',
  isDirectory: false,
  uncompressedSize: 100,
  compressedSize: 100,
  ...overrides
});

/** Regular-file unix mode (0o100644). */
const REGULAR_FILE_MODE = 0x81_A4;
/** Symbolic-link unix mode (0o120777). */
const SYMLINK_MODE = 0xA1_FF;
/** Character-device unix mode (0o020666). */
const CHAR_DEVICE_MODE = 0x21_B6;
/** Directory unix mode (0o040755). */
const DIRECTORY_MODE = 0x41_ED;

describe('resolveArchiveSafetyLimits', () => {
  it('uses the fixed defaults when no override is supplied', () => {
    const resolution = resolveArchiveSafetyLimits();

    expect(resolution).toStrictEqual({ kind: 'ok', limits: DEFAULT_ARCHIVE_SAFETY_LIMITS });
    expect(DEFAULT_ARCHIVE_SAFETY_LIMITS).toStrictEqual({
      maxEntries: 10_000,
      maxTotalUncompressedBytes: 256 * 1024 * 1024,
      maxEntryUncompressedBytes: 64 * 1024 * 1024,
      maxCompressionRatio: 100
    });
  });

  it('accepts an override that tightens a limit', () => {
    const resolution = resolveArchiveSafetyLimits({ maxEntries: 50, maxCompressionRatio: 10 });

    expect(resolution.kind).toBe('ok');
    if (resolution.kind === 'ok') {
      expect(resolution.limits.maxEntries).toBe(50);
      expect(resolution.limits.maxCompressionRatio).toBe(10);
      expect(resolution.limits.maxEntryUncompressedBytes)
        .toBe(DEFAULT_ARCHIVE_SAFETY_LIMITS.maxEntryUncompressedBytes);
    }
  });

  it('accepts an override exactly equal to the default', () => {
    expect(resolveArchiveSafetyLimits({ maxEntries: 10_000 }).kind).toBe('ok');
  });

  it('rejects a less restrictive override', () => {
    const resolution = resolveArchiveSafetyLimits({ maxEntries: 10_001 });

    expect(resolution.kind).toBe('validation-error');
    if (resolution.kind === 'validation-error') {
      expect(resolution.detail).toContain('may only be tightened');
    }
  });

  it('rejects absent, non-finite, and non-positive override values', () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const resolution = resolveArchiveSafetyLimits({ maxEntries: value as number });
      expect(resolution.kind).toBe('validation-error');
    }
  });
});

describe('isAdmissibleEntryType (NFR1.7)', () => {
  it('admits a regular file and an archive with no unix attributes', () => {
    expect(isAdmissibleEntryType(file({ unixMode: REGULAR_FILE_MODE }))).toBe(true);
    expect(isAdmissibleEntryType(file({ unixMode: 0 }))).toBe(true);
    expect(isAdmissibleEntryType(file())).toBe(true);
  });

  it('admits a directory entry carrying directory mode bits', () => {
    expect(isAdmissibleEntryType(file({ isDirectory: true, unixMode: DIRECTORY_MODE }))).toBe(true);
  });

  it('refuses a symbolic link even when it would resolve inside the root', () => {
    expect(isAdmissibleEntryType(file({ unixMode: SYMLINK_MODE }))).toBe(false);
  });

  it('refuses a device node and a directory-typed non-directory entry', () => {
    expect(isAdmissibleEntryType(file({ unixMode: CHAR_DEVICE_MODE }))).toBe(false);
    expect(isAdmissibleEntryType(file({ unixMode: DIRECTORY_MODE }))).toBe(false);
  });
});

describe('refuseArchiveAdmission against the defaults', () => {
  const limits = DEFAULT_ARCHIVE_SAFETY_LIMITS;

  it('admits an archive exactly at the entry-count limit and refuses one over', () => {
    const atLimit = Array.from({ length: limits.maxEntries }, () => file({ uncompressedSize: 1, compressedSize: 1 }));

    expect(refuseArchiveAdmission(atLimit, limits)).toBeNull();
    expect(refuseArchiveAdmission([...atLimit, file()], limits)?.reason).toBe('too-many-entries');
  });

  it('admits an entry exactly at the per-entry size limit and refuses one byte over', () => {
    const atLimit = file({
      uncompressedSize: limits.maxEntryUncompressedBytes,
      compressedSize: limits.maxEntryUncompressedBytes
    });
    const oneOver = file({
      uncompressedSize: limits.maxEntryUncompressedBytes + 1,
      compressedSize: limits.maxEntryUncompressedBytes + 1
    });

    expect(refuseArchiveAdmission([atLimit], limits)).toBeNull();
    expect(refuseArchiveAdmission([oneOver], limits)?.reason).toBe('entry-size-exceeded');
  });

  it('admits a total exactly at the limit and refuses one byte over', () => {
    const chunk = limits.maxEntryUncompressedBytes;
    const atLimit = Array.from(
      { length: limits.maxTotalUncompressedBytes / chunk },
      () => file({ uncompressedSize: chunk, compressedSize: chunk })
    );
    const oneOver = [...atLimit, file({ uncompressedSize: 1, compressedSize: 1 })];

    expect(refuseArchiveAdmission(atLimit, limits)).toBeNull();
    expect(refuseArchiveAdmission(oneOver, limits)?.reason).toBe('total-size-exceeded');
  });

  it('admits a ratio exactly at the limit and refuses one over, ignoring directories', () => {
    const atLimit = file({ uncompressedSize: 10_000, compressedSize: 100 });
    const oneOver = file({ uncompressedSize: 10_100, compressedSize: 100 });
    const directory = file({ isDirectory: true, uncompressedSize: 0, compressedSize: 0 });

    expect(refuseArchiveAdmission([atLimit, directory], limits)).toBeNull();
    expect(refuseArchiveAdmission([oneOver], limits)?.reason).toBe('compression-ratio-exceeded');
  });

  it('refuses an unsupported entry type before any size evaluation', () => {
    const rejection = refuseArchiveAdmission([file({ unixMode: SYMLINK_MODE })], limits);

    expect(rejection?.reason).toBe('unsupported-entry-type');
    expect(rejection?.detail).toContain('prompts/a.prompt.md');
  });
});
