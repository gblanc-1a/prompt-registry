import {
  Command,
  Option,
} from 'clipanion';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  ConfigGetCommand,
} from '../../src/commands/config-get';
import {
  InitCommand,
} from '../../src/commands/init';
import {
  runCli,
  runCommand,
} from '../../src/framework';
import {
  createProductionContext,
} from '../../src/framework/production-context';
import {
  createTestContext,
} from '../../src/framework/test-context';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

class ThrowingCommand extends Command {
  public static readonly paths = [['throw-test']];
  public output = Option.String('-o,--output');
  public execute(): never {
    throw new TypeError('unexpected internal error');
  }
}

describe('cli framework - runCommandClass edge paths', () => {
  it('defaultOutput applied when command has no explicit -o flag', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli(['config', 'get', 'nonexistent'], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [ConfigGetCommand],
      defaultOutput: 'json'
    });
    expect(result).toBe(0);
    expect(ctx.stdout.captured().length).toBeGreaterThan(0);
  });

  it('--help on a native class command exits 0 and prints usage', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', '--help'],
      {
        commandClasses: [ConfigGetCommand],
        context: { cwd: '/tmp', fs: createNodeFsAdapter(), env: {} }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/config.*get|key/i);
  });

  it('exit code 70 when execute() throws a non-UsageError', async () => {
    const { exitCode, stderr } = await runCommand(
      ['throw-test'],
      {
        commandClasses: [ThrowingCommand],
        context: { cwd: '/tmp', fs: createNodeFsAdapter(), env: {} }
      }
    );
    expect(exitCode).toBe(70);
    expect(stderr).toMatch(/unexpected internal error/);
  });
});

describe('cli framework - global help renderer', () => {
  it('bare invocation renders custom landing page with categories', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli([], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [ConfigGetCommand, InitCommand]
    });
    expect(result).toBe(0);
    const out = ctx.stdout.captured();
    expect(out).toMatch(/test 0\.0\.0/);
    expect(out).toMatch(/Getting Started/);
    expect(out).toMatch(/Configure & Debug/);
    expect(out).toMatch(/init/);
    expect(out).toMatch(/config get/);
  });

  it('top-level --help renders custom landing page', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli(['--help'], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [ConfigGetCommand, InitCommand]
    });
    expect(result).toBe(0);
    expect(ctx.stdout.captured()).toMatch(/Getting Started/);
  });

  it('top-level -h renders custom landing page', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli(['-h'], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [ConfigGetCommand, InitCommand]
    });
    expect(result).toBe(0);
    expect(ctx.stdout.captured()).toMatch(/Getting Started/);
  });
});

describe('cli framework - command suggestions', () => {
  it('suggests a close command match for a typo', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli(['int'], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [InitCommand]
    });
    expect(result).toBe(64);
    expect(ctx.stderr.captured()).toMatch(/Did you mean: init/);
  });

  it('does not suggest when the typo is too far', async () => {
    const ctx = createTestContext({ cwd: '/tmp', fs: createNodeFsAdapter(), env: {} });
    const result = await runCli(['zzzzz'], {
      ctx,
      name: 'test',
      version: '0.0.0',
      commands: [],
      commandClasses: [InitCommand]
    });
    expect(result).toBe(64);
    expect(ctx.stderr.captured()).not.toMatch(/Did you mean/);
  });
});

describe('cli framework - color depth', () => {
  it('test context has colorDepth 0', () => {
    const ctx = createTestContext();
    expect(ctx.colorDepth).toBe(0);
  });

  it('production context respects NO_COLOR', () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const ctx = createProductionContext();
    expect(ctx.colorDepth).toBe(0);
    if (original === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  });
});
