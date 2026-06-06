# Key Data Flows

Sequence diagrams showing how data flows through the system for key operations.

## 1. Collection Validation Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as CLI Command
    participant Val as Validation Engine
    participant FS as File System

    User->>CLI: prompt-registry collection validate
    CLI->>FS: Read collection YAML
    FS-->>CLI: YAML content

    CLI->>Val: validateCollectionFile(content)

    Val->>Val: Parse YAML
    Val->>Val: Validate schema
    Val->>Val: Check item kinds
    Val->>Val: Verify file references

    alt Valid
        Val-->>CLI: { valid: true }
        CLI-->>User: ✓ Collection is valid
    else Invalid
        Val-->>CLI: { valid: false, errors[] }
        CLI-->>User: ✗ Error details
    end
```

## 2. Bundle Build Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as Build Command
    participant Col as Collection Reader
    participant Manifest as Manifest Generator
    participant Zip as ZIP Builder
    participant FS as File System

    User->>CLI: prompt-registry bundle build
    CLI->>Col: readCollection(path)
    Col->>FS: Read collection.yml
    FS-->>Col: Collection data
    Col-->>CLI: Collection object

    CLI->>Manifest: createBundleManifest(collection, version)
    Manifest->>FS: Read item files
    FS-->>Manifest: Item contents
    Manifest->>Manifest: Generate manifest YAML
    Manifest-->>CLI: Manifest path

    CLI->>Zip: createDeterministicZip(manifest, items)
    Zip->>Zip: Sort items
    Zip->>Zip: Set fixed timestamps
    Zip->>FS: Write ZIP file
    FS-->>Zip: Confirm write
    Zip-->>CLI: ZIP path

    CLI-->>User: Bundle built: path/to/bundle.zip
```

## 3. Primitive Index Harvest Flow

```mermaid
sequenceDiagram
    participant CLI as Hub Harvest Command
    participant Harvester as Harvester
    participant Provider as BundleProvider
    participant GitHub as GitHubClient
    participant Cache as BlobCache
    participant Extract as Extractor
    participant Index as PrimitiveIndex

    CLI->>Harvester: harvest(sources)

    loop For each source
        Harvester->>Provider: enumerateBundles()
        Provider->>GitHub: getTree() / getContents()
        GitHub-->>Provider: Bundle list
        Provider-->>Harvester: Bundle refs

        loop For each bundle
            Harvester->>GitHub: fetchManifest(ref)
            GitHub->>Cache: get(blobSha)
            alt Cache hit
                Cache-->>GitHub: Cached content
            else Cache miss
                GitHub->>GitHub: HTTP GET
                GitHub->>Cache: set(blobSha, content)
            end
            GitHub-->>Harvester: Manifest

            Harvester->>Provider: fetchBundleFiles(ref)
            Provider->>GitHub: Download files
            GitHub-->>Provider: File contents
            Provider-->>Harvester: Files map

            Harvester->>Extract: extractFromFile(file)
            Extract->>Extract: Parse frontmatter
            Extract-->>Harvester: Primitive objects
        end
    end

    Harvester->>Index: add(primitives)
    Index->>Index: Build BM25 index
    Index->>Index: Build facet indices
    Index-->>Harvester: Confirm

    Harvester-->>CLI: HarvestResult
    CLI-->>User: Indexed N primitives from M bundles
```

## 4. Search Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as Search Command
    participant Index as PrimitiveIndex
    participant BM25 as BM25Index
    participant Facets as FacetIndex
    participant Store as Index Store

    User->>CLI: primitive-index search -q "query"
    CLI->>Store: loadIndex(path)
    Store-->>CLI: PrimitiveIndex instance

    CLI->>Index: search({ q, kinds, limit })

    Index->>BM25: scoreQuery(query)
    BM25->>BM25: Tokenize query
    BM25->>BM25: Calculate IDF/TF scores
    BM25-->>Index: Scored doc IDs

    Index->>Facets: filter(kinds, tags, sources)
    Facets->>Facets: Intersect filter sets
    Facets-->>Index: Filtered IDs

    Index->>Index: Merge & sort results
    Index->>Index: Apply offset/limit

    Index-->>CLI: SearchResult { hits[], total }
    CLI->>CLI: Format output (text/json)
    CLI-->>User: Search results
