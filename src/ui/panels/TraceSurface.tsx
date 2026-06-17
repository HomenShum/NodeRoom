/**
 * Trace work-surface tab — a master-detail provenance view alongside the spreadsheet/research tabs.
 * Left: trace records (the live agent's source-backed work + a real QA run of our own app).
 * Right: Overview · Steps (each → the exact source cell / a captured screenshot) · Evidence · Raw JSON.
 */
import { useMemo, useState } from "react";
import { Activity, Wrench, FileCheck2, Camera, ArrowUpRight } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { EvidenceCarouselArtifact } from "../artifacts/EvidenceCarouselArtifact";
import { QA_TRACE_RECORD, QA_BUNDLES, buildAgentTraceRecords, type TraceRecord, type TraceStep, type TraceAttachment } from "./traceData";

type DetailTab = "overview" | "steps" | "evidence" | "raw";

export function TraceSurface({ roomId, onOpenSource }: {
  roomId: string;
  onOpenSource: (artifactId: string, elementId?: string) => void;
}) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const run = store.lastRun();
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }),
    [room?.title, artifacts, traces],
  );
  const records = useMemo<TraceRecord[]>(
    () => [
      ...buildAgentTraceRecords({ company: packet.company, claim: packet.claim, packet, traces, run }),
      QA_TRACE_RECORD,
      ...QA_BUNDLES,
    ],
    [packet, traces, run],
  );
  const [selectedId, setSelectedId] = useState<string>(records[0]?.id ?? QA_TRACE_RECORD.id);
  const [tab, setTab] = useState<DetailTab>("overview");
  const record = records.find((r) => r.id === selectedId) ?? records[0];
  if (!record) return <div className="r-art-body r-tracevu" data-testid="trace-surface" />;

  const detailTabs = (["overview", "steps", "evidence", "raw"] as DetailTab[])
    .filter((t) => t !== "evidence" || (record.evidenceCards?.length ?? 0) > 0);

  return (
    <div className="r-art-body r-tracevu" data-testid="trace-surface" data-noderoom-surface="workSurface.trace">
      <aside className="r-tracevu-list" aria-label="Trace records">
        {records.map((r) => (
          <button key={r.id} type="button" className="r-tracevu-rec" data-on={String(r.id === record.id)} data-testid="trace-record"
            onClick={() => { setSelectedId(r.id); setTab("overview"); }}>
            <span className="r-tracevu-rec-head">
              {r.kind === "qa" ? <Camera size={13} /> : <Activity size={13} />}
              <span className="r-tracevu-rec-title">{r.title}</span>
              {r.verdict && <span className="r-tracevu-pill" data-tone={r.verdict.tone}>{r.verdict.tone === "ok" ? "pass" : r.verdict.tone}</span>}
            </span>
            <span className="r-tracevu-rec-sub">{r.subtitle}</span>
            <span className="r-tracevu-rec-meta">{r.source.tool} · {r.steps.length} step{r.steps.length === 1 ? "" : "s"} · {r.ts}</span>
          </button>
        ))}
      </aside>

      <div className="r-tracevu-detail">
        <header className="r-tracevu-detail-head">
          <strong>{record.title}</strong>
          <p>{record.subtitle}</p>
          <div className="r-tracevu-tabs" role="tablist" aria-label="Trace detail">
            {detailTabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} data-on={String(tab === t)} data-testid={`trace-tab-${t}`} onClick={() => setTab(t)}>
                {t === "overview" ? "Overview" : t === "steps" ? "Steps" : t === "evidence" ? "Evidence" : "Raw JSON"}
              </button>
            ))}
          </div>
        </header>

        <div className="r-tracevu-detail-body">
          {tab === "overview" && <TraceOverview record={record} />}
          {tab === "steps" && <TraceSteps record={record} onOpenSource={onOpenSource} />}
          {tab === "evidence" && <EvidenceCarouselArtifact cards={record.evidenceCards ?? []} onOpenArtifact={onOpenSource} />}
          {tab === "raw" && <TraceRaw record={record} />}
        </div>
      </div>
    </div>
  );
}

