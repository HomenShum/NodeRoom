> **Historical handoff (superseded).** Start with
> [`docs/NEXT_SESSION.md`](./NEXT_SESSION.md), the canonical NodeRoom handoff as of
> 2026-07-20. The content below is retained for provenance and may describe
> obsolete implementation or deployment state; revalidate it before use.

---

# Codex Handoff — NodeRoom AI Elements adoption + audit follow-through

**Date:** 2026-07-14 · **Author:** prior Claude session · **For:** a Codex agent picking up cold.

Read this top-to-bottom once, then work Goal 1. Everything here is verified state, not aspiration.

---

## 0. Where things stand (all shipped + live on noderoom.live)

- **Both prod targets are synced right now.** Frontend (Vercel, git `main`, 0 unpushed) and
  Convex prod (`zealous-goshawk-766`, 299 functions live, additive schema deployed 2026-07-14).
- **Three AI Elements primitives are wired into the real `src/ui/Chat.tsx` and live-verified on prod:**
  - `Reasoning` — the "Thought for…" disclosure (commit `e5c594e2`).
  - `MessageResponse` (Streamdown) — the agent response markdown, pinned to 13.5px (commit `0ebe0470`).
  - `Suggestion` — the composer contextual-prompt chips, 11px, `applySlash` preserved (commit `75888973`).
- **Every AI Elements primitive renders on-brand** in the render check (`ai-elements-check.html` →
  `src/ui/ai/AiElementsShowcase.tsx` + `AiElementsGallery.tsx`), screenshotted into
  `docs/design/ui-contract/20260714-ai-elements/` and documented in `docs/design/UI_CONTRACT.md`
  ("AI Elements Adoption" section — the source of truth for status + KEEP/REFINE/REJECT).
- The `$100/month` spend cap is live in prod (`GLOBAL_MAX_USD_PER_MONTH=100` on `zealous-goshawk-766`).

**Uncommitted background you will see (leave it unless a goal needs it):** ~250 files under
`docs/`, `scripts/`, `.proofloop/` (generated receipts/reports) plus a stray `trace-live-debug.png`.
None are `src/` or `convex/` code. Do NOT blanket-commit them.

---

## 1. Ground rules — do not violate

- **Two prod targets, both required.** `git push` → Vercel (frontend). `npm run convex:deploy` →
  `zealous-goshawk-766` (the `dev:` prefix IS prod). `aromatic-bass-102` is labelled "prod" by the
  Convex CLI but is a **read-only standby — never deploy there**. `npm run convex:deploy:guard`
  hard-fails if `.env.local` points elsewhere.
- **Gates.** `npm run floor` after every change (root typecheck + convex typecheck + vitest).
  `npm run prod:gate` before shipping. Claim "done/passed/live" ONLY from a deterministic gate,
  official scorer, proof receipt, or live-DOM fetch of noderoom.live — never from build success or
  a worker's assertion.
- **Immutable files (never edit):** `scripts/proofloop.mjs`, `scripts/agent-improvement-loop.ts`,
  `tests/harnessChangeEval.test.ts`, `.github/workflows/`, `src/eval/evalTrustPolicy.ts`,
  `src/eval/architectureBudget.ts`, `evals/evalStore.ts`.
- **The proof contract is the moat — compose, don't surrender.** NEVER drop run receipts, CAS
  version state, lock/draft state, or work-plan approval to adopt a component. AI Elements render the
  generic chrome; NodeRoom's proof affordances stay as children. A cutover that removes
  `data-testid="agent-source-receipt"` / `agent-progress-card` / `agent-lock-released-receipt` is a
  regression, not progress.
- **Design.** Ground in `src/app/styles.css` tokens (`design-reference/` is gitignored and absent —
  do not invent hex/radius/size). `docs/design/UI_CONTRACT.md` is the visual authority. Terracotta =
  agent provenance + selection; green = success ONLY; amber = needs review. Run `npm run design:audit`
  after UI edits (warnings are pre-existing; it exits 0).
- **Every AI Elements cutover must:** preserve the surface's `data-testid`s, keep the feature set,
  stay CSP-clean (Streamdown is; re-verify Shiki/`CodeBlock` before wiring), match the chat's scale
  (13.5px body / 11px chips — Streamdown defaults to 16px, size it down), and pass the e2e content
  assertions. See the three shipped cutovers for the exact pattern.

---

## 2. Goal 1 (highest value, do this first): compose `Tool` into `AgentProgressCard`

