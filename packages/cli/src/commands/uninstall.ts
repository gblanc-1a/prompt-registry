/**
 * Uninstall command for removing bundles from targets.
 *
 * Symmetric to install: supports three modes:
 *   ai-primitives-hub uninstall <bundle-id>        (by bundle ID)
 *   ai-primitives-hub uninstall --lockfile <path>  (from lockfile)
 *   ai-primitives-hub uninstall --all              (all bundles for target)
 *
 * Repository-scope targets delegate to `UninstallPipeline`
 * (`@ai-primitives-hub/app`), which already encapsulates the
 * commit/local-only two-file split (see its module doc). User/workspace
 * scope has no such split — there is a single, non-split
 * `resolveUserConfigPaths(env).userLockfile` — so those targets are
 * handled inline here with the same `readLockfile`/`removeBundleEntry`/
 * `writeLockfile` primitives `install.ts` uses to write it.
 */
import * as path from 'node:path';
import {
  cleanupOrphanedSource,
  type DeployPorts,
  FileTreeTargetWriter,
  listTargetBundles,
  type LockfileBundleEntry,
  type MigrationReport,
  readLockfile,
  removeBundleEntry,
  resolveUndeployKey,
  type TargetWriter,
  TransformerRegistry,
  undeployBundle,
  type UndeployResult,
  UninstallPipeline,
  type UninstallResult,
  writeLockfile,
} from '@ai-primitives-hub/app';
import {
  parseLogicalBundleKey,
  type Target,
} from '@ai-primitives-hub/core';
import {
  FileSystemLayoutConfigLoader,
  type RepositoryCommitMode,
  RepositoryScopeWriter,
  RepositoryScopeWriterAdapter,
  resolveUserConfigDir,
  TargetStateStore,
} from '@ai-primitives-hub/infra';
import {
  assertUnifiedDeploySupported,
  buildDeployPorts,
  renderMigration,
  unifiedDeployRequested,
} from '../deploy-wiring';
import {
  Command,
  failWith,
  findProjectLockfile,
  loadTargets,
  lockfilePathForTarget,
  Option,
  resolveEffectiveTarget,
} from '../framework';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  readTargetsSafely,
  RegistryError,
  resolveTarget,
  resolveTargetName,
  validateInputs,
} from '../framework';

/**
 * Uninstall command options.
 */
export interface UninstallOptions {
  output?: OutputFormat;
  /** Bundle id to uninstall (imperative mode). */
  bundle?: string;
  /** Lockfile path (declarative mode). */
  lockfile?: string;
  /** Target name (resolved against `targets[]` in config). */
  target?: string;
  /** Uninstall all bundles for target. */
  all?: boolean;
  /** Dry-run: preview removal without deleting files. */
  dryRun?: boolean;
  /**
   * Installation scope (user or repository).
   * Overrides target's scope if specified.
   */
  scope?: 'user' | 'repository';
  /**
   * Commit mode for repository scope.
   * Only applies when scope=repository.
   */
  commitMode?: RepositoryCommitMode;
}

/**
 * Detect uninstall context from the project environment (symmetric with install).
 * Fills in `opts.lockfile` and `opts.target` when they can be inferred.
 * @param opts Uninstall options (mutated in-place).
 * @param ctx CLI context.
 */
async function detectUninstallContext(opts: UninstallOptions, ctx: Context): Promise<void> {
  if (!opts.bundle && !opts.lockfile && !opts.all) {
    const foundLock = await findProjectLockfile(ctx);
    if (foundLock !== null) {
      opts.lockfile = foundLock;
    }
  }

  if (!opts.target || opts.target.length === 0) {
    const targets = await readTargetsSafely(
      loadTargets(ctx)
    );
    if (targets.length === 1) {
      opts.target = targets[0].name;
    }
  }
}

/**
 * Command context for the uninstall command.
 */
interface CommandContext {
  ctx: Context;
}

/**
 * Base class for the uninstall command.
 */
abstract class BaseUninstallCommand extends Command {
  public commandContext: CommandContext = { ctx: null as unknown as Context };
  public output?: OutputFormat;
}

/**
 * Native clipanion class command for uninstall.
 */
