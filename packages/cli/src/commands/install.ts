/**
 * `install` — install a bundle into a configured target.
 *
 * Final shape:
 *   ai-primitives-hub install <bundle>            (imperative)
 *   ai-primitives-hub install --lockfile <path>   (declarative from a lockfile)
 *
 * Lockfile integration uses `app`'s dict-based `Lockfile` (extension-compatible
 * schema, `bundles: Record<bundleId, LockfileBundleEntry>`) rather than the
 * reference branch's array-of-entries schema. There is no per-entry `target`
 * field — repository scope always writes to `.github/` regardless of target,
 * and user-scope installs get their own lockfile file
 * (`resolveUserConfigPaths(env).userLockfile`) rather than the project-root one.
 * `SourceDispatcher`/`GitHubBundleResolver` take a shared `GitHubApi` client
 * (built from `http`+`tokens` via `GitHubApiClient`) instead of separate
 * `http`/`tokens` fields.
 */
import * as path from 'node:path';
import {
  checksumFiles,
  deployBundle,
  type DeployPorts,
  type DeployRequest,
  type DeployResult,
  emptyLockfile,
  FileTreeTargetWriter,
  type Lockfile,
  type LockfileBundleEntry,
  LockfileGenerationMismatchError,
  type LockfileSourceEntry,
  type LockfileV3Pair,
  migrateLockfileIfNeeded,
  type PlacementContext,
  planDeploy,
  readLockfile,
  readLockfileV3Pair,
  resolveUserConfigPaths,
  type TargetWriter,
  TransformerRegistry,
  upsertBundleEntry,
  upsertSource,
  writeLockfile,
  writeTargetSafely,
} from '@ai-primitives-hub/app';
import type {
  BundleResolver,
  GitHubApi,
  GitHubRepositoryTarget,
  GitHubSourceAuthCategory,
  HttpClient,
  HubSourceSpec,
  RegistrySource,
  Target,
  TokenProvider,
} from '@ai-primitives-hub/core';
import {
  getInstallableBundleFiles,
  parseBundleSpec,
  parseLogicalBundleKey,
  validateManifest,
} from '@ai-primitives-hub/core';
import {
  ActiveHubStore,
  AwesomeCopilotBundleResolver,
  createGitHubSourceAuthRuntime,
  defaultTokenProvider,
  FileSystemLayoutConfigLoader,
  GitHubApiClient,
  GitHubBundleResolver,
  type GitHubSourceAuthRuntime,
  HttpsBundleDownloader,
  HubStore,
  isGitHubAppAuthEnabled,
  NodeHttpClient,
  parseGitHubRepositoryTarget,
  readLocalBundle,
  type RepositoryCommitMode,
  RepositoryScopeWriter,
  RepositoryScopeWriterAdapter,
  resolveUserConfigDir,
  SourceDispatcher,
  StaticTokenProvider,
  TargetStateStore,
  ZipBundleExtractor,
} from '@ai-primitives-hub/infra';
import {
  assertUnifiedDeploySupported,
  buildDeployPorts,
  buildPlacementContext,
  runtimeAssetRootFor,
  transformerFor,
  unifiedDeployRequested,
} from '../deploy-wiring';
import {
  Command,
  createHubManager,
  failWith,
  findProjectLockfile,
  loadInquirer,
  loadTargets,
  lockfilePathForTarget,
  Option,
  requireActiveHubOrFail,
} from '../framework';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  readTargetsSafely,
  RegistryError,
  resolveEffectiveTarget,
  resolveTarget,
  resolveTargetName,
  validateInputs,
} from '../framework';

/**
 * Extract repo slug from a GitHub URL.
 * @param url GitHub URL (e.g., "https://github.com/owner/repo" or "owner/repo").
 * @returns Repo slug (e.g., "owner/repo").
 */
function extractRepoSlug(url: string): string {
  if (url.startsWith('https://github.com/')) {
    return url.replace('https://github.com/', '');
  }
  return url;
}

export interface SourceAwareInstallDependencies {
  githubApi: GitHubApi;
  downloadTokens: TokenProvider;
  repositoryTarget: GitHubRepositoryTarget;
  authenticationCategory: Exclude<GitHubSourceAuthCategory, 'unresolved'>;
}

export interface SourceAwareInstallDependencyCache {
  get(repoSlug: string, sourceConfig?: RegistrySource): Promise<SourceAwareInstallDependencies>;
}

function sourceSpecForInstall(
  repoSlug: string,
  sourceConfig: RegistrySource | undefined,
  target: GitHubRepositoryTarget
): HubSourceSpec {
  const sourceType = sourceConfig?.type === 'awesome-copilot' ? 'awesome-copilot' : 'github';
  const config = sourceConfig?.config ?? {};
  return {
    id: sourceConfig?.id ?? repoSlug,
    name: sourceConfig?.name ?? repoSlug,
    type: sourceType,
    url: sourceConfig?.url ?? `https://${target.host}/${target.owner}/${target.repository}`,
    owner: target.owner,
    repo: target.repository,
    branch: typeof config.branch === 'string' ? config.branch : 'main',
    ...(sourceType === 'awesome-copilot'
      ? { collectionsPath: typeof config.collectionsPath === 'string' ? config.collectionsPath : 'collections' }
      : {}),
    rawConfig: config
  };
}

async function sourceAwareInstallDependencies(
  repoSlug: string,
  sourceConfig: RegistrySource | undefined,
  http: HttpClient,
  ctx: Context,
  runtime: GitHubSourceAuthRuntime = createGitHubSourceAuthRuntime({ env: ctx.env, http })
): Promise<SourceAwareInstallDependencies> {
  const sourceUrl = sourceConfig?.url ?? `https://github.com/${repoSlug}`;
  const repositoryTarget = parseGitHubRepositoryTarget(sourceUrl);
  const sourceSpec = sourceSpecForInstall(repoSlug, sourceConfig, repositoryTarget);
  const report = await runtime.preflight([sourceSpec], {
    includeReleases: sourceConfig === undefined || sourceConfig.type === 'github',
    onLog: (message) => ctx.stderr.write(`[github preflight] ${message}\n`)
  });
  const decision = report.results[0];
  if (!report.valid || decision === undefined || decision.category === 'unresolved' || decision.target === undefined) {
    const code = decision?.errorCode ?? 'GH_SOURCE_PREFLIGHT_UNRESOLVED';
    throw new Error(`GitHub source preflight failed for ${sourceSpec.id}: ${code}`);
  }
  const downloadTokens = runtime.tokenProviderFor(decision.category) ?? new StaticTokenProvider('');
  return {
    githubApi: runtime.clientFor(decision.target, decision.category),
    downloadTokens,
    repositoryTarget: decision.target,
    authenticationCategory: decision.category
  };
}

function sourceAwareInstallDependencyKey(
  repoSlug: string,
  sourceConfig: RegistrySource | undefined
): string {
  const sourceUrl = sourceConfig?.url ?? `https://github.com/${repoSlug}`;
  const target = parseGitHubRepositoryTarget(sourceUrl);
  const config = sourceConfig?.config ?? {};
  return [
    target.host.toLowerCase(),
    target.owner.toLowerCase(),
    target.repository.toLowerCase(),
    sourceConfig?.type ?? 'github',
    typeof config.branch === 'string' ? config.branch : 'main',
    typeof config.collectionsPath === 'string' ? config.collectionsPath : 'collections'
  ].join('\u0000');
}

/**
 * Create a command-scoped cache for source-aware install dependencies.
 *
 * The App token cache is owned by the runtime's shared provider. Keeping the
 * runtime and preflight promises at command scope prevents every bundle in a
 * lockfile from repeating the same repository checks and minting a fresh
 * token for an already-seen source.
 * @param http HTTP client used by source preflight and resolvers.
 * @param ctx CLI context.
 * @param runtime Optional runtime seam for tests or advanced callers.
 */
export function createSourceAwareInstallDependencyCache(
  http: HttpClient,
  ctx: Context,
  runtime?: GitHubSourceAuthRuntime
): SourceAwareInstallDependencyCache {
  const sharedRuntime = runtime ?? createGitHubSourceAuthRuntime({ env: ctx.env, http });
  const entries = new Map<string, Promise<SourceAwareInstallDependencies>>();
  return {
    get: (repoSlug, sourceConfig) => {
      const key = sourceAwareInstallDependencyKey(repoSlug, sourceConfig);
      const existing = entries.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const dependency = sourceAwareInstallDependencies(
        repoSlug,
        sourceConfig,
        http,
        ctx,
        sharedRuntime
      );
      entries.set(key, dependency);
      return dependency;
    }
  };
}

/**
 * Build a `GitHubApi` client shared by every GitHub-backed resolver in
 * a single command invocation.
 * @param http HTTP client.
 * @param tokens Token provider.
 * @param repositoryTarget
 * @param authenticationCategory
 * @returns GitHubApiClient instance.
 */
