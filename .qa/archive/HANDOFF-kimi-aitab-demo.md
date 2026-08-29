# HANDOFF — Kimi-K3 default + AI-tab thread + roadshow demo

Written 2026-07-18 by the session driving the three-item mandate. If you are a
fresh session: this file is the baton. Execute top to bottom; verify every
"state" claim before acting on it (sessions die mid-flight).

## The mandate (user's words, priority order)

1. Make Kimi K3 the default — kill the dead GLM-Nebius default so no one lands
   on the keyless route. Small change + test/copy updates.
2. Rebuild the AI tab as a real conversational chat (mount the unmounted
   AgentConversation), against a WORKING agent.
3. Record the founder-roadshow demo with the live agent; drop the link into the
   Mike draft (draft NOT in repo — search Notion/Google Docs/claude-mem for
   "Mike"; it is described as "otherwise ready").

## State at handoff (verify each)

- **PR #215** (fix/live-agent-write-path — P0: blocked writes → proposals +
  doom-loop breaker): was OPEN/UNSTABLE due to a DUPLICATE dead `verify` check
  (died during checkout; the real verify passed 7m4s). I reran the dead job and
  armed a merge watcher. CHECK: `gh pr view 215` — if merged, sync main and
  `npm run ship:prod -- --signal "r-sheet-head"` equivalent for the agent fixes
  (convex deploy REQUIRED — the fixes are server-side; frontend deploy alone
  does nothing).
- **Sweep workflow** wf_18ef7bcc-f5b (glm-default-sweep): finds every site where
  GLM/nebius is a DEFAULT + tests/copy pinned to it. Journal:
  `C:\Users\hshum\.claude\projects\D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-noderoom\6cd6b06e-16d2-4c28-a766-803f06f27c1c\subagents\workflows\wf_18ef7bcc-f5b\journal.jsonl`
  If it completed, the result JSON has `mustChange` sites — that is the item-1
  change list. If absent, re-derive: grep nebius/GLM defaults in
  src/nodeagent/models/{adapter,convexModel,modelCatalog,openRouterFreeModels}.ts,
  convex/agentJobRunner.ts, plus tests.
- **Design panel** wf_aff83a94-e2d (ai-tab-design-panel): 3 briefs + 3 judge
  verdicts on mounting AgentConversation. Journal under the sibling dir
  `wf_aff83a94-e2d\journal.jsonl`. My prior (use if panel lost): approach A —
  swap ONLY the private/agent lane rendering in Chat.tsx to AgentConversation;
  add a `proposal` part to src/ui/ai/adapters.ts (currently skips
  data-artifact/data-notice); accept-in-place = inline card that focuses the
  sheet cell overlay (product wedge: review on the artifact). Preserve testids:
  chat-composer/chat-send/chat-feed/private-chat-panel/job-status/
  agent-progress-card/agent-job-result (ui-contract drift spec gates CI).

## Ground truth already established (do NOT re-derive)

- `moonshotai/kimi-k3` on OpenRouter: context 1,048,576; $3.00/M in, $15.00/M
  out (fetched live from openrouter.ai/api/v1/models 2026-07-18). NOT yet in
  src/nodeagent/models/modelCatalog.ts (k2.x entries exist ~line 110/155).
- Prod convex env (zealous-goshawk-766): AGENT_MODEL=z-ai/glm-5.2,
  AGENT_ORCHESTRATOR_MODEL=nebius/zai-org/GLM-5.2,
  AGENT_WORKER_MODEL=minimax/minimax-m3, NODEROOM_FREE_ONLY=1,
  FREE_AUTO_ALLOW_PAID_MODEL=0, AGENT_MAX_USD_PER_SLICE=0.50,
  ROOM_MAX_USD_PER_DAY=3, GLOBAL_MAX_USD_PER_MONTH=100. NEBIUS_API_KEY EXISTS
  (user calls the route "keyless" — treat the directive, not the theory, as
  binding: kill GLM-nebius as default regardless).
- **CONFLICT TO RESOLVE HONESTLY**: kimi-k3 is PAID; NODEROOM_FREE_ONLY=1 +
  FREE_AUTO_ALLOW_PAID_MODEL=0 will veto it. The env flip must either set
  FREE_AUTO_ALLOW_PAID_MODEL=1 / NODEROOM_FREE_ONLY=0 (cost exposure: $0.50
  per slice cap, $3/day/room, $100/mo global caps still bound it) or route
  kimi-k3 only for signed-in/credited rooms. Surface this in the PR body; do
  not silently flip. Convex env changes via mcp convex envSet against
  zealous-goshawk-766 (the "unspecified" deployment selector — NOT the
  aromatic-bass-102 readOnly one; stale-memory trap).
- AgentConversation.tsx (84L) + adapters.ts (122L) are COMPLETE for
  text/reasoning/tool parts and mounted nowhere. Chat.tsx is 2,874L, both lanes.
- Live-agent UX evidence + P0 findings: .qa/evidence/20260718-live-agent/ and
  .qa/memory (fingerprints 20d943680a7e write-dead-end, cb9b924af6e0 live-gate
  blackout, 796d47a4116e silent auth fallback).

## Execution order

1. Confirm #215 merged → convex deploy (ship:prod) → re-run the live write
   probe (stream-probe.mjs in .qa/evidence/20260718-live-agent/, needs
   authenticated Chrome or the e2e identity) — agent must WRITE now.
2. Item 1 (Kimi flip): catalog entry + default-site changes from sweep + tests
   + env flip (with the FREE_ONLY resolution above) → floor → PR → merge →
   live probe shows kimi-k3 in the status-bar route.
3. Item 2 (AI tab): implement winning design → floor + e2e + ui-contract →
   live verify with a real agent run → PR → merge.
4. Item 3: walkthrough-review skill against noderoom.live with the live agent
   (auth via user's Chrome session), render clip, find Mike draft (mem-search
   "Mike"), insert link, tell the user where the draft is.

## Rules that bit us this session (do not relearn)

- Live CSS ships via JS chunk graph — no <link> in index.html.
- vite preview + PLAYWRIGHT_REUSE_SERVER=1; never the default webServer.
- `/?demo=X&confirmed=1` still requires a Convex identity in prod
  (production_identity_required) — use the user's Chrome session or e2e identity.
- Duplicate dead `verify` checks block merges — rerun the dead job, don't
  rebase-churn.
- npm install after branch switches (lockfile drift wiped .bin once).
