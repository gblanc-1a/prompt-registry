import * as crypto from 'node:crypto';
import * as yaml from 'js-yaml';
import type { Bundle } from '../../types/registry';
import type { ParsedSkillFile, SkillFrontmatter, SkillItem } from '../../types/skills';

export function parseSkillMd(content: string): ParsedSkillFile {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { frontmatter: { name: '', description: '' }, content, raw: content };
  }
  const frontmatterYaml = frontmatterMatch[1];
  const markdownContent = frontmatterMatch[2];
  let frontmatter: SkillFrontmatter;
  try {
    frontmatter = yaml.load(frontmatterYaml) as SkillFrontmatter;
  } catch {
    frontmatter = { name: '', description: '' };
  }
  return { frontmatter, content: markdownContent, raw: content };
}

export function calculateContentHash(files: Array<{ path: string; sha?: string; download_url?: string }>): string {
  const hash = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update(':');
    hash.update(file.sha ?? file.download_url ?? '');
    hash.update('|');
  }
  return hash.digest('hex');
}

export function formatSkillVersion(contentHash: string): string {
  const major = parseInt(contentHash.substring(0, 4), 16) % 100;
  const minor = parseInt(contentHash.substring(4, 8), 16) % 100;
  const patch = parseInt(contentHash.substring(8, 12), 16) % 1000;
  return `${major}.${minor}.${patch}`;
}

export function mapSkillToBundle(skill: SkillItem, owner: string, repo: string, sourceId: string, sourceUrl: string): Bundle {
  const bundleId = `skills-${owner}-${repo}-${skill.id}`;
  return {
    id: bundleId,
    name: skill.name,
    version: formatSkillVersion(skill.contentHash || ''),
    description: skill.description,
    author: owner,
    sourceId,
    environments: ['claude', 'vscode', 'claude-code'],
    tags: ['skill', 'anthropic'],
    lastUpdated: new Date().toISOString(),
    size: `${skill.files.length} files`,
    dependencies: [],
    license: skill.license || 'Unknown',
    repository: sourceUrl,
    homepage: `https://github.com/${owner}/${repo}/tree/main/${skill.path}`,
    manifestUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${skill.skillMdPath}`,
    downloadUrl: `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`,
  };
}