export function githubApiFor(
  http: HttpClient,
  tokens: TokenProvider,
  repositoryTarget?: GitHubRepositoryTarget,
  authenticationCategory?: GitHubSourceAuthCategory
): GitHubApiClient {
  return new GitHubApiClient(http, {
    tokenProvider: tokens,
    repositoryTarget,
    authenticationCategory
  });
}

/**
 * Install command options.
 */
export interface InstallOptions {
  output?: OutputFormat;
  /** Bundle id to install (imperative mode). */
  bundle?: string;
  /** Lockfile path (declarative mode). */
  lockfile?: string;
  /** Target name (resolved against `targets[]` in config). */
  target?: string;
  /**
   * Path to an already-built bundle directory. When set, the install
   * command bypasses resolve/download/extract and reads files from
   * the directory directly. Useful for dev workflows where the
   * user just ran `ai-primitives-hub bundle build`.
   */
  from?: string;
  /** Dry-run: validate + plan the install but write nothing. */
  dryRun?: boolean;
  /**
   * Deploy over locally modified files and untracked collisions. Honored
   * only when `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY` is enabled; inert on the
   * legacy path.
   */
  force?: boolean;
  /**
   * Comma-separated allowlist of target names this run is permitted
   * to write to. Defense-in-depth for CI; refuses any --target outside
   * the set even if the target is configured.
   */
  allowTarget?: string;
  /**
   * Optional source slug for the remote install path. When `<bundle>` is given without
   * `--from`, this resolves the bundle via `GitHubBundleResolver`.
   * Format: `owner/repo`. If omitted, the bundleSpec must carry
   * a sourceId of the same form (e.g. `install owner/repo:foo`).
   */
  source?: string;
  /**
   * Interactive mode: prompts user to select bundles from a list.
   */
  interactive?: boolean;
  /**
   * Dependency-injection seam for tests. Production callers leave this
   * undefined; the install command then constructs a `NodeHttpClient`. Tests pass a
   * recording HTTP client to avoid real sockets.
   */
  http?: HttpClient;
  /**
   * Dependency-injection seam for tests. Production callers leave this
   * undefined; the install command then constructs `defaultTokenProvider(ctx.env)`.
   */
  tokens?: TokenProvider;
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
  /**
   * Source configuration for resolver selection.
   * If provided, SourceDispatcher will select the appropriate resolver.
   */
  sourceConfig?: RegistrySource;
  /** Reuse source-aware preflight and token providers across bundle requests. */
  sourceAwareDependencyCache?: SourceAwareInstallDependencyCache;
  /**
   * Verbose mode: show detailed progress and error messages.
   */
  verbose?: boolean;
}

/**
 * Command context for install/uninstall commands.
 */
interface CommandContext {
  ctx: Context;
  http?: HttpClient;
  tokens?: TokenProvider;
}

/**
 * Base class for install/uninstall commands.
 */
abstract class BaseInstallCommand extends Command {
  public commandContext: CommandContext = { ctx: null as unknown as Context };
  public output?: OutputFormat;
}

/**
 * Native clipanion class command for install.
 */
export class InstallCommand extends BaseInstallCommand {
  public static readonly paths = [['install']];

  public static readonly usage = Command.Usage({
    description: 'Install bundles to a configured target.',
    category: 'Install & Manage',
    details: `
      Usage: ai-primitives-hub install [options]

      Options:
        --from <path>           Path to an already-built bundle directory
        --lockfile <path>       Path to a lockfile for declarative installation
        --target <name>         Target name to install to
        --source <hub-id>       Hub ID to list bundles from (use with --interactive for selection)
        --interactive           Interactive mode: select bundles from a list
        --dry-run               Validate and plan without writing
        --force                 Deploy over locally modified files and untracked collisions
                                (only with AI_PRIMITIVES_HUB_UNIFIED_DEPLOY enabled; ignored otherwise)
        --scope <scope>         Installation scope (user or repository)
        --commit-mode <mode>    Commit mode for repository scope
        --verbose               Show detailed progress and error messages
        -o, --output <format>  Output format (text, json, yaml, ndjson)

      Examples:
        ai-primitives-hub install --from <path> --target my-vscode
        ai-primitives-hub install --lockfile prompt-registry.lock.json --target my-vscode
        ai-primitives-hub install --source amadeus-hub --interactive --target my-vscode
    `
  });

  public output = Option.String('-o', '--output') as OutputFormat | undefined;
  public from = Option.String('--from');
  public lockfile = Option.String('--lockfile');
  public target = Option.String('--target');
  public source = Option.String('--source');
  public interactive = Option.Boolean('--interactive', false);
  public dryRun = Option.Boolean('--dry-run');
  public force = Option.Boolean('--force');
  public scope = Option.String('--scope');
  public commitMode = Option.String('--commit-mode');
  public verbose = Option.Boolean('--verbose', false);
  public allowTarget = Option.String('--allow-target');
  public bundle = Option.String({ required: false }); // Optional positional argument

  public async execute(): Promise<number> {
    const { ctx } = this.commandContext;
    const http = this.commandContext.http ?? new NodeHttpClient();
    const tokens = this.commandContext.tokens ?? defaultTokenProvider(ctx.env);
    const fmt = (this.output ?? 'text');

    const opts: InstallOptions = {
      output: fmt,
      bundle: this.bundle,
      lockfile: this.lockfile,
      target: this.target,
      from: this.from,
      dryRun: this.dryRun,
      force: this.force,
      source: this.source,
      interactive: this.interactive,
      allowTarget: this.allowTarget,
      http,
      tokens,
      scope: this.scope as 'user' | 'repository' | undefined,
      commitMode: this.commitMode as RepositoryCommitMode | undefined,
      verbose: this.verbose
    };

    await detectInstallContext(opts, ctx);

    const { bundle: noBundle, lockfile: noLockfile } = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
    if (noBundle && noLockfile && !opts.from && !opts.source) {
      return failWith(ctx, fmt, 'install', new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: provide either <bundle-id> (imperative), --lockfile <path> (declarative), --from <path> (local directory), or --source <hub-id> (list bundles)',
        hint: 'Examples:\n'
          + '  ai-primitives-hub install --from <path> --target my-vscode\n'
          + '  ai-primitives-hub install --lockfile prompt-registry.lock.json\n'
          + '  ai-primitives-hub install --source amadeus-hub --target my-vscode'
      }));
    }

    try {
      const targetName = await resolveTargetName(opts.target, 'install', ctx, () => loadTargets(ctx));
      checkAllowTarget(targetName, opts);
      const configuredTarget = await resolveTarget(targetName, 'install', ctx, () => loadTargets(ctx));
      const target = resolveEffectiveTarget(ctx, configuredTarget, opts);

      const mode = determineInstallMode(opts);
      if (mode === undefined) {
        return await performRemoteInstall(opts, target, ctx, fmt);
      }

      return await executeInstallMode(mode, opts, target, ctx, fmt);
    } catch (err) {
      if (err instanceof RegistryError) {
        return failWith(ctx, fmt, 'install', err);
      }
      throw err;
    }
  }
}

/**
 * Determine the installation mode based on options.
 * @param opts Install options.
 * @returns Installation mode.
 */
function determineInstallMode(opts: InstallOptions): 'local' | 'lockfile' | 'remote' | 'interactive' | 'list' | undefined {
  const { bundle: noBundle } = validateInputs(opts, { flags: ['bundle', 'lockfile'] });

  if (opts.source !== undefined && opts.source.length > 0 && noBundle) {
    return opts.interactive ? 'interactive' : 'list';
  }
  if (opts.from !== undefined && opts.from.length > 0) {
    return 'local';
  }
  if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
    return 'lockfile';
  }
  return 'remote';
}

async function autoDetectHubSource(opts: InstallOptions, ctx: Context, userPaths: ReturnType<typeof resolveUserConfigPaths>): Promise<void> {
  if (!(await ctx.fs.exists(userPaths.root))) {
    return;
  }
  const activeStore = new ActiveHubStore(userPaths.activeHub, ctx.fs);
  const hubId = await activeStore.get();
  if (hubId === null) {
    return;
  }
  const store = new HubStore(userPaths.hubs, ctx.fs);
  if (await store.has(hubId)) {
    opts.source = hubId;
    opts.interactive = true;
  }
}

/**
 * Detect install context from the project environment.
 * Fills in `opts.lockfile`, `opts.source`, `opts.interactive`, and `opts.target`
 * when they can be inferred without user input.
 * @param opts Install options (mutated in-place).
 * @param ctx CLI context.
 */
