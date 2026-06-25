import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ReworkLedger = {
  schema: 1;
  entries: Array<Record<string, unknown>>;
};

describe("Rework Ledger", () => {
  it("records failure proof and replacement proof for every reworked approach", () => {
    const ledger = JSON.parse(readFileSync("docs/rework/rework-ledger.json", "utf8")) as ReworkLedger;

    expect(ledger.schema).toBe(1);
    expect(ledger.entries.length).toBeGreaterThanOrEqual(6);
    for (const entry of ledger.entries) {
      for (const field of [
        "id",
        "oldApproach",
        "whyItSeemedRight",
        "whatFailed",
        "failureProof",
        "newApproach",
        "survivalProof",
        "status",
      ]) {
        expect(String(entry[field] ?? ""), `${String(entry.id)} missing ${field}`).toMatch(/\S/);
      }
      expect(entry.status, `${String(entry.id)} status`).toMatch(/^(replaced|kept|deleted|pending)$/);
    }
  });
});
