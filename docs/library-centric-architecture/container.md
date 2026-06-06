# Container Diagram (Level 2)

The Container diagram shows the high-level technology choices and how responsibilities are distributed across packages.

## Diagram

```mermaid
flowchart TB
    dev[Developer<br/>CLI user]
    ext_dev[Extension Developer<br/>SDK user]

    subgraph Core["@prompt-registry/core<br/>Domain Layer"]
        Domain[Domain Types<br/>TypeScript<br/>Pure types]
        Ports[Port Interfaces<br/>TypeScript<br/>Abstractions]
        Schemas[JSON Schemas<br/>Validation schemas]
    end

    subgraph Infra["@prompt-registry/infra<br/>Infrastructure Layer"]
        GitHub[GitHub Client<br/>TypeScript<br/>Rate limiting]
        Harvester[Harvester<br/>TypeScript<br/>Bundle discovery]
        Search[Search Engine<br/>TypeScript<br/>BM25]
        Stores[Storage<br/>TypeScript<br/>Index/Cache]
        Scaffolding[Template Engine<br/>TypeScript<br/>Templates]
        Downloaders[Downloaders<br/>TypeScript<br/>Asset fetching]
        Extractors[Extractors<br/>TypeScript<br/>ZIP extraction]
    end

    subgraph App["@prompt-registry/app<br/>Application Layer"]
        Collection[Collection Logic<br/>TypeScript<br/>Read/write]
        Install[Install Orchestration<br/>TypeScript<br/>Target management]
        Registry[Registry Management<br/>TypeScript<br/>Profile logic]
        Discovery[Discovery<br/>TypeScript<br/>Context detection]
    end

    subgraph CLI["@prompt-registry/cli<br/>CLI Layer"]
        CLIInterface[CLI Commands<br/>TypeScript<br/>Clipanion]
        Framework[CLI Framework<br/>TypeScript<br/>I/O abstraction]
        Validation[Validation<br/>TypeScript<br/>Collection validation]
        Builder[Bundle Builder<br/>TypeScript<br/>ZIP creation]
    end

    subgraph SDK["@prompt-registry/sdk<br/>SDK Layer"]
        SDKAPI[SDK APIs<br/>TypeScript<br/>Placeholder]
    end

    GitHubAPI[(GitHub API<br/>HTTPS)]
    FS[(File System<br/>Node.js fs)]
    IndexDB[(Index Store<br/>JSON)]
    CacheDB[(Blob Cache<br/>Files)]
    ConfigDB[(Config Store<br/>YAML/JSON)]

    dev --> CLIInterface
    ext_dev --> SDKAPI

    CLIInterface --> Framework
    CLIInterface --> Validation
    CLIInterface --> Builder
    CLIInterface --> Install
    CLIInterface --> Collection

    Framework --> FS

    Validation --> Schemas
    Validation --> FS

    Builder --> FS

    Install --> App
    Install --> FS

    Collection --> App
    Collection --> FS

    Registry --> App
    Registry --> FS

    Discovery --> App
    Discovery --> FS

    App --> Infra
    App --> Core

    SDKAPI --> Infra
    SDKAPI --> Core

    Infra --> Core

    GitHub --> GitHubAPI
    GitHub -."HTTPS/JSON".-> GitHubAPI
    GitHub -."ETag caching".-> Stores

    Harvester --> GitHub
    Harvester --> Stores

    Search --> Stores
    Search --> IndexDB

    Stores --> CacheDB
    Stores --> ConfigDB

    Scaffolding --> FS
    Downloaders --> GitHub
    Extractors --> FS
```

## Container Descriptions

### @prompt-registry/core (Domain Layer)
Pure domain types and interfaces with no external dependencies:
- **Domain Types**: Bundle, Collection, Primitive, Hub, Install, Registry types
- **Port Interfaces**: Abstractions for external implementations
- **JSON Schemas**: Validation schemas for collections and hubs
- **Exports**: `SCHEMA_DIR` for schema path access

