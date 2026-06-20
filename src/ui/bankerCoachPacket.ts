import {
  buildEvidenceCards,
  generateBankerCoachCues,
  prepareReviewRoundUpdate,
  type BankerCoachCue,
  type EvidenceCard,
  type EvidenceCardInput,
  type EvidenceCardStatus,
  type ReviewRoundUpdate,
} from "../nodeagent/skills/bankerCoach/coachArtifacts";
import type { Artifact, CellEvidence, CellPayload, TraceEvent } from "../engine/types";
import type { DownstreamHandoffTarget } from "./downstreamHandoff";

export type EvidenceCardArtifact = EvidenceCard & {
  targetArtifactId?: string;
  targetElementId?: string;
  // The LITERAL source the evidence came from (not the claim cell): forwarded from CellEvidence so
  // the carousel can open the real file/page/row -- 6-15 deep-review's "literal source" requirement.
  sourceUrl?: string;
  sourceArtifactId?: string;
  sourceLocator?: { sheetName?: string; page?: number; row?: number; column?: string };
};

export interface RunwayMilestonePreview {
  id: string;
  company: string;
  cash: string;
  burn: string;
  runway: string;
  status: "verified" | "needs_review" | "gap";
  milestones: string[];
  sourceArtifactId: string;
  sourceCellIds: string[];
}

export interface DownstreamDryRunPreview {
  target: DownstreamHandoffTarget;
  label: string;
  status: "draft_only";
  sourceArtifactCount: number;
  approvalGate: string;
}

export interface BankerCoachReadiness {
  verified: number;
  needsReview: number;
  manual: number;
  estimated: number;
  readyForClientUse: boolean;
}

export interface BankerCoachPacket {
  roomTitle: string;
  company: string;
  claim: string;
  evidenceCards: EvidenceCardArtifact[];
  cues: BankerCoachCue[];
  reviewUpdate: ReviewRoundUpdate;
  runwayMilestones: RunwayMilestonePreview[];
  downstreamDrafts: DownstreamDryRunPreview[];
  readiness: BankerCoachReadiness;
}

const DOWNSTREAM_DRAFTS: ReadonlyArray<{ target: DownstreamHandoffTarget; label: string }> = [
  { target: "gmail", label: "Gmail" },
  { target: "notion", label: "Notion" },
  { target: "slack", label: "Slack" },
  { target: "linear", label: "Linear" },
  { target: "linkedin", label: "LinkedIn" },
  { target: "crm", label: "CRM CSV" },
] as const;

export function buildBankerCoachPacket(input: {
  roomTitle: string;
  artifacts: Artifact[];
  traces?: TraceEvent[];
}): BankerCoachPacket {
  const company = firstCompany(input.artifacts) ?? "Selected company";
  const claim = firstClaim(input.artifacts) ?? "Diligence packet pending source verification, runway assumptions, and review handoff.";
  const runwayMilestones = buildRunwayMilestones(input.artifacts);
  const runwayMonths = runwayMilestones.map((row) => parseRunwayMonths(row.runway)).find((value) => value !== undefined);
  const evidenceCards = buildCoachEvidenceCards(input.artifacts);
  const readiness = summarizeReadiness(evidenceCards);
  const cues = generateBankerCoachCues({
    company,
    claim,
    evidenceCards,
    runwayMonths,
    status: readiness.readyForClientUse ? "verified" : "needs_review",
  });
  const materialChanges = materialChangesFor({
    company,
    evidenceCards,
    runwayMilestones,
    traces: input.traces ?? [],
  });
  const reviewUpdate = prepareReviewRoundUpdate({
    roomTitle: input.roomTitle,
    company,
    materialChanges,
    openQuestions: openQuestionsFor(evidenceCards, runwayMilestones),
    nextActions: [
      "Reviewer accepts or rejects weak evidence cards.",
      "Runway assumptions are updated only from sourced cash and burn inputs.",
      "Downstream drafts remain draft-only until approval.",
    ],
    sourceRefs: evidenceCards.slice(0, 6).map((card) => card.sourceRef),
  });
  const downstreamDrafts = DOWNSTREAM_DRAFTS.map((draft) => ({
    ...draft,
    status: "draft_only" as const,
    sourceArtifactCount: input.artifacts.length,
    approvalGate: draft.target === "crm" ? "review before export" : "human approval before provider send",
  }));

  return {
    roomTitle: input.roomTitle,
    company,
    claim,
    evidenceCards,
    cues,
    reviewUpdate,
    runwayMilestones,
    downstreamDrafts,
    readiness,
  };
}

