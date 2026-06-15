import type { OkfCitation, OkfLink } from "./types";

export function conceptIdFromPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\//, "").replace(/\.md$/i, "");
}

export function normalizeConceptPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

export function conceptIdFromLink(target: string): string | undefined {
  if (/^[a-z]+:/i.test(target)) return undefined;
  const clean = target.split("#")[0]?.replace(/^\//, "");
  if (!clean || !clean.endsWith(".md")) return undefined;
  return conceptIdFromPath(clean);
}

export function extractMarkdownLinks(body: string): OkfLink[] {
  const links: OkfLink[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of body.matchAll(re)) {
    const target = match[2].trim();
    links.push({ label: match[1].trim(), target, conceptId: conceptIdFromLink(target) });
  }
  return links;
}

export function extractCitations(body: string): OkfCitation[] {
  const citations: OkfCitation[] = [];
  const citationSection = body.split(/^# Citations\s*$/im)[1] ?? "";
  const re = /^\s*\[([^\]]+)\]\s+\[([^\]]+)\]\(([^)]+)\)/gm;
  for (const match of citationSection.matchAll(re)) {
    const target = match[3].trim();
    citations.push({ id: match[1].trim(), label: match[2].trim(), target, conceptId: conceptIdFromLink(target) });
  }
  return citations;
}

export interface OkfSectionChunk {
  heading: string;
  text: string;
}

export function splitMarkdownSections(body: string): OkfSectionChunk[] {
  const sections: OkfSectionChunk[] = [];
  let currentHeading = "Summary";
  let current: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (current.join("\n").trim()) sections.push({ heading: currentHeading, text: current.join("\n").trim() });
      currentHeading = heading[2].trim();
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.join("\n").trim()) sections.push({ heading: currentHeading, text: current.join("\n").trim() });
  return sections;
}

