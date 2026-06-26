/**
 * Skill RAG (dynamic skill retrieval) — scenario-based tests.
 *
 * Personas:
 *  - "Discovering analyst": has a goal ("build a deck from notes"), expects skill_search to surface
 *    the right LOCAL skill by description, without loading any body.
 *  - "Cautious loader": loads a chosen LOCAL skill (no network) and gets executionPolicy=trusted_local.
 *  - "Adversary": tries to make load_skill fetch internal/non-allowlisted/http URLs (SSRF) and to
 *    blow the size/timeout budget — must get HONEST errors, never a fake success.
 *  - "Frame runner": relies on selectFrameTools default behavior staying identical, and on RAG
 *    pruning only kicking in (and only on skill-class tools) when a goal is provided.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SKILL_SEARCH_TOOL,
  LOAD_SKILL_TOOL,
  loadSkill,
  loadSkillCatalog,
  selectRelevantSkills,
  selectFrameTools,
  SKILL_HOST_ALLOWLIST,
  type AgentTool,
  type RoomTools,
  type ReasoningFrame,
} from "../src/nodeagent/index";

// A RoomTools with NO okf port — forces skill_search onto the local-catalog fallback.
const rtNoOkf = { okf: undefined } as unknown as RoomTools;

function tool(name: string, description = ""): AgentTool {
  return { name, description, schema: z.object({}), execute: async () => ({ ok: true }) };
}

function frame(toolAllowlist: string[]): ReasoningFrame {
  return {
    frameId: "rf_skill",
    goal: "g",
    phase: "execute",
    status: "pending",
    contextPack: {
      globalGoal: "g",
      parentSummary: "",
      currentArtifactDigest: "",
      relevantOkfConceptIds: [],
      relevantCacheKeys: [],
      openQuestions: [],
      constraints: [],
      expectedOutputSchema: "",
    },
    toolAllowlist,
    evidenceState: { required: [], availableRefs: [], missingRefs: [], staleRefs: [] },
  } as ReasoningFrame;
}

describe("skill catalog (local substrate)", () => {
  it("loads bounded, well-formed records from the bundled index", () => {
    const catalog = loadSkillCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const rec of catalog) {
      expect(typeof rec.slug).toBe("string");
      expect(rec.slug.length).toBeGreaterThan(0);
      expect(["local", "verified", "community", "untrusted"]).toContain(rec.trust);
    }
  });
});

describe("skill_search — discover without loading", () => {
  it("ranks the deck skill top for a deck goal, returns records (no body), honest source tag", async () => {
    const out = (await SKILL_SEARCH_TOOL.execute(
      { query: "turn my notes into a slide deck presentation" },
      rtNoOkf,
    )) as { skills: Array<{ slug: string; description: string }>; retrievedFrom: string[] };
    expect(out.skills.length).toBeGreaterThan(0);
    expect(out.skills[0].slug).toBe("powerpoint");
    // honest provenance — okf was unavailable, so it must NOT claim okf.
    expect(out.retrievedFrom).toContain("local_catalog");
    expect(out.retrievedFrom).not.toContain("okf");
    // records only — no body field leaks into discovery.
    expect((out.skills[0] as Record<string, unknown>).body).toBeUndefined();
  });

  it("BOUND: respects top-k", async () => {
    const out = (await SKILL_SEARCH_TOOL.execute({ query: "demo video walkthrough", k: 2 }, rtNoOkf)) as {
      skills: unknown[];
    };
    expect(out.skills.length).toBeLessThanOrEqual(2);
  });

  it("filters by trust floor (only local/verified survive a verified floor)", async () => {
    const out = (await SKILL_SEARCH_TOOL.execute(
      { query: "anything", k: 25, skill_trust_min: "verified" },
      rtNoOkf,
    )) as { skills: Array<{ trust: string }> };
    // the bundled index is all `local`, which clears the verified floor; none should be community/untrusted.
    for (const s of out.skills) expect(["local", "verified"]).toContain(s.trust);
  });
});

// Pick a local skill whose SKILL.md physically exists in THIS checkout (worktrees may carry a
// subset of .claude/skills). If none, the local-read assertions are skipped — the SSRF + honesty
// + RAG coverage below is what guards the dangerous surface.
function firstResolvableLocalSlug(): string | null {
  for (const rec of loadSkillCatalog()) {
    if (rec.trust !== "local" || !rec.install) continue;
    const dir = join(process.cwd(), rec.install);
    if (existsSync(dir) && existsSync(join(dir, "SKILL.md")) && statSync(join(dir, "SKILL.md")).size <= 256 * 1024) {
      return rec.slug;
    }
  }
  return null;
}

describe("load_skill — local read (no network)", () => {
  it("loads the cataloged powerpoint skill used by deck and BTB runs", async () => {
    const res = await loadSkill("powerpoint");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source.kind).toBe("local");
    expect(res.executionPolicy).toBe("trusted_local");
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.meta.categories).toContain("presentation");
  });

  it("reads a local skill body and marks it trusted_local", async () => {
    const slug = firstResolvableLocalSlug();
    if (!slug) return; // no local SKILL.md present in this checkout — covered by SSRF/honesty tests
    const res = (await loadSkill(slug)) as Extract<Awaited<ReturnType<typeof loadSkill>>, { ok: true }>;
    expect(res.ok).toBe(true);
    expect(res.source.kind).toBe("local");
    expect(res.trust).toBe("local");
    expect(res.executionPolicy).toBe("trusted_local");
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.bytes).toBeLessThanOrEqual(256 * 1024);
  });

  it("HONEST_STATUS: unknown slug returns an honest not-found, not a fake success", async () => {
    const res = await loadSkill("this-skill-does-not-exist-xyz");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("skill_not_found");
  });

  it("HONEST_STATUS: empty input is rejected", async () => {
    const res = await loadSkill("   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("idOrUrl_required");
  });

  it("the LOAD_SKILL_TOOL wrapper routes args.idOrUrl through to loadSkill", async () => {
    expect(LOAD_SKILL_TOOL.name).toBe("load_skill");
    const res = (await LOAD_SKILL_TOOL.execute({ idOrUrl: "nope-not-real-slug" }, rtNoOkf)) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBe("skill_not_found");
  });
});

describe("load_skill — SSRF gate (adversary)", () => {
  const blocked = [
    "http://raw.githubusercontent.com/x/y/main/SKILL.md", // http (not https)
    "https://evil.example.com/SKILL.md", // host not in allowlist
    "https://127.0.0.1/SKILL.md", // loopback IP literal
    "https://169.254.169.254/latest/meta-data", // link-local cloud metadata
    "https://[::1]/SKILL.md", // IPv6 loopback
    "https://localhost/SKILL.md", // localhost
    "https://10.0.0.5/SKILL.md", // private RFC1918
    "ftp://raw.githubusercontent.com/SKILL.md", // unsupported protocol
  ];
  for (const url of blocked) {
    it(`blocks ${url} (no fetch, honest ssrf_blocked)`, async () => {
      const res = await loadSkill(url);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("ssrf_blocked");
    });
  }

  it("the allowlist is exactly the three GitHub raw hosts", () => {
    expect([...SKILL_HOST_ALLOWLIST].sort()).toEqual(
      ["github.com", "gist.githubusercontent.com", "raw.githubusercontent.com"].sort(),
    );
  });
});

describe("selectRelevantSkills (RAG) — default unchanged + bounded prune", () => {
  const base = [tool("read_range"), tool("say"), tool("write_cell")];
  const skillTools = [
    tool("skill_search", "discover agent skills"),
    tool("load_skill", "fetch a chosen skill body"),
    tool("okf_search_skills", "semantic search the skill catalog"),
  ];

  it("never prunes non-skill tools", () => {
    const kept = selectRelevantSkills("build a deck", [...base, ...skillTools], 1);
    for (const t of base) expect(kept.map((k) => k.name)).toContain(t.name);
  });

  it("prunes skill-class tools down to k", () => {
    const kept = selectRelevantSkills("xyzzy nomatch", [...base, ...skillTools], 1);
    const keptSkills = kept.filter((t) => ["skill_search", "load_skill", "okf_search_skills"].includes(t.name));
    expect(keptSkills.length).toBe(1);
  });

  it("keeps everything when skill tools <= k (no-op)", () => {
    const kept = selectRelevantSkills("anything", [...base, skillTools[0]], 5);
    expect(kept.length).toBe(base.length + 1);
  });

  it("pins allowlisted skill tools even under heavy pruning", () => {
    const kept = selectRelevantSkills("xyzzy nomatch", [...base, ...skillTools], 1, new Set(["load_skill"]));
    expect(kept.map((k) => k.name)).toContain("load_skill");
  });
});

describe("selectFrameTools — backward compatible", () => {
  const tools = [tool("read_range"), tool("say"), tool("skill_search"), tool("load_skill"), tool("okf_search_skills")];

  it("no goal → identical to the pre-RAG behavior (allowlist filter only)", () => {
    const f = frame(["read_range", "say"]);
    const sel = selectFrameTools(f, tools);
    expect(sel.allowedToolNames.sort()).toEqual(["read_range", "say"].sort());
    expect(sel.missingToolNames).toEqual([]);
  });

  it("missingToolNames is computed against the ORIGINAL set even with a goal (no false missing)", () => {
    const f = frame(["read_range", "nonexistent_tool"]);
    const sel = selectFrameTools(f, tools, "build a deck from notes");
    expect(sel.missingToolNames).toEqual(["nonexistent_tool"]);
    expect(sel.allowedToolNames).toContain("read_range");
  });

  it("an allowlisted skill tool survives RAG selection", () => {
    const f = frame(["load_skill"]);
    const sel = selectFrameTools(f, tools, "completely unrelated goal text");
    expect(sel.allowedToolNames).toContain("load_skill");
  });
});