export class UninstallCommand extends BaseUninstallCommand {
  public static readonly paths = [['uninstall']];

  public static readonly usage = Command.Usage({
    description: 'Remove bundles from a configured target.',
    category: 'Install & Manage',
    details: `
      Usage: ai-primitives-hub uninstall [options]

      Options:
        --bundle <id>          Bundle id to uninstall
        --lockfile <path>      Path to a lockfile for declarative uninstallation
        --target <name>        Target name to uninstall from
        --all                  Remove all bundles for target
        --dry-run              Preview removal without deleting files
        --scope <scope>        Installation scope (user or repository)
        --commit-mode <mode>   Commit mode for repository scope
        -o, --output <format> Output format (text, json, yaml, ndjson)

      Examples:
        ai-primitives-hub uninstall --lockfile prompt-registry.lock.json --target my-vscode
        ai-primitives-hub uninstall --all --target my-vscode
        ai-primitives-hub uninstall --dry-run --target my-vscode
    `
  });

  public output = Option.String('-o', '--output') as OutputFormat | undefined;
  public bundle = Option.String('--bundle');
  public lockfile = Option.String('--lockfile');
  public target = Option.String('--target');
  public all = Option.Boolean('--all');
  public dryRun = Option.Boolean('--dry-run');
  public scope = Option.String('--scope');
  public commitMode = Option.String('--commit-mode');

  public async execute(): Promise<number> {
    const { ctx } = this.commandContext;
    const fmt = (this.output ?? 'text');

    const opts: UninstallOptions = {
      output: fmt,
      bundle: this.bundle,
      lockfile: this.lockfile,
      target: this.target,
      all: this.all,
      dryRun: this.dryRun,
      scope: this.scope as 'user' | 'repository' | undefined,
      commitMode: this.commitMode as RepositoryCommitMode | undefined
    };

    await detectUninstallContext(opts, ctx);

    const { bundle: noBundle, lockfile: noLockfile, all: noAll } = validateInputs(opts, { flags: ['bundle', 'lockfile', 'all'] });
    if (noBundle && noLockfile && noAll) {
      return failWith(ctx, fmt, 'uninstall', new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'uninstall: provide <bundle-id>, --lockfile <path>, or --all',
        hint: 'Examples:\n'
          + '  ai-primitives-hub uninstall <bundle-id> --target my-vscode\n'
          + '  ai-primitives-hub uninstall --lockfile prompt-registry.lock.json\n'
          + '  ai-primitives-hub uninstall --all\n\n'
          + 'Note: Lockfile is auto-detected in current directory and parent directories.'
      }));
    }

    try {
      const targetName = await resolveTargetName(opts.target, 'uninstall', ctx, () => loadTargets(ctx));
      const configuredTarget = await resolveTarget(targetName, 'uninstall', ctx, () => loadTargets(ctx));
      const target = resolveEffectiveTarget(ctx, configuredTarget, opts);

      if (opts.all === true) {
        return await performAllUninstall(opts, target, ctx, fmt);
      }

      if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
        return await performLockfileUninstall(opts, target, ctx, fmt);
      }

      return await performBundleUninstall(opts, target, ctx, fmt);
    } catch (err) {
      if (err instanceof RegistryError) {
        return failWith(ctx, fmt, 'uninstall', err);
      }
      throw err;
    }
  }
}

/**
 * Create a writer factory that routes to the appropriate writer based on target scope.
 * - user scope → FileTreeTargetWriter
 * - repository scope → RepositoryScopeWriter
 * @param ctx CLI context.
 * @param opts Uninstall options.
 * @returns Writer factory function.
 */