async function detectInstallContext(opts: InstallOptions, ctx: Context): Promise<void> {
  const { bundle: noBundle, lockfile: noLockfile } = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
  const noExplicitSource = !opts.source || opts.source.length === 0;
  const noMode = noBundle && noLockfile && !opts.from && noExplicitSource;

  const userPaths = resolveUserConfigPaths(ctx.env);

  if (noMode && !opts.interactive) {
    const found = await findProjectLockfile(ctx);
    if (found !== null) {
      opts.lockfile = found;
    }
  }

  if (noMode && (!opts.lockfile || opts.lockfile.length === 0)) {
    try {
      await autoDetectHubSource(opts, ctx, userPaths);
    } catch {
      // Ignore errors; proceed without auto-detected hub
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
 * Execute installation based on determined mode.
 * @param mode Installation mode.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function executeInstallMode(
  mode: string,
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  switch (mode) {
    case 'interactive': {
      return await interactiveBundleSelection(opts, target, ctx, fmt);
    }
    case 'list': {
      return await listSourceBundles(opts, ctx, fmt);
    }
    case 'local': {
      return await performLocalInstall(opts, target, ctx, fmt);
    }
    case 'lockfile': {
      return await performLockfileInstall(opts, target, ctx, fmt);
    }
    default: {
      return await performRemoteInstall(opts, target, ctx, fmt);
    }
  }
}

/**
 * Create a writer factory that routes to the appropriate
 * writer based on target scope.
 * - user scope → FileTreeTargetWriter
 * - repository scope → RepositoryScopeWriter
 * @param ctx CLI context.
 * @param opts Install options.
 * @returns Writer factory function.
 */
export const createWriterFactory = (
  ctx: Context,
  opts: InstallOptions
): (target: Target) => TargetWriter => {
  // Create transformer registry and hierarchical layout loader once per command.
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

    // Copilot / VS Code repository scope still writes the .github tree and
    // supports commitMode / .git/info/exclude. Every other target uses the
    // data-driven FileTreeTargetWriter with its repository scope layout.
    const copilotLikeTargets = new Set<string>(['vscode', 'vscode-insiders', 'copilot-cli']);
    if (scope === 'repository' && copilotLikeTargets.has(effectiveTarget.type)) {
      const writer = new RepositoryScopeWriter({
        fs: ctx.fs,
        workspaceRoot,
        commitMode
      });
      return new RepositoryScopeWriterAdapter(writer);
    }
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
 * List bundles from a hub source.
 * @param opts Install options.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function listSourceBundles(
  opts: InstallOptions,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const hubId = opts.source as string;

  try {
    const mgr = createHubManager({ ctx });

    await mgr.syncHub(hubId);
    const active = await requireActiveHubOrFail(mgr, hubId, 'install', ctx, fmt);
    if (typeof active === 'number') {
      return active;
    }

    const bundles = active.config.profiles.flatMap((p: { bundles: { id: string; version: string; source: string }[] }) => p.bundles);
    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        hubId,
        bundles: bundles.map((b: { id: string; version: string; source: string }) => ({ id: b.id, version: b.version, source: b.source }))
      },
      textRenderer: (d) => `Available bundles in hub "${d.hubId}":\n`
        + d.bundles.map((b: { id: string; version: string; source: string }) => `  ${b.id}@${b.version} (source: ${b.source})`).join('\n')
        + '\n\nInstall with: ai-primitives-hub install <bundle-id> --source <hub-id> --target <target>\n'
    });
    return 0;
  } catch (err) {
    if (err instanceof RegistryError) {
      return failWith(ctx, fmt, 'install', err);
    }
    return failWith(ctx, fmt, 'install', new RegistryError({
      code: 'HUB.LOAD_FAILED',
      message: `Failed to load hub "${hubId}": ${err instanceof Error ? err.message : String(err)}`,
      cause: err instanceof Error ? err : undefined
    }));
  }
}

function buildInstallError(err: unknown): RegistryError {
  return new RegistryError({
    code: 'INSTALL.ERROR',
    message: err instanceof Error ? err.message : String(err),
    hint: 'Check the hub configuration and try again.'
  });
}

/**
 * Interactive bundle selection and installation.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function interactiveBundleSelection(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const hubId = opts.source as string;

  try {
    const mgr = createHubManager({ ctx });
    await mgr.syncHub(hubId);
    const active = await requireActiveHubOrFail(mgr, hubId, 'install', ctx, fmt);
    if (typeof active === 'number') {
      return active;
    }

    const sourceMap = buildSourceMap(active.config.sources);
    const bundles = deduplicateBundles(active.config.profiles);
    const bundleChoices = buildBundleChoices(bundles);
    const selectedBundles = await promptBundleSelection(bundleChoices, bundles);

    if (selectedBundles.length === 0) {
      return 0;
    }

    previewInstallation(selectedBundles, target.name, ctx);
    const confirmed = await confirmInstallation(ctx);
    if (!confirmed) {
      return 0;
    }

    const installedCount = await installSelectedBundles(selectedBundles, sourceMap, opts, target, ctx, fmt);

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: { installed: installedCount, total: selectedBundles.length },
      textRenderer: (d) => `Installed ${d.installed}/${d.total} bundles\n`
    });
    return 0;
  } catch (err) {
    return failWith(ctx, fmt, 'install', buildInstallError(err));
  }
}

function buildSourceMap(sources: RegistrySource[]): Map<string, RegistrySource> {
  const sourceMap = new Map<string, RegistrySource>();
  for (const source of sources) {
    sourceMap.set(source.id, source);
    sourceMap.set(source.name, source);
  }
  return sourceMap;
}

function deduplicateBundles(profiles: { bundles: { id: string; version: string; source: string }[] }[]): { id: string; version: string; source: string }[] {
  const allBundles = profiles.flatMap((p) => p.bundles);
  const seenBundleKeys = new Set<string>();
  return allBundles.filter((b) => {
    const key = `${b.id}::${b.source}`;
    if (seenBundleKeys.has(key)) {
      return false;
    }
    seenBundleKeys.add(key);
    return true;
  });
}

function buildBundleChoices(bundles: { id: string; version: string; source: string }[]): { name: string; value: string; short: string }[] {
  return bundles.map((b) => ({
    name: `${b.id}@${b.version} (source: ${b.source})`,
    value: b.id,
    short: b.id
  }));
}

async function promptBundleSelection(
  bundleChoices: { name: string; value: string; short: string }[],
  bundles: { id: string }[]
): Promise<{ id: string; version: string; source: string }[]> {
  const inquirer = await loadInquirer();
  const answers = await inquirer.prompt<{ selectedBundles: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedBundles',
      message: 'Select bundles to install:',
      choices: bundleChoices,
      validate: (input: string[]) => input.length > 0 || 'Please select at least one bundle'
    }
  ]);

  const selectedBundleIds = answers.selectedBundles;
  return bundles.filter((b) => selectedBundleIds.includes(b.id)) as { id: string; version: string; source: string }[];
}

function previewInstallation(bundles: { id: string; version: string; source: string }[], targetName: string, ctx: Context): void {
  ctx.stdout.write(`\nPreview: Installing ${bundles.length} bundle${bundles.length === 1 ? '' : 's'} to target "${targetName}"\n`);
  for (const b of bundles) {
    ctx.stdout.write(`  - ${b.id}@${b.version} (source: ${b.source})\n`);
  }
}

async function confirmInstallation(ctx: Context): Promise<boolean> {
  const inquirer = await loadInquirer();
  const confirm = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with installation?',
      default: true
    }
  ]);

  if (!confirm.proceed) {
    ctx.stdout.write('Installation cancelled.\n');
    return false;
  }
  return true;
}

async function installSelectedBundles(
  bundles: { id: string; version: string; source: string }[],
  sourceMap: Map<string, RegistrySource>,
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  let installedCount = 0;
  const sourceAwareDependencyCache = isGitHubAppAuthEnabled(ctx.env)
    ? createSourceAwareInstallDependencyCache(opts.http ?? new NodeHttpClient(), ctx)
    : undefined;
  for (const bundle of bundles) {
    const source = sourceMap.get(bundle.source);
    if (!source) {
      ctx.stderr.write(`Failed to install ${bundle.id}@${bundle.version}: source "${bundle.source}" not found in hub\n`);
      continue;
    }
    const bundleOpts = {
      ...opts,
      bundle: bundle.id,
      source: source.url,
      sourceConfig: source,
      sourceAwareDependencyCache
    };
    try {
      const result = await performRemoteInstall(bundleOpts, target, ctx, fmt);
      if (result === 0) {
        installedCount++;
      }
    } catch (err) {
      ctx.stderr.write(`Failed to install ${bundle.id}@${bundle.version}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return installedCount;
}

/**
 * Check if target is in allowlist.
 * @param targetName Target name.
 * @param opts Install options.
 */
function checkAllowTarget(targetName: string, opts: InstallOptions): void {
  if (opts.allowTarget === undefined || opts.allowTarget.length === 0) {
    return;
  }
  const allowSet = new Set(
    opts.allowTarget.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  );
  if (!allowSet.has(targetName)) {
    throw new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `install: target "${targetName}" is not in --allow-target=${opts.allowTarget}`,
      hint: 'Add it to --allow-target or unset the flag to allow any configured target.',
      context: { target: targetName, allowTarget: opts.allowTarget }
    });
  }
}

