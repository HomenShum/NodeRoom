import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Activity, CheckCircle2, Database, ListChecks, RefreshCw, XCircle } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type LedgerRun = {
  id: Id<"evalRuns">;
  iterationLabel: string;
  model?: string;
  materializerMode: string;
  status: "running" | "completed" | "failed";
  taskCount: number;
  headlineCleanProbeMean?: number;
  headlineN?: number;
  startedAt: number;
  completedAt?: number;
};

type LedgerTask = {
  id: Id<"taskResults">;
  taskId: string;
  reward: number;
  raw?: string;
  exceptions: number;
  firedWriter: string;
  modelCalls: number;
  plannerTransport?: string;
  countsTowardHeadline: boolean;
  verdict?: string;
};

function formatReward(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "n/a";
}

function formatDate(value?: number): string {
  if (!value) return "not completed";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function BtbLiveLedgerPanel() {
  const [selectedRunId, setSelectedRunId] = useState<Id<"evalRuns"> | undefined>(undefined);
  const snapshot = useQuery(api.evalRuns.publicLedgerSnapshot, {
    roomCode: "BTBLEDGER",
    selectedEvalRunId: selectedRunId,
    runLimit: 12,
    taskLimit: 120,
  });

  const runs = (snapshot?.runs ?? []) as LedgerRun[];
  const selectedRun = (snapshot?.selectedRun ?? null) as LedgerRun | null;
  const tasks = (snapshot?.tasks ?? []) as LedgerTask[];
  const fullRun = useMemo(() => runs.find((run) => run.taskCount >= 100), [runs]);
  const cleanRows = snapshot?.totals.cleanHeadlineRows ?? 0;
  const rejectedRows = Math.max(0, tasks.length - cleanRows);

  if (snapshot === undefined) {
    return (
      <aside className="btb-live-ledger" aria-label="BankerToolBench live ledger">
        <div className="btb-live-ledger__status"><RefreshCw size={14} /> Loading live BTB ledger...</div>
      </aside>
    );
  }

  if (snapshot === null) {
    return (
      <aside className="btb-live-ledger" aria-label="BankerToolBench live ledger">
        <div className="btb-live-ledger__status"><Database size={14} /> BTBLEDGER room not found in Convex.</div>
      </aside>
    );
  }

  return (
    <aside className="btb-live-ledger" aria-label="BankerToolBench live ledger">
      <header className="btb-live-ledger__header">
        <div>
          <div className="btb-live-ledger__eyebrow"><Database size={14} /> Live Convex ledger</div>
          <h2>BTBLEDGER</h2>
        </div>
        <span className={fullRun ? "btb-live-ledger__badge btb-live-ledger__badge--ok" : "btb-live-ledger__badge"}>
          {fullRun ? "full run present" : "awaiting full 100"}
        </span>
      </header>

      <section className="btb-live-ledger__metrics" aria-label="Selected run metrics">
        <div>
          <span>Selected run</span>
          <strong title={selectedRun?.iterationLabel}>{selectedRun ? selectedRun.iterationLabel : "none"}</strong>
        </div>
        <div>
          <span>Tasks</span>
          <strong>{selectedRun?.taskCount ?? 0}</strong>
        </div>
        <div>
          <span>Clean headline</span>
          <strong>{formatReward(selectedRun?.headlineCleanProbeMean)}</strong>
        </div>
        <div>
          <span>Clean rows</span>
          <strong>{selectedRun?.headlineN ?? cleanRows}</strong>
        </div>
      </section>

      <section className="btb-live-ledger__runs" aria-label="Ledger runs">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            className={`btb-live-ledger__run ${selectedRun?.id === run.id ? "is-selected" : ""}`}
            onClick={() => setSelectedRunId(run.id)}
          >
            <span title={run.iterationLabel}>{run.iterationLabel}</span>
            <small>{run.taskCount} tasks · {run.headlineN ?? 0} clean · {formatReward(run.headlineCleanProbeMean)}</small>
          </button>
        ))}
      </section>

      <section className="btb-live-ledger__summary" aria-label="Selected run summary">
        <div><Activity size={14} /> {selectedRun?.status ?? "unknown"} · {selectedRun?.materializerMode ?? "n/a"} · {selectedRun?.model ?? "model n/a"}</div>
        <div><CheckCircle2 size={14} /> {cleanRows} visible clean rows · {rejectedRows} rejected/diagnostic rows</div>
        <div><ListChecks size={14} /> Completed {formatDate(selectedRun?.completedAt)}</div>
      </section>

      <div className="btb-live-ledger__tasks" role="table" aria-label="Visible BTB task rows">
        <div className="btb-live-ledger__task btb-live-ledger__task--head" role="row">
          <span role="columnheader">Task</span>
          <span role="columnheader">Reward</span>
          <span role="columnheader">Gate</span>
        </div>
        {tasks.slice(0, 100).map((task) => (
          <div className="btb-live-ledger__task" role="row" key={task.id}>
            <span role="cell">{task.taskId}</span>
            <span role="cell">{formatReward(task.reward)} {task.raw ? <small>{task.raw}</small> : null}</span>
            <span role="cell" className={task.countsTowardHeadline ? "is-clean" : "is-rejected"}>
              {task.countsTowardHeadline ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {task.countsTowardHeadline ? "clean" : task.verdict ?? "rejected"}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
