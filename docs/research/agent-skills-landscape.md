# How Z.ai, Manus, Claude Cowork & OpenAI actually implement "skills"

_Research date: 2026-06-19. Primary-source where possible; confidence + caveats flagged per claim. Produced from a multi-agent research workflow (taxonomy + Manus + Z.ai completed & high-confidence) plus direct web verification of the Anthropic/Cowork and OpenAI pieces. Adversarial verifiers were still running at write time — corrections, if any, are expected to be minor._

---

## TL;DR — the one finding that reframes the question

**"Skill" stopped being a metaphor and became a literal cross-vendor file format.** In Oct 2025 Anthropic shipped **Agent Skills** (a `SKILL.md` folder + "progressive disclosure"), and on **Dec 18, 2025** promoted it to an **open standard at agentskills.io** — running the exact MCP playbook. By mid-2026 the *same* `SKILL.md` format is consumed by **Claude Code/Cowork, OpenAI Codex, Google Gemini CLI, GitHub Copilot, Cursor, Manus, and Z.ai's GLM skills.**

So the honest answer to "how are they doing skills" is: **they are increasingly doing the *same thing* at the format layer, and differing only at four other layers** — runtime/surface, invocation UX, distribution, and whether they even have a native runtime.

| Platform | Is "skill" a real `SKILL.md` system? | One-line reality |
|---|---|---|
| **Anthropic** (Claude Code / claude.ai / API / **Cowork**) | **Yes — the origin & reference impl** | Defined the standard; Cowork is a desktop *surface* that runs the same Skills + subagents on your files. |
| **OpenAI** (Codex / API / Apps SDK) | **Yes — adopted the standard** | Codex loads `SKILL.md` from `~/.agents/skills/`; official `github.com/openai/skills` catalog. Separately, Apps SDK = MCP, Custom GPTs = a different (older) thing. |
| **Manus** | **Yes — explicitly adopted the standard** | "Manus Embraces Open Standards: Integrating Agent Skills" — same `SKILL.md`, wrapped in a GUI + `/` slash-command, run on its cloud VM. |
| **Z.ai / Zhipu** | **Partial** | Ships a `SKILL.md` repo (`zai-org/GLM-skills`) **for other people's agents** (Claude Code etc.) — no Z.ai-native skill runtime. Its own Slides/Artifacts features are **not** skills. |

---

## 1. Vocabulary (so the comparison is apples-to-apples)

The single biggest source of confusion is that "skill" gets used for five different things. The clean distinctions (all from primary docs):

- **Agent Skill** = a *folder* with a `SKILL.md` (instructions + bundled `scripts/`/`references/`/`assets/`) that packages **procedural knowledge** — *how to do a task*. **Model-invoked**: the model reads it off disk when a task matches its `description`. It adds **knowledge**, not capability.
- **Tool / function call** = one typed function (JSON Schema) the model asks to invoke; your code (or a hosted tool) runs it. The **atomic unit of capability**.
- **MCP server** = a process exposing a *bundle* of capabilities over JSON-RPC (primitives: **resources, prompts, tools**). The **standard wire protocol** — the plumbing beneath several of these products.
- **Artifact / output** = the *product* the model makes for you (a deck, doc, chart, web page). The **result**, not an input capability.
- **Custom GPT** = OpenAI's no-code *assembled assistant* (instructions + knowledge files + capabilities + Actions). A whole assistant, not a portable file.
- **Plugin** = a *distribution wrapper* that can bundle skills + MCP configs + commands together.
- **Plain prompt/knowledge injection** = dumping text into context — always-on, eager. **This is the baseline Skills improve on.**

> **The crux:** MCP/tools add **capability** (new actions/data). Agent Skills add **procedure** (how to use capabilities you already have). They are *complementary layers*, deliberately shipped as two open standards by the same vendor (MCP = capability/transport; Agent Skills = procedural-knowledge/packaging on top).

---

## 2. The reference implementation — Anthropic Agent Skills

This is the spec everyone else is converging on, so it's worth stating precisely.

