/**
 * Domain layer — the shared installation registry model (U1).
 *
 * One logical record with two persistence locations: user-scope records in
 * shared application data, repository-scope records in the repository's own
 * lockfile. Identity is explicit — `bundleId`, `target`, `scope`, and an optional
 * `repositoryIdentity` are typed attributes, and `installationKey` is *derived*
 * from them rather than being the only representation of them (BR3.1, R-03). A
 * persistence adapter may leave implicit whatever its storage location already
 * determines, but nothing has to parse a key to learn what a record is about.
 *
 * `ManagedArtifact.installedFingerprint` covers the bytes **as written** to the
 * target, after any content transformation (BR3.3). That is what lets the
 * lifecycle tell its own content from content the user has since edited, and it
 * is the one thing an archive-side checksum could never do.
 *
 * `DestinationOwnershipClaim` is the durable reservation that serialises
 * competing lifecycle and migration writes to one destination, and carries
 * enough state for U1 — never a delivery adapter — to resolve an interrupted
 * hand-off (BR3.6).
 *
 * Pure domain: no IO, no framework imports.
 * @module domain/install/managed-installation
 */
import type {
  PrimitiveKind,
} from '../primitive/types';
import type {
  InstallationScope,
} from './types';

/**
 * Identifies the repository a repository-scope installation belongs to.
 *
 * Derived **offline** (BR3.2): the normalised canonical remote URL when the
 * repository has one, otherwise the absolute workspace root path. A stored
 * identity changes only through reconciliation on exactly one confirmed
 * redirect (BR6.1).
 */
export interface RepositoryIdentity {
  /** Normalised canonical remote; absent when the repository has no remote. */
  readonly canonicalRemoteUrl?: string;
  /** Absolute path; the identity only when no canonical remote exists. */
  readonly workspaceRootPath?: string;
  /** The value records are keyed by. */
  readonly identityValue: string;
}

/**
 * The explicit identity attributes of one managed installation.
 */
export interface ManagedInstallationIdentity {
  readonly bundleId: string;
  /** Supported-target name; participates in key derivation and isolation. */
  readonly target: string;
  readonly scope: InstallationScope;
  /** Required for repository scope; absent for user scope. */
  readonly repositoryIdentity?: RepositoryIdentity;
}

/**
 * One installed file the registry is accountable for.
 *
 * An artifact exists in a record only after its write was verified (BR3.5), and
 * an artifact whose current bytes differ from its fingerprint is treated as
 * locally changed and is never deleted by the lifecycle (BR4.2, BR4.7).
 */
export interface ManagedArtifact {
  /** Absolute destination path; unique within one managed installation. */
  readonly destinationPath: string;
  readonly itemKind: PrimitiveKind;
  /** SHA-256 over the exact byte sequence written, post-transform (BR3.3). */
  readonly installedFingerprint: string;
  readonly sizeInBytes: number;
}

/**
 * The record of one installed bundle at one target and scope.
 */
export interface ManagedInstallation extends ManagedInstallationIdentity {
  /** Derived from the identity attributes; see {@link deriveInstallationKey}. */
  readonly installationKey: string;
  readonly manifestVersion: string;
  readonly installedAt: string;
  /** Retained for identity matching across re-synchronisation. */
  readonly sourceId?: string;
  readonly artifacts: readonly ManagedArtifact[];
}

/**
 * Derive the lookup key for one managed installation.
 *
 * Stable, order-independent, and reversible by inspection: the same identity
 * always produces the same key, and two identities that differ in bundle,
 * target, scope, or repository produce different keys (BR3.1). Separators are
 * escaped so no component can forge another's boundary.
 * @param identity - The record's explicit identity attributes.
 * @returns The derived installation key.
 */
export function deriveInstallationKey(identity: ManagedInstallationIdentity): string {
  return [
    escapeKeyComponent(identity.bundleId),
    escapeKeyComponent(identity.target),
    escapeKeyComponent(identity.scope),
    escapeKeyComponent(identity.repositoryIdentity?.identityValue ?? '')
  ].join('|');
}

