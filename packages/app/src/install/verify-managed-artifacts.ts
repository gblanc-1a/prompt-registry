/**
 * `verifyManagedArtifacts` — read-only evidence about target bytes (Contract 3).
 *
 * It answers exactly one question — are these artifacts present at the target with
 * exactly the bytes the registry recorded — and it **never writes or deletes**
 * (NFR1.1.7). It is the shared evidence behind U4's verified-duplicate decision,
 * its pre-deletion comparison, and the journal's first-pass and resumption checks.
 *
 * When, and only when, the **complete** expected set verifies as
 * `present-identical`, it mints a {@link VerificationResultToken}: an HMAC over
 * the installation key, the journal entry id, the live generation, the complete
 * fingerprint set, a read marker, and the issue time. The key is ephemeral and
 * per-process and is never persisted, so a process restart invalidates old tokens
 * by design — resumption must verify again before it can authorise a deletion
 * (NFR1.1.6, BR5.5).
 *
 * The verdicts describe bytes read during this call only. No caller may carry them
 * forward as standing authority.
 * @module install/verify-managed-artifacts
 */
import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import type {
  ArtifactVerdict,
  ArtifactVerificationResult,
  Clock,
  InstallationRegistryPort,
  TargetArtifactStorePort,
  VerificationResultToken,
} from '@ai-primitives-hub/core';
import {
  canonicalArtifactSetPayload,
  canonicalTokenPayload,
  isContainedPath,
} from '@ai-primitives-hub/core';

/**
 * One artifact to verify: where it should be, and what it should contain.
 */
export interface ExpectedArtifact {
  readonly destinationRoot: string;
  readonly destinationPath: string;
  /**
   * The fingerprint expected here. Optional so the journal can reference the
   * registry's own value rather than copying it (BR5.3).
   */
  readonly expectedFingerprint?: string;
  /** Legacy path this artifact was transferred from, when verifying a migration. */
  readonly legacyPath?: string;
  /** The verified legacy root that legacy path must stay inside (BR5.7). */
  readonly legacySourceRoot?: string;
}

/**
 * One verification request.
 */
export interface VerifyManagedArtifactsRequest {
  readonly installationKey: string;
  readonly artifacts: readonly ExpectedArtifact[];
  /** Journal entry this evidence is for; required to mint a token. */
  readonly entryId?: string;
  /** The entry generation the token must be bound to. */
  readonly generation?: number;
}

/**
 * The verification result, with a token only when everything verified.
 */
export interface VerifyManagedArtifactsOutcome {
  readonly result: ArtifactVerificationResult;
  readonly token?: VerificationResultToken;
}

/**
 * Ports the verification needs. Both are read-only here.
 */
export interface VerifyManagedArtifactsPorts {
  readonly registry: InstallationRegistryPort;
  readonly artifacts: TargetArtifactStorePort;
  readonly clock: Clock;
  /**
   * Ephemeral signing key. Defaults to a fresh per-instance random key, which is
   * the contract: it is never persisted and never leaves this process.
   */
  readonly signingKey?: Uint8Array;
}

/**
 * Read-only managed-artifact verification and token minting.
 */
export class ManagedArtifactVerifier {
  private readonly signingKey: Uint8Array;

  /**
   * Create a ManagedArtifactVerifier.
   * @param ports Registry, artifact store, clock, and optional signing key.
   */
  public constructor(private readonly ports: VerifyManagedArtifactsPorts) {
    this.signingKey = ports.signingKey ?? new Uint8Array(randomBytes(32));
  }

  /**
   * HMAC-SHA-256 over the canonical token payload.
   * @param body - Token fields without the signature.
   * @returns Lower-case hex signature.
   */
  private sign(body: Omit<VerificationResultToken, 'signature'>): string {
    return createHmac('sha256', this.signingKey)
      .update(canonicalTokenPayload(body))
      .digest('hex');
  }

