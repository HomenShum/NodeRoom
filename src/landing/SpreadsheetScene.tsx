/**
 * SpreadsheetScene — a static mock of the real NodeRoom workbook grid.
 *
 * It uses landing-local `xl-*` markup (the production ExcelGridSheet renderer was
 * removed ~2026-06-25; these classes now live only here + landingStory.css) so the
 * landing page looks like the product, then layers story-only overlay
 * classes (scoped under `.r-story`) for presence, agent lane, CAS, etc.
 *
 * Pure presentational: it renders whatever overlay state the active layer feeds.
 */
import { COLUMNS, GRID, type CellOverlay, type GridCell } from "./storyTape";

function cellClass(base: { numeric?: boolean; muted?: boolean; formula?: string; evidence?: string }, ov?: CellOverlay): string {
  const cls = ["xl-cell"];
  if (base.numeric) cls.push("num");
  if (base.muted) cls.push("muted");
  if (base.formula) cls.push("formula");
  if (base.evidence) cls.push("evidence");
  if (!ov) return cls.join(" ");
  if (ov.editing) cls.push("editing", "sel");
  if (ov.agentLane) cls.push("rs-lane");
  if (ov.protectedGlow) cls.push("rs-protected");
  if (ov.presence) cls.push("rs-presence");
  if (ov.cas === "pass") cls.push("rs-cas-pass");
  if (ov.cas === "conflict") cls.push("rs-cas-conflict");
  if (ov.committed) cls.push("rs-committed");
  if (ov.proposed) cls.push("rs-proposed");
  if (ov.leased) cls.push("rs-leased");
  return cls.join(" ");
}

export function SpreadsheetScene({
  cells = {},
  formulaBar = true,
  selected,
}: {
  cells?: Record<string, CellOverlay>;
  formulaBar?: boolean;
  /** Cell shown in the formula bar; defaults to the first presence/editing cell. */
  selected?: string;
}) {
  const activeRef =
    selected ??
    Object.keys(cells).find((k) => cells[k]?.editing || cells[k]?.presence) ??
    "C2";
  const activeBase = GRID.reduce<GridCell | undefined>(
    (acc, row) => acc ?? row.find((c) => c.ref === activeRef),
    undefined,
  );
  const activeOv = cells[activeRef];
  const fbarValue = activeBase?.formula ?? activeOv?.override ?? activeBase?.display ?? "";

  return (
    <div className="rs-sheet" role="img" aria-label="NodeRoom Q3 variance worksheet">
      {formulaBar && (
        <div className="xl-fbar rs-fbar">
          <span className="xl-name">{activeRef}</span>
          <span className="xl-fx">fx</span>
          <span className="xl-ftext">{fbarValue}</span>
          <span className="rs-grow" />
          {activeBase?.evidence && <span className="rs-evchip">{activeBase.evidence}</span>}
        </div>
      )}
      <div className="rs-grid-wrap">
        <table className="xl-grid rs-grid">
          <colgroup>
            <col style={{ width: 34 }} />
            {COLUMNS.map((c) => (
              <col key={c} style={{ width: c === "A" ? 108 : c === "E" ? 96 : 76 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="xl-corner" aria-hidden />
              {COLUMNS.map((c) => (
                <th key={c} className="xl-col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID.map((row, r) => (
              <tr key={r}>
                <td className="xl-rowhead">{r + 1}</td>
                {row.map((cell) => {
                  const ov = cells[cell.ref];
                  const value = ov?.override ?? cell.display;
                  return (
                    <td
                      key={cell.ref}
                      className={cellClass(cell, ov)}
                      data-cell-key={cell.ref}
                    >
                      <span className="rs-val">
                        {value || <span className="rs-null">&nbsp;</span>}
                      </span>
                      {ov?.presenceLabel && (
                        <span className="rs-presence-tag" style={{ background: ov.presence }}>
                          {ov.presenceLabel}
                        </span>
                      )}
                      {ov?.badge && <span className="rs-cell-badge">{ov.badge}</span>}
                      {cell.evidence && !ov?.badge && <span className="rs-ev-dot" aria-hidden />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
