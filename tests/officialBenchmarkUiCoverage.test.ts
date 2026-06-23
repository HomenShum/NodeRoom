import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BENCHMARK_DELIVERABLE_TYPES,
  buildOfficialBenchmarkUiCoverageReport,
  SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH,
  type SpreadsheetBenchLiveRoomProof,
} from "../src/eval/officialBenchmarkUiCoverage";

const PROOF_ABS = resolve(process.cwd(), SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH);
const PROOF_BAK = `${PROOF_ABS}.testbak`;

/** Run `fn` with a temporary honest proof receipt on disk, then restore any pre-existing one. */
function withHonestProof<T>(overrides: Partial<SpreadsheetBenchLiveRoomProof>, fn: () => T): T {
  const hadReal = existsSync(PROOF_ABS);
  if (hadReal) renameSync(PROOF_ABS, PROOF_BAK);
  const proof: SpreadsheetBenchLiveRoomProof = {
    schema: 1,
    task: "nb-01-company-profile",
    generatedAt: "test",
    baseUrl: "http://localhost:5273",
    memoryMode: false,
    gradingMethod: "cell-read",
    note: "test fixture",
    scorer: { name: "gradeGolden", file: "src/benchmarks/golden/grader.ts" },
    grade: { score: 1, ok: true, correct: 5, n: 5, fabrication: 0, flags: [] },
    selfTest: { goodScore: 1, badScore: 0.5, badRejected: true },
    cells: {},
    passed: true,
    gatesProven: [
      "fresh_room_join",
      "official_fixture_upload",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "official_scorer_handoff",
      "no_memory_mode_shortcut",
    ],
    gatesNotProven: {
      deliverable_export_download: "no sheet->.xlsx export",
      artifact_reopen_validation: "no exported file to reopen",
    },
    ...overrides,
  };
  try {
    mkdirSync(dirname(PROOF_ABS), { recursive: true });
    writeFileSync(PROOF_ABS, `${JSON.stringify(proof, null, 2)}\n`);
    return fn();
  } finally {
    rmSync(PROOF_ABS, { force: true });
    if (hadReal) renameSync(PROOF_BAK, PROOF_ABS);
  }
}