/**
 * Whether two identities name the same installation.
 * @param left - First identity.
 * @param right - Second identity.
 * @returns True when both derive the same installation key.
 */
export function isSameInstallation(
  left: ManagedInstallationIdentity,
  right: ManagedInstallationIdentity
): boolean {
  return deriveInstallationKey(left) === deriveInstallationKey(right);
}

/**
 * Derive a repository identity from local facts only.
 *
 * No network call participates (BR3.2). A remote URL is normalised — scheme and
 * host lower-cased, userinfo stripped so a token can never be persisted, a
 * trailing `.git` and trailing slashes removed — so the same repository reached
 * over SSH or HTTPS keys to one value.
 * @param facts - Canonical remote URL and/or absolute workspace root path.
 * @param facts.canonicalRemoteUrl
 * @param facts.workspaceRootPath
 * @returns The derived identity, or `null` when neither fact was supplied.
 */
export function deriveRepositoryIdentity(facts: {
  readonly canonicalRemoteUrl?: string;
  readonly workspaceRootPath?: string;
}): RepositoryIdentity | null {
  const remote = facts.canonicalRemoteUrl === undefined
    ? undefined
    : normaliseRemoteUrl(facts.canonicalRemoteUrl);
  const root = facts.workspaceRootPath === undefined || facts.workspaceRootPath.length === 0
    ? undefined
    : facts.workspaceRootPath;
  if (remote !== undefined && remote.length > 0) {
    return {
      canonicalRemoteUrl: remote,
      ...(root === undefined ? {} : { workspaceRootPath: root }),
      identityValue: remote
    };
  }
  if (root !== undefined) {
    return { workspaceRootPath: root, identityValue: root };
  }
  return null;
}

/**
 * Normalise a git remote URL into a stable identity value.
 *
 * Handles both URL and `scp`-style (`git@host:owner/repo.git`) forms. Userinfo
 * is always dropped: a remote may carry a token, and an identity is persisted
 * and reported.
 * @param raw - The repository's canonical remote URL.
 * @returns The normalised form, or an empty string when it cannot be parsed.
 */
export function normaliseRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const scpMatch = /^(?<user>[^@/]+)@(?<host>[^:/]+):(?<path>.+)$/.exec(trimmed);
  const withoutScheme = scpMatch?.groups === undefined
    ? stripScheme(trimmed)
    : `${scpMatch.groups.host}/${scpMatch.groups.path}`;
  const withoutUserinfo = withoutScheme.includes('@')
    ? withoutScheme.slice(withoutScheme.indexOf('@') + 1)
    : withoutScheme;
  const [hostPart, ...rest] = withoutUserinfo.split('/');
  const host = (hostPart ?? '').toLowerCase();
  const path = rest.join('/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return path.length === 0 ? host : `${host}/${path}`;
}

/**
 * The durable states of a destination-ownership claim.
 */
export type DestinationClaimState =
  | 'claimed'
  | 'pending-materialization'
  | 'finalized'
  | 'rollback-required';

/**
 * An explicit hand-off, without which one installation never takes a
 * destination another installation manages.
 */
export interface DestinationOwnershipHandoff {
  /** The exact destination being ceded. */
  readonly destinationPath: string;
  /** The installation giving it up. */
  readonly cedingInstallationKey: string;
  /** The installation taking it. */
  readonly acquiringInstallationKey: string;
}

/**
 * Durable U1-owned reservation and ownership record for one target, scope, and
 * destination path.
 */
export interface DestinationOwnershipClaim {
  readonly claimId: string;
  readonly target: string;
  readonly scope: InstallationScope;
  readonly destinationPath: string;
  /** The installation that owns, or is acquiring, this destination. */
  readonly ownerInstallation: string;
  /** Incremented on every authoritative change to this claim. */
  readonly generation: number;
  readonly state: DestinationClaimState;
  readonly acquiringInstallation?: string;
  readonly cedingInstallation?: string;
  /** Recovery pre-image: the artifact the ceding installation had here. */
  readonly priorManagedArtifact?: ManagedArtifact;
  readonly intendedFingerprint?: string;
  readonly updatedAt: string;
}

