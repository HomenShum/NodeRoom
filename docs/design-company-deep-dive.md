# Design: Company Deep Dive + Knowledge Graph Visualization

## Part 1: Generalized Company Deep Dive Skill

### Problem

The original `linkedin-deep-dive` skill was too rigid — it hardcoded LinkedIn-specific search patterns (`site:linkedin.com`) and prescribed a fixed 7-phase procedure. Real company research needs to be **source-agnostic**: sometimes LinkedIn is the best source, sometimes Crunchbase, sometimes SEC filings, sometimes news articles. The agent should **self-adapt** its research strategy based on what it discovers, not follow a script.

### Solution: `company-deep-dive` Skill (v2.0.0)

Replaced `linkedin-deep-dive` with `company-deep-dive` — a skill that teaches the agent a **research loop**, not a rigid procedure:

```
Goal → Discover → Extract → Enrich → Verify → Structure → Repeat or Finalize
```

#### Key Design Decisions

1. **Self-Loop-Engineering**: The skill instructs the agent to decide at each step which tool to use, whether to go deeper, whether to try a different source, and when coverage is sufficient. The frame loop (Plan → Act → Observe → Evaluate) handles this naturally.

2. **Source Strategy Table**: Instead of hardcoding `site:linkedin.com` queries, the skill provides a table of source types (LinkedIn, News, Research synthesis, SEC filings, Crunchbase, Product Hunt, YC/TechCrunch) with when to use each and which tool maps to each. The agent chooses.

3. **Adaptive Discovery**: If LinkedIn yields little, the agent tries Crunchbase, news, press releases, podcast transcripts. If the target is a fund, it looks for portfolio announcements. If it's a startup, it looks for Product Hunt, YC, TechCrunch.

4. **Output Contract**: Regardless of research path, output is always: spreadsheet (Category | Entity | Key Facts | Source | Date), chat summary, provenance per fact, confidence flags.

5. **Coverage Self-Evaluation**: Step 6 asks the agent to evaluate its own coverage — did it find ALL portfolio companies? Research EVERY key person? If incomplete, loop back with different queries.

#### Files Changed

- `src/nodeagent/tools/loadSkillTool.ts` — replaced `linkedin-deep-dive` with `company-deep-dive` in `BUNDLED_LOCAL_SKILLS`
- `src/nodeagent/okf/skillCatalog/skill-index.json` — replaced catalog record
- `src/nodeagent/core/reasoningFrames.ts` — `you_search`, `you_research`, `you_finance_research` already in `FRAME_TOOL_ALLOWLIST` and `DEEP_DIVE_TOOL_ALLOWLIST`

#### Frame Loop Mapping

```
Goal: "Deep dive into [Company]"
  ↓
Plan: skill_search → load_skill("company-deep-dive") → identify target type (VC, startup, public co)
  ↓
Act: you_search("[Company]") → discover presence
  ↓ you_search("site:linkedin.com [Company]") → try LinkedIn
  ↓ you_search("[Company] portfolio backed funded") → try portfolio angle
  ↓ you_research("[Company] investment thesis") → synthesize
  ↓ you_finance_research("[Company]") → if public, get financials
  ↓
Observe: collected entities (portfolio companies, people, events, products)
  ↓ self-adapt: if sparse, try different sources; if rich, go deeper
  ↓
Evaluate: cross-reference claims, flag unverified as needs_review
  ↓ ask: did I find everything? If not, loop back
  ↓
Store: write_locked_cell_results → spreadsheet
  ↓
Finalize: say() — synthesized summary + spreadsheet
```

---

## Part 2: Knowledge Graph & Backlinks Visualization

### Inspiration & Research

Researched best practices from Obsidian, NotebookLM, and React visualization libraries:

#### Obsidian Graph View
- **Force-directed layout** using d3-force simulation (similar to `d3-force-3d`)
- **Canvas 2D rendering** for performance (supports thousands of nodes)
- **Node sizing** proportional to reference count (more links = bigger node)
- **Local graph** shows current note + neighbors within configurable depth (1-5 hops)
- **Global graph** shows complete vault structure
- **Filter system**: by path, tags, attachments, existing-only, search terms
- **Force controls**: center force, repel force, link force, link distance
- **Color groups** definable per filter expression
- **Backlinks panel**: shows all notes linking to current note with surrounding context
- **Outgoing links**: shows all links from current note, including unresolved (non-existent) notes
- **Smart hover**: highlights connected nodes and edges
- **Directional arrows**: green (forward), red (backward), purple (bidirectional)

