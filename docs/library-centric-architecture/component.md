# C4 Component Diagrams (Level 3)

Detailed component diagrams for key subsystems.

## CLI Framework Components

```mermaid
flowchart TB
    subgraph CLI["CLI Commands"]
        cmd[Individual command implementations]
    end

    subgraph Framework["CLI Framework"]
        defineCmd[defineCommand<br/>Creates CommandDefinition]
        ctx[Context<br/>I/O abstraction]
        err[RegistryError<br/>Structured errors]
        fmt[Formatters<br/>Output formatting]
        parse[Arg Parse<br/>Argument parsing]
        prodCtx[ProductionContext<br/>Real filesystem I/O]
    end

    FS[(File System<br/>Node.js fs)]

    cmd --> defineCmd
    cmd --> ctx
    cmd --> err
    cmd --> fmt
    cmd --> parse

    ctx --> prodCtx
    prodCtx --> FS
```

### Key Components

| Component | Responsibility | Key Methods/Properties |
|-----------|----------------|------------------------|
| `defineCommand` | Factory for command definitions | `defineCommand(opts): CommandDefinition` |
| `Context` | I/O abstraction | `cwd()`, `fs.*`, `stdout`, `stderr`, `env` |
| `RegistryError` | Structured errors | `code`, `message`, `hint`, `context`, `toJSON()` |
| `Formatters` | Output formatting | `formatOutput()`, `renderError()` |
| `ArgParse` | Argument parsing | `parseSingleArg()`, `parseMultiArg()`, `hasFlag()` |

---

## Primitive Index Components

```mermaid
flowchart TB
    subgraph API["CLI / API"]
        cli[Search requests]
    end

    subgraph Index["Primitive Index"]
        primIndex[PrimitiveIndex<br/>Main search API]
        bm25[BM25Index<br/>BM25 scoring]
        extract[Extractor<br/>Frontmatter extraction]
        harvester[Harvester<br/>Bundle harvesting]
        facets[FacetIndex<br/>Kind/tag/source filters]
        shortlist[Shortlist<br/>Candidate set management]
    end

    subgraph Providers["Bundle Providers"]
        installed[InstalledBundles<br/>Local bundles]
        hubBundles[HubBundles<br/>Remote hub bundles]
        localFolder[LocalFolder<br/>Local filesystem bundles]
    end

    Store[(Index Store<br/>JSON)]

    cli --> primIndex
    primIndex --> bm25
    primIndex --> facets
    primIndex --> shortlist
    primIndex --> harvester
    primIndex --> Store

    harvester --> installed
    harvester --> hubBundles
    harvester --> localFolder

    installed --> extract
    hubBundles --> extract
    localFolder --> extract
```

### Key Components

| Component | Responsibility | Key Methods |
|-----------|----------------|-------------|
| `PrimitiveIndex` | Search API | `search()`, `facet()`, `shortlist()`, `exportProfile()` |
| `BM25Index` | BM25 scoring | `index()`, `search()`, `scoreTerm()` |
| `Harvester` | Bundle discovery | `harvest()`, `harvestBundle()` |
| `Extractor` | Content parsing | `extractFromFile()`, `extractMcpPrimitives()` |
| `FacetIndex` | Filtering | `filter()`, `intersect()` |
| `Shortlist` | Candidate sets | `create()`, `add()`, `remove()`, `list()` |

---

## Installation System Components

```mermaid
flowchart TB
    subgraph API["CLI / API"]
        cli[Install requests]
    end

    subgraph Install["Installation System"]
        installer[BundleInstaller<br/>Core installation logic]
        targets[TargetStateStore<br/>Target configuration]
        lockfile[LockfileManager<br/>Lockfile CRUD]
        validator[BundleValidator<br/>Bundle validation]
    end

    subgraph Scopes["Scope Writers"]
        repoScope[RepositoryScopeWriter<br/>Writes to .github/]
        userScope[UserScopeService<br/>Writes to user config]
    end

    Config[(Config Store<br/>YAML/JSON)]
    FS[(File System<br/>Node.js fs)]

    cli --> installer
    cli --> targets

    installer --> targets
    installer --> lockfile
    installer --> validator
    installer --> repoScope
    installer --> userScope

    targets --> Config
    lockfile --> Config
    repoScope --> FS
    userScope --> FS
```

