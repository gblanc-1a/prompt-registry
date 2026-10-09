import Ajv from 'ajv';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  classifyLockfileVersion,
  lockfileVersionErrorMessage,
} from '../../../src/domain/install/lockfile-version';
import lockfileV3Schema from '../../../src/public/schemas/lockfile-v3.schema.json';
import lockfileSchema from '../../../src/public/schemas/lockfile.schema.json';

describe('classifyLockfileVersion', () => {
  it('accepts the two known majors', () => {
    expect(classifyLockfileVersion('2.0.0')).toEqual({ kind: 'readable', major: 2 });
    expect(classifyLockfileVersion('3.0.0')).toEqual({ kind: 'readable', major: 3 });
  });

  it('accepts a higher minor or patch inside a known major', () => {
    expect(classifyLockfileVersion('3.4.1')).toEqual({ kind: 'readable', major: 3 });
  });

  it('reports an unknown major rather than coercing it', () => {
    expect(classifyLockfileVersion('4.0.0')).toEqual({ kind: 'unknown-major', major: 4 });
  });

  it('reports a malformed version instead of guessing', () => {
    expect(classifyLockfileVersion('two')).toEqual({ kind: 'malformed', raw: 'two' });
    expect(classifyLockfileVersion(2)).toEqual({ kind: 'malformed', raw: 2 });
    expect(classifyLockfileVersion(undefined)).toEqual({ kind: 'malformed', raw: undefined });
  });
});

describe('lockfileVersionErrorMessage', () => {
  it('names the file and tells the user what to do', () => {
    const message = lockfileVersionErrorMessage(
      '/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json',
      { kind: 'unknown-major', major: 4 }
    );

    expect(message).toContain('/home/u/.config/ai-primitives-hub/ai-primitives-hub.lock.json');
    expect(message).toContain('newer version of AI Primitives Hub');
    expect(message).toContain('unifiedDeploy');
  });
});

describe('lockfile 3.x wire-format schema', () => {
  const validate = new Ajv({ strict: false }).compile(lockfileV3Schema);

  it('accepts a desired-state file with no generated metadata', () => {
    expect(validate({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: { 'src/web-dev': { version: '1.0.0', sourceId: 'src' } },
      sources: { src: { type: 'local', url: '/tmp/x' } }
    })).toBe(true);
  });

  it('rejects a desired-state file carrying a local identifier', () => {
    expect(validate({
      $schema: 'x',
      version: '3.0.0',
      bundles: {},
      sources: {},
      targets: {}
    })).toBe(false);
  });

  it('accepts a local file with materialization only', () => {
    expect(validate({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      targets: {
        'my-vscode': {
          targetType: 'vscode',
          scope: 'user',
          baseDir: '/home/u/.copilot',
          bundles: {
            'src/web-dev': {
              version: '1.0.0',
              sourceId: 'src',
              installedAt: '2026-10-09T12:00:00.000Z',
              files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'a'.repeat(64) }]
            }
          }
        }
      }
    })).toBe(true);
  });

  it('rejects a local file with no generated metadata', () => {
    expect(validate({ version: '3.0.0', targets: {} })).toBe(false);
  });

  it('accepts a fully populated desired-state file', () => {
    expect(validate({
      $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
      version: '3.0.0',
      bundles: {
        'org/bundle': {
          version: '1.2.3',
          sourceId: 'github-src',
          archiveSha: 'a'.repeat(64)
        }
      },
      sources: {
        'github-src': {
          type: 'github',
          url: 'https://github.com/org/repo',
          branch: 'main',
          collectionsPath: 'collections'
        },
        'artifactory-src': {
          type: 'artifactory',
          url: 'https://artifactory.example.com',
          indexFile: 'index.json',
          authMode: 'bearer',
          credentialRef: 'cred-123'
        }
      },
      hubs: {},
      profiles: {}
    })).toBe(true);
  });

  it('accepts a fully populated local file with all migration fields', () => {
    expect(validate({
      version: '3.0.0',
      generatedAt: '2026-10-09T12:00:00.000Z',
      generatedBy: 'ai-primitives-hub-cli',
      migration: { lockfileV3: 'complete' },
      targets: {
        'workspace-vscode': {
          targetType: 'vscode-insiders',
          scope: 'workspace',
          baseDir: '/workspace/.copilot',
          commitMode: 'commit',
          bundles: {
            'org/bundle': {
              version: '1.2.3',
              sourceId: 'github-src',
              installedAt: '2026-10-09T12:00:00.000Z',
              commitMode: 'local-only',
              state: 'unmanaged',
              unmanagedReason: 'Provenance unclear during migration',
              linked: true,
              mcpConfigPath: '/path/to/mcp.json',
              mcpServers: { 'server-1': { command: 'server', args: [] } },
              complete: true,
              files: [
                {
                  path: 'prompts/example.prompt.md',
                  checksum: 'b'.repeat(64),
                  installedChecksum: 'c'.repeat(64),
                  adoptedAtMigration: true
                }
              ]
            }
          }
        }
      }
    })).toBe(true);
  });
});

describe('lockfile wire-format schema', () => {
  it('constrains version by pattern, not by an enum of one', () => {
    // §5.12 claims an enum rejects 3.0.0; it does not exist. The pattern
    // admits any semver, so the code-level gate above is the real guard.
    const version = lockfileSchema.properties.version as Record<string, unknown>;

    expect(version.enum).toBeUndefined();
    expect(version.pattern).toBe('^\\d+\\.\\d+\\.\\d+$');
    expect(version.examples).toContain('3.0.0');
  });

  it('keeps requiring the two generated fields, which is why v3 needs its own schema', () => {
    // A v3 desired-state file omits both (§5.2), at either scope, so it
    // cannot be validated against this file — hence lockfile-v3.schema.json
    // rather than a rewrite of this one.
    expect(lockfileSchema.required).toContain('generatedAt');
    expect(lockfileSchema.required).toContain('generatedBy');
  });
});
