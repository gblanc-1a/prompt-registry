# Unified Bundle Installation Migration

## Problem Statement

Bundle installation currently follows separate CLI and VS Code extension paths. The CLI has a current failure mode because it depends on a rigid ZIP layout rather than locating the bundle manifest, while the two entry points also place user-level installations in different locations. [desc] [Q1] [Q4]

## Target Customer

Users who install bundles through either the CLI or the VS Code extension need a consistent installation experience and a reliable way to continue managing their installed bundles. [Q2] [Q8]

## Success Metrics

| Metric | Successful outcome | Source |
| --- | --- | --- |
| Shared installation behavior | Both CLI and VS Code install the same valid bundle into `~/.copilot` through the shared path. | [Q3] |
| ZIP compatibility | CLI installation succeeds when a valid bundle manifest is not at the currently hardcoded archive location. | [Q3] |
| Lifecycle consistency | Install, update, and uninstall use shared, target-aware installation data across CLI and IDE adapters. | [Q8] |
| Target isolation | User- and repository-level operations for every supported target cannot affect another target's artifacts or state. | [Q8] |

## Initiative Trigger

This work responds to an active CLI installation failure, duplicated installation architecture, and inconsistent user-level installation locations between the CLI and extension. [Q4]

## Initial Scope Signal

The workflow-selected scope is `unified-bundle-installation-migration`. [scope]

The confirmed product boundary is a shared manifest-driven installation lifecycle covering install, update, and uninstall; a common Copilot user-level target at `~/.copilot`; one-time transparent migration of existing extension storage; a shared registry accessible to CLI and IDE adapters; and isolation for every supported target at both user and repository scope. [Q8]

The work will be planned as a design pull request followed by implementation pull requests. Any compatibility break for the CLI or VS Code extension remains an evidence-led decision for feasibility and architecture work, rather than a decision already made by this framing. [Q7] [Q9]

## Assumptions & Open Questions

None.