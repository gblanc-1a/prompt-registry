# Domain Layer Guidelines

Working in `src/domain/` — Core type definitions and business logic.

## Architecture Overview

```
src/domain/
├── bundle/            → Bundle types, manifests
├── hub/               → Hub configuration types
├── install/           → Installation target types
├── primitive/         → Primitive types (prompts, skills, agents, etc.)
├── registry/          → Registry configuration types
└── index.ts           → Barrel exports
```

## CRITICAL: Domain Layer Invariants

**Domain layer cannot import from feature layers.** This ensures clean separation of concerns.

### ✅ Allowed Imports

```typescript
// Domain can import domain
import { BundleManifest } from './bundle/types';
import { Primitive } from './primitive/types';

// Domain can import from public/ (shared types)
import type { SearchHit } from '../public';
```

### ❌ Forbidden Imports

```typescript
// NEVER import from feature layers
import { PrimitiveIndex } from '../primitive-index';        // ❌
import { GitHubClient } from '../github/client';             // ❌
import { TargetStateStore } from '../install/target-state-store'; // ❌

// NEVER import CLI framework
import { Context } from '../cli/framework';                   // ❌
```

Enforced by ESLint rule `local-domain/no-feature-imports-in-domain`.

## Type Definition Patterns

### Branded Types for IDs

Use branded types to prevent ID confusion:

```typescript
type BundleId = string & { readonly __brand: 'BundleId' };
type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };
```

### Discriminated Unions for Variants

```typescript
type Primitive =
  | { kind: 'prompt'; title: string; description: string }
  | { kind: 'skill'; name: string; description: string }
  | { kind: 'agent'; title: string; model: string };
```

### Strict Validation

All domain objects should be validated at boundaries:

```typescript
// In validate.ts (at library boundary)
export function validateBundleManifest(obj: unknown): BundleManifest {
  // Runtime validation with Zod or manual checks
}
```

## Key Types

| Type | Location | Description |
|------|----------|-------------|
| `BundleManifest` | `bundle/types.ts` | Deployment manifest structure |
| `Primitive` | `primitive/types.ts` | Union of all primitive kinds |
| `HubConfig` | `hub/types.ts` | Hub configuration schema |
| `Target` | `install/types.ts` | Installation target definition |
| `RegistryConfig` | `registry/types.ts` | Registry settings |

## Best Practices

1. **Immutable types**: Use `readonly` for all properties
2. **Pure functions**: Domain logic should be side-effect free
3. **No I/O**: Domain types describe data, don't perform operations
4. **Versioned schemas**: Include version fields for persisted types
5. **Documentation**: JSDoc for all exported types

## Example: Adding a New Primitive Kind

1. Add to `primitive/types.ts`:
```typescript
export interface McpServerPrimitive {
  kind: 'mcp-server';
  id: string;
  command?: string;
  url?: string;
}
```

2. Update `Primitive` union type
3. Update validation in `validate.ts`
4. Update kind constants (`PRIMITIVE_KINDS`)

## See Also

- `../primitive-index/AGENTS.md` — Feature layer that consumes domain types
- `../cli/commands/AGENTS.md` — CLI layer that uses domain types
