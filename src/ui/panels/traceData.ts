/**
 * Trace surface data model. Two record kinds share one shape:
 *  - "agent": source-backed claims the NodeAgent wrote in THIS room (from the coach packet's
 *    evidence cards) — each step links to the exact cell + its literal source (LlamaIndex/extendUI).
 *  - "qa": a real run of our OWN design-QA floor (scripts/design-qa/floor.ts) — per-surface
 *    screenshots + metrics + verdict. This is the "QA of our own app" happy path.
 */
import type { BankerCoachPacket, EvidenceCardArtifact } from "../bankerCoachPacket";
import type { TraceEvent } from "../../engine/types";
import type { AgentRunTelemetry } from "../../app/store";
import type { NormBox } from "../../nodeagent/capture/types";
import type { RefutationVerdict } from "../traceLens/types";
export type { NormBox, RefutationVerdict };

export type TraceTone = "ok" | "warn" | "risk" | "info";

/** Per-step artifact a QA-automation run attaches (screenshot / log / SSIM-flicker diff / PDF citation).
 *  `box` is the normalized (0..1) region acted on — e.g. the element clicked, or the SEC/EDGAR
 *  cell the value was extracted from — drawn as a highlight over the screenshot (LlamaIndex bbox).
 *
 *  Screenshot/PDF attachments carry a storage id for lazy URL resolution: the lightweight `byRoom`
 *  list returns `screenshotId`/`pdfStorageId` (no `getUrl`); `captureDetail` resolves `url` for the
 *  selected record only. `url` is absent until the detail is fetched — renderers must handle that. */
export type TraceAttachment =
  | { kind: "screenshot"; url?: string; label?: string; box?: NormBox }
  | { kind: "ssim"; url?: string; diffRatio: number; label?: string }
  | { kind: "log"; text: string; label?: string }
  | { kind: "pdf"; url?: string; page: number; boxes: NormBox[]; label?: string };

export interface TraceStep {
  idx: number;
  label: string;
  detail?: string;
  status: TraceTone;
  /** Collapsible section (phase / spec / status) — keeps hundreds of steps navigable. */
  group?: string;
  /** When present, the step opens this cell on the work surface (split + pulse). */
  targetArtifactId?: string;
  targetElementId?: string;
  /** QA steps carry a captured screenshot (served from /public/qa-trace) + metrics. */
  screenshotUrl?: string;
  metrics?: { label: string; value: string }[];
  /** Pipeline-fed evidence: screenshots, logs, SSIM flicker diffs. */
  attachments?: TraceAttachment[];
}

/** Client-side cap on rendered steps (BOUND rule). Beyond this, paginate/lazy-load from the server. */
export const MAX_TRACE_STEPS = 500;

export interface TraceRecord {
  id: string;
  kind: "agent" | "qa";
  title: string;
  subtitle: string;
  ts: string;
  source: { tool: string; version?: string; env?: string; model?: string };
  verdict?: { label: string; tone: TraceTone };
  /** Honest provenance at the evidence level (NOT fabricated per-line code attribution). */
  attribution?: { ai: number; mixed: number; human: number };
  steps: TraceStep[];
  evidenceCards?: EvidenceCardArtifact[];
  /** Adversarial-refutation verdicts on the claims this record carries. Independent verifier in a
   *  fresh context window tried to refute each claim — the surviving + overturned + uncertain
   *  verdicts ALL persist here (failures are evidence, not blemishes). Tekton pattern. */
  refutations?: RefutationVerdict[];
  raw: unknown;
}

/**
 * A REAL run of scripts/design-qa/floor.ts captured 2026-06-17 (P0=0 P1=0 P2=0 → SHIP).
 * The screenshots are the floor's actual output, copied to /public/qa-trace. Refresh by re-running
 * the floor and re-copying the PNGs; the metrics below are this run's real stdout.
 */
