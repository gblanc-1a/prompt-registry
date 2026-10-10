/**
 * Copilot file type domain logic.
 *
 * Pure classification/naming rules for GitHub Copilot customization files
 * (prompts, instructions, chatmodes, agents, skills): given a manifest
 * item's file name/tags, decide its `CopilotFileType`, and given an id +
 * type, compute the canonical on-disk file name.
 *
 * Ported verbatim from the extension's `src/utils/copilot-file-type-utils.ts`
 * (migration plan §7.5 item 2) — that module becomes a thin re-export of
 * this one. No IO, no framework imports: safe for both the extension and
 * the CLI to depend on directly.
 * @module domain/install/copilot-file-type
 */
import type {
  PrimitiveKind,
} from '../primitive/types';

/**
 * Normalize a prompt ID to a safe string for use in file names.
 *
 * Replaces any characters that are not alphanumeric, hyphens, or underscores
 * with hyphens. Also handles YAML parsing numeric-looking IDs as numbers.
 * @param id - The prompt ID to normalize (can be string or number from YAML parsing)
 * @returns A normalized string safe for use in file names
 */
export function normalizePromptId(id: string | number): string {
  return String(id).replace(/[^a-zA-Z0-9-_]/g, '-');
}

/**
 * Supported Copilot file types
 */
export type CopilotFileType = 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill';

/**
 * File extension mappings for each Copilot file type
 */
const FILE_EXTENSIONS: Record<CopilotFileType, string> = {
  prompt: '.prompt.md',
  instructions: '.instructions.md',
  chatmode: '.chatmode.md',
  agent: '.agent.md',
  skill: '' // Skills are directories, not single files
};

/**
 * Repository directory mappings for each Copilot file type
 * These follow VS Code Copilot conventions for repository-level customizations
 */
const REPOSITORY_DIRECTORIES: Record<CopilotFileType, string> = {
  prompt: '.github/prompts/',
  instructions: '.github/instructions/',
  chatmode: '.github/agents/', // Chatmodes are associated with agents
  agent: '.github/agents/',
  skill: '.github/skills/'
};

/**
 * Common skill directory patterns
 */
const SKILL_DIRECTORY_PATTERNS = [
  /^skills[/\\]/i, // skills/skill-name
  /[/\\]skills[/\\]/i // path/to/skills/skill-name
];

/**
 * Check if a path represents a skill directory.
 *
 * Skill directories are identified by:
 * 1. Being under a 'skills/' parent directory
 * 2. Containing a SKILL.md file (when checking contents)
 * @param filePath - The path to check
 * @returns True if the path represents a skill directory
 */
