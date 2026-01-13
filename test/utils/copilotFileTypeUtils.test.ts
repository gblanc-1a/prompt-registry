/**
 * Copilot File Type Utilities Tests
 * 
 * Tests for shared utilities that determine file types, generate target file names,
 * and map file types to repository directories.
 * 
 * Requirements: 1.2-1.7, 10.1-10.5
 */

import * as assert from 'assert';
import {
    CopilotFileType,
    determineFileType,
    getTargetFileName,
    getRepositoryTargetDirectory,
    getFileExtension
} from '../../src/utils/copilotFileTypeUtils';

suite('copilotFileTypeUtils', () => {
    suite('determineFileType', () => {
        suite('detection from file name', () => {
            test('should detect prompt type from .prompt.md extension', () => {
                assert.strictEqual(determineFileType('my-prompt.prompt.md'), 'prompt');
                assert.strictEqual(determineFileType('test.prompt.md'), 'prompt');
            });

            test('should detect instructions type from .instructions.md extension', () => {
                assert.strictEqual(determineFileType('coding-standards.instructions.md'), 'instructions');
                assert.strictEqual(determineFileType('test.instructions.md'), 'instructions');
            });

            test('should detect chatmode type from .chatmode.md extension', () => {
                assert.strictEqual(determineFileType('expert.chatmode.md'), 'chatmode');
                assert.strictEqual(determineFileType('test.chatmode.md'), 'chatmode');
            });

            test('should detect agent type from .agent.md extension', () => {
                assert.strictEqual(determineFileType('code-reviewer.agent.md'), 'agent');
                assert.strictEqual(determineFileType('test.agent.md'), 'agent');
            });

            test('should detect skill type from SKILL.md file', () => {
                assert.strictEqual(determineFileType('SKILL.md'), 'skill');
            });

            test('should detect instructions from filename containing "instructions"', () => {
                assert.strictEqual(determineFileType('my-instructions.md'), 'instructions');
                assert.strictEqual(determineFileType('coding_instructions.md'), 'instructions');
            });

            test('should default to prompt for unrecognized .md files', () => {
                assert.strictEqual(determineFileType('unknown.md'), 'prompt');
                assert.strictEqual(determineFileType('readme.md'), 'prompt');
            });
        });

        suite('detection from tags', () => {
            test('should detect instructions type from tags', () => {
                assert.strictEqual(determineFileType('file.md', ['instructions']), 'instructions');
                assert.strictEqual(determineFileType('file.md', ['other', 'instructions']), 'instructions');
            });

            test('should detect chatmode type from tags', () => {
                assert.strictEqual(determineFileType('file.md', ['chatmode']), 'chatmode');
                assert.strictEqual(determineFileType('file.md', ['mode']), 'chatmode');
            });

            test('should detect agent type from tags', () => {
                assert.strictEqual(determineFileType('file.md', ['agent']), 'agent');
            });

            test('should detect skill type from tags', () => {
                assert.strictEqual(determineFileType('file.md', ['skill']), 'skill');
            });

            test('should prioritize file extension over tags', () => {
                // File extension should take precedence
                assert.strictEqual(determineFileType('test.agent.md', ['instructions']), 'agent');
                assert.strictEqual(determineFileType('test.instructions.md', ['agent']), 'instructions');
            });

            test('should use tags when file extension is generic', () => {
                assert.strictEqual(determineFileType('generic.md', ['agent']), 'agent');
                assert.strictEqual(determineFileType('generic.md', ['chatmode']), 'chatmode');
            });
        });

        suite('edge cases', () => {
            test('should handle empty tags array', () => {
                assert.strictEqual(determineFileType('test.prompt.md', []), 'prompt');
            });

            test('should handle undefined tags', () => {
                assert.strictEqual(determineFileType('test.prompt.md'), 'prompt');
            });

            test('should handle case-insensitive file extensions', () => {
                assert.strictEqual(determineFileType('TEST.PROMPT.MD'), 'prompt');
                assert.strictEqual(determineFileType('Test.Instructions.Md'), 'instructions');
            });

            test('should handle paths with directories', () => {
                assert.strictEqual(determineFileType('prompts/my-prompt.prompt.md'), 'prompt');
                assert.strictEqual(determineFileType('agents/code-reviewer.agent.md'), 'agent');
            });
        });
    });

    suite('getTargetFileName', () => {
        test('should generate prompt file name', () => {
            assert.strictEqual(getTargetFileName('my-prompt', 'prompt'), 'my-prompt.prompt.md');
        });

        test('should generate instructions file name', () => {
            assert.strictEqual(getTargetFileName('coding-standards', 'instructions'), 'coding-standards.instructions.md');
        });

        test('should generate chatmode file name', () => {
            assert.strictEqual(getTargetFileName('expert-mode', 'chatmode'), 'expert-mode.chatmode.md');
        });

        test('should generate agent file name', () => {
            assert.strictEqual(getTargetFileName('code-reviewer', 'agent'), 'code-reviewer.agent.md');
        });

        test('should generate skill file name (SKILL.md)', () => {
            // Skills use SKILL.md as the main file
            assert.strictEqual(getTargetFileName('my-skill', 'skill'), 'SKILL.md');
        });

        test('should handle IDs with special characters', () => {
            assert.strictEqual(getTargetFileName('my_prompt-v1', 'prompt'), 'my_prompt-v1.prompt.md');
        });
    });

    suite('getRepositoryTargetDirectory', () => {
        test('should return .github/prompts/ for prompt type', () => {
            assert.strictEqual(getRepositoryTargetDirectory('prompt'), '.github/prompts/');
        });

        test('should return .github/instructions/ for instructions type', () => {
            assert.strictEqual(getRepositoryTargetDirectory('instructions'), '.github/instructions/');
        });

        test('should return .github/prompts/ for chatmode type', () => {
            // Chatmodes go to prompts directory per VS Code Copilot conventions
            assert.strictEqual(getRepositoryTargetDirectory('chatmode'), '.github/prompts/');
        });

        test('should return .github/agents/ for agent type', () => {
            assert.strictEqual(getRepositoryTargetDirectory('agent'), '.github/agents/');
        });

        test('should return .github/skills/ for skill type', () => {
            assert.strictEqual(getRepositoryTargetDirectory('skill'), '.github/skills/');
        });

        test('should return paths with trailing slash', () => {
            const types: CopilotFileType[] = ['prompt', 'instructions', 'chatmode', 'agent', 'skill'];
            for (const type of types) {
                const dir = getRepositoryTargetDirectory(type);
                assert.ok(dir.endsWith('/'), `Directory for ${type} should end with /`);
            }
        });

        test('should return paths starting with .github/', () => {
            const types: CopilotFileType[] = ['prompt', 'instructions', 'chatmode', 'agent', 'skill'];
            for (const type of types) {
                const dir = getRepositoryTargetDirectory(type);
                assert.ok(dir.startsWith('.github/'), `Directory for ${type} should start with .github/`);
            }
        });
    });

    suite('getFileExtension', () => {
        test('should return .prompt.md for prompt type', () => {
            assert.strictEqual(getFileExtension('prompt'), '.prompt.md');
        });

        test('should return .instructions.md for instructions type', () => {
            assert.strictEqual(getFileExtension('instructions'), '.instructions.md');
        });

        test('should return .chatmode.md for chatmode type', () => {
            assert.strictEqual(getFileExtension('chatmode'), '.chatmode.md');
        });

        test('should return .agent.md for agent type', () => {
            assert.strictEqual(getFileExtension('agent'), '.agent.md');
        });

        test('should return empty string for skill type (skills are directories)', () => {
            // Skills are directories, not single files
            assert.strictEqual(getFileExtension('skill'), '');
        });
    });
});
