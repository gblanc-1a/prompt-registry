import {
  exec,
} from 'node:child_process';
import {
  promisify,
} from 'node:util';
import {
  Octokit,
} from '@octokit/rest';
import * as vscode from 'vscode';
import {
  GitHubAuthError,
  GitHubClientError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from './github-client-errors';

const execAsync = promisify(exec);

export interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
  sha?: string;
  size?: number;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  assets: GitHubReleaseAsset[];
  published_at: string;
}

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  url: string;
  size: number;
}

export interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

export interface RepoMetadata {
  name: string;
  description: string;
  updatedAt: string;
}

export interface GitHubClientOptions {
  sourceUrl: string;
  explicitToken?: string;
  scopes?: string[];
}

export class GitHubClient {
  public readonly owner: string;
  public readonly repo: string;
  private octokit: Octokit;
  private authenticated = false;
  private authToken: string | undefined;
  private readonly explicitToken: string | undefined;
  private readonly scopes: string[];
  private authMethod: 'vscode' | 'explicit' | 'gh-cli' | 'none' = 'none';

  constructor(options: GitHubClientOptions) {
    const parsed = GitHubClient.parseGitHubUrl(options.sourceUrl);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
    this.explicitToken = options.explicitToken;
    this.scopes = options.scopes ?? ['repo'];
    this.octokit = new Octokit();
  }

  public getAuthMethod(): string {
    return this.authMethod;
  }

  public async authenticate(): Promise<void> {
    if (this.authenticated) {
      return;
    }

    // 1. VS Code GitHub authentication (primary)
    try {
      const session = await vscode.authentication.getSession('github', this.scopes, { createIfNone: true });
      if (session) {
        this.authToken = session.accessToken;
        this.authMethod = 'vscode';
        this.octokit = new Octokit({ auth: this.authToken });
        this.authenticated = true;
        return;
      }
    } catch {
      // Fall through to next method
    }

    // 2. Explicit token from source configuration
    if (this.explicitToken && this.explicitToken.trim().length > 0) {
      this.authToken = this.explicitToken.trim();
      this.authMethod = 'explicit';
      this.octokit = new Octokit({ auth: this.authToken });
      this.authenticated = true;
      return;
    }

    // 3. GitHub CLI
    try {
      const token = await this.execGhAuthToken();
      if (token && token.trim().length > 0) {
        this.authToken = token.trim();
        this.authMethod = 'gh-cli';
        this.octokit = new Octokit({ auth: this.authToken });
        this.authenticated = true;
        return;
      }
    } catch {
      // Fall through to unauthenticated
    }

    // 4. No authentication
    this.authMethod = 'none';
    this.octokit = new Octokit();
    this.authenticated = true;
  }

  private async execGhAuthToken(): Promise<string> {
    const { stdout } = await execAsync('gh auth token');
    return stdout.trim();
  }

  public async getContents(path: string, ref?: string): Promise<GitHubContentItem[]> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ...(ref ? { ref } : {}),
      });
      const data = Array.isArray(response.data) ? response.data : [response.data];
      return data.map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type as 'file' | 'dir',
        download_url: item.download_url ?? undefined,
        sha: item.sha,
        size: item.size,
      }));
    } catch (error: any) {
      this.handleApiError(error, path);
    }
  }

  public async getContentsRecursive(path: string, ref?: string): Promise<GitHubContentItem[]> {
    await this.ensureAuthenticated();
    const items: GitHubContentItem[] = [];
    const queue = [path];

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const contents = await this.getContents(currentPath, ref);
      for (const item of contents) {
        items.push(item);
        if (item.type === 'dir') {
          queue.push(item.path);
        }
      }
    }

    return items;
  }

  public async getFileContent(path: string, ref?: string): Promise<Buffer> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ...(ref ? { ref } : {}),
      });
      const data = response.data as any;
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64');
      }
      throw new GitHubClientError(`Unexpected content format for ${path}`);
    } catch (error: any) {
      if (error instanceof GitHubClientError) {
        throw error;
      }
      this.handleApiError(error, path);
    }
  }

  public async listReleases(): Promise<GitHubRelease[]> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.repos.listReleases({
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
      });
      return response.data as unknown as GitHubRelease[];
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  public async getReleaseByTag(tag: string): Promise<GitHubRelease> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.repos.getReleaseByTag({
        owner: this.owner,
        repo: this.repo,
        tag,
      });
      return response.data as unknown as GitHubRelease;
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  public async getTree(sha: string, recursive?: boolean): Promise<TreeEntry[]> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: sha,
        recursive: recursive ? 'true' : undefined,
      } as any);
      return response.data.tree.map((entry: any) => ({
        path: entry.path,
        type: entry.type,
        sha: entry.sha,
        size: entry.size,
      }));
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  public async getRepository(): Promise<RepoMetadata> {
    await this.ensureAuthenticated();
    try {
      const response = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      return {
        name: response.data.name,
        description: response.data.description || '',
        updatedAt: response.data.updated_at,
      };
    } catch (error: any) {
      this.handleApiError(error);
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.authenticated) {
      await this.authenticate();
    }
  }

  private handleApiError(error: any, path?: string): never {
    if (error.status === 404) {
      throw new GitHubNotFoundError(this.owner, this.repo, path);
    }
    if (error.status === 401 || error.status === 403) {
      const rateLimitReset = error.response?.headers?.['x-ratelimit-reset'];
      if (rateLimitReset && error.status === 403) {
        throw new GitHubRateLimitError(new Date(Number(rateLimitReset) * 1000));
      }
      throw new GitHubAuthError(error.message, error.status);
    }
    throw new GitHubClientError(error.message, error.status);
  }

  private static parseGitHubUrl(url: string): { owner: string; repo: string } {
    const cleaned = url.replace(/\.git$/, '');
    const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);

    if (!match) {
      throw new GitHubClientError(`Invalid GitHub URL: ${url}`);
    }

    return { owner: match[1], repo: match[2] };
  }
}
