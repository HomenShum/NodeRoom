# Extraction — how the NodeRL packages are produced

The `packages/*/src` code is **generated from the canonical NodeRoom source**, not hand-forked, so
it never drifts. `MANIFEST.json` is the single source→dest map; `scripts/extract-from-noderoom.mjs`
applies it (plus a safety strip of the SEC contact email).

## One-command flow (run inside the NodeRoom repo)

```bash
# 1. Verify the manifest still resolves against the source (no writes):
node noderl/scripts/extract-from-noderoom.mjs --dry-run
#    -> "18 file(s) resolved, 0 missing"  (verified 2026-06-28)

# 2. Generate (vendor) the package sources:
node noderl/scripts/extract-from-noderoom.mjs --src .

# 3. Per package: install deps + typecheck (the compile-standalone step):
#    nodetrace needs: zod, ai (+ @ai-sdk/*), playwright-core (optional, browserbase substrate)
#    nodemem needs:   (none beyond tsc)
#    nodeeval needs:  (none beyond tsc)
cd noderl/packages/nodetrace && npm i && npx tsc --noEmit
```

When splitting NodeRL into its own public repo, run steps 1–3 in NodeRoom, then **commit the
generated `packages/*/src`** into the public repo as a vendored snapshot. Refresh it by re-running
this flow whenever the NodeRoom source changes — never edit the vendored copy by hand.

## What's generated vs referenced

| Package | Generated from | Standalone deps | Notes |
|---|---|---|---|
| `nodetrace` | `src/nodeagent/capture/**` | zod, ai, playwright-core(opt) | injectable reasoner + substrate; SEC email stripped |
| `nodemem` | `src/nodemem/core/**` + `failureMemory.ts` | none | pure compile/rank + failure store |
| `nodeeval` | `src/eval/bankerToolBench{EvalLedger,FullSuiteGate,LiveSuiteGate}.ts` | none | reward aggregation + the two proof gates |

The visual-judge harness (`packages/walkthrough-review-cli` in NodeRoom) is already standalone —
**reference/copy it directly**, it is not part of this manifest. The proof-receipt **contract**
(`spec/proof-receipt-contract.md`) and **anti-cheat doctrine** ship as specs, not code.

## Status (2026-06-28)

Mechanism built + dry-run verified (18/18 resolve). Generation + per-package `npm i`/tsc is the
remaining publish step — intentionally not committed here so the worktree carries no unverified,
un-dep-wired generated source.
