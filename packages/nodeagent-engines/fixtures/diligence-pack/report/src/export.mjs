/**
 * exportReport(rows, { format }) -> string
 *
 * rows: comparison rows (see ./table.mjs). The export must:
 * - Reject the whole export (throw an Error whose message names the company and the field, and
 *   contains the word "citation") when any field in CITED_FIELDS has no citations, or any of its
 *   citations is not a valid token (see parseCitation).
 * - Sort rows by runwayMonths.value descending; ties by company name ascending. Never mutate the input.
 * - Throw an Error mentioning "format" for any format other than "csv", "markdown" or "json".
 *
 * Cells, in COLUMNS order, then a final "Sources" cell:
 * - company: the name; metrics: String(value); topRisk: its text.
 * - Sources: every citation of the row, in COLUMNS order, de-duplicated, joined by one space.
 *
 * csv:      header line of COLUMNS labels + "Sources", one line per row, "\n" line endings and a
 *           trailing "\n". RFC 4180 quoting: a field containing a comma, double quote, CR or LF is
 *           wrapped in double quotes and each inner double quote is doubled.
 * markdown: "| A | B |" header with the same labels, a "|---|---|" separator (one "---" per column),
 *           one "| ... |" line per row, trailing "\n". In cells, "|" becomes "\|" and each line break
 *           (CRLF, CR or LF) becomes "<br>".
 * json:     JSON.stringify({ schema: "diligence.report/v1", rows: out }, null, 2) + "\n", where each
 *           out row has exactly the COLUMNS keys in COLUMNS order (cell values as above, numbers
 *           stay numbers) followed by "sources" (the de-duplicated citation array). Key order must not
 *           depend on the key order of the input objects.
 */
import { CITED_FIELDS, COLUMNS, cellValue, citationsOf, parseCitation } from "./table.mjs";

export function exportReport(rows, { format } = {}) {
  throw new Error("not implemented");
}
