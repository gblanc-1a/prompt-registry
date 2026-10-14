import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  copilotFileTypeForKind,
  destinationNameForKind,
  determineFileType,
  getFileExtension,
  getRepositoryTargetDirectory,
  getSkillName,
  getTargetFileName,
  isSkillDirectory,
  nameShapeForKind,
  normalizePromptId,
} from '../../../src/domain/install/copilot-file-type';

describe('normalizePromptId', () => {
  it('replaces unsafe characters with hyphens', () => {
    expect(normalizePromptId('my prompt!@#')).toBe('my-prompt---');
  });

  it('leaves alphanumeric, hyphen, and underscore untouched', () => {
    expect(normalizePromptId('my-prompt_123')).toBe('my-prompt_123');
  });

  it('stringifies numeric ids from YAML parsing', () => {
    expect(normalizePromptId(42)).toBe('42');
  });
});

describe('determineFileType', () => {
  it('detects by file extension, highest priority', () => {
    expect(determineFileType('foo.prompt.md')).toBe('prompt');
    expect(determineFileType('foo.instructions.md')).toBe('instructions');
    expect(determineFileType('foo.chatmode.md')).toBe('chatmode');
    expect(determineFileType('foo.agent.md')).toBe('agent');
  });

  it('detects any .md file in an agents/ directory as an agent', () => {
    expect(determineFileType('agents/reviewer.md')).toBe('agent');
    expect(determineFileType('path/to/agents/my-agent.md')).toBe('agent');
  });

  it('does not treat .md files outside agents/ as agents', () => {
    expect(determineFileType('prompts/my-agent.md')).toBe('prompt');
    expect(determineFileType('instructions/my-agent.md')).toBe('prompt');
  });

  it('is case-insensitive on extension', () => {
    expect(determineFileType('FOO.PROMPT.MD')).toBe('prompt');
  });

  it('strips directory components before matching', () => {
    expect(determineFileType('skills/my-skill/SKILL.md')).toBe('skill');
    expect(determineFileType('a\\b\\foo.agent.md')).toBe('agent');
  });

  it('detects SKILL.md by special file name', () => {
    expect(determineFileType('SKILL.md')).toBe('skill');
    expect(determineFileType('skill.md')).toBe('skill');
  });

  it('falls back to tags when extension is generic', () => {
    expect(determineFileType('foo.md', ['instructions'])).toBe('instructions');
    expect(determineFileType('foo.md', ['chatmode'])).toBe('chatmode');
    expect(determineFileType('foo.md', ['mode'])).toBe('chatmode');
    expect(determineFileType('foo.md', ['agent'])).toBe('agent');
    expect(determineFileType('foo.md', ['skill'])).toBe('skill');
  });

  it('extension patterns take priority over tags', () => {
    expect(determineFileType('foo.prompt.md', ['agent'])).toBe('prompt');
  });

  it('falls back to filename pattern when no tags match', () => {
    expect(determineFileType('coding-instructions.md')).toBe('instructions');
  });

  it('defaults to prompt when nothing else matches', () => {
    expect(determineFileType('foo.md')).toBe('prompt');
    expect(determineFileType('foo.md', [])).toBe('prompt');
    expect(determineFileType('foo.md', ['unrelated'])).toBe('prompt');
  });
});

describe('getTargetFileName', () => {
  it('appends the type-specific extension to the id', () => {
    expect(getTargetFileName('my-id', 'prompt')).toBe('my-id.prompt.md');
    expect(getTargetFileName('my-id', 'instructions')).toBe('my-id.instructions.md');
    expect(getTargetFileName('my-id', 'chatmode')).toBe('my-id.chatmode.md');
    expect(getTargetFileName('my-id', 'agent')).toBe('my-id.agent.md');
  });

  it('always returns SKILL.md for skill type, ignoring the id', () => {
    expect(getTargetFileName('anything', 'skill')).toBe('SKILL.md');
  });
});

describe('getRepositoryTargetDirectory', () => {
  it('returns a .github/ subdirectory for every type', () => {
    expect(getRepositoryTargetDirectory('prompt')).toBe('.github/prompts/');
    expect(getRepositoryTargetDirectory('instructions')).toBe('.github/instructions/');
    expect(getRepositoryTargetDirectory('agent')).toBe('.github/agents/');
    expect(getRepositoryTargetDirectory('skill')).toBe('.github/skills/');
  });

  it('routes chatmode into the agents directory', () => {
    expect(getRepositoryTargetDirectory('chatmode')).toBe(getRepositoryTargetDirectory('agent'));
  });
});

