import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Layers, LoaderCircle, PackageCheck, Search, ShieldAlert, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import {
  SKILL_STAGES,
  formatTokens,
  groupSummaryText,
  previewPath,
  skillStages,
  summarizeGroup,
  type ActivityItem,
  type CheckItem,
  type GroupEntry,
  type RunView,
  type SkillStage,
  type TimelineEntry,
} from "../eventReducer.js";
import { Markdown } from "./Markdown.js";

const PAGE = 40;

export function Timeline({ view, filterAgentId, onClearFilter, emptyHint }: { view: RunView; filterAgentId?: string; onClearFilter(): void; emptyHint: string }) {
  const [visible, setVisible] = useState(PAGE);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const helpers = useMemo(() => new Map(view.helpers.map((h) => [h.helperId, h])), [view.helpers]);
  const stages = useMemo(() => skillStages(view), [view]);

  const entries = useMemo(
    () => (filterAgentId ? view.timeline.filter((t) => t.kind === "terminal" || ("agentId" in t && t.agentId === filterAgentId)) : view.timeline),
    [view.timeline, filterAgentId],
  );
  const shown = entries.slice(Math.max(0, entries.length - visible));
  const lastAssistant = useMemo(() => {
    for (let i = view.timeline.length - 1; i >= 0; i--) {
      const t = view.timeline[i];
      if (t.kind === "message" && t.role === "assistant" && !t.agentId) return t.text;
    }
    return "";
  }, [view.timeline]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [shown.length, view.lastSeq]);

  const helperLabel = (id?: string) => (id ? helpers.get(id)?.description ?? `Helper ${id}` : undefined);

  return (
    <section className="naw-timeline-wrap" aria-label="Timeline">
      <div className="naw-timeline-head">
        <span className="naw-section-title">Timeline</span>
        {filterAgentId ? (
          <button type="button" className="naw-chip naw-chip-accent" onClick={onClearFilter}>
            Showing {helperLabel(filterAgentId)} <X size={12} aria-hidden />
          </button>
        ) : null}
        <ContextMeter view={view} />
      </div>
      <div
        ref={scroller}
        className="naw-timeline"
        data-testid="naw-timeline"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {shown.length < entries.length ? (
          <button
            type="button"
            className="naw-show-earlier"
            onClick={() => {
              const el = scroller.current;
              if (el) restoreFromBottom.current = el.scrollHeight - el.scrollTop;
              setVisible((v) => v + PAGE);
            }}
          >
            Show earlier ({entries.length - shown.length})
          </button>
        ) : view.droppedEntries > 0 && !filterAgentId ? (
          <p className="naw-muted naw-small">{view.droppedEntries} earlier entries are kept in the worker log, not in this view.</p>
        ) : null}
        {shown.length === 0 ? <p className="naw-empty">{emptyHint}</p> : null}
        {shown.map((t) => (
          <Entry key={t.key} entry={t} helperLabel={helperLabel} stages={stages} lastAssistant={lastAssistant} />
        ))}
      </div>
    </section>
  );
}

