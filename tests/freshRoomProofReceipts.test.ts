import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFinanceDomainReceipt,
  buildFreshRoomProofRegistry,
  validateFreshRoomProofReceipt,
  type FreshRoomProofReceipt,
} from "../src/eval/freshRoomProofReceipts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("fresh-room proof receipt registry", () => {
  it("keeps selective BTB live proof separate from the full-suite claim", () => {
    const registry = buildFreshRoomProofRegistry({ generatedAt: "test" });
    const cases = Object.fromEntries(registry.cases.map((item) => [item.id, item]));

    expect(registry.policy.join(" ")).toContain("may not be collapsed");
    expect(registry.summary.financeDomainGatePassed).toBe(true);
    expect(registry.summary.selectiveBankerToolBenchReady).toBe(true);
    expect(registry.summary.selectiveLiveBrowserBenchmarkReady).toBe(true);
    expect(registry.summary.bankerToolBenchFullSuiteReady).toBe(false);
    expect(registry.summary.liveBrowserBenchmarkReady).toBe(false);

    expect(Object.keys(cases)).toEqual(["FR-020", "FR-020A", "FR-020B"]);
    expect(cases["FR-020"]).toMatchObject({
      lane: "bankertoolbench_selective_live_task",
      status: "passed",
      sourceReceipt: "docs/eval/fresh-room/FR-020/latest.json",
    });
    expect(cases["FR-020"].doesNotProve).toEqual(expect.arrayContaining([
      "100/100 task official BankerToolBench completion",
      "aggregate production benchmark score",
    ]));

    expect(cases["FR-020A"]).toMatchObject({
      lane: "bankertoolbench_selective_live_task",
      status: "passed",
    });
    expect(cases["FR-020A"].doesNotProve).toContain("full suite pass rate");
    expect(cases["FR-020A"].gates.find((gate) => gate.id === "fresh_room_ui")?.status).toBe("pass");
    expect(cases["FR-020A"].gates.find((gate) => gate.id === "official_verifier")?.status).toBe("pass");

    expect(cases["FR-020B"]).toMatchObject({
      lane: "bankertoolbench_full_suite",
      status: "blocked",
    });
    expect(cases["FR-020B"].gates.every((gate) => gate.status === "blocked")).toBe(true);
  });

  it("documents that the finance runtime receipt is not a live-browser benchmark proof", () => {
    const receipt = buildFinanceDomainReceipt({ generatedAt: "test" });
    const gates = Object.fromEntries(receipt.gates.map((gate) => [gate.id, gate]));

    expect(receipt.status).toBe("passed");
    expect(receipt.claimBoundary).toContain("not a live-browser official BankerToolBench score");
    expect(gates.professional_runtime_cases.status).toBe("pass");
    expect(gates.managed_write_coordination.status).toBe("pass");
    expect(gates.live_browser.status).toBe("blocked");
    expect(gates.export_reopen.status).toBe("blocked");
    expect(gates.official_scorer.status).toBe("blocked");
  });
});

