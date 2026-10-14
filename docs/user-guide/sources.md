# Managing Sources

Sources are repositories hosting prompt bundles.

## Automatic Source Setup

On first launch, AI Primitives Hub automatically adds the **Awesome Copilot** source (`github/awesome-copilot`). This gives you immediate access to community-curated collections without manual configuration.

If you select a hub during first-run setup, all sources defined in that hub are also automatically synced.

## Source Types

| Type | Use Case | Status |
|------|----------|--------|
| `awesome-copilot` | Community collections (GitHub-hosted) | Active |
| `local-awesome-copilot` | Local collection development/testing | Active |
| `azure-devops` | Community collections (Azure DevOps hosted) | Active |
| `github` | GitHub repository releases | Active ( Recommended ) |
| `local` | File system directories | Active |
| `apm` | APM package repositories | Active |
| `local-apm` | Local APM packages | Active |
| `skills` | GitHub repository with skills | Active |
| `local-skills` | Local filesystem skills directory | Active |

The status column describes source support in the broader product; it does not mean that
every type is supported by the opt-in portable CLI deployment path.

## Portable CLI deployment

The portable v3 lifecycle is an opt-in **CLI user-scope** path
(`AI_PRIMITIVES_HUB_UNIFIED_DEPLOY=1`). It is off by default and is not wired into the
VS Code extension. The `vscode` user target is the verified target for this slice.

The portable path currently resolves GitHub release sources, GitHub-backed `skills` and
`awesome-copilot` tree sources, and local snapshots such as `local` and
`local-awesome-copilot`. GitHub release bundles must be ZIP archives; other archive formats
are not supported by this install path. Replays use the recorded provider coordinates and
content digest rather than selecting a newer release.

Workspace-local source roots are recorded relative to the workspace. A local source outside
the workspace needs an explicit named binding from the active hub configuration; matching
by directory basename is not supported. Shared desired state stores the portable relative
locator or binding name, never the machine's absolute source root. The machine-local
materialization file can contain target paths needed for local cleanup.

`local-skills` is a live source. The portable CLI copy-based deployment refuses to install
it until live-link placement is integrated; this does not change the existing source
behavior outside that opt-in path. Azure DevOps and Artifactory portable lifecycle
integration, as well as VS Code extension integration, are deferred. The v3 path does not
silently fall back to GitHub for an unsupported source.

## Adding a Source

Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on
macOS) and run **AI Primitives Hub: Add Source**.

## Managing Sources

In Registry Explorer:
- **Sync** — Right-click → Sync Source
- **Edit** — Right-click → Edit Source
- **Toggle** — Right-click → Toggle Enabled/Disabled
- **Remove** — Right-click → Remove Source
- **Open Repository** — Right-click → Open Repository

Command Palette:
- **Sync All Sources** — Open the Command Palette (`Ctrl+Shift+P` on
  Windows/Linux or `Cmd+Shift+P` on macOS) and run
  **AI Primitives Hub: Sync All Sources**

## Skill Update Detection

- **Remote skills (`anthropic/skills`)**: each skill version is derived from a content hash. If any file in the skill directory (including `assets/`, `references/`, etc.) changes, the Marketplace shows **Update** after you sync the source.
- **Local skills (`local-skills`)**: installations are symlinked to your filesystem. Running **Sync Source** updates the recorded version automatically—no manual update button—so the UI reflects the latest hash without touching the symlink.

> Tip: if a skill doesnt show the expected update, run **Sync Source** and check the logs for hash calculation warnings.

## Private Repositories

Authentication tries in order:
1. **VS Code GitHub Auth** — Check bottom-left for GitHub avatar
2. **GitHub CLI** — Run `gh auth login`
3. **Explicit Token** — Add when editing source (needs `repo` scope)

To verify access, open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or
`Cmd+Shift+P` on macOS) and run
**AI Primitives Hub: Validate Repository Access**.

## See Also

- [Profiles and Hubs](./profiles-and-hubs.md) — Organize bundles
- [Troubleshooting](./troubleshooting.md) — Authentication issues
