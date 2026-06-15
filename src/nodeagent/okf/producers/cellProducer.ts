import { createOkfConcept } from "../concept";
import type { OkfConcept, OkfVisibility } from "../types";

export function cellToOkfConcept(args: {
  path: string;
  title: string;
  description: string;
  roomId: string;
  artifactId: string;
  elementId: string;
  value: unknown;
  status?: string;
  confidence?: number;
  evidenceLabels?: string[];
  visibility?: OkfVisibility;
  timestamp: string;
}): OkfConcept {
  const evidence = args.evidenceLabels?.length
    ? `\n# Citations\n${args.evidenceLabels.map((label, index) => `[${index + 1}] ${label}`).join("\n")}\n`
    : "";
  return createOkfConcept({
    path: args.path,
    frontmatter: {
      type: "Spreadsheet Cell",
      title: args.title,
      description: args.description,
      resource: `noderoom://rooms/${args.roomId}/artifacts/${args.artifactId}/elements/${args.elementId}`,
      tags: ["spreadsheet", args.status ?? "needs_review"],
      timestamp: args.timestamp,
      visibility: args.visibility ?? "public",
      noderoom: {
        roomId: args.roomId,
        artifactId: args.artifactId,
        elementId: args.elementId,
        status: args.status ?? "needs_review",
        confidence: args.confidence,
        visibility: args.visibility ?? "public",
        sourceKind: "computed",
      },
    },
    body: `# Value\n${String(args.value ?? "")}\n${evidence}`,
  });
}