#### NotebookLM
- **Source-grounded**: every answer cites specific sources
- **Mind Maps**: interactive visual map of how ideas/sources relate; click nodes for summaries
- **Three-panel layout**: Sources | Chat | Studio — fluidly adapts
- **Citations**: inline citations showing exact quotes from sources
- **Connections**: Gemini identifies deeper connections across documents

#### React Libraries Evaluated

| Library | Rendering | Stars | Key Strengths | Fit for NodeRoom |
|---|---|---|---|---|
| **react-force-graph-2d** | Canvas 2D | 4k+ | Zoom/pan, node dragging, d3-force, lightweight | Best fit — performant, simple, proven |
| **OKVE** | D3 + SVG | new | Force + radial layouts, search, filter chips, tooltips, PNG export | Good — built-in UX features |
| **reagraph** | WebGL | 1k+ | 3D, path-finding, lasso, clustering, 12+ layouts | Overkill for notebook backlinks |
| **Synapse** | react-force-graph-2d | new | Obsidian-clone, bi-directional links, @mentions | Reference implementation |
| **NoteConnection** | D3 SVG + Canvas | new | DAG layout, focus mode, 10k+ nodes | Good for hierarchical views |

**Recommendation**: `react-force-graph-2d` for the initial implementation. It's the most widely used, performant (Canvas 2D), and maps directly to NodeRoom's data model. OKVE is a strong alternative if we want built-in search/filter chips without custom UI.

### Feature Design: Knowledge Graph for NodeRoom TipTap Notebook

#### What Gets Visualized

NodeRoom rooms contain multiple artifact types that reference each other:

```
Note (TipTap) ──mentions──→ Company (Research Sheet row)
     ↕                           ↕
Wiki ──links──→ Sheet Cell       Event (Research Sheet row)
     ↕                           ↕
Agent Notes ──cites──→ Source URL  Person (Research Sheet row)
```

**Node types**:
- **Note artifacts** (TipTap notebook content)
- **Wiki artifacts** (agent-authored knowledge base)
- **Sheet rows** (individual entities in research spreadsheets — companies, people, events)
- **Source URLs** (captured web pages, cited sources)
- **Agent trace events** (research actions that produced findings)
- **Notebook blocks** (already parsed by `notebookProcessing.listNotebookBlocks`)

**Edge types**:
- **mentions**: note text mentions an entity name that matches a sheet row
- **links_to**: wiki links to a sheet cell or source
- **cites**: agent trace cites a source URL
- **produced_by**: sheet row was produced by an agent job (trace)
- **related_to**: two entities share a category or source

#### Data Model

The graph is **derived**, not stored. It's computed from existing room data:

