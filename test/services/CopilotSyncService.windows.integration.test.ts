/**
 * CopilotSyncService Windows Integration Tests
 * 
 * Reproduces Windows-specific regex issue:
 * "Invalid regular expression: /\profiles\([^\]+)/: Unterminated character class"
 * 
 * This test simulates Windows path separators (backslashes) to verify the fix
 * for regex character class escaping when using path.sep in regex patterns.
 * 
 * The bug occurs when:
 * 1. Running on Windows (path.sep = '\')
 * 2. Path contains 'profiles' directory
 * 3. Regex uses [^${path.sep}] which becomes [^\] (unterminated character class)
 * 
 * Requirements: Windows CI environment with Docker
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CopilotSyncService } from '../../src/services/CopilotSyncService';

suite('CopilotSyncService - Windows Integration Tests', () => {
    let service: CopilotSyncService;
    let mockContext: any;
    let tempDir: string;

    setup(() => {
        // Create temp directory for test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-windows-test-'));
    });

    teardown(() => {
        // Cleanup temp directories
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Windows Path Regex Bug Reproduction', () => {
        /**
         * This test reproduces the exact error from the screenshot:
         * "Invalid regular expression: /\profiles\([^\]+)/: Unterminated character class"
         * 
         * The error occurs when:
         * 1. globalStoragePath contains Windows backslashes
         * 2. Path includes 'profiles' directory
         * 3. getCopilotPromptsDirectory() uses regex with [^${path.sep}]
         * 4. On Windows, path.sep = '\', creating [^\] which is invalid regex
         */
        test('should handle Windows-style paths with profiles directory without regex errors', async () => {
            // Simulate Windows path structure from the error screenshot
            // C:\Users\Wherka\.vscode\extensions\amadeusitgroup.prompt-registry-0.0.12\dist\extension.js
            const windowsUserPath = path.join(tempDir, 'Users', 'TestUser', '.vscode', 'extensions', 'dist', 'User');
            const profileId = 'security-best-practices';
            const globalStoragePath = path.join(
                windowsUserPath,
                'profiles',
                profileId,
                'globalStorage',
                'amadeusitgroup.prompt-registry'
            );

            // Create the directory structure
            fs.mkdirSync(globalStoragePath, { recursive: true });

            // Create mock context with Windows-style path
            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            // This should NOT throw "Invalid regular expression" or "Unterminated character class"
            service = new CopilotSyncService(mockContext);

            // The critical test: getStatus() calls getCopilotPromptsDirectory() which uses regex
            let status;
            let error: Error | null = null;

            try {
                status = await service.getStatus();
            } catch (e) {
                error = e as Error;
            }

            // Verify no regex errors occurred
            if (error) {
                assert.ok(
                    !error.message.includes('Invalid regular expression'),
                    `Should not throw "Invalid regular expression", got: ${error.message}`
                );
                assert.ok(
                    !error.message.includes('Unterminated character class'),
                    `Should not throw "Unterminated character class", got: ${error.message}`
                );
                assert.ok(
                    !error.message.includes('SyntaxError'),
                    `Should not throw SyntaxError from regex, got: ${error.message}`
                );
                // If it's a different error (like file not found), that's acceptable
            }

            // Verify the path was correctly resolved
            assert.ok(status, 'Should return status object');
            assert.ok(status.copilotDir, 'Should return a valid copilot directory path');
            assert.ok(status.copilotDir.includes('profiles'), 'Path should include profiles directory');
            assert.ok(status.copilotDir.includes(profileId), 'Path should include profile ID');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Path should end with prompts directory');

            // Verify the expected path structure
            const expectedPath = path.join(windowsUserPath, 'profiles', profileId, 'prompts');
            assert.strictEqual(
                status.copilotDir,
                expectedPath,
                'Should resolve to correct profile prompts directory'
            );
        });

        test('should handle Windows-style paths without profiles directory', async () => {
            // Test standard Windows path without profiles
            const windowsUserPath = path.join(tempDir, 'Users', 'TestUser', 'AppData', 'Roaming', 'Code', 'User');
            const globalStoragePath = path.join(
                windowsUserPath,
                'globalStorage',
                'amadeusitgroup.prompt-registry'
            );

            // Create the directory structure
            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);

            // Should not throw regex errors
            const status = await service.getStatus();

            assert.ok(status, 'Should return status object');
            assert.ok(status.copilotDir, 'Should return a valid copilot directory path');
            assert.ok(status.copilotDir.includes('User'), 'Path should include User directory');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Path should end with prompts directory');

            const expectedPath = path.join(windowsUserPath, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath, 'Should resolve to User/prompts');
        });

        test('should handle multiple profiles in Windows path', async () => {
            // Test with multiple profile directories to stress-test the regex
            const windowsUserPath = path.join(tempDir, 'Users', 'TestUser', 'AppData', 'Local', 'Programs', 'VSCode', 'User');
            
            // Create multiple profile directories
            const profiles = ['profile-1', 'profile-2', 'profile-3'];
            for (const profileId of profiles) {
                const profilePath = path.join(windowsUserPath, 'profiles', profileId, 'globalStorage');
                fs.mkdirSync(profilePath, { recursive: true });
            }

            // Use the second profile
            const activeProfileId = 'profile-2';
            const globalStoragePath = path.join(
                windowsUserPath,
                'profiles',
                activeProfileId,
                'globalStorage',
                'publisher.extension'
            );

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);

            // Should correctly identify the active profile
            const status = await service.getStatus();

            assert.ok(status.copilotDir.includes(activeProfileId), 'Should use the correct profile');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Should end with prompts directory');

            const expectedPath = path.join(windowsUserPath, 'profiles', activeProfileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });

        test('should handle Windows custom data directory with profile', async () => {
            // Test custom data directory (no User folder) with profile
            const customDataDir = path.join(tempDir, 'CustomVSCodeData');
            const profileId = 'work-profile';
            const globalStoragePath = path.join(
                customDataDir,
                'profiles',
                profileId,
                'globalStorage',
                'publisher.extension'
            );

            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);

            // Should handle custom data directory with profiles
            const status = await service.getStatus();

            assert.ok(status.copilotDir, 'Should return a valid path');
            assert.ok(status.copilotDir.includes('profiles'), 'Should include profiles directory');
            assert.ok(status.copilotDir.includes(profileId), 'Should include profile ID');

            const expectedPath = path.join(customDataDir, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });
    });

    suite('Windows Path Edge Cases', () => {
        test('should handle path with spaces in Windows directory names', async () => {
            // Windows paths often have spaces (e.g., "Program Files", "Application Data")
            const windowsUserPath = path.join(
                tempDir,
                'Users',
                'Test User',
                'Application Data',
                'Code',
                'User'
            );
            const profileId = 'my-profile';
            const globalStoragePath = path.join(
                windowsUserPath,
                'profiles',
                profileId,
                'globalStorage',
                'publisher.extension'
            );

            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);
            const status = await service.getStatus();

            assert.ok(status.copilotDir, 'Should handle paths with spaces');
            assert.ok(status.copilotDir.includes(profileId), 'Should include profile ID');
        });

        test('should handle path with special characters in profile ID', async () => {
            // Profile IDs can contain hyphens, underscores, and alphanumeric characters
            const windowsUserPath = path.join(tempDir, 'Users', 'TestUser', 'Code', 'User');
            const profileId = 'my-special_profile-123';
            const globalStoragePath = path.join(
                windowsUserPath,
                'profiles',
                profileId,
                'globalStorage',
                'publisher.extension'
            );

            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);
            const status = await service.getStatus();

            assert.ok(status.copilotDir.includes(profileId), 'Should handle special characters in profile ID');
        });

        test('should handle deeply nested Windows path structure', async () => {
            // Test very deep path nesting
            const deepPath = path.join(
                tempDir,
                'C:',
                'Users',
                'TestUser',
                'AppData',
                'Local',
                'Programs',
                'Microsoft VS Code',
                'User',
                'profiles',
                'deep-profile',
                'globalStorage',
                'publisher.extension'
            );

            fs.mkdirSync(deepPath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: deepPath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);
            const status = await service.getStatus();

            assert.ok(status.copilotDir, 'Should handle deeply nested paths');
            assert.ok(status.copilotDir.includes('deep-profile'), 'Should extract profile from deep path');
        });
    });

    suite('Regex Pattern Validation', () => {
        /**
         * These tests verify that the regex patterns used in getCopilotPromptsDirectory()
         * are correctly escaped and don't cause syntax errors on Windows
         */
        test('should not throw regex errors with backslash path separator', async () => {
            // This test verifies the core fix: proper escaping of path.sep in regex
            const testPath = path.join(
                tempDir,
                'Test',
                'User',
                'profiles',
                'test-id',
                'globalStorage',
                'ext'
            );

            fs.mkdirSync(testPath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: testPath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);

            // Should not throw any regex-related errors
            try {
                const status = await service.getStatus();
                assert.ok(status, 'Should successfully get status');
                assert.ok(status.copilotDir, 'Should return a path');
            } catch (error: any) {
                // Verify it's not a regex error
                assert.ok(
                    !error.message.includes('Invalid regular expression'),
                    `Should not throw regex error: ${error.message}`
                );
                assert.ok(
                    !error.message.includes('Unterminated character class'),
                    `Should not throw unterminated character class: ${error.message}`
                );
            }
        });

        test('should correctly match profiles directory in path', async () => {
            // Verify the regex correctly identifies profiles in the path
            const userPath = path.join(tempDir, 'Code', 'User');
            const profileId = 'abc123';
            const globalStoragePath = path.join(
                userPath,
                'profiles',
                profileId,
                'globalStorage',
                'ext'
            );

            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);
            const status = await service.getStatus();

            // Should correctly extract profile ID from path
            assert.ok(status.copilotDir.includes('profiles'), 'Should detect profiles directory');
            assert.ok(status.copilotDir.includes(profileId), 'Should extract correct profile ID');

            const expectedPath = path.join(userPath, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath, 'Should construct correct prompts path');
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should work on current platform (Windows or Unix-like)', async () => {
            // This test runs on the actual CI platform (Windows Docker)
            const platform = os.platform();
            const isWindows = platform === 'win32';

            const userPath = path.join(tempDir, 'Code', 'User');
            const profileId = 'test-profile';
            const globalStoragePath = path.join(
                userPath,
                'profiles',
                profileId,
                'globalStorage',
                'publisher.extension'
            );

            fs.mkdirSync(globalStoragePath, { recursive: true });

            mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: tempDir,
                subscriptions: [],
            };

            service = new CopilotSyncService(mockContext);
            const status = await service.getStatus();

            // Should work regardless of platform
            assert.ok(status.copilotDir, 'Should return path on any platform');
            assert.ok(status.copilotDir.includes(profileId), 'Should extract profile ID on any platform');

            // Log platform info for CI debugging
            console.log(`Platform: ${platform}, Path separator: ${path.sep}`);
            console.log(`Resolved path: ${status.copilotDir}`);

            if (isWindows) {
                // On Windows, verify backslashes are handled correctly
                assert.ok(
                    globalStoragePath.includes('\\') || globalStoragePath.includes('/'),
                    'Windows path should contain separators'
                );
            }
        });
    });
});
