import { describe, expect, it } from "vitest";
import {
  engine,
  enterScaleDemoRoomAsHost,
  SCALE_DEMO_ARTIFACTS,
  SCALE_DEMO_MEMBERS,
  SCALE_DEMO_ROWS,
} from "../src/app/roomStore";

describe("scale demo parity room", () => {
  it("seeds the States & Scale proof data without fake counters", () => {
    const session = enterScaleDemoRoomAsHost();
    const artifacts = engine.listArtifacts(session.roomId);
    const members = engine.listMembers(session.roomId);
    const messages = engine.listMessages(session.roomId, "public");
    const research = artifacts.find((artifact) => artifact.kind === "sheet" && artifact.title === "Company research");

    expect(artifacts).toHaveLength(SCALE_DEMO_ARTIFACTS);
    expect(members).toHaveLength(SCALE_DEMO_MEMBERS);
    expect(messages).toHaveLength(312);
    expect(research?.meta?.dataframe?.rowCount).toBe(SCALE_DEMO_ROWS);
    expect(research?.meta?.dataframe?.columns).toHaveLength(14);

    const rowIds = uniqueRows(research?.order ?? []);
    expect(rowIds).toHaveLength(SCALE_DEMO_ROWS);

    const completedRows = rowIds.filter((rowId) => cellText(research?.elements[`${rowId}__status`]?.value) === "complete");
    expect(completedRows).toHaveLength(40);
    expect(uniqueEvidenceCount(research, completedRows)).toBe(47);

    const activeLocks = engine.awareness(session.roomId).activeLocks.filter((lock) => lock.artifactId === research?.id);
    expect(activeLocks).toHaveLength(1);
    expect(activeLocks[0]?.elementIds).toEqual(expect.arrayContaining(["sr_0004__status", "sr_0005__summary", "sr_0006__funding"]));
  });
});

function uniqueRows(order: string[]): string[] {
  const rows: string[] = [];
  for (const id of order) {
    const rowId = id.split("__")[0];
    if (rowId && !rows.includes(rowId)) rows.push(rowId);
  }
  return rows;
}

function cellText(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) return String((value as { value: unknown }).value ?? "");
  return String(value ?? "");
}

function uniqueEvidenceCount(
  artifact: ReturnType<typeof engine.getArtifact> | undefined,
  rowIds: string[],
): number {
  const seen = new Set<string>();
  const evidenceCols = ["status", "summary", "funding", "headcount", "recent_signal", "source", "source2"];
  for (const rowId of rowIds) {
    for (const col of evidenceCols) {
      const value = artifact?.elements[`${rowId}__${col}`]?.value;
      const evidence = value && typeof value === "object" && "evidence" in value
        ? (value as { evidence?: Array<{ url?: string; source?: string; id?: string; label?: string }> }).evidence ?? []
        : [];
      for (const item of evidence) seen.add(item.url ?? item.source ?? item.id ?? item.label ?? "");
    }
  }
  seen.delete("");
  return seen.size;
}
