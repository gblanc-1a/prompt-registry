/**
 * CLI → `app/deploy` wiring.
 *
 * One place builds `DeployPorts` and `PlacementContext`, because the
 * legacy `createWriterFactory` is duplicated in `install.ts` and
 * `uninstall.ts` and the two have to agree about layout resolution or
 * `remove()` computes a different path than `write()` did. Keeping the
 * flag-on construction single-sourced removes that failure mode by
 * construction rather than by comment.
 *
 * `PlacementContext` carries the *resolved* layout and the environment
 * used for `${...}` expansion (design 4.6): planning and writing share
 * one instance, so verification reproduces the original placement input
 * instead of re-reading mutable configuration.
 * @module deploy-wiring
 */
import * as path from 'node:path';
import {
  type DeployPorts,
  type MigrationReport,
  type PlacementContext,
  resolveLayoutAsync,
  resolveUserConfigPaths,
  TransformerRegistry,
} from '@ai-primitives-hub/app';
import {
  expandPath,
  RegistryError,
  type Target,
} from '@ai-primitives-hub/core';
import {
  FileSystemLayoutConfigLoader,
  isUnifiedDeployEnabled,
  resolveUserConfigDir,
  XdgAppStorage,
} from '@ai-primitives-hub/infra';
import type {
  Context,
} from './framework/context';

const layoutLoaderFor = (ctx: Context): FileSystemLayoutConfigLoader => new FileSystemLayoutConfigLoader({
  cwd: ctx.cwd(),
  fs: ctx.fs,
  userConfigDir: resolveUserConfigDir(ctx.env)
});

/**
 * Whether the unified deploy path was requested through the environment.
 * @param ctx CLI context.
 * @returns True when `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` is enabled.
 * @throws {Error} When the variable holds an unrecognized value.
 */
export const unifiedDeployRequested = (ctx: Context): boolean => isUnifiedDeployEnabled(ctx.env);

/**
 * Build the placement context for a target: hierarchical layout overrides
 * (same loader construction as `createWriterFactory`) resolved once, plus
 * the expanded absolute base root.
 * @param ctx CLI context.
 * @param target Effective target; must be user scope (an absent scope is recorded as user).
 * @returns Placement context shared by planning and writing.
 * @throws {RegistryError} BUNDLE.UNSUPPORTED_SCOPE for any scope other than user.
 */
export const buildPlacementContext = async (
  ctx: Context,
  target: Target
): Promise<PlacementContext> => {
  assertUnifiedDeploySupported(target);
  const resolvedLayout = await resolveLayoutAsync(target, layoutLoaderFor(ctx));
  const env = { ...ctx.env };
  return {
    scope: 'user',
    targetType: target.type,
    resolvedLayout,
    baseRoot: expandPath(resolvedLayout.baseDir, env),
    env,
    ...(target.allowedKinds === undefined ? {} : { allowedKinds: target.allowedKinds })
  };
};

/**
 * Build the ports `deployBundle`/`planDeploy`/`undeployBundle` run against.
 * @param ctx CLI context.
 * @param opts Deploy options.
 * @param opts.scope Installation scope. Only `'user'` is reachable today
 * (`assertUnifiedDeploySupported` refuses repository scope first); slice 3
 * adds its branch here, in the wiring, not in the store.
 * @returns Deploy ports.
 */
export const buildDeployPorts = (
  ctx: Context,
  opts: { scope: 'user' | 'repository' }
): DeployPorts => {
  void opts.scope;
  const userPaths = resolveUserConfigPaths(ctx.env);
  return {
    fs: ctx.fs,
    env: { ...ctx.env },
    appStorage: new XdgAppStorage(ctx.env),
    layoutLoader: layoutLoaderFor(ctx),
    lockfileStore: {
      desiredFile: userPaths.userLockfile,
      localFile: userPaths.userLocalLockfile,
      // The legacy user file keeps its name and becomes desiredFile, so it
      // is rewritten in place. Slice 3 passes the two prompt-registry.*
      // paths here for repository scope; the store and the migration do not
      // change, only this list does.
      legacyFiles: []
    }
    // mcpConfigStore (slice 7) and gitExclude (slice 3) stay undefined.
  };
};

/**
 * Resolve the transformer instance for a target type. It is passed through
 * `DeployPorts` as an instance and never stored in `PlacementContext`.
 * @param target Effective target.
 * @returns The registered transformer for the target type.
 */
export const transformerFor = (target: Target): NonNullable<DeployPorts['transformer']> =>
  TransformerRegistry.withBuiltIns().getTransformer(target.type);

/**
 * Runtime asset root passed to deploy requests (MCP assets, slice 7).
 * @param ctx CLI context.
 * @returns Absolute runtime asset root under the user config directory.
 */
export const runtimeAssetRootFor = (ctx: Context): string =>
  path.join(resolveUserConfigPaths(ctx.env).root, 'runtime');

/**
 * Render a lockfile migration report for text output: how many bundles moved to v3, and,
 * for each bundle left unmanaged, why. Empty when no migration ran.
 * @param migration Migration report, or `null` when nothing migrated.
 * @returns Text lines, each newline-terminated.
 */
export const renderMigration = (migration: MigrationReport | null): string => {
  if (migration === null) {
    return '';
  }
  const migrated = migration.migrated.length > 0
    ? `Migrated ${migration.migrated.length} bundle${migration.migrated.length === 1 ? '' : 's'} to lockfile v3.\n`
    : '';
  const unmanaged = migration.unmanaged.map(
    (u) => `Left unmanaged: ${u.key} (${u.reason}).\n`
  ).join('');
  return migrated + unmanaged;
};

/**
 * Refuse targets the unified path cannot converge yet. Only user scope is
 * supported; an absent scope is read as user, which is what the legacy path
 * does (every scope other than `repository` resolves the user layout and the
 * user lockfile).
 * @param target Effective target.
 * @param command Command named in the refusal message.
 * @throws {RegistryError} BUNDLE.UNSUPPORTED_SCOPE for any scope other than user.
 */
export const assertUnifiedDeploySupported = (target: Target, command: 'install' | 'uninstall' = 'install'): void => {
  const scope: string | undefined = target.scope;
  if (scope !== undefined && scope !== 'user') {
    throw new RegistryError({
      code: 'BUNDLE.UNSUPPORTED_SCOPE',
      message: `${command}: scope "${scope}" is not yet supported with unifiedDeploy enabled (target "${target.name}"); only user scope is supported until slice 3 adds repository scope.`,
      hint: 'Unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to use the current repository-scope path.'
    });
  }
};