**Technology**: TypeScript, js-yaml (for schema parsing only)

### @prompt-registry/infra (Infrastructure Layer)
Infrastructure implementations for external integrations:
- **GitHub Client**: API integration with rate limiting and ETag caching
- **Harvester**: Bundle discovery from GitHub, AwesomeCopilot, APM, Local sources
- **Search Engine**: BM25 full-text search with faceted filtering
- **Storage**: Index store (JSON), blob cache (SHA1), ETag store
- **Template Engine**: Scaffolding templates for all primitive types
- **Downloaders**: Asset downloading from GitHub releases
- **Extractors**: ZIP bundle extraction
- **Exports**: `TEMPLATE_ROOT` and `TEMPLATE_PATHS` for template access

**Technology**: TypeScript, axios, js-yaml, yauzl

### @prompt-registry/app (Application Layer)
Orchestration of business logic:
- **Collection Logic**: Reading and writing collection files
- **Install Orchestration**: Target management and bundle installation
- **Registry Management**: Profile and registry configuration
- **Discovery**: Repository context detection

**Technology**: TypeScript, js-yaml

### @prompt-registry/cli (CLI Layer)
User-facing CLI interface using Clipanion framework:
- **CLI Commands**: collection, bundle, init, source, hub, status, update, and scaffolding commands
- **CLI Framework**: I/O abstraction, error handling, output formatting
- **Validation**: Collection YAML validation
- **Bundle Builder**: Deterministic ZIP bundle creation

**Technology**: TypeScript, Clipanion, inquirer, archiver, semver, typanion, yauzl, js-yaml

### @prompt-registry/sdk (SDK Layer)
High-level APIs for integrations (placeholder):
- **SDK APIs**: Placeholder for future integration APIs

**Technology**: TypeScript

## Container Relationships

| From | To | Relationship |
|------|-----|--------------|
| CLI | Framework | Uses for I/O abstraction |
| CLI | Validation | Validates collections |
| CLI | Builder | Creates bundles |
| CLI | App | Uses for business logic |
| CLI | Core | Uses for domain types |
| CLI | Infra | Uses for infrastructure |
| App | Infra | Uses for infrastructure implementations |
| App | Core | Uses for domain types |
| SDK | Infra | Uses for infrastructure implementations |
| SDK | Core | Uses for domain types |
| Infra | Core | Uses for domain types |
| Harvester | GitHub | Fetches content |
| Search | Stores | Uses for index/cache |
| GitHub | Stores | Uses for ETag caching |

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript | Type safety, VS Code ecosystem |
| Runtime | Node.js 18+ | Matches VS Code's Node version |
| CLI Framework | Clipanion | Modern CLI framework with TypeScript support |
| Search | Hand-rolled BM25 | Zero deps, deterministic, inspectable |
| HTTP | axios | Familiar, interceptors for retry |
| YAML | js-yaml | Already a dependency |
| ZIP | yauzl | Pure JS, no native deps |
| Validation | JSON Schema | Standard validation with AJV |
| Testing | Vitest | Modern test framework with coverage |

## Package Dependencies

| Package | Dependencies |
|---------|-------------|
| @prompt-registry/core | js-yaml |
| @prompt-registry/infra | @prompt-registry/core, axios, js-yaml, yauzl |
| @prompt-registry/app | @prompt-registry/core, @prompt-registry/infra, js-yaml |
| @prompt-registry/cli | @prompt-registry/core, @prompt-registry/infra, @prompt-registry/app, clipanion, inquirer, archiver, semver, typanion, yauzl, js-yaml |
| @prompt-registry/sdk | @prompt-registry/core, @prompt-registry/infra |

## See Also

- [Codemap](./codemap.md) — Package structure and dependencies
- [System Context](./system-context.md) — External relationships
- [Component Diagrams](./component.md) — Detailed internals
