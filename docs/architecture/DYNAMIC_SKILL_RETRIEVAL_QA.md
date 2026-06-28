# Dynamic Skill Retrieval — repeatable QA

_Regression-proof verification for skill RAG (see `DYNAMIC_SKILL_RETRIEVAL.md`). Run **all** of T0–T4 locally before a prod deploy, then re-run the deployment-facing checks (T3, and T4 against the prod app) on prod. Last green: 2026-06-19. **Topology (2026-06-28):** `noderoom.live` is served by the `kind: dev` deployment `zealous-goshawk-766` (Vercel-backing) — run the deployment-facing checks against THAT, not the `kind: prod` deployment `aromatic-bass-102`, which is read-only/standby and does not back the live site. (The earlier "against aromatic-bass-102" record predates this clarification.)_

## What's under test
The end-to-end loop: **catalog → `skill_search` (discover) → `load_skill` (load on demand) → wired into the live agent** (server tool registry + frame allowlists), with the honesty/SSRF guarantees intact.

## T0 — Catalog builds (deterministic)
```bash
node src/nodeagent/okf/skillCatalog/build-skill-index.mjs --seed src/nodeagent/okf/skillCatalog/seed.awesome-claude-skills.json
```
**Expect:** `Wrote …/skill-index.json — 12 skills ({"local":6,"community":6}).` and **no** "EMPTY description" warning.

## T1 — Typecheck (deterministic)
```bash
npx tsc --noEmit -p convex/tsconfig.json      # → exit 0  (the indexSkillFromCatalog mutation)
npx tsc --noEmit                              # → exit 0  (whole project)
```

## T2 — Behavior + wiring tests (deterministic, the core regression guard)
```bash
npx vitest run tests/skillRag.test.ts tests/skillRagWiring.test.ts
```
**Expect:** `30 passed` (24 behavior incl. SSRF-blocked, bound-read, local path-traversal, honest-status, RAG; 6 wiring: `skill_search`+`load_skill` in the server registry, allowlisted in `plan`/`execute`, exposed by `selectFrameTools` for a deck goal, and **not** leaked into `intake`).

## T3 — Deployment exposes the mutation (live, deterministic)
```bash
npx convex run okf:indexSkillFromCatalog '{}'        # dev
# NB: the default (no flag) already runs against zealous-goshawk-766 — the dev-kind deployment that noderoom.live serves. Do NOT use --prod (it targets the read-only/standby aromatic-bass-102, which does NOT back the live site).
```
**Expect:** `ArgumentValidationError: Object is missing the required field 'description'` — this proves the function is **registered** (not "Could not find function") and shows the validator: `description` required, `requester` actor-proof auth, `trust` enum, `body` optional (pure mutation, no fetch). Exit 1 is expected (validation, not a real call → no data written).

## T4 — App boots clean against the deployment (live browser)
```
preview_start "noderoom"  (dev, port 5273)   |  "noderoom-prod" for the built/prod frontend
```
Then: `preview_snapshot` → landing page renders ("A live room for banker-led diligence", stats, feature cards); `preview_console_logs level=error` → **No console logs**; `preview_logs level=error` → **No server errors**.
**Why this is the right browser check:** skill RAG is an agent-harness feature with **no client/UI surface** — its behavior is proven by T2, and the browser's job here is to confirm the convex deploy didn't regress app boot. Screenshot proof: `preview_screenshot`.

## T5 — Live agent smoke (manual — needs an authenticated session + model keys)
Cannot be driven deterministically from CLI (the agent's tool choice + auth are runtime). Procedure:
1. Open the app → enter a display name → **Run startup diligence demo** (or join a room).
2. Ask the room agent a procedure task, e.g. *"turn these notes into a pitch deck"* or *"is there a skill for competitive ad analysis?"*.
3. In the agent run trace, confirm **`skill_search`** was invoked (and **`load_skill`** if it chose one), returning a catalog skill (e.g. `powerpoint` locally, or a `community` skill like `competitive-ads-extractor`).
4. Confirm a `community`/`untrusted` skill's scripts are gated behind approval (`executionPolicy: requires_human_approval`).
> Backstop if you can't run T5: T2 runs the real `skill_search`/`load_skill` `execute()` on the real catalog, and the wiring test proves an `execute`-phase frame exposes both tools — so the loop is covered for regression even without a live model.

## Pass criteria
All of T0–T4 green (and T5 when a session is available). Any failure blocks deploy.

## Won't-regress guarantees
- **T2** fails if anyone drops `skill_search`/`load_skill` from `SERVER_PRODUCTION_ROOM_TOOLS` or from `FRAME_TOOL_ALLOWLIST.{plan,execute}`, or weakens the SSRF/bound-read/path guards.
- **T1** fails on any type break in the mutation or tools.
- **T3** fails if the mutation is renamed/unexported or the deploy didn't ship it.

## Running the same suite on prod
T0–T2 are deployment-agnostic (run as-is). For **T3**, run against the production-serving deployment `zealous-goshawk-766` (the default dev deployment — do NOT use `--prod`, which targets the read-only/standby `aromatic-bass-102`). For **T4**, point the app at the live frontend (`https://noderoom.live`, or `preview_start "noderoom-prod"`). T5 against a prod room.
