# Validating Collections

Validate your collection files before publishing to catch errors early.

## Quick Validation

```bash
Ctrl+Shift+P → "Prompt Registry: Validate Collections"
```

Validates all `.collection.yml` files in your `collections/` directory.

## Validation with File References

```bash
Ctrl+Shift+P → "Prompt Registry: Validate Collections (Check File References)"
```

Also verifies that all referenced files (prompts, instructions, etc.) exist.

## What Gets Validated

| Check | Description |
|-------|-------------|
| Required fields | `id`, `name`, `description`, `items` |
| ID format | Lowercase letters, numbers, hyphens only |
| Item paths | Valid relative paths |
| Item kinds | One of: `prompt`, `instruction`, `chat-mode`, `agent` |
| File references | Referenced files exist (with Check File References) |

## Common Errors

**Missing required field**
→ Add the missing `id`, `name`, `description`, or `items` field

**Invalid ID format**
→ Use only lowercase letters, numbers, and hyphens (e.g., `my-collection`)

**Invalid item kind**
→ Use one of: `prompt`, `instruction`, `chat-mode`, `agent`

**File not found**
→ Check that the path in `items[].path` points to an existing file

## See Also

- [Collection Schema](./collection-schema.md) — Full YAML reference
- [Creating Collections](./creating-source-bundle.md) — Getting started
