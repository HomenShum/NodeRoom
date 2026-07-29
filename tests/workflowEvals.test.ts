/**
 * WORKFLOW EVALS — broadening coverage beyond the L1-L6 collaboration ladder to the real product
 * workflows (scenario-based per scenario_testing: real persona + goal + deterministic checks).
 *
 * Implemented + green here: GTM enrichment, parser extraction, cross-file tools,
 * grounded wiki updates, and deterministic finance reconciliation.
 */
import { describe, it, expect } from "vitest";
import { runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { companyResearchPlan, type CompanyResearchTarget } from "../src/nodeagent/core/plans";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom, RESEARCH_PLAN, RESEARCH_COMPANIES } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { buildResearchContext } from "../src/nodeagent/core/worldModel";
import { parseSpreadsheetArtifacts } from "../src/app/spreadsheetParser";

const scalarOf = (v: unknown): unknown =>
  v && typeof v === "object" && "value" in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v;

describe("WORKFLOW EVAL — GTM enrichment (persona: Maya, sales-ops; fill pending accounts, keep CRM)", () => {
  it("enriches every pending account with synthetic evidence held for review and leaves CRM columns untouched", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.researchId, d.agents.room, d.sessions.room);
    const goal = "Research every pending company on the Company research sheet; fill blanks with sourced values + evidence, mark complete, preserve CRM columns.";
    const maxSteps = 14 * RESEARCH_PLAN.length + 4;
    const r = await runAgent({ rt, goal, model: scriptedModel(companyResearchPlan(RESEARCH_PLAN as CompanyResearchTarget[])), tools: ROOM_TOOLS, maxSteps, contextBuilder: buildResearchContext });
    expect(r.stopReason).toBe("done");

    const el = (id: string) => engine.getArtifact(d.researchId)!.elements[id]?.value;
    const targetIds = new Set(RESEARCH_PLAN.map((target) => target.rowId));
    for (const c of RESEARCH_COMPANIES) {
      expect(String(scalarOf(el(`${c.id}__status`)))).toBe(targetIds.has(c.id) ? "needs_review" : "complete");
      for (const col of ["summary", "funding", "headcount", "recent_signal", "source"]) {
        const p = el(`${c.id}__${col}`) as { evidence?: unknown[]; status?: string } | undefined;
        expect(String(scalarOf(p) ?? "").length).toBeGreaterThan(0);                     // blank filled
        expect(Array.isArray(p?.evidence) && p!.evidence!.length >= 1).toBe(true);        // evidence-bearing
        expect(p?.status).toBe(targetIds.has(c.id) ? "needs_review" : "complete");       // synthetic fixture cannot self-certify
      }
      expect(el(`${c.id}__tier`)).toBe(c.tier);                                           // CRM untouched (still seeded scalar)
      expect(el(`${c.id}__crm_status`)).toBe(c.crmStatus);
      expect(el(`${c.id}__owner`)).toBe(c.owner);
    }
  });

  it("keeps a synthetic-review row eligible on a later analyst rerun instead of silently treating it as complete", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.researchId, d.agents.room, d.sessions.room);
    const target = RESEARCH_PLAN[0] as CompanyResearchTarget;
    const run = () => runAgent({
      rt,
      goal: `Recheck ${target.rowId} until its sources can be sealed.`,
      model: scriptedModel(companyResearchPlan([target])),
      tools: ROOM_TOOLS,
      maxSteps: 18,
      contextBuilder: buildResearchContext,
    });

    expect((await run()).stopReason).toBe("done");
    const firstStatus = engine.getArtifact(d.researchId)!.elements[`${target.rowId}__status`];
    expect(scalarOf(firstStatus.value)).toBe("needs_review");
    expect((firstStatus.value as { status?: string }).status).toBe("needs_review");
    const firstVersion = firstStatus.version;

    expect((await run()).stopReason).toBe("done");
    const rerunStatus = engine.getArtifact(d.researchId)!.elements[`${target.rowId}__status`];
    expect(scalarOf(rerunStatus.value)).toBe("needs_review");
    expect((rerunStatus.value as { status?: string }).status).toBe("needs_review");
    expect(rerunStatus.version).toBeGreaterThan(firstVersion);
  });
});

describe("WORKFLOW EVAL — parser extraction (messy banner-band file → structured dataframe)", () => {
  it("detects the header below a banner, keeps blanks empty (no invented values), attaches provenance, warns honestly", async () => {
    const csv = [
      "ACME HOLDINGS - CONFIDENTIAL Q3 PACK", // banner band (1 non-empty cell)
      "Company,Sector,Funding,HQ",            // the real header (row 2)
      "Acme Robotics,Warehouse,,SF",          // Funding blank → must stay empty (no invention)
      "Nimbus Health,Clinical AI,$30M,NYC",
    ].join("\n");
    const arts = await parseSpreadsheetArtifacts({ fileName: "q3.csv", mimeType: "text/csv", size: csv.length, text: csv });
    const art = arts[0];

    expect((art.meta?.dataframe?.columns ?? []).map((c) => c.label)).toEqual(["Company", "Sector", "Funding", "HQ"]); // header below banner
    expect((art.meta?.dataframe?.warnings ?? []).some((w) => /banner/i.test(w))).toBe(true);                          // honest warning

    const funding = art.seed.find((s) => s.id === "u1__funding")?.value as { status?: string } | undefined;
    expect(String(scalarOf(funding) ?? "")).toBe("");                                                                 // blank stayed empty
    expect(funding?.status).toBe("empty");                                                                            // status honest

    const company = art.seed.find((s) => s.id === "u1__company")?.value as { evidence?: Array<{ row?: number }> } | undefined;
    expect(Array.isArray(company?.evidence) && company!.evidence!.length >= 1).toBe(true);                            // per-cell provenance
    expect(company!.evidence![0].row).toBe(3);                                                                        // provenance points at source row (banner=1, header=2, data=3)
  });
});

