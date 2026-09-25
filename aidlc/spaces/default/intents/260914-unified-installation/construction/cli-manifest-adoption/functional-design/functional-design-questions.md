# Functional Design Questions — CLI manifest adoption (U2)

U2 is a delivery adapter: it translates CLI arguments into the shared
lifecycle's request types and translates typed results into CLI output and exit
behaviour. It owns no target-write path and no lifecycle policy.

That leaves exactly one class of open decision for this stage: where today's
CLI behaviour and the shared lifecycle disagree, and which side gives way. The
requirement that architecture design must document the compatibility policy,
the affected workflows, and the rationale before implementation relies on an
incompatibility (FR4) is still an open question in Requirements Analysis, and
these questions close it against the code as it stands. Nothing already decided
upstream, and nothing answered for the shared foundation, is re-asked.

## Q1. The CLI has a special repository-scope writer for Copilot-like targets. Does it survive?

Today `install` picks its writer by scope and target type: for repository scope
with a Copilot-like target (`vscode`, `vscode-insiders`, `copilot-cli`) it uses
a dedicated repository writer that writes the `.github/` tree, honours a
`--commit-mode` flag, and can add entries to `.git/info/exclude`. Every other
target goes through the data-driven writer and its layout.

The shared lifecycle's routing rule is that a destination is resolved from the
selected target, the scope, and the item kind alone, with no special case and
no hardcoded runtime root. So this writer cannot move into the shared
lifecycle as it stands — either its behaviour becomes ordinary layout data, or
the CLI loses it.

- A. Express the `.github/` tree as the Copilot targets' repository-scope layout data, so the shared routing rule produces the same destinations and the special-case writer disappears. `--commit-mode` and the `.git/info/exclude` behaviour are dropped as a documented breaking change.
- B. Same layout move as A, but keep `--commit-mode` and the `.git/info/exclude` behaviour as CLI-side post-install steps that run after the shared lifecycle has written and verified the files.
- C. Keep the special-case writer in the CLI for Copilot-like repository installs and route only the other targets through the shared lifecycle, accepting that two write paths survive for now.
- X. Other (please specify)

[Answer]: X Can't we have the commit-mode part of the target definition or do you have a proposal to put this logic in common as part of the shared workflow as we have this type of installation also in the vscode extension ?

## Q2. What happens to the CLI's separate user-scope lockfile?

The CLI currently records user-scope installs in its own lockfile under the
user config root (`ai-primitives-hub.lock.json`), separate from a repository's
project lockfile. The shared installation registry puts user-scope records in
the shared XDG **data** location and repository-scope records in the
repository's own lockfile (FR2.1) — so the CLI's user lockfile sits in a third
place that the shared registry does not read.

Users who have already installed bundles at user scope have records in that
file.

- A. The shared registry becomes the only user-scope record store. The CLI reads the old user lockfile once, imports its entries into the shared registry, and stops writing it.
- B. The shared registry becomes the only user-scope record store, and the old user lockfile is simply abandoned — previously installed user-scope bundles are no longer tracked until reinstalled. Documented as a breaking change.
- C. Keep writing the old user lockfile alongside the shared registry for one release so external tooling that reads it keeps working, then retire it.
- X. Other (please specify)

[Answer]: A. The shared registry becomes the only user-scope record store. The CLI reads the old user lockfile once, imports its entries into the shared registry, and stops writing it.

## Q3. How does `install --lockfile` reach a lifecycle that installs one bundle at a time?

The CLI supports a declarative install that reads a lockfile and installs every
bundle it names. The shared lifecycle contract (contract 1) declares only
single-bundle `install`, `update`, and `uninstall` operations — there is no
batch operation.

What the CLI does when bundle three of five fails is a user-visible decision.

- A. U2 loops over the shared single-bundle operation and keeps going after a failure, reporting a per-bundle result table at the end and a non-zero exit if any bundle failed.
- B. U2 loops over the shared single-bundle operation and stops at the first failure, leaving the already-installed bundles in place and reporting where it stopped.
- C. Add a batch operation to the shared lifecycle so the whole lockfile is one call and the all-or-nothing decision lives in the shared layer.
- X. Other (please specify)

[Answer]: A. U2 loops over the shared single-bundle operation and keeps going after a failure, reporting a per-bundle result table at the end and a non-zero exit if any bundle failed.

## Q4. What does the CLI hand the shared lifecycle as the bundle?

The shared lifecycle's install request takes a governed bundle source. Today
the CLI resolves a bundle specification against its configured sources,
downloads the archive, and extracts it. The shared foundation owns binary-safe
archive reading and manifest validation.

Where the handover sits decides how much of the current CLI download and
extraction code stays.

- A. The CLI resolves and downloads to the shared cache and hands over a path to the unopened archive. The shared lifecycle owns all reading, validation, and extraction.
- B. The CLI resolves, downloads, and extracts, then hands over a path to the extracted directory. The shared lifecycle validates and installs from the directory.
- C. The CLI hands over the bundle specification itself and the shared lifecycle owns source resolution and download too.
- X. Other (please specify)

