import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { TemplateEngine, TemplateContext } from '../services/TemplateEngine';
import { NpmCliWrapper } from '../utils/NpmCliWrapper';
import { FileUtils } from '../utils/fileUtils';
import { toKebabCase } from '../utils/bundleNameUtils';

export enum ScaffoldType {
    GitHub = 'github',
    Apm = 'apm',
}

/**
 * Migration recommendation interface for deprecated scaffolding types
 * Per Requirement 10.5: Show migration recommendations when deprecated scaffolding is detected
 */
export interface MigrationRecommendation {
    message: string;
    steps: string[];
    documentationUrl: string;
}

/**
 * Deprecation warning for awesome-copilot scaffold type
 * Per design document: Migration Recommendations Display section
 */
export const AWESOME_COPILOT_DEPRECATION: MigrationRecommendation = {
    message: 'The awesome-copilot scaffold type has been replaced by github scaffold.',
    steps: [
        'Create a new project using github scaffold type',
        'Copy your existing prompts, instructions, and agents to the new project',
        'Rename any .chatmode.md files to .agent.md',
        'Update collection YAML files to use kind: agent instead of kind: chatmode',
        'Configure GitHub releases CI by pushing to main branch'
    ],
    documentationUrl: 'https://github.com/prompt-registry/docs/migration-guide'
};

export interface ScaffoldOptions {
    projectName?: string;
    skipExamples?: boolean;
    type?: ScaffoldType;
    githubRunner?: string;
    description?: string;
    author?: string;
    tags?: string[];
}

/**
 * Indicators of an awesome-copilot project structure
 * Used to detect existing projects that should be migrated
 */
const AWESOME_COPILOT_INDICATORS = {
    // Patterns in collection files that indicate old structure
    collectionPatterns: [
        /kind:\s*chatmode/i,   // Chatmode kind in collection YAML
    ],
};

/**
 * Command to scaffold project structures with different types
 */
export class ScaffoldCommand {
    private readonly logger: Logger;
    private readonly templateEngine: TemplateEngine;
    private readonly scaffoldType: ScaffoldType;
    private readonly npmWrapper: NpmCliWrapper;

    constructor(templateRoot?: string, scaffoldType: ScaffoldType = ScaffoldType.GitHub) {
        this.logger = Logger.getInstance();
        this.scaffoldType = scaffoldType;
        this.npmWrapper = NpmCliWrapper.getInstance();
        
        // Initialize template engine with scaffold templates
        // Use provided path or default to project's template directory with type
        const templatesPath = templateRoot || path.join(__dirname, '../templates/scaffolds', scaffoldType);
        this.templateEngine = TemplateEngine.getInstance(templatesPath);
    }

    /**
     * Execute the scaffold command
     * 
     * @param targetPath - Target directory path or URI
     * @param options - Scaffold options
     */
    async execute(targetPath: string | vscode.Uri, options?: ScaffoldOptions): Promise<void> {
        try {
            const targetUri = typeof targetPath === 'string' ? vscode.Uri.file(targetPath) : targetPath;
            this.logger.info(`Scaffolding ${this.scaffoldType} structure at: ${targetUri.fsPath}`);
            
            // Resolve project name from path if not provided
            const projectDirName = path.basename(targetUri.fsPath);

            // Prepare template context
            const context: TemplateContext = {
                projectName: options?.projectName || projectDirName || 'github-prompts',
                collectionId: toKebabCase(options?.projectName || projectDirName),
                githubRunner: options?.githubRunner || 'ubuntu-latest',
                description: options?.description,
                author: options?.author,
                tags: options?.tags,
            };

            // Use template engine to scaffold the entire project
            await this.templateEngine.scaffoldProject(targetUri, context);

            this.logger.info('Scaffold completed successfully');
            
            // Note: npm install prompt is handled by the caller (extension.ts)
            // to ensure it runs AFTER the progress indicator closes

        } catch (error) {
            this.logger.error('Scaffold failed', error as Error);
            throw error;
        }
    }

