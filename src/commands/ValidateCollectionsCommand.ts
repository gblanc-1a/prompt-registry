import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

interface CollectionItem {
    path: string;
    kind: string;
}

interface Collection {
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
    items?: CollectionItem[];
    display?: {
        ordering?: string;
        show_badge?: boolean;
    };
}

/**
 * Command to validate collection files in the workspace
 * 
 * Attribution: Validation logic inspired by github/awesome-copilot
 * https://github.com/github/awesome-copilot
 */
export class ValidateCollectionsCommand {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Collection Validator');
    }

    async execute(options?: { checkRefs?: boolean; listOnly?: boolean }): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const collectionsDir = path.join(workspaceRoot, 'collections');

        if (!fs.existsSync(collectionsDir)) {
            vscode.window.showErrorMessage(`Collections directory not found: ${collectionsDir}`);
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.show();

        this.log('📋 Collection Validation Tool\n');
        this.log('Attribution: Inspired by github/awesome-copilot');
        this.log('https://github.com/github/awesome-copilot\n');

        const files = fs.readdirSync(collectionsDir)
            .filter(f => f.endsWith('.collection.yml'))
            .sort();

        if (files.length === 0) {
            this.log('⚠️  No collection files found in ' + collectionsDir, 'warning');
            vscode.window.showWarningMessage('No collection files found');
            return;
        }

        this.log(`Found ${files.length} collection(s)\n`);

        let totalErrors = 0;
        let totalWarnings = 0;
        let validCollections = 0;

        const diagnostics: vscode.Diagnostic[] = [];

        for (const file of files) {
            const filePath = path.join(collectionsDir, file);
            const result = this.validateCollection(filePath, workspaceRoot, options?.checkRefs || false);

            if (options?.listOnly && result.collection) {
                this.log(`📦 ${result.collection.name} (id: ${result.collection.id})`);
                this.log(`   Description: ${result.collection.description}`);
                this.log(`   Items: ${result.collection.items ? result.collection.items.length : 0}`);
                if (result.collection.tags && result.collection.tags.length > 0) {
                    this.log(`   Tags: ${result.collection.tags.join(', ')}`);
                }
                this.log('');
            } else {
                this.log(`Validating: ${file}`);

                if (result.errors.length === 0 && result.warnings.length === 0) {
                    this.log('  ✅ Valid', 'success');
                    validCollections++;
                } else {
                    if (result.errors.length > 0) {
                        result.errors.forEach(err => {
                            this.log(`  ❌ Error: ${err}`, 'error');
                            // Create diagnostic for VS Code Problems panel
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(0, 0, 0, 0),
                                err,
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostics.push(diagnostic);
                        });
                        totalErrors += result.errors.length;
                    }
                    if (result.warnings.length > 0) {
                        result.warnings.forEach(warn => {
                            this.log(`  ⚠️  Warning: ${warn}`, 'warning');
                        });
                        totalWarnings += result.warnings.length;
                    }
                }
                this.log('');
            }
        }

        if (!options?.listOnly) {
            this.log('='.repeat(50));
            this.log(`Summary: ${validCollections}/${files.length} collections valid`);
            this.log(`Total Errors: ${totalErrors}`, totalErrors > 0 ? 'error' : 'success');
            this.log(`Total Warnings: ${totalWarnings}`, totalWarnings > 0 ? 'warning' : 'success');
            this.log('='.repeat(50));

            if (totalErrors > 0) {
                vscode.window.showErrorMessage(`Collection validation failed: ${totalErrors} error(s), ${totalWarnings} warning(s)`);
            } else if (totalWarnings > 0) {
                vscode.window.showWarningMessage(`Collection validation passed with ${totalWarnings} warning(s)`);
            } else {
                vscode.window.showInformationMessage(`✅ All ${validCollections} collection(s) valid!`);
            }
        }
    }

    private validateCollection(filePath: string, workspaceRoot: string, checkRefs: boolean): {
        errors: string[];
        warnings: string[];
        collection: Collection | null;
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const collection = yaml.load(content) as Collection;

            if (!collection) {
                errors.push('Empty or invalid YAML file');
                return { errors, warnings, collection: null };
            }

            // Validate required fields
            if (!collection.id) { errors.push('Missing required field: id'); }
            if (!collection.name) { errors.push('Missing required field: name'); }
            if (!collection.description) { errors.push('Missing required field: description'); }
            if (!collection.items || !Array.isArray(collection.items)) {
                errors.push('Missing or invalid field: items (must be an array)');
            }

            // Validate id format
            if (collection.id && !/^[a-z0-9-]+$/.test(collection.id)) {
                errors.push('Invalid id format (must be lowercase letters, numbers, and hyphens only)');
            }

            // Validate description length
            if (collection.description && collection.description.length > 500) {
                warnings.push('Description is longer than recommended (500 characters)');
            }

            // Validate items
            if (collection.items && Array.isArray(collection.items)) {
                if (collection.items.length === 0) {
                    warnings.push('Collection has no items');
                }

                if (collection.items.length > 50) {
                    warnings.push('Collection has more than 50 items (recommended max)');
                }

                collection.items.forEach((item: any, index: number) => {
                    if (!item.path) {
                        errors.push(`Item ${index + 1}: Missing 'path' field`);
                    }
                    if (!item.kind) {
                        errors.push(`Item ${index + 1}: Missing 'kind' field`);
                    } else if (!['prompt', 'instruction', 'chat-mode', 'agent'].includes(item.kind)) {
                        errors.push(`Item ${index + 1}: Invalid 'kind' value (must be prompt, instruction, chat-mode, or agent)`);
                    }

                    // Check if file exists
                    if (item.path && checkRefs) {
                        const itemPath = path.join(workspaceRoot, item.path);
                        if (!fs.existsSync(itemPath)) {
                            errors.push(`Item ${index + 1}: Referenced file does not exist: ${item.path}`);
                        }
                    }
                });
            }

            // Validate tags
            if (collection.tags) {
                if (!Array.isArray(collection.tags)) {
                    errors.push('Tags must be an array');
                } else {
                    if (collection.tags.length > 10) {
                        warnings.push('More than 10 tags (recommended max)');
                    }
                    collection.tags.forEach((tag: any, index: number) => {
                        if (typeof tag !== 'string') {
                            errors.push(`Tag ${index + 1}: Must be a string`);
                        } else if (tag.length > 30) {
                            warnings.push(`Tag ${index + 1}: Longer than 30 characters`);
                        }
                    });
                }
            }

            return { errors, warnings, collection };

        } catch (error) {
            errors.push(`Failed to parse YAML: ${(error as Error).message}`);
            return { errors, warnings, collection: null };
        }
    }

    private log(message: string, type?: 'error' | 'warning' | 'success'): void {
        let prefix = '';
        switch (type) {
            case 'error':
                prefix = '❌ ';
                break;
            case 'warning':
                prefix = '⚠️  ';
                break;
            case 'success':
                prefix = '✅ ';
                break;
        }
        this.outputChannel.appendLine(prefix + message);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
