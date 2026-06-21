/* ============================================================================
   StoryLab — the live-interactable heart of the seven-layer walkthrough.

   A REAL spreadsheet backed by the in-browser RoomEngine (no network, no keys,
   the same engine the demo room uses). You can actually drive two of the shipped
   layers here:
     • Layer 1 — type a variance value → it paints instantly (optimistic) and the
       element version bumps (server-authoritative commit, in-engine).
     • Layer 5 — run the "no-clobber test": you stage an edit at version N, an
       agent lands a different value first (→ N+1), your stale-baseline commit is
       REJECTED and returned as conflict-as-data. No clobber.

   Everything below calls the same `store.applyEdit` CAS path as the live app —
   nothing is scripted. Presence (L2) and streaming (L3) are Convex-only, so they
   stay illustrated in the scroll story above, not faked here.
   ============================================================================ */
import * as React from "react";
import { createFreshRoom } from "../app/roomStore";
import { EngineStoreProvider, useStore } from "../app/store";
import type { Actor } from "../engine/types";

interface Row {
  id: string;
  label: string;
  budget: string;
  actual: string;
}
// The Q3 figures from the story tape (Budget = A, Actual = B, Variance = C).
const ROWS: Row[] = [
  { id: "r2", label: "Revenue", budget: "10,000", actual: "12,400" },
  { id: "r3", label: "COGS", budget: "4,000", actual: "5,100" },
  { id: "r4", label: "Gross profit", budget: "6,000", actual: "7,300" },
  { id: "r5", label: "OpEx", budget: "2,200", actual: "2,650" },
];
// The "teammate" who lands an edit first in the no-clobber test.
const AGENT: Actor = { kind: "agent", id: "agent_story", name: "NodeAgent", scope: "public" };
const TEST_ROW = ROWS[0]; // Revenue
const TEST_CELL = TEST_ROW.id + "__C";

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "op_" + Math.random().toString(36).slice(2);
  }
}

const LAB_STYLE = `
.sl-wrap{max-width:760px;margin:40px auto 8px;padding:0 20px;font-family:var(--font-ui,'Inter',system-ui,sans-serif);}
.sl-kicker{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-primary,#d97757);}
.sl-title{margin:6px 0 4px;font-size:21px;font-weight:700;letter-spacing:-.02em;color:var(--text-primary,#1a1714);}
.sl-sub{margin:0 0 16px;font-size:13.5px;line-height:1.5;color:var(--text-secondary,#5c5650);max-width:60ch;}
.sl-gridcard{border:1px solid var(--border-color,rgba(0,0,0,.1));border-radius:14px;background:var(--bg-secondary,#fff);box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px -12px rgba(0,0,0,.12);padding:16px;}
.sl-grid{display:flex;flex-direction:column;gap:1px;background:var(--border-color,rgba(0,0,0,.08));border:1px solid var(--border-color,rgba(0,0,0,.08));border-radius:9px;overflow:hidden;}
.sl-grow{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:1px;background:var(--border-color,rgba(0,0,0,.08));}
.sl-cell{background:var(--bg-primary,#fdfcfa);padding:8px 11px;font-size:13px;color:var(--text-primary,#1a1714);font-variant-numeric:tabular-nums;display:flex;align-items:center;min-height:20px;}
.sl-rh{font-weight:600;color:var(--text-secondary,#5c5650);}
.sl-colh{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary,#928a80);background:var(--bg-tertiary,#f3efe9);}
.sl-edit{width:100%;border:0;outline:0;background:transparent;font:inherit;color:var(--accent-primary-hover,#9c4f25);font-weight:600;font-variant-numeric:tabular-nums;}
.sl-edit:focus{background:var(--accent-primary-bg,#fbede3);box-shadow:inset 0 0 0 2px var(--accent-primary,#d97757);border-radius:4px;}
.sl-flash{animation:slflash .7s ease;}
@keyframes slflash{0%{background:var(--accent-primary-bg,#fbede3);}100%{background:var(--bg-primary,#fdfcfa);}}
.sl-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;}
.sl-btn{border:1px solid var(--border-strong,rgba(0,0,0,.16));background:var(--bg-primary,#fff);color:var(--text-primary,#1a1714);font:inherit;font-size:13px;font-weight:600;padding:8px 13px;border-radius:9px;cursor:pointer;transition:transform .1s,box-shadow .15s;}
.sl-btn:hover{box-shadow:0 2px 8px -2px rgba(0,0,0,.18);}
.sl-btn:active{transform:scale(.97);}
.sl-btn.primary{background:var(--accent-primary,#d97757);border-color:var(--accent-primary,#d97757);color:#fff;}
.sl-hint{font-size:12px;color:var(--text-tertiary,#928a80);}
.sl-conflict{margin-top:14px;border:1px solid var(--na-bad,#c0492f);border-left-width:3px;border-radius:10px;background:var(--na-bad-bg,#fbe8e0);padding:12px 14px;}
.sl-conflict-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--na-bad,#8b2812);}
.sl-conflict-dot{width:8px;height:8px;border-radius:50%;background:var(--na-bad,#c0492f);flex:none;}
.sl-conflict-b{margin:7px 0 0;font-size:12.5px;line-height:1.55;color:var(--text-secondary,#5c5650);}
.sl-conflict-b code{font-family:var(--font-mono,ui-monospace,monospace);font-size:11.5px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;}
`;

export function StoryLab(): React.ReactElement {
  // A dedicated fresh engine room so the playground never mutates the demo room.
  const lab = React.useMemo(() => createFreshRoom("Seven-layer playground", "You"), []);
  return (
    <EngineStoreProvider roomId={lab.roomId} me={lab.me}>
      <LabGrid roomId={lab.roomId} me={lab.me} />
    </EngineStoreProvider>
  );
}

