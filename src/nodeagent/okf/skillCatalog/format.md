# Skill catalog record format (OKF-compatible)

The unit a `skill_search` retrieves over. One record per Agent Skill. The format is a thin
superset of the `SKILL.md` frontmatter so any standard skill ingests with no extra authoring,
and it maps 1:1 onto an OKF concept of type `"Agent Skill"` (see
`docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md`).

`skill-index.json` is a JSON array of these records:

```jsonc
{
  "slug": "powerpoint",                       // stable id (skill directory name)
  "name": "powerpoint",                       // SKILL.md frontmatter `name`
  "description": "Turn messy notes ... ",     // SKILL.md `description` — THE semantic retrieval hook
  "categories": ["business-marketing"],       // from frontmatter `categories`/`tags`, or catalog section
  "trust": "local",                           // local | verified | community | untrusted
  "source": {
    "kind": "local",                          // local | catalog | url
    "path": ".claude/skills/powerpoint/SKILL.md",
    "url": null                               // raw SKILL.md URL when remote
  },
  "install": ".claude/skills/powerpoint",     // where load_skill fetches the body from
  "contentHash": "sha256:…",                  // of the SKILL.md, for change detection
  "license": "MIT",                           // optional, from frontmatter
  "indexedAt": "2026-06-19T00:00:00Z"
}
```

## Field rules
- **`description` is load-bearing.** It is what `skill_search` embeds and ranks on, so it must state *what the skill does AND when to use it* (the Agent Skills convention). A weak description = an undiscoverable skill.
- **`trust`** gates execution. `local` = our own `.claude/skills`; `verified` = curated catalogs we vouch for; `community` = open catalogs (awesome-claude-skills); `untrusted` = anything else. Maps to OKF `confidence` (1.0 / 0.95 / 0.6 / 0.3) and `frontmatter.noderoom.skill_trust`.
- **`source` / `install`** tell `load_skill` where to fetch the full SKILL.md body on demand. Only the record (name+description+meta) is indexed up front; the body is pulled lazily.
- **`contentHash`** lets re-ingestion skip unchanged skills (same dedup the OKF outbox uses).

## OKF mapping (when ingested via `indexSkillFromCatalog`)
`name → title` · `description → description` (+ searchText) · `categories → tags` · `source.url|install → resource` · `trust → noderoom.skill_trust` + `confidence` · SKILL.md body (on load) → `body` (chunked + embedded).

## Producing the index
`build-skill-index.mjs` walks local skill dirs and/or a cloned catalog and emits `skill-index.json`:

```bash
# our own skills (default):
node src/nodeagent/okf/skillCatalog/build-skill-index.mjs

# also ingest a cloned external catalog as community-trust:
node src/nodeagent/okf/skillCatalog/build-skill-index.mjs --catalog ../awesome-claude-skills --trust community

# merge a hand-maintained seed of remote skills (name/description/source.url/categories):
node src/nodeagent/okf/skillCatalog/build-skill-index.mjs --seed seed.json
```