function ContextMeter({ view }: { view: RunView }) {
  const c = view.context;
  if (!c) return null;
  const pct = c.windowTokens ? Math.min(100, Math.round((c.usedTokens / c.windowTokens) * 100)) : null;
  return (
    <div className="naw-context-meter" data-testid="naw-context-meter" title="Context window usage reported by the engine">
      <span>
        Context {formatTokens(c.usedTokens)}
        {c.windowTokens ? ` / ${formatTokens(c.windowTokens)}` : " · window unknown"}
        {c.estimated ? " est." : ""}
      </span>
      {pct !== null ? (
        <span className="naw-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Context used">
          <span style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}

function Entry({ entry, helperLabel, stages, lastAssistant }: { entry: TimelineEntry; helperLabel(id?: string): string | undefined; stages: Map<string, SkillStage[]>; lastAssistant: string }) {
  switch (entry.kind) {
    case "message":
      return (
        <article className={`naw-msg naw-msg-${entry.role}`} aria-busy={entry.streaming || undefined} data-agent-id={entry.agentId}>
          {entry.agentId ? <div className="naw-msg-who">{helperLabel(entry.agentId)}</div> : null}
          {entry.role === "assistant" ? <Markdown text={entry.text} /> : <p className="naw-user-text">{entry.text}</p>}
          {entry.truncated ? <p className="naw-muted naw-small">Message truncated in this view.</p> : null}
        </article>
      );
    case "compaction":
      return (
        <div
          className="naw-compaction"
          role="separator"
          data-testid="naw-compaction-marker"
          data-pre-tokens={entry.preTokens}
          data-post-tokens={entry.postTokens ?? ""}
          data-trigger={entry.trigger}
          data-agent-id={entry.agentId}
        >
          <Layers size={14} aria-hidden />
          <span>
            {entry.agentId ? `${helperLabel(entry.agentId)} · ` : ""}Context compacted · {formatTokens(entry.preTokens)} → {entry.postTokens === undefined ? "unknown" : formatTokens(entry.postTokens)} tokens · {entry.trigger}
          </span>
        </div>
      );
    case "terminal":
      return (
        <div className={`naw-terminal naw-terminal-${entry.status}`} role="status">
          <strong>{entry.status === "completed" ? "Run completed" : entry.status === "failed" ? "Run failed" : "Run interrupted"}</strong>
          {entry.status === "completed" ? (entry.text && entry.text !== lastAssistant ? <Markdown text={entry.text} /> : null) : <p>{entry.text}</p>}
        </div>
      );
    case "group":
      return <Group group={entry} helperLabel={helperLabel} stages={stages} />;
  }
}

function Group({ group, helperLabel, stages }: { group: GroupEntry; helperLabel(id?: string): string | undefined; stages: Map<string, SkillStage[]> }) {
  const summary = summarizeGroup(group);
  return (
    <details className="naw-group" open={!group.closed} data-agent-id={group.agentId} data-closed={group.closed}>
      <summary>
        {summary.running > 0 ? <LoaderCircle size={14} className="naw-spin" aria-hidden /> : <Wrench size={14} aria-hidden />}
        <span>
          {group.agentId ? <span className="naw-group-who">{helperLabel(group.agentId)} · </span> : null}
          {groupSummaryText(summary)}
          {group.droppedItems ? ` · ${group.droppedItems} older items not shown` : ""}
        </span>
      </summary>
      <div className="naw-group-items">
        {group.items.map((it) => (
          <Item key={`${it.kind}-${it.seq}`} item={it} stages={stages} />
        ))}
      </div>
    </details>
  );
}

function StatusIcon({ status }: { status: "running" | "ok" | "error" | "no-result" }) {
  if (status === "running") return <LoaderCircle size={14} className="naw-spin" aria-label="running" />;
  if (status === "ok") return <CircleCheck size={14} className="naw-ok" aria-label="succeeded" />;
  if (status === "error") return <CircleX size={14} className="naw-bad" aria-label="failed" />;
  return <CircleDashed size={14} className="naw-muted" aria-label="no result recorded" />;
}

function Item({ item, stages }: { item: ActivityItem; stages: Map<string, SkillStage[]> }) {
  switch (item.kind) {
    case "tool": {
      const path = previewPath(item.inputPreview);
      return (
        <details
          className="naw-card naw-tool"
          data-testid="naw-tool-card"
          data-tool={item.name}
          data-family={item.family}
          data-native={String(item.native)}
          data-status={item.status}
          data-agent-id={item.agentId ?? ""}
        >
          <summary>
            <StatusIcon status={item.status} />
            <span className="naw-tool-name">{item.name}</span>
            {path ? <span className="naw-tool-target">{path}</span> : null}
            <span className="naw-chip">{item.native ? "native" : `node · ${item.family}`}</span>
            {item.ms !== undefined ? <span className="naw-muted naw-small">{item.ms} ms</span> : null}
            {item.status === "no-result" ? <span className="naw-muted naw-small">no result recorded</span> : null}
          </summary>
          <div className="naw-card-body">
            <div className="naw-label">Input</div>
            <pre className="naw-pre">{item.inputPreview || "—"}</pre>
            {item.resultPreview !== undefined ? (
              <>
                <div className="naw-label">Result</div>
                <pre className="naw-pre">{item.resultPreview || "—"}</pre>
              </>
            ) : null}
          </div>
        </details>
      );
    }
    case "tool-search":
      return (
        <div className="naw-card naw-search" data-testid="naw-tool-search-card" data-agent-id={item.agentId ?? ""}>
          <div className="naw-card-line">
            <Search size={14} aria-hidden />
            <span>
              Tool search “{item.query}” · {item.results.length} found · via {item.via}
            </span>
          </div>
          {item.results.length ? (
            <ul className="naw-flow">
              {item.results.map((r) => {
                const state = item.called.includes(r) ? "called" : item.loaded.includes(r) ? "loaded" : "found";
                return (
                  <li key={r} data-state={state}>
                    <code>{r}</code> <span className="naw-muted naw-small">{state === "called" ? "found → loaded → called" : state === "loaded" ? "found → loaded" : "found"}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      );
    case "tool-loaded":
      return (
        <div className="naw-card naw-loaded" data-testid="naw-tool-loaded" data-agent-id={item.agentId ?? ""}>
          <div className="naw-card-line">
            <PackageCheck size={14} aria-hidden />
            <span>
              Loaded {item.names.join(", ")} · {item.via === "native-tool-search" ? "native tool search" : "Node load_tool"}
            </span>
          </div>
        </div>
      );
    case "skill": {
      const stage = item.event === "lifecycle" ? item.stage! : item.event;
      const reached = item.event === "lifecycle" ? stages.get(item.name) ?? [] : [];
      return (
        <div className="naw-card naw-skill" data-testid="naw-skill-card" data-skill={item.name} data-stage={stage}>
          <div className="naw-card-line">
            <Sparkles size={14} aria-hidden />
            {item.event === "search" ? (
              <span>
                Skill search “{item.detail}” · {item.results?.length ?? 0} found{item.results?.length ? `: ${item.results.join(", ")}` : ""}
              </span>
            ) : item.event === "loaded" ? (
              <span>
                Loaded skill <code>{item.name}</code> · via {item.via}
              </span>
            ) : (
              <span>
                Skill <code>{item.name}</code> {item.stage}
              </span>
            )}
          </div>
          {item.event === "lifecycle" ? (
            <>
              <ol className="naw-stepper" aria-label="Skill lifecycle">
                {SKILL_STAGES.map((s) => (
                  <li key={s} data-reached={reached.includes(s)} data-current={s === item.stage}>
                    {s}
                  </li>
                ))}
                {item.stage === "rejected" ? <li data-reached="true" data-current="true" data-rejected="true">rejected</li> : null}
              </ol>
              {item.detail ? <p className="naw-muted naw-small">{item.detail}</p> : null}
            </>
          ) : null}
        </div>
      );
    }
    case "permission":
      return (
        <div className="naw-card naw-denial" data-testid="naw-permission-denial" data-tool={item.tool} data-agent-id={item.agentId ?? ""}>
          <div className="naw-card-line">
            <ShieldAlert size={14} aria-hidden />
            <span>
              Node denied <code>{item.tool}</code>: {item.reason}
            </span>
          </div>
        </div>
      );
    case "check":
      return <CheckRow check={item} />;
    case "artifact":
      return (
        <div className="naw-line naw-small">
          {item.change === "deleted" ? "Deleted" : item.change === "created" ? "Created" : "Updated"} <code>{item.path}</code>
        </div>
      );
    case "orphan-result":
      return <div className="naw-line naw-small naw-muted">Result for call {item.callId} arrived without a recorded call ({item.ok ? "ok" : "failed"})</div>;
  }
}

export function CheckRow({ check }: { check: Pick<CheckItem, "checkId" | "command" | "ok" | "outputTail" | "independent"> & { passed?: number; failed?: number; durationMs?: number } }) {
  return (
    <details className={`naw-card naw-check ${check.ok ? "naw-check-ok" : "naw-check-bad"}`} data-testid="naw-check-item" data-independent={String(check.independent)} data-ok={String(check.ok)}>
      <summary>
        {check.independent ? <ShieldCheck size={14} aria-hidden /> : check.ok ? <CircleCheck size={14} aria-hidden /> : <CircleX size={14} aria-hidden />}
        <span>
          {check.independent ? "Verified by Node" : "Agent-run check"} · {check.checkId}: {check.passed !== undefined ? `${check.passed} passed, ${check.failed ?? 0} failed` : check.ok ? "passed" : "failed"}
        </span>
        {check.durationMs !== undefined ? <span className="naw-muted naw-small">{check.durationMs} ms</span> : null}
      </summary>
      <div className="naw-card-body">
        <div className="naw-label">Command</div>
        <pre className="naw-pre">{check.command}</pre>
        {check.outputTail ? (
          <>
            <div className="naw-label">Output (tail)</div>
            <pre className="naw-pre">{check.outputTail}</pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

