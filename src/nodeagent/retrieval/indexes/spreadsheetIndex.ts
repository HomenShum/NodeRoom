import type { SpreadsheetContextHit } from "../../core/types";

export function spreadsheetContextToRetrievalText(hit: SpreadsheetContextHit): string {
  return hit.kind === "cell"
    ? `${hit.coordinate} ${hit.rowHeader} ${hit.columnHeader} ${hit.rawValue} ${hit.semanticSummary}`
    : hit.text;
}

