/**
 * Install/Uninstall command tests - verifies CLI options are properly recognized
 * by the class-based command implementations.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  InstallCommand,
} from '../../src/commands/install';
import {
  UninstallCommand,
} from '../../src/commands/uninstall';
import {
  runCommand,
} from '../../src/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

describe('install/uninstall commands - CLI option recognition', () => {
  const context = { cwd: '/tmp', fs: createNodeFsAdapter(), env: {} };

  describe('install', () => {
    it('recognizes -o/--output option', async () => {
      const { stderr } = await runCommand(
        ['install', '-o', 'json'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      // Should not produce "Unsupported option name" error
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --from option', async () => {
      const { stderr } = await runCommand(
        ['install', '--from', '/tmp/bundle'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --lockfile option', async () => {
      const { stderr } = await runCommand(
        ['install', '--lockfile', '/tmp/lockfile.json'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --target option', async () => {
      const { stderr } = await runCommand(
        ['install', '--target', 'my-target'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --source option', async () => {
      const { stderr } = await runCommand(
        ['install', '--source', 'owner/repo'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --interactive option', async () => {
      const { stderr } = await runCommand(
        ['install', '--interactive'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --dry-run option', async () => {
      const { stderr } = await runCommand(
        ['install', '--dry-run'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --scope option', async () => {
      const { stderr } = await runCommand(
        ['install', '--scope', 'user'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --commit-mode option', async () => {
      const { stderr } = await runCommand(
        ['install', '--commit-mode', 'commit'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --verbose option', async () => {
      const { stderr } = await runCommand(
        ['install', '--verbose'],
        {
          commandClasses: [InstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });
  });

  describe('uninstall', () => {
    it('recognizes -o/--output option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '-o', 'json'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      // Should not produce "Unsupported option name" error
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --bundle option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--bundle', 'test-bundle'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --lockfile option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--lockfile', '/tmp/lockfile.json'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --target option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--target', 'my-target'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --all option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--all'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --dry-run option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--dry-run'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --scope option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--scope', 'user'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });

    it('recognizes --commit-mode option', async () => {
      const { stderr } = await runCommand(
        ['uninstall', '--commit-mode', 'commit'],
        {
          commandClasses: [UninstallCommand],
          context
        }
      );
      expect(stderr).not.toMatch(/Unsupported option name/);
    });
  });
});
