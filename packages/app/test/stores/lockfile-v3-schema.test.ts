import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  describe,
  expect,
  it,
} from 'vitest';

const NOW = '2026-10-09T12:00:00.000Z';
const SOURCE_KEY = 'src-2cb1d562d89c91736315d553fae7344944e240230121f4191354c32f76495503';
const BUNDLE_KEY = `${SOURCE_KEY}/web-dev`;
const schemaPath = path.join(__dirname, '../../../core/src/public/schemas/lockfile-v3.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const githubSource = {
  type: 'github',
  identity: {
    kind: 'github-releases',
    origin: 'https://github.com',
    repositoryId: '12345'
  },
  locator: 'https://github.com/example/repo'
};

const desired = (resolution: Record<string, unknown>, source = githubSource) => ({
  $schema: 'https://github.com/AmadeusITGroup/ai-primitives-hub/schemas/lockfile-v3.schema.json',
  version: '3.0.0',
  sources: { [SOURCE_KEY]: source },
  bundles: {
    [BUNDLE_KEY]: {
      version: '1.0.0',
      sourceKey: SOURCE_KEY,
      resolution
    }
  }
});

const local = () => ({
  version: '3.0.0',
  generatedAt: NOW,
  generatedBy: 'ai-primitives-hub-cli',
  targets: {
    'my-vscode': {
      targetType: 'vscode',
      scope: 'user',
      baseDir: '/home/u/.copilot',
      bundles: {
        [BUNDLE_KEY]: {
          version: '1.0.0',
          sourceKey: SOURCE_KEY,
          resolution: {
            kind: 'pinned',
            provider: 'github-release',
            version: '1.0.0',
            releaseId: '123',
            assetId: '456',
            archiveSha256: 'a'.repeat(64)
          },
          installedAt: NOW,
          files: [{ path: 'prompts/hello.prompt.md', installedChecksum: 'b'.repeat(64) }]
        }
      }
    }
  }
});

const releasePin = {
  kind: 'pinned',
  provider: 'github-release',
  version: '1.0.0',
  releaseId: '123',
  assetId: '456',
  archiveSha256: 'a'.repeat(64),
  tag: 'v1.0.0'
};

const resolutionExamples = [
  ['GitHub release pin', releasePin],
  ['GitHub tree pin', {
    kind: 'pinned',
    provider: 'github-tree',
    version: '1.0.0',
    commitSha: 'c'.repeat(40),
    bundlePath: 'collections/web-dev',
    sourceContentSha256: 'd'.repeat(64),
    externalInputs: [{ identity: 'shared/prompts', sourceContentSha256: 'e'.repeat(64) }]
  }],
  ['Azure DevOps tree pin', {
    kind: 'pinned',
    provider: 'azure-devops-tree',
    version: '1.0.0',
    commitId: 'f'.repeat(40),
    collectionPath: 'collections/web-dev',
    sourceContentSha256: 'd'.repeat(64)
  }],
  ['Artifactory object pin', {
    kind: 'pinned',
    provider: 'artifactory-object',
    version: '1.0.0',
    manifestPath: 'bundles/web-dev/manifest.yml',
    manifestSize: 120,
    manifestSha256: 'a'.repeat(64),
    archivePath: 'bundles/web-dev/archive.zip',
    archiveSize: 1024,
    archiveSha256: 'b'.repeat(64)
  }],
  ['local snapshot pin', {
    kind: 'pinned',
    provider: 'local-snapshot',
    version: '1.0.0',
    bundleSelector: 'collections/web-dev',
    sourceContentSha256: 'c'.repeat(64)
  }],
  ['live selection', {
    kind: 'live',
    selector: 'skills/my-skill'
  }],
  ['unpinned historical evidence', {
    kind: 'unpinned',
    reason: 'The original provider pin was unavailable during migration.',
    evidence: {
      knownDigests: { archiveSha256: 'a'.repeat(64) },
      manifestVersion: '1.0.0'
    }
  }]
] as const;

