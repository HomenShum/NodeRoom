# @homenshum/nodeagent-engines

Give any app a chat-native agent workspace that works like Claude Code or Codex: a person types a real task, a real agent engine does it inside a scoped project folder, and the page shows the work as it happens — the plan, the helpers running in parallel, tools being found and loaded, skills being created and reused, context being compacted, files being written, and an independent check of the result.

One package, two parts:

- **A worker** (`nodeagent-worker`) that owns every run: the project folder, permissions, budgets, a durable event log, the tool catalogue, the skill lifecycle and the final independent verification. It never shows sample or scripted work; with no keys it says "Setup required".
- **A React component** (`<NodeAgentWorkspace />`) that streams the worker's events into a progressive-disclosure UI.

The agent loop itself is the provider's own SDK, so you get each vendor's native subagents, compaction, tool search and sessions instead of a re-implementation:

| Engine id | Runs on | Helpers | Compaction | Tool search | Skills | Goals | Resume | USD cost |
|---|---|---|---|---|---|---|---|---|
| `claude-agent-sdk` | `@anthropic-ai/claude-agent-sdk` 0.3.312 | native | native | native | native (load, refresh) | native (TodoWrite) | native session | from engine |
| `codex-app-server` | `@openai/codex` 0.165.0 (JSON-RPC) | native | native | native | native discovery (load inferred) | Node tools (native goal seen only in qualification) | native thread | price table |
| `openai-agents` | `@openai/agents` 0.21.0 | native (agent-as-tool) | native (Responses) | native (`tool_search`) | Node tools | Node tools | native state | price table |
| `google-adk` | `@google/adk` 2.4.0 | Node (parallel child runners) | native | Node tools | native (SKILL.md) | Node tools | Node snapshot | price table |
| `nodeagent-universal` | `ai` 6 (Anthropic, OpenAI, Google, OpenRouter) | Node | Node (estimated tokens) | Node | Node | Node | Node | price table |

"Native" means the vendor SDK does it; "Node" means this package implements it. The statuses come from real, paid qualification runs in [`qualification/*.json`](qualification/). Those runs used a test host (not the worker) and predate later catalogue and policy fixes. Codex's goal events were seen only there, on a model since removed from its list. Its skill-load events are inferred from reading a `SKILL.md`; discovering the skill is native. What each engine did through the real worker and UI is in `evidence/agent-workspace-20261029/`. Unknown cost is shown as unknown, never as $0.

## Quick start (about five minutes)

```bash
npm install @homenshum/nodeagent-engines react react-dom
```

1. Put provider keys in `.env.local` next to where you start the worker (only the engines you use need keys):

   ```
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   GOOGLE_GENERATIVE_AI_API_KEY=...
   OPENROUTER_API_KEY=...
   ```

2. Start the worker:

   ```bash
   npx nodeagent-worker
   # nodeagent-worker listening on http://127.0.0.1:4317
   ```

3. Mount the component and proxy `/agent-api` to the worker (Vite shown; any dev server or reverse proxy works):

   ```tsx
   import { NodeAgentWorkspace } from "@homenshum/nodeagent-engines/react";
   import "@homenshum/nodeagent-engines/react/styles.css";

   export default function App() {
     return <NodeAgentWorkspace apiBase="/agent-api" title="Agent Workspace" />;
   }
   ```

   ```ts
   // vite.config.ts
   server: { proxy: { "/agent-api": { target: "http://127.0.0.1:4317", rewrite: (p) => p.replace(/^\/agent-api/, "") } } }
   ```

Open the page, create a project from a template, pick an engine and send a task. A complete working app is in [`examples/nodeagent-workspace-quickstart`](../../examples/nodeagent-workspace-quickstart) — it installs this package only from its packed tarball.

## What the UI shows (and what backs each layer)