    /**
     * Detect if a directory contains an existing awesome-copilot project structure
     * Per Requirement 10.5: Detect existing awesome-copilot project structure
     * 
     * @param targetPath - Directory path to check
     * @returns true if awesome-copilot structure is detected
     */
    static async detectAwesomeCopilotStructure(targetPath: string): Promise<boolean> {
        try {
            // Check for chatmodes directory
            const chatmodesDir = path.join(targetPath, 'chatmodes');
            if (await FileUtils.exists(chatmodesDir) && await FileUtils.isDirectory(chatmodesDir)) {
                return true;
            }

            // Check for .chatmode.md files in any directory
            const checkForChatmodeFiles = async (dir: string, depth: number = 0): Promise<boolean> => {
                if (depth > 3) {
                    return false; // Limit recursion depth
                }
                
                try {
                    const entries = await FileUtils.listDirectory(dir);
                    for (const entry of entries) {
                        if (entry.startsWith('.') && entry !== '.github') {
                            continue;
                        }
                        if (entry === 'node_modules') {
                            continue;
                        }
                        
                        const entryPath = path.join(dir, entry);
                        if (await FileUtils.isFile(entryPath) && entry.endsWith('.chatmode.md')) {
                            return true;
                        }
                        if (await FileUtils.isDirectory(entryPath)) {
                            if (await checkForChatmodeFiles(entryPath, depth + 1)) {
                                return true;
                            }
                        }
                    }
                } catch {
                    // Ignore permission errors
                }
                return false;
            };

            if (await checkForChatmodeFiles(targetPath)) {
                return true;
            }

            // Check for chatmode references in collection files
            const collectionsDir = path.join(targetPath, 'collections');
            if (await FileUtils.exists(collectionsDir) && await FileUtils.isDirectory(collectionsDir)) {
                const entries = await FileUtils.listDirectory(collectionsDir);
                const collectionFiles = entries.filter(f => f.endsWith('.collection.yml') || f.endsWith('.collection.yaml'));
                
                for (const file of collectionFiles) {
                    try {
                        const content = await FileUtils.readFile(path.join(collectionsDir, file));
                        for (const pattern of AWESOME_COPILOT_INDICATORS.collectionPatterns) {
                            if (pattern.test(content)) {
                                return true;
                            }
                        }
                    } catch {
                        // Ignore read errors
                    }
                }
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Show migration recommendation warning message
     * Per Requirement 10.5: Show warning message with migration steps
     * 
     * @param recommendation - Migration recommendation to display
     * @returns Promise that resolves when user dismisses the message
     */
    static async showMigrationRecommendation(recommendation: MigrationRecommendation = AWESOME_COPILOT_DEPRECATION): Promise<void> {
        const action = await vscode.window.showWarningMessage(
            recommendation.message,
            'View Migration Guide',
            'Dismiss'
        );
        
        if (action === 'View Migration Guide') {
            await vscode.env.openExternal(vscode.Uri.parse(recommendation.documentationUrl));
        }
    }

    /**
     * Check for existing awesome-copilot structure and show migration recommendation if found
     * Per Requirement 10.5: Detect and show migration recommendations
     * 
     * @param targetPath - Directory path to check
     * @returns true if migration recommendation was shown
     */
    static async checkAndShowMigrationRecommendation(targetPath: string): Promise<boolean> {
        if (await ScaffoldCommand.detectAwesomeCopilotStructure(targetPath)) {
            await ScaffoldCommand.showMigrationRecommendation();
            return true;
        }
        return false;
    }

    /**
     * Run the scaffold command with full UI flow
     * Handles type selection, target directory, options collection, and npm install
     */
    static async runWithUI(): Promise<void> {
        const logger = Logger.getInstance();

        // Prompt for scaffold type
        const scaffoldTypeChoice = await ScaffoldCommand.promptForScaffoldType();
        if (!scaffoldTypeChoice) {
            return;
        }

        // Prompt for target directory
        const targetPath = await ScaffoldCommand.promptForTargetDirectory(scaffoldTypeChoice.label);
        if (!targetPath) {
            return;
        }

        // Collect project details
        const projectDetails = await ScaffoldCommand.promptForProjectDetails(scaffoldTypeChoice.value);
        if (!projectDetails) {
            return;
        }

        // Execute scaffolding
        try {
            await ScaffoldCommand.executeScaffold(scaffoldTypeChoice, targetPath, projectDetails);
            await ScaffoldCommand.handlePostScaffoldActions(scaffoldTypeChoice.label, targetPath);
        } catch (error) {
            logger.error('Scaffold failed', error as Error);
            vscode.window.showErrorMessage(`Scaffold failed: ${(error as Error).message}`);
        }
    }

    /**
     * Prompt user to select scaffold type
     */
    private static async promptForScaffoldType(): Promise<{ label: string; value: ScaffoldType } | undefined> {
        return vscode.window.showQuickPick(
            [
                {
                    label: 'GitHub',
                    description: 'GitHub-based prompt library with CI/CD workflows',
                    value: ScaffoldType.GitHub
                },
                {
                    label: 'APM Package',
                    description: 'Distributable prompt package (apm.yml)',
                    value: ScaffoldType.Apm
                }
            ],
            {
                placeHolder: 'Select project type',
                title: 'Scaffold Project',
                ignoreFocusOut: true
            }
        );
    }

    /**
     * Prompt user to select target directory
     */
    private static async promptForTargetDirectory(typeLabel: string): Promise<vscode.Uri | undefined> {
        // Default to first workspace folder if available
        const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        
        const targetPath = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            title: `Select Target Directory for ${typeLabel}`
        });
        return targetPath?.[0];
    }

    /**
     * Collect project details from user input
     */
    private static async promptForProjectDetails(type: ScaffoldType): Promise<ScaffoldOptions | undefined> {
        // Get project name
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name (optional)',
            placeHolder: 'example',
            value: 'example',
            ignoreFocusOut: true
        });

