import { describe, expect, it } from "vitest";
import {
  BENCHMARK_DELIVERABLE_TYPES,
  buildOfficialBenchmarkUiCoverageReport,
} from "../src/eval/officialBenchmarkUiCoverage";

describe("official benchmark UI coverage ledger", () => {
  it("tracks every required official benchmark deliverable type", () => {
    const required = BENCHMARK_DELIVERABLE_TYPES.filter((item) => item.requiredFor.length > 0);

    expect(required.map((item) => item.kind)).toEqual([
      "workbook",
      "presentation",
      "document",
      "pdf",
    ]);
    expect(required.find((item) => item.kind === "workbook")?.requiredFor).toEqual([
      "bankertoolbench",
      "spreadsheetbench-v1",
      "spreadsheetbench-v2",
    ]);
    expect(required.find((item) => item.kind === "presentation")?.extensions).toEqual([".pptx"]);
    expect(required.find((item) => item.kind === "document")?.extensions).toEqual([".docx"]);
    expect(required.find((item) => item.kind === "pdf")?.extensions).toEqual([".pdf"]);
  });

  it("does not treat memory-mode or runner-only evidence as live-browser benchmark proof", () => {
    const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
    const tracks = Object.fromEntries(report.tracks.map((track) => [track.id, track]));

    expect(report.summary.liveBrowserFreshRoomReady).toBe(false);
    expect(report.policy.join(" ")).toContain("memory-mode");
    expect(report.policy.join(" ")).toContain("Runner-only evidence");

    expect(tracks.bankertoolbench).toMatchObject({
      status: "missing",
      requiredDeliverables: ["workbook", "presentation", "document", "pdf"],
      liveBrowserFreshRoomDeliverables: [],
      missingDeliverables: ["workbook", "presentation", "document", "pdf"],
      requiredSpec: "e2e/benchmark-ui-bankertoolbench.spec.ts",
    });
    expect(tracks["spreadsheetbench-v1"]).toMatchObject({
      status: "missing",
      requiredDeliverables: ["workbook"],
      liveBrowserFreshRoomDeliverables: [],
      requiredSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    });
    expect(tracks["spreadsheetbench-v2"]).toMatchObject({
      status: "missing",
      requiredDeliverables: ["workbook"],
      liveBrowserFreshRoomDeliverables: [],
      requiredSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    });
  });

  it("requires fresh-room browser gates, export/download, artifact reopen, and scorer handoff", () => {
    const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
    const requiredGates = report.gates.map((gate) => gate.id);

    expect(requiredGates).toEqual(expect.arrayContaining([
      "fresh_room_join",
      "official_fixture_upload",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "deliverable_export_download",
      "artifact_reopen_validation",
      "official_scorer_handoff",
      "trace_video_artifacts",
      "no_memory_mode_shortcut",
    ]));

    for (const track of report.tracks) {
      expect(track.gates.find((gate) => gate.id === "fresh_room_join")?.status).toBe("missing");
      expect(track.gates.find((gate) => gate.id === "deliverable_export_download")?.status).toBe("missing");
      expect(track.gates.find((gate) => gate.id === "artifact_reopen_validation")?.status).toBe("missing");
      expect(track.gates.find((gate) => gate.id === "official_scorer_handoff")?.status).toBe("missing");
      expect(track.blockers.join(" ")).toContain("Missing live-browser fresh-room proof");
    }
  });
});