/**
 * Derive the unique key of a destination claim.
 *
 * The tuple target + scope + destinationPath is unique across live claims, which
 * is what makes two installations unable to hold one destination (BR3.6).
 * @param target - Supported-target name.
 * @param scope - Installation scope.
 * @param destinationPath - Absolute destination path.
 * @returns The derived claim key.
 */
export function deriveClaimKey(
  target: string,
  scope: InstallationScope,
  destinationPath: string
): string {
  return [
    escapeKeyComponent(target),
    escapeKeyComponent(scope),
    escapeKeyComponent(destinationPath)
  ].join('|');
}

/** The claim transitions U1 may perform. */
const LEGAL_CLAIM_TRANSITIONS: Readonly<Record<DestinationClaimState, readonly DestinationClaimState[]>> = {
  claimed: ['pending-materialization', 'claimed'],
  'pending-materialization': ['finalized', 'rollback-required'],
  'rollback-required': ['finalized', 'claimed'],
  finalized: ['claimed', 'pending-materialization']
};

/**
 * Whether a claim state change is one U1 is allowed to make.
 *
 * `finalized` may be re-claimed: the same installation updating its own
 * destination on a later install starts a new reservation over a settled claim.
 * `pending-materialization` may only settle (`finalized`) or fail
 * (`rollback-required`) — never silently return to `claimed`, which would
 * release a destination whose bytes are unknown.
 * @param from - Current state.
 * @param to - Requested state.
 * @returns True when the transition is legal.
 */
export function isLegalClaimTransition(
  from: DestinationClaimState,
  to: DestinationClaimState
): boolean {
  return LEGAL_CLAIM_TRANSITIONS[from].includes(to);
}

/**
 * Whether a claim blocks a different installation from writing its destination.
 *
 * A live reservation or an unresolved failure blocks everyone; only U1's own
 * recovery may move it.
 * @param claim - The live claim.
 * @returns True while the destination is not writable by another installation.
 */
export function claimBlocksOtherWriters(claim: DestinationOwnershipClaim): boolean {
  return claim.state === 'pending-materialization' || claim.state === 'rollback-required';
}

/**
 * Find the artifact a record holds at a destination.
 * @param installation - The managed installation.
 * @param destinationPath - Absolute destination path.
 * @returns The artifact, or `undefined` when this record does not manage it.
 */
export function artifactAt(
  installation: ManagedInstallation,
  destinationPath: string
): ManagedArtifact | undefined {
  return installation.artifacts.find((artifact) => artifact.destinationPath === destinationPath);
}

/**
 * Replace or add an artifact in a record, keyed by destination path.
 * @param installation - The managed installation.
 * @param artifact - The verified artifact to admit.
 * @returns A new record carrying the artifact.
 */
export function withArtifact(
  installation: ManagedInstallation,
  artifact: ManagedArtifact
): ManagedInstallation {
  const others = installation.artifacts
    .filter((existing) => existing.destinationPath !== artifact.destinationPath);
  return { ...installation, artifacts: [...others, artifact] };
}

/**
 * Drop an artifact from a record, keyed by destination path.
 *
 * Used both when an artifact is removed and when it is *preserved*: a preserved
 * artifact leaves the managed set so a later uninstall cannot delete it (BR4.3).
 * @param installation - The managed installation.
 * @param destinationPath - Absolute destination path.
 * @returns A new record without that artifact.
 */
export function withoutArtifact(
  installation: ManagedInstallation,
  destinationPath: string
): ManagedInstallation {
  return {
    ...installation,
    artifacts: installation.artifacts
      .filter((artifact) => artifact.destinationPath !== destinationPath)
  };
}

/**
 * Escape a key component so no value can forge a component boundary.
 * @param value - Raw component.
 * @returns The escaped component.
 */
function escapeKeyComponent(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}

/**
 * Drop a URL scheme, if present.
 * @param value - Raw URL.
 * @returns The value without its `scheme://` prefix.
 */
function stripScheme(value: string): string {
  const index = value.indexOf('://');
  return index === -1 ? value : value.slice(index + 3);
}