```typescript
interface GraphNode {
  id: string;          // artifact ID or entity hash
  label: string;       // entity name or artifact title
  type: "note" | "wiki" | "sheet_row" | "source" | "trace" | "block";
  group: string;       // category for color coding
  size?: number;       // proportional to connection count
  artifactId?: string; // parent artifact
  elementId?: string;  // cell/element within artifact
  meta?: { source?: string; date?: string; verified?: boolean };
}

interface GraphEdge {
  id: string;
  source: string;      // node ID
  target: string;      // node ID
  label: string;       // "mentions", "cites", "links_to", etc.
  type: "mention" | "link" | "citation" | "produced_by" | "related";
  weight?: number;     // connection strength
}

interface RoomGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

#### Graph Construction (Client-Side)

The graph is built from existing store data — no new Convex tables needed:

1. **Notes & Wiki**: Parse TipTap HTML for entity names (company names, person names) that match sheet rows. Use the same entity extraction that `scanActivityRow` already does for passive intelligence.
2. **Sheet rows**: Each row in a research spreadsheet becomes a node. The Category column determines the group color.
3. **Sources**: Source URLs in the Source column of research sheets become source nodes.
4. **Trace events**: Agent trace events that produced sheet rows create `produced_by` edges.
5. **Notebook blocks**: Already-parsed blocks from `listNotebookBlocks` become block nodes, linked to their parent note.

#### UI Integration

**Where it lives**: A new "Graph" tab in the `ArtifactPanel` tab bar, alongside Wiki, Spreadsheet, Research, Note, and Wall.

```tsx
// Artifact.tsx — new TabId
type TabId = "wiki" | "sheet" | "research" | "note" | "wall" | "graph";
const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: "wiki", label: "Wiki", Icon: BookOpen },
  { id: "sheet", label: "Spreadsheet", Icon: Table2 },
  { id: "research", label: "Research", Icon: Search },
  { id: "note", label: "Note", Icon: FileText },
  { id: "graph", label: "Graph", Icon: Network },  // NEW
  { id: "wall", label: "Wall", Icon: StickyNote },
];
```

**Two view modes**:

1. **Local Graph** (default): Shows the currently selected artifact + its immediate neighbors (1-2 hops). Updates reactively as the user navigates between tabs/artifacts. This is the Obsidian "local graph" pattern.

2. **Global Graph**: Shows all entities in the room. Toggle button in the graph header. This is the Obsidian "global graph" pattern.

**Interactive features** (inspired by Obsidian + OKVE):

- **Force-directed layout** with d3-force simulation
- **Node sizing** proportional to connection count
- **Color coding** by group (Portfolio Company = blue, Key Personnel = green, Event = orange, Source = gray, Note = purple)
- **Click node** → opens the corresponding artifact/tab and focuses the entity
- **Hover node** → highlights connected nodes and edges (smart hover)
- **Zoom/pan** with mouse wheel and drag
- **Node drag** to reposition
- **Search filter** — filter nodes by text match
- **Group filter chips** — toggle visibility by category
- **Directional arrows** — green (forward link), red (backlink), purple (bidirectional)
- **Stats overlay** — node count, edge count, density
- **Escape to deselect**

**Backlinks panel** (below or beside the graph):

When a node is selected, show a backlinks list — all entities that reference the selected entity, with surrounding context. This mirrors Obsidian's backlinks panel and NotebookLM's citation system.

```
Backlinks for "MAI Agents"
─────────────────────────
📝 Note → "...MAI Agents raised $25M led by Kleiner Perkins..."
📊 Research Sheet → Row 3: Portfolio Company, Yuchen W., $25M Series A
🔗 Source → techcrunch.com/mai-agents-series-a
🤖 Trace → Job #abc123 produced this row via you_search
```

#### Component Architecture

```
KnowledgeGraphPanel (new component)
├── GraphControls
│   ├── Layout toggle (Local | Global)
│   ├── Search input
│   ├── Group filter chips
│   └── Force settings (repel, link distance, center force)
├── ForceGraphCanvas (react-force-graph-2d)
│   └── Custom node renderer (color by group, size by degree)
├── BacklinksPanel
│   └── BacklinkItem[] (source artifact, context snippet, edge type)
└── NodeTooltip (on hover)
```

#### Implementation Plan

**Phase 1 — Graph data derivation** (no new backend):
- `useRoomGraph(roomId)` hook in `store.tsx` — derives `RoomGraph` from existing artifacts
- Entity matching: compare note text (TipTap HTML stripped to text) against sheet row Entity column values
- Source extraction: parse Source column URLs from research sheets
- Trace linkage: match trace events to sheet rows via artifactId + elementId

**Phase 2 — Graph rendering**:
- Add `react-force-graph-2d` dependency
- Create `KnowledgeGraphPanel` component in `src/ui/panels/`
- Wire as new tab in `ArtifactPanel`
- Local graph mode (selected artifact + neighbors)
- Basic interactions: click to navigate, hover to highlight, zoom/pan

**Phase 3 — Backlinks & advanced features**:
- Backlinks panel below graph
- Global graph toggle
- Search filter
- Group filter chips
- Force simulation controls
- Stats overlay

**Phase 4 — Agent integration**:
- When agent writes a research sheet row, automatically create edges to mentioned entities
- When agent captures a source, link it to the sheet row that produced it
- Surface graph insights in the NotebookReadModelPanel (e.g., "This note references 3 portfolio companies not yet in the research sheet")

#### Why Not Store the Graph in Convex?

The graph is **derived data** — it's computed from artifacts, sheet rows, and trace events that already exist. Storing it separately would create:
- Sync issues (graph out of date when artifacts change)
- OCC conflicts (same problem we solved in Passive Room Intelligence)
- Duplication of data already in the room

Instead, the graph is computed client-side from the existing `useStore()` data, similar to how `NotebookReadModelPanel` derives blocks from the notebook. This keeps it always in sync and avoids backend complexity.

---

## Part 3: E2E Test Coverage

### Company Coverage Ledger

All companies discovered through UpScaleX LinkedIn posts and their E2E test status:

| # | Company | Founder | Sector | E2E Test | Status |
|---|---|---|---|---|---|
| 1 | MAI Agents | Yuchen W. | AI Agents | ✅ Persona 11 | Verified |
| 2 | Blueberry | Nima Mozhgani | Commerce Agent | ✅ Persona 12 | Verified |
| 3 | BeFreed | Jisong L. | Consumer AI | ✅ Persona 13 | Verified (Pinterest/Google) |
| 4 | Daxo | — | Robotic Hands | ✅ Persona 14 | Verified |
| 5 | Dex | Reni Cao | Consumer Tech | ✅ Persona 15 | Verified |
| 6 | Expertise AI | Hao Sheng | Sales Assistant | ✅ Persona 16 | Verified |
| 7 | Midas Touch | Cordelia Xiao | Commerce | ✅ Persona 17 | Verified |
| 8 | WorkDuo AI | Fiona Lau | Commerce AI | ✅ Persona 18 | Verified |
| 9 | AdsGency AI | Bolbi Liu | Ad Tech | ✅ Persona 19 | Verified ($10M ARR) |
| 10 | Dimension Studios | Ali Mirzaei | TikTok Shop | ✅ Persona 20 | Verified |
| 11 | Sentrial | — | YC W26 Agent | ✅ Persona 21 | Verified |
| 12 | Maverick | — | TBD | ✅ NEW — Gap Test 1 | Added |
| 13 | Second Axis | — | Hackathon Co-host | ✅ NEW — Gap Test 2 | Added |
| 14 | Retriever AI | Arjun Chintapalli | AI Agent | ✅ NEW — Gap Test 3 | Added |
| 15 | DSALTA | Jon Can Ozdoruk | TBD | ✅ NEW — Gap Test 4 | Added |
| 16 | AllNutrition | Alireza Faghaninia | Health/Nutrition AI | ✅ NEW — Gap Test 5 | Added |
| 17 | Hirey AI | Walter Wu | HR/Hiring AI | ✅ NEW — Gap Test 6 | Added |
| 18 | Tioga | Jean-Nicolas Vollmer | TBD | ✅ NEW — Gap Test 7 | Added |
| 19 | Pinpoint | Joshua Cohen | Commerce Infra | ✅ NEW — Gap Test 8 | Added |

### Key Personnel Coverage

| Person | Role | E2E Test | Status |
|---|---|---|---|
| Mark Liu | UpScaleX Managing Partner | ✅ Personas 1-5 | Verified |
| Alan Zong | UpScaleX Co-founder | ✅ Personas 6-8 | Verified |
| Keyan Li | Strategic Advisor | ✅ NEW — Gap Test 9 | Added |

### Workflow Coverage

| Workflow | E2E Test | Status |
|---|---|---|
| LinkedIn deep dive (one-prompt) | ✅ Persona 22 | Verified |
| Portfolio company deep dive | ✅ Persona 22b | Verified |
| Portfolio tracker generation | ✅ Persona 23 | Verified |
| Founder network mapping | ✅ Persona 24 | Verified |
| Batch gap company research | ✅ NEW — Batch Test | Added |
| Event ecosystem mapping | ✅ Persona 21b | Verified |
| Agentic commerce thesis | ✅ Persona 21c | Verified |

### Test File

`e2e/hackathon-loop-engineering.spec.ts` — now contains **30+ test personas** covering:
- UpScaleX portfolio companies (19 companies)
- Key personnel (3 people)
- Workflow scenarios (7 workflows)
- Gap company research (8 companies + 1 advisor + 1 batch test)

---

## Files Changed (All Parts)

| File | Change |
|---|---|
| `src/nodeagent/tools/loadSkillTool.ts` | Replaced `linkedin-deep-dive` with `company-deep-dive` skill body |
| `src/nodeagent/okf/skillCatalog/skill-index.json` | Replaced catalog record |
| `src/nodeagent/core/reasoningFrames.ts` | Tool allowlists already updated (you_search, you_research, you_finance_research) |
| `e2e/hackathon-loop-engineering.spec.ts` | Added 10 new test personas (8 gap companies + Keyan Li + batch test) |
| `docs/design-company-deep-dive.md` | This design doc (replaces `design-linkedin-deep-dive.md`) |

## Status

- ✅ Company deep dive skill generalized (v2.0.0, source-agnostic, self-loop-engineering)
- ✅ E2E tests added for all 8 gap companies + Keyan Li + batch test
- ✅ Knowledge graph visualization researched (Obsidian, NotebookLM, React libraries)
- ✅ Knowledge graph feature designed (data model, UI integration, implementation plan)
- ✅ Design doc updated with generalized architecture + graph visualization + coverage ledger
- ✅ Knowledge graph IMPLEMENTED (PR #95, commit b0a0f9bc): `src/ui/panels/KnowledgeGraph.tsx` — a "Graph"
  work-surface tab rendering a derived node-link view (nodes = artifacts colored by kind, edges = real
  title-token "mentions"), reusing `@xyflow/react` (no new dep), derived client-side (no Convex tables),
  works in memory mode. Verified live (9 nodes / 8 edges, node-click opens artifact, design-gate + CI green).
  Remaining graph polish (backlinks side-panel, sheet-row/source/trace node types, local-vs-global modes) is future.

---

## Part 4: Person Deep Dive — GitHub, Papers, Projects, MDX Profiles

### Problem

The `company-deep-dive` skill covers company/fund research, but a user also needs to deep dive on an **individual person** — a founder, engineer, investor, or researcher. This means going beyond LinkedIn and news to:

- **GitHub repos**: What codebases have they built or contributed to? What languages? What's their technical footprint?
- **Academic papers**: Have they published? Where? Co-authors? Citations?
- **Past projects**: What have they built before their current company? Side projects? Open-source contributions?
- **Events**: Conference talks, hackathon participation, demo days, pitch competitions
- **Codebase analysis**: What problem does each repo solve? Tech stack? Architecture decisions? Community traction?
- **MDX presentation**: Present the profile as a rich, structured MDX document (not just a spreadsheet)

### Research: Available APIs and Approaches

#### GitHub REST API (Free, No Auth Required for Public Data)
- `GET /users/{username}` — profile: bio, company, location, followers, created_at
- `GET /users/{username}/repos?sort=pushed&per_page=100` — all public repos
- `GET /repos/{owner}/{repo}/languages` — language breakdown per repo
- `GET /users/{username}/events/public` — recent activity (pushes, PRs, issues, releases)
- `GET /users/{username}/orgs` — organizations contributed to
- **Rate limit**: 60 req/hr unauthenticated, 5,000 req/hr with `GITHUB_TOKEN`
- **GraphQL API** (`repositoriesContributedTo`) — repos the user contributed to but doesn't own

#### Academic Paper APIs
- **Semantic Scholar Academic Graph API** — free, no auth required (1 RPS shared). Search by author name, get papers, citations, co-authors, venues. `https://api.semanticscholar.org/graph/v1`
- **OpenAlex API** — fully open, 6 entity types (Works, Authors, Sources, Institutions, Publishers, Concepts). Interlinked knowledge graph.
- **arXiv API** — preprints, search by author. `https://export.arxiv.org/api/query`
- **Crossref API** — DOI lookup, metadata by author. Free, no auth.
- **Google Scholar** — no official API; SerpApi provides a paid scraping proxy (discontinued for profiles)

