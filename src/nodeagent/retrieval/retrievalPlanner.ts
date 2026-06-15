export type RetrievalStep =
  | { tool: "okf_semantic_search"; query: string }
  | { tool: "okf_full_text_search"; query: string }
  | { tool: "okf_filter"; type?: string; tags?: string[]; status?: string }
  | { tool: "source_resolve_citation"; evidenceId: string };

export function planOkfRetrieval(goal: string): RetrievalStep[] {
  const lower = goal.toLowerCase();
  const tags = lower.includes("runway") ? ["runway"] : lower.includes("variance") ? ["variance"] : undefined;
  return [
    { tool: "okf_semantic_search", query: goal },
    { tool: "okf_full_text_search", query: goal },
    { tool: "okf_filter", tags },
  ];
}

