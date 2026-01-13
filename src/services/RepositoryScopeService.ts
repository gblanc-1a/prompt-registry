/**
 * Repository Scope Service
 * 
 * Handles repository-level bundle installation by placing files in .github/ directories.
 * Supports both commit mode (tracked by Git) and local-only mode (excluded via .git/info/exclude).
 * 
 * Requirements: 1.2-1.7, 3.1-3.7, 7.8-7.10, 10.1-10.6
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { promisify } from 'util';
import { Logger } from '../utils/logger';
import { IScopeService, ScopeStatus } from './IScopeService';
import { RegistryStorage } from '../storage/RegistryStorage';
import { RepositoryCommitMode, DeploymentManifest } from '../types/registry';
import {
    CopilotFileType,
    determineFileType,
    getTargetFileName,
    getRepositoryTargetDirectory
} from '../utils/copilotFileTypeUtils';
import { ensureDirectory } from '../utils/fileIntegrityService';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const copyFile = promisify(fs.copyFile);
const stat = promisify(fs.stat);

/**
 * Section header for Prompt Registry entries in .git/info/exclude
 */
const GIT_EXCLUDE_SECTION_HEADER = '# Prompt Registry (local)';

/**
 * Service to sync bundle files to repository .github/ directories.
 * Implements IScopeService for consistent scope handling.
 */
export class RepositoryScopeService implements IScopeService {
    private logger: Logger;
    private workspaceRoot: string;
    private storage: RegistryStorage;

    /**
     * Create a new RepositoryScopeService
     * 
     * @param workspaceRoot - The root directory of the workspace/repository
     * @param storage - RegistryStorage instance for looking up bundle metadata
     */
    constructor(workspaceRoot: string, storage: RegistryStorage) {
        this.workspaceRoot = workspaceRoot;
        this.storage = storage;
        this.logger = Logger.getInstance();
    }

    /**
     * Get the .github base directory path
     */
    private getGitHubDirectory(): string {
        return path.join(this.workspaceRoot, '.github');
    }

    /**
     * Get the .git/info/exclude file path
     */
    private getGitExcludePath(): string {
        return path.join(this.workspaceRoot, '.git', 'info', 'exclude');
    }

    /**
     * Check if .git directory exists
     */
    private hasGitDirectory(): boolean {
        return fs.existsSync(path.join(this.workspaceRoot, '.git'));
    }

    /**
     * Ensure a directory exists, creating it if necessary.
     * Delegates to shared fileIntegrityService utility.
     */
    private async ensureDir(dir: string): Promise<void> {
        await ensureDirectory(dir);
        this.logger.debug(`[RepositoryScopeService] Ensured directory exists: ${dir}`);
    }

    /**
     * Get the target path for a file of a given type.
     * Implements IScopeService.getTargetPath
     * 
     * @param fileType - The Copilot file type
     * @param fileName - The name of the file (without extension)
     * @returns The full target path where the file should be placed
     */
    getTargetPath(fileType: CopilotFileType, fileName: string): string {
        const relativeDir = getRepositoryTargetDirectory(fileType);
        const targetFileName = getTargetFileName(fileName, fileType);
        return path.join(this.workspaceRoot, relativeDir, targetFileName);
    }

    /**
     * Get the relative path from workspace root for git exclude
     */
    private getRelativePath(absolutePath: string): string {
        return path.relative(this.workspaceRoot, absolutePath);
    }