### Key Components

| Component | Responsibility | Key Methods |
|-----------|----------------|-------------|
| `BundleInstaller` | Installation orchestration | `install()`, `uninstall()` |
| `TargetStateStore` | Target management | `add()`, `remove()`, `list()`, `get()` |
| `LockfileManager` | Lockfile operations | `addBundle()`, `removeBundle()`, `load()` |
| `BundleValidator` | Bundle validation | `validateBundle()`, `validateManifest()` |
| `RepositoryScopeWriter` | Repo-scoped writes | `install()`, `remove()` |
| `UserScopeService` | User-scoped writes | `install()`, `remove()` |

---

## GitHub Integration Components

```mermaid
flowchart TB
    subgraph Index["Harvester"]
        req[Content requests]
    end

    subgraph GitHub["GitHub Integration"]
        client[GitHubClient<br/>API client]
        fetcher[AssetFetcher<br/>Release downloading]
        blobCache[BlobCache<br/>Content-addressed caching]
        etag[EtagStore<br/>HTTP caching]
        token[TokenProvider<br/>Token resolution]
    end

    API[(GitHub API<br/>REST API)]

    req --> client
    req --> fetcher

    client --> token
    client --> etag
    client --> API

    fetcher --> blobCache
    fetcher --> API

    etag -. "If-None-Match" .-> API
```

### Key Components

| Component | Responsibility | Key Methods |
|-----------|----------------|-------------|
| `GitHubClient` | API operations | `getContents()`, `getTree()`, `getRateLimit()` |
| `AssetFetcher` | Release downloads | `fetchAsset()`, `fetchBundle()` |
| `BlobCache` | Content caching | `get()`, `set()`, `has()` |
| `EtagStore` | HTTP caching | `getEtag()`, `setEtag()` |
| `TokenProvider` | Auth tokens | `getToken()`, `resolveToken()` |

---

## Domain Layer Components

```mermaid
flowchart TB
    subgraph Domain["Domain Layer (Pure Types)"]
        bundle[Bundle Types<br/>BundleManifest, BundleRef]
        primitive[Primitive Types<br/>Primitive, PrimitiveKind]
        hub[Hub Types<br/>HubConfig, HubSource]
        install[Install Types<br/>Target, Installable]
        registry[Registry Types<br/>RegistryConfig, BundleSpec]
    end

    CLI[CLI<br/>Uses domain types]
    Index[Primitive Index<br/>Uses domain types]
    Installer[Installer<br/>Uses domain types]

    CLI --> bundle
    CLI --> primitive
    Index --> primitive
    Index --> bundle
    Installer --> install
    Installer --> registry
```

### Key Types

| Type | Purpose | Key Properties |
|------|---------|----------------|
| `BundleManifest` | Bundle metadata | `id`, `version`, `name`, `items[]` |
| `Primitive` | Union of all kinds | `kind`, `id`, `title/description` |
| `HubConfig` | Hub definition | `sources[]`, `id`, `name` |
| `Target` | Install destination | `id`, `type`, `path` |
| `RegistryConfig` | Settings | `targets[]`, `sources[]` |

## Component Dependencies

```mermaid
flowchart TB
    subgraph Domain["Domain Layer (No deps)"]
        D[Bundle/Primitive/Hub Types]
    end

    subgraph Framework["CLI Framework"]
        F[Context/Errors/Formatters]
    end

    subgraph Features["Feature Layers"]
        I[PrimitiveIndex]
        H[Harvester]
        G[GitHubClient]
        N[BundleInstaller]
    end

    subgraph CLI["CLI Commands"]
        C[Command implementations]
    end

    D --> F
    D --> I
    D --> H
    D --> G
    D --> N

    F --> C
    I --> C
    N --> C

    H --> I
    G --> H
```

**Key Rule**: Domain has no dependencies. Feature layers depend only on Domain and Framework. CLI depends on everything.

## See Also

- [System Context](./c4-system-context.md) — External view
- [Container Diagram](./c4-container.md) — High-level containers
- [Data Flow](./data-flow.md) — Process flows
