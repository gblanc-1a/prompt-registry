/**
 * Unified Uninstaller - Single, Clean Interface for Prompt Registry Uninstallation
 * 
 * This module provides a single, well-tested uninstall interface that handles
 * all scenarios: complete, smart, and custom uninstallation.
 * 
 * Design Principles:
 * - Single responsibility: Only handles uninstallation
 * - Clear interface: Simple options and results
 * - Testable: All behavior is unit tested
 * - Reliable: Graceful error handling and recovery
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

/**
 * Types of uninstallation operations
 */
export type UninstallType = 'complete' | 'smart' | 'custom';

/**
 * File categorization for uninstallation decisions
 */
export interface FileCategory {
    path: string;
    size: number;
    mtime: Date;
    category: 'original' | 'modified' | 'userCreated' | 'missing';
}

/**
 * Categorized files for uninstall processing
 */
export interface FileCategorization {
    original: FileCategory[];
    modified: FileCategory[];
    userCreated: FileCategory[];
    missing: FileCategory[];
}

/**
 * Installation metadata for file categorization
 */
export interface InstallationMetadata {
    originalFiles: string[];
    modifiedFiles: string[];
    userCreatedFiles: string[];
    installationPath: string;
    installationDate: string;
}

/**
 * Uninstall operation options
 */
export interface UninstallOptions {
    /** Type of uninstall operation */
    type: UninstallType;
    
    /** Target directory to uninstall from */
    targetDir: string;
    
    /** Whether to create backup of preserved files */
    createBackup: boolean;
    
    /** Custom file selection (required for 'custom' type) */
    customSelection?: string[];
    
    /** Installation metadata for file categorization */
    metadata?: InstallationMetadata;
    
    /** Progress callback */
    onProgress?: (progress: number, message: string) => void;
}

/**
 * Result of uninstall operation
 */
export interface UninstallResult {
    /** Whether the operation was successful */
    success: boolean;
    
    /** Number of files successfully removed */
    filesRemoved: number;
    
    /** Number of files preserved */
    filesPreserved: number;
    
    /** Path to backup directory (if created) */
    backupPath?: string;
    
    /** List of errors encountered */
    errors: string[];
    
    /** Detailed breakdown of what happened */
    details: {
        removed: string[];
        preserved: string[];
        backedUp: string[];
        failed: string[];
    };
}

/**
 * Unified Uninstaller Class
 * 
 * Handles all uninstallation scenarios with a single, clean interface.
 * Designed for reliability, testability, and clear user experience.
 */
export class UnifiedUninstaller {
    
    /**
     * Perform uninstallation based on provided options
     */
    async uninstall(options: UninstallOptions): Promise<UninstallResult> {
        const validationError = this.validateOptions(options);
        if (validationError) {
            return {
                success: false,
                filesRemoved: 0,
                filesPreserved: 0,
                errors: [validationError],
                details: {
                    removed: [],
                    preserved: [],
                    backedUp: [],
                    failed: []
                }
            };
        }
        
        const result: UninstallResult = {
            success: false,
            filesRemoved: 0,
            filesPreserved: 0,
            errors: [],
            details: {
                removed: [],
                preserved: [],
                backedUp: [],
                failed: []
            }
        };

        try {
            options.onProgress?.(0, 'Starting uninstallation...');
            
            // Step 1: Categorize files
            options.onProgress?.(10, 'Categorizing files...');
            const categories = await this.categorizeFiles(options.targetDir, options.metadata);
            
            // Step 2: Determine what to remove/preserve based on type
            options.onProgress?.(30, 'Determining file actions...');
            const actions = await this.planActions(categories, options);
            
            // Step 3: Create backup if needed
            if (options.createBackup && actions.preserve.length > 0) {
                options.onProgress?.(50, 'Creating backup...');
                result.backupPath = await this.createBackup(actions.preserve, options.targetDir);
                result.details.backedUp = actions.preserve.map(f => f.path);
            }
            
            // Step 4: Remove files
            options.onProgress?.(70, 'Removing files...');
            await this.removeFiles(actions.remove, result);
            
            // Step 5: Update counts
            result.filesRemoved = result.details.removed.length;
            result.filesPreserved = actions.preserve.length;
            result.details.preserved = actions.preserve.map(f => f.path);
            result.success = true;
            
            options.onProgress?.(100, 'Uninstallation completed');
            
        } catch (error) {
            console.error('[UnifiedUninstaller] Error during uninstall:', error);
            result.errors.push(error instanceof Error ? error.message : String(error));
            result.success = false;
        }

        return result;
    }

