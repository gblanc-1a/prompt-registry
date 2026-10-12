/**
 * Evidence retained when legacy source and bundle identities cannot be proven.
 * @module domain/install/portable-identity-migration
 */
import type {
  BundleResolution,
} from '../bundle/resolution';
import type {
  PortableSourceDescriptor,
} from '../source/portable-identity';

/** Non-secret legacy descriptor fragments kept for migration diagnostics. */
export interface LegacySourceDescriptorEvidence {
  type?: string;
  locator?: string;
  selectors?: Readonly<Record<string, string>>;
}

/** Shared desired-state evidence for a legacy row that cannot be converted. */
export interface LegacyDesiredIntent {
  originalKey: string;
  sourceRef?: string;
  descriptor?: LegacySourceDescriptorEvidence;
  version: string;
  knownResolution?: BundleResolution;
  reason: string;
}

/** Machine-local evidence for a legacy materialization. */
export interface LegacyIdentityEvidence {
  originalKey: string;
  sourceRef?: string;
  descriptor?: LegacyDesiredIntent['descriptor'];
  version: string;
  knownResolution?: BundleResolution;
  /** Local retention evidence only; never serialize into shared desired state. */
  originalLocalRoot?: string;
  portableDescriptor?: PortableSourceDescriptor;
}
