# Collection Schema Reference

Collection manifests (`.collection.yml`) define the structure and contents of a prompt collection.

## Annotated Example

```yaml
id: python-development              # Required. Lowercase, numbers, hyphens only
name: Python Development Suite      # Required. Human-readable display name (max 100 chars)
description: Prompts for Python dev # Required. What this collection does (max 500 chars)
version: 2.1.0                      # Optional. Semantic version
author: Python Team                 # Optional. Creator name
tags:                               # Optional. For discoverability
  - python
  - testing

items:                              # Required. List of resources (max 50)
  - path: prompts/write-tests.prompt.md   # Required. Relative path to file
    kind: prompt                          # Required. One of: prompt, instruction, chat-mode, agent
    title: Test Writer                    # Optional. Display title
    description: Generates unit tests     # Optional. Item description
    tags: [testing, pytest]               # Optional. Item-level tags

  - path: instructions/standards.instructions.md
    kind: instruction

  - path: agents/runner.agent.md
    kind: agent

mcp:                                # Optional. MCP server configurations
  items:
    python-analyzer:                # Server name
      command: python               # Required. Command to start server
      args:                         # Optional. Command arguments
        - "${bundlePath}/server.py" # ${bundlePath} = installed bundle path
      env:                          # Optional. Environment variables
        LOG_LEVEL: info
      disabled: false               # Optional. Default: false

display:                            # Optional. UI preferences
  color: "#3776AB"                  # Color theme
  icon: python                      # Icon identifier
  ordering: manual                  # manual or alphabetical
  show_badge: true                  # Show badge in UI
```

## Validation

Run `Ctrl+Shift+P` → "Prompt Registry: Validate Collections"

## See Also

- [Creating Collections](./creating-source-bundle.md)
- [Publishing Guide](./publishing.md)