**Shape:**
```
my-skill/
├── SKILL.md       # REQUIRED: YAML frontmatter + Markdown instructions
├── scripts/       # OPTIONAL: code the agent RUNS (output enters context, code doesn't)
├── references/    # OPTIONAL: docs loaded on demand
└── assets/        # OPTIONAL: templates/fonts/images used in output
```

**`SKILL.md` frontmatter** (from the agentskills.io spec):
- **Required:** `name` (≤64 chars, lowercase/digits/hyphens) · `description` (≤1024 chars — *what it does AND when to use it*; this is the load-bearing discovery hook).
- **Optional:** `license`, `compatibility` (env requirements), `metadata` (arbitrary k/v), `allowed-tools` (experimental pre-approved tools, e.g. `Bash(git:*) Read`).

**Progressive disclosure (the actual mechanism, 3 levels):**
1. **Metadata** — only `name`+`description` of *every* installed skill sits in the system prompt (~100 tokens each). Install hundreds with no real context cost.
2. **Instructions** — when the model judges a skill relevant, it reads the full `SKILL.md` body off disk (<5k tokens recommended).
3. **Resources & code** — bundled files are read/executed only as needed; **a script's code never enters context, only its output does** → "effectively unlimited" bundled content.

**Invocation:** no registration call, no function schema — **discovery is semantic**, driven entirely by the `description`. **Surfaces:** pre-built skills (PowerPoint/Excel/Word/PDF) on claude.ai, the API (inside the code-execution container), AWS, Microsoft Foundry; custom skills authored in Claude Code or uploaded via the Skills API. **Distribution:** the folder itself (zip/git/Skills API) + a partner directory (Canva, Notion, Figma, Stripe…). **Security:** "use only trusted skills" — a skill can run code.

