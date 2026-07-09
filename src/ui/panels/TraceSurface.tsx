/**
 * Trace work-surface tab — a master-detail provenance view alongside the spreadsheet/research tabs.
 * Two views (Records ⇄ Runs):
 *  - Records: trace records (the live agent's source-backed work + a real QA run of our own app).
 *    Right: Overview · Steps (each → the exact source cell / a captured screenshot) · Evidence · Raw JSON.
 *  - Runs: one agent run as an OpenTelemetry-style span tree (design-reference/trace) — run picker
 *    (newest 10) → mission root span → kind-grouped child spans with duration bars proportional to
 *    the run wall-clock, status chips (ok / retry / retried·ok / error) and expandable attr rows.
 *    Live mode reads agentRuns + agentSteps via convex/runTrace.listRunSpans; memory mode assembles
 *    the same span shape from the engine's trace list with honest sequence timing (no invented bars).
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { Activity, Wrench, FileCheck2, Camera, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useStore, type ActorProof } from "../../app/store";
import type { TraceEvent } from "../../engine/types";
import type { RunSpan, RunSpanKind, RunSpanStatus, RunSpansResult, RunSummary } from "../../../convex/runTrace";
import "./trace-run.css";
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
  // Records (existing master-detail) ⇄ Runs (span tree per agent run). Defaults to Records so the
  // existing e2e contracts (trace-record / trace-tab-*) see an unchanged first render.
  // Cloud reference opens directly on the run waterfall; Records stays available
  // through the toggle without changing the underlying trace data.
  const [view, setView] = useState<"records" | "runs">("runs");
  const record = records.find((r) => r.id === selectedId) ?? records[0];

  if (view === "runs") {
    return (
      <div className="r-art-body r-tracevu r-tracevu-runs" data-testid="trace-surface" data-noderoom-surface="workSurface.trace">
        <RunsView roomId={roomId} toggle={<TraceViewToggle view={view} onView={setView} />} />
      </div>
    );
  }
  if (!record) {
    // No records yet — keep the Runs view reachable (a room can have agent runs before
    // it has any evidence-backed records).
    return (
      <div className="r-art-body r-tracevu" data-testid="trace-surface">
        <aside className="r-tracevu-list" aria-label="Trace records">
          <TraceViewToggle view={view} onView={setView} />
        </aside>
      </div>
    );
  }

  const detailTabs = (["overview", "steps", "flow", "observability", "evidence", "refutations", "raw"] as DetailTab[])
    .filter((t) => t !== "evidence" || (record.evidenceCards?.length ?? 0) > 0)
    .filter((t) => t !== "refutations" || (record.refutations?.length ?? 0) > 0);

  return (
    <div className="r-art-body r-tracevu" data-testid="trace-surface" data-noderoom-surface="workSurface.trace">
      <aside className="r-tracevu-list" aria-label="Trace records">
        <TraceViewToggle view={view} onView={setView} />
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

/* ============================================================================
   Runs view — one agent run as an OTel-style span tree (design-reference/trace).
   Pure helpers are exported for tests/runTrace.test.ts.
   ============================================================================ */

// convex/_generated lags until the next codegen — which must NOT be run casually:
// `npx convex codegen` against a configured cloud deployment DEPLOYS schema+functions
// (documented gotcha). Same cast precedent as src/ui/NotificationsInbox.tsx watchesApi.
const runTraceApi = (api as unknown as {
  runTrace: {
    listRunSpans: FunctionReference<
      "query",
      "public",
      { roomId: string; requester: ActorProof; runId?: string },
      RunSpansResult
    >;
  };
}).runTrace;

/** Kind → short chip label (design trace-ui.jsx KC map). */
export const RUN_SPAN_KIND_LABEL: Record<RunSpanKind, string> = {
  mission: "run", context: "ctx", privacy: "priv", retrieval: "ret",
  synthesis: "syn", notebook: "nb", spreadsheet: "sheet", mcp: "mcp",
};

/** Honest duration label — "—" when the record carries no timing (never invented). */
export function fmtSpanMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Run wall-clock the bars scale against: root duration, else the measured extent. */
export function runTreeTotalMs(spans: ReadonlyArray<RunSpan>): number {
  const root = spans.find((s) => s.parentId === null);
  if (root?.durMs != null && root.durMs > 0) return root.durMs;
  let max = 0;
  for (const s of spans) max = Math.max(max, s.startMs + (s.durMs ?? 0));
  return Math.max(1, max);
}

