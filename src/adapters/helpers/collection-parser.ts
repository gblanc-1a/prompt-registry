import * as yaml from 'js-yaml';
import type { Bundle } from '../../types/registry';

export interface CollectionManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  items: CollectionItem[];
  display?: { ordering?: string; show_badge?: boolean };
  mcp?: { items?: Record<string, any> };
  mcpServers?: Record<string, any>;
}

export interface CollectionItem {
  path: string;
  kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';
}

export interface CollectionBreakdown {
  prompts: number;
  instructions: number;
  chatModes: number;
  agents: number;
  skills: number;
  mcpServers: number;
}

export function parseCollectionYaml(content: string): CollectionManifest {
  return yaml.load(content) as CollectionManifest;
}

export function inferEnvironments(tags: string[]): string[] {
  const envs: string[] = [];
  if (tags.includes('claude-code') || tags.includes('claude')) { envs.push('claude-code'); }
  if (tags.includes('cursor')) { envs.push('cursor'); }
  if (tags.includes('windsurf')) { envs.push('windsurf'); }
  if (envs.length === 0) { envs.push('vscode'); }
  return envs;
}

export function calculateBreakdown(items: CollectionItem[], mcpServers?: Record<string, any>): CollectionBreakdown {
  const breakdown: CollectionBreakdown = {
    prompts: 0, instructions: 0, chatModes: 0, agents: 0, skills: 0,
    mcpServers: mcpServers ? Object.keys(mcpServers).length : 0,
  };
  for (const item of items) {
    switch (item.kind) {
      case 'prompt': breakdown.prompts++; break;
      case 'instruction': breakdown.instructions++; break;
      case 'chat-mode': breakdown.chatModes++; break;
      case 'agent': breakdown.agents++; break;
      case 'skill': breakdown.skills++; break;
    }
  }
  return breakdown;
}

export function mapCollectionToBundle(collection: CollectionManifest, sourceId: string, repoUrl: string): Bundle {
  return {
    id: collection.id,
    name: collection.name,
    version: collection.version || '1.0.0',
    description: collection.description,
    author: collection.author || extractOwnerFromUrl(repoUrl),
    repository: repoUrl,
    tags: collection.tags || [],
    environments: inferEnvironments(collection.tags || []),
    sourceId,
    manifestUrl: '',
    downloadUrl: '',
    lastUpdated: new Date().toISOString(),
    size: `${collection.items.length} items`,
    dependencies: [],
    license: 'MIT',
  };
}

function extractOwnerFromUrl(url: string): string {
  const match = url.match(/github\.com[/:]([^/]+)/);
  return match ? match[1] : 'unknown';
}
