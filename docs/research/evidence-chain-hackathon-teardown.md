# Evidence-Chain Teardown — Anthropic "Opus 4.8 Build Day" winners

**Research date:** 2026-06-21 · **Method:** primary-source teardown (blog hrefs → all 3 winner GitHub repos, public) + claim-by-claim verification against committed artifacts. Done inline (the multi-agent deep-research workflow kept 529-ing on the scope sub-agent under API load).

**Sources (primary):**
- Anthropic winners blog: https://claude.com/blog/meet-the-winners-of-our-claude-opus-4-8-build-day-hackathon
- Tekton repo: https://github.com/tangxiya-star/Tekton · live: https://tekton-build.vercel.app/
- Sim Francisco repo: https://github.com/tejasprabhune/simfrancisco · live: https://simfrancisco.org/
- Custom Universe repo: https://github.com/jss8649/image-edit-realtime-hackathon

> Honesty note built into this teardown: where the blog's wording can't be confirmed from the repo, it's marked **BLOG-ONLY** or **DISCREPANCY**, not laundered into fact.

---

## 0. Headline findings (for a builder-analyst)

1. **The "evidence chain" is a concrete data contract, not a metaphor.** Tekton's canonical data node is `{value, provenance, source, evidence}` and **every 3D mesh carries `{componentId, provenance, citation}` in `userData`**. Click-to-inspect and the provenance color toggle just read that tag. "Nothing renders without a source" is enforced by an audit that fails the build on any unsourced component. This is structurally the same idea as your `cited-sources` skill — but applied to a *generated artifact*, with a 4-level evidence taxonomy.
2. **The shared winning pattern across the top 2 is YOUR doctrine.** Machine-checkable "done" (URL responds + tests green + rubric passes) → independent verifier in a **fresh context window** → **adversarial critic that tries to refute the gain** → failures kept as evidence → frozen ground-truth + **held-out split** to block overfit/leakage → `/goal` self-correction + dynamic JS workflows + `NOTES.md` memory. This is solo-founder-nodes / BankerToolBench anti-cheat, independently re-derived by two winning teams.
3. **The counterintuitive core (steal this):** the verifier **re-measures the artifact from its own coordinates/render — never from the spec's claimed numbers.** A builder that grades its own claims is theater; a verifier that recomputes from the realized geometry catches the lie.
4. **Two blog claims don't survive contact with the repos** (see §4): the event/model was branded **Fable 5** in Tekton's own participant guide, not Opus 4.8; and Sim Francisco's *predictions* run on **gpt-4o** (picked for its Oct-2023 cutoff as a leakage guard), not Claude. Claude built+verified; gpt-4o reasons inside the sim.

---

## 1. Tekton (1st) — the evidence chain, verified

Codename "Yingzao." Primary build = **Nanchan Temple Main Hall (南禅寺大殿, 782 CE)**, the oldest surviving Chinese timber building — *not* "Tang Dynasty" generically. Notre-Dame's flèche is a second corpus (`derivation-log.notre-dame.md`, "16 verdicts / 40 gaps").

### 1.1 The evidence-chain data contract
- Canonical corpus `data/nanchan-canonical.json` is the single source of truth. Each dimensional node:
  ```json
  {"value":"唐建中三年 (782 CE)","provenance":"measured","source":"ZHANG2022",
   "evidence":"Ink inscription on west four-rafter beam: 「…重修殿…」"}
  ```
  → note the `evidence` field carries the **verbatim supporting text**, exactly like cited-sources boxes a verbatim quote.
- **4 provenance classes:** `measured` → `reconstructed_design` → `rule_derived` → `conjecture`. Strict precedence: a value with a source is never overridden by a rule; rule-derived values cite the rule; conjecture must render *visibly labeled*.
- **Scene graph mirrors the contract:** every R3F mesh carries `{componentId, provenance, citation}` in `userData`. The provenance toggle = a material swap keyed on that tag; click-to-inspect reads the same metadata. Provenance is one source of truth driving render + inspector + audit.
- **Hard gate:** "provenance layer audit shows **zero unsourced components**" is part of machine-verifiable "done."

### 1.2 Verification architecture (5 build-time agent roles, in Claude Code)
Data Ingester → Rule Engine (derivation reasoner, writes `derivation-log.md` arithmetic trace) → Geometry Builder (procedural R3F from `structural-spec.json`) → **Vision Verifier (independent grader)** → Narrative Composer (descriptions from cited sources only). Each agent **writes its reasoning trace to disk**, so thinking is auditable.

- **Deterministic verifier** `scripts/verify.mjs` recomputes checks **from the component coordinates themselves, not the spec's claimed dimensions.** Two layers: geometry assertions (bay rhythm, column height, puzuo stack, purlin intervals, roof rise…) + pixel checks (screenshot exists, non-blank, provenance-color coverage).
- **Vision Verifier runs in a fresh context window that has never seen the builder's reasoning** — only the rendered screenshots + reference drawings. *This is the blog's "isolated context windows," verbatim-in-spirit.* (PRD §7.4.)
- **Fail/revise/pass loop:** failed reports kept at `artifacts/verifier-report.*.failed.json`. "A logged fail→revise→pass cycle is evidence of autonomy, not a blemish."
- **Measured-reality guard (V09 / V08):** the verifier must NOT normalize the measured 1:2.67 roof toward the Yingzao Fashi 1:3 ideal. Measured wins; deviations are recorded as evidence, not corrected. `npm run demo:corrupt` raises the ridge toward the ideal and the verifier *must* refuse — a built-in proof the honesty gate bites.

