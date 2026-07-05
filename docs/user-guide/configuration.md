# Configuration

Access: `File → Preferences → Settings → Extensions → AI Primitives Hub`

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `promptregistry.installationScope` | Installation scope (`user`, `workspace`, `project`) | `user` |
| `promptregistry.enableLogging` | Enable debug logging | `true` |
| `promptregistry.autoCheckUpdates` | Auto-check updates on activation | `true` |
| `promptregistry.updateCheck.enabled` | Enable update checks | `true` |
| `promptregistry.updateCheck.frequency` | `daily`, `weekly`, `manual` | `daily` |
| `promptregistry.updateCheck.autoUpdate` | Auto-install updates | `false` |
| `promptregistry.updateCheck.cacheTTL` | Cache TTL (ms) | `300000` |

## Telemetry

Telemetry respects VS Code's built-in telemetry setting. To enable or disable it:

1. Open **File → Preferences → Settings** (or `Cmd+,` / `Ctrl+,`)
2. Search for `telemetry.telemetryLevel`
3. Choose a level:

| Level | Effect on AI Primitives Hub |
|-------|--------------------------|
| `all` | Telemetry events are collected |
| `error` | Only error events are collected |
| `crash` | Telemetry is disabled |
| `off` | Telemetry is disabled |

You can also set it in `settings.json`:

```json
{
  "telemetry.telemetryLevel": "all"
}
```

Enabling telemetry helps us understand how the extension is used so we can focus on the features that matter most.

### What is collected

When telemetry is enabled (`all`), the extension records anonymized usage events. No file contents and no raw text you type are ever sent.

| Event | What it captures |
|-------|------------------|
| Bundle install / uninstall / update | Bundle id, version, scope, and source type |
| Profile activate / deactivate / create / update / delete | Profile id and name |
| Source add / remove / update / sync | Source id and type |
| Marketplace search | The **length** of your query, the number of results, and whether any matched — never the search text itself |
| Installed inventory snapshot | Periodic count of installed bundles, broken down by scope (user / workspace / repository) and source type |

Install and search events include the VS Code session id, which lets us understand—at the session level, without identifying you—whether searching leads to installing.

## Export/Import Settings

- **Export**: Registry Explorer toolbar → Export button
- **Import**: Registry Explorer toolbar → Import button (merge or replace)

## Installation Paths

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Code/User/prompts` |
| Linux | `~/.config/Code/User/prompts` |
| Windows | `%APPDATA%/Code/User/prompts` |

## See Also

- [Settings Reference](../reference/settings.md) — Complete settings list
- [Troubleshooting](./troubleshooting.md) — Common issues
