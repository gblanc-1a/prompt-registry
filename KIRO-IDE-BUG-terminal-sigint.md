# Kiro IDE bug report — Intermittent SIGINT (exit `130`) on terminal-command teardown

> **Destination:** Kiro IDE (terminal integration), **not** `awslabs/aidlc-workflows`.
> This report consolidates every SIGINT / exit-`130` observation previously filed
> against AI-DLC in [`AIDLC-FEEDBACK.md`](AIDLC-FEEDBACK.md) (AIDLC-ISSUE-004,
> -006, and -009 through -014) into one defect, because fresh reproduction shows
> the root cause is the Kiro IDE terminal path — reproducible with plain commands
> that never touch AI-DLC.

## Summary

Commands run through the Kiro IDE terminal tool intermittently report exit `130`
(128 + SIGINT) **after producing correct, complete output**. The same command run
again usually exits `0`. In a stronger form, the terminal desynchronises entirely:
the tool returns a bare reclaimed shell prompt and the call times out.

The failure is a property of the IDE terminal round-trip, not of any program being
run. It is most visible with a parent process that spawns a child and pipes its
output (e.g. a launcher wrapper, or `sh -c '…' | cat`), which appears to widen a
teardown race between the child exiting on its own and the terminal delivering
SIGINT to the process group.

## Environment

- **Kiro IDE** (VS Code based), chat model Claude Opus 4.8
- **OS:** macOS (darwin), shell `zsh`
- Reproduced 2026-09-23 in `/Users/gblanc/git_clones/ai-native/prompt-registry`
- Incidental context: AI-DLC `2.9.0`, `bun` 1.4.2, `node` v26.9.0 — none of these
  are required to reproduce (see below).

## Reproduction

### It is NOT AI-DLC specific — plain commands reproduce it

A generic parent→child command with a pipe, run as separate standalone terminal
calls, reproduced both failure modes:

```bash
sh -c 'bun --version' 2>&1 | cat
```

| Run | stdout | Exit code |
|----:|--------|-----------|
| 1 | `1.4.2` | `0` |
| 2 | `1.4.2` | `0` |
| 3 | `1.4.2` | **`130`** (output correct, still SIGINT) |
| 4 | `1.4.2` | `0` |
| 5 | *(bare prompt `gblanc@… %`)* | **desync / timeout after 120s** |

Run 5 is the severe form: the terminal returned a reclaimed interactive shell
prompt instead of command output, and the call never completed. `bun` here is
just a stand-in child process — the point is the `sh -c '…' | cat` shape, not the
program.

### It reproduces on the AI-DLC launcher the same way

```bash
cd /Users/gblanc/git_clones/ai-native/prompt-registry && aidlc --version 2>&1 | cat
```

Correct output `aidlc 2.9.0 (runtime 2.9.0)` every time; exit code alternated
`0,0,0,130` and `0,0,0,0,130` across standalone runs — roughly **1 in 4–5**
runs exits `130` while the output is complete and correct.

### What does NOT reproduce it (baseline)

- Single-process commands with no pipe: `node --version`, `echo …`, `git … status`,
  `bun --version`, `bun .kiro/tools/aidlc.ts --version` — all exit `0`, repeatedly.
- Any command wrapped in a **shell `for` loop inside one terminal call**
  (`for i in $(seq 1 15); do … ; done`) — always exits `0`. This matters: a loop
  is a *single* terminal round-trip with *one* teardown at the end, so it cannot
  surface a per-invocation teardown signal. The bug only appears when each command
  is its own terminal round-trip.

The loop-vs-standalone distinction is the key diagnostic: earlier investigation
that batched runs in a loop concluded "cannot reproduce", which is an artifact of
the batching, not evidence the bug is gone.

## Observed

- Exit `130` is returned for a command whose stdout/stderr is fully and correctly
  produced.
- Occasionally the terminal desyncs completely (bare prompt + timeout).
- Frequency rises with a launcher/wrapper process (parent spawns child), and with a
  trailing pipe (`| cat`), consistent with a process-group-teardown race.

## Expected

- A command that runs to completion and produces its output returns its real exit
  code (`0` on success). Exit `130` must mean an actual interruption (Ctrl-C /
  delivered SIGINT), never successful completion.
- The terminal tool never returns a reclaimed interactive prompt in place of the
  command's output, and does not hang after the child has already produced output
  and exited.

## Impact

Downstream automation cannot distinguish a successfully completed command from an
interrupted one, because the success signal (correct output) and the failure signal
(non-zero exit) disagree. Concretely, as recorded across the AI-DLC feedback log:

- **Scripted multi-call loops get torn down mid-chain.** A `next → continue →
  continue` style resume driven from the IDE cannot complete, because a SIGINT on
  one hop tears down the calling shell even though that hop's output was written
  (AIDLC-ISSUE-006 trap 1; AIDLC-ISSUE-013).