afterEach(() => {
  // Defensive: never leave a stray backup around.
  if (existsSync(PROOF_BAK) && !existsSync(PROOF_ABS)) renameSync(PROOF_BAK, PROOF_ABS);
});

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

  it("does not treat memory-mode or runner-only evidence as live-browser benchmark proof (no receipt)", () => {
    // Baseline: with NO live-room proof receipt on disk, every track is missing.
    const hadReal = existsSync(PROOF_ABS);
    if (hadReal) renameSync(PROOF_ABS, PROOF_BAK);
    try {
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
    } finally {
      if (hadReal) renameSync(PROOF_BAK, PROOF_ABS);
    }
  });

  it("flips ONLY the proven gates to covered when an honest live-room receipt exists — never the export/reopen gates", () => {
    withHonestProof({}, () => {
      const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
      const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
      const gate = (id: string) => v1.gates.find((g) => g.id === id)?.status;

      // The live-room run genuinely proves these — they flip to covered.
      expect(gate("fresh_room_join")).toBe("covered");
      expect(gate("official_fixture_upload")).toBe("covered");
      expect(gate("public_nodeagent_invocation")).toBe("covered");
      expect(gate("visible_streaming_progress")).toBe("covered");
      expect(gate("official_scorer_handoff")).toBe("covered");
      expect(gate("no_memory_mode_shortcut")).toBe("covered");

      // The genuine gap stays missing — there is no sheet->.xlsx export in the live desktop room.
      expect(gate("deliverable_export_download")).toBe("missing");
      expect(gate("artifact_reopen_validation")).toBe("missing");

      // The workbook deliverable is still missing, so the track is PARTIAL (not covered) — honest.
      expect(v1.status).toBe("partial");
      expect(v1.missingDeliverables).toEqual(["workbook"]);
      expect(report.summary.liveBrowserFreshRoomReady).toBe(false);
      expect(v1.blockers.join(" ")).toContain("Live-browser fresh-room run PASSED");
    });
  });

  it("refuses to flip on a tampered/dishonest receipt (memory mode, fabrication, failed self-test, or not-passed)", () => {
    const stays = (overrides: Partial<SpreadsheetBenchLiveRoomProof>) =>
      withHonestProof(overrides, () => {
        const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
        const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
        expect(v1.gates.find((g) => g.id === "fresh_room_join")?.status).toBe("missing");
        expect(v1.status).toBe("missing");
      });

    stays({ memoryMode: true });
    stays({ passed: false });
    stays({ grade: { score: 0.4, ok: false, correct: 2, n: 5, fabrication: 0, flags: ["wrong"] } });
    stays({ grade: { score: 0.8, ok: true, correct: 5, n: 5, fabrication: 1, flags: ["fabricated key"] } });
    stays({ selfTest: { goodScore: 0.8, badScore: 0.5, badRejected: true } }); // self-test good != 1.0
    stays({ selfTest: { goodScore: 1, badScore: 1, badRejected: false } }); // anti-cheat didn't fire
  });

  it("requires fresh-room browser gates, export/download, artifact reopen, and scorer handoff (no receipt)", () => {
    const hadReal = existsSync(PROOF_ABS);
    if (hadReal) renameSync(PROOF_ABS, PROOF_BAK);
    try {
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
    } finally {
      if (hadReal) renameSync(PROOF_BAK, PROOF_ABS);
    }
  });

  it("keeps export/download + artifact-reopen MISSING for spreadsheetbench-v1 even with an honest receipt (the genuine gap)", () => {
    withHonestProof({}, () => {
      const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
      const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
      // The two export-shaped gates are the honest hard floor: no file leaves the room.
      expect(v1.gates.find((g) => g.id === "deliverable_export_download")?.status).toBe("missing");
      expect(v1.gates.find((g) => g.id === "artifact_reopen_validation")?.status).toBe("missing");
      // The other two tracks have no receiver wired, so they stay fully missing.
      expect(report.tracks.find((t) => t.id === "bankertoolbench")?.status).toBe("missing");
      expect(report.tracks.find((t) => t.id === "spreadsheetbench-v2")?.status).toBe("missing");
    });
  });

  it("flips export/download + artifact-reopen to COVERED when a file-export receipt proves both gates", () => {
    withHonestProof(
      {
        gradingMethod: "file-export",
        note: "Live sheet export round-tripped through Export XLSX + exceljs reopen + gradeGolden.",
        gatesProven: [
          "fresh_room_join",
          "official_fixture_upload",
          "public_nodeagent_invocation",
          "visible_streaming_progress",
          "deliverable_export_download",
          "artifact_reopen_validation",
          "official_scorer_handoff",
          "no_memory_mode_shortcut",
        ],
        gatesNotProven: {},
        deliverable_export_download: {
          downloaded: true,
          bytes: 4523,
          magic: "PK\\x03\\x04",
          filename: "spreadsheetbench-export.xlsx",
        },
        artifact_reopen_validation: {
          reopened: true,
          scorerResult: "pass",
          cellsMatched: "5/5",
          correct: 5,
          n: 5,
        },
      },
      () => {
        const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
        const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
        const gate = (id: string) => v1.gates.find((g) => g.id === id)?.status;

        // Both export-shaped gates flip when the receipt proves them under file-export grading.
        expect(gate("deliverable_export_download")).toBe("covered");
        expect(gate("artifact_reopen_validation")).toBe("covered");
        // The workbook deliverable is now part of the live-browser package.
        expect(v1.liveBrowserFreshRoomDeliverables).toEqual(["workbook"]);
        expect(v1.missingDeliverables).toEqual([]);
        // Every gate covered (trace_video covered via proof, the rest via gatesProven) → track flips
        // to covered.
        expect(v1.status).toBe("covered");
      },
    );
  });

  it("does NOT flip export/reopen when the receipt's gradingMethod is still cell-read, even if the gate ids appear in gatesProven", () => {
    // Defensive: a receipt that claims to prove the export gates but graded via cell-read is
    // internally inconsistent — refuse to flip the workbook deliverable.
    withHonestProof(
      {
        gradingMethod: "cell-read",
        gatesProven: [
          "fresh_room_join",
          "official_fixture_upload",
          "public_nodeagent_invocation",
          "visible_streaming_progress",
          "deliverable_export_download",
          "artifact_reopen_validation",
          "official_scorer_handoff",
          "no_memory_mode_shortcut",
        ],
        gatesNotProven: {},
        deliverable_export_download: {
          downloaded: true,
          bytes: 4523,
          magic: "PK\\x03\\x04",
          filename: "spreadsheetbench-export.xlsx",
        },
        artifact_reopen_validation: {
          reopened: true,
          scorerResult: "pass",
          cellsMatched: "5/5",
          correct: 5,
          n: 5,
        },
      },
      () => {
        const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
        const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
        // The deliverable stays missing because the grade did not come from a reopened file.
        expect(v1.liveBrowserFreshRoomDeliverables).toEqual([]);
        expect(v1.missingDeliverables).toEqual(["workbook"]);
      },
    );
  });

  it("refuses to flip deliverable_export_download when the structured receipt is tampered (zero bytes, wrong magic, downloaded:false, or missing)", () => {
    // The gate flip now requires a STRUCTURED `deliverable_export_download` field that
    // independently validates — a `gatesProven` string entry without the field, or with garbage
    // bytes/magic, is not enough. Five tamper variants, all must keep the gate `missing` AND
    // surface the structured-receipt blocker (so a debugger can see the dishonest claim).
    const expectsExportMissing = (overrides: Partial<SpreadsheetBenchLiveRoomProof>) =>
      withHonestProof(
        {
          gradingMethod: "file-export",
          gatesProven: [
            "fresh_room_join",
            "official_fixture_upload",
            "public_nodeagent_invocation",
            "visible_streaming_progress",
            "deliverable_export_download",
            "artifact_reopen_validation",
            "official_scorer_handoff",
            "no_memory_mode_shortcut",
          ],
          gatesNotProven: {},
          artifact_reopen_validation: {
            reopened: true,
            scorerResult: "pass",
            cellsMatched: "5/5",
            correct: 5,
            n: 5,
          },
          ...overrides,
        },
        () => {
          const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
          const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
          const exportGate = v1.gates.find((g) => g.id === "deliverable_export_download");
          expect(exportGate?.status).toBe("missing");
          // The workbook stays missing because the export gate didn't flip.
          expect(v1.liveBrowserFreshRoomDeliverables).toEqual([]);
          expect(v1.missingDeliverables).toEqual(["workbook"]);
          expect(v1.status).not.toBe("covered");
        },
      );

    // (a) Field entirely missing despite the string-claim.
    expectsExportMissing({ deliverable_export_download: undefined });
    // (b) Zero-byte file — magic header is right but the file is empty.
    expectsExportMissing({
      deliverable_export_download: { downloaded: true, bytes: 0, magic: "PK\\x03\\x04", filename: "stub.xlsx" },
    });
    // (c) Wrong magic — e.g. a CSV renamed to .xlsx. The first bytes will be ASCII text, not PK.
    expectsExportMissing({
      deliverable_export_download: { downloaded: true, bytes: 4523, magic: "year", filename: "stub.xlsx" },
    });
    // (d) downloaded: false (the spec aborted but still wrote a receipt).
    expectsExportMissing({
      deliverable_export_download: { downloaded: false, bytes: 4523, magic: "PK\\x03\\x04", filename: "stub.xlsx" },
    });
    // (e) Missing filename — receipts must record what was downloaded.
    expectsExportMissing({
      deliverable_export_download: { downloaded: true, bytes: 4523, magic: "PK\\x03\\x04", filename: "" },
    });
  });

  it("refuses to flip artifact_reopen_validation when the structured receipt is tampered (scorerResult:fail, partial cellsMatched, reopened:false, or missing)", () => {
    // Same defense-in-depth on the reopen side: the gate flip requires `reopened === true` AND
    // `scorerResult === 'pass'` AND `correct === n > 0`. Four tamper variants, all must keep the
    // gate missing.
    const expectsReopenMissing = (overrides: Partial<SpreadsheetBenchLiveRoomProof>) =>
      withHonestProof(
        {
          gradingMethod: "file-export",
          gatesProven: [
            "fresh_room_join",
            "official_fixture_upload",
            "public_nodeagent_invocation",
            "visible_streaming_progress",
            "deliverable_export_download",
            "artifact_reopen_validation",
            "official_scorer_handoff",
            "no_memory_mode_shortcut",
          ],
          gatesNotProven: {},
          deliverable_export_download: {
            downloaded: true,
            bytes: 4523,
            magic: "PK\\x03\\x04",
            filename: "spreadsheetbench-export.xlsx",
          },
          ...overrides,
        },
        () => {
          const report = buildOfficialBenchmarkUiCoverageReport({ generatedAt: "test" });
          const v1 = report.tracks.find((t) => t.id === "spreadsheetbench-v1")!;
          const reopenGate = v1.gates.find((g) => g.id === "artifact_reopen_validation");
          expect(reopenGate?.status).toBe("missing");
          expect(v1.liveBrowserFreshRoomDeliverables).toEqual([]);
          expect(v1.missingDeliverables).toEqual(["workbook"]);
          expect(v1.status).not.toBe("covered");
        },
      );

    // (a) Field entirely missing despite the string-claim.
    expectsReopenMissing({ artifact_reopen_validation: undefined });
    // (b) scorerResult: "fail" — reopen happened but grading rejected the workbook.
    expectsReopenMissing({
      artifact_reopen_validation: { reopened: true, scorerResult: "fail", cellsMatched: "3/5", correct: 3, n: 5 },
    });
    // (c) Partial match — reopened, scorer says "pass", but correct < n (internal inconsistency).
    expectsReopenMissing({
      artifact_reopen_validation: { reopened: true, scorerResult: "pass", cellsMatched: "4/5", correct: 4, n: 5 },
    });
    // (d) reopened: false (the spec couldn't read the file but still wrote the receipt).
    expectsReopenMissing({
      artifact_reopen_validation: { reopened: false, scorerResult: "pass", cellsMatched: "5/5", correct: 5, n: 5 },
    });
  });
});