export const createWriterFactory = (
  ctx: Context,
  opts: UninstallOptions
): (target: Target) => TargetWriter => {
  // Create transformer registry with built-in transformers — must match
  // install.ts's factory so `writer.remove()` computes the same on-disk
  // path that `writer.write()` used (targets with a real, non-identity
  // transformer like Kiro would otherwise resolve the wrong path).
  const transformerRegistry = TransformerRegistry.withBuiltIns();
  const layoutLoader = new FileSystemLayoutConfigLoader({
    cwd: ctx.cwd(),
    fs: ctx.fs,
    userConfigDir: resolveUserConfigDir(ctx.env)
  });

  return (target: Target): TargetWriter => {
    const effectiveTarget = resolveEffectiveTarget(ctx, target, opts);
    const scope = effectiveTarget.scope;
    const commitMode = effectiveTarget.commitMode ?? 'commit';
    const workspaceRoot = effectiveTarget.rootPath ?? ctx.cwd();

    const copilotLikeTargets = new Set<string>(['vscode', 'vscode-insiders', 'copilot-cli']);
    if (scope === 'repository' && copilotLikeTargets.has(effectiveTarget.type)) {
      const writer = new RepositoryScopeWriter({
        fs: ctx.fs,
        workspaceRoot,
        commitMode
      });
      return new RepositoryScopeWriterAdapter(writer);
    }
    // Default to FileTreeTargetWriter for user scope
    const transformer = transformerRegistry.getTransformer(effectiveTarget.type);
    return new FileTreeTargetWriter({
      fs: ctx.fs,
      env: ctx.env,
      transformer,
      layoutLoader
    });
  };
};

/**
 * Remove a single bundle's files + lockfile entry directly against the
 * non-split user-scope lockfile. Mirrors `UninstallPipeline.run`'s
 * shape, minus the commit/local-only split that only applies to
 * repository scope.
 * @param bundleId Bundle id to remove.
 * @param lockPath Absolute path to the user-scope lockfile.
 * @param target Target being uninstalled from.
 * @param ctx CLI context.
 * @param writer Target writer.
 * @returns Uninstall result (matches `UninstallPipeline`'s shape).
 */
export async function runUserScopeUninstall(
  bundleId: string,
  lockPath: string,
  target: Target,
  ctx: Context,
  writer: TargetWriter
): Promise<UninstallResult> {
  const lock = await readLockfile(lockPath, ctx.fs);
  const entry = lock?.bundles[bundleId];
  if (lock === null || entry === undefined) {
    return { bundleId, removed: [], skipped: [] };
  }

  const removed: string[] = [];
  const skipped: string[] = [];
  for (const file of entry.files) {
    try {
      await writer.remove(target, file.path);
      removed.push(file.path);
    } catch {
      skipped.push(file.path);
    }
  }

  let next = removeBundleEntry(lock, bundleId);
  next = cleanupOrphanedSource(next, entry.sourceId);
  await writeLockfile(lockPath, next, ctx.fs);

  return { bundleId, removed, skipped };
}

/**
 * Remove every bundle tracked in the non-split user-scope lockfile.
 * Mirrors `UninstallPipeline.runAll`.
 * @param lockPath Absolute path to the user-scope lockfile.
 * @param target Target being uninstalled from.
 * @param ctx CLI context.
 * @param writer Target writer.
 * @returns Uninstall results, one per bundle removed.
 */
async function runAllUserScopeUninstall(
  lockPath: string,
  target: Target,
  ctx: Context,
  writer: TargetWriter
): Promise<UninstallResult[]> {
  const lock = await readLockfile(lockPath, ctx.fs);
  if (lock === null) {
    return [];
  }
  const results: UninstallResult[] = [];
  for (const bundleId of Object.keys(lock.bundles)) {
    results.push(await runUserScopeUninstall(bundleId, lockPath, target, ctx, writer));
  }
  return results;
}

/**
 * Look up a bundle entry for dry-run/preview purposes, from either the
 * repository-scope lockfile pair or the single user-scope lockfile.
 * @param bundleId Bundle id to look up.
 * @param target Target being uninstalled from.
 * @param opts Uninstall options.
 * @param ctx CLI context.
 * @returns The entry if found, else `null`.
 */
async function findBundleEntry(
  bundleId: string,
  target: Target,
  opts: UninstallOptions,
  ctx: Context
): Promise<LockfileBundleEntry | null> {
  if (target.scope === 'repository') {
    const pipeline = new UninstallPipeline({
      fs: ctx.fs,
      target,
      repositoryPath: target.rootPath ?? ctx.cwd(),
      writerFactory: createWriterFactory(ctx, opts)
    });
    const plan = await pipeline.plan(bundleId);
    return plan.lockfileEntry;
  }
  const lockPath = lockfilePathForTarget(ctx, target);
  const lock = await readLockfile(lockPath, ctx.fs);
  return lock?.bundles[bundleId] ?? null;
}