[Answer]: C. The CLI hands over the bundle specification itself and the shared lifecycle owns source resolution and download too.

## Q5. How do the shared lifecycle's six result kinds become CLI exit behaviour?

Every shared operation returns one of six result kinds: success,
validation-error, conflict, preserved-content, retryable-failure, and
safety-blocked. Two of them are not plainly failures — `conflict` says existing
content needs a decision, and `preserved-content` says the operation kept files
the user had edited.

A CLI has no way to ask a question mid-run unless it is interactive, so its exit
code is how a script learns what happened.

- A. Only `success` exits zero. Everything else is non-zero, with a distinct exit code per kind so scripts can branch.
- B. `success` and `preserved-content` exit zero, since content was preserved deliberately and nothing was lost; the preserved files are listed on standard output. The other four are non-zero.
- C. Only `success` exits zero, and `conflict` additionally offers an interactive prompt when the CLI is attached to a terminal, plus a flag to answer it non-interactively.
- X. Other (please specify)

[Answer]: B. `success` and `preserved-content` exit zero, since content was preserved deliberately and nothing was lost; the preserved files are listed on standard output. The other four are non-zero.

## Q6. Which CLI commands are in this unit's scope?

The CLI has three lifecycle commands — `install`, `update`, `uninstall` — plus
`apply`, which is a thin wrapper, and a much larger set of commands that do
other work (discovery, indexing, collection and bundle authoring, doctor,
config, targets).

This question bounds the unit so the delivery plan's pull requests stay small.

- A. `install`, `update`, `uninstall` and `apply` only. Every other command is out of scope for this unit.
- B. Those four plus the target and status commands, since they display installation state that now comes from the shared registry.
- C. Every command that reads or writes a lockfile, whatever it is called, so no stale reader of the old format survives the unit.
- X. Other (please specify)

[Answer]: C. Every command that reads or writes a lockfile, whatever it is called, so no stale reader of the old format survives the unit.


## Q7. Follow-up to Q1 — how is commit mode handled as shared behaviour?

Q1 was answered with a question: can commit mode be part of the target
definition, or is there a proposal to put the logic in the shared workflow,
given the VS Code extension has this kind of installation too?

Both premises hold, and the code settles part of it already:

- Commit mode **is** already part of the target definition. `commitMode` sits on
  the core target type, is validated in core, and appears in the lockfile JSON
  schema. It is also already a per-invocation override in the CLI
  (`--commit-mode`) and a per-bundle choice in the extension's scope-selection
  UI, so it must travel on the lifecycle request as well, with the target's
  value as the default.
- The behaviour **is** shared, not CLI-specific. The extension defines its own
  commit-mode type, exposes a command to switch it, and describes the
  `local-only` option to users as "excluded via `.git/info/exclude`".
- The special-case repository writer is **not** about destinations. The default
  layout data already gives the Copilot-like targets a repository layout rooted
  at the workspace's `.github` directory with the same kind routes, so the
  shared routing rule already resolves exactly the destinations that writer
  resolves. Nothing needs adding for paths.

What the writer uniquely does is two other things, and they are separable:

1. It selects **which repository lockfile** holds the record — the committed one
   under `commit`, a separate local one under `local-only`. This is a registry
   location concern, so it belongs in the shared repository-scope registry
   adapter. It needs one amendment to the shared foundation's rule that each
   adapter's file does not move: the repository adapter picks one of two files
   by commit mode, and that choice is part of the installation's identity.
2. It maintains the **git exclude entries** under `local-only`. This is a
   post-write side effect on a file that is not a managed artifact.

Only the second one is an open design choice.

- A. Full shared treatment. Destinations need no change. The shared repository registry adapter selects the lockfile file by commit mode (amending the shared rule as above). Git exclude maintenance becomes a small shared port on the shared foundation, invoked after writes are verified and a no-op under `commit`. The special-case repository writer is retired and both delivery surfaces get identical behaviour from one implementation.
- B. As A, but drop `local-only` git exclusion entirely as a documented breaking change, keeping only the two-lockfile selection. Simpler, but it removes a behaviour the extension currently offers users by name.
- C. As A for destinations and lockfile selection, but keep git exclude maintenance in each delivery adapter as a post-install step, accepting that the CLI and the extension each carry it until a later consolidation.
- X. Other (please specify)

[Answer]: A. Full shared treatment. Destinations need no change. The shared repository registry adapter selects the lockfile file by commit mode (amending the shared rule as above). Git exclude maintenance becomes a small shared port on the shared foundation, invoked after writes are verified and a no-op under `commit`. The special-case repository writer is retired and both delivery surfaces get identical behaviour from one implementation.


