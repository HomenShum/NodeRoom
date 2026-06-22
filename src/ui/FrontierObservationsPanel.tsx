import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { HAS_CONVEX } from "../app/store";

/**
 * FrontierObservationsPanel — read-only view of the model-frontier observation
 * lane (the 8 model-capability ceilings that DO NOT count toward any
 * clean-probe headline). Standalone hash route #frontier.
 *
 * Honest-lane guarantees preserved:
 *   1) never invent rows the snapshot did not return (no client-side reward
 *      synthesis or row fabrication),
 *   2) show cleanGeneralProbe=false visibly so users SEE these are
 *      side-channel observations, not headline credit,
 *   3) loading (undefined) vs missing room (null) vs throw all render
 *      distinct branches.
 *
 * Server contract: publicLedgerSnapshot accepts roomCode +
 * selectedEvalRunId; it does NOT accept selectedKind. The frontier lane is
 * discriminated by `benchmark: "model-frontier"` on the evalRun row, so we
 * client-side pick the most recent frontier run from the returned runs[]
 * and pass its id back as selectedEvalRunId (server then loads its tasks).
 */

type LedgerRun = {
  id: Id<"evalRuns">;
  iterationLabel: string;
  benchmark: string;
  model?: string;
  materializerMode: string;
  status: "running" | "completed" | "failed";
  taskCount: number;
  headlineCleanProbeMean?: number;
  headlineN?: number;
  startedAt: number;
  completedAt?: number;
  notes?: string;
};

type LedgerTask = {
  id: Id<"taskResults">;
  taskId: string;
  family?: string;
  reward: number;
  raw?: string;
  exceptions: number;
  firedWriter: string;
  cleanGeneralProbe: boolean;
  modelCalls: number;
  plannerTransport?: string;
  countsTowardHeadline: boolean;
  trialId?: string;
  verdict?: string;
  createdAt: number;
};

const CAPTION =
  "These are documented model-capability ceilings from honest-loop measurement (R1-R6 of the claim-2 close). They do NOT count toward any clean-probe headline.";

const SUPPORTED_ROOM_CODES = new Set(["BTBLEDGER", "BTB-EVAL-LEDGER"]);

function parseSearchParams(): { roomCode: string; runIdParam: string | null } {
  if (typeof window === "undefined") return { roomCode: "BTB-EVAL-LEDGER", runIdParam: null };
  try {
    const url = new URL(window.location.href);
    const rawRoom = (url.searchParams.get("room") ?? "").trim().toUpperCase();
    const roomCode = SUPPORTED_ROOM_CODES.has(rawRoom) ? rawRoom : "BTB-EVAL-LEDGER";
    const runIdParam = url.searchParams.get("run");
    return { roomCode, runIdParam };
  } catch {
    return { roomCode: "BTB-EVAL-LEDGER", runIdParam: null };
  }
}

