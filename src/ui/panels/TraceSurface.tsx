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
import { QA_TRACE_RECORD, buildAgentTraceRecords, type TraceRecord } from "./traceData";

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
          {tab === "raw" && <pre className="r-tracevu-raw" data-testid="trace-raw">{JSON.stringify(record.raw, null, 2)}</pre>}
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

function TraceSteps({ record, onOpenSource }: { record: TraceRecord; onOpenSource: (artifactId: string, elementId?: string) => void }) {
  return (
    <ol className="r-tracevu-steps">
      {record.steps.map((s) => {
        const inner = (
          <>
            <span className="r-tracevu-step-idx">{s.idx}</span>
            <span className="r-tracevu-step-body">
              <span className="r-tracevu-step-label">{s.label}{s.targetArtifactId && <ArrowUpRight size={11} />}</span>
              {s.detail && <span className="r-tracevu-step-detail">{s.detail}</span>}
              {s.screenshotUrl && <img className="r-tracevu-shot" src={s.screenshotUrl} alt={s.label} loading="lazy" />}
              {s.metrics && (
                <span className="r-tracevu-metrics">
                  {s.metrics.map((m) => <span key={m.label}><b>{m.value}</b> {m.label}</span>)}
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={s.idx}>
            {s.targetArtifactId ? (
              <button type="button" className="r-tracevu-step" data-testid="trace-step" data-tone={s.status} onClick={() => onOpenSource(s.targetArtifactId!, s.targetElementId)}>
                {inner}
              </button>
            ) : (
              <div className="r-tracevu-step" data-testid="trace-step" data-tone={s.status}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