interface UnifiedInstallArgs {
  ctx: Context;
  fmt: OutputFormat;
  target: Target;
  dryRun: boolean;
  force: boolean;
  request: Omit<DeployRequest, 'force'>;
  /** Extra keys merged into the output `data` (e.g. remote `source` and `sha256`). */
  extra?: Record<string, unknown>;
}

type UnifiedMigration = DeployResult['migration'];

type RemoteSourceDescriptor = Pick<DeployRequest['source'], 'type' | 'url' | 'branch' | 'collectionsPath'>;

/**
 * Describe the source a remote install actually resolved from: the configured
 * source's own URL when there is one, then the enterprise host the GitHub App
 * preflight resolved, and only then the github.com slug recipe.
 * @param repoSlug Resolved `owner/repo` slug.
 * @param sourceConfig Configured source, when the install was source-aware.
 * @param repositoryTarget Preflight-resolved repository target, when GitHub App auth is on.
 * @returns Descriptor fields for `DeployRequest.source`.
 */
function remoteSourceDescriptor(
  repoSlug: string,
  sourceConfig: RegistrySource | undefined,
  repositoryTarget: GitHubRepositoryTarget | undefined
): RemoteSourceDescriptor {
  const fallbackUrl = repositoryTarget === undefined
    ? `https://github.com/${repoSlug}`
    : `https://${repositoryTarget.host}/${repositoryTarget.owner}/${repositoryTarget.repository}`;
  const branch = sourceConfig?.config?.branch;
  const collectionsPath = sourceConfig?.config?.collectionsPath;
  return {
    type: sourceConfig?.type ?? 'github',
    url: sourceConfig?.url === undefined || sourceConfig.url.length === 0 ? fallbackUrl : sourceConfig.url,
    ...(typeof branch === 'string' && branch.length > 0 ? { branch } : {}),
    ...(typeof collectionsPath === 'string' && collectionsPath.length > 0 ? { collectionsPath } : {})
  };
}

/**
 * Read the lockfile pair's raw contents, `null` for an absent file, so a run can
 * report whether it actually changed them.
 * @param ctx CLI context.
 * @param paths Lockfile pair paths.
 * @param paths.desiredFile Desired-state file path.
 * @param paths.localFile Local materialization file path.
 * @returns Raw contents of the desired and local files.
 */
async function snapshotLockfiles(
  ctx: Context,
  paths: { desiredFile: string; localFile: string }
): Promise<(string | null)[]> {
  return await Promise.all([paths.desiredFile, paths.localFile].map(
    async (file) => await ctx.fs.exists(file) ? await ctx.fs.readFile(file) : null
  ));
}

const unifiedPortsFor = (ctx: Context, target: Target): DeployPorts => ({
  ...buildDeployPorts(ctx, { scope: 'user' }),
  transformer: transformerFor(target)
});

const dryRunNotMigrated = (cause: LockfileGenerationMismatchError): RegistryError => new RegistryError({
  code: 'CONFIG.LOCKFILE_NOT_MIGRATED',
  message: `install: the lockfile at ${cause.file} is a v${cause.found} lockfile and has not been migrated to v${cause.expected}, so a dry run cannot plan against it.`,
  hint: 'Run the install without --dry-run to migrate it — migration runs on install, never on a dry run.',
  context: { file: cause.file, found: cause.found, expected: cause.expected },
  cause
});

const renderMigration = (migration: UnifiedMigration): string => {
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
 * Flag-on install: plan (dry-run) or deploy through `app/deploy`, then render
 * the legacy envelope keys plus `collisions`, `satisfied` and `migration`.
 * @param args Install arguments.
 * @returns Exit code.
 */
async function runUnifiedInstall(args: UnifiedInstallArgs): Promise<number> {
  const {
    ctx, fmt, target, dryRun, force, request, extra
  } = args;
  const ports = unifiedPortsFor(ctx, target);
  const bundle = { id: request.bundle.bundleId, version: request.bundle.version };

  if (dryRun) {
    const plan = await planDeploy({ ...request, force }, ports).catch((cause: unknown) => {
      // Migration runs on install, never on a dry run, so a v2 lockfile cannot be planned against.
      throw cause instanceof LockfileGenerationMismatchError ? dryRunNotMigrated(cause) : cause;
    });
    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundle,
        files: [...(request.files?.keys() ?? [])],
        destinations: plan.destinations.map((d) => d.to),
        skipped: plan.skipped,
        collisions: plan.collisions,
        satisfied: plan.satisfied,
        drifted: plan.drifted,
        ...extra
      },
      textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
        + `(${d.destinations.length} destination${d.destinations.length === 1 ? '' : 's'}, `
        + `${d.collisions.length} collision${d.collisions.length === 1 ? '' : 's'}, `
        + `${d.satisfied.length} already satisfied) into target "${d.target}".\n`
    });
    return 0;
  }

  const before = await snapshotLockfiles(ctx, ports.lockfileStore);
  const result = await deployBundle({ ...request, force }, ports);
  const after = await snapshotLockfiles(ctx, result.lockfiles);
  const lockfileUpdated = before.some((content, i) => content !== after[i]);
  formatOutput({
    ctx,
    command: 'install',
    output: fmt,
    status: result.collisions.length > 0 ? 'warning' : 'ok',
    data: {
      target: target.name,
      bundle,
      written: result.written,
      skipped: result.skipped,
      lockfile: result.lockfiles.desiredFile,
      collisions: result.collisions,
      satisfied: result.satisfied,
      migration: result.migration,
      ...extra
    },
    warnings: result.collisions.length > 0
      ? result.collisions.map((c) => `${c.to}: existing untracked file left in place (use --force to overwrite)`)
      : undefined,
    textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} into target "${d.target}" `
      + `(${d.written.length} written, ${d.skipped.length} skipped, ${d.satisfied.length} already satisfied, `
      + `${d.collisions.length} collision${d.collisions.length === 1 ? '' : 's'}). `
      + `${lockfileUpdated ? `Updated ${d.lockfile}.` : 'Lockfile unchanged.'}\n${renderMigration(d.migration)}`
  });
  return 0;
}

/**
 * Perform local install from directory.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLocalInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  let unified = false;
  try {
    const effectiveTarget = resolveEffectiveTarget(ctx, target, opts);
    // Refuse before any read: an unsupported scope must not touch the source tree or the lockfiles.
    unified = unifiedDeployRequested(ctx);
    if (unified) {
      assertUnifiedDeploySupported(effectiveTarget);
    }
    const files = await readLocalBundle(opts.from as string, ctx.fs);
    const manifest = validateManifest(files, {
      expectedId: opts.bundle ?? '',
      expectedVersion: undefined
    });
    if (unified) {
      return await runUnifiedInstall({
        ctx,
        fmt,
        target: effectiveTarget,
        dryRun: opts.dryRun === true,
        force: opts.force === true,
        request: {
          files,
          bundle: { bundleId: manifest.id, version: manifest.version },
          source: {
            sourceId: `local-${path.basename(opts.from as string)}`,
            type: 'local',
            url: path.resolve(ctx.cwd(), opts.from as string)
          },
          targetName: effectiveTarget.name,
          runtimeAssetRoot: runtimeAssetRootFor(ctx),
          placement: await buildPlacementContext(ctx, effectiveTarget)
        }
      });
    }
    if (opts.dryRun === true) {
      formatOutput({
        ctx,
        command: 'install',
        output: fmt,
        status: 'ok',
        data: {
          dryRun: true,
          target: effectiveTarget.name,
          bundle: { id: manifest.id, version: manifest.version },
          files: [...files.keys()]
        },
        textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
          + `(${d.files.length} file${d.files.length === 1 ? '' : 's'}) into target "${d.target}".\n`
      });
      return 0;
    }
    const writerFactory = createWriterFactory(ctx, opts);
    const writer = writerFactory(effectiveTarget);
    const targetFiles = getInstallableBundleFiles(files, manifest);
    const result = await writeTargetSafely(writer, effectiveTarget, targetFiles);

    const scope = effectiveTarget.scope;
    const commitMode = effectiveTarget.commitMode ?? 'commit';
    const lockPath = lockfilePathForTarget(ctx, effectiveTarget);
    const existing = await readLockfile(lockPath, ctx.fs) ?? emptyLockfile('ai-primitives-hub-cli');
    const localSourceId = `local-${path.basename(opts.from as string)}`;
    const entry: LockfileBundleEntry = {
      version: manifest.version,
      sourceId: localSourceId,
      sourceType: 'local',
      installedAt: new Date().toISOString(),
      files: checksumFiles(targetFiles, result.writtenBundlePaths ?? targetFiles.keys())
    };
    if (scope === 'repository') {
      entry.commitMode = commitMode;
    }
    let nextLock = upsertBundleEntry(existing, manifest.id, entry);
    nextLock = upsertSource(nextLock, localSourceId, {
      type: 'local',
      url: path.resolve(ctx.cwd(), opts.from as string)
    });
    await writeLockfile(lockPath, nextLock, ctx.fs);

    await updateTargetState(ctx, effectiveTarget.name, manifest.id, manifest.version);

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        target: effectiveTarget.name,
        bundle: { id: manifest.id, version: manifest.version },
        written: result.written,
        skipped: result.skipped,
        lockfile: lockPath
      },
      textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} into target "${d.target}" `
        + `(${d.written.length} written, ${d.skipped.length} skipped). `
        + `Updated ${d.lockfile}.\n`
    });
    return 0;
  } catch (cause) {
    if (unified && cause instanceof RegistryError) {
      throw cause;
    }
    const raw = (cause as { code?: string }).code;
    const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
      ? raw
      : 'INTERNAL.UNEXPECTED';
    throw new RegistryError({
      code,
      message: `install: ${(cause as Error).message}`,
      hint: 'Run `ai-primitives-hub doctor` for environment diagnostics.',
      context: { from: opts.from },
      cause: cause instanceof Error ? cause : undefined
    });
  }
}

