# {{PROJECT_NAME}}

Welcome to your awesome-copilot prompt collection! This repository contains prompts, instructions, chat modes, and collections to enhance your GitHub Copilot experience.

## 📖 Repository Structure

```
├── prompts/              # Task-specific prompts (.prompt.md)
├── instructions/         # Coding standards and best practices (.instructions.md)
├── chatmodes/           # AI personas and specialized modes (.chatmode.md)
├── collections/         # Curated collections (.collection.yml)
├── schemas/             # JSON schemas for validation
├── .vscode/             # VS Code settings and extensions
└── package.json         # Node.js dependencies
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Validate Your Collections

```bash
npm run validate
```

Checks:
- ✅ Required fields (id, name, description)
- ✅ ID format (lowercase, hyphens only)
- ✅ File references exist
- ✅ Valid YAML syntax

### 3. Use with VS Code

The scaffold includes VS Code configuration:

**Recommended Extensions** (auto-prompted on first open):
- `redhat.vscode-yaml` - YAML language support with schema validation

**Auto-configured Features**:
- YAML schema validation for `.collection.yml` files
- IntelliSense for collection properties
- Real-time validation errors

### 4. Ensure that the GitHub runner label is conrrectly configured

- open `.github/workflows/validate-collections.yml`
- look for `runs-on:`
- ensure you are using the runner label as per reccomendations of your organisation


### 5. Publish to GitHub

```bash
# Initialize git (if needed)
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 5. Use with Prompt Registry Extension

**Option A: Add as Source**
1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Run: "Prompt Registry: Add Source"
3. Select "Awesome Copilot Collection"
4. Enter your repo URL: `https://github.com/YOUR_USERNAME/YOUR_REPO`

**Option B: Pre-configured Default**
The Prompt Registry extension automatically includes the official [github/awesome-copilot](https://github.com/github/awesome-copilot) source. Once published, your collection will be available similarly.

## 📝 Creating Content

### Prompts (`prompts/*.prompt.md`)

Task-specific instructions for Copilot.

```markdown
# Generate Unit Tests

Create comprehensive unit tests for the current file.

## Instructions

1. Analyze the code structure
2. Generate test cases for all public methods
3. Include edge cases and error scenarios
4. Use the project's testing framework

## Tags

#testing #quality #automation
```

### Instructions (`instructions/*.instructions.md`)

Coding standards that apply automatically.

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

### Chat Modes (`chatmodes/*.chatmode.md`)

AI personas for specialized assistance.

```markdown
# Code Reviewer

You are a senior code reviewer focused on quality and best practices.

## Expertise

- Code quality and maintainability
- Security vulnerabilities
- Performance optimization

## Guidelines

- Provide constructive feedback
- Suggest specific improvements
- Explain the reasoning
```

### Collections (`collections/*.collection.yml`)

Group related items together.

```yaml
id: typescript-development
name: TypeScript Development
description: Essential prompts and instructions for TypeScript projects
tags:
  - typescript
  - development
items:
  - path: prompts/generate-tests.prompt.md
    kind: prompt
  - path: instructions/typescript-style.instructions.md
    kind: instruction
```

**Validation Rules**:
- `id`: lowercase, hyphens/numbers only
- `name`: 1-100 characters
- `description`: 1-500 characters
- `items`: 1-50 items, paths must exist
- `kind`: `prompt`, `instruction`, `chat-mode`, or `agent`

## 🧪 Testing Workflow

### Local Validation

```bash
# Run validation script
npm run validate

# Or with Node directly
node validate-collections.js
```

### CI/CD (GitHub Actions)

The included workflow (`.github/workflows/validate-collections.yml`) runs automatically:

- ✅ On every push to `main`/`develop`
- ✅ On pull requests
- ✅ Reports validation errors
- ✅ Blocks merge if validation fails

### Manual Testing

1. **In Copilot Chat**: Use `/` to access prompts
2. **With Prompt Registry**: Browse and install collections
3. **Validate Files**: Check YAML syntax and file references

## 📋 Quality Checklist

Before committing:

- [ ] `npm install` completed successfully
- [ ] `npm run validate` passes with no errors
- [ ] File naming follows conventions
- [ ] All collection paths exist
- [ ] YAML syntax is valid
- [ ] VS Code shows no schema errors

## 📚 Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Awesome Copilot Repository](https://github.com/github/awesome-copilot)
- [Collection Template](https://github.com/github/awesome-copilot/blob/main/collections/TEMPLATE.md)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)

## 🛠️ Extension Commands

Available when using Prompt Registry extension:

- `Prompt Registry: Validate Collections` - Validate all collections
- `Prompt Registry: Create New Collection` - Interactive collection wizard
- `Prompt Registry: List All Collections` - View collection metadata
- `Prompt Registry: Add Resource` - Add prompt/instruction/chatmode

## 📄 License

Apache License 2.0 - see [LICENSE](LICENSE)

## 🙏 Acknowledgments

Based on [github/awesome-copilot](https://github.com/github/awesome-copilot) structure and best practices.

---

**Next Steps**: Review examples → Run `npm install` → Run `npm run validate` → Create your first collection! 🚀