function formatReward(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  // 4 dp is the honest precision we publish in the ledger; trailing zeros
  // trimmed so 1 reads as "1" not "1.0000".
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatStartedAt(value?: number): string {
  if (!value) return "unknown";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convex's useQuery throws during render when the server query throws
 * (unsupported room code, cross-room run id, transport error). A try/catch
 * around the hook does not catch render-time throws — that requires an
 * Error Boundary. This local boundary keeps the #frontier route from
 * white-screening on a malformed ?run= URL.
 */
class FrontierErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <main
          className="frontier-observations frontier-observations--error"
          data-testid="frontier-observations-panel"
          data-row-count={0}
          aria-label="Model-frontier observations (error)"
        >
          <header className="frontier-observations__header">
            <h1>Model-frontier observations</h1>
          </header>
          <p className="frontier-observations__caption">{CAPTION}</p>
          <p className="frontier-observations__error" role="alert">
            Could not load the frontier ledger: {this.state.error.message}
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}

export function FrontierObservationsPanel() {
  // Memory-mode short-circuit: no Convex client mounted, so useQuery would
  // crash. Match BtbLiveLedgerPanel's null branch (graceful fallback).
  if (!HAS_CONVEX) {
    return (
      <main
        className="frontier-observations frontier-observations--stub"
        data-testid="frontier-observations-panel"
        data-row-count={0}
        aria-label="Model-frontier observations (offline)"
      >
        <header className="frontier-observations__header">
          <h1>Model-frontier observations</h1>
        </header>
        <p className="frontier-observations__caption">{CAPTION}</p>
        <p className="frontier-observations__empty">
          Convex backend is not configured in this build (memory mode). The frontier ledger is
          only available against the live Convex deployment.
        </p>
      </main>
    );
  }
  return (
    <FrontierErrorBoundary>
      <FrontierObservationsConvexPanel />
    </FrontierErrorBoundary>
  );
}

function FrontierObservationsConvexPanel() {
  const initial = useMemo(() => parseSearchParams(), []);
  const [roomCode] = useState<string>(initial.roomCode);
  // We do NOT trust the ?run= param blindly — selectedEvalRunId in the
  // server query falls through to ctx.db.get() outside the recent-N slice
  // and can trip the cross-room guard. Stage the raw param, validate it
  // against snapshot.runs[] below, then promote into selectedRunId.
  const [selectedRunId, setSelectedRunId] = useState<Id<"evalRuns"> | undefined>(undefined);
  const [pendingRunParam, setPendingRunParam] = useState<string | null>(initial.runIdParam);

  // publicLedgerSnapshot THROWS (not returns null) for unsupported room
  // codes or cross-room run ids — caught above by FrontierErrorBoundary.
  const snapshot = useQuery(api.evalRuns.publicLedgerSnapshot, {
    roomCode,
    selectedEvalRunId: selectedRunId,
    runLimit: 25,
    taskLimit: 250,
  });

  // Promote ?run= once we can validate it lives in the returned runs[].
  // Otherwise drop it silently (a stale shared link is not a crash).
  useEffect(() => {
    if (!pendingRunParam || !snapshot || !snapshot.runs) return;
    const found = snapshot.runs.find((r) => String(r.id) === pendingRunParam);
    if (found) setSelectedRunId(found.id);
    setPendingRunParam(null);
  }, [pendingRunParam, snapshot]);

  // If neither ?run= nor user selection has resolved, prefer the model-
  // frontier run with the MOST tasks (tiebreak: most recent startedAt).
  // The server's default heuristic (first run with taskCount >= 100) picks
  // BTB sweeps, not frontier observations — frontier runs only have 6-8
  // rows. Why max-taskCount and not most-recent: smoke probes and stray
  // 1-row test writes land at the top of the recent-by-time list and shove
  // the canonical 8-row run off the headline. The invariant "the canonical
  // headline is the frontier run with the most tasks" is durable against
  // future smoke probes, dev test rows, and accidental 1-row writes.
  // See decision.smokeFix=heuristic-prefer-highest-taskCount (Jun 2026
  // R13/R14 ledger ingest postmortem: aromatic-bass-102 vs
  // zealous-goshawk-766 + the 1-row R14 smoke probe).
  useEffect(() => {
    if (selectedRunId || pendingRunParam || !snapshot || !snapshot.runs) return;
    const frontierRuns = snapshot.runs.filter((r) => r.benchmark === "model-frontier");
    if (frontierRuns.length === 0) return;
    const frontier = frontierRuns.reduce((best, r) => {
      if (r.taskCount > best.taskCount) return r;
      if (r.taskCount === best.taskCount && r.startedAt > best.startedAt) return r;
      return best;
    }, frontierRuns[0]);
    if (frontier && (!snapshot.selectedRun || snapshot.selectedRun.id !== frontier.id)) {
      setSelectedRunId(frontier.id);
    }
  }, [snapshot, selectedRunId, pendingRunParam]);

  // ----- distinct render branches -----

  // (a) thrown — handled by FrontierErrorBoundary above (unsupported room
  // code, cross-room run id, or transport error).

  // (b) loading — useQuery returns undefined while in flight.
  if (snapshot === undefined) {
    return (
      <main
        className="frontier-observations frontier-observations--loading"
        data-testid="frontier-observations-panel"
        data-row-count={0}
        aria-label="Model-frontier observations (loading)"
      >
        <header className="frontier-observations__header">
          <h1>Model-frontier observations</h1>
        </header>
        <p className="frontier-observations__caption">{CAPTION}</p>
        <p className="frontier-observations__empty">Loading live Convex ledger…</p>
      </main>
    );
  }

  // (c) missing room — query returned null (BTB-EVAL-LEDGER not in db).
  if (snapshot === null) {
    return (
      <main
        className="frontier-observations frontier-observations--missing"
        data-testid="frontier-observations-panel"
        data-row-count={0}
        aria-label="Model-frontier observations (missing)"
      >
        <header className="frontier-observations__header">
          <h1>Model-frontier observations</h1>
        </header>
        <p className="frontier-observations__caption">{CAPTION}</p>
        <p className="frontier-observations__empty">
          The {roomCode} room was not found in Convex. The frontier ingest has not run on this
          deployment yet.
        </p>
      </main>
    );
  }

  const runs = (snapshot.runs ?? []) as LedgerRun[];
  const frontierRuns = runs.filter((r) => r.benchmark === "model-frontier");
  const selectedRun = (snapshot.selectedRun ?? null) as LedgerRun | null;
  const isFrontierSelected = selectedRun?.benchmark === "model-frontier";
  // Only show tasks when the SELECTED run is a frontier run. If the server
  // fell back to a sweep run, surface zero rows + a hint rather than mixing
  // sweep tasks into the frontier table.
  const tasks = (isFrontierSelected ? (snapshot.tasks ?? []) : []) as LedgerTask[];

  return (
    <main
      className="frontier-observations"
      data-testid="frontier-observations-panel"
      data-row-count={tasks.length}
      aria-label="Model-frontier observations"
    >
      <header className="frontier-observations__header">
        <h1>Model-frontier observations</h1>
        <div className="frontier-observations__meta">
          <span>Room: <code>{snapshot.room.code}</code></span>
          {selectedRun ? (
            <>
              <span>Run: <code title={selectedRun.iterationLabel}>{selectedRun.iterationLabel}</code></span>
              <span>Started: {formatStartedAt(selectedRun.startedAt)}</span>
              <span>Rows: {tasks.length}</span>
            </>
          ) : null}
        </div>
      </header>

      <p className="frontier-observations__caption">{CAPTION}</p>

      {frontierRuns.length > 1 ? (
        <nav
          className="frontier-observations__runs"
          aria-label="Frontier runs"
          data-testid="frontier-observations-runs"
        >
          {frontierRuns.map((run) => {
            const active = selectedRun?.id === run.id;
            return (
              <button
                key={run.id}
                type="button"
                className={
                  active
                    ? "frontier-observations__run frontier-observations__run--active"
                    : "frontier-observations__run"
                }
                onClick={() => setSelectedRunId(run.id)}
                data-run-id={run.id}
                aria-pressed={active}
              >
                <span title={run.iterationLabel}>{run.iterationLabel}</span>
                <small>{run.taskCount} obs · {formatStartedAt(run.startedAt)}</small>
              </button>
            );
          })}
        </nav>
      ) : null}

      {!isFrontierSelected && frontierRuns.length === 0 ? (
        <p className="frontier-observations__empty">
          No model-frontier runs found in {snapshot.room.code}. Ingest observations via
          <code> npx convex run modelFrontier:recordObservations</code> to populate this view.
        </p>
      ) : null}

      {!isFrontierSelected && frontierRuns.length > 0 ? (
        <p className="frontier-observations__empty">
          Selected run <code>{selectedRun?.iterationLabel}</code> is not a frontier run. Pick a
          frontier iteration above.
        </p>
      ) : null}

      {tasks.length === 0 && isFrontierSelected ? (
        <p
          className="frontier-observations__empty"
          data-testid="frontier-observations-empty"
        >
          No frontier observations recorded under <code>{selectedRun?.iterationLabel}</code>.
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <table
          className="frontier-observations__table"
          role="table"
          aria-label="Frontier observation rows"
        >
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Task</th>
              <th scope="col">Reward</th>
              <th scope="col" title="cleanGeneralProbe — false for frontier observations by design">Clean?</th>
              <th scope="col">Family</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              // Per modelFrontier ingest, trialId stashes the per-row model id
              // losslessly. Fall back to the run-level model only if every
              // observation agreed (see modelFrontier.ts).
              const model = task.trialId ?? selectedRun?.model ?? "unknown";
              return (
                <tr
                  key={task.id}
                  data-task-id={task.taskId}
                  data-clean={task.cleanGeneralProbe ? "true" : "false"}
                  data-counts-toward-headline={task.countsTowardHeadline ? "true" : "false"}
                >
                  <td>{model}</td>
                  <td>
                    <code>{task.taskId}</code>
                    {task.verdict ? <small className="frontier-observations__verdict"> {task.verdict}</small> : null}
                  </td>
                  <td>{formatReward(task.reward)}</td>
                  <td className={task.cleanGeneralProbe ? "is-clean" : "is-observation"}>
                    {task.cleanGeneralProbe ? "yes" : "no — observation"}
                  </td>
                  <td>{task.family ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