export const QA_TRACE_RECORD: TraceRecord = {
  id: "qa-design-floor",
  kind: "qa",
  title: "QA · NodeRoom design floor",
  subtitle: "Playwright visual + design-token sweep across 3 surfaces (scripts/design-qa/floor.ts)",
  ts: "Jun 17, 12:08 AM",
  source: { tool: "Playwright", version: "design-qa/floor.ts", env: "chromium · DPR 2 · reduced-motion" },
  verdict: { label: "SHIP — P0 0 · P1 0 · P2 0", tone: "ok" },
  steps: [
    {
      idx: 1, label: "demo-room-desktop · 1440×900", status: "ok", screenshotUrl: "/qa-trace/demo-room-desktop.png",
      metrics: [{ label: "scanned", value: "117" }, { label: "overflow", value: "0px" }, { label: "contrast fails", value: "0" }, { label: "off-token", value: "0" }, { label: "tabular-nums", value: "yes" }],
    },
    {
      idx: 2, label: "demo-room-mobile · 375×812", status: "ok", screenshotUrl: "/qa-trace/demo-room-mobile.png",
      metrics: [{ label: "scanned", value: "106" }, { label: "overflow", value: "0px" }, { label: "contrast fails", value: "0" }, { label: "off-token", value: "0" }, { label: "tabular-nums", value: "yes" }],
    },
    {
      idx: 3, label: "blank-room · 1280×860", status: "ok", screenshotUrl: "/qa-trace/blank-room.png",
      metrics: [{ label: "scanned", value: "19" }, { label: "overflow", value: "0px" }, { label: "contrast fails", value: "0" }, { label: "off-token", value: "0" }, { label: "tabular-nums", value: "n/a" }],
    },
  ],
  raw: {
    generatedAt: "2026-06-17T00:08:09.579Z",
    base: "http://localhost:5301",
    shipBarMet: true,
    counts: { P0: 0, P1: 0, P2: 0 },
    surfaces: [
      { name: "demo-room-desktop", viewport: "1440x900", scanned: 117, overflowPx: 0, contrastFails: 0, offToken: 0, tabularNums: true },
      { name: "demo-room-mobile", viewport: "375x812", scanned: 106, overflowPx: 0, contrastFails: 0, offToken: 0, tabularNums: true },
      { name: "blank-room", viewport: "1280x860", scanned: 19, overflowPx: 0, contrastFails: 0, offToken: 0, tabularNums: false },
    ],
    findings: [],
  },
  refutations: [
    {
      claimId: "ship-bar",
      claim: "Ship bar met: P0 = 0, P1 = 0, P2 = 0 across all surfaces.",
      verdict: "stands",
      confidence: 0.96,
      reasoning: "Re-counted from raw.counts in fresh context: P0=0 P1=0 P2=0. Three surfaces all show overflowPx=0 and contrastFails=0; no per-surface override changes the totals.",
      refutedBy: "Independent verifier · fresh context",
      refutedAt: "2026-06-17T00:09:14Z",
    },
    {
      claimId: "tabular-nums-universal",
      claim: "All scanned surfaces render numbers with tabular-nums.",
      verdict: "refuted",
      confidence: 0.92,
      correctedValue: "2 of 3 surfaces use tabular-nums; blank-room reports n/a (no numeric grids on the surface).",
      reasoning: "raw.surfaces[2] (blank-room) has tabularNums: false. The original phrasing implies universality, which the data does not support — though it is not a regression because blank-room has no tabular grid to opt into.",
      refutedBy: "Independent verifier · fresh context",
      refutedAt: "2026-06-17T00:09:18Z",
    },
    {
      claimId: "zero-contrast-fails",
      claim: "Zero contrast failures across desktop, mobile, and blank-room.",
      verdict: "stands",
      confidence: 0.94,
      reasoning: "All three raw.surfaces entries have contrastFails: 0; cross-checked against the screenshots referenced in steps[].screenshotUrl.",
      refutedBy: "Independent verifier · fresh context",
      refutedAt: "2026-06-17T00:09:20Z",
    },
    {
      claimId: "scanned-cells-total",
      claim: "Roughly 240 elements scanned across the floor run.",
      verdict: "uncertain",
      confidence: 0.55,
      reasoning: "Sum is 117 + 106 + 19 = 242, which IS approximately 240, but 'scanned' is element count, not cells. The claim conflates the two; cannot affirm without seeing the floor's scan-target definition.",
      refutedBy: "Independent verifier · fresh context",
      refutedAt: "2026-06-17T00:09:22Z",
    },
  ],
};