function TraceOverview({ record }: { record: TraceRecord }) {
  const a = record.attribution;
  return (
    <div className="r-tracevu-overview">
      <div className="r-tracevu-facts">
        <section>
          <span className="kicker"><Wrench size={11} /> Tool</span>
          <dl>
            <dt>Name</dt><dd>{record.source.tool}</dd>
            {record.source.version && <><dt>Version</dt><dd>{record.source.version}</dd></>}
            {record.source.env && <><dt>Environment</dt><dd>{record.source.env}</dd></>}
            {record.source.model && <><dt>Model</dt><dd>{record.source.model}</dd></>}
          </dl>
        </section>
        {record.verdict && (
          <section>
            <span className="kicker"><FileCheck2 size={11} /> Verdict</span>
            <span className="r-tracevu-verdict" data-tone={record.verdict.tone}>{record.verdict.label}</span>
          </section>
        )}
      </div>
      {a && a.ai + a.mixed + a.human > 0 && (
        <section className="r-tracevu-attr">
          <span className="kicker"><Activity size={11} /> Attribution (by evidence source)</span>
          <div className="r-tracevu-attrbar" aria-hidden="true">
            {a.ai > 0 && <span style={{ flex: a.ai }} data-seg="ai" />}
            {a.mixed > 0 && <span style={{ flex: a.mixed }} data-seg="mixed" />}
            {a.human > 0 && <span style={{ flex: a.human }} data-seg="human" />}
          </div>
          <div className="r-tracevu-attrkey">
            <span data-seg="ai">AI {a.ai}</span>
            <span data-seg="mixed">Mixed {a.mixed}</span>
            <span data-seg="human">Human {a.human}</span>
          </div>
        </section>
      )}
    </div>
  );
}

/** Group consecutive steps by their `group` label (phase/status/spec). Keeps hundreds navigable. */
function groupSteps(steps: TraceStep[]): { name: string | null; steps: TraceStep[] }[] {
  if (!steps.some((s) => s.group)) return [{ name: null, steps }];
  const out: { name: string | null; steps: TraceStep[] }[] = [];
  for (const s of steps) {
    const name = s.group ?? "Other";
    const last = out[out.length - 1];
    if (last && last.name === name) last.steps.push(s);
    else out.push({ name, steps: [s] });
  }
  return out;
}

function StepRow({ s, onOpenSource }: { s: TraceStep; onOpenSource: (artifactId: string, elementId?: string) => void }) {
  const att = s.attachments ?? [];
  const shots = att.filter((a): a is Extract<TraceAttachment, { kind: "screenshot" }> => a.kind === "screenshot");
  const ssims = att.filter((a): a is Extract<TraceAttachment, { kind: "ssim" }> => a.kind === "ssim");
  const logs = att.filter((a): a is Extract<TraceAttachment, { kind: "log" }> => a.kind === "log");
  const inner = (
    <>
      <span className="r-tracevu-step-idx">{s.idx}</span>
      <span className="r-tracevu-step-body">
        <span className="r-tracevu-step-label">
          {s.label}
          {ssims.map((a, i) => <span key={i} className="r-tracevu-ssim" data-flicker={String(a.diffRatio > 0.02)}>Δ {(a.diffRatio * 100).toFixed(1)}%</span>)}
          {s.targetArtifactId && <ArrowUpRight size={11} />}
        </span>
        {s.detail && <span className="r-tracevu-step-detail">{s.detail}</span>}
        {s.screenshotUrl && (
          <a className="r-tracevu-shotlink" href={s.screenshotUrl} target="_blank" rel="noopener noreferrer">
            <span className="r-tracevu-shotframe"><img className="r-tracevu-shot" src={s.screenshotUrl} alt={s.label} loading="lazy" /></span>
          </a>
        )}
        {shots.map((a, i) => (
          <a key={i} className="r-tracevu-shotlink" href={a.url} target="_blank" rel="noopener noreferrer">
            <span className="r-tracevu-shotframe">
              <img className="r-tracevu-shot" src={a.url} alt={a.label ?? s.label} loading="lazy" />
              {a.box && <span className="r-tracevu-box" style={{ left: `${a.box.x * 100}%`, top: `${a.box.y * 100}%`, width: `${a.box.w * 100}%`, height: `${a.box.h * 100}%` }} aria-hidden="true" />}
            </span>
          </a>
        ))}
        {logs.map((a, i) => <pre key={i} className="r-tracevu-log">{a.text}</pre>)}
        {s.metrics && (
          <span className="r-tracevu-metrics">
            {s.metrics.map((m) => <span key={m.label}><b>{m.value}</b> {m.label}</span>)}
          </span>
        )}
      </span>
    </>
  );
  return s.targetArtifactId ? (
    <button type="button" className="r-tracevu-step" data-testid="trace-step" data-tone={s.status} onClick={() => onOpenSource(s.targetArtifactId!, s.targetElementId)}>{inner}</button>
  ) : (
    <div className="r-tracevu-step" data-testid="trace-step" data-tone={s.status}>{inner}</div>
  );
}