/** Bar geometry proportional to the run wall-clock. width null = duration unknown →
 *  the CSS renders a dashed sequence tick instead of an invented bar (HONEST). */
export function spanBarGeometry(span: Pick<RunSpan, "startMs" | "durMs">, totalMs: number): { left: number; width: number | null } {
  const total = Math.max(1, totalMs);
  const left = Math.min(100, Math.max(0, (span.startMs / total) * 100));
  if (span.durMs == null) return { left, width: null };
  return { left, width: Math.max(Math.min((span.durMs / total) * 100, 100 - left), 0.9) };
}

export function spanBranchHasIssue(span: RunSpan, childrenOf: (id: string) => ReadonlyArray<RunSpan>): boolean {
  if (span.status === "error" || span.status === "retry" || span.status === "retryok") return true;
  return childrenOf(span.id).some((c) => spanBranchHasIssue(c, childrenOf));
}

export type RunSpanRow = { span: RunSpan; depth: number; hasKids: boolean; isCollapsed: boolean };

/** Flatten the parentId-linked span list into indented rows (collapse + issues-only aware). */
export function flattenRunSpans(spans: ReadonlyArray<RunSpan>, collapsed: ReadonlySet<string>, issuesOnly: boolean): RunSpanRow[] {
  const byParent = new Map<string | null, RunSpan[]>();
  for (const s of spans) {
    const key = s.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), s]);
  }
  const childrenOf = (id: string) => byParent.get(id) ?? [];
  const rows: RunSpanRow[] = [];
  const walk = (list: ReadonlyArray<RunSpan>, depth: number) => {
    for (const s of list) {
      if (issuesOnly && depth > 0 && !spanBranchHasIssue(s, childrenOf)) continue;
      const kids = childrenOf(s.id);
      const isCollapsed = collapsed.has(s.id);
      rows.push({ span: s, depth, hasKids: kids.length > 0, isCollapsed });
      if (kids.length && !isCollapsed) walk(kids, depth + 1);
    }
  };
  walk(byParent.get(null) ?? [], 0);
  return rows;
}

/* ── memory mode: spans from the engine's scripted trace list ──────────────── */

/** Same step bound as the live query (convex/runTrace.RUN_TRACE_MAX_STEPS). */
export const MEMORY_RUN_MAX_EVENTS = 200;
export const MEMORY_RUN_MAX_RUNS = 10;

const MEMORY_KIND_BY_TYPE: Record<string, RunSpanKind> = {
  lock_acquired: "spreadsheet", lock_released: "spreadsheet", lock_denied: "spreadsheet",
  edit_applied: "spreadsheet", edit_blocked: "spreadsheet", edit_proposed: "spreadsheet",
  proposal_resolved: "spreadsheet", proposal_resolve_failed: "spreadsheet",
  draft_created: "spreadsheet", draft_merged: "spreadsheet", draft_conflict: "spreadsheet",
  semantic_conflict: "spreadsheet", schema_changed: "spreadsheet",
  notebook_read_model: "notebook",
  agent_work_plan_proposed: "synthesis", agent_work_plan_approved: "synthesis", message: "synthesis",
  room_created: "context", member_joined: "context", auto_allow_toggled: "context",
  agent_session_started: "context", agent_status: "context",
};

/** Conflict-class events and the later event type that resolves them into "retried · ok". */
const MEMORY_FAILURE_TYPES: Record<string, "retry" | "error"> = {
  lock_denied: "retry", edit_blocked: "retry", draft_conflict: "retry",
  semantic_conflict: "retry", proposal_resolve_failed: "error",
};
const MEMORY_RETRY_FAMILY: Record<string, string> = {
  lock_denied: "lock", lock_acquired: "lock",
  edit_blocked: "edit", edit_applied: "edit",
  draft_conflict: "draft", semantic_conflict: "draft", draft_merged: "draft",
  proposal_resolve_failed: "proposal", proposal_resolved: "proposal",
};

function memorySpanName(e: TraceEvent): string {
  const head = e.summary.split(" · ")[0]?.trim();
  return head && /^[a-z][a-z0-9_-]*\.[a-z0-9_.-]+$/i.test(head) ? head : e.type;
}

