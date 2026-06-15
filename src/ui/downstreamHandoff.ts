import type { Artifact } from "../engine/types";

export type DownstreamHandoffTarget = "gmail" | "notion" | "slack" | "linear" | "linkedin" | "crm";

export interface DownstreamHandoffDraftPreview {
  target: DownstreamHandoffTarget;
  title: string;
  body: string;
  approvalRequired: boolean;
  sourceArtifactIds: string[];
  sourceSummary: string;
}

export function buildDownstreamHandoffDraft(
  target: DownstreamHandoffTarget,
  input: { roomTitle: string; artifacts: Pick<Artifact, "id" | "title" | "kind" | "order">[] },
): DownstreamHandoffDraftPreview {
  const artifacts = input.artifacts.slice(0, 8);
  const sourceArtifactIds = artifacts.map((artifact) => artifact.id);
  const sourceSummary = artifacts.length
    ? artifacts.map((artifact) => `${artifact.title} (${artifact.kind}, ${artifact.order.length} items)`).join("; ")
    : "No room artifacts selected yet";
  const packageTitle = `${input.roomTitle} diligence package`;
  const approvalRequired = target !== "crm";
  const title = titleForTarget(target, packageTitle);
  const body = bodyForTarget(target, packageTitle, sourceSummary);
  return { target, title, body, approvalRequired, sourceArtifactIds, sourceSummary };
}

function titleForTarget(target: DownstreamHandoffTarget, packageTitle: string): string {
  if (target === "gmail") return `Draft Gmail update: ${packageTitle}`;
  if (target === "notion") return `Create Notion page: ${packageTitle}`;
  if (target === "slack") return `Draft Slack recap: ${packageTitle}`;
  if (target === "linear") return `Create Linear follow-up: ${packageTitle}`;
  if (target === "linkedin") return `Draft LinkedIn research note: ${packageTitle}`;
  return `Export CRM CSV: ${packageTitle}`;
}

function bodyForTarget(target: DownstreamHandoffTarget, packageTitle: string, sourceSummary: string): string {
  if (target === "crm") {
    return [
      "package_title,status,source_artifacts,next_action",
      `"${csvEscape(packageTitle)}","ready_for_review","${csvEscape(sourceSummary)}","Review and import into CRM"`,
    ].join("\n");
  }
  const intro = target === "linear"
    ? "Create follow-up tasks from the reviewed diligence package."
    : target === "linkedin"
      ? "Draft a relationship-safe outreach/research note from reviewed diligence."
      : target === "notion"
        ? "Publish a reviewed diligence page for the team."
        : target === "slack"
          ? "Share a concise reviewed room recap with the team."
          : "Send a reviewed diligence update to stakeholders.";
  return [
    intro,
    "",
    `Package: ${packageTitle}`,
    "",
    "Included room artifacts:",
    sourceSummary,
    "",
    "Approval gate: review sources, private-room boundaries, and recipient list before sending.",
    "External write status: draft only. No provider-side action has been taken.",
  ].join("\n");
}

function csvEscape(value: string): string {
  return value.replace(/"/g, '""');
}