**Claude Cowork** *(medium confidence — characterized from current secondary sources; the workflow's primary-source pass was still running)*: Anthropic's **agentic desktop app aimed at non-technical users**, doing "real work on your files." Architecturally it is **a product *surface*, not a different skill mechanism** — the same Agent Skills/plugins that run in Claude Code run in Cowork, and it leans on **subagents** (which, as of June 2026, can spawn their own subagents). So Cowork's answer to "how do skills work" = *the standard above, delivered in a desktop UI for everyday work.*

---

## 3. OpenAI — adopted the standard, but has several overlapping things

OpenAI historically had **no** thing called "skills." That changed: **OpenAI adopted the Agent Skills standard.**

- **Codex skills (Dec 2025):** a skill is a `SKILL.md` in `~/.agents/skills/` that **Codex loads automatically when the task matches** — same format, same progressive-disclosure idea. Official page: *"Agent Skills – Codex."*
- **Official catalog:** `github.com/openai/skills` — a curated Skills catalog (reported ~13K stars / ~35 curated skills by Mar 2026; *secondary, treat counts as approximate*).
- **Skills in the API:** OpenAI copies a skill folder into an execution environment so the model can read `SKILL.md` and run its scripts — i.e. the same "instructions + scripts + assets, loaded as needed" model.
- **The other OpenAI things that are NOT Agent Skills (don't conflate):**
  - **Apps SDK / ChatGPT Apps** = **built on MCP** — an "app" is effectively an MCP server + a rendered UI widget.
  - **Custom GPTs** = no-code assembled assistants (Instructions + Knowledge + Capabilities + **Actions**, where Actions = REST via OpenAPI). Older, ChatGPT-locked.
  - **Agents SDK** (Python/TS) = the framework for building agentic apps (tools, handoffs, tracing, voice).

So OpenAI's "skills" = the **same `SKILL.md` standard** (in Codex + API); its *agent/app* story is a separate MCP-based stack.

---

## 4. Z.ai / Zhipu — `SKILL.md` for *other people's* agents; its own features aren't "skills"

This one is bifurcated and the most marketing-confusable:

- **`zai-org/GLM-skills`** is real and uses **the Anthropic `SKILL.md` format almost verbatim** — `name`/`description`/`metadata` frontmatter, markdown body, `scripts/`. **But:** the README states these target **external harnesses (Claude Code, OpenCode, OpenClaw, AutoClaw)** — there is **no Z.ai-native skill runtime**. They're installed via a third-party installer (`npx clawhub@latest install glmocr …`) and mostly wrap a Zhipu cloud API (needing `ZHIPU_API_KEY`). So Z.ai's "skills" are **interop assets for the Claude-Code ecosystem**, not a first-class Z.ai platform.
- **The consumer features you saw — AI Slides, Artifacts, Full-Stack — are NOT skills.** They're **hosted agents + artifact rendering**: the GLM Slide/Poster agent runs `prompt → web search → generate → refine → export PDF` (PPTX/in-browser editing marked "coming soon"); "Artifacts" = GLM emitting standalone HTML/SVG/code rendered in a side panel (the Claude-Artifacts pattern). Addressable via `POST https://api.z.ai/api/v1/agents` with an `agent_id`.
- **Capability layer:** OpenAI-compatible **function calling** + a server-side **"MCP server calling"** feature (model discovers/calls external MCP tools).
- **Model note:** **GLM-5.2 is real**, release notes dated **2026-06-16** (1M context, two thinking-effort levels, MIT weights) — *not* vaporware. ("Better Artifacts"/"template saving" from the marketing copy could **not** be tied to a primary doc — treat as unconfirmed.)

---

## 5. Manus — the cleanest "we adopted the open standard" story

- **Manus Skills (announced Jan 27, 2026)** explicitly adopt Anthropic's Agent Skills standard — blog literally titled *"Manus AI Embraces Open Standards: Integrating Agent Skills."* Same `SKILL.md` + 3-level progressive disclosure.
- **Mechanism:** a Skill is a folder (`.zip`/`.skill`/folder) with `SKILL.md` + scripts/resources. Manus runs in an **isolated Ubuntu sandbox VM** (full filesystem + shell + browser + code execution), so it natively reads the skill dir and runs its Python/Bash — Manus calls this "native architectural compatibility."
- **Invocation (UX delta):** explicit — type **`/`** in the composer to pick a Skill; the agent then loads its instructions and executes the workflow on the VM. (Underlying standard also supports description-driven auto-trigger.)
- **Authoring & distribution (the nicest part):** **"Build with Manus"** captures a *successful task* into a Skill with one click; plus **Upload**, an **official curated library**, and **Import from GitHub**. A **Team Skill Library** is on the roadmap. (No paid storefront — library + GitHub, not a marketplace.)
- **Separate from skills:** **MCP Connectors** (Gmail, Notion, Stripe, Slack…), Custom MCP servers, Zapier. Skills *orchestrate* those tools; they don't replace them.
- *(Note: manus.im currently shows "part of Meta" / "© 2026 Meta" — acquisition not confirmed from a primary release here; medium confidence.)*

---

## 6. Side-by-side: where they actually differ

| Axis | Anthropic (Claude Code/Cowork) | OpenAI (Codex) | Manus | Z.ai / GLM |
|---|---|---|---|---|
| **Format** | `SKILL.md` (origin) | `SKILL.md` (adopted) | `SKILL.md` (adopted) | `SKILL.md` (adopted, for export) |
| **Native runtime?** | Yes (code-exec container / Cowork desktop) | Yes (Codex CLI, API container) | Yes (cloud Ubuntu VM) | **No** (runs in *other* harnesses) |
| **Invocation** | Semantic (description-matched, auto) | Auto-load when task matches | Explicit `/` slash-command (+ auto) | Whatever the host harness does |
| **Authoring** | Hand-write / skill-creator | Hand-write / catalog | **One-click "Build with Manus" from a session** | Hand-write in repo |
| **Distribution** | Skills API, plugins, partner directory | `github.com/openai/skills` catalog | GUI: build / upload / official lib / GitHub import | `npx clawhub install`, git clone |
| **Capability layer** | MCP + bash/code tools | MCP (Apps SDK) + tools | MCP Connectors + VM tools | function-calling + MCP-server-calling |
| **"Skill" honesty** | First-class | First-class (also has Apps/GPTs that aren't skills) | First-class | **Real for export; its own Slides/Artifacts are NOT skills** |

**The four real differentiators (since the format is shared):**
1. **Runtime/surface** — desktop app (Cowork) vs CLI (Codex) vs always-on cloud VM (Manus) vs none (Z.ai).
2. **Invocation UX** — silent semantic match (Anthropic/OpenAI) vs explicit slash-command (Manus).
3. **Authoring** — Manus's "capture a successful run into a Skill" is the standout UX nobody else has.
4. **Distribution** — git catalogs (OpenAI/Z.ai) vs Skills API + partner directory (Anthropic) vs in-product GUI library (Manus).

---

## 7. What this means for your BotLearn `powerpoint` skill

- **Your skill is portable by *construction*, not luck.** Because you authored it as a standard `SKILL.md` + scripts, the *same bundle* can run in Claude Code, **OpenAI Codex (`~/.agents/skills/`)**, Gemini CLI, Cursor, Manus, and any Clawhub/GLM-style harness. That's a genuine distribution surface for the leaderboard, not just BotLearn.
- **Your differentiator is *not* the format (everyone shares it) — it's the *governance procedure* inside it.** The honesty gate (provenance tags + "refuse to render fabrication") is exactly the kind of **procedural knowledge** Agent Skills are *for*. That's defensible originality on a commoditized format.
- **Confirm BotLearn's installer/format** maps to this open standard before publishing (it almost certainly does — the whole ecosystem is `SKILL.md`).
- **Demo angle for VCs:** "skills converged on one open format in 8 months; the moat moved up a layer to *what procedure you encode* — mine encodes finance-grade evidence honesty."

---

## Sources

**Standard & taxonomy**
- Anthropic Engineering — Equipping agents for the real world with Agent Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Agent Skills overview (Claude platform docs): https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Agent Skills open standard spec: https://agentskills.io/specification
- MCP spec 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18
- Claude tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- SKILL.md as open standard (overview): https://www.agensi.io/learn/agent-skills-open-standard

**OpenAI**
- Agent Skills – Codex: https://developers.openai.com/codex/skills
- Official skills catalog: https://github.com/openai/skills
- Skills in the OpenAI API (cookbook): https://developers.openai.com/cookbook/examples/skills_in_api
- Skills + Agents SDK (blog): https://developers.openai.com/blog/skills-agents-sdk
- Apps SDK (on MCP): https://developers.openai.com/apps-sdk

**Z.ai / Zhipu**
- zai-org/GLM-skills: https://github.com/zai-org/GLM-skills
- Z.AI release notes (GLM lineup incl. GLM-5.2 2026-06-16): https://docs.z.ai/release-notes/new-released
- GLM Slide/Poster Agent: https://docs.z.ai/guides/agents/slide
- Z.AI MCP calling: https://docs.z.ai/guides/capabilities/mcp-call

**Manus**
- Manus AI Embraces Open Standards: Integrating Agent Skills: https://manus.im/blog/manus-skills
- Manus Skills docs: https://manus.im/docs/features/skills
- Manus MCP Connectors: https://manus.im/docs/integrations/mcp-connectors

**Anthropic Cowork (medium confidence — secondary)**
- Top Claude Agent Skills (Nimble): https://www.nimbleway.com/blog/anthropic-claude-agent-skills
- Everything Anthropic shipped in 2026: https://linas.substack.com/p/anthropic-claude-2026-every-launch-guide

## Confidence & caveats
- **High:** the SKILL.md open standard + adoption by Anthropic/OpenAI/Manus/Z.ai/Gemini; the Anthropic spec details; Z.ai's GLM-skills targeting external harnesses; Manus's adoption + VM runtime; GLM-5.2 is real.
- **Medium:** Claude Cowork product specifics (secondary sources; primary-source pass still running); Manus "now part of Meta"; OpenAI catalog star/skill counts.
- **Unconfirmed:** Z.ai "Better Artifacts"/"template saving" as named features; exact Cowork↔Skills UI.
- The workflow's adversarial verifiers (Manus, Z.ai) + primary-source Anthropic/OpenAI agents were still running at write time; I'll fold in corrections when they complete.