#### MDX for Profile Presentation
Researched best practices from developer portfolio sites:
- **MDX** = Markdown + JSX components — allows rich formatting (tables, callouts, code blocks, diagrams) within markdown
- **Frontmatter** for metadata (name, role, company, date)
- **Component injection** — custom components (Callout, TechStack, FileTree, ProcessFlow) for structured sections
- **Mermaid diagrams** for career timeline visualization
- **KaTeX** for math in academic papers
- **rehype-pretty-code / Shiki** for syntax highlighting in code examples

### Solution: `github_profile` Tool + `person-deep-dive` Skill

#### `github_profile` Tool (New)

Created `src/nodeagent/skills/search/githubProfileTool.ts`:

- **Tool name**: `github_profile`
- **Args**: `username` (required), `includeRepos`, `includeContributions`, `includeLanguages` (optional booleans, default true)
- **Returns**: Profile (bio, company, location, followers), top 30 repos by stars, language distribution (top 10), recent activity (last 30 events), orgs contributed to
- **Auth**: Uses `GITHUB_TOKEN` env var if set (5k/hr rate limit), otherwise unauthenticated (60/hr)
- **Error handling**: Returns `{ ok: false, error }` as data (not exceptions), so the agent loop can adapt
- **Record capture**: Calls `rt.recordCapture()` with structured steps for trace provenance

