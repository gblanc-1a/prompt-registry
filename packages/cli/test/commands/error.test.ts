/**
 * Tests for CLI framework error utilities.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTestContext,
  generateTargetHint,
  readTargetsSafely,
  RegistryError,
  resolveTarget,
  resolveTargetName,
  throwTargetNotFoundError,
  validateInputs,
} from '../../src/framework';

describe('throwTargetNotFoundError', () => {
  it('should throw RegistryError with correct message and default hint when targets array is empty', () => {
    expect(() => throwTargetNotFoundError('install', 'my-target', []))
      .toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: target "my-target" is not configured',
        hint: 'Run `prompt-registry target add <name> --type <kind>` to add one.',
        context: { target: 'my-target' }
      }));
  });

  it('should throw RegistryError with correct message and default hint when targets array has items', () => {
    const targets = [{ name: 'target1' }, { name: 'target2' }];
    expect(() => throwTargetNotFoundError('uninstall', 'my-target', targets))
      .toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'uninstall: target "my-target" is not configured',
        hint: 'Configured targets: target1, target2.',
        context: { target: 'my-target' }
      }));
  });

  it('should use custom hint generator when provided', () => {
    const targets = [{ name: 'target1' }];
    const customHint = (ts: { name: string }[]) => `Custom: ${ts.map((t) => t.name).join(' | ')}`;
    expect(() => throwTargetNotFoundError('update', 'my-target', targets, customHint))
      .toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'update: target "my-target" is not configured',
        hint: 'Custom: target1',
        context: { target: 'my-target' }
      }));
  });
});

describe('generateTargetHint', () => {
  it('should return hint for multiple targets', () => {
    const targets = [{ name: 'target1' }, { name: 'target2' }, { name: 'target3' }];
    const hint = generateTargetHint(targets);
    expect(hint).toBe('Multiple targets configured: target1, target2, target3. Specify with --target <name>.');
  });

  it('should return hint for single target', () => {
    const targets = [{ name: 'target1' }];
    const hint = generateTargetHint(targets);
    expect(hint).toBe('Configure a target with `prompt-registry target add <name> --type <kind>` first.');
  });

  it('should return hint for no targets', () => {
    const targets: { name: string }[] = [];
    const hint = generateTargetHint(targets);
    expect(hint).toBe('Configure a target with `prompt-registry target add <name> --type <kind>` first.');
  });
});

describe('readTargetsSafely', () => {
  it('should return array when promise resolves', async () => {
    const targets = [{ name: 'target1' }, { name: 'target2' }];
    const result = await readTargetsSafely(Promise.resolve(targets));
    expect(result).toEqual(targets);
  });

  it('should return empty array when promise rejects', async () => {
    const result = await readTargetsSafely(Promise.reject(new Error('Test error')));
    expect(result).toEqual([]);
  });

  it('should return empty array when promise rejects with undefined', async () => {
    const result = await readTargetsSafely(Promise.reject(new Error('Test error')));
    expect(result).toEqual([]);
  });
});

describe('resolveTargetName', () => {
  it('should return target name when provided', async () => {
    const ctx = createTestContext();
    const result = await resolveTargetName('my-target', 'install', ctx, () => Promise.resolve([]));
    expect(result).toBe('my-target');
  });

  it('should return target name when provided non-empty string', async () => {
    const ctx = createTestContext();
    const result = await resolveTargetName('my-target', 'install', ctx, () => Promise.resolve([]));
    expect(result).toBe('my-target');
  });

  it('should throw RegistryError when target name is undefined', async () => {
    const ctx = createTestContext();
    await expect(resolveTargetName(undefined, 'install', ctx, () => Promise.resolve([])))
      .rejects.toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: --target <name> is required',
        hint: 'Configure a target with `prompt-registry target add <name> --type <kind>` first.'
      }));
  });

  it('should throw RegistryError when target name is empty string', async () => {
    const ctx = createTestContext();
    await expect(resolveTargetName('', 'install', ctx, () => Promise.resolve([])))
      .rejects.toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: --target <name> is required',
        hint: 'Configure a target with `prompt-registry target add <name> --type <kind>` first.'
      }));
  });

  it('should throw RegistryError with hint for multiple configured targets', async () => {
    const ctx = createTestContext();
    const targets = [{ name: 'target1' }, { name: 'target2' }];
    await expect(resolveTargetName(undefined, 'uninstall', ctx, () => Promise.resolve(targets)))
      .rejects.toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'uninstall: --target <name> is required',
        hint: 'Multiple targets configured: target1, target2. Specify with --target <name>.'
      }));
  });
});

describe('validateInputs', () => {
  it('should return false for provided string flag', () => {
    const opts = { bundle: 'my-bundle', lockfile: undefined };
    const result = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
    expect(result).toEqual({ bundle: false, lockfile: true });
  });

  it('should return true for undefined string flag', () => {
    const opts = { bundle: undefined, lockfile: undefined };
    const result = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
    expect(result).toEqual({ bundle: true, lockfile: true });
  });

  it('should return true for empty string flag', () => {
    const opts = { bundle: '', lockfile: '' };
    const result = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
    expect(result).toEqual({ bundle: true, lockfile: true });
  });

  it('should return false for true boolean flag', () => {
    const opts = { all: true };
    const result = validateInputs(opts, { flags: ['all'] });
    expect(result).toEqual({ all: false });
  });

  it('should return true for false boolean flag', () => {
    const opts = { all: false };
    const result = validateInputs(opts, { flags: ['all'] });
    expect(result).toEqual({ all: true });
  });

  it('should return true for undefined boolean flag', () => {
    const opts = { all: undefined };
    const result = validateInputs(opts, { flags: ['all'] });
    expect(result).toEqual({ all: true });
  });

  it('should handle mixed string and boolean flags', () => {
    const opts = { bundle: 'my-bundle', lockfile: undefined, all: true };
    const result = validateInputs(opts, { flags: ['bundle', 'lockfile', 'all'] });
    expect(result).toEqual({ bundle: false, lockfile: true, all: false });
  });
});

describe('resolveTarget', () => {
  it('should return target when found', async () => {
    const ctx = createTestContext();
    const targets = [{ name: 'target1' }, { name: 'target2' }];
    const result = await resolveTarget('target1', 'install', ctx, () => Promise.resolve(targets));
    expect(result).toEqual({ name: 'target1' });
  });

  it('should throw RegistryError when target not found', async () => {
    const ctx = createTestContext();
    const targets = [{ name: 'target1' }, { name: 'target2' }];
    await expect(resolveTarget('target3', 'install', ctx, () => Promise.resolve(targets)))
      .rejects.toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: target "target3" is not configured',
        hint: 'Configured targets: target1, target2.',
        context: { target: 'target3' }
      }));
  });

  it('should throw RegistryError with correct hint when no targets configured', async () => {
    const ctx = createTestContext();
    await expect(resolveTarget('my-target', 'uninstall', ctx, () => Promise.resolve([])))
      .rejects.toThrowError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'uninstall: target "my-target" is not configured',
        hint: 'Run `prompt-registry target add <name> --type <kind>` to add one.',
        context: { target: 'my-target' }
      }));
  });
});