        // Get GitHub runner choice
        const githubRunner = await ScaffoldCommand.promptForGitHubRunner();

        // Collect APM-specific details if needed
        let apmDetails: { description?: string; author?: string; tags?: string[] } = {};
        if (type === ScaffoldType.Apm) {
            const details = await ScaffoldCommand.promptForApmDetails();
            if (details) {
                apmDetails = details;
            }
        }

        return {
            projectName,
            githubRunner,
            ...apmDetails
        };
    }

    /**
     * Prompt for GitHub Actions runner configuration
     */
    private static async promptForGitHubRunner(): Promise<string> {
        const runnerChoice = await vscode.window.showQuickPick(
            [
                {
                    label: 'GitHub-hosted (ubuntu-latest)',
                    description: 'Free GitHub-hosted runner',
                    value: 'ubuntu-latest'
                },
                {
                    label: 'Self-hosted',
                    description: 'Use self-hosted runner',
                    value: 'self-hosted'
                },
                {
                    label: 'Custom',
                    description: 'Specify custom runner label',
                    value: 'custom'
                }
            ],
            {
                placeHolder: 'Select GitHub Actions runner type',
                title: 'GitHub Actions Runner',
                ignoreFocusOut: true
            }
        );

        if (runnerChoice?.value === 'self-hosted') {
            return 'self-hosted';
        }
        
        if (runnerChoice?.value === 'custom') {
            const customRunner = await vscode.window.showInputBox({
                prompt: 'Enter custom runner label',
                placeHolder: 'my-runner or [self-hosted, linux, x64]',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Runner label cannot be empty';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });
            return customRunner || 'ubuntu-latest';
        }

        return 'ubuntu-latest';
    }

    /**
     * Prompt for APM-specific project details
     */
    private static async promptForApmDetails(): Promise<{ description?: string; author?: string; tags?: string[] }> {
        const description = await vscode.window.showInputBox({
            prompt: 'Enter package description',
            placeHolder: 'A short description of your package',
            ignoreFocusOut: true
        });

        const author = await vscode.window.showInputBox({
            prompt: 'Enter author name',
            placeHolder: 'Your Name <email@example.com>',
            value: process.env.USER || 'user',
            ignoreFocusOut: true
        });

        const tagsInput = await vscode.window.showInputBox({
            prompt: 'Enter tags (comma separated)',
            placeHolder: 'ai, prompts, coding',
            value: 'apm, prompts',
            ignoreFocusOut: true
        });

        const tags = tagsInput
            ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
            : undefined;

        return { description, author, tags };
    }

    /**
     * Execute the scaffold operation with progress indicator
     */
    private static async executeScaffold(
        scaffoldTypeChoice: { label: string; value: ScaffoldType },
        targetPath: vscode.Uri,
        options: ScaffoldOptions
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Scaffolding ${scaffoldTypeChoice.label}...`,
                cancellable: false
            },
            async () => {
                const cmd = new ScaffoldCommand(undefined, scaffoldTypeChoice.value);
                await cmd.execute(targetPath, options);
            }
        );
    }

    /**
     * Handle post-scaffold actions: npm install and folder opening
     */
    private static async handlePostScaffoldActions(typeLabel: string, targetPath: vscode.Uri): Promise<void> {
        // Prompt for npm install
        const npmWrapper = NpmCliWrapper.getInstance();
        const npmResult = await npmWrapper.promptAndInstall(targetPath.fsPath, false);

        // Offer to open folder
        const openChoice = await vscode.window.showInformationMessage(
            `${typeLabel} scaffolded successfully!`,
            'Open Folder'
        );

        if (openChoice === 'Open Folder') {
            await vscode.commands.executeCommand('vscode.openFolder', targetPath);
        }

        // Show npm install warning if there was an issue
        if (!npmResult.success && npmResult.error) {
            vscode.window.showWarningMessage(
                `Note: npm install ${npmResult.error.includes('cancelled') ? 'was cancelled' : 'failed'}. You can run 'npm install' manually in the project directory.`
            );
        }
    }
}
