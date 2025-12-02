import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface TemplateContext {
    projectName: string;
    collectionId: string;
    [key: string]: any;
}

export interface TemplateInfo {
    path: string;
    description: string;
    required: boolean;
    variables: string[];
}

export interface TemplateManifest {
    version: string;
    description: string;
    templates: {
        [key: string]: TemplateInfo;
    };
}

/**
 * Service for loading and rendering scaffold templates
 */
export class TemplateEngine {
    private readonly logger = Logger.getInstance();
    private manifestCache?: TemplateManifest;

    constructor(private readonly templateRoot: string) {}

    /**
     * Load template manifest
     */
    async loadManifest(): Promise<TemplateManifest> {
        if (this.manifestCache) {
            return this.manifestCache;
        }

        const manifestPath = path.join(this.templateRoot, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Template manifest not found at: ${manifestPath}`);
        }

        const content = fs.readFileSync(manifestPath, 'utf8');
        this.manifestCache = JSON.parse(content);
        
        this.logger.debug(`Loaded template manifest v${this.manifestCache!.version}`);
        return this.manifestCache!;
    }

    /**
     * Render a template with variable substitution
     */
    async renderTemplate(name: string, context: TemplateContext): Promise<string> {
        const manifest = await this.loadManifest();
        const template = manifest.templates[name];
        
        if (!template) {
            throw new Error(`Template '${name}' not found`);
        }

        const templatePath = path.join(this.templateRoot, template.path);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template file not found: ${templatePath}`);
        }

        let content = fs.readFileSync(templatePath, 'utf8');
        
        // Enhance context with computed values
        const enhancedContext = this.enhanceContext(context);
        
        // Substitute variables
        for (const [key, value] of Object.entries(enhancedContext)) {
            const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(placeholder, value);
        }

        return content;
    }

    /**
     * Copy a template to target location with variable substitution
     */
    async copyTemplate(name: string, targetPath: string, context: TemplateContext): Promise<void> {
        const content = await this.renderTemplate(name, context);
        
        // Ensure target directory exists
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.writeFileSync(targetPath, content, 'utf8');
        this.logger.debug(`Copied template '${name}' to: ${targetPath}`);
    }

    /**
     * Scaffold a complete project
     */
    async scaffoldProject(targetPath: string, context: TemplateContext): Promise<void> {
        this.logger.info(`Scaffolding project at: ${targetPath}`);
        
        // Create directory structure
        const directories = [
            'prompts',
            'instructions',
            'agents',
            'collections',
            '.github/workflows',
            'scripts'
        ];

        for (const dir of directories) {
            const dirPath = path.join(targetPath, dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                this.logger.debug(`Created directory: ${dirPath}`);
            }
        }

        // Copy all templates
        const manifest = await this.loadManifest();
        for (const [name, template] of Object.entries(manifest.templates)) {
            if (!template.required) {
                continue;
            }

            const targetFile = this.getTargetPath(targetPath, name, template.path);
            await this.copyTemplate(name, targetFile, context);
        }

        this.logger.info('Scaffold completed successfully');
    }

    /**
     * Get templates metadata
     */
    async getTemplates(): Promise<{ [key: string]: TemplateInfo }> {
        const manifest = await this.loadManifest();
        return manifest.templates;
    }

    /**
     * Get target path for a template, handling special cases
     */
    private getTargetPath(basePath: string, name: string, templatePath: string): string {
        // Handle README.template.md -> README.md
        if (templatePath === 'README.template.md') {
            return path.join(basePath, 'README.md');
        }
        
        // Handle package.template.json -> package.json
        if (templatePath === 'package.template.json') {
            return path.join(basePath, 'package.json');
        }
        
        // Handle workflows -> .github/workflows
        if (templatePath.startsWith('workflows/')) {
            const filename = path.basename(templatePath);
            return path.join(basePath, '.github', 'workflows', filename);
        }
        
        // Handle validation script -> scripts/
        if (name === 'validation-script') {
            const filename = path.basename(templatePath);
            return path.join(basePath, 'scripts', filename);
        }
        
        // Default: use template path as-is
        return path.join(basePath, templatePath);
    }

    /**
     * Enhance context with computed values
     */
    private enhanceContext(context: TemplateContext): Record<string, any> {
        const enhanced: Record<string, string> = { ...context };
        
        // Compute packageName from projectName (kebab-case)
        if (context.projectName) {
            enhanced.packageName = context.projectName.toLowerCase().replace(/\s+/g, '-');
        }
        
        return enhanced;
    }
}