| Layer | Shows | Backed by |
|---|---|---|
| Task brief | goal, real status, current action, engine/model, elapsed, cost, Stop / Resume / Hand off | run record + events |
| Work outline | the agent's plan, marked as the agent's claim | `goals.updated` |
| Verified by Node | the independent verifier's checks, separate from the agent's claims | `check.result` (independent) |
| Helpers | parallel child agents, nested, with status and tool counts; click to filter | `helper.*` with child ids |
| Timeline | messages, tool cards grouped per turn, tool search → load, skill lifecycle, compaction markers, policy denials | tool/skill/context events |
| Artifacts | files the run wrote, with a viewer for tables, notebooks, code | `artifact.written` (hashed by Node) |
| Developer drawer | raw events, counters with units, usage, permission decisions, the engine's capability matrix | all of the above |

Runs live in the worker and never depend on the browser staying open; a reload replays the run's events from the worker and restores the viewer's project, run and engine choice from the browser's storage.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NODE_AGENT_HOME` | `~/.nodeagent-workspace` | Store, projects and engine state. Keep it outside any git repo so engines don't load that repo's instruction files. |
| `NODE_AGENT_WORKER_PORT` | `4317` | Worker port (binds 127.0.0.1 only). |
| `NODE_AGENT_ENV_FILES` | `./.env.local,./.env` | Comma-separated env files for provider keys. |
| `NODE_AGENT_DEFAULT_MAX_USD` / `_MAX_TURNS` / `_MAX_WALL_MS` | none | Budget applied when a request doesn't set one; recorded on each run. |
| `NODE_AGENT_DEFAULT_AUTOCOMPACT_TOKENS` | engine default | Context window at which engines compact (Claude's CLI floor is 100 000). |
| `NODE_AGENT_ALLOWED_ORIGINS` | localhost only | Extra browser origins allowed to call the worker. |

## Safety model

- Each run works in its own project folder. Node checks every native file and shell call at execution time: paths must stay inside the folder, template-restricted paths can't be read or written, `.claude/` `.codex/` `.agents/` are Node-only, shell is one allow-listed command (POSIX or the PowerShell read-only equivalents), and network tools are denied.
- Engines get exactly the credentials Node hands them, in a clean environment with an isolated config directory (never your personal `~/.claude` or `~/.codex`).
- A new skill must pass validation (metadata, secret scan, a scan for network/process APIs) and its own example **and** counterexample tests before Node activates it; only Node writes active skills.
- "Done" is never the agent's word: templates can ship an independent verifier that runs after the engine stops, outside its context.

Know the ceilings:

- **Code the agent runs is not sandboxed.** Allowed commands such as `node <workspace script>` and `npm test` run code the agent wrote, as your OS user with full disk and network access. Path and restricted-file rules cover file tools and shell reads, not that code. The same applies to a template's checks and to the independent verifier, which runs the agent's own tests. Use a container or VM when that matters.
- **The skill scan is advisory.** It catches literal secrets and obvious network or process calls. It is not a security boundary.
- **Any page on localhost can call the worker.** It binds to 127.0.0.1, checks `Origin` and `Host` against DNS rebinding, and has no user accounts.

Put it behind your own auth, and an OS-level sandbox, before anyone else uses it.

## Templates and verifiers

A template is `fixtures/<id>/template.json` plus starter files; see [`fixtures/README.md`](fixtures/README.md). The bundled `diligence-pack` is a fully synthetic SMB-lending diligence source pack with three tasks (full, inbox update, deep diligence) and an independent verifier hardened by adversarial review.

## API

The worker's HTTP + SSE API is typed in [`src/api.ts`](src/api.ts); the event and engine contract is [`src/contract.ts`](src/contract.ts). To add an engine, implement `EngineAdapter` (`descriptor`, `availability`, `start`), translate native messages into contract events, route Node tools through `host.tools.call`, and add a qualification script that proves each capability you claim.

## Known limits

- Only the Claude engine was used for the long-horizon proof; the others were proven on the full and inbox tasks.
- Codex needs a model its binary has metadata for (`gpt-5.5`, `gpt-5.6-*`, `gpt-6-*`); other models lose `apply_patch`.
- Google Gemini 3.5 Flash has no price on Google's published page, so its cost shows as unknown.
- Graceful shutdown on Windows signals is untested; a killed worker marks its runs interrupted on the next start.
