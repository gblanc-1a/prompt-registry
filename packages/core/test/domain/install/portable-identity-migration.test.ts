import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  classifyLegacyIdentity,
  legacyIdentityRetentionKey,
  planIdentityMappings,
  sourceKey,
} from '../../../src';
import type {
  LegacyIdentityInput,
  PortableSourceDescriptor,
} from '../../../src';

const githubSource: PortableSourceDescriptor = {
  type: 'github',
  identity: {
    kind: 'github-releases',
    origin: 'https://github.com',
    repositoryId: '12345'
  },
  locator: 'https://github.com/acme/agents'
};

const proven = {
  source: githubSource,
  logicalBundleId: 'reviewer'
};

describe('classifyLegacyIdentity', () => {
  it('maps only a supplied, valid source and manifest identity while preserving known pins', () => {
    const resolution = {
      kind: 'unpinned' as const,
      reason: 'The historical release metadata was incomplete.',
      evidence: { knownDigests: { archiveSha256: 'a'.repeat(64) } }
    };
    const result = classifyLegacyIdentity({
      legacyKey: 'machine-source/reviewer@1.2.0',
      sourceId: 'machine-source',
      descriptor: { type: 'github', url: 'https://github.com/acme/agents' },
      version: '1.2.0',
      knownResolution: resolution,
      proven
    });

    expect(result).toEqual({
      kind: 'mapped',
      key: `${sourceKey(githubSource.identity, githubSource.type)}/reviewer`,
      source: githubSource,
      resolution
    });
  });

  it('retains a plausible legacy URL and namespaced runtime ID when verified identity is absent', () => {
    const result = classifyLegacyIdentity({
      legacyKey: 'machine-source/acme.review.agent@1.2.0',
      sourceId: 'machine-source',
      descriptor: { type: 'github', url: 'https://github.com/acme/agents' },
      version: '1.2.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind !== 'unresolved') {
      return;
    }
    expect(result.desired.originalKey).toBe('machine-source/acme.review.agent@1.2.0');
    expect(result.desired.sourceRef).toBe('machine-source');
    expect(result.desired.version).toBe('1.2.0');
    expect(result.desired.reason).toMatch(/verified|proven/i);
    expect(result.desired.descriptor?.locator).toBe('https://github.com/acme/agents');
  });

  it('does not fabricate provider IDs from a descriptor that only names a repository URL', () => {
    const result = classifyLegacyIdentity({
      legacyKey: 'local-id/agent',
      sourceId: 'local-id',
      descriptor: { type: 'github', url: 'https://github.com/acme/agents' },
      version: '1.0.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.evidence.portableDescriptor).toBeUndefined();
    }
  });

  it('drops credential-bearing descriptor data from shared unresolved evidence', () => {
    const result = classifyLegacyIdentity({
      legacyKey: 'secret-source/agent',
      sourceId: 'secret-source',
      descriptor: {
        type: 'github',
        url: 'https://user:password@github.com/acme/agents?api_key=secret',
        token: 'secret',
        localRoot: '/Users/alice/agents'
      },
      originalLocalRoot: '/Users/alice/agents',
      version: '1.0.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      const sharedEvidence = JSON.stringify(result.desired);
      expect(sharedEvidence).not.toContain('user:password');
      expect(sharedEvidence).not.toContain('api_key=secret');
      expect(sharedEvidence).not.toContain('/Users/alice');
      expect(result.desired.descriptor?.locator).toBeUndefined();
      expect(result.evidence.originalLocalRoot).toBe('/Users/alice/agents');
    }
  });

  it('rejects credential values in diagnostic source references', () => {
    const result = classifyLegacyIdentity({
      legacyKey: 'legacy-agent',
      sourceId: 'https://github.com/acme/agents?token=credential-placeholder',
      descriptor: {
        type: 'github',
        url: 'https://github.com/acme/agents'
      },
      version: '1.0.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.desired.sourceRef).toBeUndefined();
      expect(JSON.stringify(result.desired)).not.toContain('credential-placeholder');
    }
  });

  it.each([
    {
      location: 'source reference',
      placement: 'direct',
      value: 'https://alice:credential-placeholder@github.com/acme/agents'
    },
    {
      location: 'source reference',
      placement: 'prefixed',
      value: 'imported from https://alice:credential-placeholder@github.com/acme/agents'
    },
    {
      location: 'selector',
      placement: 'direct',
      value: 'https://alice:credential-placeholder@github.com/acme/agents'
    },
    {
      location: 'selector',
      placement: 'prefixed',
      value: 'imported from https://alice:credential-placeholder@github.com/acme/agents'
    }
  ])('omits credential-bearing URLs in $placement $location values', ({ location, value }) => {
    const result = classifyLegacyIdentity({
      legacyKey: 'legacy-agent',
      sourceId: location === 'source reference' ? value : 'legacy-source',
      descriptor: {
        type: 'github',
        url: 'https://github.com/acme/agents',
        ref: location === 'selector' ? value : 'main'
      },
      version: '1.0.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.desired.sourceRef).toBe(location === 'selector' ? 'legacy-source' : undefined);
      expect(result.desired.descriptor?.selectors?.ref)
        .toBe(location === 'source reference' ? 'main' : undefined);
      expect(JSON.stringify(result.desired)).not.toContain('credential-placeholder');
    }
  });

  it('rejects credential values and arbitrary fields in shared selector evidence', () => {
    const result = classifyLegacyIdentity({
      legacyKey: 'legacy-agent',
      sourceId: 'legacy-source',
      descriptor: {
        type: 'github',
        url: 'https://github.com/acme/agents',
        ref: 'releases?api_key=credential-placeholder',
        customMetadata: 'unmodeled-selector'
      },
      version: '1.0.0'
    });

    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.desired.descriptor?.selectors).toBeUndefined();
      expect(JSON.stringify(result.desired)).not.toContain('credential-placeholder');
      expect(JSON.stringify(result.desired)).not.toContain('unmodeled-selector');
    }
  });
});

describe('planIdentityMappings', () => {
  it('maps aliases with canonical identity and artifact matches despite display-only locator and tag changes', () => {
    const firstResolution = {
      kind: 'pinned' as const,
      provider: 'github-release' as const,
      version: '1.0.0',
      releaseId: '77',
      assetId: '88',
      archiveSha256: 'a'.repeat(64),
      tag: 'v1.0.0'
    };
    const renamedSource: PortableSourceDescriptor = {
      ...githubSource,
      locator: 'https://github.com/acme/renamed-agents'
    };
    const result = planIdentityMappings([
      {
        legacyKey: 'old-a/reviewer',
        version: '1.0.0',
        knownResolution: firstResolution,
        proven: { source: githubSource, logicalBundleId: 'reviewer' }
      },
      {
        legacyKey: 'old-b/reviewer',
        version: '1.0.0',
        knownResolution: { ...firstResolution, tag: 'release-1.0.0' },
        proven: { source: renamedSource, logicalBundleId: 'reviewer' }
      }
    ]);

    expect(result.map((decision) => decision.kind)).toEqual(['mapped', 'mapped']);
    expect(result.map((decision) => decision.kind === 'mapped' && decision.source.locator))
      .toEqual(['https://github.com/acme/renamed-agents', 'https://github.com/acme/agents']);
    expect(result.map((decision) => decision.kind === 'mapped' && decision.resolution.kind === 'pinned'
      ? decision.resolution.tag
      : undefined))
      .toEqual(['release-1.0.0', 'v1.0.0']);
  });

  it('keeps aliases unresolved when release identity or archive digest differs', () => {
    const firstResolution = {
      kind: 'pinned' as const,
      provider: 'github-release' as const,
      version: '1.0.0',
      releaseId: '77',
      assetId: '88',
      archiveSha256: 'a'.repeat(64),
      tag: 'v1.0.0'
    };
    const result = planIdentityMappings([
      {
        legacyKey: 'old-a/reviewer',
        version: '1.0.0',
        knownResolution: firstResolution,
        proven
      },
      {
        legacyKey: 'old-b/reviewer',
        version: '1.0.0',
        knownResolution: {
          ...firstResolution,
          releaseId: '99',
          archiveSha256: 'b'.repeat(64),
          tag: 'v1.0.0'
        },
        proven
      }
    ]);

    expect(result.map((decision) => decision.kind)).toEqual(['unresolved', 'unresolved']);
  });

  it('retains every alias when different historical versions collapse to one portable key', () => {
    const inputs: LegacyIdentityInput[] = [
      { legacyKey: 'source/agent-v1', version: '1.0.0', proven },
      { legacyKey: 'source/agent-v2', version: '2.0.0', proven }
    ];

    const result = planIdentityMappings(inputs);

    expect(result).toHaveLength(2);
    expect(result.every((decision) => decision.kind === 'unresolved')).toBe(true);
    expect(result.map((decision) => decision.kind === 'unresolved' && decision.evidence.originalKey))
      .toEqual(['source/agent-v1', 'source/agent-v2']);
  });

  it('retains all candidates with contradictory stored and installed baselines', () => {
    const materialization = (checksum: string) => [{
      targetName: 'cursor-user',
      targetType: 'cursor' as const,
      baseDir: '/home/user/.cursor',
      files: [{ path: 'agents/reviewer.md', checksum, installedChecksum: `installed-${checksum}` }]
    }];
    const result = planIdentityMappings([
      { legacyKey: 'old-a/reviewer', version: '1.0.0', proven, materializations: materialization('archive-a') },
      { legacyKey: 'old-b/reviewer', version: '1.0.0', proven, materializations: materialization('archive-b') }
    ]);

    expect(result.every((decision) => decision.kind === 'unresolved')).toBe(true);
    const keys = result.flatMap((decision) =>
      decision.kind === 'unresolved' ? [legacyIdentityRetentionKey(decision.evidence)] : []
    );
    expect(new Set(keys).size).toBe(2);
  });

  it('treats conflicting MCP destinations as incompatible identity mappings', () => {
    const materialization = (configPath: string, server: string) => [{
      targetName: 'cursor-user',
      targetType: 'cursor' as const,
      baseDir: '/home/user/.cursor',
      files: [{ path: 'agents/reviewer.md', checksum: 'same', installedChecksum: 'same-installed' }],
      mcp: { configPath, servers: [server] }
    }];
    const result = planIdentityMappings([
      {
        legacyKey: 'old-a/reviewer',
        version: '1.0.0',
        proven,
        materializations: materialization('.config/first.json', 'first-server')
      },
      {
        legacyKey: 'old-b/reviewer',
        version: '1.0.0',
        proven,
        materializations: materialization('.config/second.json', 'second-server')
      }
    ]);

    expect(result.every((decision) => decision.kind === 'unresolved')).toBe(true);
  });

  it('uses each conflicting materialization projection in its local retention key', () => {
    const decision = classifyLegacyIdentity({
      legacyKey: 'old-source/reviewer',
      version: '1.0.0'
    });
    if (decision.kind !== 'unresolved') {
      throw new Error('Expected unproven identity to remain unresolved.');
    }
    const first = {
      targetName: 'cursor-user',
      targetType: 'cursor' as const,
      baseDir: '/home/user/.cursor',
      files: [{ path: 'agents/reviewer.md', checksum: 'baseline-a', installedChecksum: 'installed-a' }]
    };
    const second = {
      ...first,
      files: [{ path: 'agents/reviewer.md', checksum: 'baseline-b', installedChecksum: 'installed-b' }]
    };

    expect(legacyIdentityRetentionKey(decision.evidence, first))
      .not.toBe(legacyIdentityRetentionKey(decision.evidence, second));
  });

  it('does not collapse same-basename local roots into one identity or retention key', () => {
    const localSource: PortableSourceDescriptor = {
      type: 'local',
      identity: { kind: 'external-local', bindingName: 'shared-catalog' },
      locator: 'shared-catalog'
    };
    const localProven = { source: localSource, logicalBundleId: 'agent' };
    const result = planIdentityMappings([
      {
        legacyKey: 'machine-a/agent',
        originalLocalRoot: '/home/alice/catalog',
        version: '1.0.0',
        proven: localProven
      },
      {
        legacyKey: 'machine-b/agent',
        originalLocalRoot: '/opt/bob/catalog',
        version: '1.0.0',
        proven: localProven
      }
    ]);

    expect(result.every((decision) => decision.kind === 'unresolved')).toBe(true);
    const evidence = result.map((decision) => {
      if (decision.kind !== 'unresolved') {
        throw new Error('Expected conflicting local roots to remain unresolved.');
      }
      return decision.evidence;
    });
    expect(new Set(evidence.map((item) => legacyIdentityRetentionKey(item))).size).toBe(2);
    expect(evidence.map((item) => item.originalLocalRoot)).toEqual([
      '/home/alice/catalog',
      '/opt/bob/catalog'
    ]);
  });

  it('keeps distinct unresolved versions on distinct reserved keys', () => {
    const first = classifyLegacyIdentity({
      legacyKey: 'old-source/agent',
      version: '1.0.0'
    });
    const second = classifyLegacyIdentity({
      legacyKey: 'old-source/agent',
      version: '2.0.0'
    });

    expect(first.kind).toBe('unresolved');
    expect(second.kind).toBe('unresolved');
    if (first.kind === 'unresolved' && second.kind === 'unresolved') {
      expect(legacyIdentityRetentionKey(first.evidence))
        .not.toBe(legacyIdentityRetentionKey(second.evidence));
    }
  });
});
