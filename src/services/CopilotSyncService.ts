/**
 * Copilot Sync Service
 * Syncs installed prompts to GitHub Copilot's native locations
 * 
 * Instead of using a custom chat participant, we create symlinks/copies
 * of prompt files to locations where GitHub Copilot naturally discovers them.
 * 
 * This works in:
 * - VSCode stable (no proposed APIs needed!)
 * - VSCode Insiders
 * - Windsurf and other forks
 * 
 * Based on: https://github.com/github/awesome-copilot
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';
import { DeploymentManifest } from '../types/registry';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const symlink = promisify(fs.symlink);
const lstat = promisify(fs.lstat);

/**
 * Supported Copilot file types
 */
export type CopilotFileType = 'prompt' | 'instructions' | 'chatmode' | 'agent';

export interface CopilotFile {
    bundleId: string;
    type: CopilotFileType;
    name: string;
    sourcePath: string;
    targetPath: string;
}

/**
 * Service to sync bundle prompts to GitHub Copilot's native directories
 */
export class CopilotSyncService {
    private logger: Logger;
    private copilotPromptsDir: string;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        
        // Detect which VSCode flavor and get appropriate prompts directory
        this.copilotPromptsDir = this.getCopilotPromptsDirectory();
    }

    /**
     * Get the Copilot prompts directory for current VSCode flavor
     */
    private getCopilotPromptsDirectory(): string {
        const home = os.homedir();
        const platform = os.platform();
        
        // Detect VSCode flavor from executable name or environment
        const product = vscode.env.appName;
        
        let baseDir: string;
        
        // Determine base directory based on OS and VSCode flavor
        if (platform === 'darwin') {
            // macOS: ~/Library/Application Support/...
            if (product.includes('Insiders')) {
                baseDir = path.join(home, 'Library/Application Support/Code - Insiders');
            } else if (product.includes('Windsurf')) {
                baseDir = path.join(home, 'Library/Application Support/Windsurf');
            } else {
                // Default to stable VSCode
                baseDir = path.join(home, 'Library/Application Support/Code');
            }
        } else if (platform === 'win32') {
            // Windows: %APPDATA%\...
            const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming');
            if (product.includes('Insiders')) {
                baseDir = path.join(appData, 'Code - Insiders');
            } else if (product.includes('Windsurf')) {
                baseDir = path.join(appData, 'Windsurf');
            } else {
                baseDir = path.join(appData, 'Code');
            }
        } else {
            // Linux/Unix: ~/.config/...
            if (product.includes('Insiders')) {
                baseDir = path.join(home, '.config/Code - Insiders');
            } else if (product.includes('Windsurf')) {
                baseDir = path.join(home, '.config/Windsurf');
            } else {
                baseDir = path.join(home, '.config/Code');
            }
        }
        
        return path.join(baseDir, 'User', 'prompts');
    }

    /**
     * Sync all prompts from installed bundles to Copilot directory
     */
    async syncAllBundles(): Promise<void> {
        try {
            this.logger.info('Syncing bundles to GitHub Copilot...');
            
            // Ensure Copilot prompts directory exists
            await this.ensureDirectory(this.copilotPromptsDir);
            
            // Get all installed bundles
            const bundlesDir = path.join(this.context.globalStorageUri.fsPath, 'bundles');
            
            if (!fs.existsSync(bundlesDir)) {
                this.logger.debug('No bundles directory found');
                return;
            }
            
            const bundleDirs = await readdir(bundlesDir);
            
            for (const bundleId of bundleDirs) {
                const bundlePath = path.join(bundlesDir, bundleId);
                const stat = fs.statSync(bundlePath);
                
                if (stat.isDirectory()) {
                    await this.syncBundle(bundleId, bundlePath);
                }
            }
            
            this.logger.info(`Synced ${bundleDirs.length} bundles to Copilot`);
            
        } catch (error) {
            this.logger.error('Failed to sync bundles to Copilot', error as Error);
        }
    }

    /**
     * Sync a single bundle to Copilot directory
     */
    async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
        try {
            this.logger.debug(`Syncing bundle: ${bundleId}`);
            
            // Read deployment manifest
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`No manifest found for bundle: ${bundleId}`);
                return;
            }
            
            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;
            
            if (!manifest.prompts || manifest.prompts.length === 0) {
                this.logger.debug(`Bundle ${bundleId} has no prompts to sync`);
                return;
            }
            
            // Sync each prompt
            for (const promptDef of manifest.prompts) {
                const sourcePath = path.join(bundlePath, promptDef.file);
                
                if (!fs.existsSync(sourcePath)) {
                    this.logger.warn(`Prompt file not found: ${sourcePath}`);
                    continue;
                }
                
                // Detect file type and create appropriate filename
                const copilotFile = this.determineCopilotFileType(promptDef, sourcePath, bundleId);
                
                // Create symlink or copy
                await this.createCopilotFile(copilotFile);
            }
            
        } catch (error) {
            this.logger.error(`Failed to sync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Determine Copilot file type and target path
     */
    private determineCopilotFileType(
        promptDef: any,
        sourcePath: string,
        bundleId: string
    ): CopilotFile {
        // Check if tags or filename indicate type
        const tags = promptDef.tags || [];
        const fileName = path.basename(sourcePath, path.extname(sourcePath));
        
        let type: CopilotFileType = 'prompt'; // default
        
        // Detect type from tags
        if (tags.includes('instructions') || fileName.includes('instructions')) {
            type = 'instructions';
        } else if (tags.includes('chatmode') || tags.includes('mode')) {
            type = 'chatmode';
        } else if (tags.includes('agent')) {
            type = 'agent';
        }
        
        // Or from manifest type field if exists
        if (promptDef.type) {
            type = promptDef.type as CopilotFileType;
        }
        
        // Create target filename: bundleId-promptId.type.md
        const targetFileName = `${bundleId}-${promptDef.id}.${type}.md`;
        const targetPath = path.join(this.copilotPromptsDir, targetFileName);
        
        return {
            bundleId,
            type,
            name: promptDef.name,
            sourcePath,
            targetPath
        };
    }

    /**
     * Create symlink (or copy if symlink fails) to Copilot directory
     */
    private async createCopilotFile(file: CopilotFile): Promise<void> {
        try {
            // Check if target already exists
            if (fs.existsSync(file.targetPath)) {
                // Check if it's our symlink/file
                const stats = await lstat(file.targetPath);
                
                if (stats.isSymbolicLink()) {
                    // Remove old symlink
                    await unlink(file.targetPath);
                    this.logger.debug(`Removed old symlink: ${file.targetPath}`);
                } else {
                    // It's a regular file - might be user's custom file, skip
                    this.logger.warn(`File already exists (not managed): ${file.targetPath}`);
                    return;
                }
            }
            
            // Ensure parent directory exists before creating symlink/file
            const targetDir = path.dirname(file.targetPath);
            await this.ensureDirectory(targetDir);
            
            // Try to create symlink first (preferred)
            try {
                await symlink(file.sourcePath, file.targetPath, 'file');
                this.logger.debug(`Created symlink: ${path.basename(file.targetPath)}`);
            } catch (symlinkError) {
                // Symlink failed (maybe Windows or permissions), fall back to copy
                this.logger.debug('Symlink failed, copying file instead');
                const content = await readFile(file.sourcePath, 'utf-8');
                await writeFile(file.targetPath, content, 'utf-8');
                this.logger.debug(`Copied file: ${path.basename(file.targetPath)}`);
            }
            
            this.logger.info(`✅ Synced ${file.type}: ${file.name} → ${path.basename(file.targetPath)}`);
            
        } catch (error) {
            this.logger.error(`Failed to create Copilot file: ${file.targetPath}`, error as Error);
        }
    }

    /**
     * Remove synced files for a bundle
     */
    async unsyncBundle(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Removing Copilot files for bundle: ${bundleId}`);
            
            if (!fs.existsSync(this.copilotPromptsDir)) {
                return;
            }
            
            // List all files in Copilot prompts directory
            const files = await readdir(this.copilotPromptsDir);
            
            // Remove files that match our bundle ID pattern
            for (const file of files) {
                if (file.startsWith(`${bundleId}-`)) {
                    const filePath = path.join(this.copilotPromptsDir, file);
                    
                    // Check if it's a symlink or regular file
                    const stats = await lstat(filePath);
                    
                    // Only remove if it's a symlink (to avoid deleting user's custom files)
                    if (stats.isSymbolicLink()) {
                        await unlink(filePath);
                        this.logger.debug(`Removed: ${file}`);
                    } else {
                        this.logger.warn(`Skipping non-symlink file: ${file}`);
                    }
                }
            }
            
            this.logger.info(`✅ Removed Copilot files for bundle: ${bundleId}`);
            
        } catch (error) {
            this.logger.error(`Failed to unsync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Clean all synced files (for extension uninstall)
     */
    async cleanAll(): Promise<void> {
        try {
            this.logger.info('Cleaning all Copilot synced files...');
            
            if (!fs.existsSync(this.copilotPromptsDir)) {
                return;
            }
            
            const files = await readdir(this.copilotPromptsDir);
            
            // Get list of all bundle IDs from our storage
            const bundlesDir = path.join(this.context.globalStorageUri.fsPath, 'bundles');
            
            if (!fs.existsSync(bundlesDir)) {
                return;
            }
            
            const bundleIds = await readdir(bundlesDir);
            
            // Remove all files for our bundles
            for (const bundleId of bundleIds) {
                await this.unsyncBundle(bundleId);
            }
            
            this.logger.info('✅ Cleaned all Copilot synced files');
            
        } catch (error) {
            this.logger.error('Failed to clean Copilot files', error as Error);
        }
    }

    /**
     * Get status of Copilot integration
     */
    async getStatus(): Promise<{
        copilotDir: string;
        dirExists: boolean;
        syncedFiles: number;
        files: string[];
    }> {
        const status = {
            copilotDir: this.copilotPromptsDir,
            dirExists: fs.existsSync(this.copilotPromptsDir),
            syncedFiles: 0,
            files: [] as string[]
        };
        
        if (status.dirExists) {
            const files = await readdir(this.copilotPromptsDir);
            
            // Get bundle IDs
            const bundlesDir = path.join(this.context.globalStorageUri.fsPath, 'bundles');
            const bundleIds = fs.existsSync(bundlesDir) ? await readdir(bundlesDir) : [];
            
            // Count files that belong to our bundles
            for (const file of files) {
                for (const bundleId of bundleIds) {
                    if (file.startsWith(`${bundleId}-`)) {
                        status.syncedFiles++;
                        status.files.push(file);
                        break;
                    }
                }
            }
        }
        
        return status;
    }

    /**
     * Ensure directory exists
     */
    private async ensureDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            this.logger.debug(`Created directory: ${dir}`);
        }
    }
}
