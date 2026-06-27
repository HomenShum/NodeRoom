import { useState, useRef, type CSSProperties } from "react";
import { Plus, ArrowRight, Send, Table2, FileText, Activity } from "lucide-react";
import { useStore } from "../../app/store";
import type { Actor } from "../../engine/types";
import type { AgentJobTelemetry } from "../../app/store";
import { AgentLaneCard, statusFromJob, type RoomWorkLane } from "./AgentLaneCard";

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

export function RoomHome({
  roomId: _roomId,
  me: _me,
  style,
  onOpenChat,
  onAddSheet,
  onLoadSample,
}: {
  roomId: string;
  me: Actor;
  style?: CSSProperties;
  onOpenChat?: () => void;
  onAddSheet?: () => void;
  onLoadSample?: () => void;
}) {
  const store = useStore();
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const job = store.lastLongFreeJob();
  const lane = jobToLane(job);

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
    <div className="r-panel artifact r-room-home" style={style} data-testid="blank-room-state">
      <div className="r-room-home-scroll" data-testid="room-home">
        <div className="r-room-home-hero">
          <h1 className="r-room-home-headline">Run your deal room like a team of ten.</h1>
          <p className="r-room-home-sub">
            Capture rough notes, organize companies and people, and let NodeAgent build source-backed follow-up work.
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

        {lane && (
          <div className="r-room-lanes">
            <div className="r-room-lanes-header">
              <span className="r-room-lanes-label">Work lanes</span>
              <span className="r-room-lanes-count">{lane.status === "running" ? "1 active" : lane.status === "queued" ? "1 queued" : lane.status === "failed" ? "1 needs attention" : "1 done"}</span>
            </div>
            <AgentLaneCard
              lane={lane}
              onRetry={() => void store.retryLongFreeJob?.(lane.id)}
              onDismiss={() => void store.cancelLongFreeJob?.(lane.id)}
            />
          </div>
        )}

        <div className="r-room-inventory">
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
        </div>
      </div>
    </div>
  );
}
