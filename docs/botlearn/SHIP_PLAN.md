# BotLearn "Super Solo" Hack Day — Ship Plan

**Event:** Super Solo: AI Agent Skills Hack Day · Inference.ai, Redwood City · **Jun 20, 2026**
**Build sprint:** 2:30–5:30 PM · Demos 6 PM · Awards 7 PM
**Leaderboard:** fully online, **closes Jun 27, 12:00 PM PT**
**Source:** https://www.botlearn.ai/en/events/super-solo-hack-day

---

## The scoring function (this drives every decision)

| Signal | Weight | Notes |
|---|---|---|
| Install / download | **1×** | Only from *claimed* agents (real users). Farming dead. |
| **Field note** | **20×** | Real user runs the skill on a real task + posts an eval via the BotLearn evaluation prompt, linked back. Un-farmable. |

> Their words: *"real usage is the optimal strategy."* **Win condition = a stranger gets real value on first run and writes about it.** Originality > technical complexity (stated twice).

### Hard DQ gates
- OPC-focused (one-person-company scenario)
- **Actually runs** — installed + successfully run by ≥1 other registered BotLearn user
- Published on SkillHunt with a clear README + scenario description
- ✕ No plagiarism (no direct copy from GitHub/Clawhub) · ✕ No idea-only · ✕ No no-op (must change agent behavior)
- Submit before **Jun 27, 12:00 PM PT**

---

## What we ship

A **portable Agent Skill suite** (model-agnostic SKILL.md + scripts, **zero NodeRoom backend**), distilled from NodeRoom's DNA. NodeRoom the app is the *origin story* in the live demo — it is NOT the submission (a stranger cannot install a Convex deployment).

### Suite taxonomy (simple names, surface-based)

| Category | What it does (portable) | Subskills | Contest role |
|---|---|---|---|
| **powerpoint** | Notes/data → gated **deck-plan** → **HTML deck** (preview + comment-edit) → PDF/pptx export | `outline`, `deck-from-notes`, `evidence-pass`, `html-render`, `export` | **HERO — submit + demo** |
| **spreadsheet** | Notes/sources → clean `.xlsx`/CSV with honesty-tagged cells | `extract`, `enrich`, `dedupe`, `review-flags` | Strong #2 — also published |
| **notebook** | Raw notes → structured, source-tagged markdown notebook | `capture`, `structure`, `entities`, `followups` | Front-door of the chain |
| **interface-nav** | Open tabs / artifacts / chats / downloads | (n/a) | **Internal NodeAgent only** — app-coupled, not a contest entry |

### The original through-line (anti-no-op, anti-plagiarism, field-note magnet)
Every skill in the suite enforces **evidence honesty**:
- Never fabricate. Every claim/cell/slide gets a provenance tag: `verified | manual | needs_review`.
- Surface a **needs-review / open-questions list** instead of guessing.
- This governance layer on top of the stock `pptx`/`xlsx` skills is the genuine original behavior — it is *why* the skill is not a re-skin and *why* a user trusts the output enough to post a note.

### Architecture decision (2026-06-19): govern, don't reimplement
Research (`docs/research/agent-skills-landscape.md`) showed `SKILL.md` is now a **cross-vendor open standard** and even the *generators* are commoditized (e.g. `frontend-slides`, 22k★, does HTML-first slides as a Skill). So the suite's edge is the **governance/proof loop**, not the generator. Each skill = **structured source-of-truth → honesty gate → HTML-first artifact (agent's frontend strength; previewable + comment-editable) → optional export (PDF/pptx/xlsx)**. Provenance mini-standard (`data-status`/`data-source` → hoverable citations) is shared across the suite and is the first instance of **Parity** (`docs/design/PARITY.md`). `powerpoint` pivoted accordingly: `build_html.py` (primary) + `evidence_pass.py` (gate) + `build_pptx.py` (optional native export).

---

## Build order

**Tonight (Jun 19)**
1. ✅ Author **`powerpoint`** hero skill at `.claude/skills/powerpoint/`: `SKILL.md` + `references/deck-plan-schema.md` + `scripts/evidence_pass.py` (honesty gate) + `scripts/build_html.py` (primary preview/comment-edit renderer) + `scripts/build_pptx.py` (optional self-contained python-pptx export — no dependency on the local `pptx` skill, so it runs standalone in a stranger's agent) + `assets/examples/`.
2. ✅ Self-test end-to-end: gate passes clean input (2 verified · 2 manual · 2 needs_review), **blocks** the fabrication fixture (exit 1), renders a 6-slide deck with source footers, `⚠ needs review` markers, `[TK]` placeholders, and an auto "To Verify" slide. Verified by extracting rendered slide text.
3. ✅ SkillHunt-facing **README.md** (in skill dir) + **demo script & distribution plan** ([DEMO_AND_DISTRIBUTION.md](DEMO_AND_DISTRIBUTION.md)).

**Tomorrow (Jun 20, sprint)**
4. Polish hero from judge-room feedback; publish to SkillHunt; get ≥1 other user to install + run (clears the "actually runs" gate).
5. If time: publish `spreadsheet` as #2.

**Jun 20 → Jun 27 (leaderboard)**
6. Share the "One-click Evaluate" prompt with real solo founders; drive the install → real task → **field note** loop (the 20× lever).
7. Publish `notebook`; tell the chain story (notebook → spreadsheet → powerpoint).

---

## Open items / risks
- **Confirm BotLearn's exact Skill format** on SkillHunt docs before publishing (assumption: standard Agent Skills / SKILL.md). Verify at publish time.
- **No-op risk** on `powerpoint`: mitigate by making the evidence-pass + needs_review output the visible, demoable delta vs. a plain deck generator.
- **Plagiarism optics**: we *extend* (not copy) the official Anthropic `pptx` skill; document the original governance layer in the README.
- **Scope gravity**: suite is the story; hero is the bet. Do not let `notebook`/`spreadsheet`/`nav` steal the hero's finishing time.
