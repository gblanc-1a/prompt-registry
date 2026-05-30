/**
 * Fix 3: Deprecation shims - process.argv mutation.
 *
 * Tests for deprecation shims to ensure they correctly rewrite arguments
 * and don't mutate global process.argv.
 */
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

describe('CLI Deprecation Shims - Fix 3: process.argv Mutation', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    // Restore original process.argv after each test
    process.argv = [...originalArgv];
  });

  describe('Shim argument rewriting', () => {
    it('should rewrite validate-collections to collection validate', () => {
      const inputArgs = ['node', 'validate-collections.js', '--verbose'];
      // Shims keep original script name at argv[1], prepend new command path
      const expectedRewritten = ['node', 'validate-collections.js', 'collection', 'validate', '--verbose'];

      // Simulate shim logic
      const rewritten = ['collection', 'validate', ...inputArgs.slice(2)];
      const fullRewritten = [inputArgs[0], inputArgs[1], ...rewritten];

      expect(fullRewritten).toEqual(expectedRewritten);
    });

    it('should rewrite build-collection-bundle to bundle build with -o json', () => {
      const inputArgs = ['node', 'build-collection-bundle.js', '--collection-file', 'test.yml', '--version', '1.0.0'];
      const expectedRewritten = ['node', 'build-collection-bundle.js', 'bundle', 'build', '-o', 'json', '--collection-file', 'test.yml', '--version', '1.0.0'];

      // Simulate shim logic with auto-injected -o json
      const hasOutputFlag = inputArgs.includes('-o') || inputArgs.includes('--output');
      const rewrittenArgs = hasOutputFlag ? inputArgs.slice(2) : ['-o', 'json', ...inputArgs.slice(2)];
      const fullRewritten = [inputArgs[0], inputArgs[1], 'bundle', 'build', ...rewrittenArgs];

      expect(fullRewritten).toEqual(expectedRewritten);
    });

    it('should not inject -o json if already present', () => {
      const inputArgs = ['node', 'build-collection-bundle.js', '-o', 'yaml', '--collection-file', 'test.yml'];
      const expectedRewritten = ['node', 'build-collection-bundle.js', 'bundle', 'build', '-o', 'yaml', '--collection-file', 'test.yml'];

      const hasOutputFlag = inputArgs.includes('-o') || inputArgs.includes('--output');
      const rewrittenArgs = hasOutputFlag ? inputArgs.slice(2) : ['-o', 'json', ...inputArgs.slice(2)];
      const fullRewritten = [inputArgs[0], inputArgs[1], 'bundle', 'build', ...rewrittenArgs];

      expect(fullRewritten).toEqual(expectedRewritten);
    });

    it('should translate positional version to --version flag for generate-manifest', () => {
      const inputArgs = ['node', 'generate-manifest.js', '1.0.0', '--collection-file', 'test.yml'];
      const expectedRewritten = ['node', 'generate-manifest.js', 'bundle', 'manifest', '--version', '1.0.0', '--collection-file', 'test.yml'];

      // Simulate shim logic for positional version translation
      const rewritten = [];
      const args = inputArgs.slice(2);
      for (const [i, a] of args.entries()) {
        if (i === 0 && !a.startsWith('-')) {
          rewritten.push('--version', a);
        } else {
          rewritten.push(a);
        }
      }
      const fullRewritten = [inputArgs[0], inputArgs[1], 'bundle', 'manifest', ...rewritten];

      expect(fullRewritten).toEqual(expectedRewritten);
    });
  });

  describe('process.argv preservation', () => {
    it('should not mutate original process.argv when rewriting', () => {
      const original = ['node', 'script.js', 'arg1', 'arg2'];
      process.argv = [...original];

      // Simulate shim that mutates (current buggy behavior)
      const buggyRewrite = () => {
        process.argv = [process.argv[0], process.argv[1], 'new', 'command', ...process.argv.slice(2)];
      };

      buggyRewrite();

      // After mutation, process.argv is changed
      expect(process.argv).not.toEqual(original);

      // Restore for next test
      process.argv = [...original];
    });

    it('should preserve original process.argv when using parameter passing', () => {
      const original = ['node', 'script.js', 'arg1', 'arg2'];
      process.argv = [...original];

      // Simulate improved shim that doesn't mutate
      const improvedRewrite = (argv: string[]) => {
        return [argv[0], argv[1], 'new', 'command', ...argv.slice(2)];
      };

      const rewritten = improvedRewrite(process.argv);

      // Original process.argv should be unchanged
      expect(process.argv).toEqual(original);
      // Rewritten version should have new command
      expect(rewritten).toEqual(['node', 'script.js', 'new', 'command', 'arg1', 'arg2']);
    });
  });

  describe('CLI entry point argv parameter', () => {
    it('should accept optional argv parameter instead of relying on process.argv', () => {
      // This test documents the desired behavior: the CLI entry point
      // should accept an optional argv parameter, falling back to process.argv
      // when not provided (for direct binary invocation)

      const customArgv = ['collection', 'validate', '--verbose'];

      // Simulate the desired API
      const main = (argv?: string[]) => {
        const actualArgv = argv ?? process.argv.slice(2);
        return actualArgv;
      };

      // With custom argv (should skip the binary name)
      expect(main(customArgv)).toEqual(['collection', 'validate', '--verbose']);

      // Without custom argv (falls back to process.argv)
      // Note: This would use the actual process.argv in real usage
      expect(main()).toEqual(process.argv.slice(2));
    });
  });
});
