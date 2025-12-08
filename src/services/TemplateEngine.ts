import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { replaceVariables } from '../utils/regexUtils';

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
        
        // Substitute variables using safe regex utility
        content = replaceVariables(content, enhancedContext);

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
        let relativePath = templatePath;

        // Handle README.template.md -> README.md
        if (templatePath === 'README.template.md') {
            relativePath = 'README.md';
        }
        // Handle package.template.json -> package.json
        else if (templatePath === 'package.template.json') {
            relativePath = 'package.json';
        }
        // Generic template extension stripping
        else if (templatePath.endsWith('.template')) {
            relativePath = templatePath.slice(0, -9);
        }
        else if (templatePath.includes('.template.')) {
            relativePath = templatePath.replace('.template.', '.');
        }
        
        // Handle workflows -> .github/workflows
        if (relativePath.startsWith('workflows/')) {
            const filename = path.basename(relativePath);
            return path.join(basePath, '.github', 'workflows', filename);
        }
        
        // Handle validation script -> scripts/ (Legacy support for Awesome Copilot)
        if (name === 'validation-script' && relativePath.includes('validate-collections.js')) {
            const filename = path.basename(relativePath);
            return path.join(basePath, 'scripts', filename);
        }
        
        // Default: use template path as-is (resolved relative path)
        return path.join(basePath, relativePath);
    }

    /**
     * Enhance context with computed values
     */
    private enhanceContext(context: TemplateContext): Record<string, any> {
        const enhanced: Record<string, string> = { ...context };
        
        // Compute packageName from projectName (kebab-case)
        if (context.projectName) {
            enhanced.packageName = context.projectName.toLowerCase().replace(/\s+/g, '-');
            // Also map to 'name' if not present
            if (!enhanced.name) {
                enhanced.name = enhanced.packageName;
            }
        }

        // Ensure defaults for required fields
        if (!enhanced.description) {
            enhanced.description = 'A new APM package';
        }
        if (!enhanced.author) {
            enhanced.author = process.env.USER || 'user';
        }
        
        // Format tags
        if (enhanced.tags) {
            if (Array.isArray(enhanced.tags)) {
                enhanced.tags = enhanced.tags.map((t: string) => `"${t}"`).join(', ');
            }
        } else {
            enhanced.tags = '"apm", "prompt-registry"';
        }
        
        return enhanced;
    }
}