describe("fresh-room proof receipts", () => {
  it("accepts the generalized FR-010 SpreadsheetBench live-browser receipt", () => {
    const receipt = validReceipt();
    const validation = validateFreshRoomProofReceipt(receipt, { caseId: "FR-010" });

    expect(validation).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects receipts that claim export/reopen/scorer gates without structured proof", () => {
    const receipt = validReceipt();
    const tampered: FreshRoomProofReceipt = {
      ...receipt,
      artifacts: { ...receipt.artifacts, exportedFiles: [], reopenedFiles: [] },
      scorer: { ...receipt.scorer!, verdict: "fail" },
    };

    const validation = validateFreshRoomProofReceipt(tampered, { caseId: "FR-010" });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("deliverable_export_download requires artifacts.exportedFiles");
    expect(validation.errors.join("\n")).toContain("artifact_reopen_validation requires artifacts.reopenedFiles");
    expect(validation.errors.join("\n")).toContain("official scorer handoff requires scorer.verdict=pass");
  });

  it("rejects receipts that point to missing screenshot, trace, or export evidence", () => {
    const receipt = validReceipt();
    const tampered: FreshRoomProofReceipt = {
      ...receipt,
      ui: { ...receipt.ui, screenshotPaths: ["missing-shot.png"], tracePath: "missing-trace.zip" },
      artifacts: {
        ...receipt.artifacts,
        exportedFiles: receipt.artifacts.exportedFiles?.map((file) => ({ ...file, path: "missing-export.xlsx" })),
      },
    };

    const validation = validateFreshRoomProofReceipt(tampered, { caseId: "FR-010" });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("screenshot path does not exist: missing-shot.png");
    expect(validation.errors.join("\n")).toContain("trace path does not exist: missing-trace.zip");
    expect(validation.errors.join("\n")).toContain("exported file path does not exist: missing-export.xlsx");
  });

  it("rejects claimed official uploads without structured uploaded file evidence", () => {
    const receipt = validReceipt();
    const tampered: FreshRoomProofReceipt = {
      ...receipt,
      freshness: { ...receipt.freshness, uploadedFiles: [] },
      artifacts: { ...receipt.artifacts, uploadedFiles: [] },
      gatesProven: [...receipt.gatesProven, "official_fixture_upload"],
    };

    const validation = validateFreshRoomProofReceipt(tampered, { caseId: "FR-010" });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("official_fixture_upload requires uploaded file evidence");
  });

  it("can require BTB package placeholder scan evidence for matrix status", () => {
    const receipt = validReceipt();

    const missing = validateFreshRoomProofReceipt(receipt, {
      caseId: "FR-010",
      requireArtifactPlaceholderScan: true,
    });

    expect(missing.ok).toBe(false);
    expect(missing.errors.join("\n")).toContain("missing required gate: artifact_placeholder_scan");

    const withScan = validateFreshRoomProofReceipt({
      ...receipt,
      gatesProven: [...receipt.gatesProven, "artifact_placeholder_scan"],
    }, {
      caseId: "FR-010",
      requireArtifactPlaceholderScan: true,
    });

    expect(withScan).toMatchObject({ ok: true, errors: [] });
  });

  it("can require BTB terminal agent quality evidence for matrix status", () => {
    const receipt = validReceipt();

    const missing = validateFreshRoomProofReceipt(receipt, {
      caseId: "FR-010",
      requireAgentTerminalQuality: true,
    });

    expect(missing.ok).toBe(false);
    expect(missing.errors.join("\n")).toContain("missing required gate: agent_terminal_quality_gate");

    const withGate = validateFreshRoomProofReceipt({
      ...receipt,
      gatesProven: [...receipt.gatesProven, "agent_terminal_quality_gate"],
    }, {
      caseId: "FR-010",
      requireAgentTerminalQuality: true,
    });

    expect(withGate).toMatchObject({ ok: true, errors: [] });
  });
});

function validReceipt(): FreshRoomProofReceipt {
  const root = mkdtempSync(join(tmpdir(), "fresh-room-proof-"));
  roots.push(root);
  const screenshot = join(root, "shot.png");
  const trace = join(root, "trace.zip");
  const exportPath = join(root, "export.xlsx");
  writeFileSync(screenshot, "png");
  writeFileSync(trace, "zip");
  writeFileSync(exportPath, "xlsx");
  return {
    schema: 1,
    caseId: "FR-010",
    benchmark: "spreadsheetbench-v1",
    taskId: "synthetic",
    generatedAt: "2026-06-24T00:00:00.000Z",
    baseUrl: "http://127.0.0.1:5273",
    roomId: "NRTEST",
    roomUrl: "http://127.0.0.1:5273/?room=NRTEST&name=Host",
    command: "npx playwright test",
    memoryMode: false,
    freshness: {
      roomCreatedAfterRunStart: true,
      forbiddenPreloadedArtifactsAbsent: true,
      artifactsCreatedFresh: ["export.xlsx"],
      uploadedFiles: ["input.xlsx"],
    },
    ui: {
      focusModeEnabled: true,
      attentionOverlayVisible: true,
      streamingVisible: true,
      jobDetailVisible: true,
      roomTraceVisible: true,
      screenshotPaths: [screenshot],
      tracePath: trace,
    },
    artifacts: {
      uploadedFiles: ["input.xlsx"],
      created: ["export.xlsx"],
      exportedFiles: [{ kind: "workbook", filename: "export.xlsx", path: exportPath, downloaded: true, bytes: 4 }],
      reopenedFiles: [{ kind: "workbook", filename: "export.xlsx", reopened: true, scorerResult: "pass" }],
    },
    scorer: { name: "synthetic", verdict: "pass" },
    visualJudge: { verdict: "not_run", reason: "unit test" },
    gatesProven: [
      "fresh_room_join",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "trace_video_artifacts",
      "no_memory_mode_shortcut",
      "focus_mode_enabled",
      "focus_box_or_attention_overlay",
      "deliverable_export_download",
      "artifact_reopen_validation",
      "official_scorer_handoff",
    ],
    passed: true,
  };
}
