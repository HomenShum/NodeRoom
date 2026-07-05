import { describe, expect, it } from "vitest";
import {
  buildProofloopProdBrowserAdapterLedger,
  renderProofloopProdBrowserAdapterLedgerMarkdown,
} from "../src/eval/proofloopProdBrowserAdapters";

describe("ProofLoop prod browser adapter ledger", () => {
  it("version-tracks every blocked prod proxy adapter family", () => {
    const ledger = buildProofloopProdBrowserAdapterLedger({ generatedAt: "2026-07-05T00:00:00.000Z" });

    expect(ledger.schema).toBe("proofloop-prod-browser-adapter-ledger-v1");
    expect(ledger.harnessVersion).toBe("prod-browser-adapters-2026-07-05.4");
    expect(ledger.summary.adaptersTracked).toBe(6);
    expect(ledger.summary.contractScaffolded).toBe(0);
    expect(ledger.summary.browserScenarioMissing).toBe(0);
    expect(ledger.summary.taskTargetsCoveredByContracts).toBe(1251);
    expect(ledger.summary.modelTaskAttemptsCoveredByContracts).toBe(5004);
    expect(ledger.adapters.map((adapter) => adapter.id)).toContain("spreadsheetbench-v1-official-workbook-prod-browser");
    expect(ledger.adapters.map((adapter) => adapter.id)).toContain("accounting-live-config-to-prod-browser-room");
  });

  it("renders command shapes and refuses to treat contracts as passes", () => {
    const markdown = renderProofloopProdBrowserAdapterLedgerMarkdown(buildProofloopProdBrowserAdapterLedger());

    expect(markdown).toContain("A contract is not a pass");
    expect(markdown).toContain("npm run proofloop:live:spreadsheetbench-v1");
    expect(markdown).toContain("| `spreadsheetbench-v1-official-workbook-prod-browser` | `spreadsheetbench-v1-full-912` | 0.2.0 | 912 | 3648 | browser_scenario_ready | ready |");
    expect(markdown).toContain("| `accounting-live-config-to-prod-browser-room` | `accounting-live-proofloop` | 0.2.0 | 4 | 16 | browser_scenario_ready | ready |");
    expect(markdown).toContain("| `proximitty-underwriting-prod-browser-room` | `proximitty-underwriting-pr0` | 0.2.0 | 4 | 16 | browser_scenario_ready | ready |");
    expect(markdown).toContain("| `noderoom-multi-user-conflict-prod-browser-room` | `noderoom-multi-user-conflict` | 0.2.0 | 6 | 24 | browser_scenario_ready | ready |");
  });
});