```

## 5. Bundle Installation Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as Install Command
    participant Installer as BundleInstaller
    participant Validator as BundleValidator
    participant Targets as TargetStateStore
    participant Lockfile as LockfileManager
    participant Scope as ScopeWriter
    participant FS as File System

    User->>CLI: prompt-registry install my-bundle --target vscode
    CLI->>Targets: getTarget('vscode')
    Targets->>FS: Read prompt-registry.yml
    FS-->>Targets: Target config
    Targets-->>CLI: Target object

    CLI->>Installer: install(bundlePath, target)

    Installer->>Validator: validateBundle(bundlePath)
    Validator->>FS: Read deployment-manifest.yml
    FS-->>Validator: Manifest
    Validator->>Validator: Check schema
    Validator-->>Installer: Valid manifest

    Installer->>Scope: install(manifest, files)
    Scope->>FS: Write prompt files
    Scope->>FS: Write instruction files
    Scope->>FS: Write skill directories
    FS-->>Scope: Confirm writes
    Scope-->>Installer: Installed paths

    Installer->>Lockfile: addBundle(bundleId, manifest)
    Lockfile->>FS: Read prompt-registry.lock.json
    Lockfile->>Lockfile: Add entry
    Lockfile->>FS: Write lockfile
    FS-->>Lockfile: Confirm
    Lockfile-->>Installer: Updated lockfile

    Installer-->>CLI: Success
    CLI-->>User: ✓ Installed to vscode
```

## 6. Publish Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as Publish Command
    participant Git as Git Helper
    participant Affected as Affected Detector
    participant Builder as Bundle Builder
    participant GitHub as GitHubClient

    User->>CLI: prompt-registry publish-collections
    CLI->>Git: getChangedPaths(baseSha, headSha)
    Git->>Git: git diff --name-only
    Git-->>CLI: Changed files

    CLI->>Affected: detectAffectedCollections(changes)
    Affected->>Affected: Map files to collections
    Affected-->>CLI: Affected collection IDs

    loop For each affected collection
        CLI->>Builder: buildCollectionBundle(collection)
        Builder->>Builder: Generate manifest
        Builder->>Builder: Create ZIP
        Builder-->>CLI: Bundle path

        CLI->>GitHub: computeNextVersion(repo, collectionId)
        GitHub->>GitHub: List releases
        GitHub-->>CLI: Next version

        CLI->>GitHub: createRelease(tag, bundle)
        GitHub->>GitHub: POST /repos/{owner}/{repo}/releases
        GitHub-->>CLI: Release URL
    end

    CLI-->>User: Published N collections
```

## 7. Token Resolution Flow

```mermaid
sequenceDiagram
    participant Client as GitHubClient
    participant Token as TokenProvider
    participant Env as Environment
    participant Gh as gh CLI
    participant File as Token File

    Client->>Token: getToken()

    Token->>Env: Check GITHUB_TOKEN
    alt GITHUB_TOKEN exists
        Env-->>Token: Return token
    else
        Token->>Env: Check GH_TOKEN
        alt GH_TOKEN exists
            Env-->>Token: Return token
        else
            Token->>Gh: gh auth token
            alt gh authenticated
                Gh-->>Token: Return token
            else
                Token->>File: Read ~/.github/token
                File-->>Token: Return token or undefined
            end
        end
    end

    Token-->>Client: Token or undefined
```

## 8. Error Handling Flow

```mermaid
sequenceDiagram
    participant CLI as CLI Command
    participant Code as Library Code
    participant Error as RegistryError
    participant Formatter as ErrorFormatter
    participant User as User

    CLI->>Code: Call library function

    alt Error occurs
        Code->>Error: throw new RegistryError({...})
        Error-->>CLI: Error thrown

        CLI->>Formatter: renderError(err, ctx)
        Formatter->>Formatter: Format by output type

        alt Text output
            Formatter-->>CLI: Human-readable message
        else JSON output
            Formatter-->>CLI: { error: {...} }
        else YAML output
            Formatter-->>CLI: yaml formatted error
        end

        CLI-->>User: Display error
        CLI-->>User: Exit code 1
    else Success
        Code-->>CLI: Result
        CLI-->>User: Success output
        CLI-->>User: Exit code 0
    end
```

## Performance Characteristics

| Flow | Typical Duration | Bottleneck |
|------|-----------------|------------|
| Collection validation | <100ms | YAML parsing |
| Bundle build | 1-5s | File I/O + ZIP compression |
| Cold index harvest | 7-30s | GitHub API calls |
| Warm index harvest | 1-3s | ETag 304 responses |
| Search query | <10ms | BM25 scoring (in-memory) |
| Bundle install | <1s | File writes |
| Publish | 10-60s | GitHub release creation |

## Error Recovery

| Flow | Failure Mode | Recovery |
|------|--------------|----------|
| Harvest | Network error | Retry with exponential backoff |
| Harvest | Partial failure | Resume from progress log |
| Install | Target not found | Suggest running target add |
| Install | Validation fail | Report specific errors |
| Publish | Rate limit | Wait and retry |
| Search | Index missing | Suggest running harvest |

## See Also

- [System Context](./c4-system-context.md) — External view
- [Container Diagram](./c4-container.md) — High-level containers
- [Component Diagrams](./c4-component.md) — Detailed internals
