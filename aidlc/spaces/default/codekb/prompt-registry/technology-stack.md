# Technology Stack

| Technology | Observed version | Role |
| --- | --- | --- |
| Node.js | `>=24` | Workspace runtime requirement. |
| pnpm | `>=11`, lockfile reports `11.25.0` | Monorepo package manager and workspace orchestration. |
| TypeScript | `^5.9.3` | Shared packages and extension implementation. |
| VS Code Extension API | `^1.105.0` | Extension delivery API. |
| webpack | `^5.108.4` | Extension production bundle. |
| Clipanion | `4.0.0-rc.4` | CLI command delivery. |
| Vitest | `^4.1.10` | Shared package tests and V8 coverage. |
| Mocha | `^11.7.6` | Extension unit and integration tests. |
| Sinon, Nock, fast-check, c8 | Scan-reported versions not all enumerated | Extension isolation, HTTP mocking, property testing, and coverage. |
| `adm-zip` | `^0.6.0` | ZIP extraction in shared infra and legacy extension installer. |
| `js-yaml` | `^4.3.1`, root override `^4.1.1` | Manifest and layout parsing. |
| ESLint | 9 | Type-aware shared and extension linting. |
| Prettier | Configuration/script present | Extension formatting. |
| Docusaurus | `^3.10.2` | Documentation site. |
| React | `^19.0.0` | Documentation-site UI. |

## Platform Implications

- The shared target writer must retain byte-safe Node filesystem behavior and ZIP traversal protections.
- The extension adapter must respect VS Code activation and storage APIs without bringing them into `core` or `app` contracts.
- The CLI’s Clipanion surface should only translate command options to app inputs; it should not gain migration policy.
- Existing formatter, linter, test, security scanning, SBOM, and license tooling provide the baseline for quality claims and migration validation.