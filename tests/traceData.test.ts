import { describe, it, expect } from "vitest";
import { buildAgentTraceRecords, QA_TRACE_RECORD } from "../src/ui/panels/traceData";
import type { EvidenceCardArtifact } from "../src/ui/bankerCoachPacket";

const card = (over: Partial<EvidenceCardArtifact>): EvidenceCardArtifact =>
  ({ id: "c", label: "Funding", sourceRef: "ref", quote: "q", kind: "source", confidence: 0.8, status: "verified", ...over }) as EvidenceCardArtifact;

const readiness = (o: Partial<{ verified: number; needsReview: number; manual: number; estimated: number; readyForClientUse: boolean }> = {}) =>
  ({ verified: 0, needsReview: 0, manual: 0, estimated: 0, readyForClientUse: false, ...o });

describe("trace data", () => {
  it("the QA happy-path record is a real floor run: 3 surface steps with screenshots + a SHIP verdict", () => {
    expect(QA_TRACE_RECORD.kind).toBe("qa");
    expect(QA_TRACE_RECORD.verdict?.tone).toBe("ok");
    expect(QA_TRACE_RECORD.steps).toHaveLength(3);
    expect(QA_TRACE_RECORD.steps.every((s) => s.screenshotUrl?.startsWith("/qa-trace/"))).toBe(true);
    expect(QA_TRACE_RECORD.steps.every((s) => (s.metrics?.length ?? 0) > 0)).toBe(true);
  });

  it("builds one agent record: evidence kinds → AI/Human attribution; cards → source-linked steps", () => {
    const cards = [
      card({ id: "a", kind: "source", targetArtifactId: "art1", targetElementId: "e1" }),
      card({ id: "b", kind: "computed", targetArtifactId: "art1", targetElementId: "e2" }),
      card({ id: "c", kind: "manual", status: "needs_review" }),
      card({ id: "d", kind: "upload" }),
    ];
    const recs = buildAgentTraceRecords({
      company: "CardioNova",
      claim: "diligence",
      packet: { evidenceCards: cards, readiness: readiness({ verified: 2, needsReview: 1, manual: 1 }) },
      traces: [],
      run: null,
    });
    expect(recs).toHaveLength(1);
    const r = recs[0];
    // source + computed → AI; manual + upload → Human (honest, evidence-level, not per-line code attribution).
    expect(r.attribution).toEqual({ ai: 2, mixed: 0, human: 2 });
    expect(r.steps).toHaveLength(4);
    expect(r.steps[0].targetArtifactId).toBe("art1");
    expect(r.steps[0].targetElementId).toBe("e1");
    expect(r.verdict?.tone).toBe("warn"); // not ready → review
  });

  it("returns no agent record when the room has no source-backed evidence", () => {
    const recs = buildAgentTraceRecords({
      company: "X", claim: "y",
      packet: { evidenceCards: [], readiness: readiness({ readyForClientUse: true }) },
      traces: [], run: null,
    });
    expect(recs).toHaveLength(0);
  });
});