### 1.3 Claim verification
| Blog claim | Repo evidence | Verdict |
|---|---|---|
| 339 incremental construction states | `artifacts/playback-states/state-000…338.json`; `manifest.totalStates: 339`, `states.length: 339` | ✅ **EXACT** |
| Click component → where it came from + why | `userData {componentId, provenance, citation}`; README "click annotated components to inspect names, descriptions, reference imagery" | ✅ **CONFIRMED** |
| Independent verifier sub-agents in isolated context | PRD §7.4 "fresh context window that has never seen the builder's reasoning"; `adversarial-verification.json` method = "fresh-context adversarial refutation" | ✅ **CONFIRMED** |
| Self-correction loops re-check placement | README + PRD fail→revise→pass; preserved `*.failed.json` | ✅ **CONFIRMED** |
| "all 20 tests passed" | `verifier-report.json` (Notre-Dame) = **13 checks, 13 pass** (V08–V14, P01–P03), vision 0.86; Nanchan = 12 geometry assertions; `adversarial-verification.json` = 8 verdicts (6 stand / 1 refuted / 1 uncertain) | ⚠️ **APPROX** — no artifact says "20"; likely 12+8 rounded. Blog gloss. |
| "ran entirely on Opus 4.8" | repo's own `CLAUDE_FABLE_5_BUILD_DAY_GUIDE.md` + PRD say **Fable 5** throughout | ⚠️ **DISCREPANCY** (see §4) |

---

## 2. Sim Francisco (2nd) — verifier + adversarial critic, in code

Rust (axum + sqlite) backend, two engines over one persona layer. **Census-seeded:** sampled from real US Census **PUMS microdata**, every agent carries the PUMS person-weight `PWGTP`; geography → PUMA; religion layered from Pew. **Personas are seeded + deterministic — no LLM per agent.** The LLM is called only for polling/reactions, **clustered into demographic archetypes** (one batched call answers ~12 archetypes → per-archetype YES probability).

### 2.1 The verifier + adversarial pattern (this is the gold)
From `README.md` + `BRIEF.md`:
> "**Verifier + adversarial critic** — before any milestone is 'done', an independent agent re-runs `validate` + contract tests, and a second adversarial agent tries to prove the gain is spurious (overfit / model-knowledge leakage / weight-gaming). Completion gates on both."

Anti-cheat harness (directly parallel to your BankerToolBench doctrine):
- **Frozen ground truth:** rubric targets = SF Dept of Elections certified canvass (514/514 precincts, certified 2024-12-03) + resolved Polymarket. "Targets are FIXED. Tuning may only touch persona/prompts/aggregation/turnout — never these targets or the validation slice."
- **Held-out split:** workflow `sf-tune-prompts` does "K prompt variants, train/held-out split, **promote only if it also wins held-out**."
- **Leakage guard by model choice:** predictions use **gpt-4o (Oct-2023 cutoff)** so 2024 outcomes *cannot* be recalled — "accuracy reflects reasoning, not memorization."
- `validate` binary exits 0 only if weighted rubric ≥ ~0.85; 41 `cargo test` green; deployed on fly.io; loops as `/sf:*` dynamic workflows; `NOTES.md` as memory outer-loop.
- **Honest frontend:** `verdict.js` explicitly states the per-dot green/red is a *stochastic visualization* engineered so on-screen yes-share == `p_yes` exactly — **not** a per-agent verdict. Honesty in the demo layer too.

### 2.2 Claim verification
| Blog claim | Repo evidence | Verdict |
|---|---|---|
| 10,000 Census-seeded residents | PUMS microdata + PWGTP weighting; `meta.validation_n: 2000` for grading | ✅ seeding CONFIRMED (exact count not asserted in README) |
| verifier agent + adversarial agent | README/BRIEF "Verifier + adversarial critic", fresh independent context, gates on both | ✅ **CONFIRMED** |
| 2024 vote 81.3% vs 83.8%; Prop A 70% vs 70.38% | rubric targets are the certified canvass; exact deltas live in scorecard/`session-log.md` (not re-derived here) | 🟡 plausible, target sources confirmed; exact numbers not independently recomputed |
| evolutionary clustering → ~300 personas, 10–100× cheaper | README describes archetype clustering (~12 archetypes/poll) + locality batching + cluster caching; "evolutionary"/"300"/"10–100×" not in README I read | ⚠️ **PARTIAL** — clustering + cost-motive real; the specific figures are BLOG-ONLY (may be in NOTES/session-log) |
| "Opus 4.8 wrote front+back end and verified end to end" | Claude Code built + ran verifier/critic; **gpt-4o is the in-sim reasoner** | ✅ for build/verify; ⚠️ predictions are gpt-4o, not Claude |