const sourceDescriptorFrom = (src: LockfileSourceEntry): RemoteSourceDescriptor => ({
  type: src.type,
  url: src.url,
  ...(src.branch === undefined ? {} : { branch: src.branch }),
  ...(src.collectionsPath === undefined ? {} : { collectionsPath: src.collectionsPath })
});

const failureReason = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/**
 * Read the v3 desired state to replay. A v2 file is only migrated when it is the user
 * lockfile itself and this is not a dry run (migration runs on install, never on a dry run);
 * any other v2 file is refused rather than replayed through a path that records nothing.
 * @param ports Deploy ports (their lockfile store is the pair replayed entries are recorded in).
 * @param lockPath Lockfile to replay.
 * @param dryRun Whether this is a dry run.
 * @returns The desired state and the migration report, when one ran.
 * @throws {RegistryError} CONFIG.LOCKFILE_NOT_MIGRATED for a v2 lockfile that cannot be migrated here.
 */
async function readReplayDesired(
  ports: DeployPorts,
  lockPath: string,
  dryRun: boolean
): Promise<{ desired: LockfileV3Pair['desired']; migration: UnifiedMigration }> {
  const defaults = { generatedBy: ports.generatedBy ?? 'ai-primitives-hub', now: new Date().toISOString() };
  try {
    const { pair } = await readLockfileV3Pair(
      { desiredFile: lockPath, localFile: ports.lockfileStore.localFile },
      ports.fs,
      defaults
    );
    return { desired: pair.desired, migration: null };
  } catch (cause) {
    if (!(cause instanceof LockfileGenerationMismatchError)) {
      throw cause;
    }
    if (lockPath !== ports.lockfileStore.desiredFile) {
      throw new RegistryError({
        code: 'CONFIG.LOCKFILE_NOT_MIGRATED',
        message: `install: the lockfile at ${cause.file} is a v${cause.found} lockfile and has not been migrated to v${cause.expected}; `
          + 'a lockfile other than the user lockfile is not migrated by --lockfile replay.',
        hint: `Replay ${ports.lockfileStore.desiredFile} instead, or unset AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to replay this file as it is.`,
        context: { file: cause.file, found: cause.found, expected: cause.expected },
        cause
      });
    }
    if (dryRun) {
      throw dryRunNotMigrated(cause);
    }
    const { pair, report } = await migrateLockfileIfNeeded(ports.lockfileStore, ports.fs, defaults);
    return { desired: pair.desired, migration: report };
  }
}

interface ReplayRequestArgs {
  key: string;
  desired: LockfileV3Pair['desired'];
  target: Target;
  placement: PlacementContext;
  ctx: Context;
  http: HttpClient;
  tokens: TokenProvider;
  verbose: boolean;
  sourceAwareDependencyCache?: SourceAwareInstallDependencyCache;
}

/**
 * Build the deploy request for one desired entry: the source descriptor recorded in
 * `desired.sources` is fetched with the legacy replay's `fetchFilesForSource`, and the exact
 * recorded version is required of the result (design §3.2): an absent version fails, it never
 * falls back to latest.
 * @param args Entry and fetch dependencies.
 * @returns The deploy request.
 * @throws {Error} With an actionable reason when the entry cannot be replayed.
 */
async function buildReplayRequest(args: ReplayRequestArgs): Promise<Omit<DeployRequest, 'force'>> {
  const { key, desired, target, placement, ctx, verbose } = args;
  const entry = desired.bundles[key];
  const parsed = parseLogicalBundleKey(key);
  if (parsed === null) {
    throw new Error(`"${key}" is not a {sourceId}/{bundleId} bundle key, so it cannot be replayed`);
  }
  if (parsed.sourceId !== entry.sourceId) {
    throw new Error(`the key names source "${parsed.sourceId}" but the entry records sourceId "${entry.sourceId}"; fix the lockfile before replaying it`);
  }
  const src: LockfileSourceEntry | undefined = desired.sources[entry.sourceId];
  if (src === undefined) {
    throw new Error(`source "${entry.sourceId}" has no descriptor in the lockfile's sources, so it cannot be replayed`);
  }
  const files = await fetchFilesForSource(
    src,
    parsed.manifestId,
    {
      version: entry.version,
      sourceId: entry.sourceId,
      sourceType: src.type,
      installedAt: new Date().toISOString(),
      files: [],
      ...(entry.archiveSha === undefined ? {} : { checksum: entry.archiveSha.replace(/^sha256:/, '') })
    },
    args.http,
    args.tokens,
    ctx,
    verbose,
    args.sourceAwareDependencyCache
  );
  if (files === null) {
    throw new Error(`version ${entry.version} was not found in source "${entry.sourceId}" (${src.url}), `
      + 'or its archive did not match the recorded checksum; the pin is exact, so no other version was substituted');
  }
  validateManifest(files, { expectedId: parsed.manifestId, expectedVersion: entry.version });
  return {
    files,
    bundle: { bundleId: parsed.manifestId, version: entry.version },
    source: { sourceId: entry.sourceId, ...sourceDescriptorFrom(src) },
    targetName: target.name,
    runtimeAssetRoot: runtimeAssetRootFor(ctx),
    placement
  };
}

/**
 * Flag-on `install --lockfile`: replay each desired entry of a v3 lockfile through
 * `app/deploy`, or plan it (read-only) on a dry run. One entry failing does not stop the
 * others: each `deployBundle` is its own atomic pair write and cleans up its own files, so
 * a failure leaves nothing half-applied for the next entry to trip over.
 * @param opts Install options.
 * @param target Effective target (user scope, already checked).
 * @param ctx CLI context.
 * @param fmt Output format.
 * @param lockPath Absolute path of the lockfile to replay.
 * @returns Exit code: 1 when any entry failed.
 */
async function performUnifiedLockfileInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat,
  lockPath: string
): Promise<number> {
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const ports = unifiedPortsFor(ctx, target);
  const { desired, migration } = await readReplayDesired(ports, lockPath, dryRun);
  const placement = await buildPlacementContext(ctx, target);
  const http = opts.http ?? new NodeHttpClient();
  const tokens = opts.tokens ?? defaultTokenProvider(ctx.env);
  const sourceAwareDependencyCache = isGitHubAppAuthEnabled(ctx.env)
    ? createSourceAwareInstallDependencyCache(http, ctx)
    : undefined;
  const keys = Object.keys(desired.bundles);

  const replayed: string[] = [];
  const failures: { key: string; reason: string }[] = [];
  const written: string[] = [];
  const destinations: string[] = [];
  const drifted: string[] = [];
  const satisfied: string[] = [];
  const skipped: { key: string; from: string; reason: string }[] = [];
  const collisions: { to: string; reason: string }[] = [];

  if (opts.verbose === true) {
    ctx.stdout.write(`[verbose] Planning to replay ${keys.length} bundles\n`);
  }

  for (const key of keys) {
    try {
      const request = await buildReplayRequest({
        key,
        desired,
        target,
        placement,
        ctx,
        http,
        tokens,
        verbose: opts.verbose ?? false,
        sourceAwareDependencyCache
      });
      if (dryRun) {
        const plan = await planDeploy({ ...request, force }, ports);
        destinations.push(...plan.destinations.map((d) => d.to));
        drifted.push(...plan.drifted);
        satisfied.push(...plan.satisfied);
        skipped.push(...plan.skipped.map((s) => ({ key, ...s })));
        collisions.push(...plan.collisions);
      } else {
        const result = await deployBundle({ ...request, force }, ports);
        written.push(...result.written);
        satisfied.push(...result.satisfied);
        skipped.push(...result.skipped.map((s) => ({ key, ...s })));
        collisions.push(...result.collisions);
      }
      replayed.push(key);
    } catch (cause) {
      if (dryRun && cause instanceof LockfileGenerationMismatchError) {
        throw dryRunNotMigrated(cause);
      }
      failures.push({ key, reason: failureReason(cause) });
    }
  }

  const warnings = [
    ...failures.map((f) => `${f.key}: ${f.reason}`),
    ...collisions.map((c) => `${c.to}: existing untracked file left in place (use --force to overwrite)`)
  ];
  const failureText = (list: { key: string; reason: string }[]): string => list.length === 0
    ? '.\n'
    : `; ${list.length} failure${list.length === 1 ? '' : 's'}:\n${list.map((f) => `  - ${f.key}: ${f.reason}\n`).join('')}`;
  const status = warnings.length > 0 ? 'warning' : 'ok';

  if (dryRun) {
    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status,
      data: {
        dryRun: true,
        lockfile: lockPath,
        target: target.name,
        replayPlanned: keys.length,
        wouldReplay: replayed,
        destinations,
        skipped,
        collisions,
        satisfied,
        drifted,
        failures
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      textRenderer: (d) => `Dry run: would replay ${d.wouldReplay.length}/${d.replayPlanned} bundles `
        + `(${d.destinations.length} destination${d.destinations.length === 1 ? '' : 's'}, `
        + `${d.collisions.length} collision${d.collisions.length === 1 ? '' : 's'}, `
        + `${d.satisfied.length} already satisfied) into target "${d.target}"${failureText(d.failures)}`
    });
    return failures.length === 0 ? 0 : 1;
  }

  formatOutput({
    ctx,
    command: 'install',
    output: fmt,
    status,
    data: {
      lockfile: lockPath,
      target: target.name,
      replayPlanned: keys.length,
      replayed,
      failures,
      written,
      skipped,
      collisions,
      satisfied,
      migration
    },
    warnings: warnings.length > 0 ? warnings : undefined,
    textRenderer: (d) => `Replay: ${d.replayed.length}/${d.replayPlanned} bundles installed into target "${d.target}" `
      + `(${d.written.length} written, ${d.satisfied.length} already satisfied, `
      + `${d.collisions.length} collision${d.collisions.length === 1 ? '' : 's'})${failureText(d.failures)}${renderMigration(d.migration)}`
  });
  return failures.length === 0 ? 0 : 1;
}

