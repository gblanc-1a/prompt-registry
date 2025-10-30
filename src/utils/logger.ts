import * as vscode from 'vscode';

/**
 * Logger utility for Prompt Registry extension
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: any;
    private isTestEnvironment: boolean;

    private constructor() {
        // Detect test environment
        this.isTestEnvironment = process.env.NODE_ENV === 'test' || 
                                 process.argv.some(arg => arg.includes('mocha')) ||
                                 process.argv.some(arg => arg.includes('test'));

        if (this.isTestEnvironment) {
            // Use console logging in test environment to avoid channel disposal errors
            this.outputChannel = {
                appendLine: (message: string) => console.log(`[Prompt Registry] ${message}`),
                show: () => {},
                hide: () => {},
                dispose: () => {}
            };
        } else {
            // Use VS Code output channel in normal environment
            this.outputChannel = vscode.window.createOutputChannel('Prompt Registry');
        }
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public static resetInstance(): void {
        Logger.instance = undefined as any;
    }

    public info(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] INFO: ${message}`;
        this.outputChannel.appendLine(logMessage);
        
        if (args.length > 0) {
            this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
        }
    }

    public warn(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] WARN: ${message}`;
        this.outputChannel.appendLine(logMessage);
        
        if (args.length > 0) {
            this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
        }
    }

    public error(message: string, error?: Error, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ERROR: ${message}`;
        this.outputChannel.appendLine(logMessage);
        
        if (error) {
            this.outputChannel.appendLine(`  Error: ${error.message}`);
            this.outputChannel.appendLine(`  Stack: ${error.stack}`);
        }
        
        if (args.length > 0) {
            this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
        }
    }

    public debug(message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] DEBUG: ${message}`;
        this.outputChannel.appendLine(logMessage);
        
        if (args.length > 0) {
            this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
        }
    }

    public clear(): void {
        // In test environment, this is a no-op since we use console
        // In VS Code environment, we can't clear the output channel, but we can note it
        if (!this.isTestEnvironment) {
            this.outputChannel.appendLine('--- Log cleared ---');
        }
    }

    public show(): void {
        if (!this.isTestEnvironment) {
            this.outputChannel.show();
        }
    }

    public hide(): void {
        if (!this.isTestEnvironment) {
            this.outputChannel.hide();
        }
    }

    public dispose(): void {
        if (!this.isTestEnvironment) {
            this.outputChannel.dispose();
        }
    }
}