/**
 * Load every bundle entry for dry-run/preview purposes.
 * @param target Target being uninstalled from.
 * @param opts Uninstall options.
 * @param ctx CLI context.
 * @returns Map of bundle id to lockfile entry.
 */
async function findAllBundleEntries(
  target: Target,
  opts: UninstallOptions,
  ctx: Context
): Promise<Record<string, LockfileBundleEntry>> {
  if (target.scope === 'repository') {
    const pipeline = new UninstallPipeline({
      fs: ctx.fs,
      target,
      repositoryPath: target.rootPath ?? ctx.cwd(),
      writerFactory: createWriterFactory(ctx, opts)
    });
    const plans = await pipeline.planAll();
    const out: Record<string, LockfileBundleEntry> = {};
    for (const plan of plans) {
      if (plan.lockfileEntry !== null) {
        out[plan.bundleId] = plan.lockfileEntry;
      }
    }
    return out;
  }
  const lockPath = lockfilePathForTarget(ctx, target);
  const lock = await readLockfile(lockPath, ctx.fs);
  return lock?.bundles ?? {};
}

/**
 * Whether the unified (`app/deploy`) path was requested through the environment.
 * @param ctx CLI context.
 * @returns True when `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` is on.
 * @throws {RegistryError} USAGE.INVALID_FLAG for an unrecognized flag value.
 */
