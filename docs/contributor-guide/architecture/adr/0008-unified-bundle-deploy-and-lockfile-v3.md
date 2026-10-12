# ADR-0008: Unified Bundle Deploy and Lockfile 3.0.0

**Status:** Accepted. Expected to be superseded in part by the decision slice 3
takes on renaming the committed repository lockfile (see [Consequences](#consequences)).

**Source-identity amendment (2026-10-10):** conversationally agreed; revised written
specification approved on 2026-10-12. The amended decision below is the target contract,
not a claim that the branch implementation already writes it.

## Context

The bundle lifecycle has two independent implementations, one in `packages/cli`
and one in `apps/vscode-extension`. They disagree on where files go, what
records an install, how a bundle is named and fetched, and whether MCP servers
are installed at all. The divergences are enumerated in §1.1 of the
[design](../../../superpowers/specs/2026-10-09-unify-bundle-lifecycle-design.md).
ADR-0001 already committed to one shared domain; for persisted state and file
placement that commitment is not yet met.

Replacing both implementations in one change is not an option: `main` must stay
releasable and existing installs and committed repository lockfiles must keep
working. Incremental delivery behind a switch is therefore a requirement of the
decision, not a preference.

The existing lockfile also cannot carry the new model. Schema `2.0.0` mixes
what a user wants (desired state) with what one machine did (materialization),
stamps `generatedAt` and `installedAt` into a file that is meant to be shared,
and, before this slice, was read by code that cast the parsed JSON without
checking its version.

## Decision

1. **One shared deploy module.** Placement, validation, recording and removal
   live in `packages/app/src/deploy/` (`planDeploy`, `deployBundle`,
   `undeployBundle`) behind ports from `core`. Delivery layers wire ports and
   format output; they do not own lifecycle rules. The pipeline is
   extract → validate → place → record, followed by MCP and git-exclude steps
   that later slices add after the record is written.

2. **Lockfile schema `3.0.0`, split by role into two files at every scope.**
   Desired state (`bundles`, `sources`, `hubs`, `profiles`) and materialization
   (`targets`, with per-file `checksum` and `installedChecksum`) are separate
   files. User and repository scope use the same two shapes and differ only in
   where the files are rooted. At user scope they live under the XDG config
   root (ADR-0005) as `ai-primitives-hub.lock.json` and
   `ai-primitives-hub.local.lock.json`. The schema is
   `packages/core/src/public/schemas/lockfile-v3.schema.json`; the existing
   `lockfile.schema.json` keeps validating `2.x` files.

3. **One portable logical bundle key: `{sourceKey}/{logicalBundleId}`.** It is
   version-independent, source-qualified, and identical in both files. `sourceKey`
   is a deterministic encoding of adapter-specific structured identity, never a
   local registry `sourceId` or hub declaration ID. For GitHub releases, source
   identity is provider origin + provider repository ID + adapter, and the
   logical bundle ID is the manifest ID. For Artifactory, source identity is
   its normalized root + effective index path + adapter, and the logical ID
   is its catalog bundle ID. Tree/local selectors are adapter-specific.
   Full normalization, binding and collision rules live in design §§5.10–5.13.

4. **A dual-surfaced `unifiedDeploy` flag, default off, with a read-time
   version gate.** The CLI surface is the `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`
   environment variable. The extension surface, the setting
   `promptregistry.unifiedDeploy`, is wired in a later slice and is not live
   yet. Every lockfile reader classifies the file's schema version before
   interpreting its structures: a known major is read, an unknown or newer
   major fails loudly with an actionable message and nothing is written, and no
   writer re-stamps a version it did not understand. Flag-off code can
   therefore never misread or clobber flag-on state.

5. **Separate logical identity from exact artifact resolution.** Desired entries and
   materializations carry adapter-specific resolutions: GitHub release ID/asset
   ID/archive digest; tree commit/selector/content digest; Artifactory published
   manifest/archive paths, sizes and digests; or a local snapshot content digest.
   Legacy unpinned and intentionally live content remain explicit states.
   Missing objects and integrity mismatches never select latest or another channel.
   Reconcile compares resolution as well as source/logical identity and version,
   without introducing a layout/configuration fingerprint.

6. **Preserve record-based, offline-capable migration and cleanup.** Convert source
   and logical identity only where evidence proves it. Preserve unknown desired
   intent as unresolved evidence and installed ownership as unmanaged records;
   do not fabricate provider IDs or historical pins. Uninstall and local-state
   status/doctor do not require provider metadata. Keep the existing lazy
   repository triggers and local-first resumable pair ordering.

## Alternatives considered

- **A single merged file at user scope.** The argument was that a machine-local
  file gains nothing from the split. Rejected: it saves one file at the price
  of two code paths, two migration shapes and two test sets for the whole
  cutover, and it would leave the desired-state file byte-comparable only in a
  repository, which weakens the determinism promise of §8.1 of the design for
  no benefit. §5.1 of the design originally kept one merged file at user scope;
  this ADR amends it, and the design on disk already reflects that.
- **Splitting by commit mode** (three files, with materialized records kept in
  the committed file). Rejected: it keeps cross-user merge hazards (path
  separators, timestamp churn, shared-destination ownership) permanently live,
  where a split by role removes the class of problem.
- **A temporary filename for flagged state.** Rejected: it would need its own
  migration later, which is a second rename.
- **A dual-format writer that keeps reading and writing `2.x` beside `3.0.0`.**
  Rejected: the version gate buys the same safety in a few lines. The one-way
  migration of a `2.x` user lockfile on the first flagged write is not a
  second format to maintain.
- **Copy hub declaration IDs into shared keys:** rejected because they are scoped
  aliases, are not globally unique, and do not exist for direct installs.
- **Use raw URLs as the sole identity:** rejected for provider-backed repositories
  because a rename changes the locator and different adapters/refs/content selectors
  can expose different sources. Artifactory currently has no durable catalog ID,
  so its root/index identity remains locator-based and root moves require explicit
  remapping, not unverified redirect-based equivalence.

## Consequences

- **Negative:** both code paths coexist for the length of the cutover. That is
  double maintenance and a doubled test matrix for every flagged surface, an
  accepted cost of incremental delivery.
- **Positive:** a mixed-version read becomes a loud failure instead of silent
  corruption. Once a flagged command has written `3.0.0` state, commands that
  still read the legacy format (`status`, `update`, and `install` or
  `uninstall` without the flag) refuse to run rather than guess.
- **Negative:** a two-file write is not one filesystem transaction. The write
  order is fixed (local first, then desired, completion marker last) and every
  intermediate state is legal and resumable, so the ordering and resume rules
  of §8.4 of the design apply at user scope too.
- **Negative:** deploys are not transactional (§9.2). A failure after an
  existing file was overwritten can leave mixed content, and bytes that were
  overwritten are not restored. Only files the failed call created are removed.
  Re-running the identical request converges when the files already equal what
  would be written, including skill, plugin and power subtree files and upgrades
  whose recorded checksums still describe the older version. Satisfied bytes
  take precedence over drift because no overwrite is needed. Other tracked
  differences remain protected; differing untracked files remain collisions.
  Structured failures report the stage, written/created/removed paths and cleanup
  outcomes. A failed desired-file write after a successful local write leaves a
  recoverable local record.
- **Positive:** directory ownership is per file, not per directory. Uninstall
  preserves destinations another record still holds. Redeploy refuses a changed
  target root, retires unchanged old-only files after state commits, and retains
  modified old-only files with their records and reports them. Symbolic links
  below the configured placement root are refused; replacement/adoption remains
  a later slice.
- **Negative, slice 1 only:** new remote installs do not persist `archiveSha` yet
  (existing verified pins survive same-key, same-version redeploy);
  the replay loop of `install --lockfile` and the `--all` loop of `uninstall`
  live in `packages/cli` and move toward `app` later; flagged
  `uninstall --lockfile` and bare `uninstall` are refused until repository
  scope arrives; and `vscode` is the only verified target.
- **Source-identity amendment, not yet implemented:** the branch-era slice-1
  `sourceId`/`archiveSha` shape must be replaced before further supported v3 writers
  ship. V3 has not been released, so its schema can be amended in place; old
  branch shapes are migration inputs, not valid payloads for the amended writer.
  Identity contracts/recording can no longer wait until slice 9.
- **Positive:** local names and hub membership no longer determine shared identity.
  A GitHub rename with a verified matching repository ID preserves logical keys.
  Artifactory remains an explicit channel compatible with
  [AmadeusITGroup/ai-primitives-hub#437](https://github.com/AmadeusITGroup/ai-primitives-hub/pull/437);
  upstream provenance never authorizes runtime GitHub fallback or channel merging.
- **Negative:** unresolved migration evidence and resolution variants enlarge the
  wire contract. This retains existing intent/ownership without adding a journal,
  a second desired-state layer, remote migration prerequisites or rollback.
- **Unchanged until slice 3:** the repository lockfile keeps its
  `prompt-registry.lock.json` / `prompt-registry.local.lock.json` names and the
  `2.0.0` schema, so [ADR-0004](./0004-cli-only-rebrand-keep-lockfile-and-extension-identity-stable.md)
  stays in force for repository scope. The decision slice 3 takes on the rename
  of the committed file will supersede ADR-0004 in that respect.

## Implementation implications

1. Slice 1 delivers the CLI user-scope path only: `install` and `uninstall`
   behind `AI_PRIMITIVES_HUB_UNIFIED_DEPLOY`, repository scope refused with
   `BUNDLE.UNSUPPORTED_SCOPE`. See
   [Installation Flow](../installation-flow.md#unified-deploy-user-scope-behind-a-flag).
2. New domain or use-case rules belong in `packages/app/src/deploy/` and
   `packages/core`, not in a command or service; the CLI wires
   `buildDeployPorts` and formats results.
3. A reader of a lockfile must call the version classifier before using the
   parsed structure. A writer must never change the `version` of a file it did
   not produce.
4. Revisit this decision if the two-file write needs real atomicity, or if the
   committed-file rename in slice 3 changes the filenames named here.
5. Core defines portable identity, normalization and resolution contracts; infra
   acquires provider metadata and verifies source/artifact identity; app carries
   the resolved result into deploy. Delivery layers keep local source configuration
   and credential UX, but do not duplicate identity rules.
6. Amend the existing lifecycle spec and its requirements together. Preserve APM
   retirement, explicit reconcile, offline verification and per-record migration;
   test portable identity and pins through each supported production entry point.
