/**
 * Deployment types — shared across plan, execute, and verify.
 * @module deploy/types
 */
import type {
  AppStorage,
  ExtractedFiles,
  FileSystem,
  InstallationScope,
  PlacementDestination,
  PrimitiveKind,
  RepositoryCommitMode,
  ResourceTransformer,
  TargetLayout,
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  MigrationSources,
} from '../stores/migrate-lockfile-v3';

/** Deployment request. */
export interface DeployRequest {
  /** Extracted files, when the caller already has them. */
  files?: ExtractedFiles;
  /** Archive bytes, when the caller wants the planner to extract. */
  bytes?: Uint8Array;
  /** Expected archive checksum (sha256:hex), when verification is required. */
  expectedArchiveSha?: string;
  /** Bundle identity. */
  bundle: {
    /** Bundle ID. */
    bundleId: string;
    /** Semantic version. */
    version: string;
  };
  /** Source identity. */
  source: {
    /** Source ID. */
    sourceId: string;
    /** Source type. */
    type: string;
    /** Source URL. */
    url?: string;
  };
  /** Target name. */
  targetName: string;
  /** Runtime asset root (for MCP config installation, slice 7). */
  runtimeAssetRoot: string;
  /** Placement configuration. */
  placement: PlacementContext;
  /** Force deployment over drift. */
  force?: boolean;
  /** Repository commit mode (absent at user scope). */
  commitMode?: RepositoryCommitMode;
}

/** Placement context for a deploy operation. */
export interface PlacementContext {
  /** Installation scope. */
  scope: InstallationScope;
  /** Target type. */
  targetType: TargetType;
  /** Resolved layout. */
  resolvedLayout: TargetLayout;
  /** Absolute base root (baseDir expanded with env). */
  baseRoot: string;
  /** Environment variables. */
  env: Record<string, string | undefined>;
  /** Optional filter of allowed kinds. */
  allowedKinds?: PrimitiveKind[];
}

/** Deployment plan — what a deploy would do. */
export interface DeployPlan {
  /** Bundle key being deployed. */
  bundleKey: string;
  /** Destinations to write. */
  destinations: PlacementDestination[];
  /** Destinations that already exist with bytes identical to what this deploy would write (no-op). */
  satisfied: string[];
  /** Untracked collisions (existing files we would overwrite). */
  collisions: { to: string; reason: 'untracked-existing' }[];
  /** Tracked destinations that have drifted from their installedChecksum. */
  drifted: string[];
  /** Tracked destinations that are missing. */
  missing: string[];
  /** Items skipped (unsupported-by-target, filtered, invalid-kind). */
  skipped: { from: string; reason: 'unsupported-by-target' | 'invalid-kind' | 'filtered' }[];
  /** Destinations claimed by more than one id. */
  duplicates: { to: string; ids: string[] }[];
  /** Unknown layout keys. */
  unknownLayoutKeys: string[];
  /**
   * Scope or shared-destination conflict (slice 3+).
   * Typed but unreachable in slice 1.
   */
  conflict?: {
    kind: 'scope' | 'shared-destination';
    bundleId: string;
    scope: 'user' | 'repository';
    at?: string;
    owner?: { targetName: string; bundleId: string };
  };
  /** MCP plan (slice 7). */
  mcp: {
    /** Path to the MCP config file (slice 7). */
    configPath?: string;
    /** MCP server names to install. */
    servers: string[];
    /** MCP servers skipped. */
    skipped: { name: string; reason: string }[];
  };
}

/** Ports for deployment operations. */
export interface DeployPorts {
  /** Filesystem port. */
  fs: FileSystem;
  /** Environment variables. */
  env: Record<string, string | undefined>;
  /** Application storage port. */
  appStorage: AppStorage;
  /** Layout loader (slice 2). */
  layoutLoader?: unknown;
  /** Lockfile store paths. */
  lockfileStore: MigrationSources;
  /** MCP config store (slice 7). */
  mcpConfigStore?: unknown;
  /** Git exclude manager (slice 5). */
  gitExclude?: unknown;
  /** Optional resource transformer for text payloads. */
  transformer?: ResourceTransformer;
  /** Tool identifier for generated metadata. */
  generatedBy?: string;
  /** ISO timestamp for deterministic testing (defaults to wall-clock time). */
  now?: string;
  /** Event listener (for progress reporting). */
  onEvent?: (event: DeployEvent) => void;
}

/** Deployment event. */
export type DeployEvent =
  | { kind: 'place'; path: string }
  | { kind: 'state-write' };

/** Undeployment request. */
export interface UndeployRequest {
  /** Bundle key (sourceId/bundleId). */
  key: string;
  /** Bundle identity. */
  bundle: {
    /** Bundle ID. */
    bundleId: string;
    /** Semantic version. */
    version: string;
  };
  /** Installation scope. */
  scope: InstallationScope;
  /** Target name. */
  targetName: string;
}