describe("WORKFLOW EVAL — cross-file (multi-artifact tool layer: one run reads the sheet, writes the note)", () => {
  it("a single RoomTools (bound to the sheet) discovers files, reads the sheet, and writes a summary into the NOTE — a different artifact", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room); // BOUND to the sheet

    // 1. Discover the room's other files (was impossible — no listing on the port).
    const arts = await rt.listArtifacts();
    expect(arts.some((a) => a.id === d.sheetId && a.kind === "sheet")).toBe(true);
    expect(arts.some((a) => a.id === d.noteId && a.kind === "note")).toBe(true);

    // 2. Cross-file READ: read the NOTE's doc cell (a DIFFERENT artifact than the bound sheet).
    const before = await rt.readRange(["doc"], d.noteId);
    expect(before[0].version).toBeGreaterThan(0);

    // 3. Cross-file WRITE: write a derived summary into the NOTE (structurally impossible before this layer).
    const res = await rt.editCell("doc", "Summary: Q3 variance reconciled from the sheet.", before[0].version, d.noteId);
    expect(res.ok).toBe(true);

    // 4. The write landed on the NOTE; the bound sheet's primary default still resolves to the sheet.
    expect(String(engine.getArtifact(d.noteId)!.elements["doc"]?.value)).toContain("Summary: Q3 variance");
    const primary = await rt.readRange(["r_ni__variance"]); // no artifactId → defaults to the bound sheet
    expect(primary[0].id).toBe("r_ni__variance");
    expect(primary[0].version).toBeGreaterThan(0); // sheet intact, untouched by the note write
  });
});

describe("WORKFLOW EVAL — wiki update (grounded: read a source, write a CITED summary into the wiki)", () => {
  it("update_wiki writes a grounded, cited summary into the wiki note (CAS), and rejects ungrounded writes", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const updateWiki = ROOM_TOOLS.find((t) => t.name === "update_wiki")!;

    // Discover the wiki + read its doc version (cross-file, via the multi-artifact layer).
    const wiki = (await rt.listArtifacts()).find((a) => a.kind === "note" && /wiki/i.test(a.title))!;
    expect(wiki).toBeTruthy();
    const before = await rt.readRange(["doc"], wiki.id);

    // Grounded write — cites the SHEET as its source.
    const res = await updateWiki.execute({ artifactId: wiki.id, content: "Q3 variance reconciled from the sheet; null cells preserved.", citesArtifactIds: [d.sheetId], baseVersion: before[0].version }, rt);
    expect((res as { ok?: boolean }).ok).toBe(true);
    const doc = String(engine.getArtifact(wiki.id)!.elements["doc"]?.value);
    expect(doc).toContain("Q3 variance reconciled");   // content written
    expect(doc).toContain(d.sheetId);                   // grounding is VISIBLE (cites the source)

    // Grounding ENFORCED: the schema rejects an ungrounded write (0 citations).
    expect(updateWiki.schema.safeParse({ artifactId: wiki.id, content: "x", citesArtifactIds: [], baseVersion: 1 }).success).toBe(false);

    // CAS: a stale baseVersion conflicts (no clobber of a concurrent edit).
    const stale = await updateWiki.execute({ artifactId: wiki.id, content: "again", citesArtifactIds: [d.sheetId], baseVersion: before[0].version }, rt);
    expect((stale as { conflict?: boolean }).conflict).toBe(true);
  });
});

describe("WORKFLOW EVAL — finance reconciliation (derive/compare: reconcile to targets, skip already-correct, no clobber)", () => {
  it("reconcile_cell SKIPS an already-correct cell (untouched), CORRECTS a wrong cell, and CAS-protects against a stale baseline", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const reconcile = ROOM_TOOLS.find((t) => t.name === "reconcile_cell")!;

    // Set up: r_rev already CORRECT (== its target), r_ni WRONG (stale) — as if derived from q2/q3 or a 2nd source.
    const revV0 = (await rt.readRange(["r_rev__variance"]))[0];
    await rt.editCell("r_rev__variance", "+24%", revV0.version);     // r_rev now matches its target
    const niV0 = (await rt.readRange(["r_ni__variance"]))[0];
    await rt.editCell("r_ni__variance", "+99%", niV0.version);       // r_ni is wrong

    // Reconcile the already-correct cell → SKIPPED, untouched (no version bump → already-correct cells aren't re-written).
    const revNow = (await rt.readRange(["r_rev__variance"]))[0];
    const revRes = await reconcile.execute({ elementId: "r_rev__variance", expectedValue: "+24%", baseVersion: revNow.version }, rt);
    expect((revRes as { skipped?: boolean }).skipped).toBe(true);
    expect((await rt.readRange(["r_rev__variance"]))[0].version).toBe(revNow.version); // untouched

    // Reconcile the wrong cell → CORRECTED.
    const niNow = (await rt.readRange(["r_ni__variance"]))[0];
    const niRes = await reconcile.execute({ elementId: "r_ni__variance", expectedValue: "+22.4%", baseVersion: niNow.version }, rt);
    expect((niRes as { corrected?: boolean }).corrected).toBe(true);
    expect(String((await rt.readRange(["r_ni__variance"]))[0].value)).toBe("+22.4%");

    // No clobber: a stale baseVersion conflicts.
    const stale = await reconcile.execute({ elementId: "r_ni__variance", expectedValue: "+30%", baseVersion: niNow.version }, rt);
    expect((stale as { conflict?: boolean }).conflict).toBe(true);
  });
});