/**
 * Flag-off `install --lockfile --dry-run`: say which entries a replay would install,
 * without fetching or writing anything (not the writer, not the target state).
 * @param lock Lockfile that would be replayed.
 * @param lockPath Path of that lockfile.
 * @param target Effective target.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code 0.
 */
function reportLockfileReplayPlan(
  lock: Lockfile,
  lockPath: string,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): number {
  const wouldReplay = Object.keys(lock.bundles);
  formatOutput({
    ctx,
    command: 'install',
    output: fmt,
    status: 'ok',
    data: {
      dryRun: true,
      lockfile: lockPath,
      target: target.name,
      replayPlanned: wouldReplay.length,
      wouldReplay
    },
    textRenderer: (d) => `Dry run: would replay ${d.replayPlanned} bundle${d.replayPlanned === 1 ? '' : 's'} `
      + `from ${d.lockfile} into target "${d.target}".\n`
  });
  return 0;
}

/**
 * Perform lockfile-based install.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLockfileInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const effectiveTarget = resolveEffectiveTarget(ctx, target, opts);
  let unified: boolean;
  try {
    unified = unifiedDeployRequested(ctx);
  } catch (cause) {
    throw new RegistryError({
      code: 'USAGE.INVALID_FLAG',
      message: `install: ${failureReason(cause)}`,
      hint: 'Set AI_PRIMITIVES_HUB_UNIFIED_DEPLOY to 1, true, yes, 0, false or no, or unset it.',
      cause
    });
  }
  // Refuse before reading any lockfile: an unsupported scope must not touch the user pair.
  if (unified) {
    assertUnifiedDeploySupported(effectiveTarget);
  }
  const lockfile = opts.lockfile as string;
  const lockPath = path.isAbsolute(lockfile)
    ? lockfile
    : path.join(ctx.cwd(), lockfile);
  if (unified) {
    return await performUnifiedLockfileInstall(opts, effectiveTarget, ctx, fmt, lockPath);
  }
  const lock = await readLockfile(lockPath, ctx.fs) ?? emptyLockfile('ai-primitives-hub-cli');
  if (opts.dryRun === true) {
    // Parity with the local and remote branches, which have always checked this (design §10).
    return reportLockfileReplayPlan(lock, lockPath, effectiveTarget, ctx, fmt);
  }
  const bundleIds = Object.keys(lock.bundles);
  const http = opts.http ?? new NodeHttpClient();
  const tokens = opts.tokens ?? defaultTokenProvider(ctx.env);
  const writerFactory = createWriterFactory(ctx, opts);
  const writer = writerFactory(effectiveTarget);
  const sourceAwareDependencyCache = isGitHubAppAuthEnabled(ctx.env)
    ? createSourceAwareInstallDependencyCache(http, ctx)
    : undefined;

  const { replayed, failures } = await replayLockfileEntries({
    bundleIds,
    lock,
    http,
    tokens,
    writer,
    target: effectiveTarget,
    ctx,
    verbose: opts.verbose ?? false,
    sourceAwareDependencyCache
  });

  if (replayed.length > 0) {
    await updateTargetStateFromLockfile(ctx, effectiveTarget.name, lock, replayed);
  }

  const status = failures.length === 0 ? 'ok' : 'warning';
  formatOutput({
    ctx,
    command: 'install',
    output: fmt,
    status,
    data: {
      lockfile: lockPath,
      target: effectiveTarget.name,
      replayPlanned: bundleIds.length,
      replayed,
      failures
    },
    warnings: failures.length > 0
      ? failures.map((f) => `${f.bundleId}: ${f.reason}`)
      : undefined,
    textRenderer: (d) => {
      let suffix: string;
      if (d.failures.length === 0) {
        suffix = '.\n';
      } else {
        const plural = d.failures.length === 1 ? '' : 's';
        suffix = `; ${d.failures.length} failure${plural}:\n`
          + d.failures.map((f) => `  - ${f.bundleId}: ${f.reason}\n`).join('');
      }
      return `Replay: ${d.replayed.length}/${d.replayPlanned} bundles installed `
        + `into target "${d.target}"` + suffix;
    }
  });
  return failures.length === 0 ? 0 : 1;
}

/**
 * Perform remote install from GitHub.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performRemoteInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  try {
    const effectiveTarget = resolveEffectiveTarget(ctx, target, opts);
    // Refuse before any network, auth or lockfile effect.
    const unified = unifiedDeployRequested(ctx);
    if (unified) {
      assertUnifiedDeploySupported(effectiveTarget);
    }
    const spec = parseBundleSpec(opts.bundle as string);
    const repoSlug = opts.source ?? spec.sourceId;
    if (repoSlug === undefined || repoSlug.length === 0) {
      throw new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: a remote install needs --source <owner/repo> (or `install owner/repo:<bundleId>`).',
        hint: 'Examples:\n'
          + '  ai-primitives-hub install foo --source owner/repo --target my-vscode\n'
          + '  ai-primitives-hub install owner/repo:foo --target my-vscode\n'
          + '  ai-primitives-hub install foo --from <localDir> --target my-vscode'
      });
    }
    const http = opts.http ?? new NodeHttpClient();
    const tokens = opts.tokens ?? defaultTokenProvider(ctx.env);
    let githubApi: GitHubApi;
    let downloadTokens: TokenProvider;
    let repositoryTarget: GitHubRepositoryTarget | undefined;
    let authenticationCategory: Exclude<GitHubSourceAuthCategory, 'unresolved'> | undefined;
    if (isGitHubAppAuthEnabled(ctx.env)) {
      const dependencies = opts.sourceAwareDependencyCache === undefined
        ? await sourceAwareInstallDependencies(repoSlug, opts.sourceConfig, http, ctx)
        : await opts.sourceAwareDependencyCache.get(repoSlug, opts.sourceConfig);
      githubApi = dependencies.githubApi;
      downloadTokens = dependencies.downloadTokens;
      repositoryTarget = dependencies.repositoryTarget;
      authenticationCategory = dependencies.authenticationCategory;
    } else {
      githubApi = githubApiFor(http, tokens);
      downloadTokens = tokens;
    }

    // Use SourceDispatcher to select the appropriate resolver based on source config
    let resolver: BundleResolver;
    if (opts.sourceConfig) {
      const dispatcher = new SourceDispatcher({ githubApi, fs: ctx.fs });
      const selectedResolver = dispatcher.resolverFor(opts.sourceConfig);
      resolver = selectedResolver ?? new GitHubBundleResolver({ repoSlug, githubApi });
    } else {
      // Default to GitHub resolver when no source config is provided
      resolver = new GitHubBundleResolver({ repoSlug, githubApi });
    }

    const downloader = new HttpsBundleDownloader(http, downloadTokens, repositoryTarget, authenticationCategory);
    const extractor = new ZipBundleExtractor();

    const installable = await resolver.resolve(spec);
    if (installable === null) {
      throw new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: `install: ${spec.bundleId} not found at ${repoSlug}`,
        hint: 'Check the source slug and that a release with the requested version + asset (bundle.zip) exists.',
        context: { spec, repoSlug }
      });
    }
    const dl = await downloader.download(installable);
    const files = await extractor.extract(dl.bytes);
    const manifest = validateManifest(files, {
      expectedId: opts.sourceConfig === undefined ? spec.bundleId : undefined,
      expectedVersion: spec.bundleVersion === 'latest' ? undefined : spec.bundleVersion
    });
    if (unified) {
      const sourceDescriptor = remoteSourceDescriptor(repoSlug, opts.sourceConfig, repositoryTarget);
      return await runUnifiedInstall({
        ctx,
        fmt,
        target: effectiveTarget,
        dryRun: opts.dryRun === true,
        force: opts.force === true,
        // The planner only accepts extracted `files` today (`bytes` alone is refused,
        // and both together are rejected), so the already-extracted tree is passed.
        request: {
          files,
          bundle: { bundleId: manifest.id, version: manifest.version },
          source: { sourceId: installable.ref.sourceId, ...sourceDescriptor },
          targetName: effectiveTarget.name,
          runtimeAssetRoot: runtimeAssetRootFor(ctx),
          placement: await buildPlacementContext(ctx, effectiveTarget)
        },
        extra: {
          source: {
            type: sourceDescriptor.type,
            repo: repoSlug,
            sourceId: installable.ref.sourceId,
            url: sourceDescriptor.url,
            ...(sourceDescriptor.collectionsPath === undefined ? {} : { collectionsPath: sourceDescriptor.collectionsPath })
          },
          sha256: dl.sha256
        }
      });
    }
    if (opts.dryRun === true) {
      formatOutput({
        ctx,
        command: 'install',
        output: fmt,
        status: 'ok',
        data: {
          dryRun: true,
          target: effectiveTarget.name,
          bundle: { id: manifest.id, version: manifest.version },
          source: { type: 'github', repo: repoSlug, downloadUrl: installable.downloadUrl },
          sha256: dl.sha256,
          files: [...files.keys()]
        },
        textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
          + `from ${d.source.repo} (${d.files.length} file${d.files.length === 1 ? '' : 's'}) `
          + `into target "${d.target}".\n`
      });
      return 0;
    }
    const writerFactory = createWriterFactory(ctx, opts);
    const writer = writerFactory(effectiveTarget);
    const targetFiles = getInstallableBundleFiles(files, manifest);
    const result = await writeTargetSafely(writer, effectiveTarget, targetFiles);
    const scope = effectiveTarget.scope;
    const commitMode = effectiveTarget.commitMode ?? 'commit';
    const lockPath = lockfilePathForTarget(ctx, effectiveTarget);
    const existing = await readLockfile(lockPath, ctx.fs) ?? emptyLockfile('ai-primitives-hub-cli');
    const entry: LockfileBundleEntry = {
      version: manifest.version,
      sourceId: installable.ref.sourceId,
      sourceType: installable.ref.sourceType,
      checksum: dl.sha256,
      installedAt: new Date().toISOString(),
      files: checksumFiles(targetFiles, result.writtenBundlePaths ?? targetFiles.keys())
    };
    if (scope === 'repository') {
      entry.commitMode = commitMode;
    }
    let nextLock = upsertBundleEntry(existing, manifest.id, entry);
    const collectionsPath = opts.sourceConfig?.config?.collectionsPath;
    nextLock = upsertSource(nextLock, installable.ref.sourceId, {
      type: opts.sourceConfig?.type ?? 'github',
      url: `https://github.com/${repoSlug}`,
      ...(collectionsPath ? { collectionsPath } : {})
    });
    await writeLockfile(lockPath, nextLock, ctx.fs);

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        target: effectiveTarget.name,
        bundle: { id: manifest.id, version: manifest.version },
        source: { type: 'github', repo: repoSlug, sourceId: installable.ref.sourceId },
        sha256: dl.sha256,
        written: result.written,
        skipped: result.skipped,
        lockfile: lockPath
      },
      textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} from ${d.source.repo} `
        + `into target "${d.target}" (${d.written.length} written, ${d.skipped.length} skipped). `
        + `Updated ${d.lockfile}.\n`
    });
    return 0;
  } catch (cause) {
    if (cause instanceof RegistryError) {
      throw cause;
    }
    const raw = (cause as { code?: string }).code;
    const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
      ? raw
      : 'NETWORK.DOWNLOAD_FAILED';
    throw new RegistryError({
      code,
      message: `install: ${(cause as Error).message}`,
      hint: 'Run `ai-primitives-hub doctor` for environment diagnostics, or use `--from <localDir>` to install a pre-built bundle.',
      context: {
        mode: 'imperative-remote',
        bundle: opts.bundle,
        source: opts.source,
        target: opts.target
      },
      cause: cause instanceof Error ? cause : undefined
    });
  }
}

/**
 * Update target state with installed bundle.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param bundleId Bundle ID.
 * @param version Bundle version.
 */