function uninstallFlagEnabled(ctx: Context): boolean {
  try {
    return unifiedDeployRequested(ctx);
  } catch (cause) {
    throw new RegistryError({
      code: 'USAGE.INVALID_FLAG',
      message: `uninstall: ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'Set AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to 1, true, yes, 0, false or no, or unset it.',
      cause
    });
  }
}

/**
 * Whether this run takes the unified (`app/deploy`) path. Refuses an unsupported scope
 * here, before any lockfile is read, so a refused run touches nothing.
 * @param ctx CLI context.
 * @param target Effective target.
 * @returns True when `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` is on and the scope is supported.
 * @throws {RegistryError} USAGE.INVALID_FLAG for an unrecognized flag value; BUNDLE.UNSUPPORTED_SCOPE for a scope other than user.
 */
function unifiedUninstallRequested(ctx: Context, target: Target): boolean {
  const unified = uninstallFlagEnabled(ctx);
  if (unified) {
    assertUnifiedDeploySupported(target, 'uninstall');
  }
  return unified;
}

/**
 * Lockfile-driven uninstall replays whatever file it is handed through the v2 reader, which
 * cannot read the v3 files unified deploy writes and could rewrite a repository lockfile the
 * unified path does not own. Until repository scope lands it is refused outright.
 * @param lockPath Lockfile the run would have read (explicit or auto-detected).
 * @returns The refusal to throw.
 */
const lockfileUninstallRefused = (lockPath: string): RegistryError => new RegistryError({
  code: 'BUNDLE.UNSUPPORTED_SCOPE',
  message: `uninstall: lockfile-driven uninstall (${lockPath}) is not yet supported with unifiedDeploy enabled. `
    + 'Uninstall a named bundle with `uninstall --bundle <id> --target <name>`, or everything a target holds with `uninstall --all --target <name>`.',
  hint: 'Unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to use the current repository-scope path.',
  context: { lockfile: lockPath }
});

const withMigration = (migration: MigrationReport | null): { migration?: MigrationReport } =>
  migration === null ? {} : { migration };

const withDesiredOnly = (desiredOnly: string[]): { desiredOnly?: string[] } =>
  desiredOnly.length === 0 ? {} : { desiredOnly };

// An interrupted uninstall's orphan is indistinguishable from intent not yet materialized, so
// `--all` reports desired-only keys instead of dropping them.
const renderDesiredOnly = (targetName: string, desiredOnly: string[]): string =>
  desiredOnly.length === 0
    ? ''
    : `Desired but not installed on ${targetName}: ${desiredOnly.join(', ')}. `
      + 'Run `uninstall --bundle <key> --target <name>` to drop that desired intent.\n';

const bundleHalf = (key: string): string => parseLogicalBundleKey(key)?.manifestId ?? key;

const failureReason = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const unifiedPorts = (ctx: Context): DeployPorts => buildDeployPorts(ctx, { scope: 'user' });

/**
 * Flag-on uninstall of one bundle: resolve the key, then remove exactly the recorded paths
 * through `app/deploy`. The envelope keeps the legacy `target`, `bundle`, `removed` and
 * `lockfile` keys (`bundle` is what the user typed) and adds `key`, `skipped`, and, when
 * present, `unmanagedReason` and `migration`, so a user whose files were left in place can
 * learn why.
 * @param opts Uninstall options.
 * @param target Effective target.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 * @throws {RegistryError} BUNDLE.AMBIGUOUS_ID when two sources offer the id.
 */
async function runUnifiedBundleUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const typed = opts.bundle as string;
  const dryRun = opts.dryRun === true;
  const ports = unifiedPorts(ctx);
  const resolution = await resolveUndeployKey({ targetName: target.name, typed }, ports);

  if (resolution.kind === 'none') {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'warning',
      data: {
        target: target.name,
        bundle: typed,
        reason: 'not found in lockfile'
      },
      textRenderer: (d) => `Bundle "${d.bundle}" is not installed in target "${d.target}". Nothing to uninstall.\n`
    });
    return 0;
  }
  if (resolution.kind === 'ambiguous') {
    throw new RegistryError({
      code: 'BUNDLE.AMBIGUOUS_ID',
      message: `uninstall: "${typed}" matches more than one bundle installed in target "${target.name}": ${resolution.keys.join(', ')}.`,
      hint: `Pass the full sourceId/bundleId key, e.g. --bundle ${resolution.keys[0]}.`,
      context: { bundle: typed, target: target.name, keys: resolution.keys }
    });
  }

  const { key, version } = resolution;
  if (dryRun) {
    const record = resolution.kind === 'match' ? resolution.record : undefined;
    const unmanaged = record?.state === 'unmanaged';
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundle: typed,
        key,
        files: record === undefined || unmanaged ? [] : record.files.map((f) => f.path),
        ...(unmanaged ? { unmanagedReason: record.unmanagedReason } : {}),
        ...(record === undefined ? { orphaned: true } : {})
      },
      textRenderer: (d) => {
        if (record === undefined) {
          return `[dry-run] Would drop the orphaned desired entry "${d.key}" left by an interrupted uninstall; no files are removed.\n`
            + 'Run without --dry-run to apply.\n';
        }
        return unmanaged
          ? `[dry-run] Would drop the record of unmanaged bundle "${d.bundle}" from target "${d.target}"; its files stay in place (${record.unmanagedReason}).\n`
          + 'Run without --dry-run to apply.\n'
          : `[dry-run] Would uninstall bundle "${d.bundle}" from target "${d.target}":\n`
            + `  Files: ${d.files.join(', ')}\n`
            + 'Run without --dry-run to apply.\n';
      }
    });
    return 0;
  }

  const result = await undeployBundle({
    key,
    bundle: { bundleId: bundleHalf(key), version },
    scope: 'user',
    targetName: target.name
  }, ports);
  const reported = result.migration;
  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: result.unmanagedReason === undefined ? 'ok' : 'warning',
    data: {
      target: target.name,
      bundle: typed,
      key,
      removed: result.removed,
      skipped: result.skipped,
      lockfile: ports.lockfileStore.desiredFile,
      ...(result.unmanagedReason === undefined ? {} : { unmanagedReason: result.unmanagedReason }),
      ...withMigration(reported)
    },
    textRenderer: (d) => `Uninstalled ${d.bundle} from target "${d.target}" `
      + `(${d.removed.length} file${d.removed.length === 1 ? '' : 's'} removed). `
      + `Updated ${d.lockfile}.\n`
      + (d.unmanagedReason === undefined
        ? (d.skipped.length > 0 ? `${d.skipped.length} recorded path${d.skipped.length === 1 ? '' : 's'} skipped (already absent or unsafe to resolve).\n` : '')
        : `${d.skipped.length} file${d.skipped.length === 1 ? '' : 's'} left in place: ${d.unmanagedReason}.\n`)
      + renderMigration(reported)
  });
  return 0;
}

/**
 * Flag-on uninstall of every bundle the target holds, one `undeployBundle` per recorded key.
 * Keeps the legacy `target`, `uninstalled` and `bundles` keys (`id` is the logical key, the only
 * identifier unique across sources) and adds, per bundle, `skipped` and `unmanagedReason`, plus
 * the run's `migration` when one ran.
 * @param opts Uninstall options.
 * @param target Effective target.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function runUnifiedAllUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const dryRun = opts.dryRun === true;
  const ports = unifiedPorts(ctx);
  const { bundles, desiredOnly } = await listTargetBundles(target.name, ports);
  const keys = bundles.map((b) => b.key);
  const desiredOnlyNote = renderDesiredOnly(target.name, desiredOnly);

  if (dryRun) {
    const managed = bundles.filter((b) => b.record.state !== 'unmanaged');
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundles: keys,
        files: managed.flatMap((b) => b.record.files.map((f) => f.path)),
        unmanaged: bundles
          .filter((b) => b.record.state === 'unmanaged')
          .map((b) => ({ key: b.key, reason: b.record.unmanagedReason })),
        ...withDesiredOnly(desiredOnly)
      },
      textRenderer: (d) => `[dry-run] Would uninstall all bundles from target "${d.target}":\n`
        + `  Bundles: ${d.bundles.join(', ')}\n`
        + `  Files: ${d.files.length} total\n`
        + d.unmanaged.map((u) => `  Left in place: ${u.key} (${u.reason}).\n`).join('')
        + desiredOnlyNote
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  // Keys are snapshotted above, so a failure leaves the later bundles untouched and unattempted.
  const results: UndeployResult[] = [];
  let failure: { key: string; reason: string } | undefined;
  for (const bundle of bundles) {
    try {
      results.push(await undeployBundle({
        key: bundle.key,
        bundle: { bundleId: bundleHalf(bundle.key), version: bundle.version },
        scope: 'user',
        targetName: target.name
      }, ports));
    } catch (cause) {
      failure = { key: bundle.key, reason: failureReason(cause) };
      break;
    }
  }
  const migration = results.map((r) => r.migration).find((m) => m !== null) ?? null;

  if (results.length === 0 && failure === undefined) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        target: target.name,
        uninstalled: 0,
        ...withDesiredOnly(desiredOnly)
      },
      textRenderer: (d) => `No bundles installed in target "${d.target}". Nothing to uninstall.\n${desiredOnlyNote}`
    });
    return 0;
  }

  const notAttempted = failure === undefined ? 0 : keys.length - results.length - 1;
  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: failure !== undefined || results.some((r) => r.unmanagedReason !== undefined) ? 'warning' : 'ok',
    data: {
      target: target.name,
      uninstalled: results.length,
      bundles: results.map((r) => ({
        id: r.key,
        removed: r.removed.length,
        skipped: r.skipped.length,
        ...(r.unmanagedReason === undefined ? {} : { unmanagedReason: r.unmanagedReason })
      })),
      ...(failure === undefined ? {} : { failure }),
      ...withDesiredOnly(desiredOnly),
      ...withMigration(migration)
    },
    warnings: failure === undefined ? undefined : [`${failure.key}: ${failure.reason}`],
    textRenderer: (d) => `Uninstalled ${d.uninstalled} bundle${d.uninstalled === 1 ? '' : 's'} `
      + `from target "${d.target}".\n`
      + d.bundles
        .filter((b) => b.unmanagedReason !== undefined)
        .map((b) => `Left in place: ${b.id} (${b.skipped} file${b.skipped === 1 ? '' : 's'}; ${b.unmanagedReason}).\n`)
        .join('')
        + (d.failure === undefined
          ? ''
          : `Failed on ${d.failure.key}: ${d.failure.reason}. ${notAttempted} later bundle${notAttempted === 1 ? '' : 's'} not attempted.\n`)
        + desiredOnlyNote
        + renderMigration(migration)
  });
  return failure === undefined ? 0 : 1;
}

/**
 * Perform uninstall by bundle ID.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performBundleUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  if (unifiedUninstallRequested(ctx, target)) {
    return await runUnifiedBundleUninstall(opts, target, ctx, fmt);
  }
  const bundleId = opts.bundle as string;
  const entry = await findBundleEntry(bundleId, target, opts, ctx);

  if (entry === null) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'warning',
      data: {
        target: target.name,
        bundle: bundleId,
        reason: 'not found in lockfile'
      },
      textRenderer: (d) => `Bundle "${d.bundle}" is not installed in target "${d.target}". Nothing to uninstall.\n`
    });
    return 0;
  }

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundle: bundleId,
        files: entry.files.map((f) => f.path)
      },
      textRenderer: (d) => `[dry-run] Would uninstall bundle "${d.bundle}" from target "${d.target}":\n`
        + `  Files: ${d.files.join(', ')}\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  let result: UninstallResult;
  let lockPath: string;
  if (target.scope === 'repository') {
    const commitMode = entry.commitMode ?? target.commitMode ?? 'commit';
    lockPath = lockfilePathForTarget(ctx, target, commitMode);
    const pipeline = new UninstallPipeline({
      fs: ctx.fs,
      target,
      repositoryPath: target.rootPath ?? ctx.cwd(),
      writerFactory
    });
    result = await pipeline.run(bundleId);
  } else {
    lockPath = lockfilePathForTarget(ctx, target);
    result = await runUserScopeUninstall(bundleId, lockPath, target, ctx, writerFactory(target));
  }

  // Update target state
  await updateTargetState(ctx, target.name, bundleId);

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      target: target.name,
      bundle: bundleId,
      removed: result.removed,
      lockfile: lockPath
    },
    textRenderer: (d) => `Uninstalled ${d.bundle} from target "${d.target}" `
      + `(${d.removed.length} file${d.removed.length === 1 ? '' : 's'} removed). `
      + `Updated ${d.lockfile}.\n`
  });
  return 0;
}

