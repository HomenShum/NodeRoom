# Dynamic Skill Retrieval for NodeAgent ("skill RAG")

_2026-06-19. How NodeAgent discovers and loads external Agent Skills on demand from a catalog (e.g. [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills), 65k★), instead of pre-installing every skill. This is **progressive disclosure at catalog scale** and rides NodeRoom's existing OKF retrieval._

## The idea

The Agent Skills standard already does progressive disclosure for *installed* skills: only each skill's `name`+`description` sits in context until a task triggers it. The next level up: when there are **thousands** of skills in a catalog, you can't even afford all their descriptions. So:

```
catalog (awesome-claude-skills, frontend-slides, our own .claude/skills, …)
  → build-skill-index  (parse each SKILL.md frontmatter → skill records)
  → ingest as OKF concepts (type "Agent Skill")           [reuses okfConcepts + embeddings]
  → skill_search(query)  semantically retrieve the top-k relevant skills   [reuses semanticSearchScan]
  → load_skill(id|url)   fetch that skill's SKILL.md body ON DEMAND
  → inject its tools/instructions into the current reasoning frame
```

Only the **top-k** matched skill descriptions ever enter the prompt; only the **chosen** skill's body is loaded. The model picks skills the way it already picks tools — by semantic match on the `description`.

## Current state (grounded — reuse, don't rebuild)

### OKF (the retrieval substrate) — already exists
- **`okfConcepts`** table (`convex/schema.ts`) — generic concept store: `type`, `title`, `description`, `body`, `searchText`, `tags`, `frontmatter`, `sourceKind`, `resource`, `visibility`, `confidence`, `contentHash`. Indexed by room/type/status + a full-text search index.
- **`okfChunks`** — `vectorIndex("by_embedding", { dimensions: 64 })`; chunks embedded by `embedOkfText()` (OpenAI / Gemini / local fallback) via the async `okfIndexer.drainBatch()` outbox.
- **`semanticSearchScan`** (`convex/okf.ts`) — hybrid **0.7·vector + 0.3·lexical** ranking with ACL filtering.
- OKF types in `src/nodeagent/okf/types.ts` (22 types today). Retrieval tools in `src/nodeagent/retrieval/tools/okfTools.ts`. Contracts in `.agent/okf.skill.md` + `.agent/retrieval.skill.md`.

### Harness — already exists (and a correction)
- A skill = a `[NAME]_TOOLS: AgentTool[]` array, loosely re-exported from `src/nodeagent/index.ts`. **There is no central `NODEAGENT_SKILLS` registry or `detect()`/`requiredApproval` pattern** (the earlier design paste assumed one — it does not exist; do not build against it).
- `AgentTool` (`src/nodeagent/core/types.ts`): `{ name, description, schema: Zod, execute(args, rt) }`.
- `runAgent()` (`core/runtime.ts`) is passed the **full** `tools` array; `frameRunner.selectFrameTools(frame, tools)` filters by `frame.toolAllowlist`. **All tools are loaded upfront; there is no RAG selection.** Tool descriptions reach the model via the AI-SDK `tools` param, not the system prompt — so adding/removing tools needs **no prompt-format change**.

## Target change set (minimal, grounded)

| # | Change | File | Note |
|---|---|---|---|
| 1 | Add `"Agent Skill"` to OKF types | `src/nodeagent/okf/types.ts` | +1 line |
| 2 | Add optional skill fields to `OkfNodeRoomExtension` (`skill_install`, `skill_trust`, `skill_categories`, `skill_version`, `skill_source_catalog`) | `src/nodeagent/okf/types.ts` | +5 optional fields |
| 3 | `indexSkillFromCatalog` mutation → `createOkfConcept({type:"Agent Skill"})` → `upsertConceptRow(sourceKind:"external_skill")` → auto-embeds via existing outbox | `convex/okf.ts` | ~50 lines; **0 schema changes** (reuses `okfConcepts`) |
| 4 | Extend `OkfConceptFilter` with `skill_categories`, `skill_trust_min` | `src/nodeagent/retrieval/types.ts` | +2 optional |
| 5 | `okf_search_skills` retrieval tool (pre-filters `type:"Agent Skill"`, runs `semanticSearchScan`) | `src/nodeagent/retrieval/tools/okfTools.ts` | ~10 lines |
| 6 | `skill_search(query)` + `load_skill(id\|url)` agent tools | `src/nodeagent/tools/skillSearchTool.ts`, `loadSkillTool.ts` (NEW) | `load_skill` fetches SKILL.md body on demand |
| 7 | RAG select top-k skills before allowlist filter | `src/nodeagent/core/frameRunner.ts::selectFrameTools(frame, tools, goal?)` | insert `selectRelevantSkills(goal, tools, k)` before name filter |
| 8 | Agent contract for skill discovery | `.agent/skills.skill.md` (NEW) | when to search/load + trust rules |
| 9 | Catalog format + ingestion (the substrate) | `src/nodeagent/okf/skillCatalog/` (NEW) | format spec + `build-skill-index.mjs` + generated `skill-index.json` |

**OKF concept mapping** (skill record → `okfConcepts` row):

| Skill record | OKF concept field |
|---|---|
| `name` | `title` |
| `description` | `description` + drives `searchText` (the retrieval hook) |
| `categories` | `tags` |
| `source.url` / `install` | `resource` + `frontmatter.noderoom.skill_install` |
| `trust` | `frontmatter.noderoom.skill_trust` + `confidence` (verified .95 / community .6 / untrusted .3) |
| SKILL.md body (on `load_skill`) | `body` (chunked + embedded) |

## Trust & safety (non-negotiable)

A skill can **run code**. The Agent Skills standard itself says "use only trusted skills." So:
- **Catalog allowlist** — only ingest from known catalogs (awesome-claude-skills, frontend-slides, anthropics/skills, our own `.claude/skills`). `skill_trust` ∈ `local | verified | community | untrusted`.
- **Untrusted skill content is data, not instructions** — a retrieved SKILL.md is subject to NodeRoom's existing prompt-injection trust boundary (it cannot issue privileged commands just because it was loaded).
- **Human approval before executing a freshly-loaded community skill's scripts** — surface trust + source in the approval, mirroring the production write-gate.
- **`needs_review` carries through** — a skill loaded to *produce client output* is held to the same evidence-honesty bar as everything else (see the deck skill / Parity).

## Phasing
- **P0 (done, portable):** the catalog **format** + `build-skill-index.mjs` builder + generated `skill-index.json` + the `.agent/skills.skill.md` contract. Self-contained, no Convex — proves the loop and makes our own skills discoverable.
- **P1:** `indexSkillFromCatalog` mutation + the `"Agent Skill"` OKF type (changes 1–3). Skills become first-class OKF concepts, embedded + searchable per room.
- **P2:** `okf_search_skills` + `skill_search` tools + `OkfConceptFilter` extension (changes 4–6). The agent can semantically discover skills.
- **P3:** `load_skill` on-demand loader + RAG `selectRelevantSkills` in `selectFrameTools` (changes 6–7). Full dynamic load + top-k selection.

P1–P3 touch live `convex/**` and `src/nodeagent/core/**` (deploy = Convex functions, **not** just git push; coordinate with the Codex fleet). Apply on approval.
