import type { NotebookArtifactStructure, NotebookBlockDigest } from "./notebookStructure";

export type NotebookTypedBlockKind =
  | "text"
  | "insight"
  | "table"
  | "chart"
  | "calculation"
  | "sql"
  | "evidence"
  | "decision"
  | "open_question"
  | "agent_proposal";

export interface NotebookTypedBlock {
  id: string;
  blockId: string;
  elementId: string;
  index: number;
  type: NotebookTypedBlockKind;
  confidence: number;
  reasons: string[];
}

export interface NotebookTypedBlockSummary {
  total: number;
  counts: Partial<Record<NotebookTypedBlockKind, number>>;
  reviewCount: number;
  sourceBackedCount: number;
  agentAuthoredCount: number;
}

const TYPE_ORDER: NotebookTypedBlockKind[] = [
  "agent_proposal",
  "open_question",
  "decision",
  "evidence",
  "calculation",
  "sql",
  "table",
  "chart",
  "insight",
  "text",
];

function score(block: NotebookBlockDigest): Array<{ type: NotebookTypedBlockKind; points: number; reason: string }> {
  const text = block.text.toLowerCase();
  const rows: Array<{ type: NotebookTypedBlockKind; points: number; reason: string }> = [];
  if (block.proposalIds.length > 0 || (block.role === "agent" && block.status === "needs_review")) rows.push({ type: "agent_proposal", points: 6, reason: "proposal_or_agent_review" });
  if (/\b(open question|question|unknown|todo|tbd|missing|gap|needs source|needs review)\b/.test(text) || /\?$/.test(block.text.trim())) rows.push({ type: "open_question", points: 5, reason: "question_or_gap_language" });
  if (/\b(decision|approved|rejected|recommend|go\/no-go|chosen|accepted)\b/.test(text)) rows.push({ type: "decision", points: 5, reason: "decision_language" });
  if (block.sourceIds.length > 0 || /\b(source|citation|evidence|cited|transcript|memo|filing|url)\b/.test(text) || /https?:\/\//.test(text)) rows.push({ type: "evidence", points: 5, reason: "source_reference" });
  if (/\b(runway|cash|burn|margin|variance|growth|ratio|calculation|formula)\b/.test(text) || /(?:\d+(?:\.\d+)?\s*[%x/+-])|(?:[$]\s?\d)/.test(block.text)) rows.push({ type: "calculation", points: 4, reason: "numeric_or_formula_language" });
  if (/\bselect\b[\s\S]+\bfrom\b/.test(text)) rows.push({ type: "sql", points: 5, reason: "sql_query" });
  if (/\|.+\|/.test(block.text) || /\t/.test(block.text)) rows.push({ type: "table", points: 4, reason: "tabular_text" });
  if (/\b(chart|graph|plot|axis|series|trendline|visualize)\b/.test(text)) rows.push({ type: "chart", points: 3, reason: "chart_language" });
  if (block.role === "agent" || /\b(claim|finding|signal|insight|thesis|risk|opportunity)\b/.test(text)) rows.push({ type: "insight", points: 3, reason: "insight_language" });
  rows.push({ type: "text", points: 1, reason: "default_text" });
  return rows;
}

export function classifyNotebookTypedBlock(block: NotebookBlockDigest): NotebookTypedBlock {
  const ranked = score(block).sort((a, b) => b.points - a.points || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const best = ranked[0];
  const reasons = ranked.filter((item) => item.type === best.type || item.points >= 5).map((item) => item.reason);
  return {
    id: block.id,
    blockId: block.blockId ?? block.id,
    elementId: block.elementId,
    index: block.index,
    type: best.type,
    confidence: Math.min(1, best.points / 6),
    reasons: [...new Set(reasons)],
  };
}

export function classifyNotebookTypedBlocks(structure: NotebookArtifactStructure): NotebookTypedBlock[] {
  return structure.blocks.map(classifyNotebookTypedBlock);
}

export function summarizeNotebookTypedBlocks(structure: NotebookArtifactStructure): NotebookTypedBlockSummary {
  const typed = classifyNotebookTypedBlocks(structure);
  const counts: Partial<Record<NotebookTypedBlockKind, number>> = {};
  for (const block of typed) counts[block.type] = (counts[block.type] ?? 0) + 1;
  return {
    total: typed.length,
    counts,
    reviewCount: structure.needsReviewCount,
    sourceBackedCount: structure.blocks.filter((block) => block.sourceIds.length > 0).length,
    agentAuthoredCount: structure.agentBlockCount,
  };
}
