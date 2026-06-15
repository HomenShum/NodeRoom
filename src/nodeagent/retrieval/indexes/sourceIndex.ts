import type { LiteralSourceResult } from "../types";

export function literalSourceSnippet(source: LiteralSourceResult): string {
  return [source.title, source.resource, source.snippet].filter(Boolean).join(" - ");
}

