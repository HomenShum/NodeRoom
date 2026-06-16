import type { SurfaceMeta } from "./types";

/**
 * Client-safe surface registry: opaque id -> banker-facing label + description ONLY.
 * Code provenance (files/queries/mutations/skills) lives SERVER-SIDE (convex/traceLens, gated by
 * requireBuilder) and is never bundled here. See types.ts security note.
 */
export const SURFACES: Record<string, SurfaceMeta> = {
  // Work surface
  "workSurface.sheet": { id: "workSurface.sheet", label: "Spreadsheet", proofAvailable: true, about: "The shared financial grid. Agent-filled cells carry source evidence, status, and version." },
  "workSurface.genericSheet": { id: "workSurface.genericSheet", label: "Table", proofAvailable: false, about: "An uploaded or generic table view." },
  "workSurface.excelGridSheet": { id: "workSurface.excelGridSheet", label: "Excel grid", proofAvailable: true, about: "An uploaded .xlsx rendered as an Excel-style grid; cells keep coordinates and evidence." },
  "workSurface.research": { id: "workSurface.research", label: "Company research", proofAvailable: true, about: "Diligence rows enriched by the agent, each backed by sources and a freshness signal." },
  "workSurface.note": { id: "workSurface.note", label: "Note", proofAvailable: false, about: "A shared rich-text note artifact." },
  "workSurface.wall": { id: "workSurface.wall", label: "Wall", proofAvailable: false, about: "A sticky-note canvas for risks and open questions." },
  "workSurface.wiki": { id: "workSurface.wiki", label: "Room wiki", proofAvailable: false, about: "The room index: every artifact, session, and recent activity." },
  "workSurface.traceStrip": { id: "workSurface.traceStrip", label: "Room trace", proofAvailable: true, about: "The activity log of agent runs, tool calls, and proposals on this artifact." },
  "workSurface.evidenceCarousel": { id: "workSurface.evidenceCarousel", label: "Evidence", proofAvailable: true, about: "Source-backed evidence cards; each opens the literal source at its locator." },
  "workSurface.bankerCoachPanel": { id: "workSurface.bankerCoachPanel", label: "Banker coach", proofAvailable: true, about: "What to pull, what's weak, what to say -- with evidence and review state." },
  "workSurface.coachCards": { id: "workSurface.coachCards", label: "Coach cues", proofAvailable: true, about: "Actionable coach cues, each clicking through to the cell it concerns." },
  // Copilot
  "copilot.publicChat": { id: "copilot.publicChat", label: "Room chat", proofAvailable: false, about: "The shared conversation with the room agent." },
  "copilot.privateChat": { id: "copilot.privateChat", label: "Private chat", proofAvailable: false, about: "Your private NodeAgent lane; output stays yours until you promote it." },
  "copilot.coachTab": { id: "copilot.coachTab", label: "Banker coach", proofAvailable: true, about: "The coach as a secondary tab: Evidence, Coach, Review, Handoff." },
  "copilot.coachEvidence": { id: "copilot.coachEvidence", label: "Evidence", proofAvailable: true, about: "Source-backed evidence cards in the coach tab." },
  "copilot.coachCues": { id: "copilot.coachCues", label: "Coach cues", proofAvailable: true, about: "Coach cues in the coach tab." },
  "copilot.coachReview": { id: "copilot.coachReview", label: "Review round", proofAvailable: true, about: "What changed, what's risky, and the draft review update." },
  "copilot.coachHandoff": { id: "copilot.coachHandoff", label: "Handoff", proofAvailable: false, about: "Approval-gated downstream draft handoffs (Gmail, Slack, Notion, Linear, CRM)." },
  "copilot.chatBubble": { id: "copilot.chatBubble", label: "Message", proofAvailable: false, about: "A single chat message; agent claims link to their evidence." },
  "copilot.agentOperationStream": { id: "copilot.agentOperationStream", label: "Agent operations", proofAvailable: true, about: "The live stream of the agent's tool calls and commits this run." },
  "copilot.jobControls": { id: "copilot.jobControls", label: "Job controls", proofAvailable: false, about: "Cancel / retry controls for a long-running agent job." },
  "copilot.downstreamHandoff": { id: "copilot.downstreamHandoff", label: "Handoff", proofAvailable: false, about: "Approval-gated downstream draft handoffs." },
  // Shell
  "shell.statusStrip": { id: "shell.statusStrip", label: "Status", proofAvailable: true, about: "Room status: commits, proposals, clobbers, evidence/eval state." },
  "shell.binder": { id: "shell.binder", label: "Room binder", proofAvailable: false, about: "Workbooks, sources, people, and review state for the deal." },
  "shell.progressSpine": { id: "shell.progressSpine", label: "Progress", proofAvailable: false, about: "The Intake -> Evidence -> Draft -> Review -> Export spine, from real room state." },
  "shell.signalTape": { id: "shell.signalTape", label: "Signal tape", proofAvailable: true, about: "Live signals: source gaps, formula warnings, charts ready." },
  "shell.topbar": { id: "shell.topbar", label: "Top bar", proofAvailable: false, about: "Room title, invite code, members, and panel toggles." },
  "shell.membersAvatars": { id: "shell.membersAvatars", label: "Members", proofAvailable: false, about: "Who is live in the room, human and agent." },
};

export function surfaceMeta(id: string | null | undefined): SurfaceMeta | null {
  if (!id) return null;
  return SURFACES[id] ?? null;
}
