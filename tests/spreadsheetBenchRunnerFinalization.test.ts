import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCandidateExcelFinalizationReceipt } from "../src/eval/spreadsheetBenchRunner";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench runner Excel finalization evidence", () => {
  it("accepts completed evidence only with supported topology and 0/0 calculation states", () => {
    const fixture = finalizationFixture(Buffer.from("candidate-after-cache-patch"));
    const beforeSha256 = sha256(Buffer.from("candidate-before-cache-patch"));
    writeReceipt(fixture.receiptPath, {
      status: "completed",
      reason: "excel_calculation_done_and_supported_topology",
      beforeSha256,
      afterSha256: fixture.candidateSha256,
      changed: true,
      formulaCellCount: 2,
      cacheWriteMode: "original_package_formula_cache_patch",
      calculationStates: { beforeCacheRead: 0, afterCacheRead: 0 },
      formulaTopology: {
        safe: true,
        supportedTypes: ["normal", "shared", "array", "dataTable"],
        counts: { normal: 2, shared: 0, array: 0, dataTable: 0, unknown: 0 },
        cacheTargetCellCount: 2,
        unsupported: [],
      },
      formulaTopologyPreservation: topologyPreservation(2),
    });

    const receipt = readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256,
      receiptPath: fixture.receiptPath,
    });

    expect(receipt).toMatchObject({
      status: "completed",
      reason: "excel_calculation_done_and_supported_topology",
      changed: true,
      calculationStates: { beforeCacheRead: 0, afterCacheRead: 0 },
      formulaTopology: { safe: true, counts: { normal: 2 } },
      formulaTopologyPreservation: topologyPreservation(2),
    });
  });

  it("accepts explicit stable-pending completion only with three-read stability evidence", () => {
    const fixture = finalizationFixture(Buffer.from("candidate-after-stable-pending-cache-patch"));
    const beforeSha256 = sha256(Buffer.from("candidate-before-stable-pending-cache-patch"));
    writeReceipt(fixture.receiptPath, {
      status: "completed_stable_pending",
      reason: "excel_cache_values_stable_while_calculation_pending",
      beforeSha256,
      afterSha256: fixture.candidateSha256,
      changed: true,
      formulaCellCount: 2,
      cacheWriteMode: "original_package_formula_cache_patch",
      calculationStates: { beforeCacheRead: 2, afterCacheRead: 2 },
      calculationStability: {
        mode: "stable_pending_opt_in",
        passed: true,
        requiredIdenticalReads: 3,
        observedIdenticalReads: 3,
        observedReads: 3,
        sampleIntervalMs: 250,
        timeoutMs: 10_000,
      },
      formulaTopology: {
        safe: true,
        supportedTypes: ["normal", "shared", "array", "dataTable"],
        counts: { normal: 2, shared: 0, array: 0, dataTable: 0, unknown: 0 },
        cacheTargetCellCount: 2,
        unsupported: [],
      },
      formulaTopologyPreservation: topologyPreservation(2),
    });

    const receipt = readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256,
      receiptPath: fixture.receiptPath,
    });

    expect(receipt).toMatchObject({
      status: "completed_stable_pending",
      calculationStates: { beforeCacheRead: 2, afterCacheRead: 2 },
      calculationStability: {
        mode: "stable_pending_opt_in",
        passed: true,
        requiredIdenticalReads: 3,
        observedIdenticalReads: 3,
      },
      formulaTopology: { safe: true },
      formulaTopologyPreservation: topologyPreservation(2),
    });
  });

  it.each([
    {
      status: "not_required",
      reason: "workbook_contains_no_formula_cells",
      formulaCellCount: 0,
      formulaTopology: { safe: true, counts: { normal: 0 }, unsupported: [] },
    },
    {
      status: "preserved_pending",
      reason: "excel_calculation_state_not_done",
      formulaCellCount: 1,
      calculationStates: { beforeCacheRead: 2, afterCacheRead: 2 },
      calculationStability: {
        mode: "stable_pending_opt_in",
        passed: false,
        requiredIdenticalReads: 3,
        observedIdenticalReads: 2,
        observedReads: 2,
        sampleIntervalMs: 250,
        timeoutMs: 10_000,
      },
      formulaTopology: { safe: true, counts: { normal: 1 }, unsupported: [] },
    },
    {
      status: "preserved_unsupported",
      reason: "unsupported_formula_topology",
      formulaCellCount: 1,
      formulaTopology: {
        safe: false,
        counts: { unknown: 1 },
        unsupported: [{ sheet: "Sheet1", cell: "A1", type: "unknown" }],
      },
    },
    {
      status: "preserved_error",
      reason: "package_read_error",
    },
  ] as const)("accepts $status as unchanged terminal evidence", (terminal) => {
    const fixture = finalizationFixture(Buffer.from(`unchanged-${terminal.status}`));
    writeReceipt(fixture.receiptPath, {
      ...terminal,
      beforeSha256: fixture.candidateSha256,
      afterSha256: fixture.candidateSha256,
      changed: false,
      cacheWriteMode: terminal.status === "not_required"
        ? "no_formula_caches"
        : "none_preserved_original_package",
    });

    const receipt = readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256: fixture.candidateSha256,
      receiptPath: fixture.receiptPath,
    });

    expect(receipt).toMatchObject({
      status: terminal.status,
      reason: terminal.reason,
      changed: false,
      beforeSha256: fixture.candidateSha256,
      afterSha256: fixture.candidateSha256,
    });
    if ("calculationStates" in terminal) {
      expect(receipt.calculationStates).toEqual(terminal.calculationStates);
    }
    if ("formulaTopology" in terminal) {
      expect(receipt.formulaTopology).toEqual(terminal.formulaTopology);
    }
  });

  it("rejects state 2 as ordinary completion and rejects false preservation hashes", () => {
    const fixture = finalizationFixture(Buffer.from("unchanged-candidate"));
    writeReceipt(fixture.receiptPath, {
      status: "completed",
      reason: "incorrectly_stabilized_while_pending",
      beforeSha256: fixture.candidateSha256,
      afterSha256: fixture.candidateSha256,
      changed: false,
      formulaCellCount: 1,
      calculationStates: { beforeCacheRead: 2, afterCacheRead: 2 },
      formulaTopology: { safe: true, counts: { normal: 1 }, unsupported: [] },
    });

    expect(() => readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256: fixture.candidateSha256,
      receiptPath: fixture.receiptPath,
    })).toThrow(/requires Excel calculation state 0/);

    const differentSha256 = sha256(Buffer.from("different-candidate"));
    writeReceipt(fixture.receiptPath, {
      status: "preserved_error",
      reason: "excel_com_error",
      beforeSha256: fixture.candidateSha256,
      afterSha256: differentSha256,
      changed: true,
    });
    expect(() => readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256: fixture.candidateSha256,
      receiptPath: fixture.receiptPath,
    })).toThrow(/does not match the candidate workbook|unchanged identical hashes/);
  });

  it("rejects legacy refreshed status and any receipt that permits LibreOffice fallback", () => {
    const fixture = finalizationFixture(Buffer.from("candidate"));
    writeReceipt(fixture.receiptPath, {
      status: "refreshed",
      reason: "legacy_status",
      beforeSha256: fixture.candidateSha256,
      afterSha256: fixture.candidateSha256,
      changed: false,
    });
    expect(() => readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256: fixture.candidateSha256,
      receiptPath: fixture.receiptPath,
    })).toThrow(/non-canonical terminal status/);

    writeReceipt(fixture.receiptPath, {
      status: "preserved_error",
      reason: "excel_com_error",
      beforeSha256: fixture.candidateSha256,
      afterSha256: fixture.candidateSha256,
      changed: false,
    }, {
      engine: "Microsoft Excel with isolated LibreOffice fallback",
      fallback: "libreoffice",
    });
    expect(() => readCandidateExcelFinalizationReceipt({
      candidateWorkbookPath: fixture.candidatePath,
      beforeSha256: fixture.candidateSha256,
      receiptPath: fixture.receiptPath,
    })).toThrow(/no-fallback Excel policy/);
  });
});

function finalizationFixture(candidate: Buffer) {
  const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-finalization-"));
  roots.push(root);
  const candidatePath = join(root, "candidate.xlsx");
  const receiptPath = join(root, "candidate-finalization.json");
  writeFileSync(candidatePath, candidate);
  return {
    candidatePath,
    receiptPath,
    candidateSha256: sha256(candidate),
  };
}

function writeReceipt(
  path: string,
  record: Record<string, unknown>,
  options: { engine?: string; fallback?: string } = {},
) {
  writeFileSync(path, `${JSON.stringify({
    schema: 1,
    engine: options.engine ?? "Microsoft Excel COM fail-closed formula cache finalizer",
    policy: { fallback: options.fallback ?? "none" },
    workbookCount: 1,
    records: [record],
  }, null, 2)}\n`);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function topologyPreservation(formulaElementCount: number) {
  const topologySha256 = sha256(Buffer.from(`formula-topology-${formulaElementCount}`));
  return {
    matched: true,
    beforeSha256: topologySha256,
    afterSha256: topologySha256,
    formulaElementCount,
  };
}
