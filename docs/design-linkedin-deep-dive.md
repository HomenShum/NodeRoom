# Design: LinkedIn Deep Dive as a NodeAgent Chat Capability

## Problem

The workflow we just performed manually — browsing a VC fund's LinkedIn company page, scrolling through all posts, extracting portfolio companies/events/key personnel, then cross-referencing with key personnel's personal LinkedIn activity — is exactly the kind of multi-step research that NodeRoom's agent should offer as a one-prompt capability.

A user should be able to type:

> @nodeagent do a deep dive on UpScaleX's LinkedIn presence — extract all portfolio companies, events, and key personnel insights

And get a structured spreadsheet back.

## Current Architecture

NodeRoom already has the pieces:

- **`you_search`** — real-time web+news search (You.com Search API)
- **`you_research`** — multi-step research with source reading and cited synthesis (You.com Research API)
- **`capture_source`** — fetch and capture a web page's content
- **`skill_search` / `load_skill`** — discover and load Agent Skills that encode multi-step procedures
- **Frame loop** — Goal → Plan → Act → Observe → Evaluate → Store → Finalize
- **`write_locked_cell_results`** — write structured data to spreadsheet cells

What's missing is a **Skill** that encodes the LinkedIn deep dive procedure so the agent knows *how* to orchestrate these tools for this specific workflow.

## Solution: Agent Skill (`linkedin-deep-dive`)

### How it works

1. User types: `@nodeagent deep dive into [Company]'s LinkedIn presence`
2. Agent's `skill_search` discovers the `linkedin-deep-dive` skill (lexical match on "linkedin", "deep dive", "company research")
3. Agent calls `load_skill("linkedin-deep-dive")` — skill body enters context
4. Skill body instructs the agent to:
   - **Phase 1 — Discover**: Use `you_search` to find the company's LinkedIn URL and recent LinkedIn posts
   - **Phase 2 — Extract**: Use `you_search` with site:linkedin.com filter to find all public LinkedIn posts about the company, portfolio companies, events, key personnel
   - **Phase 3 — Enrich**: Use `you_research` for deeper synthesis on each discovered entity (portfolio company, founder, event)
   - **Phase 4 — Structure**: Write results to a spreadsheet with columns: Category, Entity, Key Facts, Source, Date
   - **Phase 5 — Verify**: Cross-reference key claims with non-LinkedIn sources

### Why a Skill (not a dedicated tool)

- **No new infrastructure needed** — uses existing `you_search`, `you_research`, `capture_source`, `write_locked_cell_results` tools already in `SERVER_PRODUCTION_ROOM_TOOLS`
- **Progressive disclosure** — skill body only enters context when relevant, keeping token usage bounded
- **Composable** — the agent can combine this skill with other tools (e.g., `you_finance_research` for portfolio company financials)
- **Improvable** — updating the skill body doesn't require redeploying the agent runtime

### Skill registration

The skill is registered in two places:

1. **`skill-index.json`** — catalog record for discovery via `skill_search`
2. **`BUNDLED_LOCAL_SKILLS` in `loadSkillTool.ts`** — skill body for loading via `load_skill`

### Future Enhancement: Apify Integration

For deeper LinkedIn extraction (scrolling all posts, extracting full text from each post), a dedicated `linkedin_scraper` tool could be added that wraps Apify's LinkedIn actors:

- **Apify LinkedIn Company Scraper** — extracts all posts from a company page
- **Apify LinkedIn Profile Scraper** — extracts all posts from a personal profile
- **Apify LinkedIn People Search** — finds employees of a company

This would be a new `AgentTool` registered in `SERVER_PRODUCTION_ROOM_TOOLS` with:
- `name: "linkedin_company_posts"`
- `args: { url: string, maxPosts?: number }`
- Returns: array of post objects { text, date, urn, mediaUrls }
- Uses `APIFY_API_KEY` env var (already mentioned by user)

The skill body would then instruct the agent to use `linkedin_company_posts` when available, falling back to `you_search` with `site:linkedin.com` when not.

### Frame Loop Mapping

```
Goal: "Deep dive into UpScaleX's LinkedIn"
  ↓
Plan: skill_search → load_skill("linkedin-deep-dive") → identify tools needed
  ↓
Act: you_search("site:linkedin.com/company/upscalex") → extract portfolio companies
  ↓ you_search("UpScaleX portfolio companies") → enrich each
  ↓ you_research("UpScaleX investment thesis agentic commerce") → synthesize
  ↓
Observe: collected data on 17+ portfolio companies, events, key personnel
  ↓
Evaluate: verify claims cross-source, flag unverified items as needs_review
  ↓
Store: write_locked_cell_results → spreadsheet with Category/Entity/Facts/Source/Date
  ↓
Finalize: say() — summary of findings + spreadsheet link
```

### E2E Test Coverage

The E2E test file (`e2e/hackathon-loop-engineering.spec.ts`) includes:

- **Persona 18**: "LinkedIn Deep Dive — investor research workflow via NodeAgent" — tests the full one-prompt deep dive
- **Persona 18b**: Tests deep dive on a specific portfolio company (Blueberry)
- **Persona 19**: Tests portfolio tracker generation from discovered data
- **Persona 19b**: Tests founder network mapping from discovered data

### Files Changed

- `src/nodeagent/okf/skillCatalog/skill-index.json` — added `linkedin-deep-dive` catalog record
- `src/nodeagent/tools/loadSkillTool.ts` — added `linkedin-deep-dive` to `BUNDLED_LOCAL_SKILLS`
- `e2e/hackathon-loop-engineering.spec.ts` — added test personas 11-19
- `docs/design-linkedin-deep-dive.md` — this design doc

### Status: Skill registered, E2E tests added, design doc complete
