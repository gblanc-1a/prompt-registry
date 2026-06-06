# Packages Architecture Codemap

This document provides a structural overview of the packages architecture in the prompt-registry monorepo.

## Package Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                         @prompt-registry/cli                      │
│  (CLI Interface - Clipanion-based command line tool)              │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ├──► @prompt-registry/app
             │
             ├──► @prompt-registry/core
             │
             └──► @prompt-registry/infra
             
┌─────────────────────────────────────────────────────────────────┐
│                         @prompt-registry/sdk                      │
│  (SDK for integrations - placeholder, minimal implementation)     │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ├──► @prompt-registry/core
             │
             └──► @prompt-registry/infra

┌─────────────────────────────────────────────────────────────────┐
│                         @prompt-registry/app                      │
│  (Application Layer - orchestration, install, registry)         │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ├──► @prompt-registry/core
             │
             └──► @prompt-registry/infra

┌─────────────────────────────────────────────────────────────────┐
│                        @prompt-registry/infra                     │
│  (Infrastructure Layer - GitHub, harvesters, search, storage)   │
└────────────┬──────────────────────────────────────────────────────┘
             │
             └──► @prompt-registry/core

┌─────────────────────────────────────────────────────────────────┐
│                         @prompt-registry/core                    │
│  (Domain Layer - types, interfaces, ports - no package deps)     │
└─────────────────────────────────────────────────────────────────┘
```

## Package Details

### @prompt-registry/core (Domain Layer)

**Purpose**: Core domain types and interfaces with minimal external dependencies.

**Dependencies**: 
- js-yaml (for YAML parsing in schemas only)

**Key Modules**:
- `domain/` - Domain types and business logic
  - `bundle/` - Bundle types (BundleManifest, BundleRef)
  - `collection/` - Collection types
  - `discovery/` - Discovery types
  - `hub/` - Hub configuration types
  - `install/` - Installation types (Target, Installable)
  - `primitive/` - Primitive types (Primitive, PrimitiveKind)
  - `registry/` - Registry configuration types
  - `scaffold/` - Scaffolding types
  - `skill/` - Skill types
  - `source/` - Source types
  - `source-id.ts` - Source ID utilities
  - `spec-parser.ts` - Specification parsing
  - `errors.ts` - Domain errors
- `ports/` - Port interfaces for external implementations
- `public/` - Public APIs and schemas
  - `schemas/` - JSON schemas (collection.schema.json, etc.)

**Exports**:
- `SCHEMA_DIR` - Path to schema directory

**Design Principle**: Pure domain layer with no dependencies on other packages.

---

### @prompt-registry/infra (Infrastructure Layer)

**Purpose**: Infrastructure implementations for GitHub, harvesting, search, and storage.

**Dependencies**:
- @prompt-registry/core (workspace:*)
- axios (HTTP client)
- js-yaml (YAML parsing)
- yauzl (ZIP extraction)

**Key Modules**:
- `github/` - GitHub API integration
  - GitHub client with rate limiting and ETag caching
  - Content fetching and tree enumeration
- `harvest/` - Bundle discovery and harvesting
  - Bundle providers (GitHub, AwesomeCopilot, APM, Local)
  - Harvest orchestration
- `search/` - Search implementations
  - BM25 search engine
  - Faceted indexing
- `stores/` - Storage implementations
  - Index store (JSON-based)
  - Blob cache (content-addressed)
  - ETag store
- `scaffolding/` - Template engine and templates
  - TemplateEngine class
  - Template files for all primitive types
- `downloaders/` - Asset downloading
- `extractors/` - Bundle extraction
- `fs/` - Filesystem utilities
- `http/` - HTTP utilities
- `resolvers/` - Path resolution
- `writers/` - File writing
- `default-hubs.ts` - Default hub configurations
- `checksum.ts` - Checksum utilities

**Exports**:
- `TEMPLATE_ROOT` - Path to template directory
- `TEMPLATE_PATHS` - Paths to all template directories

**Design Principle**: Infrastructure implementations depend only on core domain types.

---

### @prompt-registry/app (Application Layer)

**Purpose**: Application orchestration, installation commands, and registry management.

**Dependencies**:
- @prompt-registry/core (workspace:*)
- @prompt-registry/infra (workspace:*)
- js-yaml (YAML parsing)

**Key Modules**:
- `collection/` - Collection reading and writing
  - `read-collection.ts` - Collection file parsing and validation
- `context-detection/` - Repository context detection
  - Git repository detection
  - Workspace root resolution
- `discovery/` - Discovery orchestration
- `install/` - Installation orchestration
  - Target management
  - Bundle installation logic
- `registry/` - Registry management
  - Profile management
  - Registry configuration
- `resolvers/` - Resolution logic
- `search/` - Search orchestration
- `stores/` - Application-level stores
- `writers/` - Application-level writers

**Design Principle**: Application layer orchestrates infrastructure implementations for business use cases.

---

### @prompt-registry/cli (CLI Layer)

**Purpose**: CLI interface for end users using Clipanion framework.

**Dependencies**:
- @prompt-registry/app (workspace:*)
- @prompt-registry/core (workspace:*)
- @prompt-registry/infra (workspace:*)
- clipanion (CLI framework)
- inquirer (interactive prompts)
- archiver (ZIP creation)
- semver (version management)
- typanion (validation)
- yauzl (ZIP extraction)
- js-yaml (YAML parsing)

**Key Modules**:
- `commands/` - CLI command implementations
  - `collection-create.ts` - Collection scaffolding
  - `prompt-create.ts` - Prompt scaffolding
  - `instruction-create.ts` - Instruction scaffolding
  - `agent-create.ts` - Agent scaffolding
  - `skill-create.ts` - Skill scaffolding
  - `plugin-create.ts` - Plugin scaffolding
  - `hook-create.ts` - Hook scaffolding
  - `collection-validate.ts` - Collection validation
  - `bundle-build.ts` - Bundle building
  - `bundle-manifest.ts` - Manifest generation
  - `init.ts` - Registry initialization
  - `source.ts` - Source management
  - `hub.ts` - Hub management
  - `status.ts` - Status display
  - `update.ts` - Update commands
  - And more...
- `framework/` - CLI framework abstractions
  - `command-class.ts` - Command base class
  - `error.ts` - Error handling
  - `output.ts` - Output formatting
  - `context.ts` - I/O abstraction
- `validate.ts` - Collection validation utilities
- `collections.ts` - Collection utilities
- `skills.ts` - Skill utilities
- `cli.ts` - CLI entry point
- `main.ts` - Main entry point

**Binary**: `prompt-registry`

**Design Principle**: CLI layer provides user-facing commands using application and infrastructure layers.

---

### @prompt-registry/sdk (SDK Layer)

**Purpose**: High-level APIs for building integrations (placeholder, minimal implementation).

**Dependencies**:
- @prompt-registry/core (workspace:*)
- @prompt-registry/infra (workspace:*)

**Key Modules**:
- `api/` - Empty directory (placeholder for future SDK APIs)

**Status**: Minimal implementation, mostly placeholder for future SDK development.

**Design Principle**: SDK layer will provide simplified APIs for external integrations.

---

## Layering Principles

1. **Domain Layer (core)**: No dependencies on other packages. Pure types and interfaces.
2. **Infrastructure Layer (infra)**: Depends only on core. Implements external integrations.
3. **Application Layer (app)**: Depends on core and infra. Orchestrates business logic.
4. **CLI Layer (cli)**: Depends on core, infra, and app. Provides user interface.
5. **SDK Layer (sdk)**: Depends on core and infra. Provides integration APIs.

## Cross-Package Boundaries

The architecture enforces clear boundaries:
- Template paths are exported from `@prompt-registry/infra` via `TEMPLATE_PATHS`
- Schema paths are exported from `@prompt-registry/core` via `SCHEMA_DIR`
- No hardcoded relative paths across package boundaries
- Each package has its own build process with resource copying as needed

## See Also

- [System Context](./system-context.md) — External relationships and user personas
- [Container Diagram](./container.md) — High-level containers and technology choices
- [Component Diagrams](./component.md) — Detailed component views
