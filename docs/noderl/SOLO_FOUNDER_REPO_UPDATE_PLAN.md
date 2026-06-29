# Solo Founder Agent Builder — repo update plan (grounded)

> Generated 2026-06-28. Target: the public repo `github.com/HomenShum/solo-founder-nodes`
> (mirror of `.claude/skills/solo-founder-nodes/`). Source of truth for current state:
> `docs/eval/solo-founder-nodes-scorecard.md` (5-agent audit, 2026-06-27).

## TL;DR of current state

The 7-node loop + anti-cheat thesis is **real and runnable**. Most of the "RL self-improving
loop" concepts the brainstorm wants to add **already exist as prose in the skill**:

| Concept | Status in skill | Where |
|---|---|---|
| Attempt ledger | ✅ exists | node 6 `docs/eval/runs/<ts>/`; `RALPH_LOOP_LEDGER.md` `.solo/events.jsonl` |
| Failure taxonomy | ✅ exists | HALO root-cause labels in `agent-improvement-loop.md`; node 6 clustering |
| Strategy delta | ✅ exists | "smallest shared component" fix rule, node 6 |
| Repair lane | ✅ exists | `harbor --disable-verification` fast path, node 6 |
| Promotion gate | ✅ exists | held-out + generalization re-measure (node 6); in-app transfer (node 7) |
| Fresh-context judge | ✅ partial | deterministic grader, no LLM on scored path (node 6) |
| Reference / domain packs | ✅ / ⚠️ | `references/benchmarks.md` exists; non-BTB fixtures not authored |

**Do not re-derive these.** The real debts are below.

---

## Ranked updates

### P0 — Settle the honesty debts (these are the product)
1. **Revert / gate the answer-key contamination.** `harbor_adapter.py:4717` still has
   `is_*_task → write_*_package`; the repo's own `BTB_GENERALIZATION_DIAGNOSTIC.md` names it as
   "the contamination to revert." Default materializers OFF behind `BTB_DISABLE_MATERIALIZERS`;
   in `nodes/5-adapter.md` quote this dispatch as *the regression to watch*; label the example
   adapter as a **known-contaminated reference**, not shipping code.
2. **Swap the BTB headline to the honest claim** everywhere (scorecard + any pitch copy): "1 task
   proven through the live product path + generic-only baseline across N tasks at mean X; full
   suite in progress." Kill any "100/100" string. (See `HONESTY_DEBTS_BEFORE_PUBLISH.md`.)

### P1 — Fill the empty proof cells
3. **Author the non-BTB fixtures (NB-1/2/3).** Rubrics already exist in
   `BTB_GENERALIZATION_DIAGNOSTIC.md`; the fixtures are not authored. Add
   `references/non-btb-fixtures.md`: source files + grader pseudocode + pass criteria. Use
   **generic** domains (SaaS churn forecast, retail pricing) — not real client deal names.
4. **Fill the held-out OFF scorecard.** Currently a single provisional point (n=1, gpt-4.1-mini).
   Run the held-out slice with materializers OFF across ≥1 more model; record under `docs/eval/runs/`.

### P2 — Make the loop machine-readable
5. **Backfill RALPH anchors as JSON templates.** Add `references/ralph-anchors.md` (or
   `.solo/anchors/` templates): `capability-spec`, `benchmark-choice`, `held-out-split`,
   `setup-provenance`, `memory-quarantine`. This is what lets a thin runtime (or NodeRL) consume
   the loop programmatically.

### P3 — Tighten + cross-link
6. **Node 6 failure-taxonomy mapping.** Add the explicit planner / tool / citation / formatter
   cluster→fix table, referencing the HALO root-cause labels as the diagnostic vocabulary.
7. **Honesty-primitives reference.** New `references/honesty-primitives.md` citing the
   `cited-sources` skill (box the exact source line), the `powerpoint` skill
   (verified/manual/needs_review), and a minimal deterministic grader template.
8. **NodeRL bridge.** Add a short section (master skill or a reference) positioning
   `solo-founder-nodes` as the **curriculum + repair layer of NodeRL** — the loop that generates
   the trajectories NodeRL records, scores, and trains on. Link the NodeRL repo once it exists.

---

## Public-repo redaction checklist (before mirroring skill → public repo)

The skill's worked examples are dogfooded from NodeRoom. Redact before publishing:

| Item | In skill | Action |
|---|---|---|
| Convex paths | nodes 1, 5 reuse sections | generic `convex/schema.ts` pattern + "adapt to your schema" |
| NodeRoom UI paths | nodes 1, 4, 7 | placeholder surface names; keep the architectural pattern |
| Client / deal names | `BTB_GENERALIZATION_DIAGNOSTIC.md` (Comcast/Greenbrier/COTY) | generic domain examples |
| Model IDs | nodes 5, 6 | keep as examples + "substitute your model_id" |
| Windows scripts | node 3 (`*.ps1`) | provide POSIX + Windows variants in `references/` |
| Harbor image digests | node 3 | template + "your digest will differ" |

Add a top-of-`SKILL.md` caveat: *"Worked examples are from NodeRoom (the dogfooded origin).
Adapt paths, model IDs, and contexts to your app."*

---

## Definition of done

- [ ] Materializer dispatch default-off + labeled; node 5 names it as the regression to watch.
- [ ] No "100/100" anywhere; scorecard headline is the honest claim.
- [ ] `references/non-btb-fixtures.md` authored with generic domains + graders.
- [ ] Held-out OFF scorecard filled for ≥2 models.
- [ ] RALPH anchors templated as JSON.
- [ ] Redaction checklist applied to the public mirror.
- [ ] NodeRL bridge section added + linked.