#### `person-deep-dive` Skill (New)

Added to `BUNDLED_LOCAL_SKILLS` in `loadSkillTool.ts`:

- **Self-loop-engineering**: `Goal → Discover Identity → Gather Technical Footprint → Enrich with Web Intelligence → Synthesize → Present as MDX → Verify → Repeat or Finalize`
- **Step 1 — Discover Identity**: Find their GitHub username, LinkedIn, academic profiles via `you_search`
- **Step 2 — GitHub Footprint**: Use `github_profile` for structured data, then go deeper on notable repos
- **Step 3 — Web Intelligence Enrichment**: Search for papers (arxiv, semantic scholar), conference talks, blog posts, hackathons, past projects, news mentions
- **Step 4 — Structure**: Spreadsheet with categories: GitHub Repo, Codebase Contribution, Academic Paper, Event Participation, Project, Career Milestone, Technical Writing, Community Impact
- **Step 5 — MDX Profile**: Write a structured MDX document to the wiki with sections: Overview, GitHub Footprint (repo table + language distribution + recent activity), Academic Publications, Events & Talks, Projects, Career Trajectory, Sources
- **Step 6 — Coverage Self-Evaluation**: Did I find all repos? Papers? Events? Past projects? Career gaps?

#### Source Strategy Table

| Source Type | When to Use | Tool |
|---|---|---|
| GitHub | Repos, contributions, languages, activity | `github_profile` |
| Academic papers | Publications, citations, co-authors | `you_search` with `site:arxiv.org` or `site:semanticscholar.org` |
| LinkedIn | Career history, education, connections | `founder_profile` or `you_search` with `site:linkedin.com` |
| News / media | Funding, product launches, press | `you_search` with freshness filter |
| Research synthesis | Complex multi-source reasoning | `you_research` |
| Conference talks | Presentations, demos | `you_search` with `"talk" "conference" "presentation"` |
| Blog posts | Technical writing, opinions | `you_search` with `site:medium.com OR site:dev.to` |
| Project portfolios | Past projects, side projects | `you_search` with `"project" "built" "created"` |