---

## 3. Custom Universe (3rd) — the odd one out (no evidence chain)

Repo is `Realtime 3D Canvas → AI Image Editing`. Three.js scene; you import/move/rotate/scale 3D objects, the WebGL viewport is captured and re-rendered ~realtime by a **self-hosted FLUX.2 Klein 9B (distilled, 4-step)** in-process on a local **H100** (~0.6s warm round-trip; ~34GB VRAM). Remote fallbacks: FAL (FLUX.2 Klein) / Fireworks (FLUX.1 Kontext). **TRELLIS** image→3D sidecar = the photo→3D object. **Blender USDZ** conversion = the Apple/RealityKit tie-in. Webcam mode = continuous edit loop.

- Claude's role (per `session-log.md`): chose models/tools and **verified live docs before coding** (`Flux2KleinPipeline`, gated weights, single-reference editing) + operated the remote GPU. Matches the blog's "use Claude to choose your tools."
- **No verifier/adversarial/rubric harness.** Provenance/evidence-chain theme does not apply here.
- Minor honesty flag: blog's "photorealistic 3D scene" is aspirational vs. what ships — real 3D *composition* + AI image *re-render of the viewport* (2.5D), not a fully reconstructed photoreal 3D scene.

---

## 4. The two discrepancies (why this teardown matters)

1. **Model name.** Blog title + body: "Claude Opus 4.8 Build Day," "verification ran entirely on Opus 4.8." Tekton's committed `CLAUDE_FABLE_5_BUILD_DAY_GUIDE.md` is literally "Claude **Fable 5** Build Day Participant Guide" (WiFi SSID "Fable 5"; "Fable 5 is the first Mythos-class model"), and the PRD says "**Fable 5** rebuilds Tang dynasty timber architecture." Cannot fully resolve which is canonical without the session logs; **the primary source and the blog conflict.** (Context: on the live deepswe board, Fable 5[max] 70% > Opus 4.8[max] 59% — Fable 5 is the stronger model, so a Fable-5 build day is plausible; the blog may be a post-hoc rebrand or simple inconsistency.)
2. **Predictor model.** Blog implies Claude; Sim Francisco's README is explicit: **gpt-4o** for the forecasts, *chosen* for its Oct-2023 cutoff as a leakage guard.

Both are exactly the class of claim a provenance layer exists to catch — even a first-party Anthropic blog has a model-attribution claim that its own linked primary source contradicts.

---

## 5. Map to NodeRoom — transferable vs already-built

**Already shipped (do NOT rebuild):** provenance metadata on artifacts; Trace Lens / Review Mode (Cmd-click → inspector, proof + trace, gated code); `cited-sources` (verbatim-quote boxing + `unsupported` flag); evidence-level attribution (coach claim → exact source cell); live capture pipeline (screenshot+box provenance); eval ledger (evalRuns/taskResults); design-floor deterministic gate; held-out + in-app-transfer anti-cheat.

**Genuinely net-new (steal these):**
1. **Evidence-class taxonomy + "honesty layer" toggle + zero-unsourced gate.** Tekton's 4 classes (measured/reconstructed/rule-derived/conjecture) + one toggle that colors the *entire* artifact by evidence class, + a hard ship-gate asserting zero unsourced components. You have verbatim verification (binary supported/unsupported); you do **not** have a *graded* evidence-class overlay or "the whole artifact's honesty in one switch." High-leverage for the Trace tab.
2. **Fresh-context adversarial REFUTATION stored in the trace.** Tekton's `adversarial-verification.json` keeps `{claim_id, verdict: stands|refuted|uncertain, confidence, corrected_value, reasoning}` — including the *refuted* and *uncertain* ones. Your eval ledger should persist refutation verdicts as first-class trace entries, not just passes. "Keep the failures as evidence" is a cheap, powerful honesty signal.
3. **Verifier re-derives from the artifact's realized state, never the agent's claimed numbers.** Audit your design-floor / eval verifier: does it recompute from the rendered DOM / stored cell values, or from what the agent *said* it did? The former is the only honest one.
4. **Leakage guard by knowledge-cutoff model choice.** For any benchmark with a memorizable gold answer, run the in-app reasoner on a model whose cutoff predates the answer. Directly applicable to BankerToolBench held-out cases.
5. **"Build process shares the product's discipline."** Both winners made *done* machine-checkable and kept fail→revise→pass artifacts in-repo as the proof of autonomy. Your `eval-gate` + `eval-regression-reviewer` already lean this way; the move is to *commit the failed-then-fixed verdicts* as shippable evidence, not scrub them.

---

## 6. One-line strategic read
The top two winners independently converged on **NodeRoom's exact thesis** — provenance + honest machine-checkable verification + adversarial refutation + anti-leakage held-out gates. That's strong external validation of the wedge. The differentiated, not-yet-built pieces are the **graded evidence-class honesty overlay** (one toggle, whole-artifact) and **persisting adversarial-refutation verdicts (incl. failures) as first-class trace**.
