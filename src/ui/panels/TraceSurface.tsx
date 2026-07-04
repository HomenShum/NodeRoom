/**
 * Trace work-surface tab — a master-detail provenance view alongside the spreadsheet/research tabs.
 * Left: trace records (the live agent's source-backed work + a real QA run of our own app).
 * Right: Overview · Steps (each → the exact source cell / a captured screenshot) · Evidence · Raw JSON.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Wrench, FileCheck2, Camera, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { EvidenceCarouselArtifact } from "../artifacts/EvidenceCarouselArtifact";
import { EVIDENCE_CLASSES, evidenceLabel, auditEvidenceCoverage, passesHonestyGate, refutationLabel, summarizeRefutations, type EvidenceClass } from "../traceLens/evidence";
import type { RefutationVerdict, RefutationOutcome } from "../traceLens/types";
import { QA_TRACE_RECORD, QA_BUNDLES, buildAgentTraceRecords, type TraceRecord, type TraceStep, type TraceAttachment } from "./traceData";
import { StepRow } from "./TraceStepRow";
import { TraceFlow } from "./TraceFlow";
import { TraceObservability } from "./TraceObservability";

type DetailTab = "overview" | "steps" | "flow" | "observability" | "evidence" | "refutations" | "raw";

/** Capture a source into the Trace tab. Two lanes: Web (Firecrawl screenshot + extract) and SEC
 *  (EDGAR data API — authoritative facts by ticker/concept). The persisted record joins the list. */