  /**
   * Verify that a token was minted by this process and is unaltered.
   *
   * Authenticity only. Currency — that the entry has not moved on and the bytes
   * still match — is the journal's check, because it owns the entry and the
   * filesystem read.
   * @param token Token supplied by a caller.
   * @returns True when the signature matches this process's key.
   */
  public isAuthentic(token: VerificationResultToken): boolean {
    const expected = this.sign({
      installationKey: token.installationKey,
      entryId: token.entryId,
      generation: token.generation,
      artifactSetDigest: token.artifactSetDigest,
      readVersion: token.readVersion,
      issuedAt: token.issuedAt
    });
    return expected.length === token.signature.length && expected === token.signature;
  }

  /**
   * Verify the current bytes at each expected destination.
   * @param request Installation key, expected artifacts, optional entry binding.
   * @returns Per-artifact verdicts, the aggregate, and a token when all verified.
   */
  public async verify(
    request: VerifyManagedArtifactsRequest
  ): Promise<VerifyManagedArtifactsOutcome> {
    const record = await this.ports.registry.get(request.installationKey);
    const verdicts: ArtifactVerdict[] = [];
    const expectedSet: { destinationPath: string; expectedFingerprint: string }[] = [];
    let safetyBlocked = false;

    for (const expected of request.artifacts) {
      const managed = record?.artifacts
        .find((artifact) => artifact.destinationPath === expected.destinationPath);
      const expectedFingerprint = expected.expectedFingerprint ?? managed?.installedFingerprint ?? '';
      expectedSet.push({ destinationPath: expected.destinationPath, expectedFingerprint });

      if (expected.legacyPath !== undefined
        && expected.legacySourceRoot !== undefined
        && !isContainedPath(expected.legacySourceRoot, expected.legacyPath)) {
        // A legacy path outside its verified source root is refused with no read
        // at all (BR5.7).
        verdicts.push({ destinationPath: expected.destinationPath, verdict: 'safety-blocked' });
        safetyBlocked = true;
        continue;
      }

      const current = await this.ports.artifacts
        .read(expected.destinationRoot, expected.destinationPath);
      if (current.kind === 'safety-blocked') {
        verdicts.push({ destinationPath: expected.destinationPath, verdict: 'safety-blocked' });
        safetyBlocked = true;
        continue;
      }
      if (current.kind === 'retryable-failure') {
        // Unreadable is not "absent" and not "identical": it cannot verify.
        verdicts.push({ destinationPath: expected.destinationPath, verdict: 'safety-blocked' });
        safetyBlocked = true;
        continue;
      }
      if (current.value === null) {
        verdicts.push({ destinationPath: expected.destinationPath, verdict: 'absent' });
        continue;
      }
      const actual = digest(current.value);
      verdicts.push({
        destinationPath: expected.destinationPath,
        verdict: expectedFingerprint.length > 0 && actual === expectedFingerprint
          ? 'present-identical'
          : 'present-different'
      });
    }

    const allVerified = !safetyBlocked
      && verdicts.length > 0
      && verdicts.every((verdict) => verdict.verdict === 'present-identical');
    const result: ArtifactVerificationResult = {
      allVerified,
      artifactVerdicts: verdicts,
      ...(safetyBlocked ? { detail: 'one or more paths failed a safety check' } : {})
    };
    if (!allVerified || request.entryId === undefined || request.generation === undefined) {
      return { result };
    }

    const body = {
      installationKey: request.installationKey,
      entryId: request.entryId,
      generation: request.generation,
      artifactSetDigest: digestText(canonicalArtifactSetPayload(expectedSet)),
      readVersion: this.ports.clock.nowIso(),
      issuedAt: this.ports.clock.nowIso()
    };
    return { result, token: { ...body, signature: this.sign(body) } };
  }
}

/**
 * SHA-256 over bytes, in the same `sha256:<hex>` form the registry records.
 * @param bytes - Bytes read from the target.
 * @returns The digest.
 */
function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * SHA-256 over a canonical string.
 * @param text - Canonical serialisation.
 * @returns The digest.
 */
function digestText(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
