import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  LoaderCircle,
  Play,
  Route,
  ShieldCheck,
} from "lucide-react";
import { useStore, type AgentJobTelemetry } from "../../app/store";
import {
  buildInvestigationLaunchIntentV1,
  buildInvestigationWorkspaceV1,
  investigationLaunchReceiptMatchesV1,
  type AnalysisTaskRunV1,
  type InvestigationLaunchIntentV1,
  type InvestigationRuntimeStateV1,
  type InvestigationWorkspaceV1,
} from "../../nodeagent/investigation";
import "./investigation.css";

type InvestigationReportProps = {
  workspace: InvestigationWorkspaceV1;
  mode: "memory" | "convex";
  running?: boolean;
  runtimeError?: string | null;
  externalApproved?: boolean;
  onExternalApprovedChange?: (approved: boolean) => void;
  onRunResearch?: (intent: InvestigationLaunchIntentV1) => void | Promise<void>;
};

const STATUS_LABELS: Record<AnalysisTaskRunV1["status"], string> = {
  queued: "Queued",
  running: "Running",
  cached: "Cache hit",
  completed: "Complete",
  blocked: "Blocked",
  failed: "Failed",
};

function shortHash(value: string | undefined): string {
  return value ? value.replace(/^[^:]+:/, "").slice(0, 10) : "not available";
}

function readable(value: string): string {
  return value.replace(/_/g, " ");
}

function formatTimestamp(value: number | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function taskTone(status: AnalysisTaskRunV1["status"]): "ready" | "running" | "review" | "failed" | "quiet" {
  if (status === "completed" || status === "cached") return "ready";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "blocked") return "review";
  return "quiet";
}

function investigationTrustSummary(workspace: InvestigationWorkspaceV1) {
  const sourceRefs = workspace.researchPack?.sourceRefs ?? workspace.dataset?.sourceRefs ?? [];
  const claims = workspace.researchPack?.claims ?? [];
  const supportedClaimCount = claims.filter((claim) => claim.status === "supported").length;
  const staleClaimCount = claims.filter((claim) => claim.status === "stale").length;
  const needsReviewClaimCount = claims.filter((claim) => claim.status === "needs_review").length;
  return {
    collectedSourceRefCount: sourceRefs.length,
    verifiedSourceRefCount: sourceRefs.filter((source) => source.verificationStatus === "verified").length,
    supportedClaimCount,
    reviewRequiredClaimCount: staleClaimCount + needsReviewClaimCount,
  };
}

type InvestigationRuntimeMachineState =
  | "idle"
  | "active"
  | "intervention"
  | "retryable"
  | "completed"
  | "unknown";

function runtimeMachineState(workspace: InvestigationWorkspaceV1): InvestigationRuntimeMachineState {
  const status = workspace.runtime?.status?.trim().toLowerCase();
  if (!status) return workspace.runtime?.jobId ? "unknown" : "idle";
  if (["queued", "running", "retrying", "cancel_requested"].includes(status)) return "active";
  if (["waiting", "waiting_for_human", "paused", "blocked"].includes(status)) return "intervention";
  if (["failed", "cancelled", "canceled"].includes(status)) return "retryable";
  if (status === "completed") return "completed";
  return "unknown";
}

function evidenceMachineState(
  trust: ReturnType<typeof investigationTrustSummary>,
): "empty" | "pending_review" | "partial" | "supported" {
  if (trust.reviewRequiredClaimCount > 0) {
    return trust.supportedClaimCount > 0 ? "partial" : "pending_review";
  }
  return trust.supportedClaimCount > 0 ? "supported" : "empty";
}

