/**
 * Scenario: an analyst drops a list of companies into the room. The public Room
 * NodeAgent enriches every PENDING row with sourced research — for each company:
 * claim its cells → read + fetch a source → write summary + citation + status=complete
 * → release — through the SAME lock/CAS/release contract, fully traced. (ParselyFi loop.)
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { companyResearchPlan } from "../src/nodeagent/core/plans";
import { buildResearchContext } from "../src/nodeagent/core/worldModel";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import type { CellPayload } from "../src/engine/types";
import { cellEvidenceVerificationStatus } from "../src/nodeagent/core/evidenceReceipt";

const COMPANIES = [
  { rowId: "c1", name: "Acme AI", url: "https://acme.example", source2Url: "https://wiki.example/acme" },
  { rowId: "c2", name: "Globex", url: "https://globex.example", source2Url: "https://wiki.example/globex" },
  { rowId: "c3", name: "Initech", url: "https://initech.example", source2Url: "https://wiki.example/initech" },
];
const RESEARCH_COLS = ["company", "website", "status", "tier", "intent", "owner", "crm_status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"] as const;

function payload(value: unknown): CellPayload {
  return value as CellPayload;
}

function setup(seedStatus: (rowId: string) => string = () => "pending") {
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Diligence", hostName: "Homen", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: "Homen" };
  const seed: { id: string; value: unknown }[] = [];
  for (const c of COMPANIES) {
    const vals: Record<(typeof RESEARCH_COLS)[number], string> = {
      company: c.name, website: c.url, status: seedStatus(c.rowId), tier: "A", intent: "test intent", owner: "Homen", crm_status: "Research",
      summary: "", funding: "", headcount: "", recent_signal: "", source: "", source2: "", last_researched: "",
    };
    for (const col of RESEARCH_COLS) seed.push({ id: `${c.rowId}__${col}`, value: vals[col] });
  }
  const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: me, seed }).id;
  const sess = engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" });
  const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
  const rt = new InMemoryRoomTools(engine, room.id, sheetId, actor, sess.id);
  return { engine, room, sheetId, rt };
}
const plan = () => COMPANIES.map((c) => ({
  rowId: c.rowId,
  summary: `${c.name} - researched summary.`,
  funding: `${c.name} funding signal.`,
  headcount: `${c.name} headcount signal.`,
  recentSignal: `${c.name} recent signal.`,
  sourceUrl: c.url,
  source2Url: c.source2Url,
}));

describe("company research harness (ParselyFi loop)", () => {
  it("keeps browser-only synthetic enrichment in review while preserving the trace and source presentation", async () => {
    const { engine, sheetId, rt } = setup();
    const res = await runAgent({ rt, goal: "Research all pending companies.", model: scriptedModel(companyResearchPlan(plan())), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 40 });
    expect(res.exhausted).toBe(false);
    const art = engine.getArtifact(sheetId)!;
    for (const c of COMPANIES) {
      expect(payload(art.elements[`${c.rowId}__status`].value).value).toBe("needs_review");
      expect(String(payload(art.elements[`${c.rowId}__summary`].value).value)).toContain("researched summary");
      expect(String(payload(art.elements[`${c.rowId}__funding`].value).value)).toContain("funding signal");
      expect(String(payload(art.elements[`${c.rowId}__recent_signal`].value).value)).toContain("recent signal");
      expect(String(payload(art.elements[`${c.rowId}__source`].value).value).length).toBeGreaterThan(0);
      expect(String(payload(art.elements[`${c.rowId}__source2`].value).value).length).toBeGreaterThan(0);
      expect(payload(art.elements[`${c.rowId}__last_researched`].value).value).toBe("2026-06-07");
      const receipt = payload(art.elements[`${c.rowId}__summary`].value).evidence?.[0];
      expect(receipt?.kind).toBe("source");
      expect(receipt?.snippet).toContain("Reference page at");
      expect(receipt).not.toHaveProperty("verifiedAt");
      expect(receipt).not.toHaveProperty("contentDigest");
      expect(receipt).not.toHaveProperty("receiptDigest");
      expect(cellEvidenceVerificationStatus(receipt!)).toBe("unverified");
      expect(payload(art.elements[`${c.rowId}__summary`].value).status).toBe("needs_review");
      expect(payload(art.elements[`${c.rowId}__summary`].value).confidence).toBeGreaterThan(0);
    }
    expect(res.trace.filter((t) => t.tool === "write_cell_result").length).toBeGreaterThan(0);
    expect(res.trace.filter((t) => (t.tool === "edit_cell" || t.tool === "write_cell_result") && (t.result as { conflict?: boolean })?.conflict).length).toBe(0);
    expect(res.trace.filter((t) => t.tool === "release_lock").length).toBe(COMPANIES.length); // one lock cycle per company
    expect(res.trace.filter((t) => t.tool === "fetch_source").length).toBe(COMPANIES.length * 2); // multi-source, not invented
    expect(res.trace.filter((t) => t.tool === "fetch_source").every((t) => {
      const result = t.result as Record<string, unknown>;
      return result.provenance === "synthetic_fixture"
        && !("contentDigest" in result)
        && !("verifiedAt" in result)
        && !("receiptDigest" in result);
    })).toBe(true);
  });

  it("is status-gated: rows already 'complete' are skipped (batch-pending only)", async () => {
    const { engine, sheetId, rt } = setup((rowId) => (rowId === "c2" ? "complete" : "pending"));
    const res = await runAgent({ rt, goal: "Research all pending companies.", model: scriptedModel(companyResearchPlan(plan().filter((p) => p.rowId !== "c2"))), tools: ROOM_TOOLS, contextBuilder: buildResearchContext, maxSteps: 30 });
    expect(res.exhausted).toBe(false);
    const art = engine.getArtifact(sheetId)!;
    expect(String(art.elements["c2__summary"].value)).toBe(""); // untouched
    expect(res.trace.filter((t) => t.tool === "release_lock").length).toBe(2); // only c1 + c3
  });
});