    /**
     * Sync a bundle's files to the appropriate .github/ directories.
     * Implements IScopeService.syncBundle
     * 
     * @param bundleId - The unique identifier of the bundle
     * @param bundlePath - The path to the installed bundle directory
     */
    async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Syncing bundle: ${bundleId}`);

            // Get commit mode from storage
            const installedBundle = await this.storage.getInstalledBundle(bundleId, 'repository');
            const commitMode: RepositoryCommitMode = installedBundle?.commitMode ?? 'commit';

            // Read deployment manifest
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`[RepositoryScopeService] No manifest found for bundle: ${bundleId}`);
                return;
            }

            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;

            if (!manifest.prompts || manifest.prompts.length === 0) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} has no prompts to sync`);
                return;
            }

            // Install files
            const installedPaths = await this.installFiles(bundleId, bundlePath, manifest, commitMode);

            this.logger.info(`[RepositoryScopeService] ✅ Synced ${installedPaths.length} files for bundle: ${bundleId}`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to sync bundle ${bundleId}`, error as Error);
            throw error;
        }
    }

    /**
     * Install files from a bundle to .github/ directories
     * 
     * @param bundleId - Bundle identifier
     * @param bundlePath - Path to bundle directory
     * @param manifest - Deployment manifest
     * @param commitMode - Whether to track in git or exclude
     * @returns Array of installed file paths (relative to workspace)
     */
    private async installFiles(
        bundleId: string,
        bundlePath: string,
        manifest: DeploymentManifest,
        commitMode: RepositoryCommitMode
    ): Promise<string[]> {
        const installedPaths: string[] = [];
        const installedAbsolutePaths: string[] = [];

        try {
            for (const promptDef of manifest.prompts || []) {
                // Skip skills for now (they require directory handling)
                if (promptDef.type === 'skill') {
                    this.logger.debug(`[RepositoryScopeService] Skipping skill: ${promptDef.id}`);
                    continue;
                }

                const sourcePath = path.join(bundlePath, promptDef.file);
                if (!fs.existsSync(sourcePath)) {
                    this.logger.warn(`[RepositoryScopeService] Source file not found: ${sourcePath}`);
                    continue;
                }

                // Determine file type
                const fileType = promptDef.type as CopilotFileType || determineFileType(promptDef.file, promptDef.tags);

                // Get target path
                const targetPath = this.getTargetPath(fileType, promptDef.id);

                // Ensure target directory exists
                await this.ensureDir(path.dirname(targetPath));

                // Copy file
                await copyFile(sourcePath, targetPath);
                this.logger.debug(`[RepositoryScopeService] Copied: ${path.basename(sourcePath)} → ${this.getRelativePath(targetPath)}`);

                installedAbsolutePaths.push(targetPath);
                installedPaths.push(this.getRelativePath(targetPath));
            }

            // Handle git exclude for local-only mode
            if (commitMode === 'local-only' && installedPaths.length > 0) {
                await this.addToGitExclude(installedPaths);
            }

            return installedPaths;

        } catch (error) {
            // Rollback: remove any files that were installed
            this.logger.error(`[RepositoryScopeService] Installation failed, rolling back...`);
            for (const absolutePath of installedAbsolutePaths) {
                try {
                    if (fs.existsSync(absolutePath)) {
                        await unlink(absolutePath);
                        this.logger.debug(`[RepositoryScopeService] Rolled back: ${absolutePath}`);
                    }
                } catch (rollbackError) {
                    this.logger.warn(`[RepositoryScopeService] Failed to rollback file: ${absolutePath}`);
                }
            }
            throw error;
        }
    }

    /**
     * Remove synced files for a bundle.
     * Implements IScopeService.unsyncBundle
     * 
     * @param bundleId - The unique identifier of the bundle to unsync
     */
    async unsyncBundle(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Removing files for bundle: ${bundleId}`);

            // Get installed bundle info
            const installedBundle = await this.storage.getInstalledBundle(bundleId, 'repository');
            if (!installedBundle) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} not found in storage`);
                return;
            }

            // Read manifest to find files
            const manifestPath = path.join(installedBundle.installPath, 'deployment-manifest.yml');
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`[RepositoryScopeService] No manifest found for bundle: ${bundleId}`);
                return;
            }

            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;

            if (!manifest.prompts || manifest.prompts.length === 0) {
                return;
            }

            const removedPaths: string[] = [];

            // Remove each file
            for (const promptDef of manifest.prompts) {
                if (promptDef.type === 'skill') {
                    continue;
                }

                const fileType = promptDef.type as CopilotFileType || determineFileType(promptDef.file, promptDef.tags);
                const targetPath = this.getTargetPath(fileType, promptDef.id);

                if (fs.existsSync(targetPath)) {
                    await unlink(targetPath);
                    removedPaths.push(this.getRelativePath(targetPath));
                    this.logger.debug(`[RepositoryScopeService] Removed: ${this.getRelativePath(targetPath)}`);
                }
            }

            // Remove from git exclude if needed
            if (removedPaths.length > 0) {
                await this.removeFromGitExclude(removedPaths);
            }

            this.logger.info(`[RepositoryScopeService] ✅ Removed ${removedPaths.length} files for bundle: ${bundleId}`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to unsync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Get the current status of the scope service.
     * Implements IScopeService.getStatus
     */
    async getStatus(): Promise<ScopeStatus> {
        const githubDir = this.getGitHubDirectory();
        const status: ScopeStatus = {
            baseDirectory: githubDir,
            dirExists: fs.existsSync(githubDir),
            syncedFiles: 0,
            files: []
        };

        if (!status.dirExists) {
            return status;
        }

        // Scan all .github subdirectories for files
        const subdirs = ['prompts', 'agents', 'instructions', 'skills'];
        for (const subdir of subdirs) {
            const subdirPath = path.join(githubDir, subdir);
            if (fs.existsSync(subdirPath)) {
                try {
                    const files = await readdir(subdirPath);
                    for (const file of files) {
                        const filePath = path.join(subdirPath, file);
                        const fileStat = await stat(filePath);
                        if (fileStat.isFile()) {
                            status.syncedFiles++;
                            status.files.push(file);
                        }
                    }
                } catch (error) {
                    this.logger.debug(`[RepositoryScopeService] Could not read directory: ${subdirPath}`);
                }
            }
        }

        return status;
    }

    /**
     * Switch the commit mode for a bundle
     * 
     * @param bundleId - Bundle identifier
     * @param newMode - New commit mode
     */
    async switchCommitMode(bundleId: string, newMode: RepositoryCommitMode): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Switching commit mode for ${bundleId} to ${newMode}`);

            // Get installed bundle info
            const installedBundle = await this.storage.getInstalledBundle(bundleId, 'repository');
            if (!installedBundle) {
                this.logger.warn(`[RepositoryScopeService] Bundle ${bundleId} not found`);
                return;
            }

            const currentMode = installedBundle.commitMode ?? 'commit';
            if (currentMode === newMode) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} already in ${newMode} mode`);
                return;
            }

            // Read manifest to find files
            const manifestPath = path.join(installedBundle.installPath, 'deployment-manifest.yml');
            if (!fs.existsSync(manifestPath)) {
                return;
            }

            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;

            if (!manifest.prompts || manifest.prompts.length === 0) {
                return;
            }

            // Collect file paths
            const filePaths: string[] = [];
            for (const promptDef of manifest.prompts) {
                if (promptDef.type === 'skill') {
                    continue;
                }
                const fileType = promptDef.type as CopilotFileType || determineFileType(promptDef.file, promptDef.tags);
                const targetPath = this.getTargetPath(fileType, promptDef.id);
                if (fs.existsSync(targetPath)) {
                    filePaths.push(this.getRelativePath(targetPath));
                }
            }

            // Update git exclude based on new mode
            if (newMode === 'local-only') {
                await this.addToGitExclude(filePaths);
            } else {
                await this.removeFromGitExclude(filePaths);
            }

            this.logger.info(`[RepositoryScopeService] ✅ Switched ${bundleId} to ${newMode} mode`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to switch commit mode for ${bundleId}`, error as Error);
        }
    }

    /**
     * Add paths to .git/info/exclude under the Prompt Registry section
     * 
     * @param paths - Relative paths to add
     */
    private async addToGitExclude(paths: string[]): Promise<void> {
        if (!this.hasGitDirectory()) {
            this.logger.warn('[RepositoryScopeService] No .git directory found, skipping git exclude');
            return;
        }

        try {
            const excludePath = this.getGitExcludePath();
            
            // Ensure .git/info directory exists
            await this.ensureDir(path.dirname(excludePath));

            // Read existing content
            let content = '';
            if (fs.existsSync(excludePath)) {
                content = await readFile(excludePath, 'utf-8');
            }

            // Find or create our section
            const sectionIndex = content.indexOf(GIT_EXCLUDE_SECTION_HEADER);
            let beforeSection = content;
            let sectionContent = '';
            let afterSection = '';

            if (sectionIndex !== -1) {
                beforeSection = content.substring(0, sectionIndex);
                const afterHeaderIndex = sectionIndex + GIT_EXCLUDE_SECTION_HEADER.length;
                const remainingContent = content.substring(afterHeaderIndex);
                
                // Find the end of our section (next section header or end of file)
                const nextSectionMatch = remainingContent.match(/\n#[^\n]+/);
                if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                    sectionContent = remainingContent.substring(0, nextSectionMatch.index);
                    afterSection = remainingContent.substring(nextSectionMatch.index);
                } else {
                    sectionContent = remainingContent;
                }
            }

            // Parse existing entries in our section
            const existingEntries = new Set(
                sectionContent.split('\n').map(line => line.trim()).filter(line => line.length > 0)
            );

            // Add new paths
            for (const p of paths) {
                existingEntries.add(p);
            }

            // Rebuild content
            const newSectionContent = Array.from(existingEntries).join('\n');
            const newContent = beforeSection.trimEnd() + 
                (beforeSection.length > 0 ? '\n\n' : '') +
                GIT_EXCLUDE_SECTION_HEADER + '\n' +
                newSectionContent + '\n' +
                afterSection;

            await writeFile(excludePath, newContent.trim() + '\n', 'utf-8');
            this.logger.debug(`[RepositoryScopeService] Added ${paths.length} paths to git exclude`);

        } catch (error) {
            this.logger.warn(`[RepositoryScopeService] Failed to update git exclude: ${error}`);
            // Don't throw - git exclude is optional
        }
    }

    /**
     * Remove paths from .git/info/exclude
     * 
     * @param paths - Relative paths to remove
     */
    private async removeFromGitExclude(paths: string[]): Promise<void> {
        if (!this.hasGitDirectory()) {
            return;
        }

        try {
            const excludePath = this.getGitExcludePath();
            if (!fs.existsSync(excludePath)) {
                return;
            }

            let content = await readFile(excludePath, 'utf-8');

            // Find our section
            const sectionIndex = content.indexOf(GIT_EXCLUDE_SECTION_HEADER);
            if (sectionIndex === -1) {
                return;
            }

            const beforeSection = content.substring(0, sectionIndex);
            const afterHeaderIndex = sectionIndex + GIT_EXCLUDE_SECTION_HEADER.length;
            const remainingContent = content.substring(afterHeaderIndex);

            // Find the end of our section
            const nextSectionMatch = remainingContent.match(/\n#[^\n]+/);
            let sectionContent: string;
            let afterSection = '';

            if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                sectionContent = remainingContent.substring(0, nextSectionMatch.index);
                afterSection = remainingContent.substring(nextSectionMatch.index);
            } else {
                sectionContent = remainingContent;
            }

            // Parse and filter entries
            const pathsToRemove = new Set(paths);
            const remainingEntries = sectionContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !pathsToRemove.has(line));

            // Rebuild content
            let newContent: string;
            if (remainingEntries.length === 0) {
                // Remove entire section if empty
                newContent = beforeSection.trimEnd() + afterSection;
            } else {
                newContent = beforeSection.trimEnd() +
                    (beforeSection.length > 0 ? '\n\n' : '') +
                    GIT_EXCLUDE_SECTION_HEADER + '\n' +
                    remainingEntries.join('\n') + '\n' +
                    afterSection;
            }

            await writeFile(excludePath, newContent.trim() + '\n', 'utf-8');
            this.logger.debug(`[RepositoryScopeService] Removed ${paths.length} paths from git exclude`);

        } catch (error) {
            this.logger.warn(`[RepositoryScopeService] Failed to update git exclude: ${error}`);
        }
    }
}