#### MDX Profile Template

The skill instructs the agent to produce an MDX document with this structure:

```mdx
# Profile: [Person Name]

> Brief one-line description (role, company, focus area)

## Overview
2-3 paragraph narrative summary

## GitHub Footprint
### Notable Repositories
| Repo | Stars | Language | Description |
### Language Distribution
### Recent Activity

## Academic Publications
### [Paper Title]
- Venue, co-authors, citations, abstract

## Events & Talks
## Projects
## Career Trajectory
## Sources
```

#### Frame Loop Mapping

```
Goal: "Deep dive on [Person]"
  ↓
Plan: skill_search → load_skill("person-deep-dive") → identify person's online identities
  ↓
Act: you_search("[Person] GitHub") → find username
  ↓ github_profile({ username }) → repos, languages, activity
  ↓ you_search("[Person] site:arxiv.org") → find papers
  ↓ you_search("[Person] talk conference") → find events
  ↓ founder_profile({ fullName: "[Person]" }) → LinkedIn background
  ↓
Observe: collected repos, papers, events, career milestones
  ↓ self-adapt: if academic, go deeper on papers; if engineer, go deeper on repos
  ↓
Evaluate: cross-reference claims, flag unverified as needs_review
  ↓ ask: did I find all repos? all papers? all events?
  ↓
Store: write_locked_cell_results → spreadsheet
  ↓ update_wiki → MDX profile document
  ↓
Finalize: say() — summary + spreadsheet + wiki link
```

