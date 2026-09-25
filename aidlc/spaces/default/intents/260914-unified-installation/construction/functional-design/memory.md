<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
- 2026-09-23T14:00:00Z — Aligned the functional workflow with Contract 3 hand-off ordering: U1 atomically detaches the ceding record before pending materialization, persists full recovery evidence, and alone restores or finalizes it. Added BR3.6 reverse traceability and the DestinationOwnershipClaim derived relationship so the design’s source and views agree.
- 2026-09-23T13:45:00Z — The final Contract 3 amendment resolves the claim-recovery gap by putting immutable journal identity, generation-bound evidence, durable destination claims, and rollback resolution inside U1. Migration stays a caller of those controls: a conflict preserves legacy content; it never gives U4 a direct target-write escape hatch.
- 2026-09-23T12:55:00Z — Reconciled U1 Functional Design with the approved Contract 3 amendments: token-gated transition verification, registry-wide target/scope destination ownership, and explicit managed-installation identity fields. The amendments preserve U1 as the enforcement boundary while U4 remains the cleanup-transaction coordinator.
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->


- 2026-09-21T08:54:58Z — Clarified for the human: shared registry means one schema and one port with TWO adapters, not one shared file. The lockfile remains repository-scope only (FR2.1 plus the explicit out-of-scope item forbidding lockfile migration into XDG storage); user-scope records stay in XDG data via AppStorage. Rationale is semantic, not incidental: a repository lockfile is a committed, reviewable project artifact while user-scope installs are personal and machine-local. Design precision to carry into entities.md: the shared record carries the full identity key (bundleId, target, scope, repositoryIdentity) and each adapter omits what its storage location already implies — the repository lockfile implies scope and repository identity from its path (which is why its commitMode field is already deprecated as implicit), while a user-scope record has no repository identity but must carry target explicitly, since one user can install the same bundle to several targets.
<!-- aidlc-wave-memory:shared-installation-foundation:66848e0a618788e9578dce24f5cb48895546e35bf35422eb09cd2c510cba8f1d -->


- 2026-09-21T08:54:58Z — Registry record vs cleanup journal, raised by the human at the confirmation checkpoint. The repository lockfile entry (version, sourceId, sourceType, installedAt, files[{path, checksum}]) is already structurally ManagedInstallation + ManagedArtifact, so the lockfile is the repository-scope serialization of the shared registry record, not a parallel format; the XDG installed-records path is the user-scope serialization. The journal is deliberately NOT lockfile-shaped: the registry describes steady state and outlives every operation, while the journal describes one in-flight destructive operation and is deleted at commit (Q2). Reuse is by reference — the journal cites installationKey, destinationPath and the expected fingerprint rather than copying inventories — which keeps one source of truth and avoids the durable migration outcome state FR3.4/FR3.5/NFR4 forbid. Journal stays migration-scoped (only NFR1.1 demands it, U4 is its only caller) but its contract is shaped so nothing is structurally migration-specific, leaving generalisation to ordinary uninstall as a later non-breaking move.
<!-- aidlc-wave-memory:shared-installation-foundation:0f55979d8e45002f2ad2cf943f3340d68193ace29343bddd1c2f146b2f2750d6 -->


- 2026-09-21T08:54:58Z — Q6 resolves against two inventories, not one: the governed manifest carries items[] (id, path, kind — no digest) and files[] (path, role, size, mandatory sha256). Per-entry integrity therefore binds an items[] entry to its corresponding files[] record, and role=installable is the routing filter, with metadata and ignored retained in the archive but never written. Q6's "hash verified when present" is stricter than it reads: an installable file always has one.
<!-- aidlc-wave-memory:shared-installation-foundation:0d2d9de412cf8b924d62933881633b469b1ebf053d96e1e5e761153c24bf0155 -->


- 2026-09-21T08:54:58Z — Target.scope is a three-value union (user, workspace, repository) while the requirements speak only of user and repository, and layout config defines only user and repository scopes. Specifying the entity model on the requirements' two scopes and routing workspace through the repository-scope layout when a root path is present, rather than inventing a third routing rule. Flagged to the human at the confirmation checkpoint.
<!-- aidlc-wave-memory:shared-installation-foundation:4ae5f69db56f41897d1743697ebec0e49136863e7913a38907b4218deea86fef -->


- 2026-09-21T08:54:58Z — Q7 chose network redirect resolution, but U1 must stay offline-capable for normal installs. Split the concern: identity DERIVATION is offline (normalized current remote URL, workspace-path fallback), and redirect RESOLUTION is a reconciliation-only step reached when a stored record matches no open workspace, invoked through an injected port so the shared foundation acquires no direct network dependency. Consistent with the existing project rule separating normal lifecycle execution from migration reconciliation.
<!-- aidlc-wave-memory:shared-installation-foundation:da0288830bc5afe7636473c26e1fc63bbf7f64bb0b4a0e8612cbd48f62111e3d -->


