/**
 * Deployment types — shared across plan, execute, and verify.
 * @module deploy/types
 */
import type {
  ExtractedFiles,
} from '@ai-primitives-hub/core';
import type {
  InstallationScope,
  PrimitiveKind,
  RepositoryCommitMode,
  TargetLayout,
  TargetType,
} from '@ai-primitives-hub/core';
import type {
  PlacementDestination,
} from '@ai-primitives-hub/core';
import type {
  AppStorage,
} from '../ports/app-storage';
import type {
  Filesystem,
} from '../ports/filesystem';
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
  /** Destinations that already exist with identical bytes (no-op). */
  satisfied: string[];
  /** Untracked collisions (existing files we would overwrite). */
  collisions: DeployConflict[];
  /** Tracked destinations that have drifted from their installedChecksum. */
  drifted: string[];
  /** Tracked destinations that are missing. */
  missing: string[];
  /** Items skipped (unsupported-by-target, filtered, invalid-kind). */
  skipped: { sourcePath: string; reason: string }[];
  /** Destinations claimed by more than one id. */
  duplicates: { to: string; ids: string[] }[];
  /** Unknown layout keys. */
  unknownLayoutKeys: string[];
  /** MCP plan (slice 7). */
  mcp: {
    /** MCP servers to install. */
    servers: {
      /** Server name. */
      name: string;
      /** Configuration object. */
      config: unknown;
    }[];
    /** MCP servers skipped. */
    skipped: {
      /** Server name. */
      name: string;
      /** Reason. */
      reason: string;
    }[];
  };
}

/** A deployment conflict. */
export interface DeployConflict {
  /** Destination path. */
  to: string;
  /** Conflict kind. */
  kind?: 'shared-destination' | 'untracked-existing';
  /** Conflict reason (for user-facing messages). */
  reason?: string;
  /** Other bundle claiming this destination (kind: shared-destination only, slice 3). */
  otherBundle?: string;
}

/** Ports for deployment operations. */
export interface DeployPorts {
  /** Filesystem port. */
  fs: Filesystem;
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
  /** Event listener (for progress reporting). */
  onEvent?: (event: DeployEvent) => void;
}

/** Deployment event. */
export interface DeployEvent {
  /** Event type. */
  type: 'plan' | 'write' | 'state' | 'complete' | 'error';
  /** Event data. */
  data?: unknown;
}
