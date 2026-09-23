# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Change Control

<!-- Project-specific. Mode: strict or relaxed. Strict here holds for every intent and cannot be changed from chat. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->

- Plan small, reviewable pull-request boundaries from requirements analysis onward. (learned 2026-09-14) <!-- cid:260914-unified-installation:requirements-analysis:4932876efbcd74ee95751370148e9082dde696701c95dc2fb9aa8a5e3f004eee -->

- Separate normal lifecycle execution from migration reconciliation to keep install, update, and uninstall behavior reusable while containing activation-specific comparison and conflict handling. (learned 2026-09-15) <!-- cid:260914-unified-installation:domain-design:8c2d4feb9e127f45ba30eb642e76c27bb44523ecd62cc9b51575d84d86ac5e77 -->

- Keep shared installation and migration policy in packages; CLI and VS Code remain delivery adapters. (learned 2026-09-15) <!-- cid:260914-unified-installation:domain-design:f36970facc3e64bc41b17e4fb2624cf745f5b85c133ee0ef9e8843f65aa831ae -->

- When user-stories are skipped for a scope, Units Generation traces by FR IDs and the `traceability` sensor reports an advisory pass:false because its story-map matcher only recognizes USx.y IDs; treat this as a known sensor/scope limitation, not an authoring defect, as long as every FR maps to a declared unit. (learned 2026-09-16) <!-- cid:260914-unified-installation:units-generation:be5c370e643523e934099a2db47e9110d32a9945c282547e608cde3b58cf8413 -->

- Decompose large units into component-level, independently reviewable pull requests, and split destructive work (such as migration file deletion) into its own separately-reviewed PR. (learned 2026-09-18) <!-- cid:260914-unified-installation:delivery-planning:c01965f37866bbd7bd57524f76136185d83ef30a6c2780ccf8ff8f86833f0b8d -->

- When `aidlc engine review-brief <verb>` fails through the managed launcher with "aidlc-review-brief.ts does not export main(argv)", run it as `bun .kiro/tools/aidlc.ts engine review-brief <verb> ...` instead; the tool does export main(argv) and the route is registered, so the defect is in the managed launcher layer, not the workflow or the tool. A permanent fix needs a framework release. (learned 2026-09-21) <!-- cid:260914-unified-installation:functional-design:de6539274d3af38b8e59b3985f4121c55d1da46ce22a1158004f14ca895ca9de -->

- In this repo the CLI `apply` and `profile activate` commands are multi-target profile activation (compose over the shared single-bundle lifecycle across every configured target), not single-bundle install; model them as composition that delegates each (bundle, target) write to the shared lifecycle, never as `install`. (learned 2026-09-21) <!-- cid:260914-unified-installation:functional-design:f2a587f5135bd2809ba4b62890016b548604af6845d20debda9d531a202896e8 -->

- When a unit's mandated responsibility (per Units Generation) has no corresponding operation in the governing contract, fix the contract at Contract Design rather than declaring the responsibility unimplementable in the downstream design. (learned 2026-09-23) <!-- cid:260914-unified-installation:contract-design:3847557c136f20cce7bfc9ad50c378d280313f70e9c32db2bf3755c4de909524 -->

- When a capability spans two units and one half needs an external capability (network, IO), ship the pure half as its own reviewable PR and inject the external half from the delivery adapter, so the core stays offline-testable. (learned 2026-09-23) <!-- cid:260914-unified-installation:delivery-planning:f6aff3fcada6aac2182e4023491658b4fe30b40fa5dedf8540260ed56cceaca8 -->

## Interpretations
- treated XDG storage as the shared application boundary; the CLI already separates cached bundles and durable installation records from target runtime output, so `~/.copilot` and `~/.kiro` remain target roots rather than registry roots. (learned 2026-09-14) <!-- cid:260914-unified-installation:feasibility:5ee78cf39a5074b9d0e001f216aa6bf476b96179757de5db684fcf199422755c -->
- Treat transparent migration as approved scope with a design gate: automatic legacy cleanup remains disabled until the completion state, interruption recovery, and duplicate comparison rules are defined and tested. (learned 2026-09-14) <!-- cid:260914-unified-installation:approval-handoff:29832c1008c1d57283820ae1912c204b0ab56f1f9edd783d0fe6de37f053e638 -->
