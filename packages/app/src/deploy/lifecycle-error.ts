import {
  FileIntegrityError,
  RegistryError,
} from '@ai-primitives-hub/core';

/** Applied filesystem effects, serialized in RegistryError.context.appliedEffects. */
export interface AppliedEffects {
  stage: string;
  written: string[];
  created: string[];
  cleanedUp: string[];
  cleanupFailures: { path: string; message: string }[];
  removed: string[];
}

/** A lifecycle failure after effects began; the original cause and diagnostic survive. */
export class LifecycleError extends RegistryError {
  public readonly details: AppliedEffects;

  public constructor(operation: 'deploy' | 'undeploy', cause: unknown, details: AppliedEffects) {
    const originalCode = cause instanceof RegistryError || cause instanceof FileIntegrityError
      ? cause.code
      : undefined;
    super({
      code: originalCode ?? (operation === 'deploy' ? 'BUNDLE.DEPLOY_FAILED' : 'BUNDLE.UNDEPLOY_FAILED'),
      message: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof RegistryError ? { hint: cause.hint, docsUrl: cause.docsUrl } : {}),
      context: {
        ...(cause instanceof RegistryError ? cause.context : {}),
        appliedEffects: details
      },
      cause
    });
    this.details = details;
  }
}