export function isSkillDirectory(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check if path is under a skills directory
  return SKILL_DIRECTORY_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

/**
 * Extract the skill name from a skill directory path.
 *
 * Given a path like 'skills/my-skill' or 'path/to/skills/my-skill',
 * returns 'my-skill'.
 * @param skillPath - The path to the skill directory
 * @returns The skill name, or null if not a valid skill path
 */
export function getSkillName(skillPath: string): string | null {
  const normalizedPath = skillPath.replace(/\\/g, '/');

  // Match patterns like 'skills/skill-name' or 'path/skills/skill-name'
  const match = normalizedPath.match(/(?:^|[/\\])skills[/\\]([^/\\]+)(?:[/\\]|$)/i);

  if (match && match[1]) {
    return match[1];
  }

  return null;
}

/**
 * Determine the Copilot file type from a file name and optional tags.
 *
 * Detection priority:
 * 1. File extension patterns (e.g., .prompt.md, .agent.md)
 * 2. Directory-based detection (e.g., any .md file in an agents/ directory)
 * 3. Special file names (e.g., SKILL.md)
 * 4. Tags from manifest
 * 5. Filename patterns (e.g., contains "instructions")
 * 6. Default to 'prompt'
 * @param fileName - The file name or path to analyze
 * @param tags - Optional tags from the manifest
 * @returns The detected CopilotFileType
 */
export function determineFileType(fileName: string, tags?: string[]): CopilotFileType {
  // Get just the file name without directory path
  const baseName = fileName.replace(/^.*[/\\]/, '');
  const lowerBaseName = baseName.toLowerCase();

  // 1. Check for specific file extension patterns (highest priority)
  if (lowerBaseName.endsWith('.prompt.md')) {
    return 'prompt';
  }
  if (lowerBaseName.endsWith('.instructions.md')) {
    return 'instructions';
  }
  if (lowerBaseName.endsWith('.chatmode.md')) {
    return 'chatmode';
  }
  if (lowerBaseName.endsWith('.agent.md')) {
    return 'agent';
  }

  // 2. Check if file is in an agents/ directory
  // VS Code no longer requires .agent.md suffix — any .md in agents/ is an agent
  const normalizedPath = fileName.replace(/\\/g, '/');
  if (lowerBaseName.endsWith('.md') && /(?:^|[/])agents[/]/i.test(normalizedPath)) {
    return 'agent';
  }

  // 3. Check for special file names
  if (lowerBaseName === 'skill.md') {
    return 'skill';
  }

  // 4. Check tags if provided
  if (tags && tags.length > 0) {
    const lowerTags = tags.map((t) => t.toLowerCase());

    if (lowerTags.includes('instructions')) {
      return 'instructions';
    }
    if (lowerTags.includes('chatmode') || lowerTags.includes('mode')) {
      return 'chatmode';
    }
    if (lowerTags.includes('agent')) {
      return 'agent';
    }
    if (lowerTags.includes('skill')) {
      return 'skill';
    }
  }

  // 5. Check filename patterns
  if (lowerBaseName.includes('instructions')) {
    return 'instructions';
  }

  // 6. Default to prompt
  return 'prompt';
}

/**
 * Generate the target file name for a given ID and file type.
 * @param id - The prompt/agent/etc. identifier
 * @param type - The Copilot file type
 * @returns The target file name with appropriate extension
 */
export function getTargetFileName(id: string, type: CopilotFileType): string {
  // Skills use SKILL.md as the main file
  if (type === 'skill') {
    return 'SKILL.md';
  }

  return `${id}${FILE_EXTENSIONS[type]}`;
}

/**
 * Get the repository target directory for a given file type.
 *
 * Returns the appropriate .github/ subdirectory where files of this type
 * should be placed for repository-level installation.
 * @param type - The Copilot file type
 * @returns The repository directory path (e.g., '.github/prompts/')
 */
export function getRepositoryTargetDirectory(type: CopilotFileType): string {
  return REPOSITORY_DIRECTORIES[type];
}

/**
 * Get the file extension for a given Copilot file type.
 * @param type - The Copilot file type
 * @returns The file extension (e.g., '.prompt.md') or empty string for skills
 */
export function getFileExtension(type: CopilotFileType): string {
  return FILE_EXTENSIONS[type];
}

/**
 * Canonical primitive kind → Copilot file-type alias.
 *
 * `getTargetFileName` speaks the alias vocabulary (`instructions`,
 * `chatmode`); manifest-driven placement routes on canonical
 * `PrimitiveKind`. This is the bridge, and it is explicit so the
 * mapping is not re-derived per call site (design 4.7).
 * @param kind - Canonical primitive kind.
 * @returns The Copilot alias, or null when the kind has none.
 */
export function copilotFileTypeForKind(kind: PrimitiveKind): CopilotFileType | null {
  switch (kind) {
    case 'prompt': {
      return 'prompt';
    }
    case 'instruction': {
      return 'instructions';
    }
    case 'chat-mode': {
      return 'chatmode';
    }
    case 'agent': {
      return 'agent';
    }
    case 'skill': {
      return 'skill';
    }
    default: {
      return null;
    }
  }
}

/** How a kind's on-disk name is derived (design 4.4). */
export type KindNameShape = 'copilot-suffixed' | 'directory' | 'plain-file' | 'not-placed';

const DIRECTORY_KINDS: readonly PrimitiveKind[] = ['skill', 'plugin', 'power'];

/**
 * Classify a kind's naming shape.
 * @param kind - Canonical primitive kind.
 * @returns The naming shape that applies to it.
 */
export function nameShapeForKind(kind: PrimitiveKind): KindNameShape {
  if (kind === 'mcp-server') {
    return 'not-placed';
  }
  if (DIRECTORY_KINDS.includes(kind)) {
    return 'directory';
  }
  return copilotFileTypeForKind(kind) === null ? 'plain-file' : 'copilot-suffixed';
}

/**
 * Compute the on-disk name for one placed primitive.
 *
 * Normalizes the id exactly once, here, so no caller passes a raw
 * manifest id through (`UserScopeService:393` and `BundleInstaller:272`
 * both did, which is the behavior change design §13 records).
 * @param kind - Canonical primitive kind.
 * @param id - Manifest item id; may be a YAML-parsed number.
 * @param sourceBasename - Basename of the bundle-relative source path.
 * @returns File name, directory name, or null when the kind is not placed.
 */
export function destinationNameForKind(
  kind: PrimitiveKind,
  id: string,
  sourceBasename: string
): string | null {
  const shape = nameShapeForKind(kind);
  if (shape === 'not-placed') {
    return null;
  }
  if (shape === 'plain-file') {
    return sourceBasename.replace(/^.*[/\\]/, '');
  }
  const normalized = normalizePromptId(id);
  if (shape === 'directory') {
    return normalized;
  }
  const alias = copilotFileTypeForKind(kind);
  // `shape === 'copilot-suffixed'` is derived from a non-null alias above.
  return getTargetFileName(normalized, alias as CopilotFileType);
}
