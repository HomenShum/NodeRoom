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
  "Agent Skill",
] as const;

export type NodeRoomOkfType = (typeof NODE_ROOM_OKF_TYPES)[number] | (string & {});
export type OkfVisibility = "public" | "private" | "redacted";

export interface OkfNodeRoomExtension {
  roomId?: string;
  artifactId?: string;
  elementId?: string;
  /** Owner member id for private OKF concepts. Public/redacted concepts omit this. */
  ownerId?: string;
  status?: "empty" | "running" | "complete" | "needs_review" | "failed" | "gap" | string;
  confidence?: number;
  sourceKind?: "upload" | "source" | "computed" | "manual" | string;
  visibility?: OkfVisibility;
  targetRefs?: string[];
  promotedFromConceptId?: string;
  promotedBy?: string;
  promotedAt?: string;
  /* ── Agent Skill extension (type "Agent Skill") — all optional, used by skill RAG.
   *  See docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md + src/nodeagent/okf/skillCatalog/format.md. */
  /** Where load_skill fetches the SKILL.md body from (local install dir or remote raw URL). */
  skill_install?: string;
  /** Trust tier — gates execution. Maps to confidence (local 1.0 / verified .95 / community .6 / untrusted .3). */
  skill_trust?: "local" | "verified" | "community" | "untrusted";
  /** Skill categories (also mirrored into frontmatter.tags). */
  skill_categories?: string[];
  /** SKILL.md version, if declared in its frontmatter. */
  skill_version?: string;
  /** The catalog this skill record came from (e.g. "awesome-claude-skills", "local"). */
  skill_source_catalog?: string;
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
