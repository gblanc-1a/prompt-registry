# System Context (Level 1)

The System Context diagram shows the prompt-registry packages as a black box and their relationships with users and external systems.

## Diagram

```mermaid
flowchart TB
    dev[Developer<br/>Uses CLI]
    author[Collection Author<br/>Creates collections]
    ext_dev[Extension Developer<br/>Uses SDK]

    subgraph Packages["Prompt Registry Packages"]
        core[@prompt-registry/core<br/>Domain types]
        infra[@prompt-registry/infra<br/>Infrastructure]
        app[@prompt-registry/app<br/>Application layer]
        cli[@prompt-registry/cli<br/>CLI interface]
        sdk[@prompt-registry/sdk<br/>SDK for integrations]
    end

    github[GitHub<br/>API for releases, contents]
    npm[npm Registry<br/>Package distribution]
    FS[File System<br/>Local collections, configs]

    dev --> cli
    author --> cli
    ext_dev --> sdk

    infra --> github
    cli --> FS
    app --> FS
    infra --> FS

    dev -."validation, building, installing".-> cli
    author -."scaffolding, publishing".-> cli
    ext_dev -."search, installation".-> sdk
    infra -."Fetches from".-> github
    Packages -."Published to".-> npm
    Packages -."Reads/Writes".-> FS
```

## Personas

### Developer
Uses the CLI tools for day-to-day operations:
- Validate collection YAML files
- Scaffold collections and primitives (prompts, instructions, agents, skills, plugins, hooks)
- Build and publish bundles
- Search for primitives in hubs
- Install bundles to their development environment

### Collection Author
Creates and maintains prompt collections:
- Uses CLI to scaffold collections and primitives
- Defines collection metadata in YAML
- Creates primitive content (prompts, skills, agents)
- Publishes collections to GitHub releases
- Manages versioning with semantic versioning

### Extension Developer
Integrates the SDK into VS Code extensions or other tools:
- Uses the SDK APIs for search and installation
- Leverages the domain types for type safety
- Builds custom integrations on top of the packages

## External Systems

### GitHub
Primary integration point for:
- **Releases**: Download published collection bundles
- **Contents**: Fetch hub configuration files
- **Trees**: Enumerate repository contents for harvesting
- **Rate Limiting**: Respects GitHub API limits with backoff

### npm Registry
Distribution channel:
- Packages published as `@prompt-registry/core`, `@prompt-registry/infra`, `@prompt-registry/app`, `@prompt-registry/cli`, `@prompt-registry/sdk`
- Consumed via `npm install` or workspace protocol in monorepo
- CLI installable via `npm install -g @prompt-registry/cli`
- Supports provenance attestation for supply chain security

### File System
Local storage for:
- **Collections**: YAML files defining primitives
- **Configuration**: `prompt-registry.yml` for targets
- **Cache**: Primitive index and blob cache
- **Lockfiles**: `prompt-registry.lock.json` for repo installs

## User Stories

| As a... | I want to... | So that... |
|---------|-------------|------------|
| Developer | Validate my collection YAML | I catch errors before publishing |
| Developer | Scaffold collections and primitives | I can quickly start creating content |
| Collection Author | Build a deterministic bundle | Users get identical content |
| Extension Developer | Search primitives by keyword | I can recommend relevant prompts |
| Developer | Install a bundle to VS Code | I can use the primitives immediately |
| Collection Author | Detect affected collections on commit | I only publish what changed |

## See Also

- [Codemap](./codemap.md) — Package structure and dependencies
- [Container Diagram](./container.md) — Internal architecture
- [Component Diagrams](./component.md) — Detailed component views
