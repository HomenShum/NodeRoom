import { serializeOkfConcept } from "./concept";
import type { OkfBundleFile, OkfConcept } from "./types";

function indexBody(concepts: OkfConcept[]): string {
  const byDir = new Map<string, OkfConcept[]>();
  for (const concept of concepts) {
    const dir = concept.path.includes("/") ? concept.path.split("/").slice(0, -1).join("/") : "root";
    const list = byDir.get(dir) ?? [];
    list.push(concept);
    byDir.set(dir, list);
  }
  const lines = ["# NodeRoom OKF Bundle", ""];
  for (const [dir, list] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${dir}`);
    for (const concept of list.sort((a, b) => a.path.localeCompare(b.path))) {
      const title = concept.frontmatter.title ?? concept.id;
      const description = concept.frontmatter.description ? ` - ${concept.frontmatter.description}` : "";
      lines.push(`* [${title}](${concept.path})${description}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function writeOkfBundleFiles(concepts: OkfConcept[], timestamp = new Date().toISOString()): OkfBundleFile[] {
  const files = concepts.map((concept) => ({ path: concept.path, content: serializeOkfConcept(concept) }));
  return [
    { path: "index.md", content: indexBody(concepts) },
    { path: "log.md", content: `# Bundle Update Log\n\n## ${timestamp.slice(0, 10)}\n* **Update**: Generated ${concepts.length} NodeRoom OKF concept(s).\n` },
    ...files.sort((a, b) => a.path.localeCompare(b.path)),
  ];
}