- 2026-09-21T08:54:58Z — Q1 (fingerprint written bytes) maps onto an existing seam rather than new machinery: file-tree-writer already derives the final byte sequence per write site (verbatim for binary and skill assets, TextEncoder-encoded post-transform for text) and hands it to verifyWrittenBytes. The managed fingerprint is computed over that same sequence, so verification and fingerprinting share one pass and the transformer's silent fail-safe fallback is captured accurately.
<!-- aidlc-wave-memory:shared-installation-foundation:407ef5352d60ee831e7f5e445cb00d93ef0062f7648aac8d01e08533c07b4910 -->


- 2026-09-21T14:12:00Z — Commit mode is not a CLI special case. The code shows commitMode already lives on core's target definition and the extension exposes it by name (`switchCommitMode`, "excluded via .git/info/exclude"), and default-layouts.json already resolves the Copilot-like targets' repository scope to the workspace `.github` tree. So the special-case RepositoryScopeWriter contributes nothing to destinations; it only (a) selects which repository lockfile holds the record by commit mode and (b) maintains git exclusions. Split accordingly: destinations via shared layout (done), lockfile selection into the shared repository registry adapter (amends U1's "each adapter's file does not move" rule), git exclusion into a small shared port that is a no-op under `commit`.
<!-- aidlc-wave-memory:cli-manifest-adoption:8324d7477ac90bc437543258cb1364899d878dbc22c7fc7fa1fb55d0890985d3 -->


- 2026-09-21T14:12:00Z — apply and profile activate are CLI composition, not single-bundle lifecycle. First draft wrongly said apply "resolves to install"; apply actually re-activates the active profile across every configured target via runProfileActivation. Framing that survived review: composition (which profile, which targets, hub sync, failure roll-up) stays in the adapter as permitted CLI-specific concern; every (bundle, target) write delegates to the shared single-bundle lifecycle. No new lifecycle rule needed beyond delegation + batch roll-up + commit mode.
<!-- aidlc-wave-memory:cli-manifest-adoption:6e0ffa28378973b3e901ddda0635d74096ac0c210292c44c4089286c6f6091dc -->


- 2026-09-21T14:48:00Z — U3 is the strangler-fig delivery adapter for the extension's install/update/uninstall. The three big migrations, all answered A: retire the extracted-files bundle cache entirely (no cache-then-sync); resolve shared data through the injected AppStorage port per ADR-0005 (not context.globalStorageUri); make the shared registry the single source of truth with the extension registry manager reduced to a thin read-only-projection delegator per ADR-0001. Existing extension records import once, like U2's CLI user lockfile.
<!-- aidlc-wave-memory:vscode-shared-lifecycle-adoption:bac70f7bb98710dd01d9b56216d8f9a02e819a3af75068b5c1bb37795eaaefb0 -->


- 2026-09-21T14:48:00Z — Conflict handling keeps decision in the shared layer and interaction in the adapter: shared lifecycle returns `conflict` writing nothing, extension prompts, re-invokes with an explicit overwriteDecision. Review (R-01) tightened this to reuse the SINGLE OverwriteDecision concept the migration path (U1→U4 contract, FR3.3) already defines, so the foundation repair grows one overwrite mechanism, not two parallel ones.
<!-- aidlc-wave-memory:vscode-shared-lifecycle-adoption:9d2b8bb0de48ddc265ef7762b949fe0e926928b4ad6d6b9caec8b8c1fc3b63cc -->


- 2026-09-21T15:18:00Z — U4 scope was narrowed sharply by the human: migrate only the CURRENT IDE the extension runs as (vscode/vscode-insiders/kiro), at USER scope, discovered from LIVE TARGET LINKS (symlink or copy) that resolve into the legacy cache — not from cache contents or records. The cache proves the source, never the install. Confirmed the extension actually symlinks skills into the target (bundle-installer symlink() with copy fallback), so the model is accurate.
<!-- aidlc-wave-memory:activation-migration-compatibility:13d0c1ba7231ecbf5de5f82cc95d00cc70fc224251e4c9aaf9485409087405c8 -->


- 2026-09-21T15:18:00Z — State-free is absolute (Q3=A): no MigrationRegistry per-installation flag, no durable outcome store. Each activation re-derives from disk; "done" = legacy source gone. U1's cleanup journal is the only persistence and only while a destructive op is in flight. Scheduling (Q7=A) is inline-before-command-handlers, non-fatal, no time-box — the common case is a no-op so it stays fast.
<!-- aidlc-wave-memory:activation-migration-compatibility:e37c34c639f9c0e810c299bfab3388ab7983fe14db6b466eebdc8190b5d55191 -->


- 2026-09-24T10:05:00Z — Applied the iteration-3 fixes at the human's direction knowing no review budget remained to verify them: completed R-03 (the two present-tense commit-mode claims in entities.md are now conditional), added the `(gap 1, open)` / `(gap 2, open)` marker convention so uninstall step 3, the whole init workflow, status steps 2-3, and the `success` result row no longer read as buildable (R-15), and narrowed gap 2 to the preserved-artifact payload only (R-16) — `queryDestinationOwnership` is declared in Contract 1 and supplies the conflict destination path and owning identity, so `CliConflictDetail` now sources them there and types the owner as `ManagedInstallationIdentity`. These edits are unverified by any reviewer; the unit settles on an invalidated receipt and every finding rides to the stage gate.
<!-- aidlc-wave-memory:cli-manifest-adoption:8fcc084c5142599c44d2399603986d5770ed1c8d278d2af196838e761eb491ad -->


- 2026-09-23T18:05:00Z — Second review exhausted the adversarial budget with three findings needing a shared surface the contract does not declare: no adapter-facing registry read/write (so uninstall's identity lookup, init's lockfile write, and status's record read are unimplementable), no payload on the result union (so conflict and preserved-file reporting has nothing to read), and profile's record access unspecified. At the human's direction these are recorded as carried-forward gaps rather than reopening Contract Design; only the unit's self-inconsistencies were repaired. The Boundary paragraph stays binding, so the three workflows are explicitly marked not implementable until the gaps close.
<!-- aidlc-wave-memory:cli-manifest-adoption:10fdc4cd09feae0cd3ecfa89ae3db386b17abd15683bfd36226150884837c308 -->


- 2026-09-23T15:40:00Z — Re-aligned U2 with the amended shared foundation: its recorded source-resolution delta is closed by U1 owning resolution/download/validation, legacy import now maps onto explicit target and scope identity, and every CLI-triggered write observes U1's durable destination-ownership claim. U2 reports a per-bundle conflict outcome instead of gaining any target-write or claim-recovery path.
<!-- aidlc-wave-memory:cli-manifest-adoption:31c64457cac325c74a82e766e2fa0ab0fad085bc555a9a839a0fe0c0542340c7 -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->


- 2026-09-21T13:52:50Z — The adversarial design review ran inline in the conductor's context instead of as a delegated reviewer sub-agent, with the human's explicit approval. Two delegated dispatches of `aidlc-architecture-reviewer-agent` returned having read nothing: the subagent was launched with only `disclose_context`, `report_progress`, `user_input` and `subagent_response`, even though its agent JSON declares `read_file`, `grep_search`, `execute_bash`, `fs_write` and the rest. The first dispatch spent its `--retry-pending` allowance and closed as an incomplete-attempt NOT-READY; iteration 2 was reviewed inline and recorded NOT-READY on twelve findings. The independence guarantee is weaker for this stage than the protocol intends, and the review record says so in a `### Review conduct` subsection; a properly-tooled session should treat those findings as a self-check rather than a second pair of eyes.
<!-- aidlc-wave-memory:shared-installation-foundation:7d493729ed858aaba9fe4c2ffbea6e7dcdc4c3f69acb02c0ba5af44b674f34c8 -->


- 2026-09-21T13:52:50Z — `aidlc engine review-brief <verb>` fails through the managed native launcher with "aidlc-review-brief.ts does not export main(argv)" although `.kiro/tools/aidlc-review-brief.ts` does export `main(argv: string[])` and the route is registered in `.kiro/tools/aidlc.ts`. The same command succeeds as `bun .kiro/tools/aidlc.ts engine review-brief …`, so the defect is in the launcher layer, not the workflow or the tool. Used the bun route for this stage's review context; a permanent fix needs a framework release, not a workspace edit.
<!-- aidlc-wave-memory:shared-installation-foundation:2ec8f4e16d9ac139d7735b20ad15aadf4563aa2b1ddaa6e3017a2fd656e27e66 -->


- 2026-09-21T14:12:00Z — Two U2 decisions depend on shared-foundation behaviour the U1 functional design does not yet describe, and are recorded as explicit deltas in U2's functional-spec rather than resolved here: (1) source resolution/download on the shared install request (Q4), and (2) commit-mode-aware repository registry + git-exclude port (Q1/Q7). This keeps U2 from being built silently on top of U1's known-broken result vocabulary; both deltas must close in the U1 repair at the stage decision.
<!-- aidlc-wave-memory:cli-manifest-adoption:f7bc11e485c2aa4973fbbece05d9b8eafa243f6bcfefc704c9e25d7e7504ddef -->


- 2026-09-21T14:48:00Z — Two shared-foundation deltas recorded rather than resolved here (same discipline as U2): (delta A) normal install/update must detect pre-existing target content, return `conflict` writing nothing, and accept the shared OverwriteDecision — U1's install workflow does not; (delta B) source resolution/download on the shared request — same delta U2 recorded. Both must close in the U1 repair at the stage decision.
<!-- aidlc-wave-memory:vscode-shared-lifecycle-adoption:5c8394afce9f10db1efe5e3e104bfb77bda88b893e29a241262c289543cbb0c2 -->


- 2026-09-21T15:18:00Z — TWO human-confirmed requirement deviations, recorded in functional-spec "Requirement deviations" and traceability, to raise at the stage gate: (FR3.7) repository-scope migration DROPPED — repo installs are carried by the committed lockfile, never migrated from the cache (Q8=A); (FR3.8) versioned association table REINTERPRETED as "current IDE + user scope + live target link" (Q9=A). BR2.2 embodies the FR3.7 exclusion and sits in traceability reverse; FR3.7 row is N/A with reason.
<!-- aidlc-wave-memory:activation-migration-compatibility:873947f992e540e3e6199fc178252301b1cc2e200a04e486f5c6701192115a63 -->


- 2026-09-21T15:18:00Z — Whole unit tagged @migration-cleanup(activation-migration) for wholesale removal once migration is universally complete (Q6=B), unlike U1's finer-grained tagging intent.
<!-- aidlc-wave-memory:activation-migration-compatibility:453f2a9aa65949ce7decc6e403594111bdf00e9aca2320eb083f846ef40c8b33 -->


- 2026-09-22T14:11:12Z — The revision that resolved R-01 through R-12 reached its approval gate without an independent second look. Both review passes of this attempt (`3c0fc53f9e11caf4`) closed as incomplete-attempt NOT-READY fallbacks rather than real verdicts: iteration 1 spent its `--retry-pending` allowance and was recorded as the bounded fallback at 08:53:13Z, and iteration 2 was requested at 08:53:21Z, spent its retry at 09:26:18Z, and the session ended before any dispatch returned a review file. On resume the retry was correctly refused as already spent, so iteration 2 was closed with the bounded fallback and the adversarial budget (`reviewer_max_iterations: 2`) is exhausted. The revised artifact bytes are unchanged since the request fingerprint `sha256:c2764e2f…`, so the receipt is current and not stale — what is missing is review substance, not receipt validity. A Request Changes at the gate is the only route that restores a fresh review budget for these bytes.
<!-- aidlc-wave-memory:shared-installation-foundation:d4fff85d042c1d7aa9ec92ea18af29bf677a57a11313996da2c9157d06c9fc9e -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->


- 2026-09-21T14:12:00Z — Legacy user-lockfile import (Q2 = import once): the old CLI user lockfile is keyed by bundleId with no target, but the shared key needs a target. Chose deterministic association (BR3.4): use a recorded target hint, else the single configured target whose user-scope layout contains the entry's managed files, else skip-and-report — mirroring U4's migration association discipline rather than guessing a default target.
<!-- aidlc-wave-memory:cli-manifest-adoption:a643e2eda6687deb566a2c5814fdb24a5e09493f231db06bd6cfeedc310312cd -->


- 2026-09-21T14:48:00Z — Legacy extension-record import (Q3=A): the extension's InstalledBundle carries no explicit target (implied by installPath) and no repository identity, so the shared key can't be built directly. Review (R-02) added BR3.5 mirroring U2's BR3.4 — resolve target from hint/installPath else the single configured target whose layout holds the files, resolve repo identity from the record's workspace, skip-and-report ambiguity rather than guess.
<!-- aidlc-wave-memory:vscode-shared-lifecycle-adoption:5da6060b5ac4c6a858667c977da9741c6161fb8738338f106b2773cc6df52650 -->


- 2026-09-21T15:18:00Z — Review (R-01, Critical) caught that a symlinked target reads byte-identical through the link, so the naive verified-duplicate path would delete the cache and strand a broken symlink. Fixed with BR1.3: a symlink target is always MATERIALIZED via U1 (real files written) before cache+symlink cleanup; only an identical COPY is a true verified duplicate. Copy-form legacySourceRoot located by bundle id against the cache layout, absent → leave copy in place with no cleanup.
<!-- aidlc-wave-memory:activation-migration-compatibility:ea1e140b1b745a7465f371e993826874a67373a0d2e09727f359182254b602d8 -->


- 2026-09-21T15:18:00Z — Shares U3's delta A: depends on the single shared OverwriteDecision (confirmed|declined|unavailable), not a migration-only overwrite mechanism (BR4.3). To close in the U1 repair at the stage decision.
<!-- aidlc-wave-memory:activation-migration-compatibility:2bc29b5709fdce17c67d689ca4fb7fb50bca042a17a01d59a66acdef4b475ac1 -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