function buildCoachEvidenceCards(artifacts: Artifact[]): EvidenceCardArtifact[] {
  const inputs: EvidenceCardInput[] = [];
  const targets: Array<Pick<EvidenceCardArtifact, "targetArtifactId" | "targetElementId" | "sourceUrl" | "sourceArtifactId" | "sourceLocator">> = [];

  for (const artifact of artifacts) {
    for (const elementId of artifact.order) {
      const element = artifact.elements[elementId];
      const payload = cellPayload(element?.value);
      if (!payload?.evidence?.length) continue;
      for (const evidence of payload.evidence) {
        inputs.push(evidenceCardInputFor(artifact, elementId, payload, evidence));
        targets.push({
          targetArtifactId: artifact.id,
          targetElementId: elementId,
          sourceUrl: evidence.url,
          sourceArtifactId: evidence.sourceArtifactId,
          sourceLocator: (evidence.sheetName || evidence.page != null || evidence.row != null || evidence.column)
            ? { sheetName: evidence.sheetName, page: evidence.page, row: evidence.row, column: evidence.column }
            : undefined,
        });
        if (inputs.length >= 10) break;
      }
      if (inputs.length >= 10) break;
    }
    if (inputs.length >= 10) break;
  }

  if (!inputs.length) {
    for (const artifact of artifacts) {
      const fallback = fallbackEvidenceForArtifact(artifact);
      if (!fallback) continue;
      inputs.push(fallback.input);
      targets.push({ targetArtifactId: artifact.id });
      if (inputs.length >= 8) break;
    }
  }

  if (!inputs.length) {
    inputs.push({
      label: "Room evidence",
      sourceRef: "manual-room-claim",
      quote: "No source-backed diligence artifact has been created yet.",
      kind: "manual",
      confidence: 0.2,
      status: "manual",
    });
    targets.push({});
  }

  return buildEvidenceCards(inputs).map((card, index) => ({ ...card, ...targets[index] }));
}

function evidenceCardInputFor(
  artifact: Artifact,
  elementId: string,
  payload: CellPayload,
  evidence: CellEvidence,
): EvidenceCardInput {
  const value = plainText(payload.value);
  return {
    label: evidence.label || `${artifact.title} - ${elementId}`,
    sourceRef: evidence.url || evidence.source || evidence.sourceArtifactId || `${artifact.title}:${elementId}`,
    quote: evidence.snippet || value || `${artifact.title} ${elementId}`,
    kind: evidence.kind,
    confidence: evidence.confidence ?? payload.confidence ?? 0.72,
    status: statusFromPayload(payload, evidence),
  };
}

function fallbackEvidenceForArtifact(artifact: Artifact): { input: EvidenceCardInput } | null {
  const upload = artifact.meta?.upload;
  if (upload) {
    return {
      input: {
        label: artifact.title,
        sourceRef: upload.fileName,
        quote: `${upload.mimeType}, ${upload.size} bytes, parsed into ${artifact.order.length} item(s).`,
        kind: "upload",
        confidence: 0.68,
        status: "needs_review",
      },
    };
  }
  const provider = artifact.meta?.providerParse;
  if (provider) {
    return {
      input: {
        label: artifact.title,
        sourceRef: `${provider.provider}:${provider.model}`,
        quote: `Provider extraction recorded from ${provider.sourceStorageId}.`,
        kind: "source",
        confidence: 0.7,
        status: "needs_review",
      },
    };
  }
  const dataframe = artifact.meta?.dataframe;
  if (dataframe) {
    return {
      input: {
        label: artifact.title,
        sourceRef: dataframe.sourceFile ?? artifact.title,
        quote: `${dataframe.rowCount} row(s), ${dataframe.columns.length} column(s), parser ${dataframe.parser ?? "unknown"}.`,
        kind: "computed",
        confidence: 0.72,
        status: dataframe.warnings?.length ? "needs_review" : "estimated",
      },
    };
  }
  if (artifact.order.length) {
    return {
      input: {
        label: artifact.title,
        sourceRef: artifact.id,
        quote: `${artifact.kind} artifact with ${artifact.order.length} review item(s).`,
        kind: "manual",
        confidence: 0.55,
        status: "manual",
      },
    };
  }
  return null;
}

function buildRunwayMilestones(artifacts: Artifact[]): RunwayMilestonePreview[] {
  const runway = artifacts.find((artifact) => /runway|milestone/i.test(artifact.title));
  if (!runway) return [];
  return rowIds(runway).map((rowId) => {
    const runwayText = textAt(runway, rowId, "runway") || "Gap: runway not computed";
    const statusText = textAt(runway, rowId, "status");
    const status: RunwayMilestonePreview["status"] =
      /gap|unknown|needs/i.test(`${runwayText} ${statusText}`) ? "gap" : /review/i.test(statusText) ? "needs_review" : "verified";
    return {
      id: rowId,
      company: textAt(runway, rowId, "company") || rowId,
      cash: textAt(runway, rowId, "cash") || "Unknown",
      burn: textAt(runway, rowId, "burn") || "Unknown",
      runway: runwayText,
      status,
      milestones: splitMilestones(textAt(runway, rowId, "milestones")),
      sourceArtifactId: runway.id,
      sourceCellIds: ["cash", "burn", "runway", "status", "milestones"].map((col) => `${rowId}__${col}`),
    };
  });
}

