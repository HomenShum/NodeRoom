const ACCEPTED_REFRESH_STATUSES = new Set([
  "completed",
  "completed_stable_pending",
] as const);

export type SpreadsheetBenchOfficialV2AcceptedRefreshStatus =
  | "completed"
  | "completed_stable_pending";

export function isSpreadsheetBenchOfficialV2AcceptedRefreshStatus(
  status: string | undefined,
): status is SpreadsheetBenchOfficialV2AcceptedRefreshStatus {
  return ACCEPTED_REFRESH_STATUSES.has(status as SpreadsheetBenchOfficialV2AcceptedRefreshStatus);
}