### E2E Test Coverage (Person Deep Dive)

5 new test personas added to `e2e/hackathon-loop-engineering.spec.ts`:

| Test | Person | Focus | Validates |
|---|---|---|---|
| GitHub repos | Nima Mozhgani (Blueberry) | GitHub profile, repos, languages | Spreadsheet + agent output |
| Academic papers | Hao Sheng (Expertise AI) | Papers, publications, arxiv | Spreadsheet + agent output |
| Career trajectory | Jisong L. (BeFreed) | Pinterest → Google AI → BeFreed | Spreadsheet + wiki MDX |
| Events & hackathons | Arjun Chintapalli (Retriever AI) | Hackathons, demo days, community | Spreadsheet + wiki MDX |
| MDX output | Yuchen W. (MAI Agents) | Full profile with MDX sections | Spreadsheet + wiki + tool calls |

### Files Changed (Part 4)

| File | Change |
|---|---|
| `src/nodeagent/skills/search/githubProfileTool.ts` | **New** — GitHub profile research tool |
| `src/nodeagent/skills/server/productionTools.ts` | Registered `githubProfileTool` in `SERVER_PRODUCTION_ROOM_TOOLS` |
| `src/nodeagent/models/convexModel.ts` | Added `github_profile` provider JSON schema |
| `src/nodeagent/core/reasoningFrames.ts` | Added `github_profile` to `FRAME_TOOL_ALLOWLIST.execute` and `DEEP_DIVE_TOOL_ALLOWLIST` |
| `src/nodeagent/tools/loadSkillTool.ts` | Added `person-deep-dive` skill to `BUNDLED_LOCAL_SKILLS` |
| `src/nodeagent/okf/skillCatalog/skill-index.json` | Added `person-deep-dive` catalog record |
| `e2e/hackathon-loop-engineering.spec.ts` | Added 5 person deep dive test personas |
| `docs/design-company-deep-dive.md` | Updated with Part 4 |

### Updated Status

- ✅ Company deep dive skill generalized (v2.0.0, source-agnostic, self-loop-engineering)
- ✅ E2E tests added for all 8 gap companies + Keyan Li + batch test
- ✅ Knowledge graph visualization researched (Obsidian, NotebookLM, React libraries)
- ✅ Knowledge graph feature designed (data model, UI integration, implementation plan)
- ✅ Design doc updated with generalized architecture + graph visualization + coverage ledger
- ✅ **Person deep dive: `github_profile` tool created and registered**
- ✅ **Person deep dive: `person-deep-dive` skill created with MDX output template**
- ✅ **Person deep dive: 5 E2E tests added (GitHub, papers, career, events, MDX)**
- ✅ **TypeScript compiles cleanly (`npx tsc --noEmit` — 0 errors)**
- ✅ Knowledge graph IMPLEMENTED (PR #95, commit b0a0f9bc): `src/ui/panels/KnowledgeGraph.tsx` — a "Graph"
  work-surface tab rendering a derived node-link view (nodes = artifacts colored by kind, edges = real
  title-token "mentions"), reusing `@xyflow/react` (no new dep), derived client-side (no Convex tables),
  works in memory mode. Verified live (9 nodes / 8 edges, node-click opens artifact, design-gate + CI green).
  Remaining graph polish (backlinks side-panel, sheet-row/source/trace node types, local-vs-global modes) is future.
- 🔲 Semantic Scholar API integration (future — `you_search` covers arxiv/scholar for now)
- 🔲 MDX renderer in NodeRoom wiki (future — currently outputs MDX as text to wiki)