/**
 * Perform uninstall from lockfile.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLockfileUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const lockfile = opts.lockfile as string;
  const lockPath = path.isAbsolute(lockfile)
    ? lockfile
    : path.join(ctx.cwd(), lockfile);
  // Refuse before reading: the v2 reader below cannot read what unified deploy writes.
  if (uninstallFlagEnabled(ctx)) {
    throw lockfileUninstallRefused(lockPath);
  }
  const lock = await readLockfile(lockPath, ctx.fs);

  if (lock === null) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: { lockfile: lockPath, target: target.name, uninstalled: 0 },
      textRenderer: (d) => `No lockfile found at ${d.lockfile}. Nothing to uninstall.\n`
    });
    return 0;
  }

  const bundleIds = Object.keys(lock.bundles);

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    const allFiles = bundleIds.flatMap((id) => lock.bundles[id].files.map((f) => f.path));
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        lockfile: lockPath,
        target: target.name,
        bundles: bundleIds,
        files: allFiles
      },
      textRenderer: (d) => `[dry-run] Would uninstall ${d.bundles.length} bundle${d.bundles.length === 1 ? '' : 's'} from target "${d.target}" (from ${d.lockfile}):\n`
        + `  Bundles: ${d.bundles.join(', ')}\n`
        + `  Files: ${d.files.length} total\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  let results: UninstallResult[];
  if (target.scope === 'repository') {
    const pipeline = new UninstallPipeline({
      fs: ctx.fs,
      target,
      repositoryPath: path.dirname(lockPath),
      writerFactory
    });
    results = await pipeline.runFromLockfile();
  } else {
    results = await runAllUserScopeUninstall(lockPath, target, ctx, writerFactory(target));
  }

  if (results.length === 0) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        lockfile: lockPath,
        target: target.name,
        uninstalled: 0
      },
      textRenderer: (d) => `No bundles found to uninstall from target "${d.target}".\n`
    });
    return 0;
  }

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      lockfile: lockPath,
      target: target.name,
      uninstalled: results.length,
      bundles: results.map((r) => ({ id: r.bundleId, removed: r.removed.length }))
    },
    textRenderer: (d) => `Uninstalled ${d.uninstalled} bundle${d.uninstalled === 1 ? '' : 's'} `
      + `from target "${d.target}" (from ${d.lockfile}).\n`
  });
  return 0;
}

/**
 * Perform uninstall of all bundles for target.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performAllUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  if (unifiedUninstallRequested(ctx, target)) {
    return await runUnifiedAllUninstall(opts, target, ctx, fmt);
  }
  const entries = await findAllBundleEntries(target, opts, ctx);
  const bundleIds = Object.keys(entries);

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    const allFiles = bundleIds.flatMap((id) => entries[id].files.map((f) => f.path));
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundles: bundleIds,
        files: allFiles
      },
      textRenderer: (d) => `[dry-run] Would uninstall all bundles from target "${d.target}":\n`
        + `  Bundles: ${d.bundles.join(', ')}\n`
        + `  Files: ${d.files.length} total\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  let results: UninstallResult[];
  if (target.scope === 'repository') {
    const pipeline = new UninstallPipeline({
      fs: ctx.fs,
      target,
      repositoryPath: target.rootPath ?? ctx.cwd(),
      writerFactory
    });
    results = await pipeline.runAll();
  } else {
    const lockPath = lockfilePathForTarget(ctx, target);
    results = await runAllUserScopeUninstall(lockPath, target, ctx, writerFactory(target));
  }

  if (results.length === 0) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        target: target.name,
        uninstalled: 0
      },
      textRenderer: (d) => `No bundles installed in target "${d.target}". Nothing to uninstall.\n`
    });
    return 0;
  }

  // Update target state (clear all bundles)
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.ai-primitives-hub', 'target-state.json')
  });
  await stateStore.save({
    targetName: target.name,
    lastInstalledBundles: [],
    lastUsedAt: new Date().toISOString()
  });

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      target: target.name,
      uninstalled: results.length,
      bundles: results.map((r) => ({ id: r.bundleId, removed: r.removed.length }))
    },
    textRenderer: (d) => `Uninstalled ${d.uninstalled} bundle${d.uninstalled === 1 ? '' : 's'} `
      + `from target "${d.target}".\n`
  });
  return 0;
}

/**
 * Update target state by removing bundle.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param bundleId Bundle ID to remove.
 */
