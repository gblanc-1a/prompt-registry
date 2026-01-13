/**
 * Copilot File Type Utilities
 * 
 * Shared utilities for determining Copilot file types, generating target file names,
 * and mapping file types to repository directories.
 * 
 * These utilities are used by both UserScopeService and RepositoryScopeService
 * to ensure consistent file type handling across installation scopes.
 * 
 * Requirements: 1.2-1.7, 10.1-10.5
 */

import * as path from 'path';

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
    chatmode: '.github/prompts/', // Chatmodes go to prompts directory
    agent: '.github/agents/',
    skill: '.github/skills/'
};

/**
 * Determine the Copilot file type from a file name and optional tags.
 * 
 * Detection priority:
 * 1. File extension patterns (e.g., .prompt.md, .agent.md)
 * 2. Special file names (e.g., SKILL.md)
 * 3. Tags from manifest
 * 4. Filename patterns (e.g., contains "instructions")
 * 5. Default to 'prompt'
 * 
 * @param fileName - The file name or path to analyze
 * @param tags - Optional tags from the manifest
 * @returns The detected CopilotFileType
 */
export function determineFileType(fileName: string, tags?: string[]): CopilotFileType {
    // Get just the file name without directory path
    const baseName = path.basename(fileName);
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

    // 2. Check for special file names
    if (lowerBaseName === 'skill.md') {
        return 'skill';
    }

    // 3. Check tags if provided
    if (tags && tags.length > 0) {
        const lowerTags = tags.map(t => t.toLowerCase());
        
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

    // 4. Check filename patterns
    if (lowerBaseName.includes('instructions')) {
        return 'instructions';
    }

    // 5. Default to prompt
    return 'prompt';
}

/**
 * Generate the target file name for a given ID and file type.
 * 
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
 * 
 * @param type - The Copilot file type
 * @returns The repository directory path (e.g., '.github/prompts/')
 */
export function getRepositoryTargetDirectory(type: CopilotFileType): string {
    return REPOSITORY_DIRECTORIES[type];
}

/**
 * Get the file extension for a given Copilot file type.
 * 
 * @param type - The Copilot file type
 * @returns The file extension (e.g., '.prompt.md') or empty string for skills
 */
export function getFileExtension(type: CopilotFileType): string {
    return FILE_EXTENSIONS[type];
}
