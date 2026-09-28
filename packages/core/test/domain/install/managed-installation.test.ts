/**
 * Tests for domain/install/managed-installation.ts — explicit record identity,
 * offline repository-identity derivation, artifact bookkeeping, and claim-state
 * legality (BR3.1, BR3.2, BR3.6, BR4.3).
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  DestinationClaimState,
  ManagedArtifact,
  ManagedInstallation,
} from '../../../src/domain/install/managed-installation';
import {
  artifactAt,
  claimBlocksOtherWriters,
  deriveClaimKey,
  deriveInstallationKey,
  deriveRepositoryIdentity,
  isLegalClaimTransition,
  isSameInstallation,
  normaliseRemoteUrl,
  withArtifact,
  withoutArtifact,
} from '../../../src/domain/install/managed-installation';

const artifact = (overrides: Partial<ManagedArtifact> = {}): ManagedArtifact => ({
  destinationPath: '/home/u/.copilot/prompts/a.md',
  itemKind: 'prompt',
  installedFingerprint: `sha256:${'a'.repeat(64)}`,
  sizeInBytes: 12,
  ...overrides
});

const installation = (overrides: Partial<ManagedInstallation> = {}): ManagedInstallation => ({
  installationKey: deriveInstallationKey({ bundleId: 'acme', target: 'copilot', scope: 'user' }),
  bundleId: 'acme',
  target: 'copilot',
  scope: 'user',
  manifestVersion: '1.2.3',
  installedAt: '2026-09-28T00:00:00.000Z',
  artifacts: [artifact()],
  ...overrides
});

describe('deriveInstallationKey (BR3.1)', () => {
  it('is stable for the same identity', () => {
    const identity = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;

    expect(deriveInstallationKey(identity)).toBe(deriveInstallationKey({ ...identity }));
  });

  it('distinguishes bundle, target, scope, and repository identity', () => {
    const base = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;
    const keys = new Set([
      deriveInstallationKey(base),
      deriveInstallationKey({ ...base, bundleId: 'other' }),
      deriveInstallationKey({ ...base, target: 'kiro' }),
      deriveInstallationKey({ ...base, scope: 'repository' }),
      deriveInstallationKey({
        ...base,
        scope: 'repository',
        repositoryIdentity: { identityValue: 'github.com/acme/repo' }
      })
    ]);

    expect(keys.size).toBe(5);
  });

  it('cannot be forged by a value containing the component separator', () => {
    const forged = deriveInstallationKey({ bundleId: 'acme|copilot', target: 'user', scope: 'user' });
    const genuine = deriveInstallationKey({ bundleId: 'acme', target: 'copilot', scope: 'user' });

    expect(forged).not.toBe(genuine);
  });

  it('answers whether two identities name the same installation', () => {
    const left = { bundleId: 'acme', target: 'copilot', scope: 'user' } as const;

    expect(isSameInstallation(left, { ...left })).toBe(true);
    expect(isSameInstallation(left, { ...left, target: 'kiro' })).toBe(false);
  });
});

describe('deriveRepositoryIdentity (BR3.2)', () => {
  it('prefers the normalised canonical remote URL', () => {
    const identity = deriveRepositoryIdentity({
      canonicalRemoteUrl: 'https://GitHub.com/Acme/Repo.git',
      workspaceRootPath: '/work/repo'
    });

    expect(identity?.identityValue).toBe('github.com/Acme/Repo');
    expect(identity?.workspaceRootPath).toBe('/work/repo');
  });

  it('falls back to the absolute workspace root when there is no remote', () => {
    const identity = deriveRepositoryIdentity({ workspaceRootPath: '/work/repo' });

    expect(identity?.identityValue).toBe('/work/repo');
    expect(identity?.canonicalRemoteUrl).toBeUndefined();
  });

  it('returns null when neither fact is available', () => {
    expect(deriveRepositoryIdentity({})).toBeNull();
    expect(deriveRepositoryIdentity({ canonicalRemoteUrl: '', workspaceRootPath: '' })).toBeNull();
  });

  it('keys SSH and HTTPS forms of one repository to the same value', () => {
    expect(normaliseRemoteUrl('git@github.com:acme/repo.git'))
      .toBe(normaliseRemoteUrl('https://github.com/acme/repo'));
  });

  it('never keeps userinfo, so a token can never be persisted', () => {
    const identity = deriveRepositoryIdentity({
      canonicalRemoteUrl: 'https://user:ghp_secret@github.com/acme/repo.git'
    });

    expect(identity?.identityValue).toBe('github.com/acme/repo');
    expect(JSON.stringify(identity)).not.toContain('ghp_secret');
  });
});

describe('artifact bookkeeping', () => {
  it('finds an artifact by destination path', () => {
    expect(artifactAt(installation(), '/home/u/.copilot/prompts/a.md')?.itemKind).toBe('prompt');
    expect(artifactAt(installation(), '/home/u/.copilot/prompts/missing.md')).toBeUndefined();
  });

  it('replaces an artifact at the same destination rather than duplicating it', () => {
    const updated = withArtifact(installation(), artifact({ installedFingerprint: `sha256:${'b'.repeat(64)}` }));

    expect(updated.artifacts).toHaveLength(1);
    expect(updated.artifacts[0]?.installedFingerprint).toBe(`sha256:${'b'.repeat(64)}`);
  });

  it('drops an artifact so a later uninstall cannot touch it (BR4.3)', () => {
    const preserved = withoutArtifact(installation(), '/home/u/.copilot/prompts/a.md');

    expect(preserved.artifacts).toStrictEqual([]);
  });
});

describe('destination claims (BR3.6)', () => {
  it('keys a claim by target, scope, and destination', () => {
    expect(deriveClaimKey('copilot', 'user', '/t/a.md'))
      .not.toBe(deriveClaimKey('copilot', 'repository', '/t/a.md'));
    expect(deriveClaimKey('copilot', 'user', '/t/a.md'))
      .toBe(deriveClaimKey('copilot', 'user', '/t/a.md'));
  });

  it('allows only the legal claim transitions', () => {
    expect(isLegalClaimTransition('claimed', 'pending-materialization')).toBe(true);
    expect(isLegalClaimTransition('pending-materialization', 'finalized')).toBe(true);
    expect(isLegalClaimTransition('pending-materialization', 'rollback-required')).toBe(true);
    expect(isLegalClaimTransition('rollback-required', 'claimed')).toBe(true);
    expect(isLegalClaimTransition('finalized', 'pending-materialization')).toBe(true);
  });

  it('never lets a pending materialization silently return to claimed', () => {
    expect(isLegalClaimTransition('pending-materialization', 'claimed')).toBe(false);
  });

  it('blocks other writers while a claim is pending or unresolved', () => {
    const base = {
      claimId: 'c1',
      target: 'copilot',
      scope: 'user',
      destinationPath: '/t/a.md',
      ownerInstallation: 'k1',
      generation: 1,
      updatedAt: '2026-09-28T00:00:00.000Z'
    } as const;
    const states: DestinationClaimState[] = ['claimed', 'pending-materialization', 'finalized', 'rollback-required'];

    const blocking = states.filter((state) => claimBlocksOtherWriters({ ...base, state }));

    expect(blocking).toStrictEqual(['pending-materialization', 'rollback-required']);
  });
});
