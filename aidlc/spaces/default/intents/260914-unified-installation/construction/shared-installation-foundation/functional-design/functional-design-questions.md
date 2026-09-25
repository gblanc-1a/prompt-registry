# Functional Design Questions — Shared installation foundation (U1)

These questions close the gaps that Requirements Analysis, Domain Design, and
Contract Design deliberately left to this stage. Everything already decided
upstream is not re-asked.

## Q1. What exactly does the managed-artifact fingerprint cover?

The shared installation record keeps a fingerprint per managed artifact
(`ManagedArtifact.installedHash` in the component catalogue). Update and
uninstall use it to tell "this file is still the one we installed" from "the
user edited this file locally" — the rule that an omitted artifact is removed
only when its current bytes still match what was recorded (FR1.3), and that
uninstall removes only still-managed content.

Bundle content can be transformed between the archive and the target, so the
archive bytes and the written bytes are not always the same sequence.

- A. Fingerprint the bytes as written to the target, after any transform. Comparison re-reads the target file and hashes it the same way.
- B. Fingerprint the archive bytes as declared in the manifest inventory, and compare by re-deriving the transform at update time.
- C. Record both: the archive-side fingerprint for governance and the written-byte fingerprint for local-change detection.
- X. Other (please specify)

[Answer]: A

## Q2. How fine-grained is the cleanup journal, and when does a finished entry go away?

U1 owns the journal contract that makes destructive cleanup restart-safe, with
the states the catalogue names: prepared, target-verified,
legacy-delete-pending, committed. U4 drives it. The journal records safety
progress only — it is explicitly not a durable record of migration outcomes.

Granularity decides what a crash mid-cleanup can resume from, and retention
decides whether a committed entry lingers.

- A. One journal entry per installation, listing per-artifact deletion progress inside it. A committed entry is deleted as the final step of the same operation.
- B. One journal entry per installation, with per-artifact progress, and a committed entry is retained until the next activation's journal sweep removes it.
- C. One journal entry per artifact, each independently resumable, each removed on its own commit.
- X. Other (please specify)

[Answer]: A

## Q3. How is repository identity derived for keying repository-scope records?

The installation record isolates state by bundle, target, scope, and
repository identity (FR2.2), and migration can only adopt a legacy
repository-scope installation when that identity matches exactly one open
workspace folder (FR3.7). So the identity value has to be derivable both at
normal install time and from a legacy record.

- A. The repository's canonical remote URL, normalized; fall back to the absolute workspace root path when no remote exists.
- B. The absolute workspace root path only.
- C. A stable hash over the normalized remote URL when present, else over the workspace root path, stored as an opaque identifier.
- X. Other (please specify)

[Answer]: A. The repository's canonical remote URL, normalized; fall back to the absolute workspace root path when no remote exists. - be careful of repository rename we should follow redirection

## Q4. When an update preserves a locally changed file, what does the caller get back?

FR1.3 says an update whose newer manifest omits a previously managed artifact
must preserve that artifact when its bytes differ, report it, and drop it from
the managed set so a later uninstall leaves it alone. The shared result type
has both a `success` kind and a `preserved-content` kind.

The question is whether preservation makes the whole update a non-success.

- A. The update returns `success` and carries a list of preserved artifacts alongside it; `preserved-content` is reserved for an operation that could not proceed.
- B. The update returns `preserved-content` whenever anything was preserved, with the applied changes described inside that result.
- C. The update returns `success` only when nothing was preserved; any preservation returns `preserved-content`.
- X. Other (please specify)

[Answer]: A. The update returns `success` and carries a list of preserved artifacts alongside it; `preserved-content` is reserved for an operation that could not proceed.

## Q5. What must be verified before an operation reports success?

The safety requirement (NFR1) is that binary-safe writes are read back and
verified before installation success is reported. The symmetric question for
removal is whether uninstall proves absence.

- A. Verify every written artifact by re-reading it, and verify every removal by confirming the path is gone.
- B. Verify every written artifact by re-reading it; treat a removal as done when the filesystem call succeeds.
- C. Verify writes and removals, and additionally verify that the installation record matches the on-disk artifact set before reporting success.
- X. Other (please specify)

[Answer]: A. Verify every written artifact by re-reading it, and verify every removal by confirming the path is gone.

## Q6. What makes a manifest inventory entry valid enough to install?

The shared lifecycle installs the governed `items[]` inventory as the canonical
representation (FR1.2), and validation must reject a bad bundle before any
target file is written (FR1.1). The catalogue gives each entry an archive path,
a kind, and a content hash.

The open point is how strict the entry-level contract is, particularly whether
a per-item hash is mandatory.

- A. Archive path and kind are required; a per-item hash is verified when present and its absence is accepted.
- B. Archive path, kind, and a per-item hash are all required; a missing hash rejects the bundle.
- C. Archive path and kind are required, and a missing per-item hash is accepted only when the archive itself carries an integrity check that covers the entry.
- X. Other (please specify)

[Answer]: A. Archive path and kind are required; a per-item hash is verified when present and its absence is accepted.

## Q7. Follow-up to Q3 — how is a renamed repository recognised as the same repository?

You chose the normalized canonical remote URL as the repository identity, with
the workspace root path as the fallback, and added that a repository rename
should follow redirection.

That needs one more decision, because a rename changes the normalized URL and
therefore changes the key. Records written under the old URL stop matching the
workspace, which would break scope isolation (FR2.2) and leave
repository-scope migration unable to associate a legacy record with its
workspace (FR3.7).

The constraint to weigh: repository identity must be derivable when a bundle is
installed, including with no network, and activation-time migration is expected
to stay bounded rather than block on remote calls.

