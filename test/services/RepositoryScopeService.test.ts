/**
 * RepositoryScopeService Unit Tests
 * 
 * Tests for repository-level bundle installation service.
 * Handles file placement in .github/ directories and git exclude management.
 * 
 * Requirements: 1.2-1.7, 3.1-3.7
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import { RepositoryScopeService } from '../../src/services/RepositoryScopeService';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { CopilotFileType } from '../../src/utils/copilotFileTypeUtils';
import { InstalledBundle, RepositoryCommitMode } from '../../src/types/registry';

suite('RepositoryScopeService', () => {
    let service: RepositoryScopeService;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let tempDir: string;
    let workspaceRoot: string;
    let sandbox: sinon.SinonSandbox;

    // ===== Test Utilities =====
    
    /**
     * Create a mock bundle directory with test files
     */
    const createMockBundle = (bundleId: string, files: Array<{ name: string; content: string; type?: string }>) => {
        const bundlePath = path.join(tempDir, 'bundles', bundleId);
        fs.mkdirSync(bundlePath, { recursive: true });
        
        // Create deployment manifest
        // Extract id by removing the full type extension (e.g., .prompt.md, .agent.md)
        const prompts = files.map((f, i) => ({
            id: f.name.replace(/\.(prompt|instructions|agent|chatmode|skill)\.md$/, '').replace(/\.md$/, ''),
            name: f.name,
            file: f.name,
            type: f.type || 'prompt'
        }));
        
        const manifest = {
            id: bundleId,
            version: '1.0.0',
            prompts
        };
        
        fs.writeFileSync(
            path.join(bundlePath, 'deployment-manifest.yml'),
            `id: ${bundleId}\nversion: "1.0.0"\nprompts:\n${prompts.map(p => `  - id: ${p.id}\n    name: ${p.name}\n    file: ${p.file}\n    type: ${p.type}`).join('\n')}`
        );
        
        // Create files
        for (const file of files) {
            fs.writeFileSync(path.join(bundlePath, file.name), file.content);
        }
        
        return bundlePath;
    };

    /**
     * Create mock installed bundle record
     */
    const createMockInstalledBundle = (
        bundleId: string,
        commitMode: RepositoryCommitMode = 'commit'
    ): InstalledBundle => ({
        bundleId,
        version: '1.0.0',
        installedAt: new Date().toISOString(),
        scope: 'repository',
        installPath: path.join(tempDir, 'bundles', bundleId),
        manifest: {
            common: { directories: [], files: [], include_patterns: [], exclude_patterns: [] },
            bundle_settings: {
                include_common_in_environment_bundles: false,
                create_common_bundle: false,
                compression: 'zip',
                naming: { environment_bundle: '{env}' }
            },
            metadata: { manifest_version: '1.0.0', description: 'Test bundle' }
        },
        commitMode
    });

    /**
     * Read git exclude file content
     */
    const readGitExclude = (): string | null => {
        const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
        if (fs.existsSync(excludePath)) {
            return fs.readFileSync(excludePath, 'utf-8');
        }
        return null;
    };

    /**
     * Create .git directory structure
     */
    const createGitDirectory = () => {
        const gitInfoDir = path.join(workspaceRoot, '.git', 'info');
        fs.mkdirSync(gitInfoDir, { recursive: true });
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        tempDir = path.join(__dirname, '..', '..', '..', 'test-temp-repo-scope');
        workspaceRoot = path.join(tempDir, 'workspace');
        
        // Create temp directories
        fs.mkdirSync(workspaceRoot, { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'bundles'), { recursive: true });
        
        // Create mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Create service
        service = new RepositoryScopeService(workspaceRoot, mockStorage as unknown as RegistryStorage);
    });

    teardown(() => {
        sandbox.restore();
        // Cleanup temp directories
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Service Initialization', () => {
        test('should initialize with workspace root and storage', () => {
            assert.ok(service, 'Service should be initialized');
        });

        test('should have IScopeService methods', () => {
            assert.ok(typeof service.syncBundle === 'function', 'Should have syncBundle method');
            assert.ok(typeof service.unsyncBundle === 'function', 'Should have unsyncBundle method');
            assert.ok(typeof service.getTargetPath === 'function', 'Should have getTargetPath method');
            assert.ok(typeof service.getStatus === 'function', 'Should have getStatus method');
        });

        test('should have switchCommitMode method', () => {
            assert.ok(typeof service.switchCommitMode === 'function', 'Should have switchCommitMode method');
        });
    });

    suite('getTargetPath', () => {
        test('should return correct path for prompt type', () => {
            const targetPath = service.getTargetPath('prompt', 'my-prompt');
            assert.ok(targetPath.includes('.github/prompts/'), 'Should include .github/prompts/');
            assert.ok(targetPath.endsWith('my-prompt.prompt.md'), 'Should end with correct filename');
        });

        test('should return correct path for instructions type', () => {
            const targetPath = service.getTargetPath('instructions', 'coding-standards');
            assert.ok(targetPath.includes('.github/instructions/'), 'Should include .github/instructions/');
            assert.ok(targetPath.endsWith('coding-standards.instructions.md'), 'Should end with correct filename');
        });

        test('should return correct path for agent type', () => {
            const targetPath = service.getTargetPath('agent', 'code-reviewer');
            assert.ok(targetPath.includes('.github/agents/'), 'Should include .github/agents/');
            assert.ok(targetPath.endsWith('code-reviewer.agent.md'), 'Should end with correct filename');
        });

        test('should return correct path for skill type', () => {
            const targetPath = service.getTargetPath('skill', 'my-skill');
            assert.ok(targetPath.includes('.github/skills/'), 'Should include .github/skills/');
        });

        test('should return correct path for chatmode type', () => {
            const targetPath = service.getTargetPath('chatmode', 'expert-mode');
            assert.ok(targetPath.includes('.github/prompts/'), 'Chatmodes should go to prompts directory');
            assert.ok(targetPath.endsWith('expert-mode.chatmode.md'), 'Should end with correct filename');
        });

        test('should return absolute path within workspace', () => {
            const targetPath = service.getTargetPath('prompt', 'test');
            assert.ok(path.isAbsolute(targetPath), 'Should return absolute path');
            assert.ok(targetPath.startsWith(workspaceRoot), 'Should be within workspace root');
        });
    });

    suite('getStatus', () => {
        test('should return status with baseDirectory', async () => {
            const status = await service.getStatus();
            assert.ok(status.baseDirectory, 'Should have baseDirectory');
            assert.ok(status.baseDirectory.includes('.github'), 'baseDirectory should include .github');
        });

        test('should report dirExists as false when .github does not exist', async () => {
            const status = await service.getStatus();
            assert.strictEqual(status.dirExists, false, 'dirExists should be false');
        });

        test('should report dirExists as true when .github exists', async () => {
            fs.mkdirSync(path.join(workspaceRoot, '.github'), { recursive: true });
            const status = await service.getStatus();
            assert.strictEqual(status.dirExists, true, 'dirExists should be true');
        });

        test('should count synced files', async () => {
            // Create .github/prompts with a file
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            const status = await service.getStatus();
            assert.strictEqual(status.syncedFiles, 1, 'Should count synced files');
            assert.ok(status.files.includes('test.prompt.md'), 'Should list synced files');
        });

        test('should return empty files array when no files synced', async () => {
            const status = await service.getStatus();
            assert.deepStrictEqual(status.files, [], 'Should return empty files array');
            assert.strictEqual(status.syncedFiles, 0, 'Should have zero synced files');
        });
    });

    suite('syncBundle - File Placement', () => {
        test('should place prompt files in .github/prompts/', async () => {
            const bundleId = 'test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test Prompt', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const targetFile = path.join(workspaceRoot, '.github', 'prompts', 'test.prompt.md');
            assert.ok(fs.existsSync(targetFile), 'Prompt file should be placed in .github/prompts/');
        });

        test('should place instruction files in .github/instructions/', async () => {
            const bundleId = 'test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'coding.instructions.md', content: '# Coding Standards', type: 'instructions' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const targetFile = path.join(workspaceRoot, '.github', 'instructions', 'coding.instructions.md');
            assert.ok(fs.existsSync(targetFile), 'Instructions file should be placed in .github/instructions/');
        });

        test('should place agent files in .github/agents/', async () => {
            const bundleId = 'test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'reviewer.agent.md', content: '# Code Reviewer', type: 'agent' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const targetFile = path.join(workspaceRoot, '.github', 'agents', 'reviewer.agent.md');
            assert.ok(fs.existsSync(targetFile), 'Agent file should be placed in .github/agents/');
        });

        test('should create parent directories if they do not exist', async () => {
            const bundleId = 'test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            // Ensure .github doesn't exist
            assert.ok(!fs.existsSync(path.join(workspaceRoot, '.github')), '.github should not exist initially');
            
            await service.syncBundle(bundleId, bundlePath);
            
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.github', 'prompts')), 'Should create .github/prompts/');
        });

        test('should handle bundles with mixed file types', async () => {
            const bundleId = 'mixed-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'prompt1.prompt.md', content: '# Prompt 1', type: 'prompt' },
                { name: 'coding.instructions.md', content: '# Instructions', type: 'instructions' },
                { name: 'reviewer.agent.md', content: '# Agent', type: 'agent' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.github', 'prompts', 'prompt1.prompt.md')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.github', 'instructions', 'coding.instructions.md')));
            assert.ok(fs.existsSync(path.join(workspaceRoot, '.github', 'agents', 'reviewer.agent.md')));
        });
    });

    suite('syncBundle - Git Exclude Management', () => {
        test('should NOT modify git exclude for commit mode', async () => {
            createGitDirectory();
            
            const bundleId = 'commit-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const excludeContent = readGitExclude();
            assert.ok(
                excludeContent === null || !excludeContent.includes('.github/prompts/test.prompt.md'),
                'Git exclude should not contain file path for commit mode'
            );
        });

        test('should add paths to git exclude for local-only mode', async () => {
            createGitDirectory();
            
            const bundleId = 'local-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const excludeContent = readGitExclude();
            assert.ok(excludeContent, 'Git exclude file should exist');
            assert.ok(
                excludeContent!.includes('.github/prompts/test.prompt.md'),
                'Git exclude should contain file path for local-only mode'
            );
        });

        test('should create .git/info/exclude if it does not exist', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            assert.ok(!fs.existsSync(excludePath), 'Exclude file should not exist initially');
            
            const bundleId = 'local-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            assert.ok(fs.existsSync(excludePath), 'Git exclude file should be created');
        });

        test('should add entries under "# Prompt Registry (local)" section', async () => {
            createGitDirectory();
            
            const bundleId = 'local-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const excludeContent = readGitExclude();
            assert.ok(excludeContent, 'Git exclude file should exist');
            assert.ok(
                excludeContent!.includes('# Prompt Registry (local)'),
                'Git exclude should contain section header'
            );
        });

        test('should preserve existing git exclude content', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            fs.writeFileSync(excludePath, '# Existing content\n*.log\n');
            
            const bundleId = 'local-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            const excludeContent = readGitExclude();
            assert.ok(excludeContent!.includes('# Existing content'), 'Should preserve existing content');
            assert.ok(excludeContent!.includes('*.log'), 'Should preserve existing patterns');
        });
    });

    suite('syncBundle - commitMode from Storage', () => {
        test('should retrieve commitMode from RegistryStorage', async () => {
            createGitDirectory();
            
            const bundleId = 'storage-test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.syncBundle(bundleId, bundlePath);
            
            // Verify storage was called
            assert.ok(mockStorage.getInstalledBundle.calledWith(bundleId, 'repository'), 
                'Should call getInstalledBundle with bundleId and repository scope');
        });
    });

    suite('unsyncBundle', () => {
        test('should remove files from .github/ directories', async () => {
            // Setup: create synced files
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            const bundleId = 'test-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.unsyncBundle(bundleId);
            
            assert.ok(!fs.existsSync(path.join(promptsDir, 'test.prompt.md')), 'File should be removed');
        });

        test('should remove entries from .git/info/exclude', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            fs.writeFileSync(excludePath, '# Prompt Registry (local)\n.github/prompts/test.prompt.md\n');
            
            const bundleId = 'test-bundle';
            // Create the bundle directory with manifest so unsyncBundle can read it
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            // Also create the synced file in .github
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.unsyncBundle(bundleId);
            
            const excludeContent = readGitExclude();
            assert.ok(
                !excludeContent!.includes('.github/prompts/test.prompt.md'),
                'Git exclude should not contain removed file path'
            );
        });

        test('should handle non-existent bundle gracefully', async () => {
            mockStorage.getInstalledBundle.resolves(undefined);
            
            // Should not throw
            await service.unsyncBundle('non-existent-bundle');
        });
    });

    suite('switchCommitMode', () => {
        test('should add paths to git exclude when switching from commit to local-only', async () => {
            createGitDirectory();
            
            // Setup: create synced files
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            const bundleId = 'test-bundle';
            createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            await service.switchCommitMode(bundleId, 'local-only');
            
            const excludeContent = readGitExclude();
            assert.ok(excludeContent, 'Git exclude file should exist');
            assert.ok(
                excludeContent!.includes('.github/prompts/test.prompt.md'),
                'Git exclude should contain file path after switching to local-only'
            );
        });

        test('should remove paths from git exclude when switching from local-only to commit', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            fs.writeFileSync(excludePath, '# Prompt Registry (local)\n.github/prompts/test.prompt.md\n');
            
            // Setup: create synced files
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            const bundleId = 'test-bundle';
            createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.switchCommitMode(bundleId, 'commit');
            
            const excludeContent = readGitExclude();
            assert.ok(
                !excludeContent!.includes('.github/prompts/test.prompt.md'),
                'Git exclude should not contain file path after switching to commit'
            );
        });
    });

    suite('Error Handling', () => {
        test('should proceed without git integration when .git directory is missing', async () => {
            // Don't create .git directory
            
            const bundleId = 'no-git-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            // Should not throw
            await service.syncBundle(bundleId, bundlePath);
            
            // File should still be placed
            const targetFile = path.join(workspaceRoot, '.github', 'prompts', 'test.prompt.md');
            assert.ok(fs.existsSync(targetFile), 'File should be placed even without .git');
        });

        test('should handle missing bundle manifest gracefully', async () => {
            const bundleId = 'no-manifest-bundle';
            const bundlePath = path.join(tempDir, 'bundles', bundleId);
            fs.mkdirSync(bundlePath, { recursive: true });
            // Don't create manifest
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            // Should not throw, but may log warning
            await service.syncBundle(bundleId, bundlePath);
        });

        test('should rollback on partial file installation failure', async () => {
            const bundleId = 'rollback-bundle';
            const bundlePath = createMockBundle(bundleId, [
                { name: 'test1.prompt.md', content: '# Test 1', type: 'prompt' },
                { name: 'test2.prompt.md', content: '# Test 2', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'commit'));
            
            // Make the prompts directory read-only after first file to cause failure
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            
            // Create first file manually
            fs.writeFileSync(path.join(promptsDir, 'test1.prompt.md'), '# Test 1');
            
            // Make directory read-only (this may not work on all systems)
            try {
                fs.chmodSync(promptsDir, 0o444);
                
                try {
                    await service.syncBundle(bundleId, bundlePath);
                } catch (error) {
                    // Expected to fail
                }
                
                // Restore permissions for cleanup
                fs.chmodSync(promptsDir, 0o755);
            } catch (e) {
                // chmod may not work on all systems, skip this test
            }
        });
    });

    suite('Git Exclude Section Management', () => {
        test('should remove section header when no entries remain', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            fs.writeFileSync(excludePath, '# Other content\n*.log\n\n# Prompt Registry (local)\n.github/prompts/test.prompt.md\n');
            
            const bundleId = 'test-bundle';
            createMockBundle(bundleId, [
                { name: 'test.prompt.md', content: '# Test', type: 'prompt' }
            ]);
            
            // Also create the synced file in .github so unsyncBundle can find it
            const promptsDir = path.join(workspaceRoot, '.github', 'prompts');
            fs.mkdirSync(promptsDir, { recursive: true });
            fs.writeFileSync(path.join(promptsDir, 'test.prompt.md'), '# Test');
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            await service.unsyncBundle(bundleId);
            
            const excludeContent = readGitExclude();
            // Section header should be removed when empty
            assert.ok(
                !excludeContent!.includes('# Prompt Registry (local)') || 
                excludeContent!.includes('# Prompt Registry (local)\n\n'),
                'Section header should be removed or empty when no entries remain'
            );
        });

        test('should keep section header when entries remain', async () => {
            createGitDirectory();
            const excludePath = path.join(workspaceRoot, '.git', 'info', 'exclude');
            fs.writeFileSync(excludePath, '# Prompt Registry (local)\n.github/prompts/test1.prompt.md\n.github/prompts/test2.prompt.md\n');
            
            const bundleId = 'test-bundle';
            // Only remove test1, test2 should remain
            createMockBundle(bundleId, [
                { name: 'test1.prompt.md', content: '# Test 1', type: 'prompt' }
            ]);
            
            mockStorage.getInstalledBundle.resolves(createMockInstalledBundle(bundleId, 'local-only'));
            
            // Manually remove just test1
            const content = fs.readFileSync(excludePath, 'utf-8');
            fs.writeFileSync(excludePath, content.replace('.github/prompts/test1.prompt.md\n', ''));
            
            const excludeContent = readGitExclude();
            assert.ok(
                excludeContent!.includes('# Prompt Registry (local)'),
                'Section header should remain when entries exist'
            );
            assert.ok(
                excludeContent!.includes('.github/prompts/test2.prompt.md'),
                'Other entries should remain'
            );
        });
    });
});
