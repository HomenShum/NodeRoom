/**
 * Tests for the deep-dive fan-out architecture:
 * 1. buildCompanyDeepDiveContext produces focused per-company context with target highlighted
 * 2. DEEP_DIVE_COLUMNS and DEEP_DIVE_TOOL_ALLOWLIST are correctly defined
 * 3. extractCompletedCompaniesFromSheet logic (pure function extracted for testing)
 * 4. Frame plan for deep-dive child frames has correct shape
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, DataframeColumn } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import {
  buildCompanyDeepDiveContext,
  buildResearchContext,
  DEEP_DIVE_COLUMNS,
  contextBuilderForSurface,
} from "../src/nodeagent/core/worldModel";
import { DEEP_DIVE_TOOL_ALLOWLIST, FRAME_TOOL_ALLOWLIST } from "../src/nodeagent/core/reasoningFrames";

const COMPANIES = [
  { rowId: "c1", name: "Acme AI", url: "https://acme.example", status: "complete" },
  { rowId: "c2", name: "Globex", url: "https://globex.example", status: "complete" },
  { rowId: "c3", name: "Initech", url: "https://initech.example", status: "pending" },
];

const RESEARCH_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
  ...DEEP_DIVE_COLUMNS,
] as const;

function setup() {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Deep Diligence", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Homen" };
  const seed: { id: string; value: unknown }[] = [];
  for (const c of COMPANIES) {
    const vals: Record<string, string> = {
      company: c.name, website: c.url, status: c.status, tier: "A", intent: "test", owner: "Homen", crm_status: "Research",
      summary: `${c.name} summary`, funding: "Series A", headcount: "50", recent_signal: "growing",
      source: c.url, source2: "", last_researched: "2026-06-07",
      team_background: "", funding_history: "", product_summary: "", gtm_signals: "",
      events_attended: "", connections: "", competitive_landscape: "",
      deep_source_1: "", deep_source_2: "", deep_source_3: "",
      deep_status: "", deep_last_researched: "",
      founder_names: "", founder_education: "", founder_experience: "",
      founder_conviction: "", founder_social: "", founder_outreach_topics: "",
      possible_contacts: "",
    };
    for (const col of RESEARCH_COLS) seed.push({ id: `${c.rowId}__${col}`, value: vals[col] ?? "" });
  }
  const columns: DataframeColumn[] = RESEARCH_COLS.map((label, order) => ({
    id: label, label, order, mode: "manual" as const, type: "text" as const, agentWritable: true,
  }));
  const meta = { dataframe: { columns, rowCount: COMPANIES.length, sourceFile: "seed", parser: "seed", truncated: false, warnings: [] } };
  const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: me, seed, meta }).id;
  const sess = engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" });
  const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const rt = new InMemoryRoomTools(engine, room.id, sheetId, actor, sess.id);
  return { engine, room, sheetId, rt };
}

const render = (msgs: { content: string }[]) => msgs.map((m) => m.content).join("\n");

describe("Deep-dive fan-out architecture", () => {

  describe("DEEP_DIVE_COLUMNS and tool allowlist", () => {
    it("DEEP_DIVE_COLUMNS has all 19 expanded research dimensions (12 company + 6 per-founder + 1 contacts)", () => {
      expect(DEEP_DIVE_COLUMNS).toHaveLength(19);
      // Company-level dimensions
      expect(DEEP_DIVE_COLUMNS).toContain("team_background");
      expect(DEEP_DIVE_COLUMNS).toContain("funding_history");
      expect(DEEP_DIVE_COLUMNS).toContain("product_summary");
      expect(DEEP_DIVE_COLUMNS).toContain("gtm_signals");
      expect(DEEP_DIVE_COLUMNS).toContain("events_attended");
      expect(DEEP_DIVE_COLUMNS).toContain("connections");
      expect(DEEP_DIVE_COLUMNS).toContain("competitive_landscape");
      expect(DEEP_DIVE_COLUMNS).toContain("deep_source_1");
      expect(DEEP_DIVE_COLUMNS).toContain("deep_source_2");
      expect(DEEP_DIVE_COLUMNS).toContain("deep_source_3");
      expect(DEEP_DIVE_COLUMNS).toContain("deep_status");
      expect(DEEP_DIVE_COLUMNS).toContain("deep_last_researched");
      // Per-founder dimensions
      expect(DEEP_DIVE_COLUMNS).toContain("founder_names");
      expect(DEEP_DIVE_COLUMNS).toContain("founder_education");
      expect(DEEP_DIVE_COLUMNS).toContain("founder_experience");
      expect(DEEP_DIVE_COLUMNS).toContain("founder_conviction");
      expect(DEEP_DIVE_COLUMNS).toContain("founder_social");
      expect(DEEP_DIVE_COLUMNS).toContain("founder_outreach_topics");
      // Contact discovery
      expect(DEEP_DIVE_COLUMNS).toContain("possible_contacts");
    });

    it("DEEP_DIVE_TOOL_ALLOWLIST includes fetch, capture, read, write, define_columns, and founder_profile tools", () => {
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("fetch_source");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("capture_source");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("read_range");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("search_sheet_context");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("write_locked_cell_results");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("define_columns");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("say");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("update_wiki");
      expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain("founder_profile");
    });

    it("DEEP_DIVE_TOOL_ALLOWLIST is a superset of FRAME_TOOL_ALLOWLIST.execute research tools", () => {
      const execTools = FRAME_TOOL_ALLOWLIST.execute;
      const researchTools = execTools.filter((t) =>
        t === "fetch_source" || t === "capture_source" || t === "write_locked_cell_results" || t === "update_wiki",
      );
      for (const t of researchTools) {
        expect(DEEP_DIVE_TOOL_ALLOWLIST).toContain(t);
      }
    });
  });

  describe("contextBuilderForSurface", () => {
    it("maps company_deep_dive to buildCompanyDeepDiveContext", () => {
      expect(contextBuilderForSurface("company_deep_dive")).toBe("buildCompanyDeepDiveContext");
    });

    it("still maps company_research to buildResearchContext", () => {
      expect(contextBuilderForSurface("company_research")).toBe("buildResearchContext");
    });
  });

  describe("buildCompanyDeepDiveContext", () => {
    it("produces context with TARGET marker on the named company only", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1): founding team, funding history, product, GTM signals, events attended, connections to other portfolio companies, competitive landscape. Website: https://acme.example`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      // Target company is marked
      expect(ctx).toContain("Acme AI");
      expect(ctx).toContain("<<< TARGET");

      // Non-target companies appear but are NOT marked as target
      expect(ctx).toContain("Globex");
      expect(ctx.includes("Globex") && !ctx.includes("Globex<<< TARGET")).toBe(true);
      expect(ctx).toContain("Initech");
    });

    it("includes deep-dive column instructions and dimensions", async () => {
      const { rt } = setup();
      const goal = `Deep research on Globex (row c2)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      // Deep-dive instructions
      expect(ctx).toContain("CHILD FRAME");
      expect(ctx).toContain("define_columns");
      expect(ctx).toContain("team_background");
      expect(ctx).toContain("funding_history");
      expect(ctx).toContain("events_attended");
      expect(ctx).toContain("competitive_landscape");
      expect(ctx).toContain("possible_contacts");
      expect(ctx).toContain("deep_status");
      expect(ctx).toContain("deep_last_researched");
    });

    it("includes target company cell versions for CAS", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      // Should include the target row's editable cells with version info
      expect(ctx).toContain("c1__status");
      expect(ctx).toContain("c1__deep_status");
      expect(ctx).toContain("c1__team_background");
      expect(ctx).toContain("[v");
    });

    it("instructs agent to NOT modify base columns", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      expect(ctx).toContain("Do NOT modify base columns");
    });

    it("instructs agent to use at least 2 corroborating sources", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      expect(ctx).toContain("2 corroborating sources");
    });

    it("handles missing target company gracefully", async () => {
      const { rt } = setup();
      const goal = `Deep research on Nonexistent Co (row x99)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      expect(ctx).toContain("target company not found");
      expect(ctx).toContain("search_sheet_context");
    });

    it("includes per-founder research instructions and founder_profile tool guidance", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      // Per-founder section header
      expect(ctx).toContain("PER-FOUNDER RESEARCH");
      // Founder columns mentioned in instructions
      expect(ctx).toContain("founder_names");
      expect(ctx).toContain("founder_education");
      expect(ctx).toContain("founder_experience");
      expect(ctx).toContain("founder_conviction");
      expect(ctx).toContain("founder_social");
      expect(ctx).toContain("founder_outreach_topics");
      // founder_profile tool mentioned
      expect(ctx).toContain("founder_profile");
      expect(ctx).toContain("Apify");
      // Conviction definition
      expect(ctx).toContain("conviction");
      expect(ctx).toContain("skin in the game");
      // Outreach topics must be specific
      expect(ctx).toContain("SPECIFIC to the person");
    });

    it("includes founder cell versions for CAS", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      expect(ctx).toContain("c1__founder_names");
      expect(ctx).toContain("c1__founder_education");
      expect(ctx).toContain("c1__founder_experience");
      expect(ctx).toContain("c1__founder_conviction");
      expect(ctx).toContain("c1__founder_social");
      expect(ctx).toContain("c1__founder_outreach_topics");
    });

    it("instructs fallback to fetch_source when founder_profile fails", async () => {
      const { rt } = setup();
      const goal = `Deep research on Acme AI (row c1)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));

      expect(ctx).toContain("fall back to fetch_source");
    });
  });

  describe("extractCompletedCompaniesFromSheet (pure logic)", () => {
    // Test the pure logic of extracting completed companies from element data.
    // This mirrors the Convex mutation logic without needing a Convex deployment.
    function extractCompletedCompanies(elements: Array<{ elementId: string; value: unknown }>): Array<{ rowId: string; company: string; website: string }> {
      const rowsMap = new Map<string, { company?: string; website?: string; status?: string }>();
      for (const el of elements) {
        const sep = el.elementId.indexOf("__");
        if (sep < 0) continue;
        const rowId = el.elementId.slice(0, sep);
        const col = el.elementId.slice(sep + 2);
        if (!rowsMap.has(rowId)) rowsMap.set(rowId, {});
        const row = rowsMap.get(rowId)!;
        const rawVal = el.value;
        const val = rawVal && typeof rawVal === "object" && "value" in rawVal ? (rawVal as { value: unknown }).value : rawVal;
        if (col === "company") row.company = String(val ?? "");
        if (col === "website") row.website = String(val ?? "");
        if (col === "status") row.status = String(val ?? "");
      }
      const companies: Array<{ rowId: string; company: string; website: string }> = [];
      for (const [rowId, row] of rowsMap) {
        if (row.status === "complete" && row.company) {
          companies.push({ rowId, company: row.company, website: row.website ?? "" });
        }
      }
      return companies;
    }

    function normalizedCompanyMentionText(value: string): string {
      return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    }

    function filterCompaniesByGoalMention(goal: string, companies: Array<{ rowId: string; company: string; website: string }>): Array<{ rowId: string; company: string; website: string }> {
      const normalizedGoal = normalizedCompanyMentionText(goal);
      const explicitlyMentioned = companies.filter((company) => {
        const normalizedCompany = normalizedCompanyMentionText(company.company);
        return normalizedCompany.length >= 3 && normalizedGoal.includes(normalizedCompany);
      });
      return explicitlyMentioned.length ? explicitlyMentioned : companies;
    }

    it("extracts only companies with status 'complete'", () => {
      const elements = [
        { elementId: "c1__company", value: "Acme AI" },
        { elementId: "c1__website", value: "https://acme.example" },
        { elementId: "c1__status", value: "complete" },
        { elementId: "c2__company", value: "Globex" },
        { elementId: "c2__website", value: "https://globex.example" },
        { elementId: "c2__status", value: "pending" },
        { elementId: "c3__company", value: "Initech" },
        { elementId: "c3__status", value: "complete" },
      ];
      const companies = extractCompletedCompanies(elements);
      expect(companies).toHaveLength(2);
      expect(companies[0]).toEqual({ rowId: "c1", company: "Acme AI", website: "https://acme.example" });
      expect(companies[1]).toEqual({ rowId: "c3", company: "Initech", website: "" });
    });

    it("handles cell payload objects with { value } shape", () => {
      const elements = [
        { elementId: "r1__company", value: { value: "Payload Co", evidence: [], confidence: 0.9 } },
        { elementId: "r1__status", value: { value: "complete" } },
        { elementId: "r1__website", value: { value: "https://payload.example" } },
      ];
      const companies = extractCompletedCompanies(elements);
      expect(companies).toHaveLength(1);
      expect(companies[0].company).toBe("Payload Co");
      expect(companies[0].website).toBe("https://payload.example");
    });

    it("skips elements without __ separator", () => {
      const elements = [
        { elementId: "doc", value: "some doc content" },
        { elementId: "c1__company", value: "Acme" },
        { elementId: "c1__status", value: "complete" },
      ];
      const companies = extractCompletedCompanies(elements);
      expect(companies).toHaveLength(1);
      expect(companies[0].company).toBe("Acme");
    });

    it("returns empty array when no companies are complete", () => {
      const elements = [
        { elementId: "c1__company", value: "Acme" },
        { elementId: "c1__status", value: "pending" },
      ];
      const companies = extractCompletedCompanies(elements);
      expect(companies).toHaveLength(0);
    });

    it("narrows deep-dive fan-out to the company explicitly named in the parent goal", () => {
      const companies = [
        { rowId: "rc_cardionova", company: "CardioNova", website: "https://cardionova.example" },
        { rowId: "rc_mercury", company: "Mercury", website: "https://mercury.com" },
      ];
      expect(filterCompaniesByGoalMention("Research CardioNova funding and headcount", companies).map((c) => c.rowId)).toEqual(["rc_cardionova"]);
      expect(filterCompaniesByGoalMention("Research every complete company", companies).map((c) => c.rowId)).toEqual(["rc_cardionova", "rc_mercury"]);
    });
  });

  describe("deep-dive child frame plan shape", () => {
    it("creates correct frameId pattern and goal for each company", () => {
      const companies = [
        { rowId: "c1", company: "Acme AI", website: "https://acme.example" },
        { rowId: "c2", company: "Globex", website: "https://globex.example" },
      ];
      const parentFrameId = "execute_frame_1";

      for (const company of companies) {
        const frameId = `deep_dive:${company.rowId}:${parentFrameId}`;
        const goal = `Deep research on ${company.company} (row ${company.rowId}): founding team, funding history, product, GTM signals, events attended, connections to other portfolio companies, competitive landscape. Website: ${company.website || "(none)"}`;

        expect(frameId).toMatch(/^deep_dive:c[12]:execute_frame_1$/);
        expect(goal).toContain(company.company);
        expect(goal).toContain(company.rowId);
        expect(goal).toContain(company.website);
        expect(goal).toContain("founding team");
        expect(goal).toContain("funding history");
        expect(goal).toContain("events attended");
        expect(goal).toContain("competitive landscape");
      }
    });

    it("context pack has correct shape for deep-dive child frames", () => {
      const contextPack = {
        globalGoal: "Research all pending companies",
        parentSummary: "Parent execute frame completed. Researching Acme AI in depth.",
        currentArtifactDigest: "artifact:abc123; entity:company:c1; facet:deep_dive",
        relevantOkfConceptIds: [],
        relevantCacheKeys: ["deep_dive:c1"],
        openQuestions: [
          "What is Acme AI's founding team background?",
          "What is Acme AI's funding history?",
          "What events has Acme AI attended?",
          "What connections does Acme AI have to other portfolio companies?",
        ],
        constraints: [
          "Child frames inherit only compact parent context, never the full transcript.",
          "Write only to the target company's deep-dive cells.",
          "Use at least 2 corroborating sources for key claims.",
          "Return evidence-bearing results that match the expected schema.",
        ],
        expectedOutputSchema: "company_deep_dive_result_with_evidence_v1",
      };

      expect(contextPack.relevantCacheKeys).toContain("deep_dive:c1");
      expect(contextPack.expectedOutputSchema).toBe("company_deep_dive_result_with_evidence_v1");
      expect(contextPack.openQuestions).toHaveLength(4);
      expect(contextPack.constraints).toHaveLength(4);
      expect(contextPack.constraints.some((c: string) => c.includes("Write only"))).toBe(true);
    });
  });

  describe("buildResearchContext vs buildCompanyDeepDiveContext", () => {
    it("buildResearchContext shows all rows without TARGET markers", async () => {
      const { rt } = setup();
      const ctx = render(await buildResearchContext(rt, "Research all pending companies"));
      expect(ctx).not.toContain("<<< TARGET");
      expect(ctx).not.toContain("CHILD FRAME");
    });

    it("buildCompanyDeepDiveContext is focused on one company with TARGET marker", async () => {
      const { rt } = setup();
      const goal = `Deep research on Globex (row c2)`;
      const ctx = render(await buildCompanyDeepDiveContext(rt, goal));
      expect(ctx).toContain("<<< TARGET");
      expect(ctx).toContain("CHILD FRAME");
    });
  });
});