    /**
     * Categorize files based on installation metadata and current state
     */
    async categorizeFiles(targetDir: string, metadata?: InstallationMetadata): Promise<FileCategorization> {
        const categories: FileCategorization = {
            original: [],
            modified: [],
            userCreated: [],
            missing: []
        };

        if (!metadata) {
            // CRITICAL SAFETY: Never scan arbitrary directories without metadata!
            // This prevents catastrophic deletion of entire workspaces including .git
            throw new Error('SAFETY ERROR: Cannot uninstall without installation metadata. ' +
                          'This prevents accidental deletion of non-Prompt Registry files. ' + 
                          'Installation metadata is required to identify which files were actually installed by Prompt Registry.');
        }

        // Categorize based on metadata
        for (const filePath of metadata.originalFiles || []) {
            const category = await this.categorizeFile(filePath, 'original');
            if (category.category === 'missing') {
                categories.missing.push(category);
            } else {
                categories.original.push(category);
            }
        }

        for (const filePath of metadata.modifiedFiles || []) {
            const category = await this.categorizeFile(filePath, 'modified');
            if (category.category === 'missing') {
                categories.missing.push(category);
            } else {
                categories.modified.push(category);
            }
        }

        for (const filePath of metadata.userCreatedFiles || []) {
            const category = await this.categorizeFile(filePath, 'userCreated');
            if (category.category === 'missing') {
                categories.missing.push(category);
            } else {
                categories.userCreated.push(category);
            }
        }

        return categories;
    }

    /**
     * Plan what actions to take on each file category
     */
    private async planActions(categories: FileCategorization, options: UninstallOptions) {
        const remove: FileCategory[] = [];
        const preserve: FileCategory[] = [];

        switch (options.type) {
            case 'complete':
                // Remove everything that exists
                remove.push(...categories.original, ...categories.modified, ...categories.userCreated);
                break;
                
            case 'smart':
                // Remove original files, preserve modified and user-created
                remove.push(...categories.original);
                preserve.push(...categories.modified, ...categories.userCreated);
                break;
                
            case 'custom': {
                if (!options.customSelection) {
                    throw new Error('Custom selection required for custom uninstall');
                }
                
                // Only remove files in custom selection
                const allFiles = [...categories.original, ...categories.modified, ...categories.userCreated];
                const metadataFiles = new Set(allFiles.map(f => f.path));
                for (const file of allFiles) {
                    if (options.customSelection.includes(file.path)) {
                        remove.push(file);
                    } else {
                        preserve.push(file);
                    }
                }

                // Handle files in customSelection that are not in metadata
                for (const filePath of options.customSelection) {
                    if (!metadataFiles.has(filePath)) {
                        try {
                            const stats = await fs.stat(filePath);
                            remove.push({
                                path: filePath,
                                size: stats.size,
                                mtime: stats.mtime,
                                category: 'original'
                            });
                        } catch {
                            // File does not exist, skip silently
                        }
                    }
                }
                break;
            }
        }

        return { remove, preserve };
    }

    /**
     * Create backup of files to be preserved
     */
    private async createBackup(files: FileCategory[], sourceDir: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(os.tmpdir(), `olaf-backup-${timestamp}`);
        
        await fs.ensureDir(backupPath);
        
        for (const file of files) {
            const relativePath = path.relative(sourceDir, file.path);
            const backupFilePath = path.join(backupPath, relativePath);
            
            await fs.ensureDir(path.dirname(backupFilePath));
            await fs.copy(file.path, backupFilePath);
        }
        
        return backupPath;
    }

    /**
     * Remove files and update result
     */
    private async removeFiles(files: FileCategory[], result: UninstallResult): Promise<void> {
        for (const file of files) {
            try {
                if (await fs.pathExists(file.path)) {
                    await fs.remove(file.path);
                    result.details.removed.push(file.path);
                }
            } catch (error) {
                const errorMsg = `Failed to remove ${file.path}: ${error instanceof Error ? error.message : String(error)}`;
                result.errors.push(errorMsg);
                result.details.failed.push(file.path);
            }
        }
    }

    /**
     * Categorize a single file
     */
    private async categorizeFile(filePath: string, expectedCategory: 'original' | 'modified' | 'userCreated'): Promise<FileCategory> {
        try {
            const stats = await fs.stat(filePath);
            return {
                path: filePath,
                size: stats.size,
                mtime: stats.mtime,
                category: expectedCategory
            };
        } catch {
            return {
                path: filePath,
                size: 0,
                mtime: new Date(),
                category: 'missing'
            };
        }
    }

    /**
     * Scan directory for all files
     */
    private async scanDirectory(dirPath: string): Promise<FileCategory[]> {
        const files: FileCategory[] = [];
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subFiles = await this.scanDirectory(fullPath);
                    files.push(...subFiles);
                } else {
                    const stats = await fs.stat(fullPath);
                    files.push({
                        path: fullPath,
                        size: stats.size,
                        mtime: stats.mtime,
                        category: 'original'
                    });
                }
            }
        } catch (error) {
            // Directory doesn't exist or is inaccessible
        }
        
        return files;
    }

    /**
     * Validate uninstall options
     */
    private validateOptions(options: UninstallOptions): string | null {
        if (!options.targetDir) {
            return 'Target directory is required';
        }
        
        if (!fs.pathExistsSync(options.targetDir)) {
            return 'Target directory is required';
        }
        
        if (options.type === 'custom' && (!options.customSelection || options.customSelection.length === 0)) {
            return 'Custom selection required for custom uninstall';
        }
        
        if (options.customSelection) {
            for (const filePath of options.customSelection) {
                if (!path.resolve(filePath).startsWith(path.resolve(options.targetDir))) {
                    return `Invalid file path outside target directory: ${filePath}`;
                }
            }
        }
        return null;
    }
}