function CaptureForm({ roomId, onCapture, onSec }: {
  roomId: string;
  onCapture: (roomId: string, url: string, goal: string) => Promise<{ ok: boolean; error?: string }>;
  onSec: (roomId: string, company: string, concept: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [mode, setMode] = useState<"web" | "sec">("web");
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [company, setCompany] = useState("");
  const [concept, setConcept] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ready = mode === "web" ? url.trim() : company.trim();
    if (!ready) { setErr("enter a " + (mode === "web" ? "URL" : "ticker")); return; }
    setBusy(true); setErr(null);
    try {
      const r = mode === "web"
        ? await onCapture(roomId, url.trim(), goal.trim() || "extract the key figures")
        : await onSec(roomId, company.trim(), concept.trim() || "revenue");
      if (!r.ok) setErr(r.error ?? "failed");
      else { setUrl(""); setGoal(""); setCompany(""); setConcept(""); }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="r-tracevu-capture" data-testid="trace-capture-form" onSubmit={submit}>
      <div className="r-tracevu-capture-modes" role="tablist">
        <button type="button" className="r-tracevu-capture-mode" data-on={String(mode === "web")} onClick={() => { setMode("web"); setErr(null); }} data-testid="trace-capture-mode-web">Web</button>
        <button type="button" className="r-tracevu-capture-mode" data-on={String(mode === "sec")} onClick={() => { setMode("sec"); setErr(null); }} data-testid="trace-capture-mode-sec">SEC</button>
      </div>
      {mode === "web" ? (
        <>
          <input className="r-tracevu-capture-in" placeholder="https://… source URL" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="trace-capture-url" />
          <input className="r-tracevu-capture-in" placeholder="what to extract" value={goal} onChange={(e) => setGoal(e.target.value)} data-testid="trace-capture-goal" />
        </>
      ) : (
        <>
          <input className="r-tracevu-capture-in" placeholder="ticker or CIK (e.g. AAPL)" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="trace-capture-company" />
          <input className="r-tracevu-capture-in" placeholder="concept (revenue, net income…)" value={concept} onChange={(e) => setConcept(e.target.value)} data-testid="trace-capture-concept" />
        </>
      )}
      <button type="submit" className="r-tracevu-capture-btn" disabled={busy} data-testid="trace-capture-go">{busy ? (mode === "web" ? "Capturing…" : "Looking up…") : (mode === "web" ? "Capture" : "Get SEC facts")}</button>
      {err && <span className="r-tracevu-capture-err" data-testid="trace-capture-err">{err}</span>}
    </form>
  );
}

/** One toggle, whole-artifact: colors every classified cell on the page by evidence class.
 *  Reads document.body — survives across artifacts/rooms. Pure DOM, no store. */
function HonestyToggle() {
  const [on, setOn] = useState<boolean>(() => typeof document !== "undefined" && document.body.classList.contains("nr-honesty-on"));
  const [coverage, setCoverage] = useState(() => auditEvidenceCoverage(typeof document !== "undefined" ? document : null));
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (on) document.body.classList.add("nr-honesty-on");
    else document.body.classList.remove("nr-honesty-on");
  }, [on]);
  // Re-audit when the toggle flips OR every 1s while on. Cheap (one querySelectorAll).
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const tick = () => setCoverage(auditEvidenceCoverage(document));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [on]);
  const gate = !on ? "empty" : coverage.total === 0 ? "empty" : (passesHonestyGate(coverage) ? "pass" : "fail");
  const gateLabel = gate === "empty" ? "no cells" : gate === "pass" ? "0 unsourced" : `${coverage.classes.unsourced} unsourced / ${coverage.total}`;
  return (
    <div className="r-tracevu-honesty" data-testid="honesty-toolbar">
      <button type="button" className="r-tracevu-honesty-toggle" data-on={String(on)} data-testid="honesty-toggle"
        onClick={() => setOn((v) => !v)} aria-pressed={on}
        title="Color every cell by evidence class — the whole artifact's honesty in one switch.">
        {on ? "Honesty: on" : "Honesty: off"}
      </button>
      {on && (
        <div className="r-tracevu-honesty-legend" data-testid="honesty-legend" aria-label="Evidence classes">
          {EVIDENCE_CLASSES.map((c: EvidenceClass) => (
            <span key={c} data-c={c} title={evidenceLabel(c)}>{c.replace("_", "-")} {coverage.classes[c]}</span>
          ))}
        </div>
      )}
      <span className="r-tracevu-honesty-gate" data-gate={gate} data-testid="honesty-gate"
        title="Zero-unsourced gate: every classified cell must have a known provenance.">
        {gateLabel}
      </span>
    </div>
  );
}
export function TraceSurface({ roomId, onOpenSource }: {
  roomId: string;
  onOpenSource: (artifactId: string, elementId?: string) => void;
}) {
  const store = useStore();
  // Gate trace-only Convex queries (captures, OKF lens) on this surface being mounted — zero
  // reactive cost (no per-step getUrl resolutions) when the user is on another tab.
  useEffect(() => { store.setTraceActive(true); return () => store.setTraceActive(false); }, [store]);
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const run = store.lastRun();
  const captureRecords = store.listCaptureRecords(roomId); // live web/SEC captures (Convex); [] in memory mode
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }),
    [room?.title, artifacts, traces],
  );
  const isBankerToolBenchRoom = /BankerToolBench/i.test(room?.title ?? "");
  const records = useMemo<TraceRecord[]>(
    () => {
      const agentRecords = buildAgentTraceRecords({
        company: isBankerToolBenchRoom ? "BankerToolBench NodeAgent" : packet.company,
        claim: packet.claim,
        packet,
        traces,
        run,
      });
      return isBankerToolBenchRoom
        ? [...agentRecords, ...captureRecords]
        : [...agentRecords, ...captureRecords, QA_TRACE_RECORD, ...QA_BUNDLES];
    },
    [isBankerToolBenchRoom, packet, traces, run, captureRecords],
  );
  const [selectedId, setSelectedId] = useState<string>(records[0]?.id ?? QA_TRACE_RECORD.id);
  // Lazy-resolve: tell the store which capture record is selected so it fetches URLs for that one.
  useEffect(() => { store.setSelectedCapture(selectedId.startsWith("capture-") ? selectedId : null); }, [store, selectedId]);
  const [tab, setTab] = useState<DetailTab>("overview");
  const record = records.find((r) => r.id === selectedId) ?? records[0];
  if (!record) return <div className="r-art-body r-tracevu" data-testid="trace-surface" />;

  const detailTabs = (["overview", "steps", "flow", "observability", "evidence", "refutations", "raw"] as DetailTab[])
    .filter((t) => t !== "evidence" || (record.evidenceCards?.length ?? 0) > 0)
    .filter((t) => t !== "refutations" || (record.refutations?.length ?? 0) > 0);

  return (
    <div className="r-art-body r-tracevu" data-testid="trace-surface" data-noderoom-surface="workSurface.trace">
      <aside className="r-tracevu-list" aria-label="Trace records">
        {store.mode === "convex" && <CaptureForm roomId={roomId} onCapture={store.captureSource} onSec={store.secFacts} />}
        {records.map((r) => (
          <button key={r.id} type="button" className="r-tracevu-rec" data-on={String(r.id === record.id)} data-testid="trace-record"
            onClick={() => { setSelectedId(r.id); setTab("overview"); }}>
            <span className="r-tracevu-rec-head">
              {r.kind === "qa" ? <Camera size={13} /> : <Activity size={13} />}
              <span className="r-tracevu-rec-title">{r.title}</span>
              {r.verdict && <span className="r-tracevu-pill" data-tone={r.verdict.tone}>{r.verdict.tone === "ok" ? "pass" : r.verdict.tone}</span>}
            </span>
            <span className="r-tracevu-rec-sub">{r.subtitle}</span>
            <span className="r-tracevu-rec-meta">{r.source?.tool ?? "—"} · {r.steps.length} step{r.steps.length === 1 ? "" : "s"} · {r.ts ?? ""}</span>
          </button>
        ))}
      </aside>

      <div className="r-tracevu-detail">
        <header className="r-tracevu-detail-head">
          <strong>{record.title}</strong>
          <p>{record.subtitle}</p>
          <HonestyToggle />
          <div className="r-tracevu-tabs" role="tablist" aria-label="Trace detail">
            {detailTabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} data-on={String(tab === t)} data-testid={`trace-tab-${t}`} onClick={() => setTab(t)}>
                {t === "overview" ? "Overview" : t === "steps" ? "Steps" : t === "flow" ? "Flow" : t === "observability" ? "Observability" : t === "evidence" ? "Evidence" : t === "refutations" ? "Refutations" : "Raw JSON"}
              </button>
            ))}
          </div>
        </header>

        <div className="r-tracevu-detail-body">
          {tab === "overview" && <TraceOverview record={record} />}
          {tab === "steps" && <TraceSteps record={record} onOpenSource={onOpenSource} />}
          {tab === "flow" && <TraceFlow record={record} onOpenSource={onOpenSource} />}
          {tab === "observability" && <TraceObservability record={record} />}
          {tab === "evidence" && <EvidenceCarouselArtifact cards={record.evidenceCards ?? []} onOpenArtifact={onOpenSource} />}
          {tab === "refutations" && <TraceRefutations record={record} />}
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
            <dt>Name</dt><dd>{record.source?.tool ?? "—"}</dd>
            {record.source?.version && <><dt>Version</dt><dd>{record.source.version}</dd></>}
            {record.source?.env && <><dt>Environment</dt><dd>{record.source.env}</dd></>}
            {record.source?.model && <><dt>Model</dt><dd>{record.source.model}</dd></>}
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
          {groups.map((g, groupIndex) => (
            <details key={`${g.name ?? "ungrouped"}-${groupIndex}`} className="r-tracevu-group" open={defaultOpen} data-testid="trace-group">
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
  const json = useMemo(() => JSON.stringify(record.raw ?? {}, null, 2), [record.raw]);
  const big = json.length > 20000;
  const href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  return (
    <div className="r-tracevu-rawwrap">
      {big && <a className="r-tracevu-download" href={href} download={`${record.id}.json`}>Download full JSON ({Math.round(json.length / 1024)} KB)</a>}
      <pre className="r-tracevu-raw" data-testid="trace-raw">{big ? `${json.slice(0, 20000)}\n… (truncated — download for full)` : json}</pre>
    </div>
  );
}


/** Refutations tab — Tekton adversarial-verification pattern. Lists every verdict (stands, refuted,
 *  uncertain), including overturned + uncertain ones. Failures are evidence, not blemishes. */
function TraceRefutations({ record }: { record: TraceRecord }) {
  const verdicts = record.refutations ?? [];
  const summary = summarizeRefutations(verdicts);
  const [filter, setFilter] = useState<"all" | RefutationOutcome>("all");
  const visible = filter === "all" ? verdicts : verdicts.filter((v) => v.verdict === filter);
  if (!verdicts.length) {
    return (
      <div className="r-tracevu-refutations-empty" data-testid="refutations-empty">
        <p>No adversarial-refutation pass has been run on this record yet.</p>
        <p className="r-tracevu-refutations-empty-hint">An independent verifier in a fresh context window
          tries to <strong>refute</strong> every claim; surviving claims earn "stands," overturned ones
          earn "refuted" with a corrected value, and ambiguous ones earn "uncertain." All three persist.</p>
      </div>
    );
  }
  const tone = (o: RefutationOutcome) => o === "stands" ? "ok" : o === "refuted" ? "risk" : "warn";
  const Icon = (o: RefutationOutcome) => o === "stands" ? ShieldCheck : o === "refuted" ? ShieldAlert : ShieldQuestion;
  return (
    <div className="r-tracevu-refutations" data-testid="trace-refutations">
      <header className="r-tracevu-refutations-head">
        <div className="r-tracevu-refutations-counts" data-testid="refutations-summary">
          <span data-tone="ok"   title="Claims that survived adversarial refutation">✓ {summary.byOutcome.stands} stands</span>
          <span data-tone="risk" title="Claims overturned by the independent verifier">✗ {summary.byOutcome.refuted} refuted</span>
          <span data-tone="warn" title="Claims the verifier could neither confirm nor refute">? {summary.byOutcome.uncertain} uncertain</span>
          {Number.isFinite(summary.avgConfidence) && (
            <span className="r-tracevu-refutations-avg" title="Average verifier confidence in its own verdicts">
              avg conf {(summary.avgConfidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="r-tracevu-refutations-filter" role="tablist" aria-label="Filter verdicts">
          {(["all", "stands", "refuted", "uncertain"] as const).map((f) => (
            <button key={f} type="button" data-on={String(filter === f)} data-testid={`refutations-filter-${f}`}
              className="r-tracevu-refutations-fbtn" onClick={() => setFilter(f)}>
              {f === "all" ? `All ${verdicts.length}` : `${refutationLabel(f)} ${summary.byOutcome[f]}`}
            </button>
          ))}
        </div>
      </header>
      <ol className="r-tracevu-refutations-list">
        {visible.map((v: RefutationVerdict) => {
          const I = Icon(v.verdict);
          return (
            <li key={v.claimId} className="r-tracevu-refutation" data-verdict={v.verdict} data-testid="refutation-card">
              <div className="r-tracevu-refutation-head">
                <span className="r-tracevu-refutation-badge" data-tone={tone(v.verdict)}>
                  <I size={12} /> {refutationLabel(v.verdict)}
                </span>
                <strong className="r-tracevu-refutation-claim">{v.claim}</strong>
                <span className="r-tracevu-refutation-conf" title="Verifier confidence in this verdict">
                  {(v.confidence * 100).toFixed(0)}%
                </span>
              </div>
              {v.correctedValue && (
                <div className="r-tracevu-refutation-corrected" data-testid="refutation-corrected">
                  <span className="kicker">Verifier proposes</span>
                  <p>{v.correctedValue}</p>
                </div>
              )}
              <p className="r-tracevu-refutation-reason">{v.reasoning}</p>
              <footer className="r-tracevu-refutation-foot">
                {v.refutedBy && <span>{v.refutedBy}</span>}
                {v.refutedAt && <time dateTime={v.refutedAt}>{v.refutedAt.replace("T", " ").replace("Z", " UTC")}</time>}
              </footer>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
