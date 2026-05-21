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
  GitHubClientError,
} from './github-client-errors';

const execAsync = promisify(exec);

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

  private static parseGitHubUrl(url: string): { owner: string; repo: string } {
    const cleaned = url.replace(/\.git$/, '');
    const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);

    if (!match) {
      throw new GitHubClientError(`Invalid GitHub URL: ${url}`);
    }

    return { owner: match[1], repo: match[2] };
  }
}