- **One-use operations look un-recorded and get retried.** A review request or a
  review-completion receipt is durably written, but the `130` makes a client
  believe it failed and retry — risking duplicate or budget-consuming re-issues
  (AIDLC-ISSUE-009, -010, -014).
- **Valid routing responses get discarded.** A valid `orchestrate next`
  continuation token or terminal directive is emitted, but the `130` makes the
  client throw it away and restart, repeating heavyweight context delivery
  (AIDLC-ISSUE-011, -012).
- **Every run needs a sidecar file to know whether it worked.** The only reliable
  workaround is to redirect output to a file and read the file, ignoring the exit
  code (AIDLC-ISSUE-013). That is the mitigation `scripts/aidlc-resume.sh` and the
  project's AGENTS.md already encode.
- **A read-only validation call returned `130` with no output at all**
  (AIDLC-ISSUE-004), i.e. the desync form, not just the exit-code form.

## Consolidated evidence (from `AIDLC-FEEDBACK.md`)

All of these were filed as separate AI-DLC issues; they are one Kiro IDE defect.

| Source issue | Command shape (all Kiro IDE terminal) | Symptom |
|---|---|---|
| AIDLC-ISSUE-004 | read-only sensor / validation call | exit `130`, no JSON/diagnostic |
| AIDLC-ISSUE-006 (trap 1) | `aidlc …` launcher, incl. `aidlc --version`, in a shell loop | intermittent `130`, loop torn down mid-chain |
| AIDLC-ISSUE-009 | `bun .kiro/tools/aidlc.ts engine log review … --retry-pending` | `REVIEW_REQUESTED` emitted, exit `130` |
| AIDLC-ISSUE-010 | `bun … engine log review … --verdict NOT-READY` | `REVIEW_COMPLETED` + receipt written, exit `130` |
| AIDLC-ISSUE-011 | `bun … engine orchestrate next` | valid `load-steering` token emitted, exit `130` |
| AIDLC-ISSUE-012 | `bun … engine orchestrate continue "<token>"` | exit `130`, **no stdout** (desync form) |
| AIDLC-ISSUE-013 | `scripts/aidlc-resume.sh > /tmp/… 2>&1` | exit `130` while output file was complete |
| AIDLC-ISSUE-014 | `bun … engine log decision …` | `DECISION_RECORDED` emitted, exit `130` |

Reporter's own reproduction examples (harmless, non-workflow variants of the
AIDLC-ISSUE-014 command shape) that triggered the same `130` / desync:

```bash
# combined form: cd + var + && chain + launcher + pipe
cd /Users/gblanc/git_clones/ai-native/prompt-registry && aidlc --version 2>&1 | cat
# generic, no AI-DLC at all
sh -c 'bun --version' 2>&1 | cat
```

## Root-cause hypothesis

The IDE terminal integration appears to signal the command's process group during
teardown, and there is a race: if the child has not yet been reaped when teardown
runs, it (or its parent launcher) receives SIGINT and the shell reports `128+2 =
130`, even though the command already finished and flushed its output. A wrapper
process (launcher) or a pipeline (`| cat`) keeps a process in the group slightly
longer and so hits the race more often. The full-desync/timeout case (run 5 above,
and AIDLC-ISSUE-012's empty `130`) suggests the same teardown can occasionally
leave the PTY in a bad state.

This is why:
- single fast processes rarely show it,
- launchers and pipelines show it often,
- a `for` loop (one teardown) never shows it, and
- the payload program is irrelevant (`bun`, `node`-child, `aidlc` all affected).

## Suggested fixes (Kiro IDE)

1. **Do not signal a process group whose foreground command has already exited.**
   Wait for the child to be reaped and read its real exit status before tearing
   down the PTY; only surface `130` when a SIGINT was genuinely delivered to a
   still-running command.
2. **Separate "command exited" from "terminal torn down".** Capture the command's
   own exit code from the shell (e.g. via a sentinel/`$?` marker) rather than
   inferring it from the terminal/child signal on teardown.
3. **Fix the desync path.** Ensure the terminal never returns a reclaimed
   interactive prompt in place of command output, and never hangs after the child
   has produced output and exited (the timeout case).
4. **Regression coverage.** Add tests that run, as separate terminal round-trips,
   a parent→child piped command (`sh -c '<child>' | cat`) and a wrapper launcher
   many times, asserting exit `0` whenever complete output was produced, and no
   PTY desync.

Fixing this at the IDE terminal layer resolves AIDLC-ISSUE-004, -006 (trap 1),
and -009 through -014 together, and removes the need for the redirect-to-file
workaround those issues currently rely on.