## Q8. Follow-up to Q5 — `preserved-content` does not mean what the chosen exit behaviour assumes

Q5 was answered with option B: `success` and `preserved-content` both exit zero,
"since content was preserved deliberately and nothing was lost".

That reasoning describes a real case, but not the one `preserved-content` names.
In the shared foundation's design there are two different situations:

- A **successful update that preserved some files.** The update ran, every other
  write was verified, and the result is `success` carrying a list of the files it
  left alone because the user had edited them. Nothing was lost and the operation
  completed. This is the case the Q5 rationale describes — and it already exits
  zero under option B, because its kind is `success`.
- A **`preserved-content` result.** The shared design reserves this kind for an
  update that **could not proceed** — too much of the requested change would have
  overwritten locally changed content, so the operation stopped. The files are
  intact, but the bundle was not updated.

So exiting zero on `preserved-content` would tell a script that an update
succeeded when in fact nothing was applied.

- A. Only `success` exits zero, including when it carries preserved files. `preserved-content` is non-zero with its own exit code, because the requested change did not happen. (This still gives the Q5 rationale what it wanted: a successful update that preserved files exits zero.)
- B. Keep `preserved-content` at exit zero as answered, accepting that a script cannot distinguish "updated" from "declined to update" by exit code alone and must parse the output.
- C. Rename the outcome in the shared foundation so the distinction is unmistakable, then apply option A. The blocked kind becomes something explicitly negative and `preserved` stays a field on a successful result.
- X. Other (please specify)

[Answer]: A. Only `success` exits zero, including when it carries preserved files. `preserved-content` is non-zero with its own exit code, because the requested change did not happen.


## Consolidated Summary Confirmation

These are the decisions I will build the U2 design artifacts from.

- **Commit mode (Q1, Q7)** — commit mode is shared behaviour, not a CLI special
  case, and it is already part of the target definition in core. It decomposes
  into three concerns. Destinations need no change: the default layout data
  already resolves the Copilot-like targets' repository scope to the workspace's
  `.github` tree with the same kind routes the special-case writer used. The
  shared repository-scope registry adapter selects which repository lockfile
  holds the record by commit mode — the committed file under `commit`, a separate
  local file under `local-only` — which amends the shared foundation's rule that
  each adapter's file does not move. Git exclude maintenance becomes a small
  shared port on the shared foundation, invoked after writes are verified and a
  no-op under `commit`. The special-case repository writer is retired and both
  delivery surfaces get identical behaviour from one implementation. Commit mode
  travels on the lifecycle request, defaulting to the target's value.
- **User-scope lockfile (Q2)** — the shared registry becomes the only user-scope
  record store. The CLI reads the existing user lockfile under the user config
  root once, imports its entries into the shared registry, and stops writing it.
- **Declarative install (Q3)** — `install --lockfile` loops over the shared
  single-bundle operation. It keeps going after a per-bundle failure, reports a
  per-bundle result table at the end, and exits non-zero if any bundle failed.
- **Bundle handover (Q4)** — the CLI hands over the bundle specification itself;
  the shared lifecycle owns source resolution and download as well as archive
  reading, validation, and installation. This is de-duplication rather than new
  machinery, because the GitHub, HTTP, and ZIP source adapters already live in
  the shared infrastructure package. It does not match the shared foundation's
  design as currently written, which starts from an already-fetched archive and
  declares no source-resolution port; that gap is recorded for the foundation
  repairs owed at the stage decision.
- **Exit behaviour (Q5, Q8)** — only `success` exits zero, including when it
  carries a list of preserved files. The other five kinds are non-zero, each with
  its own exit code so scripts can branch; `preserved-content` is among them,
  because it means the requested change did not happen.
- **Unit scope (Q6)** — every CLI command that reads or writes a lockfile, so no
  stale reader of the old format survives the unit. That resolves to `install`,
  `update`, `uninstall`, `init`, `profile`, and `status`, plus `apply` as a
  wrapper over install, plus the two framework helpers that resolve lockfile
  paths and targets.

- **Shared-foundation updates carried into this pass.** The shared foundation
  has since been amended twice, which closes this file's recorded Q4 delta and
  adds controls U2 consumes without duplicating. Contract 3 and the U1 design now
  own governed source resolution, download, archive reading, validation, and
  installation, so the CLI hands over the bundle specification as decided.
  `ManagedInstallation` exposes required `target` and `scope` attributes, so the
  legacy user-lockfile import resolves a real identity instead of
  reverse-engineering an opaque key. Every shared write, including each bundle of
  a declarative `install --lockfile` run, passes U1's durable
  target/scope/destination claim: a destination owned by another installation
  returns `conflict` unless an explicit ownership hand-off is supplied, and U2
  reports that per-bundle outcome rather than writing target content itself. Exit
  behaviour is unchanged — only `success` exits zero, including when it carries
  preserved files, and an ownership `conflict` is one of the non-zero kinds with
  its own code.

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
