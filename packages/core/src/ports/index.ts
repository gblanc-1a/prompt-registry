/**
 * Port interfaces — the IO contracts that separate domain/application
 * code from concrete infrastructure adapters.
 *
 * Feature layers (install, registry-config, primitive-index) import
 * only from this barrel; concrete adapters live in `infra/` and are
 * never imported by feature code.
 * @module ports
 */
export type {
  FileSystem,
} from './filesystem';

export type {
  Clock,
  TestClock,
} from './clock';

export type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  TokenProvider,
} from './http';

export type {
  EtaggedNotModified,
  EtaggedOk,
  EtaggedResult,
  GitHubApi,
  RateLimitTelemetry,
} from './github-api';

export type {
  BundleDownloader,
  DownloadResult,
} from './bundle-downloader';

export type {
  BundleExtractor,
  ExtractedFiles,
} from './bundle-extractor';

export type {
  BundleResolver,
} from './source-resolver';

export type {
  TargetWriteResult,
  TargetWriter,
} from './target-writer';

export type {
  LayoutConfigLoader,
} from './layout-config-loader';

export type {
  CopilotSdk,
  CopilotSession,
  SessionOptions,
  PermissionRequest,
  PermissionResponse,
} from './copilot-sdk';

export type {
  McpServer,
  McpTool,
} from './mcp-server';

export type {
  ResourceTransformer,
} from './resource-transformer';
