import { useMemo, type CSSProperties } from "react";
import { AlertTriangle, GitBranch } from "lucide-react";
import { useStore } from "../app/store";
import {
  buildPlanPreview,
  classifyIntakeMessage,
  type IntakeDecision,
  type PlanPreview,
} from "../nodeagent/core/intakePreflight";

const KIND_LABEL: Record<IntakeDecision["kind"], string> = {
  command: "New command",
  steering_patch: "Steering patch",
  parallel_subagent: "Parallel subagent",
  wait: "Wait",
  clarification: "Clarification",
  note: "Note",
  cancel: "Cancel",
  priority_change: "Priority change",
};

const SCHED: Record<PlanPreview["scheduling"], { label: string; tone: "ok" | "warn" | "err" }> = {
  run_now: { label: "Run now", tone: "ok" },
  draft_first: { label: "Draft first", tone: "warn" },
  wait_for_human: { label: "Wait for human", tone: "warn" },
  request_authorization: { label: "Authorize", tone: "warn" },
  blocked: { label: "Blocked", tone: "err" },
};

const TONE_COLOR: Record<"ok" | "warn" | "err", string> = {
  ok: "var(--success-ink, #1F8A5B)",
  warn: "var(--warning-ink, #9A6700)",
  err: "var(--danger-ink, #C0362C)",
};

const wrap: CSSProperties = {
  border: "1px solid var(--line)",
  background: "var(--bg-secondary)",
  borderRadius: 8,
  padding: "7px 10px",
  margin: "0 0 8px",
  fontSize: 11,
  color: "var(--text-muted)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

export function IntakePlanPreview({
  roomId,
  text,
  targetArtifacts,
}: {
  roomId: string;
  text: string;
  targetArtifacts: string[];
}) {
  const store = useStore();
  const trimmed = text.trim();
  const proposals = store.listProposals(roomId);
  const proposalKey = proposals.map((p) => (p as { artifactId?: string }).artifactId ?? "").join(",");
  // Cost is the prior run's real telemetry as a proxy estimate, never a fabricated number.
  const lastCost = store.lastRun()?.costUsd ?? 0;

  const result = useMemo(() => {
    if (!trimmed) return null;
    const decision = classifyIntakeMessage(trimmed);
    const pendingProposals = proposals
      .map((p) => (p as { artifactId?: string }).artifactId ?? "")
      .filter(Boolean);
    const plan = buildPlanPreview({
      decision,
      targetArtifacts,
      intendedWriteSet: decision.mutating ? targetArtifacts : [],
      pendingProposals,
      estimatedCostUsd: lastCost,
      authorizedCostUsd: lastCost,
    });
    return { decision, plan };
    // proposals are represented by proposalKey to avoid rerender churn from store object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, targetArtifacts.join(","), proposalKey, lastCost]);

  if (!result) return null;
  const { decision, plan } = result;
  const sched = SCHED[plan.scheduling];

  // Reveal-on-relevance: a plain command that just runs now needs no card — that was the crowding.
  // Stay silent only for that calm path; still surface anything the user must weigh (steering, wait,
  // cancel, clarification, parallel work, or a non-run-now/conflict verdict).
  if (decision.kind === "command" && sched.tone === "ok" && plan.conflicts.length === 0) return null;

  return (
    <div
      style={{ ...wrap, borderLeft: `3px solid ${TONE_COLOR[sched.tone]}` }}
      data-testid="intake-plan-preview"
      data-scheduling={plan.scheduling}
      data-kind={decision.kind}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <GitBranch size={12} aria-hidden="true" />
        <span style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{KIND_LABEL[decision.kind]}</span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="intake-scheduling"
          style={{
            fontWeight: 800,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: ".04em",
            color: TONE_COLOR[sched.tone],
          }}
        >
          {sched.label}
        </span>
      </div>
      <div style={{ color: "var(--text-muted)" }}>{decision.reason}</div>
      {plan.conflicts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {plan.conflicts.map((conflict, index) => (
            <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: TONE_COLOR.warn }}>
              <AlertTriangle size={10} aria-hidden="true" /> {conflict.detail}
            </span>
          ))}
        </div>
      )}
      <div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>
        Evidence {plan.evidencePolicy} - Cost ${plan.cost.estimatedUsd.toFixed(4)} / $
        {plan.cost.authorizedUsd.toFixed(4)}
      </div>
    </div>
  );
}