async function updateTargetState(ctx: Context, targetName: string, bundleId: string): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.ai-primitives-hub', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
  if (bundleIndex !== -1) {
    newBundles.splice(bundleIndex, 1);
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Build the `uninstall` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createUninstallCommand = (
  opts: UninstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['uninstall'],
    description: 'Remove bundles from a configured target.',
    category: 'Install & Manage',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const { bundle: noBundle, lockfile: noLockfile, all: noAll } = validateInputs(opts, { flags: ['bundle', 'lockfile', 'all'] });
      if (noBundle && noLockfile && noAll) {
        return failWith(ctx, fmt, 'uninstall', new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'uninstall: provide <bundle-id>, --lockfile <path>, or --all',
          hint: 'Examples:\n'
            + '  ai-primitives-hub uninstall <bundle-id> --target my-vscode\n'
            + '  ai-primitives-hub uninstall --lockfile prompt-registry.lock.json\n'
            + '  ai-primitives-hub uninstall --all --target my-vscode'
        }));
      }

      try {
        const targetName = await resolveTargetName(opts.target, 'uninstall', ctx, () => loadTargets(ctx));
        const configuredTarget = await resolveTarget(targetName, 'uninstall', ctx, () => loadTargets(ctx));
        const target = resolveEffectiveTarget(ctx, configuredTarget, opts);

        if (opts.all === true) {
          return await performAllUninstall(opts, target, ctx, fmt);
        }

        if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
          return await performLockfileUninstall(opts, target, ctx, fmt);
        }

        return await performBundleUninstall(opts, target, ctx, fmt);
      } catch (err) {
        if (err instanceof RegistryError) {
          return failWith(ctx, fmt, 'uninstall', err);
        }
        throw err;
      }
    }
  });
