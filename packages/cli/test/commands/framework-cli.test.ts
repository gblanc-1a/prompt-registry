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
  runCli,
  runCommand,
} from '../../src/framework';
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
