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

- When a consuming unit's design needs shared-foundation behaviour the foundation's own design does not describe, record it as an explicit named delta in the consuming unit's spec and close it in the foundation repair at the stage decision. Do not silently build the consumer on top of the gap, and do not reopen contract design mid-construction. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:ff91c71f97cefb95fe6996ca09a880eb130c2e3be76647b1158b06ff6169ec63 -->

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

- The shared registry means one schema and one port with TWO adapters, not one shared file. The committed repository lockfile is the repository-scope serialization of the shared record; XDG application data is the user-scope serialization. Each adapter omits what its storage location already implies: the repository lockfile implies scope and repository identity from its path, while a user-scope record carries target explicitly because one user can install the same bundle to several targets. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:b666f7c263728603c94c30945b5d084e30c7e3a9f5a123c033ac765b9b00cc90 -->

- The cleanup journal is deliberately NOT lockfile-shaped. The registry describes steady state and outlives every operation; the journal describes one in-flight destructive operation and is deleted at commit. The journal cites records by reference (installation key, destination path, expected fingerprint) rather than copying inventories, which keeps one source of truth and avoids durable per-operation outcome state. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:220b7d9aa595060a18148cfb9e4539f61a596584ee8234b931ac93740c1967f8 -->

- Identity DERIVATION stays offline (normalized current remote URL, workspace-path fallback) so the shared foundation remains offline-capable for normal installs. Redirect RESOLUTION is a reconciliation-only step, reached when a stored record matches no open workspace, and is invoked through an injected port so the foundation acquires no direct network dependency. Normal lifecycle execution and reconciliation stay separate. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:d9126dc25da06c4b3d86cc447bcdb5ba0b944d5562da4821d91c15234192e636 -->

- When importing legacy installation records that lack an explicit target, never guess a default target. Resolve deterministically: a recorded target hint, else the single configured target whose scope layout actually contains the entry's managed files, else skip and report. Ambiguity is reported to the user, never resolved by convention. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:44ce24ef0f47c46fbdd9316a5fcb19e67ce36ac9e44675f2ada2727edf0f0902 -->

- A symlinked target reads byte-identical through the link, so a naive verified-duplicate check would delete the source and strand a broken symlink. A symlink-form target must always be MATERIALIZED (real files written through the shared lifecycle) before any source cleanup; only an identical COPY is a true verified duplicate. An absent source means leave the copy in place with no cleanup. (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:2702308ec2bf2decc60b6617409d1799b1a78e9f4b879cf2c8847e9313af8323 -->

- Commit mode is not a CLI special case. It lives on core's target definition and is already exposed by the extension, and the shared layout resolves repository-scope destinations. Commit mode therefore contributes nothing to destination resolution: it only selects which repository lockfile holds the record and maintains git exclusions (a no-op under commit mode). (learned 2026-09-25) <!-- cid:260914-unified-installation:functional-design:f40eafda76739207f405d024da23ae69e6d9b1fd64313d5aacb2a3b82abf4c7c -->

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

- When a shared boundary lets multiple owners write to the same destination, prevent cross-owner data loss with a registry-wide, target/scope-scoped ownership check that rejects conflicts unless an explicit hand-off is supplied, and make shared identity attributes (such as target and scope) explicit contract fields rather than opaque key contents. (learned 2026-09-23) <!-- cid:260914-unified-installation:contract-design:19e717cf980660451de12b4ed12acfe9cc84a526c4cc4b7062f37874ae16d685 -->

- Decompose large units into component-level, independently reviewable pull requests, and split destructive work into its own separately-gated pull request, accepting more PRs and coordination in exchange for small reviewable changes. (learned 2026-09-23) <!-- cid:260914-unified-installation:delivery-planning:60b78aa5fb55fe8cc6fbadb1116c1e2f5dbf978276620b425dce875217b3d9d7 -->

- After a backward jump, carry forward prior human-vetted sequencing and staffing decisions as the planning baseline, then re-plan only the boundaries affected by the upstream change. (learned 2026-09-23) <!-- cid:260914-unified-installation:delivery-planning:4089aead0ec79943ff0f2d7149df350bd5e247725876bf3bb08dbfcfd71f0898 -->

- Decompose large units into component-level, independently reviewable pull requests and isolate destructive work in its own separately-gated pull request when that yields safer review and recovery. (learned 2026-09-23) <!-- cid:260914-unified-installation:delivery-planning:41db5b05c8f512c215c5385cf2cac60b3fb61824f95dbc2e8b11032d47495f19 -->

- Route workspace scope through the repository-scope layout when a root path is present rather than inventing a third lifecycle routing rule. (learned 2026-09-23) <!-- cid:260914-unified-installation:functional-design:93a6d570feea87f0b348f9d9da99318022557c112be8a9c66289e2e5c66060c5 -->

- Keep the VS Code extension as a thin strangler-fig delivery adapter over the shared lifecycle and injected AppStorage boundary; do not retain cache-then-sync target writes. (learned 2026-09-23) <!-- cid:260914-unified-installation:functional-design:647a17510944f9396119f079c07a5d0ba5edfcb590df39a11f1e3b7d7eef5894 -->

- Keep migration outcome state-free: derive each activation result from current disk state, and persist only the in-flight destructive-cleanup journal required for safety. (learned 2026-09-23) <!-- cid:260914-unified-installation:functional-design:7a449b99836208e72ddcdf9e307e7d9b8a2b986cc7e321d1c46c0fc9ee194333 -->

- Mark the temporary activation-migration compatibility unit with @migration-cleanup(activation-migration) for wholesale removal once migration is universally complete. (learned 2026-09-23) <!-- cid:260914-unified-installation:functional-design:0315f7f834770f30f2fa58539960fe69d76323fc0fbf3f908265205c46055a73 -->

## Interpretations
- treated XDG storage as the shared application boundary; the CLI already separates cached bundles and durable installation records from target runtime output, so `~/.copilot` and `~/.kiro` remain target roots rather than registry roots. (learned 2026-09-14) <!-- cid:260914-unified-installation:feasibility:5ee78cf39a5074b9d0e001f216aa6bf476b96179757de5db684fcf199422755c -->
- Treat transparent migration as approved scope with a design gate: automatic legacy cleanup remains disabled until the completion state, interruption recovery, and duplicate comparison rules are defined and tested. (learned 2026-09-14) <!-- cid:260914-unified-installation:approval-handoff:29832c1008c1d57283820ae1912c204b0ab56f1f9edd783d0fe6de37f053e638 -->
