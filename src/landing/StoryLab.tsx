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
import { engine, createFreshRoom } from "../app/roomStore";
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
/* ── additive: panels for L4/L7, L6, and the L2/L3 + mobile honesty notes ── */
.sl-panel{margin-top:16px;border:1px solid var(--border-color,rgba(0,0,0,.1));border-radius:14px;background:var(--bg-secondary,#fff);box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px -12px rgba(0,0,0,.1);padding:16px;}
.sl-ptag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-primary,#d97757);}
.sl-ph{margin:5px 0 3px;font-size:15.5px;font-weight:700;letter-spacing:-.01em;color:var(--text-primary,#1a1714);}
.sl-pp{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--text-secondary,#5c5650);max-width:62ch;}
.sl-steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:7px;}
.sl-step{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;line-height:1.5;color:var(--text-secondary,#5c5650);}
.sl-step.pend{opacity:.45;}
.sl-step.fail b,.sl-step.fail{color:var(--na-bad,#8b2812);}
.sl-step.pass b,.sl-step.pass{color:var(--na-good,#2f6b44);}
.sl-step-ix{flex:none;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;background:var(--bg-tertiary,#f3efe9);color:var(--text-tertiary,#928a80);border:1px solid var(--border-color,rgba(0,0,0,.1));}
.sl-step.pass .sl-step-ix{background:var(--na-good-bg,#e3f0e8);color:var(--na-good,#2f6b44);border-color:var(--na-good,#2f6b44);}
.sl-step.fail .sl-step-ix{background:var(--na-bad-bg,#fbe8e0);color:var(--na-bad,#c0492f);border-color:var(--na-bad,#c0492f);}
.sl-step code{font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;}
.sl-lease{display:inline-flex;align-items:center;gap:6px;margin-top:11px;padding:5px 9px;border-radius:8px;background:var(--accent-primary-bg,#fbede3);border:1px solid var(--accent-primary,#d97757);font-size:11.5px;font-weight:600;color:var(--accent-primary-hover,#9c4f25);font-variant-numeric:tabular-nums;}
.sl-lease-dot{width:7px;height:7px;border-radius:50%;background:var(--accent-primary,#d97757);}
.sl-chip{margin-top:13px;border:1px solid var(--na-warn,#9a6a12);border-left-width:3px;border-radius:10px;background:var(--na-warn-bg,#fdf3df);padding:11px 13px;}
.sl-chip-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--na-warn,#7a5310);}
.sl-chip-dot{width:8px;height:8px;border-radius:50%;background:var(--na-warn,#c08a1e);flex:none;}
.sl-chip-b{margin:6px 0 10px;font-size:12px;line-height:1.5;color:var(--text-secondary,#5c5650);}
.sl-chip-b code{font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;}
.sl-note{margin-top:16px;border:1px dashed var(--border-strong,rgba(0,0,0,.18));border-radius:12px;background:var(--bg-tertiary,#f6f2ec);padding:14px;}
.sl-note-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--text-secondary,#5c5650);}
.sl-note-pill{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-tertiary,#928a80);border:1px solid var(--border-color,rgba(0,0,0,.14));border-radius:999px;padding:2px 7px;}
.sl-note-b{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--text-secondary,#5c5650);max-width:62ch;}
.sl-note-b code{font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;background:rgba(0,0,0,.07);padding:1px 5px;border-radius:4px;}
.sl-evi{margin-top:12px;border:1px solid var(--na-good,#2f6b44);border-left-width:3px;border-radius:10px;background:var(--na-good-bg,#e7f1ea);padding:11px 13px;}
.sl-evi-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--na-good,#27543a);}
.sl-evi-dot{width:8px;height:8px;border-radius:50%;background:var(--na-good,#2f6b44);flex:none;}
.sl-evi-grid{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:8px;font-size:11.5px;line-height:1.45;}
.sl-evi-k{color:var(--text-tertiary,#928a80);font-weight:600;}
.sl-evi-v{color:var(--text-primary,#1a1714);font-variant-numeric:tabular-nums;}
.sl-evi-v code{font-family:var(--font-mono,ui-monospace,monospace);font-size:10.5px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;}
`;

export function StoryLab(): React.ReactElement {
  // A dedicated fresh engine room so the playground never mutates the demo room.
  const lab = React.useMemo(() => createFreshRoom("Seven-layer playground", "You"), []);
  return (
    <EngineStoreProvider roomId={lab.roomId} me={lab.me}>
      <LabGrid roomId={lab.roomId} me={lab.me} />
      <LeasePanel roomId={lab.roomId} me={lab.me} />
      <RebasePanel />
      <NotInMemoryNotes />
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

/* ════════════════════════════════════════════════════════════════════════
   Layer 4 + Layer 7 — ONE drill (L7 IS the lock half of the L4 flow).
   proposeLock (lease + TTL) → blocked actor drafts AROUND it → releaseLock
   auto-smart-merges. Drives the SAME engine the grid uses; the L4/L7 methods
   are NOT on the useStore() facade, so we call the exported singleton `engine`
   directly (roomStore.ts) — the proven sequence from demoRoom.ts playCollab.
   ════════════════════════════════════════════════════════════════════════ */
type Step = { state: "pending" | "pass" | "fail"; label: React.ReactNode };
const LEASE_CELL = "r5__C"; // OpEx · Variance — distinct from L5's r2__C so the drills never collide.

function LeasePanel({ roomId, me }: { roomId: string; me: Actor }): React.ReactElement {
  const store = useStore();
  const sheet = store.listArtifacts(roomId).find((a) => a.kind === "sheet");
  const artId = sheet ? sheet.id : "";
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [leaseMs, setLeaseMs] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);

  const verOf = (eid: string): number => engine.getArtifact(artId)?.elements[eid]?.version ?? 0;

  const run = (): void => {
    if (!artId) return;
    const host = me; // the StoryLab user holds the lease
    const acc: Step[] = [];

    // L7 — acquire a short commit lease on the affected range (carries a TTL).
    const lr = engine.proposeLock({
      roomId,
      artifactId: artId,
      elementIds: [LEASE_CELL],
      holder: host,
      sessionId: "storylab-lease",
      reason: "host reviewing OpEx variance",
    });
    if (!lr.ok) {
      setSteps([{ state: "fail", label: "Lease was denied (cell already held)." }]);
      return;
    }
    const ttlMs = lr.lock.expiresAt !== undefined ? lr.lock.expiresAt - lr.lock.createdAt : null;
    setLeaseMs(ttlMs);
    acc.push({
      state: "pass",
      label: (
        <>
          <b>L7 lease acquired</b> on <code>OpEx · Variance</code> — <code>{lr.lock.id}</code>, TTL{" "}
          <code>{ttlMs !== null ? Math.round(ttlMs / 1000) + "s" : "—"}</code> (auto-expires if the holder crashes).
        </>
      ),
    });

    // L7 — prove the lease blocks others: the agent's direct write is rejected as data.
    const base = verOf(LEASE_CELL);
    const blocked = engine.applyEdit({
      roomId,
      op: { opId: rid(), artifactId: artId, elementId: LEASE_CELL, kind: "set", value: "BLOCKED", baseVersion: base },
      actor: AGENT,
    });
    if (!blocked.ok && blocked.reason === "locked") {
      acc.push({
        state: "pass",
        label: (
          <>
            <b>NodeAgent's write blocked</b> — engine returned{" "}
            <code>{"{ ok:false, reason:'locked' }"}</code> with <code>by={blocked.by.name}</code>,{" "}
            <code>{"lockId=" + blocked.lockId}</code>. No clobber of the leased cell.
          </>
        ),
      });
    } else {
      acc.push({ state: "fail", label: "Expected the lease to block the agent, but the write went through." });
    }

    // L4 — the blocked agent drafts AROUND the lock (reads it as context, proposes ops to land on release).
    const draft = engine.createDraft({
      roomId,
      artifactId: artId,
      author: AGENT,
      blockedByLockId: lr.lock.id,
      note: "OpEx variance recompute (drafted around the host's lease)",
      ops: [{ opId: rid(), artifactId: artId, elementId: LEASE_CELL, kind: "set", value: "+20.5%", baseVersion: base }],
    });
    acc.push({
      state: "pass",
      label: (
        <>
          <b>L4 draft staged around the lock</b> — <code>{draft.id}</code> ({draft.ops.length} op), pending until the
          lease lifts. The agent never blocks on the human.
        </>
      ),
    });

    // L4 — release the lease → engine smart-merges every draft waiting on it.
    const released = engine.releaseLock(lr.lock.id, host);
    const outcome = released.merged.find((m) => m.draftId === draft.id);
    const verdict = outcome?.resolution.verdict ?? "clean";
    acc.push({
      state: "pass",
      label: (
        <>
          <b>Lease released → smart-merge ran</b> — verdict <code>{verdict}</code>,{" "}
          {outcome ? outcome.resolution.applied.length : 0} op applied cleanly onto canonical state. OpEx · Variance is
          now <code>{String(engine.getArtifact(artId)?.elements[LEASE_CELL]?.value ?? "")}</code> at{" "}
          <code>v{verOf(LEASE_CELL)}</code>.
        </>
      ),
    });

    setSteps(acc);
    setDone(true);
  };

  const reset = (): void => {
    setSteps([]);
    setLeaseMs(null);
    setDone(false);
  };

  return (
    <div className="sl-panel" data-testid="story-lab-lease">
      <span className="sl-ptag">Try it live — Layers 4 + 7</span>
      <h3 className="sl-ph">Draft-around-lock, then smart-merge on release.</h3>
      <p className="sl-pp">
        L7 is the lock half of the L4 flow. You take a <b>short commit lease</b> on one cell (with a TTL so a crashed
        holder never blocks it forever). NodeAgent can't clobber it — so it <b>drafts around the lock</b> and the engine
        <b> smart-merges</b> the draft the moment you release. Same engine calls as the live room.
      </p>
      <div className="sl-actions">
        <button className="sl-btn primary" onClick={run} disabled={done} data-testid="story-lab-lease-run">
          ▶ Run the lease + draft-around-lock drill
        </button>
        <button className="sl-btn" onClick={reset}>
          Reset
        </button>
      </div>
      {leaseMs !== null ? (
        <div className="sl-lease" data-testid="story-lab-lease-ttl">
          <span className="sl-lease-dot" /> Lease TTL {Math.round(leaseMs / 1000)}s — affected range:{" "}
          OpEx · Variance
        </div>
      ) : null}
      {steps.length ? (
        <ol className="sl-steps" data-testid="story-lab-lease-steps" role="status">
          {steps.map((s, i) => (
            <li className={"sl-step " + s.state} key={i}>
              <span className="sl-step-ix">{s.state === "pass" ? "✓" : s.state === "fail" ? "✕" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Layer 6 — semantic rebase → reviewable proposal.
   In a SEPARATE review-mode room (autoAllow:false), a stale agent draft is
   merged after a human lands a different value first → the deterministic
   resolver flags value_diverged → mergeDraft opens a review:{ kind:
   "semantic_rebase" } proposal. Approving it re-applies at the CURRENT version.
   Kept in its own room so it never touches the L1/L5 grid above.
   ════════════════════════════════════════════════════════════════════════ */
const REVIEW_CELL = "r1__C";

function makeReviewRoom(): { roomId: string; artId: string; host: Actor } {
  const { room, host } = engine.createRoom({ title: "Semantic-rebase review", hostName: "You", autoAllow: false });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let r = 1; r <= 4; r++) for (const c of ["A", "B", "C"]) seed.push({ id: `r${r}__${c}`, value: "" });
  const art = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Review sheet", by: me, seed });
  return { roomId: room.id, artId: art.id, host: me };
}

function RebasePanel(): React.ReactElement {
  const ctx = React.useMemo(makeReviewRoom, []);
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [proposalId, setProposalId] = React.useState<string | null>(null);
  const [approved, setApproved] = React.useState(false);

  const verOf = (): number => engine.getArtifact(ctx.artId)?.elements[REVIEW_CELL]?.version ?? 0;
  const valOf = (): string => String(engine.getArtifact(ctx.artId)?.elements[REVIEW_CELL]?.value ?? "");

  const run = (): void => {
    const acc: Step[] = [];
    const base = verOf();

    // 1. Stage a DRAFT from the public agent at the OLD baseline (the stale write).
    const draft = engine.createDraft({
      roomId: ctx.roomId,
      artifactId: ctx.artId,
      author: AGENT,
      note: "stale agent rebase",
      ops: [{ opId: rid(), artifactId: ctx.artId, elementId: REVIEW_CELL, kind: "set", value: "AGENT-proposed", baseVersion: base }],
    });
    acc.push({
      state: "pass",
      label: (
        <>
          <b>Agent drafted</b> <code>AGENT-proposed</code> at <code>v{base}</code> (draft <code>{draft.id}</code>).
        </>
      ),
    });

    // 2. A human lands a DIFFERENT value first → the draft is now stale (cell → base+1).
    engine.applyEdit({
      roomId: ctx.roomId,
      op: { opId: rid(), artifactId: ctx.artId, elementId: REVIEW_CELL, kind: "set", value: "HUMAN-wins", baseVersion: base },
      actor: ctx.host,
    });
    acc.push({
      state: "pass",
      label: (
        <>
          <b>Human committed first</b> — cell is now <code>HUMAN-wins</code> at <code>v{verOf()}</code>. The agent's
          draft baseline is stale.
        </>
      ),
    });

    // 3. Merge the draft → resolver flags value_diverged → semantic_rebase review proposal.
    const outcome = engine.mergeDraft(draft.id);
    const pid = outcome.semantic?.proposalIds[0];
    const prop = pid ? engine.listProposals(ctx.roomId).find((p) => p.id === pid) : undefined;
    if (prop && prop.review?.kind === "semantic_rebase") {
      setProposalId(prop.id);
      acc.push({
        state: "pass",
        label: (
          <>
            <b>Smart-merge → review proposal</b> — verdict <code>{outcome.resolution.verdict}</code>; engine opened{" "}
            <code>review.kind = "semantic_rebase"</code> (<code>status={prop.review.status}</code>) instead of
            overwriting the human. No clobber, no silent merge.
          </>
        ),
      });
    } else {
      acc.push({ state: "fail", label: "Expected a semantic_rebase review proposal, but none was created." });
    }

    setSteps(acc);
  };

  const approve = (): void => {
    if (!proposalId) return;
    const r = engine.resolveProposal(proposalId, true, ctx.host);
    if (r && r.ok) {
      setApproved(true);
      setProposalId(null);
    }
  };

  const reset = (): void => {
    setSteps([]);
    setProposalId(null);
    setApproved(false);
    // Restore the cell so the drill can be run again cleanly.
    engine.applyEdit({
      roomId: ctx.roomId,
      op: { opId: rid(), artifactId: ctx.artId, elementId: REVIEW_CELL, kind: "set", value: "", baseVersion: verOf() },
      actor: ctx.host,
    });
  };

  return (
    <div className="sl-panel" data-testid="story-lab-rebase">
      <span className="sl-ptag">Try it live — Layer 6</span>
      <h3 className="sl-ph">A stale agent write becomes reviewable judgment.</h3>
      <p className="sl-pp">
        Runs in a separate <b>review-mode room</b> (<code>autoAllow:false</code>). An agent drafts a value, a human
        lands a different one first, and the merge flags the divergence — so the engine opens a{" "}
        <code>semantic_rebase</code> <b>review proposal</b> instead of clobbering. You approve it, and it re-applies at
        the current version.
      </p>
      <div className="sl-actions">
        <button className="sl-btn primary" onClick={run} disabled={steps.length > 0} data-testid="story-lab-rebase-run">
          ▶ Run the stale-write → review drill
        </button>
        <button className="sl-btn" onClick={reset}>
          Reset
        </button>
      </div>
      {steps.length ? (
        <ol className="sl-steps" data-testid="story-lab-rebase-steps" role="status">
          {steps.map((s, i) => (
            <li className={"sl-step " + s.state} key={i}>
              <span className="sl-step-ix">{s.state === "pass" ? "✓" : s.state === "fail" ? "✕" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {proposalId ? (
        <div className="sl-chip" data-testid="story-lab-rebase-proposal" role="status">
          <div className="sl-chip-h">
            <span className="sl-chip-dot" /> Review proposal — semantic_rebase · needs review
          </div>
          <p className="sl-chip-b">
            NodeAgent's <code>AGENT-proposed</code> diverged from the human's <code>HUMAN-wins</code>. Approving
            re-applies it onto the <b>current</b> version (a fresh CAS write), not the stale baseline.
          </p>
          <button className="sl-btn primary" onClick={approve} data-testid="story-lab-rebase-approve">
            ✓ Approve proposal
          </button>
        </div>
      ) : null}
      {approved ? (
        <div className="sl-evi" data-testid="story-lab-rebase-approved" role="status">
          <div className="sl-evi-h">
            <span className="sl-evi-dot" /> Approved — re-applied at the current version
          </div>
          <div className="sl-evi-grid">
            <span className="sl-evi-k">Cell now</span>
            <span className="sl-evi-v">
              <code>{valOf()}</code>
            </span>
            <span className="sl-evi-k">Version</span>
            <span className="sl-evi-v">
              <code>v{verOf()}</code>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Layers 2 & 3 + mobile evidence — honest "live in the room" notes.
   These four StoreApi members (privateStreamAccess / listPresence /
   updatePresence / askPrivateAgent) are intentionally INERT in the in-browser
   memory engine (store.tsx: null / [] / no-op) — there is nothing to drive
   here. They run for real only on the Convex-backed room (presence.ts,
   streaming.ts). So we render an honest note, not a scripted fake.
   ════════════════════════════════════════════════════════════════════════ */
function NotInMemoryNotes(): React.ReactElement {
  return (
    <div className="sl-wrap" data-testid="story-lab-notes" style={{ marginTop: 0 }}>
      <div className="sl-note" data-testid="story-lab-l2l3">
        <div className="sl-note-h">
          Layers 2 &amp; 3 — presence + persistent streaming
          <span className="sl-note-pill">live in the room · not in memory</span>
        </div>
        <p className="sl-note-b">
          Ephemeral <b>presence</b> (L2) and the persistent <b>private reply stream</b> (L3) run on the Convex backend,
          not the keyless in-browser engine. In memory mode the adapter is deliberately inert (
          <code>listPresence → []</code>, <code>privateStreamAccess → null</code>,{" "}
          <code>askPrivateAgent → no-op</code>), so there is nothing to drive here — faking it would be dishonest. Both
          are real and interactable inside a live room (server twins: <code>convex/presence.ts</code>,{" "}
          <code>convex/streaming.ts</code>).
        </p>
      </div>

      <div className="sl-evi" data-testid="story-lab-mobile-evidence">
        <div className="sl-evi-h">
          <span className="sl-evi-dot" /> Mobile wedge — the no-clobber drill ships on mobile too
        </div>
        <div className="sl-evi-grid">
          <span className="sl-evi-k">Surface</span>
          <span className="sl-evi-v">NodeAgent Mobile (Terracotta) — Inbox / review</span>
          <span className="sl-evi-k">Route</span>
          <span className="sl-evi-v">
            <code>#mobile?demo=review</code>
          </span>
          <span className="sl-evi-k">Mechanic</span>
          <span className="sl-evi-v">real agent proposals, host-gated approve/reject (no auto-merge)</span>
          <span className="sl-evi-k">Room mode</span>
          <span className="sl-evi-v">
            Convex review room (<code>autoAllow:false</code>)
          </span>
          <span className="sl-evi-k">Verified</span>
          <span className="sl-evi-v">2026-06-21 · live-DOM</span>
        </div>
      </div>
    </div>
  );
}