function workspaceDisplayStatus(
  workspace: InvestigationWorkspaceV1,
  trust: ReturnType<typeof investigationTrustSummary>,
  runtimeState: InvestigationRuntimeMachineState,
): { label: string; tone: "ready" | "running" | "review" | "failed" } {
  if (!workspace.validation.valid) return { label: "Plan blocked", tone: "failed" };
  if (runtimeState === "active") return { label: "Research running", tone: "running" };
  if (runtimeState === "intervention") {
    const status = workspace.runtime?.status?.trim().toLowerCase();
    if (status === "paused") return { label: "Research paused", tone: "review" };
    if (status === "waiting" || status === "waiting_for_human") {
      return { label: "Research waiting for approval", tone: "review" };
    }
    return { label: "Research needs intervention", tone: "review" };
  }
  if (runtimeState === "unknown") return { label: "Runtime status unavailable", tone: "failed" };
  if (runtimeState === "retryable" || workspace.state === "failed") return { label: "Research failed", tone: "failed" };
  if (workspace.state === "blocked") return { label: "Research needs intervention", tone: "review" };
  if (workspace.state === "complete") {
    if (trust.reviewRequiredClaimCount > 0) return { label: "Run complete · review pending", tone: "review" };
    if (trust.supportedClaimCount > 0) return { label: "Evidence complete", tone: "ready" };
    return { label: "Run complete · no supported claims", tone: "review" };
  }
  if (trust.reviewRequiredClaimCount > 0) {
    return trust.supportedClaimCount > 0
      ? { label: "Plan ready · evidence partial", tone: "review" }
      : { label: "Plan ready · evidence pending", tone: "review" };
  }
  return trust.supportedClaimCount > 0
    ? { label: "Plan ready · evidence supported", tone: "ready" }
    : { label: "Plan ready · no claims", tone: "review" };
}

