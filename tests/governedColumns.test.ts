/**
 * Agent-governed columns — scenario test (docs/architecture/AGENT_GOVERNED_COLUMNS.md).
 *
 * Persona: NodeAgents structuring a BLANK research sheet per task. They DECIDE the schema and inject it
 * through the harness tool (define_columns → RoomTools.setColumns), governed by the SAME artifact-version
 * CAS the engine already uses for cells — so it is safe under simultaneous multi-agent editing.
 *
 * Angles: concurrent CAS (no clobber + retry), declare-then-fill enforcement (no invisible orphans),
 * BOUND (200 cols / 50KB label), meta-only re-render (version bump with no cell edit), and
 * replace-prunes-orphan-cells.
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { MAX_COLUMNS } from "../src/engine/columns";
import type { Actor } from "../src/engine/types";

function setup() {
  const eng = new RoomEngine();
  const { room, host } = eng.createRoom({ title: "Diligence", hostName: "Maya", autoAllow: true });
  const hostActor: Actor = { kind: "user", id: host.id, name: "Maya" };
  // research opens BLANK — no columns; the agent structures it.
  const sheet = eng.createArtifact({ roomId: room.id, kind: "sheet", title: "Company research", by: hostActor, seed: [] });
  const mk = (id: string, name: string) => {
    const agent: Actor = { kind: "agent", id, name, scope: "public" };
    const sess = eng.startSession({ roomId: room.id, agentId: id, agentName: name, scope: "public" });
    return new InMemoryRoomTools(eng, room.id, sheet.id, agent, sess.id);
  };
  const cols = () => (eng.getArtifact(sheet.id)!.meta?.dataframe?.columns ?? []).map((c) => c.id);
  return { eng, room, sheet, mk, cols };
}

describe("governed columns — concurrent schema edits hold CAS (no clobber)", () => {
  it("two agents define_columns at the same baseVersion → exactly one ok, the other conflict; retry after re-snapshot succeeds", async () => {
    const { eng, sheet, mk, cols } = setup();
    const a = mk("agentA", "Agent A");
    const b = mk("agentB", "Agent B");
    const base = eng.getArtifact(sheet.id)!.version;

    const r1 = await a.setColumns({ baseVersion: base, mode: "replace", columns: [{ label: "Company" }, { label: "Stage" }] });
    const r2 = await b.setColumns({ baseVersion: base, mode: "merge", columns: [{ label: "Owner" }] });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(!r2.ok && "conflict" in r2 && r2.conflict).toBe(true);

    // The harness feeds the conflict's `actual` back so the loser re-bases and retries.
    const base2 = !r2.ok && "actual" in r2 ? r2.actual : -1;
    expect(base2).toBe(base + 1);
    const retry = await b.setColumns({ baseVersion: base2, mode: "merge", columns: [{ label: "Owner" }] });
    expect(retry.ok).toBe(true);

    expect(cols()).toEqual(["company", "stage", "owner"]);
    expect(eng.getArtifact(sheet.id)!.version).toBe(base + 2);
  });
});

describe("governed columns — declare-then-fill is enforced (no invisible orphans)", () => {
  it("an agent write to an UNDECLARED column is rejected with no_such_column; a declared column succeeds", async () => {
    const { eng, sheet, mk } = setup();
    const a = mk("agentA", "Agent A");
    const base = eng.getArtifact(sheet.id)!.version;
    const def = await a.setColumns({ baseVersion: base, mode: "replace", columns: [{ label: "Company" }, { label: "Stage" }] });
    expect(def.ok).toBe(true);

    const bad = await a.editCell("row1__valuation", "42", 0, undefined, "create");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && (bad as { error?: string }).error).toBe("no_such_column");

    const good = await a.editCell("row1__company", "CardioNova", 0, undefined, "create");
    expect(good.ok).toBe(true);
    expect(eng.getArtifact(sheet.id)!.elements["row1__company"]?.value).toBe("CardioNova");
  });

  it("a BLANK sheet with no declared schema does NOT block writes (legacy/freeform stays open)", async () => {
    const { sheet, mk } = setup();
    const a = mk("agentA", "Agent A");
    void sheet;
    const ok = await a.editCell("row1__anything", "v", 0, undefined, "create");
    expect(ok.ok).toBe(true);
  });
});

describe("governed columns — BOUND (count + label) and meta-only re-render", () => {
  it("define_columns with 200 columns and a 50KB label is capped at MAX_COLUMNS with the label clamped", async () => {
    const { eng, sheet, mk, cols } = setup();
    const a = mk("agentA", "Agent A");
    const base = eng.getArtifact(sheet.id)!.version;
    const many = Array.from({ length: 200 }, (_, i) => ({ label: i === 0 ? "x".repeat(50_000) : `Col ${i}` }));
    const r = await a.setColumns({ baseVersion: base, mode: "replace", columns: many });
    expect(r.ok).toBe(true);
    expect(cols().length).toBe(MAX_COLUMNS);
    const first = eng.getArtifact(sheet.id)!.meta!.dataframe!.columns[0];
    expect(first.label.length).toBeLessThanOrEqual(80);
  });

  it("define_columns with NO cell edit still bumps the artifact version and publishes the new headers (meta-only re-render)", async () => {
    const { eng, sheet, mk, cols } = setup();
    const a = mk("agentA", "Agent A");
    const base = eng.getArtifact(sheet.id)!.version;
    const r = await a.setColumns({ baseVersion: base, mode: "replace", columns: [{ label: "Company" }, { label: "Recent Signal" }] });
    expect(r.ok).toBe(true);
    expect(cols()).toEqual(["company", "recent_signal"]);
    expect(eng.getArtifact(sheet.id)!.version).toBe(base + 1);
  });
});

describe("governed columns — replace prunes orphan cells", () => {
  it("switching to replace without a dropped column deletes that column's cells", async () => {
    const { eng, sheet, mk } = setup();
    const a = mk("agentA", "Agent A");
    const base = eng.getArtifact(sheet.id)!.version;
    await a.setColumns({ baseVersion: base, mode: "replace", columns: [{ label: "Company" }, { label: "Stage" }] });
    const v1 = eng.getArtifact(sheet.id)!.version;
    await a.editCell("row1__company", "CardioNova", 0, undefined, "create");
    await a.editCell("row1__stage", "Series C", 0, undefined, "create");
    expect(eng.getArtifact(sheet.id)!.elements["row1__stage"]).toBeTruthy();

    // replace with only `company` → `stage` is dropped, its cell pruned
    const v2 = eng.getArtifact(sheet.id)!.version;
    const r = await a.setColumns({ baseVersion: v2, mode: "replace", columns: [{ label: "Company" }] });
    expect(r.ok).toBe(true);
    expect(eng.getArtifact(sheet.id)!.elements["row1__stage"]).toBeUndefined();
    expect(eng.getArtifact(sheet.id)!.elements["row1__company"]?.value).toBe("CardioNova");
    expect(v1).toBeLessThan(v2);
  });
});
