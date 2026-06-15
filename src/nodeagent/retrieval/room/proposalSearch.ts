export interface ProposalSearchFilter {
  status?: "pending" | "approved" | "rejected";
  targetRef?: string;
}

export function proposalSearchDescription(filter: ProposalSearchFilter): string {
  return `proposal_search status=${filter.status ?? "any"} target=${filter.targetRef ?? "any"}`;
}