- A. Local only. Identity stays the normalized current remote URL. When a stored record matches no open workspace, compare it against the URLs that workspace's git configuration has previously used and re-key the record to the current URL on a match. No network call.
- B. Resolve the redirect over the network when a stored record matches no open workspace, confirm the old URL now points at the current one, then re-key. Skip the check and leave the record untouched when offline.
- C. Keep an alias list on each record: the current normalized URL plus every previously seen URL for that repository. Match on any alias, and append the new URL on a rename. No network call.
- X. Other (please specify)

[Answer]: B. Resolve the redirect over the network when a stored record matches no open workspace, confirm the old URL now points at the current one, then re-key. Skip the check and leave the record untouched when offline.

## Consolidated Summary Confirmation

These are the decisions I will build the U1 design artifacts from.

1. **Managed-artifact fingerprint (Q1)** — fingerprint the bytes as written to
   the target, after any transform; comparison re-reads the target file and
   hashes it the same way. This supersedes the archive-side checksum currently
   recorded in the repository lockfile, which makes every transformed file look
   permanently user-modified.
2. **Cleanup journal (Q2)** — one journal entry per installation, carrying
   per-artifact deletion progress inside it, through the states prepared →
   target-verified → legacy-delete-pending → committed. The committed entry is
   deleted as the final step of the same operation, so no finished entry
   lingers and the journal never becomes outcome state.
3. **Repository identity (Q3)** — the repository's canonical remote URL,
   normalized, falling back to the absolute workspace root path when no remote
   exists.
4. **Renamed repository (Q7)** — when a stored record matches no open
   workspace, resolve the redirect over the network, confirm the old URL now
   points at the current one, then re-key the record. When offline, skip the
   check and leave the record untouched. Derived boundary: identity derivation
   stays offline and redirect resolution is a reconciliation-only step reached
   through an injected port, so the shared foundation takes on no direct
   network dependency.
5. **Update result when content is preserved (Q4)** — the update returns
   `success` and carries the list of preserved artifacts alongside it; the
   preserved artifact is dropped from the managed set so a later uninstall
   leaves it alone. `preserved-content` is reserved for an operation that could
   not proceed.
6. **Verification before success (Q5)** — every written artifact is verified by
   re-reading it, and every removal is verified by confirming the path is gone.
   This closes the current uninstall path, which reclassifies a failed removal
   as merely skipped and never confirms absence.
7. **Manifest entry validity (Q6)** — archive path and kind are required; a
   per-item hash is verified when present and its absence is accepted.

The seven decisions above are unchanged and still authoritative. Two defects
found in the last review of this unit are being fixed in this pass, and one of
them required an upstream change that has now landed:

8. **The journal and the redirect reconciliation are now callable (closes
   review finding R-01).** The previous pass had to declare both
   unimplementable: the unit definition mandates that U1 own the
   `MigrationCleanupJournal`, and decision 4 above requires redirect
   reconciliation, but Contract 3 declared no operation for either. Contract
   Design has been re-entered and amended, so Contract 3 now declares
   `MigrationCleanupJournalPort` (`openCleanupJournalEntry`,
   `recordCleanupTransition`, `readCleanupJournalEntry`,
   `closeCleanupJournalEntry`) plus the injected `RepositoryRedirectPort`
   (`resolveRedirect`) and U1's own `reconcileRepositoryIdentity`. This design
   will therefore express both as real U1 workflows instead of deferred
   constraints, and the rules that recorded the deferral (BR6.1, BR6.2) are
   rewritten to state the implementable behaviour: re-key only on a single
   confirmed redirect against a caller-supplied candidate list, and skip on zero
   candidates, multiple confirmations, or an unavailable port. FR3.7's
   skip-when-no-workspace-matches rule stays authoritative for legacy migration
   candidates.
9. **The migration transfer step will call a real inner primitive (closes
   review finding R-06).** The previous spec's migration transfer step 4
   directed `transferThroughLifecycle` to call `transferThroughLifecycle` with
   the same request — a self-call with no terminating condition, which no
   implementer can build. This pass replaces it with a named internal
   install-lifecycle primitive that performs the governed write, read-back
   verification, and registry update (the same sequence install steps 6 and 7
   already define, through the declared `InstallationLifecyclePort`), and maps
   its `LifecycleOutcome` to a `MigrationTransferOutcome` member at the
   boundary. No undeclared Contract 3 operation is exposed.
10. **The cleanup transition is generation-bound (closes review finding R-01).**
    `verifyManagedArtifacts` mints a `VerificationResultToken` bound to the
    immutable journal `entryId`, its exact live `generation`, the complete
    artifact/fingerprint set, and the observed read. U1 accepts the token for
    one matching `prepared -> target-verified` attempt only, re-reads the full
    set before transition, and rejects stale, closed-entry, wrong-generation, or
    mismatched evidence without granting deletion authority.
11. **Managed destination ownership is durable and atomic (closes review
    finding R-02).** U1 owns a `DestinationOwnershipClaim` keyed by target,
    scope, and destination. One transaction validates or transfers the claim,
    records pending materialization, and blocks competitors; only read-back
    verification finalizes ownership. Failed or interrupted work enters a
    U1-owned recovery state rather than leaving an adapter to invent recovery.
12. **Installation identity exposes target and scope (closes review finding
    R-03).** `ManagedInstallation` stores `target` and `scope` as required,
    typed identity attributes; the installation key derives from those fields
    rather than requiring adapters to reverse-engineer opaque key contents.
13. **Migration transfer has claim parity.** `MigrationTransferRequest` carries
    an optional `DestinationOwnershipHandoff` and always uses the same U1 claim
    protocol as normal install and update. Without a valid hand-off, it returns
    `preserved-conflict`, writes no competing destination, and preserves legacy
    content for U4 to report.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
