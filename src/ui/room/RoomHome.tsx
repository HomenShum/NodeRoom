import { useState, useRef, type CSSProperties, type ReactNode } from "react";
import { Plus, ArrowRight, Send, Table2, FileText, Activity, BookOpen, StickyNote, Search } from "lucide-react";
import { useStore } from "../../app/store";
import type { Actor } from "../../engine/types";
import type { AgentJobTelemetry } from "../../app/store";
import { AgentLaneCard, statusFromJob, type RoomWorkLane } from "./AgentLaneCard";

/** A row in the Room Home inventory — the room's real artifacts when populated. */
export type RoomHomeArtifact = { id: string; title: string; kind: string; badge?: string; updatedAt?: number; owner?: string; visibility?: string };

/** Compact "time since" for the inventory's last-activity column — turns a static list into scannable state. */
function fmtAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function invIcon(kind: string): ReactNode {
  switch (kind) {
    case "sheet": return <Table2 size={16} />;
    case "note": return <FileText size={16} />;
    case "wiki": return <BookOpen size={16} />;
    case "wall": return <StickyNote size={16} />;
    case "research": return <Search size={16} />;
    default: return <FileText size={16} />;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "sheet": return "Spreadsheet";
    case "note": return "Note";
    case "wiki": return "Wiki";
    case "wall": return "Wall";
    case "research": return "Research";
    default: return kind;
  }
}

function jobToLane(job: AgentJobTelemetry | null): RoomWorkLane | null {
  if (!job) return null;
  const status = statusFromJob(job);
  const entryLabel = job.entrypoint === "room_work" ? "Company research" : job.entrypoint === "public_ask" ? "Room agent" : "Agent work";
  const subtitle = job.error
    ? job.error
    : status === "running"
      ? `Working · ${job.actionSliceCount ?? 0} actions · ${job.queryCount ?? 0} reads`
      : status === "queued"
        ? "Queued · waiting for capacity"
        : status === "done"
          ? `Completed · ${job.actionSliceCount ?? 0} actions`
          : status === "failed"
            ? job.error ?? "Failed — needs attention"
            : "Paused · waiting for review";
  const progressLabel = status === "running"
    ? `${job.modelCallCount ?? 0} model calls · ${job.toolCallCount ?? 0} tools`
    : status === "done"
      ? `${job.attempts} attempt${job.attempts === 1 ? "" : "s"}`
      : `Attempt ${job.attempts}/${job.maxAttempts}`;
  const nextAction = status === "failed"
    ? { label: "Retry", action: "retry" as const }
    : status === "needs_review"
      ? { label: "Dismiss", action: "dismiss" as const }
      : undefined;
  return {
    id: job.id,
    title: entryLabel,
    subtitle,
    status,
    progressLabel,
    nextAction,
  };
}

/** "Started N work lanes" — summarize the active lanes by state (running · queued · needs attention). */
function laneCountLabel(lanes: RoomWorkLane[]): string {
  const running = lanes.filter((l) => l.status === "running").length;
  const queued = lanes.filter((l) => l.status === "queued").length;
  const attention = lanes.filter((l) => l.status === "failed" || l.status === "needs_review").length;
  const parts: string[] = [];
  if (running) parts.push(`${running} running`);
  if (queued) parts.push(`${queued} queued`);
  if (attention) parts.push(`${attention} needs attention`);
  return parts.join(" · ") || `${lanes.length} active`;
}