function materialChangesFor(input: {
  company: string;
  evidenceCards: EvidenceCardArtifact[];
  runwayMilestones: RunwayMilestonePreview[];
  traces: TraceEvent[];
}): string[] {
  const latestTraces = input.traces
    .slice(-3)
    .map((trace) => trace.summary.trim())
    .filter(Boolean);
  const changes = [
    ...latestTraces,
    `${input.company} has ${input.evidenceCards.length} evidence card(s): ${input.evidenceCards.filter((card) => card.status === "verified").length} verified, ${input.evidenceCards.filter((card) => card.status !== "verified").length} requiring review.`,
  ];
  if (input.runwayMilestones.length) {
    changes.push(`${input.runwayMilestones.length} runway/milestone row(s) are visible, including ${input.runwayMilestones.filter((row) => row.status === "gap").length} gap row(s).`);
  }
  return changes.slice(0, 5);
}

function openQuestionsFor(cards: EvidenceCardArtifact[], runway: RunwayMilestonePreview[]): string[] {
  const questions: string[] = [];
  if (cards.some((card) => card.status !== "verified")) questions.push("Which weak evidence cards can be tied to a source artifact, upload row, or public source?");
  if (runway.some((row) => row.status === "gap")) questions.push("Which companies have sourced cash balance, burn, and milestone timing?");
  if (!questions.length) questions.push("Does the reviewer accept the current source trail for downstream use?");
  return questions;
}

function summarizeReadiness(cards: EvidenceCardArtifact[]): BankerCoachReadiness {
  const count = (status: EvidenceCardStatus) => cards.filter((card) => card.status === status).length;
  const verified = count("verified");
  const needsReview = count("needs_review");
  const manual = count("manual");
  const estimated = count("estimated");
  return {
    verified,
    needsReview,
    manual,
    estimated,
    readyForClientUse: cards.length > 0 && needsReview === 0 && manual === 0 && estimated === 0,
  };
}

function firstCompany(artifacts: Artifact[]): string | undefined {
  for (const artifact of artifacts) {
    for (const elementId of artifact.order) {
      if (!elementId.endsWith("__company")) continue;
      const value = plainText(cellValue(artifact.elements[elementId]?.value)).trim();
      if (value) return value;
    }
  }
  return undefined;
}

function firstClaim(artifacts: Artifact[]): string | undefined {
  for (const suffix of ["__summary", "__recent_signal", "__milestones"]) {
    for (const artifact of artifacts) {
      for (const elementId of artifact.order) {
        if (!elementId.endsWith(suffix)) continue;
        const value = plainText(cellValue(artifact.elements[elementId]?.value)).trim();
        if (value) return value;
      }
    }
  }
  const note = artifacts
    .filter((artifact) => artifact.kind === "note")
    .flatMap((artifact) => artifact.order.map((id) => plainText(cellValue(artifact.elements[id]?.value))))
    .map(stripHtml)
    .find((text) => text.length > 20);
  return note?.slice(0, 220);
}

function textAt(artifact: Artifact, rowId: string, col: string): string {
  return plainText(cellValue(artifact.elements[`${rowId}__${col}`]?.value)).trim();
}

function rowIds(artifact: Artifact): string[] {
  const rows: string[] = [];
  for (const id of artifact.order) {
    const [row] = id.split("__");
    if (row && !rows.includes(row)) rows.push(row);
  }
  return rows;
}

function splitMilestones(value: string): string[] {
  return value.split(/[;\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 5);
}

function parseRunwayMonths(value: string): number | undefined {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*(?:month|mo\b)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function statusFromPayload(payload: CellPayload, evidence: CellEvidence): EvidenceCardStatus {
  if (payload.status === "needs_review" || payload.status === "gap" || payload.status === "failed") return "needs_review";
  if (evidence.kind === "manual") return "manual";
  const confidence = evidence.confidence ?? payload.confidence ?? 0.72;
  return confidence >= 0.75 ? "verified" : "needs_review";
}

function cellPayload(value: unknown): CellPayload | null {
  if (!isRecord(value)) return null;
  if (!("value" in value)) return null;
  if ("status" in value || "evidence" in value || "confidence" in value || "formula" in value || "normalizedValue" in value) return value as unknown as CellPayload;
  return null;
}

function cellValue(value: unknown): unknown {
  return cellPayload(value)?.value ?? value;
}

function plainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
