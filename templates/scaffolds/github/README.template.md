# {{projectName}}

Welcome to your GitHub Copilot prompt collection! This repository helps you create and share prompts, instructions, and AI agents to enhance your coding experience.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Validate Your Content
```bash
npm run validate
```

### 3. Configure GitHub Runner
Open `.github/workflows/publish.yml` and ensure `runs-on:` matches your organization's runner requirements.

### 4. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 📖 Project Structure

```
├── prompts/              # Task-specific prompts (.prompt.md)
├── instructions/         # Coding standards (.instructions.md)
├── agents/               # AI assistants (.agent.md)
├── collections/          # Groups of related items (.collection.yml)
├── mcp-server/           # Optional: MCP server configuration
├── .github/workflows/    # Auto-publishing setup
├── .vscode/              # VS Code configuration
└── package.json          # Dependencies and scripts
```

## 📝 Creating Content

### Prompts (`prompts/*.prompt.md`)

Task-specific instructions for Copilot:

```markdown
# Generate Unit Tests

Create comprehensive unit tests for the current file.

## Instructions
1. Analyze the code structure
2. Generate test cases for all public methods
3. Include edge cases

## Tags
#testing #quality
```

### Instructions (`instructions/*.instructions.md`)

Coding standards that apply automatically:

```markdown
# TypeScript Best Practices

## Guidelines
- Use explicit types, avoid `any`
- Prefer `const` over `let`
- Document public APIs with JSDoc

## Applies To
- `**/*.ts`
- `**/*.tsx`
```

### Agents (`agents/*.agent.md`)

AI personas for specialized assistance:

```markdown
# Code Reviewer

You are a senior code reviewer focused on quality and best practices.

## Expertise
- Code quality and maintainability
- Security vulnerabilities
- Performance optimization
```

### Collections (`collections/*.collection.yml`)

Group related items together:

```yaml
id: my-collection
name: My Collection
description: A collection of useful prompts
version: 1.0.0
items:
  - path: prompts/my-prompt.prompt.md
    kind: prompt
  - path: instructions/my-instruction.instructions.md
    kind: instruction
  - path: agents/my-agent.agent.md
    kind: agent
```

**Validation Rules:**
- `id`: lowercase, hyphens/numbers only, max 100 chars
- `name`: 1-100 characters
- `items`: 1-50 items, all paths must exist
- `kind`: `prompt`, `instruction`, or `agent`

## 🔌 MCP Servers (Optional)

Model Context Protocol (MCP) allows your collection to provide custom tools to GitHub Copilot.

Add MCP servers to your collection:

```yaml
# In collections/*.collection.yml
mcp:
  items:
    # Pre-built server
    time:
      command: npx
      args:
        - -y
        - "@modelcontextprotocol/server-time"
    
    # Custom server
    custom:
      command: node
      args:
        - ${bundlePath}/mcp-server/server.js
```

See `mcp-server/README.md` for detailed setup instructions.

## 🧪 Testing & Validation

### Local Validation
```bash
npm run validate           # Basic validation
npm run validate:verbose   # Detailed output
npm run list-collections   # List all collections
```

### CI/CD (GitHub Actions)

The included workflow runs automatically:
- ✅ On every push to `main`
- ✅ On pull requests (dry-run mode)
- ✅ Reports validation errors
- ✅ Creates GitHub releases for changed collections

## 📋 Quality Checklist

Before committing:
- [ ] `npm install` completed successfully
- [ ] `npm run validate` passes
- [ ] All collection paths reference existing files
- [ ] YAML syntax is valid
- [ ] VS Code shows no schema errors

## 🛠️ Using with Prompt Registry Extension

**Add as Source:**
1. Open VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run: "Prompt Registry: Add Source"
3. Select "GitHub Repository"
4. Enter your repo URL

**Available Commands:**
- `Prompt Registry: Validate Collections`
- `Prompt Registry: Create New Collection`
- `Prompt Registry: List All Collections`

## 📚 Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Awesome Copilot Repository](https://github.com/github/awesome-copilot)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## 📄 License

MIT

## 🙏 Acknowledgments

Based on [github/awesome-copilot](https://github.com/github/awesome-copilot) structure and best practices.

---

**Next Steps**: Run `npm install` → Run `npm run validate` → Create your first collection! 🚀
