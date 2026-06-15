import { serializeYamlFrontmatter, splitFrontmatterDocument } from "./frontmatter";
import { conceptIdFromPath, extractCitations, extractMarkdownLinks, normalizeConceptPath } from "./markdown";
import type { OkfConcept, OkfFrontmatter } from "./types";

export function createOkfConcept(args: { path: string; frontmatter: OkfFrontmatter; body: string }): OkfConcept {
  const path = normalizeConceptPath(args.path);
  const body = args.body.trimEnd() + "\n";
  return {
    id: conceptIdFromPath(path),
    path,
    frontmatter: args.frontmatter,
    body,
    links: extractMarkdownLinks(body),
    citations: extractCitations(body),
  };
}

export function parseOkfConcept(path: string, raw: string): OkfConcept {
  const { frontmatter, body } = splitFrontmatterDocument(raw);
  const concept = createOkfConcept({ path, frontmatter: frontmatter as OkfFrontmatter, body });
  return { ...concept, raw };
}

export function serializeOkfConcept(concept: OkfConcept): string {
  return `---\n${serializeYamlFrontmatter(concept.frontmatter)}\n---\n${concept.body.trimEnd()}\n`;
}