describe('getFileExtension', () => {
  it('returns the extension for file-based types and empty string for skill', () => {
    expect(getFileExtension('prompt')).toBe('.prompt.md');
    expect(getFileExtension('instructions')).toBe('.instructions.md');
    expect(getFileExtension('chatmode')).toBe('.chatmode.md');
    expect(getFileExtension('agent')).toBe('.agent.md');
    expect(getFileExtension('skill')).toBe('');
  });
});

describe('isSkillDirectory', () => {
  it('recognizes paths under a skills/ directory', () => {
    expect(isSkillDirectory('skills/my-skill')).toBe(true);
    expect(isSkillDirectory('path/to/skills/my-skill')).toBe(true);
    expect(isSkillDirectory('skills\\my-skill')).toBe(true);
  });

  it('rejects unrelated paths', () => {
    expect(isSkillDirectory('prompts/my-prompt.md')).toBe(false);
  });
});

describe('getSkillName', () => {
  it('extracts the skill name from a skills/ path', () => {
    expect(getSkillName('skills/my-skill')).toBe('my-skill');
    expect(getSkillName('path/to/skills/my-skill/SKILL.md')).toBe('my-skill');
  });

  it('returns null for a path with no skills/ segment', () => {
    expect(getSkillName('prompts/my-prompt.md')).toBeNull();
  });
});

describe('copilotFileTypeForKind', () => {
  it('maps the four Copilot-suffixed kinds onto their aliases', () => {
    expect(copilotFileTypeForKind('prompt')).toBe('prompt');
    expect(copilotFileTypeForKind('instruction')).toBe('instructions');
    expect(copilotFileTypeForKind('chat-mode')).toBe('chatmode');
    expect(copilotFileTypeForKind('agent')).toBe('agent');
    expect(copilotFileTypeForKind('skill')).toBe('skill');
  });

  it('returns null for a kind with no Copilot alias', () => {
    expect(copilotFileTypeForKind('hook')).toBeNull();
    expect(copilotFileTypeForKind('steering')).toBeNull();
  });
});

describe('nameShapeForKind', () => {
  it('classifies every kind into one of the four shapes', () => {
    expect(nameShapeForKind('prompt')).toBe('copilot-suffixed');
    expect(nameShapeForKind('skill')).toBe('directory');
    expect(nameShapeForKind('plugin')).toBe('directory');
    expect(nameShapeForKind('power')).toBe('directory');
    expect(nameShapeForKind('hook')).toBe('plain-file');
    expect(nameShapeForKind('steering')).toBe('plain-file');
    expect(nameShapeForKind('mcp-server')).toBe('not-placed');
  });
});

describe('destinationNameForKind', () => {
  it('renames a Copilot-suffixed file from the normalized id', () => {
    expect(destinationNameForKind('prompt', 'create-component', 'anything.md'))
      .toBe('create-component.prompt.md');
    expect(destinationNameForKind('instruction', 'ts-standards', 'x.md'))
      .toBe('ts-standards.instructions.md');
  });

  it('is a no-op for a well-formed bundle whose id matches its filename stem', () => {
    expect(destinationNameForKind('prompt', 'create-component', 'create-component.prompt.md'))
      .toBe('create-component.prompt.md');
  });

  it('normalizes an id that is not filename-safe', () => {
    expect(destinationNameForKind('prompt', 'My Prompt/v2', 'x.prompt.md'))
      .toBe('My-Prompt-v2.prompt.md');
  });

  it('normalizes a YAML-parsed numeric id', () => {
    expect(destinationNameForKind('prompt', 42 as unknown as string, 'x.prompt.md'))
      .toBe('42.prompt.md');
  });

  it('uses the normalized id as the directory name for a directory kind', () => {
    expect(destinationNameForKind('skill', 'My Skill', 'skills/my-skill/SKILL.md'))
      .toBe('My-Skill');
  });

  it('preserves the source basename for a plain-file kind', () => {
    expect(destinationNameForKind('hook', 'pre-commit', 'hooks/pre-commit.sh'))
      .toBe('pre-commit.sh');
    expect(destinationNameForKind('steering', 'style', 'steering/style.md'))
      .toBe('style.md');
  });

  it('returns null for a kind that is never placed as a file', () => {
    expect(destinationNameForKind('mcp-server', 'srv', 'mcp/srv.json')).toBeNull();
  });
});

describe('normalized id collisions (Review Focus 3)', () => {
  it('two distinct ids can normalize to the same file name', () => {
    // Not a bug in this function — a fact the planner must detect.
    // `planDeploy` reports it as a duplicate destination (Task 9).
    expect(destinationNameForKind('prompt', 'foo.bar', 'a.md'))
      .toBe(destinationNameForKind('prompt', 'foo-bar', 'b.md'));
  });
});