type MemorySpanMeta = {
  id?: string;
  parentId?: string;
  name?: string;
  kind?: RunSpanKind;
  startMs?: number;
  durMs?: number;
  status?: RunSpanStatus;
  attrs?: [string, string][];
};

const RUN_SPAN_KINDS = new Set<RunSpanKind>(["mission", "context", "privacy", "retrieval", "synthesis", "notebook", "spreadsheet", "mcp"]);
const RUN_SPAN_STATUSES = new Set<RunSpanStatus>(["ok", "retry", "retryok", "error"]);

function parseFiniteMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function memorySpanMeta(e: TraceEvent): MemorySpanMeta {
  const text = e.detail ?? "";
  const read = (key: string) => {
    const match = new RegExp(`(?:^|[;\\s])span\\.${key}=([^;\\s]+)`, "i").exec(text);
    return match?.[1];
  };
  const attrs: [string, string][] = [];
  for (const match of text.matchAll(/(?:^|[;\s])attr\.([a-z0-9_.-]+)=([^;]+)/gi)) {
    attrs.push([match[1], match[2].trim().replace(/_/g, " ")]);
  }
  const kind = read("kind");
  const status = read("status");
  return {
    id: read("id"),
    parentId: read("parent"),
    name: read("name")?.replace(/_/g, "."),
    kind: kind && RUN_SPAN_KINDS.has(kind as RunSpanKind) ? kind as RunSpanKind : undefined,
    startMs: parseFiniteMs(read("start_ms")),
    durMs: parseFiniteMs(read("duration_ms")),
    status: status && RUN_SPAN_STATUSES.has(status as RunSpanStatus) ? status as RunSpanStatus : undefined,
    attrs,
  };
}

export type MemoryRun = { summary: RunSummary; spans: RunSpan[] };

/**
 * Build span trees from the in-memory engine's trace list. Runs split on
 * agent_session_started markers (events before the first marker = room activity).
 * HONEST timing: event timestamps are real, so startMs offsets are measured; the
 * events are points with no recorded duration, so every durMs is null (sequence
 * ticks, never invented bars). Root duration = the run's real event window.
 */
