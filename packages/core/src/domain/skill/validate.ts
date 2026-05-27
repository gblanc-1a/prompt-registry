/**
 * Skills validation module (pure functions).
 * @module domain/skill/validate
 *
 * Validates skill folders following the Agent Skills specification.
 * File-IO dependent functions are in src/app/collection/generate-skill.ts.
 * @see https://agentskills.io/specification
 */

import * as yaml from 'js-yaml';

export interface SkillMetadata {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface SkillValidationResult {
  skillName: string;
  folderName: string;
  valid: boolean;
  errors: string[];
}

export interface AllSkillsValidationResult {
  valid: boolean;
  skills: SkillValidationResult[];
  totalSkills: number;
  validSkills: number;
  invalidSkills: number;
}

// Constants
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MIN_LENGTH = 10;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const MAX_ASSET_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Parse YAML frontmatter from SKILL.md content
 * @param content
 */
export function parseFrontmatter(content: string): SkillMetadata | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) {
    return null;
  }
  try {
    return yaml.load(match[1]) as SkillMetadata;
  } catch {
    return null;
  }
}

/**
 * Validate skill name format
 * @param name
 */
export function validateSkillName(name: unknown): string | null {
  if (!name || typeof name !== 'string') {
    return 'name is required and must be a string';
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'name must contain only lowercase letters, numbers, and hyphens';
  }
  if (name.length > SKILL_NAME_MAX_LENGTH) {
    return `name must not exceed ${SKILL_NAME_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * Validate skill description
 * @param description
 */
export function validateSkillDescription(description: unknown): string | null {
  if (!description || typeof description !== 'string') {
    return 'description is required and must be a string';
  }
  if (description.length < SKILL_DESCRIPTION_MIN_LENGTH) {
    return `description must be at least ${SKILL_DESCRIPTION_MIN_LENGTH} characters`;
  }
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    return `description must not exceed ${SKILL_DESCRIPTION_MAX_LENGTH} characters`;
  }
  return null;
}
