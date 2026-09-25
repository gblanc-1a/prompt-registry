# Kiro IDE — Intermittent SIGINT (exit `130`) after a command completes successfully

## Summary

Commands run through the Kiro IDE terminal tool intermittently report exit `130`
(128 + SIGINT) **after producing correct, complete output**. Re-running the same
command usually exits `0`. Occasionally the terminal desyncs instead: the call
returns a bare shell prompt and times out.

## Environment

- Kiro IDE (VS Code based)
- macOS (darwin), shell `zsh`

## Steps to reproduce

Run the following as separate, standalone terminal calls (one command per call,
not chained in a loop). Repeat ~5–10 times:

```bash
sh -c 'bun --version' 2>&1 | cat
```

The child program is irrelevant — any parent→child command piped to another
process reproduces it. What matters is the shape: each invocation is its own
terminal round-trip.

## Actual result

Output is correct on every run, but the exit code is unstable:

| Run | stdout | Exit code |
|----:|--------|-----------|
| 1 | `1.4.2` | `0` |
| 2 | `1.4.2` | `0` |
| 3 | `1.4.2` | **`130`** |
| 4 | `1.4.2` | `0` |
| 5 | *(bare prompt `user@host %`)* | **timeout after 120s** |

Roughly 1 in 4–5 runs exits `130` despite complete, correct output. Run 5 shows
the more severe form: a reclaimed interactive prompt instead of command output,
and no completion.

## Expected result

- A command that runs to completion returns its real exit code (`0` on success).
  Exit `130` should mean an actual interruption (delivered SIGINT), never
  successful completion.
- The terminal never returns a reclaimed shell prompt in place of output and does
  not hang after the command has produced output and exited.

## Notes / diagnostics

- **Does not reproduce** with a single-process command and no pipe
  (e.g. `bun --version`, `node --version`, `echo hi`), which exit `0` consistently.
- **Does not reproduce** when the runs are batched inside one `for` loop in a
  single terminal call — that is a single round-trip with one teardown, so it
  cannot surface the per-invocation signal. The bug requires each command to be
  its own terminal round-trip.
- Frequency increases with a parent/wrapper process and a trailing pipe (`| cat`),
  consistent with a race between the child exiting and the terminal signalling the
  process group during teardown.

## Suggested fix

- On teardown, wait for the foreground command to be reaped and read its real exit
  status before signalling; surface `130` only when SIGINT was genuinely delivered
  to a still-running command.
- Capture the command's own exit code (e.g. via a `$?` sentinel) rather than
  inferring it from a child/terminal signal on teardown.
- Add regression coverage that runs a parent→child piped command as many separate
  terminal round-trips, asserting exit `0` whenever complete output was produced
  and no PTY desync.
