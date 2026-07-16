import { describe, expect, it } from "vitest";
import { isSpreadsheetBenchOfficialV2AcceptedRefreshStatus } from "../src/eval/spreadsheetBenchOfficialV2Acceptance";

describe("SpreadsheetBench V2 official refresh acceptance", () => {
  it.each(["completed", "completed_stable_pending"])("accepts canonical terminal status %s", (status) => {
    expect(isSpreadsheetBenchOfficialV2AcceptedRefreshStatus(status)).toBe(true);
  });

  it.each([
    undefined,
    "refreshed",
    "not_required",
    "preserved_pending",
    "preserved_unsupported",
    "preserved_error",
  ])("rejects non-completed status %s", (status) => {
    expect(isSpreadsheetBenchOfficialV2AcceptedRefreshStatus(status)).toBe(false);
  });
});
