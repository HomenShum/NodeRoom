export const NODE_ROOM_OKF_TYPES = [
  "Room",
  "Company",
  "Person",
  "Opportunity",
  "Interaction",
  "Source",
  "Spreadsheet",
  "Spreadsheet Cell",
  "Metric",
  "Formula",
  "Algorithm",
  "Chart",
  "Report",
  "Coach Cue",
  "Review Round",
  "Task",
  "Agent Trace",
  "Eval Result",
  "Downstream Draft",
  "Workflow",
  "Playbook",
] as const;

export type NodeRoomOkfType = (typeof NODE_ROOM_OKF_TYPES)[number] | (string & {});
export type OkfVisibility = "public" | "private" | "redacted";

export interface OkfNodeRoomExtension {
  roomId?: string;
  artifactId?: string;
  elementId?: string;
  status?: "empty" | "running" | "complete" | "needs_review" | "failed" | "gap" | string;
  confidence?: number;
  sourceKind?: "upload" | "source" | "computed" | "manual" | string;
  visibility?: OkfVisibility;
  targetRefs?: string[];
}

export interface OkfFrontmatter {
  type: NodeRoomOkfType;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  visibility?: OkfVisibility;
  noderoom?: OkfNodeRoomExtension;
  [key: string]: unknown;
}

export interface OkfLink {
  label: string;
  target: string;
  conceptId?: string;
}

export interface OkfCitation {
  id: string;
  label: string;
  target: string;
  conceptId?: string;
}

export interface OkfConcept {
  id: string;
  path: string;
  frontmatter: OkfFrontmatter;
  body: string;
  links: OkfLink[];
  citations: OkfCitation[];
  raw?: string;
}

export interface OkfBundleFile {
  path: string;
  content: string;
}