function downloadResearchPack(workspace: InvestigationWorkspaceV1): void {
  if (!workspace.researchPack || !workspace.dataset) return;
  const payload = JSON.stringify({
    exportedAt: new Date().toISOString(),
    dataset: workspace.dataset,
    plan: workspace.plan,
    taskRuns: workspace.taskRuns,
    researchPack: workspace.researchPack,
    teachingCase: workspace.teachingCase,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `noderoom-investigation-${workspace.dataset.versionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ResearchPlanPanel({ workspace }: { workspace: InvestigationWorkspaceV1 }): ReactElement {
  const { dataset, plan, validation } = workspace;
  return (
    <section className="nr-investigation-section" aria-labelledby="nr-investigation-plan-title">
      <div className="nr-investigation-section-head">
        <div>
          <span className="nr-investigation-eyebrow">ResearchPlanV1</span>
          <h3 id="nr-investigation-plan-title">Versioned analysis contract</h3>
        </div>
        <span
          className="nr-investigation-status"
          data-tone={validation.valid ? "ready" : "failed"}
          data-testid="research-plan-status"
        >
          {validation.valid ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {validation.valid ? "Validated" : "Blocked"}
        </span>
      </div>

      {dataset ? (
        <dl className="nr-investigation-contract" data-testid="analysis-dataset-version">
          <div><dt>Dataset</dt><dd>{dataset.versionId}</dd></div>
          <div><dt>Content hash</dt><dd>{shortHash(dataset.contentHash)}</dd></div>
          <div><dt>Artifact</dt><dd>v{dataset.version} · {dataset.artifactTitle}</dd></div>
          <div><dt>Captured</dt><dd>{formatTimestamp(dataset.createdAt)}</dd></div>
        </dl>
      ) : (
        <p className="nr-investigation-empty">No analysis dataset is available.</p>
      )}

      {plan && (
        <>
          <div className="nr-investigation-rule">
            <span>Plan digest</span>
            <code>{shortHash(plan.planDigest)}</code>
          </div>
          <ol className="nr-investigation-questions">
            {plan.questions.map((question) => (
              <li key={question.questionId}>
                <strong>{question.title}</strong>
                <span>{question.purpose}</span>
              </li>
            ))}
          </ol>
          <div className="nr-investigation-policy">
            <ShieldCheck size={14} />
            <span>NodeAgent · cache first · RoomTools-only writes · explicit egress</span>
          </div>
        </>
      )}

      {validation.issues.length > 0 && (
        <div className="nr-investigation-validation" role={validation.valid ? "status" : "alert"}>
          {validation.issues.map((issue) => (
            <p key={`${issue.code}:${issue.path}`} data-level={issue.level}>
              <span>{issue.code}</span>{issue.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function TaskRunPanel({ workspace }: { workspace: InvestigationWorkspaceV1 }): ReactElement {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  useEffect(() => {
    if (workspace.taskRuns.some((run) => run.runId === selectedRunId)) return;
    const next = workspace.taskRuns.find((run) => run.phase === "execute")
      ?? workspace.taskRuns.find((run) => run.status !== "completed" && run.status !== "cached")
      ?? workspace.taskRuns[0];
    setSelectedRunId(next?.runId ?? null);
  }, [selectedRunId, workspace.taskRuns]);
  const selected = workspace.taskRuns.find((run) => run.runId === selectedRunId) ?? null;
  const selectedIndex = selected ? workspace.taskRuns.findIndex((run) => run.runId === selected.runId) : -1;
  const selectedButtonId = selectedIndex >= 0 ? `nr-investigation-task-${selectedIndex + 1}` : undefined;

  return (
    <section className="nr-investigation-section" aria-labelledby="nr-investigation-dag-title">
      <div className="nr-investigation-section-head">
        <div>
          <span className="nr-investigation-eyebrow">Deterministic DAG</span>
          <h3 id="nr-investigation-dag-title">Analysis task runs</h3>
        </div>
        <span className="nr-investigation-count">{workspace.summary.completedTaskCount}/{workspace.summary.taskCount}</span>
      </div>

      {workspace.taskRuns.length ? (
        <div className="nr-investigation-task-list" data-testid="analysis-task-list">
          {workspace.taskRuns.map((run, index) => (
            <button
              type="button"
              key={run.runId}
              id={`nr-investigation-task-${index + 1}`}
              className="nr-investigation-task"
              data-selected={String(run.runId === selectedRunId)}
              data-status={run.status}
              onClick={() => setSelectedRunId(run.runId)}
              data-testid="analysis-task-run"
              aria-pressed={run.runId === selectedRunId}
              aria-controls="nr-investigation-run-detail"
            >
              <span className="nr-investigation-task-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="nr-investigation-task-copy">
                <strong>{workspace.plan?.tasks.find((task) => task.taskId === run.taskId)?.title ?? readable(run.phase)}</strong>
                <small>{readable(run.phase)} · {readable(run.statusSource)}</small>
              </span>
              <span className="nr-investigation-status" data-tone={taskTone(run.status)}>
                {run.status === "running" && <LoaderCircle size={11} className="nr-investigation-spin" />}
                {STATUS_LABELS[run.status]}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="nr-investigation-empty">Task runs stay closed until the plan and dataset validate.</p>
      )}

      {selected && (
        <dl
          id="nr-investigation-run-detail"
          className="nr-investigation-run-detail"
          aria-labelledby={selectedButtonId}
          aria-live="polite"
          data-testid="analysis-task-detail"
        >
          <div><dt>Run</dt><dd>{shortHash(selected.runId)}</dd></div>
          <div><dt>Input</dt><dd>{shortHash(selected.inputDigest)}</dd></div>
          <div><dt>Provenance</dt><dd>{shortHash(selected.provenanceHash)}</dd></div>
          <div><dt>Dependencies</dt><dd>{selected.provenance.dependencyRunIds.length}</dd></div>
          <div><dt>Cache keys</dt><dd>{selected.provenance.cacheKeys.length}</dd></div>
          <div><dt>Trace refs</dt><dd>{selected.provenance.traceIds.length}</dd></div>
          {selected.provenance.serverJob?.jobId && (
            <div><dt>Server job</dt><dd>{shortHash(selected.provenance.serverJob.jobId)}</dd></div>
          )}
          {selected.failure && (
            <div className="nr-investigation-run-failure">
              <dt>{selected.failure.code}</dt><dd>{selected.failure.message}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function ResearchPackPanel({ workspace }: { workspace: InvestigationWorkspaceV1 }): ReactElement {
  const pack = workspace.researchPack;
  if (!pack) {
    return <section className="nr-investigation-section"><p className="nr-investigation-empty">No research pack can be compiled yet.</p></section>;
  }
  const supportedClaimCount = pack.claims.filter((claim) => claim.status === "supported").length;
  return (
    <section className="nr-investigation-section nr-investigation-pack" data-testid="research-pack" aria-labelledby="nr-investigation-pack-title">
      <div className="nr-investigation-section-head">
        <div>
          <span className="nr-investigation-eyebrow">ResearchPackV1</span>
          <h3 id="nr-investigation-pack-title">Evidence-bound claims</h3>
        </div>
        <button
          type="button"
          className="r-btn ghost nr-investigation-download"
          onClick={() => downloadResearchPack(workspace)}
          data-testid="research-pack-download"
          title="Download the dataset, plan, task runs, research pack, and teaching case as JSON"
        >
          <Download size={13} /> JSON
        </button>
      </div>
      <div className="nr-investigation-pack-rule">
        <span>{supportedClaimCount} supported</span>
        <span>{pack.coverage.sourcedClaims} with verified refs</span>
        <span>{pack.coverage.staleClaims} stale</span>
        <span>{pack.coverage.needsReviewClaims} needs review</span>
        <span>{Math.round(pack.coverage.ratio * 100)}% supported-claim coverage</span>
        <code>{shortHash(pack.packDigest)}</code>
      </div>
      {pack.claims.length ? (
        <div className="nr-investigation-claims">
          <table>
            <caption className="sr-only">Claims and their verified evidence status</caption>
            <thead><tr><th>Entity</th><th>Claim</th><th>Evidence</th></tr></thead>
            <tbody>
              {pack.claims.map((claim) => (
                <tr key={claim.claimId}>
                  <td>{claim.entityLabel}</td>
                  <td><span>{readable(claim.field)}</span><strong>{claim.value}</strong></td>
                  <td><span className="nr-investigation-status" data-tone={claim.status === "supported" ? "ready" : "review"}>{claim.status === "supported" ? `${claim.sourceRefIds.length} verified ref${claim.sourceRefIds.length === 1 ? "" : "s"}` : claim.status === "stale" ? "Stale verified ref" : "Needs review"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="nr-investigation-empty">No claim-bearing research fields are populated.</p>
      )}
      {pack.sourceRefs.length > 0 && (
        <>
          <p className="nr-investigation-source-caption" id="nr-investigation-source-caption" data-testid="investigation-source-caption">
            Collected source references. External links open in a new tab.
          </p>
          <div className="nr-investigation-sources" aria-labelledby="nr-investigation-source-caption">
            {pack.sourceRefs.map((source) => source.uri ? (
              <a
                key={source.sourceRefId}
                href={source.uri}
                target="_blank"
                rel="noreferrer"
                aria-label={`${source.label} (opens in a new tab)`}
              >
                <span className="nr-investigation-source-link-label">{source.label}</span>
                <span className="nr-investigation-external-indicator" aria-hidden="true">↗</span>
              </a>
            ) : (
              <span key={source.sourceRefId}>{source.label}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TeachingCasePanel({ workspace }: { workspace: InvestigationWorkspaceV1 }): ReactElement {
  const teachingCase = workspace.teachingCase;
  if (!teachingCase) {
    return <section className="nr-investigation-section"><p className="nr-investigation-empty">A teaching case requires a validated dataset.</p></section>;
  }
  return (
    <section className="nr-investigation-case" data-testid="teaching-case">
      <div className="nr-investigation-case-title">
        <span className="nr-investigation-eyebrow">Guided teaching case</span>
        <h2>{teachingCase.title}</h2>
        <p>{teachingCase.setup}</p>
      </div>
      <div className="nr-investigation-case-question">
        <BookOpen size={17} />
        <div><span>Decision prompt</span><strong>{teachingCase.decisionQuestion}</strong></div>
      </div>
      <div className="nr-investigation-evidence-grid">
        {teachingCase.evidenceCards.map((card) => (
          <article key={card.claimId}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small data-status={card.status}>{card.status === "supported" ? `${card.sourceCount} verified ref${card.sourceCount === 1 ? "" : "s"}` : card.status === "stale" ? "Refresh verified ref" : "Hold for review"}</small>
          </article>
        ))}
      </div>
      <div className="nr-investigation-case-columns">
        <div>
          <h3>Questions still open</h3>
          {teachingCase.openQuestions.length ? (
            <ol>{teachingCase.openQuestions.map((question) => <li key={question}>{question}</li>)}</ol>
          ) : <p>No required evidence gaps remain.</p>}
        </div>
        <div>
          <h3>Learning objectives</h3>
          <ul>{teachingCase.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ul>
        </div>
      </div>
      <div className="nr-investigation-next-step"><span>Recommended next step</span><strong>{teachingCase.recommendedNextStep}</strong></div>
    </section>
  );
}

export function InvestigationReport({
  workspace,
  mode,
  running = false,
  runtimeError,
  externalApproved = false,
  onExternalApprovedChange,
  onRunResearch,
}: InvestigationReportProps): ReactElement {
  const [view, setView] = useState<"report" | "case">("report");
  const trust = investigationTrustSummary(workspace);
  const runtimeState = runtimeMachineState(workspace);
  const evidenceState = evidenceMachineState(trust);
  const displayStatus = workspaceDisplayStatus(workspace, trust, runtimeState);
  const blockedByConsent = mode === "convex" && !externalApproved;
  const blockedByRuntime = runtimeState === "active"
    || runtimeState === "intervention"
    || runtimeState === "unknown";
  const canRun = !!workspace.plan
    && !!workspace.dataset
    && workspace.validation.valid
    && !running
    && !blockedByRuntime
    && !blockedByConsent;
  const runDescriptionIds = [
    blockedByConsent ? "nr-investigation-run-consent-reason" : "",
    runtimeState === "intervention" || runtimeState === "unknown"
      ? "nr-investigation-run-runtime-reason"
      : "",
  ].filter(Boolean).join(" ") || undefined;
  const selectView = (nextView: "report" | "case") => {
    setView(nextView);
    document.getElementById(`nr-investigation-${nextView}-tab`)?.focus();
  };
  const handleViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectView("report");
    if (event.key === "End") return selectView("case");
    selectView(view === "report" ? "case" : "report");
  };
  const buttonLabel = running || runtimeState === "active"
    ? "Research running"
    : runtimeState === "intervention"
      ? "Research awaiting action"
      : runtimeState === "unknown"
        ? "Research unavailable"
        : runtimeState === "retryable" || workspace.state === "failed"
      ? "Retry research"
      : workspace.state === "complete"
        ? "Refresh evidence"
        : "Run pending research";

  return (
    <div
      className="nr-investigation"
      data-testid="investigation-report"
      data-state={workspace.state}
      data-plan-state={workspace.validation.valid ? "valid" : "blocked"}
      data-runtime-state={runtimeState}
      data-evidence-state={evidenceState}
      data-consent-state={mode === "convex" ? (externalApproved ? "approved" : "required") : "not_required"}
    >
      <header className="nr-investigation-hero">
        <div className="nr-investigation-hero-copy">
          <span className="nr-investigation-eyebrow"><Route size={12} /> Investigation Mode</span>
          <h1>Evidence-bound company diligence</h1>
          <p>A versioned plan compiles the live room sheet into deterministic NodeAgent tasks, provenance receipts, and a portable research pack.</p>
        </div>
        <div className="nr-investigation-actions">
          <div className="nr-investigation-view-toggle" role="tablist" aria-label="Investigation view">
            <button
              type="button"
              role="tab"
              id="nr-investigation-report-tab"
              aria-selected={view === "report"}
              aria-controls="nr-investigation-report-panel"
              tabIndex={view === "report" ? 0 : -1}
              data-active={String(view === "report")}
              onClick={() => selectView("report")}
              onKeyDown={handleViewKeyDown}
              data-testid="investigation-view-report"
            >
              Report
            </button>
            <button
              type="button"
              role="tab"
              id="nr-investigation-case-tab"
              aria-selected={view === "case"}
              aria-controls="nr-investigation-case-panel"
              tabIndex={view === "case" ? 0 : -1}
              data-active={String(view === "case")}
              onClick={() => selectView("case")}
              onKeyDown={handleViewKeyDown}
              data-testid="investigation-view-case"
            >
              Teaching case
            </button>
          </div>
          <span
            className="nr-investigation-status"
            data-tone={displayStatus.tone}
            data-testid="investigation-workspace-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {runtimeState === "active" && <LoaderCircle size={11} className="nr-investigation-spin" />}
            {displayStatus.label}
          </span>
        </div>
      </header>

      <div className="nr-investigation-metrics" aria-label="Investigation summary">
        <div><Database size={13} /><span>Entities</span><strong>{workspace.summary.entityCount}</strong></div>
        <div><Route size={13} /><span>Tasks</span><strong>{workspace.summary.taskCount}</strong></div>
        <div><CheckCircle2 size={13} /><span>Runs complete</span><strong>{workspace.summary.completedTaskCount}</strong></div>
        <div data-testid="investigation-metric-collected-refs"><BookOpen size={13} /><span>Refs collected</span><strong>{trust.collectedSourceRefCount}</strong></div>
        {/* An unrun verifier is not a measured zero: idle + 0 renders as an em dash, a completed run's 0 stays 0. */}
        <div data-testid="investigation-metric-verified-refs" title={runtimeState === "idle" && trust.verifiedSourceRefCount === 0 ? "Not yet verified — run pending research" : undefined}><ShieldCheck size={13} /><span>Refs verified</span><strong>{runtimeState === "idle" && trust.verifiedSourceRefCount === 0 ? "—" : trust.verifiedSourceRefCount}</strong></div>
        <div data-testid="investigation-metric-supported-claims" title={runtimeState === "idle" && trust.supportedClaimCount === 0 ? "Not yet verified — run pending research" : undefined}><CheckCircle2 size={13} /><span>Claims supported</span><strong>{runtimeState === "idle" && trust.supportedClaimCount === 0 ? "—" : trust.supportedClaimCount}</strong></div>
        <div data-testid="investigation-metric-review-claims"><AlertTriangle size={13} /><span>Claims to review</span><strong>{trust.reviewRequiredClaimCount}</strong></div>
      </div>

      {runtimeError && <div className="nr-investigation-error" role="alert" data-testid="investigation-runtime-error"><AlertTriangle size={14} />{runtimeError}</div>}

      {mode === "convex" && (
        <label className="nr-investigation-egress">
          <input
            type="checkbox"
            checked={externalApproved}
            onChange={(event) => onExternalApprovedChange?.(event.currentTarget.checked)}
            data-testid="investigation-egress-consent"
          />
          <span><strong>Allow source retrieval for this run</strong><small>The server job may fetch public websites. Writes remain inside RoomTools and carry receipts.</small></span>
        </label>
      )}

      <div className="nr-investigation-runbar">
        <div>
          <span>{workspace.dataset?.versionId ?? "Dataset unavailable"}</span>
          {blockedByConsent && (
            <small
              id="nr-investigation-run-consent-reason"
              className="nr-investigation-run-consent-reason"
              data-testid="investigation-run-consent-reason"
            >
              Run unavailable: approve public-source retrieval above before starting the server job.
            </small>
          )}
          {(runtimeState === "intervention" || runtimeState === "unknown") && (
            <small
              id="nr-investigation-run-runtime-reason"
              className="nr-investigation-run-consent-reason"
              data-testid="investigation-run-runtime-reason"
            >
              {runtimeState === "intervention"
                ? "Run unavailable: the existing research job needs approval, resume, or other operator action before another launch."
                : "Run unavailable: the existing research job returned an unknown status; inspect it before retrying."}
            </small>
          )}
          <small>{workspace.runtime?.jobId ? `Job ${shortHash(workspace.runtime.jobId)} · ${workspace.runtime.status ?? "unknown"}` : "No external job is implied until you run it."}</small>
        </div>
        <button
          type="button"
          className="r-btn primary"
          disabled={!canRun}
          aria-busy={running || runtimeState === "active"}
          aria-describedby={runDescriptionIds}
          onClick={() => {
            if (!workspace.plan || !workspace.dataset) return;
            void onRunResearch?.(buildInvestigationLaunchIntentV1({
              plan: workspace.plan,
              dataset: workspace.dataset,
            }));
          }}
          data-testid="investigation-run-research"
        >
          {running || runtimeState === "active" ? <LoaderCircle size={13} className="nr-investigation-spin" /> : <Play size={13} />}
          {buttonLabel}
        </button>
      </div>

      <div
        id="nr-investigation-report-panel"
        role="tabpanel"
        aria-labelledby="nr-investigation-report-tab"
        hidden={view !== "report"}
      >
        <div className="nr-investigation-report-grid">
          <ResearchPlanPanel workspace={workspace} />
          <TaskRunPanel workspace={workspace} />
          <div className="nr-investigation-wide"><ResearchPackPanel workspace={workspace} /></div>
        </div>
      </div>
      <div
        id="nr-investigation-case-panel"
        role="tabpanel"
        aria-labelledby="nr-investigation-case-tab"
        hidden={view !== "case"}
      >
        <TeachingCasePanel workspace={workspace} />
      </div>
    </div>
  );
}

function matchesResearchJob(
  job: AgentJobTelemetry | null,
  workspace: InvestigationWorkspaceV1,
): job is AgentJobTelemetry {
  return !!job && !!workspace.plan && !!workspace.dataset && investigationLaunchReceiptMatchesV1({
    receipt: job.request?.investigation,
    plan: workspace.plan,
    dataset: workspace.dataset,
  });
}

export function InvestigationSurface({ roomId }: { roomId: string }): ReactElement {
  const store = useStore();
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const sessions = store.listSessions(roomId);
  const baseWorkspace = useMemo(() => buildInvestigationWorkspaceV1({
    roomId,
    artifacts,
    traces,
    sessions,
  }), [artifacts, roomId, sessions, traces]);
  const latestJob = store.lastLongFreeJob();
  const relevantJob = [latestJob, ...(store.activeLongFreeJobs?.() ?? [])]
    .find((job, index, jobs) => (
      matchesResearchJob(job, baseWorkspace)
      && jobs.findIndex((candidate) => candidate?.id === job?.id) === index
    )) ?? null;
  const [launchStartedAt, setLaunchStartedAt] = useState<number | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [externalApproved, setExternalApproved] = useState(false);
  const running = launchStartedAt !== null;

  const runtime = useMemo<InvestigationRuntimeStateV1 | null>(() => {
    if (!relevantJob) return null;
    return {
      source: "durable_job",
      jobId: relevantJob.id,
      latestRunId: relevantJob.latestRunId,
      status: relevantJob.status,
      modelPolicy: relevantJob.modelPolicy,
      approvalPolicy: relevantJob.approvalPolicy,
      evidencePolicy: relevantJob.evidencePolicy,
      attempts: relevantJob.attempts,
      error: relevantJob.error,
      createdAt: relevantJob.createdAt,
      updatedAt: relevantJob.updatedAt,
      authorization: relevantJob.request?.investigation,
      resultDigest: relevantJob.resultDigest,
    };
  }, [relevantJob]);

  const workspace = useMemo(() => buildInvestigationWorkspaceV1({
    roomId,
    artifacts,
    traces,
    sessions,
    runtime,
  }), [artifacts, roomId, runtime, sessions, traces]);

  const runResearch = async (intent: InvestigationLaunchIntentV1) => {
    setRuntimeError(null);
    setLaunchStartedAt(Date.now());
    try {
      await store.askResearch(intent);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "The research run could not be started.");
    } finally {
      setLaunchStartedAt(null);
      if (store.mode === "convex") setExternalApproved(false);
    }
  };

  return (
    <InvestigationReport
      workspace={workspace}
      mode={store.mode}
      running={running}
      runtimeError={runtimeError}
      externalApproved={externalApproved}
      onExternalApprovedChange={setExternalApproved}
      onRunResearch={runResearch}
    />
  );
}
