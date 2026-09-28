/**
 * TargetRoutingPort — resolves the contained destination for one governed item.
 *
 * Resolution depends on the selected target, the installation scope, and the
 * item's kind, and on nothing else (BR2.1). A destination that would land
 * outside its root — lexically, or through a symbolic link on the real
 * filesystem — is refused before any write (BR2.2, NFR1.1.1).
 *
 * Concrete adapters live in `infra`.
 * @module ports/target-routing
 */
import type {
  InstallationAddress,
} from '../domain/install/address';
import type {
  Target,
} from '../domain/install/target';
import type {
  InstallationScope,
} from '../domain/install/types';
import type {
  PrimitiveKind,
} from '../domain/primitive/types';

/**
 * One routing request: which item, at which target and scope.
 */
export interface TargetRoutingRequest {
  readonly target: Target;
  readonly scope: InstallationScope;
  readonly itemKind: PrimitiveKind;
  /** The item's archive-relative path, which supplies its destination tail. */
  readonly archivePath: string;
}

/**
 * Outcome of one routing request.
 *
 * `unsupported` is not a failure: it is how a target says it accepts no content
 * of this kind, which the caller reports rather than forcing a destination.
 */
export type TargetRoutingResolution =
  | { readonly kind: 'resolved'; readonly address: InstallationAddress }
  | { readonly kind: 'unsupported'; readonly detail: string }
  | { readonly kind: 'safety-blocked'; readonly detail: string };

/**
 * Resolves contained destinations for governed items.
 */
export interface TargetRoutingPort {
  /**
   * Resolve the destination for one item.
   * @param request Target, scope, item kind, and the item's archive path.
   * @returns The resolved address, an `unsupported` kind, or `safety-blocked`.
   */
  resolve(request: TargetRoutingRequest): Promise<TargetRoutingResolution>;
}