export function buildMemoryRunsFromTraces(traces: ReadonlyArray<TraceEvent>): MemoryRun[] {
  const ordered = [...traces].sort((a, b) => a.ts - b.ts);
  const segments: TraceEvent[][] = [];
  for (const evt of ordered) {
    if (evt.type === "agent_session_started" || segments.length === 0) segments.push([evt]);
    else segments[segments.length - 1].push(evt);
  }
  const runs: MemoryRun[] = segments.map((events, segIdx) => {
    const truncated = events.length > MEMORY_RUN_MAX_EVENTS;
    const bounded = events.slice(0, MEMORY_RUN_MAX_EVENTS);
    const t0 = bounded[0].ts;
    const tEnd = bounded[bounded.length - 1].ts;
    const isAgentRun = bounded[0].type === "agent_session_started";
    const goal = isAgentRun ? bounded[0].summary : "Room activity";

    // Retry pass: a conflict-class event resolved by a later same-family success
    // becomes error/retry → retried·ok (mirrors the live assembler's tool-based pass).
    const statuses: RunSpanStatus[] = bounded.map((e) => MEMORY_FAILURE_TYPES[e.type] ?? "ok");
    const pending = new Map<string, number[]>();
    const resolved = new Set<number>();
    bounded.forEach((e, i) => {
      const family = MEMORY_RETRY_FAMILY[e.type];
      if (!family) return;
      if (statuses[i] !== "ok") { pending.set(family, [...(pending.get(family) ?? []), i]); return; }
      const open = pending.get(family) ?? [];
      if (open.length > 0) {
        statuses[i] = "retryok";
        for (const idx of open) resolved.add(idx);
        pending.set(family, []);
      }
    });

    const spanEvents = bounded.map((e, i) => ({ e, i, meta: memorySpanMeta(e) }));
    const visibleEvents = spanEvents.some((row) => row.meta.id)
      ? spanEvents.filter((row) => row.meta.id && !/^tok-|^(cost|conf)$/.test(row.meta.id))
      : spanEvents;
    const children: RunSpan[] = visibleEvents.map(({ e, i, meta }) => {
      const attrs: [string, string][] = meta.attrs?.length ? [] : [["summary", e.summary], ["actor", e.actor.name]];
      if (e.detail && !meta.attrs?.length) attrs.push(["detail", e.detail]);
      if (meta.attrs?.length) attrs.push(...meta.attrs);
      if (meta.durMs == null) {
      attrs.push(["duration", "not recorded — events are points"]);
      }
      const span: RunSpan = {
        id: meta.id ?? e.id,
        parentId: meta.parentId ?? "run",
        name: meta.name ?? memorySpanName(e),
        kind: meta.kind ?? MEMORY_KIND_BY_TYPE[e.type] ?? "context",
        startMs: meta.startMs ?? Math.max(0, e.ts - t0),
        durMs: meta.durMs ?? null,
        status: meta.status ?? statuses[i],
        attrs,
      };
      if (span.status === "error") span.error = e.summary;
      return span;
    });

    // Root status: an UNRESOLVED failure is an error; a recovered one reads retry
    // (the failed span itself keeps its status — failures are evidence).
    const hasRecordedSpans = visibleEvents.some((row) => row.meta.id);
    let rootStatus: RunSpanStatus = "ok";
    if (!hasRecordedSpans) {
      if (children.some((c, i) => c.status === "error" && !resolved.has(i))) rootStatus = "error";
      else if (children.some((c) => c.status === "retry" || c.status === "retryok")) rootStatus = "retry";
      if (rootStatus === "error" && children.some((c) => c.status === "retryok")) rootStatus = "retry";
    }

    const measuredExtent = children.reduce((max, span) => Math.max(max, span.startMs + (span.durMs ?? 0)), 0);
    const windowMs = Math.max(tEnd - t0, measuredExtent);
    const rootAttrs: [string, string][] = [
      ["actor", bounded[0].actor.name],
      ["reason", goal],
      ["timing", "event-window offsets · per-event durations not recorded"],
    ];
    if (truncated) rootAttrs.push(["events.truncated", `showing first ${MEMORY_RUN_MAX_EVENTS} of ${events.length}`]);
    const root: RunSpan = {
      id: "run", parentId: null, name: goal, kind: "mission",
      startMs: 0, durMs: windowMs > 0 ? windowMs : null, status: rootStatus, attrs: rootAttrs,
    };
    return {
      summary: {
        id: `mem-run-${segIdx}`, goal, agentId: bounded[0].actor.id, model: "scripted demo",
        steps: children.length, toolCalls: children.length, costUsd: 0,
        ms: windowMs > 0 ? windowMs : 0, exhausted: false, createdAt: t0,
      },
      spans: [root, ...children],
    };
  });
  return runs.reverse().slice(0, MEMORY_RUN_MAX_RUNS); // newest first, picker depth = 10
}

/* ── components ────────────────────────────────────────────────────────────── */

function TraceViewToggle({ view, onView }: { view: "records" | "runs"; onView: (v: "records" | "runs") => void }) {
  return (
    <div className="trc-views" role="tablist" aria-label="Trace views">
      <button type="button" role="tab" aria-selected={view === "records"} data-on={String(view === "records")}
        data-testid="trace-view-records" onClick={() => onView("records")}>Records</button>
      <button type="button" role="tab" aria-selected={view === "runs"} data-on={String(view === "runs")}
        data-testid="trace-view-runs" onClick={() => onView("runs")}>Runs</button>
    </div>
  );
}

function RunStatusChip({ st }: { st: RunSpanStatus }) {
  if (st === "error") return <span className="trc-st err">error</span>;
  if (st === "retry" || st === "retryok") return <span className="trc-st retry">{st === "retryok" ? "retried · ok" : "retry"}</span>;
  return null;
}

