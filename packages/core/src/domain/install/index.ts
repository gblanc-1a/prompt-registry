/**
 * Domain Install — Barrel for install-related domain types.
 *
 * Holds types touched by both the CLI install commands and the
 * per-target writer plugins. Same independence rule as the rest of
 * `domain/`: no feature-layer imports.
 */
export type {
  Target,
  TargetType,
  TargetCommon,
  VsCodeTarget,
  CopilotCliTarget,
  KiroTarget,
  WindsurfTarget,
} from './target';
export { TARGET_TYPES, isTarget } from './target';
export type { BundleSpec, Installable } from './installable';
export type {
  ScopedLayoutDef,
  TargetLayoutDef,
  TargetLayoutsConfig,
  KindRoutes,
  TargetLayout,
} from './layout';
export { validateTargetLayoutsConfig } from './layout';
export type {
  TransformContext,
  TransformResult,
} from './transform';
export { noChange, changed } from './transform';