export function RoomHome({
  roomId: _roomId,
  me: _me,
  style,
  onOpenChat,
  onAddSheet,
  onLoadSample,
  embedded,
  artifacts,
  onOpenArtifact,
}: {
  roomId: string;
  me: Actor;
  style?: CSSProperties;
  onOpenChat?: () => void;
  onAddSheet?: () => void;
  onLoadSample?: () => void;
  /** Rendered inside the work-surface body (Home tab) — drops the outer panel chrome. */
  embedded?: boolean;
  /** The room's real artifacts. When present, the inventory lists them instead of onboarding CTAs. */
  artifacts?: RoomHomeArtifact[];
  onOpenArtifact?: (id: string) => void;
}) {
  const hasArtifacts = !!artifacts && artifacts.length > 0;
  const store = useStore();
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const lanes = (store.activeLongFreeJobs?.() ?? [])
    .map(jobToLane)
    .filter((l): l is RoomWorkLane => !!l);

  const focusChat = () => {
    onOpenChat?.();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="chat-composer"]');
        if (ta) { ta.focus(); ta.scrollIntoView({ block: "center", behavior: "smooth" }); }
      });
    });
  };

  const submitCommand = () => {
    if (!command.trim()) return;
    const text = command.trim();
    focusChat();
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="chat-composer"]');
      if (ta) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        nativeInputValueSetter?.call(ta, text);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    setCommand("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCommand();
    }
  };

  return (
    <div
      className={embedded ? "r-room-home r-room-home-embedded" : "r-panel artifact r-room-home"}
      style={style}
      data-testid={hasArtifacts ? "room-home-surface" : "blank-room-state"}
    >
      <div className="r-room-home-scroll" data-testid="room-home">
        <div className="r-room-home-hero">
          <h1 className="r-room-home-headline">Run your deal room like a team of ten.</h1>
          <p className="r-room-home-sub">
            {hasArtifacts
              ? "Your command center: ask NodeAgent for new work, jump back into any artifact, and watch active work lanes."
              : "Capture rough notes, organize companies and people, and let NodeAgent build source-backed follow-up work."}
          </p>
        </div>

        <div className="r-room-command-wrap">
          <textarea
            ref={inputRef}
            className="r-room-command"
            data-testid="room-command-bar"
            placeholder="Ask NodeAgent to research a company, organize this room, or find evidence gaps..."
            value={command}
            onChange={(e) => setCommand(e.currentTarget.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <button
            className="r-room-command-send"
            data-testid="room-command-send"
            disabled={!command.trim()}
            onClick={submitCommand}
            aria-label="Send to NodeAgent"
          >
            <Send size={15} />
          </button>
        </div>

        {store.creditMode && (
          <div className="r-credit-modes" data-testid="credit-mode-selector" role="group" aria-label="Research depth">
            {(["quick", "standard", "deep"] as const).map((m) => {
              const active = (store.creditMode?.() ?? "standard") === m;
              const est = store.estimateCredits?.(m);
              return (
                <button
                  key={m}
                  type="button"
                  className="r-credit-mode"
                  data-active={String(active)}
                  data-testid={`credit-mode-${m}`}
                  aria-pressed={active}
                  onClick={() => store.setCreditMode?.(m)}
                  title={est ? `Est ${est.creditsLow}–${est.creditsHigh} credits · hard cap $${est.hardCapUsd.toFixed(2)}${est.requiresApproval ? " · approval required" : ""}` : m}
                >
                  <span className="r-credit-mode-name">{m[0].toUpperCase() + m.slice(1)}</span>
                  {est && <span className="r-credit-mode-est">~{est.creditsRequired} cr</span>}
                </button>
              );
            })}
            {(() => {
              const bal = store.creditBalance?.();
              return bal && bal.enforced ? (
                <span className="r-credit-modes-balance" data-testid="credit-balance">
                  {bal.availableCredits.toFixed(0)} credits{bal.demo ? " · demo" : ""}
                </span>
              ) : null;
            })()}
          </div>
        )}

        <div className="r-room-chips">
          <button className="r-room-chip" onClick={() => { setCommand("@nodeagent research upscaleX Palo Alto"); inputRef.current?.focus(); }}>
            Research upscaleX
          </button>
          <button className="r-room-chip" onClick={() => { setCommand("@nodeagent organize uploaded files"); inputRef.current?.focus(); }}>
            Organize files
          </button>
          <button className="r-room-chip" onClick={() => { setCommand("@nodeagent create company research table"); inputRef.current?.focus(); }}>
            Create research table
          </button>
          <button className="r-room-chip" onClick={() => { setCommand("@nodeagent find evidence gaps"); inputRef.current?.focus(); }}>
            Find evidence gaps
          </button>
          <button className="r-room-chip" onClick={() => { setCommand("@nodeagent draft follow-up memo"); inputRef.current?.focus(); }}>
            Draft follow-up memo
          </button>
        </div>

        {lanes.length > 0 && (
          <div className="r-room-lanes" data-testid="room-work-lanes">
            <div className="r-room-lanes-header">
              <span className="r-room-lanes-label">Work lanes</span>
              <span className="r-room-lanes-count" data-testid="room-work-lanes-count">{laneCountLabel(lanes)}</span>
            </div>
            {lanes.map((lane) => (
              <AgentLaneCard
                key={lane.id}
                lane={lane}
                onRetry={() => void store.retryLongFreeJob?.(lane.id)}
                onDismiss={() => void store.cancelLongFreeJob?.(lane.id)}
              />
            ))}
          </div>
        )}

        <div className="r-room-inventory">
          {hasArtifacts ? (
            <>
              <div className="r-room-inventory-header has-add">
                <span>Room inventory · {artifacts!.length}</span>
                {onAddSheet && (
                  <button className="r-room-inv-add" data-testid="room-home-add-sheet" onClick={() => onAddSheet()} title="Add a blank sheet">
                    <Plus size={13} /> Add sheet
                  </button>
                )}
              </div>
              <div className="r-room-inventory-grid">
                {[...artifacts!].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map((a) => (
                  <button key={a.id} className="r-room-inv-item" data-testid="room-home-artifact" onClick={() => onOpenArtifact?.(a.id)}>
                    <div className="r-room-inv-icon">{invIcon(a.kind)}</div>
                    <div className="r-room-inv-body">
                      <div className="r-room-inv-title">{a.title}</div>
                      <div className="r-room-inv-meta">{[kindLabel(a.kind), a.owner, fmtAgo(a.updatedAt), a.badge].filter(Boolean).join(" · ")}</div>
                    </div>
                    {a.visibility && a.visibility !== "room" && <span className="r-room-inv-vis" data-vis={a.visibility}>{a.visibility}</span>}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="r-room-inventory-header">Room inventory</div>
              <div className="r-room-inventory-grid">
                <button className="r-room-inv-item" data-testid="blank-cta-chat" onClick={focusChat}>
                  <div className="r-room-inv-icon"><Activity size={16} /></div>
                  <div className="r-room-inv-body">
                    <div className="r-room-inv-title">Start with chat</div>
                    <div className="r-room-inv-meta">Ask the room agent to work</div>
                  </div>
                  <ArrowRight size={14} />
                </button>
                <button className="r-room-inv-item" data-testid="blank-cta-sheet" onClick={() => onAddSheet?.()}>
                  <div className="r-room-inv-icon"><Table2 size={16} /></div>
                  <div className="r-room-inv-body">
                    <div className="r-room-inv-title">Add a blank sheet</div>
                    <div className="r-room-inv-meta">Start a diligence grid</div>
                  </div>
                  <Plus size={14} />
                </button>
                <button className="r-room-inv-item" data-testid="blank-cta-demo" onClick={() => onLoadSample?.()}>
                  <div className="r-room-inv-icon"><FileText size={16} /></div>
                  <div className="r-room-inv-body">
                    <div className="r-room-inv-title">Load sample workspace</div>
                    <div className="r-room-inv-meta">See a full diligence room</div>
                  </div>
                  <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
