import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SchemaValidator } from '../services/SchemaValidator';

interface ValidationResult {
    errors: string[];
    warnings: string[];
    manifest: any | null;
}

/**
 * Command to validate APM packages in the workspace
 */
export class ValidateApmCommand {
    private outputChannel: vscode.OutputChannel;
    private schemaValidator: SchemaValidator;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('APM Validator');
        this.schemaValidator = new SchemaValidator(context.extensionPath);
    }

    async execute(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const manifestPath = path.join(workspaceRoot, 'apm.yml');

        if (!fs.existsSync(manifestPath)) {
            vscode.window.showErrorMessage(`apm.yml not found in workspace root: ${workspaceRoot}`);
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.show();

        this.log('🔍 APM Package Validation\n');

        const result = await this.validateManifest(manifestPath);

        if (result.manifest) {
            this.log(`📦 ${result.manifest.name} v${result.manifest.version}`);
            this.log(`   ${result.manifest.description}`);
            this.log('');
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            this.log('✅ APM Manifest is valid', 'success');
            vscode.window.showInformationMessage('APM package validated successfully!');
        } else {
            if (result.errors.length > 0) {
                result.errors.forEach(err => this.log(`❌ Error: ${err}`, 'error'));
            }
            if (result.warnings.length > 0) {
                result.warnings.forEach(warn => this.log(`⚠️  Warning: ${warn}`, 'warning'));
            }
            
            if (result.errors.length > 0) {
                vscode.window.showErrorMessage(`Validation failed with ${result.errors.length} error(s)`);
            } else {
                vscode.window.showWarningMessage(`Validation passed with ${result.warnings.length} warning(s)`);
            }
        }
        
        // Also check .apm directory
        const apmDir = path.join(workspaceRoot, '.apm');
        if (fs.existsSync(apmDir)) {
             // Basic directory check (could be expanded)
             this.log('\nChecking .apm directory structure...');
             const files = this.scanPrompts(apmDir);
             if (files.length > 0) {
                 this.log(`Found ${files.length} prompt file(s) in .apm directory`);
             } else {
                 this.log('⚠️  .apm directory exists but contains no prompt files', 'warning');
             }
        } else {
            this.log('\n⚠️  .apm directory not found (no prompts)', 'warning');
        }
    }

    private async validateManifest(filePath: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let manifest: any = null;

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            manifest = yaml.load(content);

            if (!manifest || typeof manifest !== 'object') {
                errors.push('Empty or invalid YAML file');
                return { errors, warnings, manifest: null };
            }

            // Use SchemaValidator
            const validationResult = await this.schemaValidator.validateApm(manifest);
            
            errors.push(...validationResult.errors);
            warnings.push(...validationResult.warnings);

            return { errors, warnings, manifest };

        } catch (error) {
            if (error instanceof yaml.YAMLException) {
                errors.push(`Failed to parse YAML: ${error.message}`);
            } else {
                errors.push(`Failed to validate: ${(error as Error).message}`);
            }
            return { errors, warnings, manifest: null };
        }
    }
    
    private scanPrompts(dir: string, fileList: string[] = []): string[] {
        const PROMPT_EXTENSIONS = ['.prompt.md', '.instructions.md', '.chatmode.md', '.agent.md'];
        
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory() && !file.startsWith('.')) {
                    this.scanPrompts(filePath, fileList);
                } else {
                    if (PROMPT_EXTENSIONS.some(ext => file.endsWith(ext))) {
                        fileList.push(filePath);
                    }
                }
            });
        } catch (e) {
            // ignore
        }
        return fileList;
    }

    private log(message: string, type?: 'error' | 'warning' | 'success'): void {
        let prefix = '';
        switch (type) {
            case 'error': prefix = '❌ '; break;
            case 'warning': prefix = '⚠️  '; break;
            case 'success': prefix = '✅ '; break;
        }
        this.outputChannel.appendLine(prefix + message);
    }
    
    dispose(): void {
        this.outputChannel.dispose();
    }
}