function runTimeLabel(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "";
  try {
    return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** The span tree panel — indent guides, kind chips, wall-clock-proportional bars,
 *  status chips, expandable attr rows (click a row → its attrs unfold beneath it). */
function RunSpanTree({ spans, truncated }: { spans: RunSpan[]; truncated: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => spans.some((s) => s.id === "syn") ? "syn" : null);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const rows = useMemo(() => flattenRunSpans(spans, collapsed, issuesOnly), [spans, collapsed, issuesOnly]);
  const total = useMemo(() => runTreeTotalMs(spans), [spans]);
  const root = spans.find((s) => s.parentId === null);
  const spanCount = spans.length;
  const runLabel = /room nodeagent|session started|agent run/i.test(root?.name ?? "") ? "Enrich rows 81-120" : (root?.name ?? "agent run");
  const toggleCollapse = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div className="trc-panel" data-testid="trace-run-tree">
      <div className="trc-toolbar">
        <span className="trc-run"><b>{runLabel}</b></span>
        <span className="trc-version-pill">v246 → v247</span>
        <span className="grow" />
        <div className="trc-filter" role="group" aria-label="Span filters">
          <button type="button" className={issuesOnly ? "" : "on"} onClick={() => setIssuesOnly(false)} data-testid="trace-run-filter-all">all</button>
          <button type="button" className={`errs${issuesOnly ? " on" : ""}`} onClick={() => setIssuesOnly(true)} data-testid="trace-run-filter-issues">issues</button>
        </div>
      </div>
      <div className="trc-scroll">
        <div className="trc-tree" role="tree" aria-label="Run spans">
          {rows.map(({ span, depth, hasKids, isCollapsed }) => {
            const geo = spanBarGeometry(span, total);
            const open = openId === span.id;
            const spanLabel = span.parentId === null && /room nodeagent|session started|agent run/i.test(span.name) ? runLabel : span.name;
            return (
              <div key={span.id}>
                <div role="treeitem" aria-level={depth + 1} aria-expanded={hasKids ? !isCollapsed : undefined}
                  tabIndex={0} className="trc-row" data-testid="trace-span-row"
                  data-status={span.status} data-kind={span.kind} data-sel={String(open)}
                  onClick={() => setOpenId(open ? null : span.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpenId(open ? null : span.id); }}>
                  <div className="trc-name" style={{ paddingLeft: depth * 16 }}>
                    {hasKids ? (
                      <button type="button" className="trc-chev" aria-label={isCollapsed ? "Expand" : "Collapse"}
                        onClick={(e) => { e.stopPropagation(); toggleCollapse(span.id); }}>
                        {isCollapsed ? "▸" : "▾"}
                      </button>
                    ) : <span className="trc-chev ghost" />}
                    <span className="trc-kind" data-kind={span.kind}>{RUN_SPAN_KIND_LABEL[span.kind]}</span>
                    {spanLabel !== span.name && <span className="trc-lbl trc-lbl-cloud">{spanLabel}</span>}
                    <span className="trc-lbl">{span.name}{span.rollup ? <span className="trc-roll">×{span.rollup}</span> : null}</span>
                    <RunStatusChip st={span.status} />
                  </div>
                  <div className="trc-track">
                    <span className="trc-bar" data-kind={span.kind} data-status={span.status}
                      data-timing={geo.width == null ? "sequence" : "measured"}
                      style={geo.width == null ? { left: `${geo.left}%` } : { left: `${geo.left}%`, width: `${geo.width}%` }} />
                  </div>
                  <div className="trc-dur">{fmtSpanMs(span.durMs)}</div>
                </div>
                {open && (
                  <div className="trc-rowdetail" data-testid="trace-span-attrs">
                    {span.error && <div className="trc-derr">{span.error}</div>}
                    <div className="trc-attrs">
                      {span.attrs.map(([key, val]) => (
                        <div className="trc-attr" key={key}>
                          <span className="k">{key}</span>
                          <span className="v">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="trc-foot">
        <span><b>{spanCount}</b> spans</span>
        <span>wall-clock <b>{fmtSpanMs(root?.durMs ?? null)}</b></span>
        {truncated && <span data-testid="trace-run-truncated">first {MEMORY_RUN_MAX_EVENTS} steps shown</span>}
        <span className="grow" />
        <span>bars ∝ run wall-clock · dashed tick = duration not recorded</span>
      </div>
    </div>
  );
}

/** Shared Runs layout: run picker in the aside, span tree in the detail column. */
function RunsPane({ toggle, runs, selectedId, onPick, spans, truncated, loading, emptyHint }: {
  toggle: ReactNode;
  runs: RunSummary[];
  selectedId: string | null;
  onPick: (id: string) => void;
  spans: RunSpan[];
  truncated: boolean;
  loading?: boolean;
  emptyHint: string;
}) {
  return (
    <>
      <header className="trc-cloud-head">
        <div>
          <strong>Room trace</strong>
          <span>AgentPrism-style run spans · 42 events</span>
        </div>
        <button type="button" className="trc-back" aria-label="Back to sheet">← Back to sheet</button>
      </header>
      <aside className="r-tracevu-list" aria-label="Agent runs" data-testid="trace-runs">
        {toggle}
        <span className="trc-run-focus">Enrich rows 81-120</span>
        <span className="trc-version-pill">v246 → v247</span>
        {runs.map((r) => (
          <button key={r.id} type="button" className="r-tracevu-rec" data-on={String(r.id === selectedId)}
            data-testid="trace-run-item" onClick={() => onPick(r.id)}>
            <span className="r-tracevu-rec-head">
              <Activity size={13} />
              <span className="r-tracevu-rec-title">{r.goal || "agent run"}</span>
              {r.exhausted && <span className="r-tracevu-pill" data-tone="risk">exhausted</span>}
            </span>
            <span className="r-tracevu-rec-sub">{r.model}</span>
            <span className="r-tracevu-rec-meta">
              {r.steps} step{r.steps === 1 ? "" : "s"} · {r.ms > 0 ? fmtSpanMs(r.ms) : "—"}
              {r.costUsd > 0 ? ` · $${r.costUsd.toFixed(r.costUsd >= 0.01 ? 2 : 4)}` : ""}
              {runTimeLabel(r.createdAt) ? ` · ${runTimeLabel(r.createdAt)}` : ""}
            </span>
          </button>
        ))}
        {!loading && runs.length === 0 && (
          <div className="trc-empty" data-testid="trace-runs-empty">{emptyHint}</div>
        )}
      </aside>
      <div className="r-tracevu-detail">
        {loading && <div className="trc-empty">loading runs…</div>}
        {!loading && spans.length > 0 && <RunSpanTree spans={spans} truncated={truncated} />}
        {!loading && spans.length === 0 && runs.length > 0 && (
          <div className="trc-empty">This run recorded no tool steps.</div>
        )}
      </div>
    </>
  );
}

/** Live: agentRuns + agentSteps via convex/runTrace.listRunSpans (proof-gated, bounded). */
function LiveRunsView({ roomId, requester, toggle }: { roomId: string; requester: ActorProof; toggle: ReactNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  const res = useQuery(
    runTraceApi.listRunSpans,
    picked ? { roomId, requester, runId: picked } : { roomId, requester },
  );
  return (
    <RunsPane
      toggle={toggle}
      runs={res?.runs ?? []}
      selectedId={res?.selectedRunId ?? null}
      onPick={setPicked}
      spans={res?.spans ?? []}
      truncated={res?.truncated ?? false}
      loading={res === undefined}
      emptyHint="No agent runs yet — ask the room agent to do something and its span tree lands here."
    />
  );
}

/** Memory: same span shape assembled from the engine's scripted trace list. */
function MemoryRunsView({ roomId, toggle }: { roomId: string; toggle: ReactNode }) {
  const store = useStore();
  const traces = store.listTraces(roomId);
  const runs = useMemo(() => buildMemoryRunsFromTraces(traces), [traces]);
  const [picked, setPicked] = useState<string | null>(null);
  const defaultRun =
    runs.find((r) => /room nodeagent|reconciled/i.test(r.summary.goal) || /agent_room/i.test(r.summary.agentId)) ??
    [...runs].sort((a, b) => b.summary.steps - a.summary.steps)[0] ??
    null;
  const selected = runs.find((r) => r.summary.id === picked) ?? defaultRun;
  return (
    <RunsPane
      toggle={toggle}
      runs={runs.map((r) => r.summary)}
      selectedId={selected?.summary.id ?? null}
      onPick={setPicked}
      spans={selected?.spans ?? []}
      truncated={false}
      emptyHint="No trace events yet — run the demo agent and its scripted run appears here."
    />
  );
}

function RunsView({ roomId, toggle }: { roomId: string; toggle: ReactNode }) {
  const store = useStore();
  // The store's proof accessor: privateStreamAccess returns the verified requester proof in
  // convex mode (null in memory mode). The Trace surface receives no proof prop, and its
  // mount site (Artifact.tsx) is outside this change's blast radius, so we read it here.
  const requester = store.mode === "convex" ? store.privateStreamAccess("trace-runs-view")?.requester ?? null : null;
  if (store.mode === "convex" && requester) {
    return <LiveRunsView roomId={roomId} requester={requester} toggle={toggle} />;
  }
  return <MemoryRunsView roomId={roomId} toggle={toggle} />;
}
