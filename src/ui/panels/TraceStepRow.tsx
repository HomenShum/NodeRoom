/**
 * StepRow — the canonical rich render of a single trace step: label + Δ(flicker) badges, source-link
 * affordance, screenshot(s) with the normalized highlight box overlay, log blocks, and metrics.
 * Shared by the Steps list (TraceSurface) and the Flow node-detail (TraceFlow) so clicking a graph
 * node pops the SAME full preview you'd see in the linear list — one component, no drift.
 */
import { ArrowUpRight } from "lucide-react";
import type { TraceStep, TraceAttachment } from "./traceData";

export function StepRow({ s, onOpenSource }: { s: TraceStep; onOpenSource: (artifactId: string, elementId?: string) => void }) {
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