describe('lockfile v3 schema', () => {
  it.each(resolutionExamples)('accepts the %s resolution shape', (_name, resolution) => {
    expect(validate(desired(resolution))).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('accepts a strict managed local record and an unmanaged record with migration evidence', () => {
    const managedLocal = local();
    const unmanaged = local();
    const bundles = unmanaged.targets['my-vscode'].bundles;
    delete bundles[BUNDLE_KEY];
    bundles[`unresolved/${'e'.repeat(64)}`] = {
      version: '1.0.0',
      installedAt: NOW,
      state: 'unmanaged',
      unmanagedReason: 'No portable identity could be proven.',
      legacy: {
        originalKey: 'legacy-source/web-dev',
        sourceRef: 'legacy-source',
        version: '1.0.0',
        descriptor: { type: 'github', locator: 'https://github.com/example/repo' }
      },
      files: [{ path: 'prompts/hello.prompt.md' }]
    };

    expect(validate(managedLocal)).toBe(true);
    expect(validate(unmanaged)).toBe(true);

    const activeUnmanaged = local();
    activeUnmanaged.targets['my-vscode'].bundles[BUNDLE_KEY] = {
      version: '1.0.0',
      installedAt: NOW,
      state: 'unmanaged',
      unmanagedReason: 'No portable identity could be proven.',
      legacy: { originalKey: 'legacy-source/web-dev', version: '1.0.0' },
      files: [{ path: 'prompts/hello.prompt.md' }]
    } as never;
    expect(validate(activeUnmanaged)).toBe(false);
  });

  it('rejects active sourceId and legacy references outside migration evidence', () => {
    const activeDesired = desired(releasePin);
    (activeDesired.bundles[BUNDLE_KEY] as Record<string, unknown>).sourceId = 'legacy-source';
    expect(validate(activeDesired)).toBe(false);

    const activeLocal = local();
    (activeLocal.targets['my-vscode'].bundles[BUNDLE_KEY] as Record<string, unknown>).sourceId = 'legacy-source';
    expect(validate(activeLocal)).toBe(false);

    const activeLegacyRef = desired(releasePin);
    (activeLegacyRef.bundles[BUNDLE_KEY] as Record<string, unknown>).sourceRef = 'legacy-source';
    expect(validate(activeLegacyRef)).toBe(false);

    const migrationEvidence = {
      ...desired(releasePin),
      unresolved: [{
        originalKey: 'legacy-source/web-dev',
        sourceRef: 'legacy-source',
        descriptor: { type: 'github', locator: 'https://github.com/example/repo' },
        version: '1.0.0',
        reason: 'The portable source identity could not be proven.'
      }]
    };
    expect(validate(migrationEvidence)).toBe(true);
  });

  it('rejects malformed resolution variants and pin digests', () => {
    expect(validate(desired({ kind: 'pinned', provider: 'unknown', version: '1.0.0' }))).toBe(false);
    expect(validate(desired({ ...releasePin, archiveSha256: 'not-a-digest' }))).toBe(false);
    expect(validate(desired({
      kind: 'pinned',
      provider: 'github-tree',
      version: '1.0.0',
      commitSha: 'c'.repeat(40),
      bundlePath: 'collections/web-dev',
      sourceContentSha256: 'invalid'
    }))).toBe(false);
  });

  it('requires numeric GitHub IDs and UUID Azure repository IDs', () => {
    const nonNumericGithub = {
      ...githubSource,
      identity: { ...githubSource.identity, repositoryId: 'owner/repo' }
    };
    expect(validate(desired(releasePin, nonNumericGithub))).toBe(false);

    const azureSource = {
      type: 'azure-devops',
      identity: {
        kind: 'azure-devops-tree',
        namespace: 'org/project',
        repositoryId: '12345678-1234-1234-1234-123456789abc',
        ref: 'main',
        collectionsPath: 'collections'
      },
      locator: 'https://dev.azure.com/org/project/_git/repo'
    };
    expect(validate(desired({
      kind: 'pinned',
      provider: 'azure-devops-tree',
      version: '1.0.0',
      commitId: 'a'.repeat(40),
      collectionPath: 'collections/web-dev',
      sourceContentSha256: 'b'.repeat(64)
    }, azureSource))).toBe(true);
    expect(validate(desired(releasePin, {
      ...azureSource,
      identity: { ...azureSource.identity, repositoryId: 'not-a-uuid' }
    }))).toBe(false);
  });

  it('accepts portable workspace roots and external source bindings', () => {
    expect(validate(desired(releasePin, {
      type: 'local',
      identity: { kind: 'workspace-local', root: '.' },
      locator: '.'
    }))).toBe(true);
    expect(validate(desired(releasePin, {
      type: 'local',
      identity: { kind: 'external-local', bindingName: 'team-source' },
      locator: 'team-source'
    }))).toBe(true);
  });

  it('rejects absolute local locators, secret config fields, unknown sources, and secret evidence', () => {
    expect(validate(desired(releasePin, {
      type: 'local',
      identity: { kind: 'workspace-local', root: '/Users/alice/project' },
      locator: '/Users/alice/project'
    }))).toBe(false);

    const secretConfig = {
      ...githubSource,
      config: { authMode: 'bearer', credentialRef: 'keychain://hub/token', apiToken: 'secret-value' }
    };
    expect(validate(desired(releasePin, secretConfig))).toBe(false);

    const unknownSource = { ...githubSource, type: 'unknown' };
    expect(validate(desired(releasePin, unknownSource))).toBe(false);

    const secretEvidence = {
      ...desired(releasePin),
      unresolved: [{
        originalKey: 'legacy-source/web-dev',
        version: '1.0.0',
        reason: 'Unresolved.',
        descriptor: { password: 'secret-value' }
      }]
    };
    expect(validate(secretEvidence)).toBe(false);
  });
});
