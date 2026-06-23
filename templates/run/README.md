# Run templates

## R35 Python preflight (cross-platform)

Before any R35 run, the agent verifies the sandbox can import every wheel it
will reach for. Use the one-liner below — the `PYTHONIOENCODING=utf-8` prefix
is load-bearing on Windows:

```sh
PYTHONIOENCODING=utf-8 python -c "import openpyxl, openai, pptx, docx, reportlab"
```

Exit code `0` means every wheel imported cleanly. Any other exit code means
the sandbox is broken — surface the stderr verbatim and stop; do NOT soft-warn
and continue.

> Windows footnote: the manifest hash line that the run lane prints downstream
> is UTF-8. If your terminal mojibakes it, set `PYTHONIOENCODING=utf-8` for the
> session — Windows consoles default to cp1252 and will corrupt the hash (and
> any non-ASCII ImportError message) before you see it.

### Why the wrapper

- Pinning `PYTHONIOENCODING=utf-8` in front of `python -c` keeps the
  ImportError traceback readable on Windows (cp1252) when a wheel is missing.
  Tracebacks frequently contain non-ASCII (path separators, vendored ellipses,
  package names with accents); cp1252 raises a *second* `UnicodeEncodeError`
  that masks the real failure as an encoding bug one layer up.
- POSIX shells (bash/zsh) accept the inline `VAR=value cmd` form natively.
  PowerShell users must run `$env:PYTHONIOENCODING='utf-8'; python -c "..."`
  instead — the inline-prefix form is a PowerShell parser error.

Scaffolding for a single eval *run* — one pass of the agent over the
benchmark slices that scores it.

## Anti-memorization: rotate the held-out slice

The held-out slice is what separates a *capability* score from an
*answer-key* score. If you treat the slice as static, the agent (or the
people prompting it) will memorize it, and the number on the dashboard
will stop tracking real capability.

The rules below are the run-level enforcement of the honest lane. The
authoritative source for *why* these rules exist is
[../references/honest-lane.md](../references/honest-lane.md) — read it
before deviating from anything here.

### (a) Implicit invariant: the slice stays quarantined

The implicit invariant is that the held-out slice membership stays
**QUARANTINED** from the agent's context across iterations. If the agent
ever sees the held-out task ids — in its prompts, tools, scratchpad,
memory store, or training data — the score becomes an answer key, not a
capability measurement.

Concrete consequences:

- Held-out task ids and ground-truth answers MUST NOT appear in the
  agent's system prompt, few-shot examples, retrieved memory, or any
  tool response.
- Held-out tasks MUST NOT be used during tuning, ablation, or
  prompt-engineering iterations. If you need a dev signal, use the open
  slice.
- A leak of even a single held-out id invalidates the slice — rotate it
  immediately, do not patch it.

### (b) Rotation cadence

Rotate the held-out slice when **either** trigger fires:

1. **Quarterly minimum.** At least once per quarter, regardless of
   scores. Calendar-driven rotation prevents slow drift.
2. **Plateau trigger.** Whenever held-out scores stop improving for **2
   consecutive iterations** while open-slice scores keep improving.
   That divergence is a memorization signal — the agent has overfit
   the held-out slice and the number has stopped tracking capability.

When in doubt, rotate. Rotating early costs you one iteration of
comparability; rotating late costs you the entire lane's credibility.

### (c) Honesty gate: `cleanGeneralProbe`

`cleanGeneralProbe` stays `true` for a new slice **only if** the previous
slice was sealed and its tuning status was recorded in a non-recallable eval
ledger before the new one was introduced. This is the gate that prevents
implicit tuning signal from leaking forward across rotations.

Procedure on every rotation:

1. Confirm the previous slice has a persisted tuning/seal receipt in the eval
   ledger. For BTB imports, clean headline rows are derived from
   `cleanCapabilityAccepted`, `modelCalls`, and boundary receipts instead of
   agent-authored labels.
2. Seal the previous slice (archive ids + answers, freeze the file).
3. Introduce the new slice with `cleanGeneralProbe = true`.
4. If step (1) was skipped, set `cleanGeneralProbe = false` on the new
   slice and flag the run as *carry-over tuning* in the eval ledger.

If you cannot truthfully assert step (1), do not set the probe to
`true`. A `false` probe is honest; a `true` probe over leaked tuning is
a lie that compounds across every downstream report.

### (d) Authoritative source

This block is a run-level enforcement of the policy in
[../references/honest-lane.md](../references/honest-lane.md). If this
file and `honest-lane.md` disagree, **`honest-lane.md` wins** — update
this block to match, not the other way around.