function shotUrl(s: TraceStep): string | undefined {
  return s.screenshotUrl ?? s.attachments?.find((a): a is Extract<TraceAttachment, { kind: "screenshot" }> => a.kind === "screenshot")?.url;
}
function stepDelta(s: TraceStep): number | undefined {
  return s.attachments?.find((a): a is Extract<TraceAttachment, { kind: "ssim" }> => a.kind === "ssim")?.diffRatio;
}

/** Horizontal preview scroll of step frames — scrub the run, spot a flicker (Δ badge), click to jump. */
function Filmstrip({ steps }: { steps: TraceStep[] }) {
  const frames = steps.filter((s) => shotUrl(s));
  if (frames.length < 2) return null;
  return (
    <div className="r-tracevu-film" data-testid="trace-filmstrip" aria-label="Step preview filmstrip">
      {frames.map((s) => {
        const d = stepDelta(s);
        return (
          <button key={s.idx} type="button" className="r-tracevu-frame" data-flicker={String((d ?? 0) > 0.02)} title={`${s.idx}. ${s.label}`}
            onClick={() => document.getElementById(`tracestep-${s.idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            <span className="r-tracevu-frame-idx">{s.idx}</span>
            <img src={shotUrl(s)} alt="" loading="lazy" />
            {d != null && <span className="r-tracevu-frame-d">{(d * 100).toFixed(0)}%</span>}
          </button>
        );
      })}
    </div>
  );
}

function TraceSteps({ record, onOpenSource }: { record: TraceRecord; onOpenSource: (artifactId: string, elementId?: string) => void }) {
  const groups = groupSteps(record.steps);
  // Collapse big runs by default (the hundreds-of-steps case); expand small ones for quick reads.
  const defaultOpen = record.steps.length <= 40;
  return (
    <div className="r-tracevu-stepswrap">
      <Filmstrip steps={record.steps} />
      {groups.length === 1 && groups[0].name === null ? (
        <ol className="r-tracevu-steps">
          {groups[0].steps.map((s) => <li key={s.idx} id={`tracestep-${s.idx}`}><StepRow s={s} onOpenSource={onOpenSource} /></li>)}
        </ol>
      ) : (
        <div className="r-tracevu-groups">
          {groups.map((g) => (
            <details key={g.name} className="r-tracevu-group" open={defaultOpen} data-testid="trace-group">
              <summary><span className="r-tracevu-group-name">{g.name}</span><span className="r-tracevu-group-count">{g.steps.length}</span></summary>
              <ol className="r-tracevu-steps">
                {g.steps.map((s) => <li key={s.idx} id={`tracestep-${s.idx}`}><StepRow s={s} onOpenSource={onOpenSource} /></li>)}
              </ol>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRaw({ record }: { record: TraceRecord }) {
  const json = useMemo(() => JSON.stringify(record.raw, null, 2), [record.raw]);
  const big = json.length > 20000;
  const href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  return (
    <div className="r-tracevu-rawwrap">
      {big && <a className="r-tracevu-download" href={href} download={`${record.id}.json`}>Download full JSON ({Math.round(json.length / 1024)} KB)</a>}
      <pre className="r-tracevu-raw" data-testid="trace-raw">{big ? `${json.slice(0, 20000)}\n… (truncated — download for full)` : json}</pre>
    </div>
  );
}