async function updateTargetState(ctx: Context, targetName: string, bundleId: string, version: string): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.ai-primitives-hub', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
  const bundleState = { bundleId, version, installedAt: new Date().toISOString() };
  if (bundleIndex === -1) {
    newBundles.push(bundleState);
  } else {
    newBundles[bundleIndex] = bundleState;
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Update target state from lockfile entries.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param lock Lockfile.
 * @param replayed Replayed bundle IDs.
 */
async function updateTargetStateFromLockfile(ctx: Context, targetName: string, lock: Lockfile, replayed: string[]): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.ai-primitives-hub', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  for (const bundleId of replayed) {
    const entry = lock.bundles[bundleId];
    if (entry === undefined) {
      continue;
    }
    const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
    const bundleState = { bundleId, version: entry.version, installedAt: entry.installedAt };
    if (bundleIndex === -1) {
      newBundles.push(bundleState);
    } else {
      newBundles[bundleIndex] = bundleState;
    }
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Install a single bundle given an explicit source configuration.
 * Shared by `install --interactive` and `index search --install`.
 * @param bundleId Bundle ID to install.
 * @param sourceConfig Source configuration (hub source).
 * @param target Target to write into.
 * @param ctx CLI context.
 * @param http HTTP client.
 * @param tokens Token provider.
 * @param fmt Output format.
 * @returns Exit code.
 */
export async function installBundleWithSource(
  bundleId: string,
  sourceConfig: RegistrySource,
  target: Target,
  ctx: Context,
  http: HttpClient,
  tokens: TokenProvider,
  fmt: OutputFormat = 'text'
): Promise<number> {
  const opts: InstallOptions = {
    bundle: bundleId,
    source: extractRepoSlug(sourceConfig.url),
    sourceConfig,
    http,
    tokens
  };
  return performRemoteInstall(opts, target, ctx, fmt);
}

/**
 * Build the `install` command (factory function for backward compatibility).
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createInstallCommand = (
  opts: InstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['install'],
    description: 'Install bundles to a configured target.',
    category: 'Install & Manage',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const { bundle: noBundle, lockfile: noLockfile } = validateInputs(opts, { flags: ['bundle', 'lockfile'] });
      if (noBundle && noLockfile) {
        return failWith(ctx, fmt, 'install', new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'install: provide either <bundle-id> (imperative) or --lockfile <path> (declarative)',
          hint: 'Examples:\n'
            + '  ai-primitives-hub install <bundle-id>\n'
            + '  ai-primitives-hub install --lockfile prompt-registry.lock.json'
        }));
      }

      try {
        const targetName = await resolveTargetName(opts.target, 'install', ctx, () => loadTargets(ctx));
        checkAllowTarget(targetName, opts);
        const configuredTarget = await resolveTarget(targetName, 'install', ctx, () => loadTargets(ctx));
        const target = resolveEffectiveTarget(ctx, configuredTarget, opts);

        if (opts.from !== undefined && opts.from.length > 0) {
          return await performLocalInstall(opts, target, ctx, fmt);
        }

        if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
          return await performLockfileInstall(opts, target, ctx, fmt);
        }

        return await performRemoteInstall(opts, target, ctx, fmt);
      } catch (err) {
        if (err instanceof RegistryError) {
          return failWith(ctx, fmt, 'install', err);
        }
        throw err;
      }
    }
  });

/**
 * Replay lockfile entries for installation.
 */
interface ReplayLockfileEntriesOptions {
  bundleIds: string[];
  lock: Lockfile;
  http: HttpClient;
  tokens: TokenProvider;
  writer: TargetWriter;
  target: Target;
  ctx: Context;
  verbose: boolean;
  sourceAwareDependencyCache?: SourceAwareInstallDependencyCache;
}

async function replayLockfileEntries(
  opts: ReplayLockfileEntriesOptions
): Promise<{ replayed: string[]; failures: { bundleId: string; reason: string }[] }> {
  const {
    bundleIds,
    lock,
    http,
    tokens,
    writer,
    target,
    ctx,
    verbose,
    sourceAwareDependencyCache
  } = opts;
  const replayed: string[] = [];
  const failures: { bundleId: string; reason: string }[] = [];

  if (verbose) {
    ctx.stdout.write(`[verbose] Planning to replay ${bundleIds.length} bundles\n`);
  }

  for (const bundleId of bundleIds) {
    const entry = lock.bundles[bundleId];
    const result = await replaySingleEntry({
      bundleId,
      entry,
      sources: lock.sources,
      http,
      tokens,
      writer,
      target,
      ctx,
      verbose,
      sourceAwareDependencyCache
    });
    if (result.success) {
      replayed.push(bundleId);
    } else {
      failures.push({ bundleId, reason: result.reason });
    }
  }

  return { replayed, failures };
}

interface ReplaySingleEntryOptions {
  bundleId: string;
  entry: LockfileBundleEntry;
  sources: Record<string, LockfileSourceEntry>;
  http: HttpClient;
  tokens: TokenProvider;
  writer: TargetWriter;
  target: Target;
  ctx: Context;
  verbose: boolean;
  sourceAwareDependencyCache?: SourceAwareInstallDependencyCache;
}

async function replaySingleEntry(
  opts: ReplaySingleEntryOptions
): Promise<{ success: boolean; reason: string }> {
  const {
    bundleId,
    entry,
    sources,
    http,
    tokens,
    writer,
    target,
    ctx,
    verbose,
    sourceAwareDependencyCache
  } = opts;
  const src = sources[entry.sourceId];
  if (src === undefined) {
    return handleMissingSource(bundleId, entry, verbose, ctx);
  }

  try {
    const files = await fetchFilesForSource(
      src,
      bundleId,
      entry,
      http,
      tokens,
      ctx,
      verbose,
      sourceAwareDependencyCache
    );
    if (files === null) {
      return handleFetchFailure(bundleId, src, verbose, ctx);
    }
    await validateAndWrite(files, bundleId, entry, writer, target, ctx, verbose);
    return { success: true, reason: '' };
  } catch (cause) {
    return handleInstallError(bundleId, cause, verbose, ctx);
  }
}

async function validateAndWrite(
  files: Map<string, Uint8Array>,
  bundleId: string,
  entry: LockfileBundleEntry,
  writer: TargetWriter,
  target: Target,
  ctx: Context,
  verbose: boolean
): Promise<void> {
  const manifest = validateManifest(files, {
    expectedId: bundleId,
    expectedVersion: entry.version
  });
  await writeTargetSafely(writer, target, getInstallableBundleFiles(files, manifest));
  if (verbose) {
    ctx.stdout.write(`[verbose] Successfully installed ${bundleId}\n`);
  }
}

function handleMissingSource(
  bundleId: string,
  entry: LockfileBundleEntry,
  verbose: boolean,
  ctx: Context
): { success: boolean; reason: string } {
  const reason = `source ${entry.sourceId} missing from lockfile.sources`;
  if (verbose) {
    ctx.stdout.write(`[verbose] Skipping ${bundleId}: ${reason}\n`);
  }
  return { success: false, reason };
}

function handleFetchFailure(
  bundleId: string,
  src: LockfileSourceEntry,
  verbose: boolean,
  ctx: Context
): { success: boolean; reason: string } {
  const reason = `failed to fetch files from ${src.type} source`;
  if (verbose) {
    ctx.stdout.write(`[verbose] Skipping ${bundleId}: ${reason}\n`);
  }
  return { success: false, reason };
}

function handleInstallError(
  bundleId: string,
  cause: unknown,
  verbose: boolean,
  ctx: Context
): { success: boolean; reason: string } {
  const reason = (cause as Error).message;
  if (verbose) {
    ctx.stdout.write(`[verbose] Failed to install ${bundleId}: ${reason}\n`);
  }
  return { success: false, reason };
}

/**
 * Fetch a bundle's extracted files from a lockfile source entry —
 * dispatches on `src.type` (`local`, or `github`/AwesomeCopilot via
 * `entry.sourceId`'s prefix) and resolves/downloads/extracts
 * accordingly. Shared by lockfile replay (`replaySingleEntry`) and
 * `profile.ts`'s bundle activation loop.
 * @param src Lockfile source entry describing where to fetch from.
 * @param bundleId Bundle id to fetch.
 * @param entry Lockfile bundle entry — only `.version`/`.sourceId` are read.
 * @param http HTTP client.
 * @param tokens Token provider.
 * @param ctx CLI context.
 * @param verbose Whether to write `[verbose]` progress lines to stdout.
 * @param sourceAwareDependencyCache Optional command-scoped source-aware cache.
 * @returns The extracted files, or `null` if the bundle couldn't be resolved/fetched.
 */
export async function fetchFilesForSource(
  src: LockfileSourceEntry,
  bundleId: string,
  entry: LockfileBundleEntry,
  http: HttpClient,
  tokens: TokenProvider,
  ctx: Context,
  verbose: boolean,
  sourceAwareDependencyCache?: SourceAwareInstallDependencyCache
): Promise<Map<string, Uint8Array> | null> {
  if (src.type === 'local') {
    if (verbose) {
      ctx.stdout.write(`[verbose] Reading local bundle from ${src.url}\n`);
    }
    const files = await readLocalBundle(src.url, ctx.fs);
    return new Map(files);
  }
  if (src.type === 'github' || src.type === 'skills' || src.type === 'awesome-copilot') {
    // Check if this is an awesome-copilot source (detected by sourceId prefix)
    const isAwesomeCopilot = src.type === 'awesome-copilot'
      || bundleId.startsWith('awesome-copilot-')
      || entry.sourceId.startsWith('awesome-copilot-');
    const sourceConfig: RegistrySource = {
      id: entry.sourceId,
      name: entry.sourceId,
      type: isAwesomeCopilot ? 'awesome-copilot' : (src.type === 'skills' ? 'skills' : 'github'),
      url: src.url,
      enabled: true,
      priority: 0,
      config: {
        branch: src.branch,
        collectionsPath: src.collectionsPath
      }
    };
    const repoSlug = extractRepoSlug(src.url);
    let githubApi: GitHubApi;
    let downloadTokens = tokens;
    let repositoryTarget: GitHubRepositoryTarget | undefined;
    let authenticationCategory: Exclude<GitHubSourceAuthCategory, 'unresolved'> | undefined;
    if (isGitHubAppAuthEnabled(ctx.env)) {
      const dependencies = sourceAwareDependencyCache === undefined
        ? await sourceAwareInstallDependencies(repoSlug, sourceConfig, http, ctx)
        : await sourceAwareDependencyCache.get(repoSlug, sourceConfig);
      githubApi = dependencies.githubApi;
      downloadTokens = dependencies.downloadTokens;
      repositoryTarget = dependencies.repositoryTarget;
      authenticationCategory = dependencies.authenticationCategory;
    } else {
      githubApi = githubApiFor(http, tokens);
    }
    if (verbose) {
      ctx.stdout.write(`[verbose] Resolving ${bundleId}@${entry.version} from ${repoSlug} (${isAwesomeCopilot ? 'awesome-copilot' : 'github'})\n`);
    }

    if (isAwesomeCopilot) {
      const acResolver = new AwesomeCopilotBundleResolver({
        repoSlug,
        githubApi,
        collectionsPath: src.collectionsPath
      });
      const acInstallable = await acResolver.resolve({ bundleId, bundleVersion: entry.version });
      if (acInstallable?.inlineBytes === undefined) {
        if (verbose) {
          ctx.stdout.write(`[verbose] AwesomeCopilot resolver returned null or no inline bytes for ${bundleId}@${entry.version}\n`);
        }
        return null;
      }
      if (verbose) {
        ctx.stdout.write(`[verbose] Using inline bundle from AwesomeCopilot resolver\n`);
      }
      const acFiles = await new ZipBundleExtractor().extract(acInstallable.inlineBytes);
      return new Map(acFiles);
    }

    // Use GitHub resolver for regular github sources
    const resolver = new GitHubBundleResolver({ repoSlug, githubApi });
    const downloader = new HttpsBundleDownloader(http, downloadTokens, repositoryTarget, authenticationCategory);
    const installable = await resolver.resolve({ bundleId, bundleVersion: entry.version });
    if (installable === null) {
      if (verbose) {
        ctx.stdout.write(`[verbose] Resolver returned null for ${bundleId}@${entry.version}\n`);
      }
      return null;
    }
    if (verbose) {
      ctx.stdout.write(`[verbose] Downloading from ${installable.downloadUrl}\n`);
    }
    const dl = await downloader.download(installable);
    if (entry.checksum !== undefined && dl.sha256 !== entry.checksum) {
      if (verbose) {
        ctx.stdout.write(`[verbose] SHA256 mismatch: expected ${entry.checksum}, got ${dl.sha256}\n`);
      }
      return null;
    }
    if (verbose) {
      ctx.stdout.write(`[verbose] Extracting bundle\n`);
    }
    const files = await new ZipBundleExtractor().extract(dl.bytes);
    return new Map(files);
  }
  if (verbose) {
    ctx.stdout.write(`[verbose] Unsupported source type: ${src.type}\n`);
  }
  return null;
}