type Conflict = { cell: string; base: number; actual: number; value: string } | null;

function LabGrid({ roomId, me }: { roomId: string; me: Actor }): React.ReactElement {
  const store = useStore();
  const sheet = store.listArtifacts(roomId).find((a) => a.kind === "sheet");
  const artId = sheet ? sheet.id : "";
  const seeded = React.useRef(false);
  const [conflict, setConflict] = React.useState<Conflict>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  const art = store.getArtifact(artId);
  const ver = (eid: string): number => art?.elements[eid]?.version ?? 0;
  const val = (eid: string): string => {
    const v = art?.elements[eid]?.value;
    return v === null || v === undefined ? "" : String(v);
  };

  const commit = React.useCallback(
    async (eid: string, value: string, baseVersion: number, actor: Actor) =>
      store.applyEdit({
        roomId,
        op: { opId: rid(), artifactId: artId, elementId: eid, kind: "set", value, baseVersion },
        actor,
      }),
    [store, roomId, artId],
  );

  // Seed Budget + Actual columns once so the grid reads like a real model.
  React.useEffect(() => {
    if (seeded.current || !artId) return;
    seeded.current = true;
    void (async () => {
      for (const r of ROWS) {
        await commit(r.id + "__A", r.budget, ver(r.id + "__A"), me);
        await commit(r.id + "__B", r.actual, ver(r.id + "__B"), me);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artId]);

  const pulse = (eid: string): void => {
    setFlash(eid);
    window.setTimeout(() => setFlash((f) => (f === eid ? null : f)), 700);
  };

  // Layer 1 — your edit paints instantly + bumps the version (optimistic commit).
  const onEdit = async (eid: string, value: string): Promise<void> => {
    setDraft((d) => ({ ...d, [eid]: value }));
    const r = await commit(eid, value, ver(eid), me);
    if (r.ok) pulse(eid);
  };

  // Layer 5 — the no-clobber test: stage at vN, agent lands first (→ vN+1),
  // your stale commit is rejected and returned as conflict-as-data.
  const runNoClobber = async (): Promise<void> => {
    setConflict(null);
    const base = ver(TEST_CELL); // you read version N
    await commit(TEST_CELL, "2,400", base, AGENT); // teammate lands first → N+1
    pulse(TEST_CELL);
    const r = await commit(TEST_CELL, "9,999", base, me); // you commit on stale N
    if (!r.ok) {
      setConflict({ cell: "Revenue · Variance", base, actual: ver(TEST_CELL), value: "9,999" });
    }
  };

  const reset = async (): Promise<void> => {
    setConflict(null);
    setDraft({});
    await commit(TEST_CELL, "", ver(TEST_CELL), me);
  };

  const cell = (eid: string, editable: boolean): React.ReactElement => {
    const live = draft[eid] !== undefined ? draft[eid] : val(eid);
    return editable ? (
      <input
        className={"sl-cell sl-edit" + (flash === eid ? " sl-flash" : "")}
        value={live}
        inputMode="decimal"
        aria-label={"Variance " + eid}
        onChange={(e) => void onEdit(eid, e.target.value)}
        placeholder="—"
      />
    ) : (
      <span className={"sl-cell" + (flash === eid ? " sl-flash" : "")}>{val(eid) || "—"}</span>
    );
  };

  return (
    <div className="sl-wrap" data-testid="story-lab">
      <style>{LAB_STYLE}</style>
      <div className="sl-head">
        <span className="sl-kicker">Try it live</span>
        <h3 className="sl-title">A real grid on the in-browser engine — no keys, no network.</h3>
        <p className="sl-sub">
          Type a variance to see <b>Layer 1</b> (optimistic commit), then run the <b>Layer 5</b> no-clobber
          test — every edit below calls the same compare-and-swap path as the live room.
        </p>
      </div>

      <div className="sl-gridcard">
        <div className="sl-grid" role="table">
          <div className="sl-grow sl-ghead" role="row">
            <span className="sl-cell sl-rh" />
            <span className="sl-cell sl-colh">Budget</span>
            <span className="sl-cell sl-colh">Actual</span>
            <span className="sl-cell sl-colh">Variance</span>
          </div>
          {ROWS.map((r) => (
            <div className="sl-grow" role="row" key={r.id}>
              <span className="sl-cell sl-rh">{r.label}</span>
              {cell(r.id + "__A", false)}
              {cell(r.id + "__B", false)}
              {cell(r.id + "__C", true)}
            </div>
          ))}
        </div>

        <div className="sl-actions">
          <button className="sl-btn primary" onClick={() => void runNoClobber()}>
            ▶ Run the no-clobber test
          </button>
          <button className="sl-btn" onClick={() => void reset()}>
            Reset cell
          </button>
          <span className="sl-hint">…or just type in any Variance cell.</span>
        </div>

        {conflict ? (
          <div className="sl-conflict" role="status">
            <div className="sl-conflict-h">
              <span className="sl-conflict-dot" /> Conflict — returned as data, not a clobber
            </div>
            <p className="sl-conflict-b">
              You staged <code>{conflict.value}</code> on <b>{conflict.cell}</b> at version{" "}
              <code>v{conflict.base}</code>. NodeAgent committed <code>2,400</code> first, advancing it to{" "}
              <code>v{conflict.actual}</code>. Your stale-baseline write was <b>rejected</b> — the engine
              returned <code>{"{ ok:false, reason:'conflict' }"}</code> instead of overwriting. That rejection
              is Layer 5; the reviewable rebase that follows is Layer 6.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
