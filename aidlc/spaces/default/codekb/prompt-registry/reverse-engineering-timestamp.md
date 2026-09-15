# Reverse Engineering Timestamp

- **Intent**: `unified-installation`
- **Analysis date**: 2026-09-14
- **Repository root**: `.`
- **Scan mode**: Full rescan from the supplied no-store snapshot.
- **Supplied source fingerprint**: `git:e7aa9cc53af65dc73f1cf974baec0dbcc583d56a`
- **Observed checkout during developer scan**: `a5355d83389ac430a59f19062aecabe3da0a07f6`
- **Evidence source**: `inception/reverse-engineering/developer-scan.md`
- **Scope note**: The developer handoff reports a full repository rescan bounded by `./`; conclusions are based on the targeted files read and recorded there. Test suites were not executed as part of that scan.

## Scope of Analysis

```yaml
scope_version: 1
kind: full
intent: unified-installation
fingerprint: e7aa9cc53af65dc73f1cf974baec0dbcc583d56a
analyzed:
  paths:
    - ./
  components:
    - Core Manifest And Installation Domain
    - Application Installation And Migration Use Cases
    - Infrastructure Storage, Archive, Layout, And Writer Adapters
    - CLI Delivery Adapter
    - VS Code Extension Delivery And Compatibility Services
    - Extension Migration Registry And Bookkeeping
    - Collection Tooling And Publishing
    - Documentation And Secure Delivery Controls
shallow:
  paths:
    - packages/core/
    - packages/infra/
    - packages/app/
    - packages/cli/
    - apps/vscode-extension/src/
    - apps/vscode-extension/test/
    - lib/
    - github-actions/validate-collections/
    - website/
    - docs/
    - apps/vscode-extension/resources/
    - apps/vscode-extension/templates/
    - .aidlc/
```