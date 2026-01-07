/**
 * NpmCliWrapper
 * 
 * Wrapper for npm CLI commands with security-focused input validation.
 * Provides a safe interface for executing npm operations.
 * 
 * Follows the same pattern as ApmCliWrapper for consistency.
 */

import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * Result of an npm install operation
 */
export interface NpmInstallResult {
    /** Whether the installation succeeded */
    success: boolean;
    /** Error message if installation failed */
    error?: string;
    /** Output from npm command */
    output?: string;
}

/**
 * Command execution timeout in milliseconds (5 minutes)
 */
const COMMAND_TIMEOUT = 5 * 60 * 1000;

/**
 * Determine if shell mode is needed for npm commands.
 * On Windows, npm is a .cmd/.ps1 file that requires shell: true.
 */
const USE_SHELL = process.platform === 'win32';

/**
 * NpmCliWrapper - Safe wrapper for npm CLI commands
 */
export class NpmCliWrapper {
    private static instance: NpmCliWrapper;
    private logger: Logger;
    
    private constructor() {
        this.logger = Logger.getInstance();
    }
    
    static getInstance(): NpmCliWrapper {
        if (!NpmCliWrapper.instance) {
            NpmCliWrapper.instance = new NpmCliWrapper();
        }
        return NpmCliWrapper.instance;
    }
    
    /**
     * Check if npm is available in the system
     */
    async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const npmProcess = spawn('npm', ['--version'], { shell: USE_SHELL });
            
            npmProcess.on('close', (code) => {
                resolve(code === 0);
            });
            
            npmProcess.on('error', () => {
                resolve(false);
            });
        });
    }
    
    /**
     * Get npm version
     */
    async getVersion(): Promise<string | undefined> {
        return new Promise((resolve) => {
            const npmProcess = spawn('npm', ['--version'], { shell: USE_SHELL });
            let output = '';
            
            npmProcess.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            npmProcess.on('close', (code) => {
                resolve(code === 0 ? output.trim() : undefined);
            });
            
            npmProcess.on('error', () => {
                resolve(undefined);
            });
        });
    }
    
    /**
     * Validate working directory
     */
    private validateCwd(cwd: string): void {
        if (!cwd || cwd.trim() === '') {
            throw new Error('Working directory cannot be empty');
        }
        
        const fs = require('fs');
        if (!fs.existsSync(cwd)) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }
        
        const stats = fs.statSync(cwd);
        if (!stats.isDirectory()) {
            throw new Error(`Path is not a directory: ${cwd}`);
        }
    }

    /**
     * Install dependencies with progress notification
     */
    async installWithProgress(cwd: string): Promise<NpmInstallResult> {
        try {
            this.validateCwd(cwd);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Invalid working directory';
            this.logger.error(`NpmCliWrapper.installWithProgress validation failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }

        this.logger.debug(`Starting npm install in: ${cwd}`);
        
        const available = await this.isAvailable();
        if (!available) {
            const error = 'npm not found. Please install Node.js and npm first.';
            this.logger.error('npm not available on system');
            return { success: false, error };
        }
        
        return new Promise((resolve) => {
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing dependencies...',
                    cancellable: true
                },
                async (progress, token) => {
                    const npmProcess = spawn('npm', ['install'], {
                        cwd,
                        shell: USE_SHELL,
                        timeout: COMMAND_TIMEOUT
                    });
                    
                    token.onCancellationRequested(() => {
                        npmProcess.kill();
                        resolve({ success: false, error: 'Installation cancelled' });
                    });
                    
                    let errorOutput = '';
                    let output = '';
                    
                    npmProcess.stdout.on('data', (data) => {
                        output += data.toString();
                    });
                    
                    npmProcess.stderr.on('data', (data) => {
                        errorOutput += data.toString();
                    });
                    
                    npmProcess.on('close', (code) => {
                        if (code === 0) {
                            this.logger.info(`npm install completed successfully in: ${cwd}`);
                            vscode.window.showInformationMessage('Dependencies installed successfully!');
                            resolve({ success: true, output });
                        } else {
                            const errorMessage = `npm install failed with code ${code}`;
                            const detailedError = errorOutput ? `${errorMessage}. Error: ${errorOutput}` : errorMessage;
                            this.logger.error(`npm install failed: ${detailedError}`);
                            vscode.window.showErrorMessage(detailedError);
                            resolve({ success: false, error: detailedError });
                        }
                    });
                    
                    npmProcess.on('error', (err) => {
                        let errorMessage = 'Failed to run npm install';
                        if (err.message.includes('ENOENT')) {
                            errorMessage = 'npm not found. Please install Node.js and npm first.';
                        } else if (err.message.includes('EACCES') || err.message.includes('permission')) {
                            errorMessage = 'Permission denied. Please check directory permissions.';
                        } else if (err.message.includes('network') || err.message.includes('ENOTFOUND')) {
                            errorMessage = 'Network error. Please check your internet connection.';
                        } else {
                            errorMessage = `Failed to run npm install: ${err.message}`;
                        }
                        
                        this.logger.error(`npm install process error: ${errorMessage}`);
                        vscode.window.showErrorMessage(errorMessage);
                        resolve({ success: false, error: errorMessage });
                    });
                }
            );
        });
    }
    
    /**
     * Install dependencies in terminal (visible to user)
     */
    async installInTerminal(cwd: string): Promise<NpmInstallResult> {
        try {
            this.validateCwd(cwd);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Invalid working directory';
            this.logger.error(`NpmCliWrapper.installInTerminal validation failed: ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
            return { success: false, error: errorMessage };
        }

        this.logger.debug(`Starting npm install in terminal: ${cwd}`);
        
        const available = await this.isAvailable();
        if (!available) {
            const error = 'npm not found. Please install Node.js and npm first.';
            this.logger.error('npm not available on system');
            vscode.window.showErrorMessage(error);
            return { success: false, error };
        }
        
        try {
            const terminal = vscode.window.createTerminal({
                name: 'npm install',
                cwd
            });
            
            terminal.show();
            terminal.sendText('npm install');
            
            this.logger.info(`npm install started in terminal for: ${cwd}`);
            vscode.window.showInformationMessage(
                'npm install started in terminal. Check the terminal output for progress.'
            );
            
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.logger.error(`Failed to create terminal for npm install: ${errorMessage}`);
            vscode.window.showErrorMessage(`Failed to run npm install: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
    
    /**
     * Prompt user and install dependencies
     */
    async promptAndInstall(cwd: string, useProgress: boolean = true): Promise<NpmInstallResult> {
        const choice = await vscode.window.showInformationMessage(
            'Scaffolding complete! Would you like to install dependencies now?',
            'Yes, run npm install',
            'No, I\'ll do it later'
        );
        
        if (choice !== 'Yes, run npm install') {
            vscode.window.showInformationMessage(
                'To install dependencies later, run: npm install',
                'OK'
            );
            return { success: true };
        }
        
        return useProgress 
            ? await this.installWithProgress(cwd)
            : await this.installInTerminal(cwd);
    }
}