**Why:** `AgentProgressCard` (`src/ui/Chat.tsx`, ~line 653) is the largest remaining bespoke agent
component. AI Elements `Tool` (`src/components/ai-elements/tool.tsx`) is the maintained replacement
for its collapsible tool-call chrome. This is the one remaining cutover with real "less custom code"
value — but it touches the proof surface, so it needs care (that's why the prior session did not
drive-by it).

**The compose rule for this goal:** use `Tool` / `ToolHeader` / `ToolContent` for the *shell*
(collapsible, status badge, tool name), and keep NodeRoom's existing **source-receipt chips, lock
receipts, and per-step trace links as children inside `ToolContent`**. Do not replace them.

**Files:**
- `src/ui/Chat.tsx` — `AgentProgressCard` (~653) and `AgentUnifiedStream` (~renders `activityParts`).
- `src/components/ai-elements/tool.tsx` — `Tool`, `ToolHeader` (needs `{ type, state }`), `ToolContent`,
  `ToolInput`, `ToolOutput`, `getStatusBadge`.
- `src/ui/ai/ai-elements.css` — add a scoped `.r-agent-tool` rule if sizing needs correcting (mirror
  `.r-agent-response` / `.r-composer-suggestions`).

**Acceptance criteria (all must hold):**
1. `data-testid="agent-progress-card"`, `agent-source-receipt`, and `agent-lock-released-receipt`
   still present and populated.
2. `npm run floor` green; `full-modern-ux-bar.spec.ts` 2/2 (it asserts progress + receipts).
3. Render-verified on the real memory-mode chat (drive `/free` long job → inspect the tool card),
   then live-verified on noderoom.live after deploy. Screenshot into the design dir.
4. `docs/design/UI_CONTRACT.md` "AI Elements Adoption" table: `Tool` moves `scaffolded → live`.
5. Zero CSP violations.

**Verification recipe (proven, use it):**
```bash
npm run floor
npx vite build && npx vite preview --port 5293 --strictPort --host 127.0.0.1 &
# drive with a temp e2e spec in e2e/_*.spec.ts using ./fixtures publicChat(page);
# CardioNova research → "/free fill the remaining Q3 variance cells through the long job path"
# assert agent-progress-card + agent-source-receipt still render; screenshot; delete the temp spec.
PLAYWRIGHT_PORT=5293 PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5293 npx playwright test full-modern-ux-bar.spec.ts
# ship: git push (frontend). No convex change expected here — confirm with `git status convex/`.
# live-verify: drive https://noderoom.live/?mode=memory the same way; assert testids + CSP-clean.
```

---

## 3. Goal 2: the rest of the AI Elements set — hold unless asked

Per the analyst verdict in `UI_CONTRACT.md`, do NOT wire these without an explicit request:
- **Proof-bearing (compose later, same pattern as Goal 1, one at a time):** `Sources`, `Confirmation`.
- **No live surface (wiring = inventing UI = scope creep):** `Terminal`, `Agent`, `Artifact`, `Task`,
  `ChainOfThought`, `Checkpoint`.
- **Already covered:** `Shimmer` (the "thinking" state lives inside `Reasoning`).
- **Re-verify CSP first:** `CodeBlock` (Shiki), `PromptInput`, `ModelSelector`, `Context`.

---

## 4. Goal 3: audit follow-ups (from `docs/audit/DIRECTION_AUDIT_2026-07-12.md`)

Lower priority; each is self-contained. Pull the exact items from that report + `docs/GAPS_NOT_DONE.md`:
- README full byte-slim: migrate architecture deep-dives → `docs/ARCHITECTURE.md`, changelog sections
  → `docs/CHANGELOG.md` (the correctness fixes + honesty banner already shipped; this is the bulk move).
- Media-skill trio consolidation (`readme-walkthroughs` / `produce-episode` → `walkthrough-review`) —
  note: `.claude/skills/` is gitignored/local; coordinate with the owner.
- False "NOT BUILT" headers on shipped features (PDF citation box, capture pipeline, skill RAG) —
  flip to as-built (audit C6–C10).

---

## 5. What "done" means for this handoff

A goal is done when: its acceptance criteria pass, `npm run floor` is green, the change is pushed,
Vercel shows a Ready deploy newer than the commit, and a live fetch/drive of noderoom.live confirms
the DOM signal. Update the `UI_CONTRACT.md` status table in the same commit. Do not mark done from
chat or a screenshot alone.