/** Producer-generated trace bundles (scripts/qa-trace/capture-flow.ts) auto-load here — drop a JSON, it appears. */
const bundleModules = import.meta.glob<{ default: TraceRecord }>("./qaTraceBundles/*.json", { eager: true });

/**
 * Bundles arrive as untyped JSON via `import.meta.glob`, so the TraceRecord type is NOT enforced at
 * build time. A single malformed drop-in must never be able to crash the whole Trace surface (the
 * list/detail renderers read `source.tool` and `ts` unconditionally). Skip any bundle missing the
 * minimal shape (id/title/steps[]) with a warning, and backfill the required `source`/`ts`/`subtitle`
 * fields so downstream code can rely on the shape.
 */
function normalizeBundle(rec: unknown, path: string): TraceRecord | null {
  const r = rec as Partial<TraceRecord> | undefined;
  if (!r || typeof r.id !== "string" || typeof r.title !== "string" || !Array.isArray(r.steps)) {
    console.warn(`[traceData] skipping malformed trace bundle "${path}": requires { id, title, steps[] }`);
    return null;
  }
  return {
    ...r,
    subtitle: r.subtitle ?? "",
    ts: r.ts ?? "",
    source: r.source ?? { tool: "NodeAgent" },
    raw: r.raw ?? {},
  } as TraceRecord;
}

export const QA_BUNDLES: TraceRecord[] = Object.entries(bundleModules)
  .map(([path, m]) => normalizeBundle(m?.default, path))
  .filter((r): r is TraceRecord => r !== null);

/** Build the live agent trace record from the room's source-backed claims (coach evidence). */
export function buildAgentTraceRecords(input: {
  company: string;
  claim: string;
  packet: Pick<BankerCoachPacket, "evidenceCards" | "readiness">;
  traces: TraceEvent[];
  run: AgentRunTelemetry | null;
}): TraceRecord[] {
  const { company, claim, packet, traces, run } = input;
  if (!packet.evidenceCards.length) return [];
  const steps: TraceStep[] = packet.evidenceCards.slice(0, MAX_TRACE_STEPS).map((c, i) => ({
    idx: i + 1,
    label: c.label,
    detail: c.quote,
    status: c.status === "verified" ? "ok" : c.status === "needs_review" ? "warn" : "info",
    group: c.status === "verified" ? "Verified" : c.status === "needs_review" ? "Needs review" : c.status === "manual" ? "Manual" : c.status === "estimated" ? "Estimated" : "Manual / estimated",
    targetArtifactId: c.targetArtifactId,
    targetElementId: c.targetElementId,
  }));
  let ai = 0, human = 0, mixed = 0;
  for (const c of packet.evidenceCards) {
    if (c.kind === "manual" || c.kind === "upload") human++;
    else if (c.kind === "source" || c.kind === "computed") ai++;
    else mixed++;
  }
  const needsReview = packet.readiness.needsReview + packet.readiness.manual + packet.readiness.estimated;
  return [{
    id: "agent-room-diligence",
    kind: "agent",
    title: `Agent · ${company} diligence`,
    subtitle: claim,
    ts: "live · this room",
    source: { tool: "NodeAgent", model: run?.model ?? "adaptive", env: "room" },
    verdict: packet.readiness.readyForClientUse ? { label: "verified", tone: "ok" } : { label: `${needsReview} to review`, tone: "warn" },
    attribution: { ai, mixed, human },
    steps,
    evidenceCards: packet.evidenceCards,
    raw: {
      readiness: packet.readiness,
      traceEvents: traces.slice(-20).map((t) => ({ ts: t.ts, type: t.type, actor: t.actor.name, summary: t.summary })),
    },
  }];
}
