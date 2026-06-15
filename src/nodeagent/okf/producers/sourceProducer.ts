import { createOkfConcept } from "../concept";
import type { OkfConcept, OkfVisibility } from "../types";

export function sourceToOkfConcept(args: {
  path: string;
  title: string;
  description: string;
  url: string;
  snippet: string;
  tags?: string[];
  visibility?: OkfVisibility;
  timestamp: string;
}): OkfConcept {
  return createOkfConcept({
    path: args.path,
    frontmatter: {
      type: "Source",
      title: args.title,
      description: args.description,
      resource: args.url,
      tags: args.tags ?? ["source"],
      timestamp: args.timestamp,
      visibility: args.visibility ?? "public",
      noderoom: { sourceKind: "source", visibility: args.visibility ?? "public" },
    },
    body: `# Source Snippet\n${args.snippet}\n\n# Citations\n[1] [${args.title}](${args.url})\n`,
  });
}

