import { z } from "zod";
import type { AgentTool } from "../../core/types";
import { computeRunway, runwayChartSvg } from "../finance/runwayForecaster";
import { validateChartDataAgainstCells } from "../finance/chartValidator";
import { createDiligenceDownstreamDrafts, type DiligenceDownstreamDestination } from "../integration/downstreamPublish";
import { recordNodeRoomAnalyticsEvent } from "../../analytics/coachEvents";
import { buildEvidenceCards, generateBankerCoachCues, prepareReviewRoundUpdate } from "./coachArtifacts";

const evidenceInputSchema = z.object({
  label: z.string(),
  sourceRef: z.string().optional(),
  quote: z.string().optional(),
  kind: z.enum(["source", "upload", "computed", "manual"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["verified", "needs_review", "manual", "estimated"]).optional(),
});

const chartPointSchema = z.object({
  label: z.string(),
  value: z.number(),
  sourceRef: z.string().optional(),
  estimated: z.boolean().optional(),
});

const downstreamDestinationSchema = z.enum(["gmail", "notion", "slack", "linear", "linkedin", "crm_csv"]);

export const BANKER_COACH_TOOLS: AgentTool[] = [
  {
    name: "build_evidence_cards",
    description: "Turn CellPayload/source/manual evidence into reviewable evidence cards with explicit verified/manual/estimated/needs_review status. Use before coach cues or review updates.",
    schema: z.object({ evidence: z.array(evidenceInputSchema).min(1) }),
    execute: async (a: { evidence: z.infer<typeof evidenceInputSchema>[] }) => {
      const cards = buildEvidenceCards(a.evidence);
      recordCoachEvent("evidence_cards_built", "build_evidence_cards", { cards: cards.length });
      return { cards };
    },
  },
  {
    name: "compute_runway_milestones",
    description: "Compute startup runway and milestone timing deterministically from sourced cash and burn inputs. Returns the runway result plus an embeddable SVG chart; never invent inputs.",
    schema: z.object({
      company: z.string(),
      cashUsd: z.number(),
      monthlyBurnUsd: z.number(),
      momGrowthRate: z.number().optional(),
      source: z.string().optional(),
    }),
    execute: async (a: { company: string; cashUsd: number; monthlyBurnUsd: number; momGrowthRate?: number; source?: string }) => {
      const runway = computeRunway(a);
      recordCoachEvent("runway_milestones_computed", "compute_runway_milestones", { assumptions: runway.assumptions.length }, { company: a.company, runwayMonths: runway.runwayMonths });
      return {
        runway,
        chartSvg: runwayChartSvg(runway),
        sourceRefs: runway.assumptions.map((assumption) => assumption.source),
      };
    },
  },
  {
    name: "validate_chart_against_source_cells",
    description: "Validate that every chart point ties to a source cell value or is explicitly marked estimated. Use before rendering banker-facing chart artifacts.",
    schema: z.object({
      sourceCells: z.record(z.string(), z.number()),
      series: z.array(chartPointSchema).min(1),
      tolerance: z.number().optional(),
    }),
    execute: async (a: { sourceCells: Record<string, number>; series: z.infer<typeof chartPointSchema>[]; tolerance?: number }) => {
      const result = validateChartDataAgainstCells(a.sourceCells, a.series, { tolerance: a.tolerance });
      recordCoachEvent("chart_validation_completed", "validate_chart_against_source_cells", { points: result.checked, issues: result.mismatches.length + result.unsourced.length }, { valid: result.ok });
      return result;
    },
  },
  {
    name: "render_chart_artifact",
    description: "Wrap a validated chart SVG into a note-artifact patch object. This returns an artifact seed only; commit it through the room artifact path or write the HTML into a reviewed note.",
    schema: z.object({
      title: z.string(),
      chartSvg: z.string(),
      narrative: z.string().optional(),
      sourceRefs: z.array(z.string()).optional(),
    }),
    execute: async (a: { title: string; chartSvg: string; narrative?: string; sourceRefs?: string[] }) => {
      recordCoachEvent("chart_artifact_rendered", "render_chart_artifact", { sourceRefs: a.sourceRefs?.length ?? 0 }, { title: a.title });
      return {
        artifactPatch: {
          kind: "note",
          title: a.title,
          seed: [{
            id: "doc",
            value: [
              `<h1>${escapeHtml(a.title)}</h1>`,
              a.narrative ? `<p>${escapeHtml(a.narrative)}</p>` : "",
              a.chartSvg,
              a.sourceRefs?.length ? `<p class="wiki-sources">Sources: ${a.sourceRefs.map(escapeHtml).join(", ")}</p>` : "",
            ].filter(Boolean).join(""),
          }],
        },
      };
    },
  },
  {
    name: "generate_banker_coach_cues",
    description: "Generate banker review cues from a claim, evidence cards, runway status, and review state. Produces what to verify, what is risky, and a talk track.",
    schema: z.object({
      company: z.string(),
      claim: z.string(),
      evidenceCards: z.array(z.object({
        id: z.string(),
        label: z.string(),
        sourceRef: z.string(),
        quote: z.string(),
        kind: z.enum(["source", "upload", "computed", "manual"]),
        confidence: z.number(),
        status: z.enum(["verified", "needs_review", "manual", "estimated"]),
        reviewNote: z.string().optional(),
      })),
      runwayMonths: z.number().optional(),
      status: z.string().optional(),
    }),
    execute: async (a: Parameters<typeof generateBankerCoachCues>[0]) => {
      const cues = generateBankerCoachCues(a);
      recordCoachEvent("coach_cue_created", "generate_banker_coach_cues", { cues: cues.length, evidenceCards: a.evidenceCards.length }, { company: a.company });
      return { cues };
    },
  },
  {
    name: "create_review_round_update",
    description: "Create a senior/client-readable review-round update from material changes, open questions, next actions, and source refs.",
    schema: z.object({
      roomTitle: z.string(),
      company: z.string().optional(),
      materialChanges: z.array(z.string()).min(1),
      openQuestions: z.array(z.string()).optional(),
      nextActions: z.array(z.string()).optional(),
      sourceRefs: z.array(z.string()).optional(),
    }),
    execute: async (a: Parameters<typeof prepareReviewRoundUpdate>[0]) => {
      const update = prepareReviewRoundUpdate(a);
      recordCoachEvent("review_round_prepared", "create_review_round_update", { materialChanges: a.materialChanges.length, sourceRefs: a.sourceRefs?.length ?? 0 }, { company: a.company ?? null });
      return update;
    },
  },
  {
    name: "export_downstream_draft",
    description: "Prepare approval-gated downstream drafts for Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV. No external provider write is performed.",
    schema: z.object({
      artifact: z.object({
        id: z.string(),
        title: z.string(),
        kind: z.string(),
        body: z.string(),
        sourceArtifactIds: z.array(z.string()),
        sourceUrls: z.array(z.string()),
        createdAt: z.number().optional(),
      }),
      destinations: z.array(downstreamDestinationSchema).optional(),
    }),
    execute: async (a: {
      artifact: { id: string; title: string; kind: string; body: string; sourceArtifactIds: string[]; sourceUrls: string[]; createdAt?: number };
      destinations?: DiligenceDownstreamDestination[];
    }) => {
      const drafts = createDiligenceDownstreamDrafts(
        { ...a.artifact, createdAt: a.artifact.createdAt ?? Date.now() },
        a.destinations,
      );
      recordCoachEvent("downstream_draft_prepared", "export_downstream_draft", { drafts: drafts.length, sourceArtifacts: a.artifact.sourceArtifactIds.length }, { artifactKind: a.artifact.kind });
      return { drafts };
    },
  },
];

function recordCoachEvent(
  type: Parameters<typeof recordNodeRoomAnalyticsEvent>[0]["type"],
  toolName: string,
  counts?: Record<string, number>,
  metadata?: Record<string, string | number | boolean | null>,
): void {
  recordNodeRoomAnalyticsEvent({ type, toolName, counts, metadata });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
