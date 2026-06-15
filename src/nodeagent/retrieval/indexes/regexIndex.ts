import type { OkfConcept } from "../../okf/types";
import type { RetrievalHit } from "../types";
import { okfRegexSearch } from "../okf/okfRegex";

export function regexIndexSearch(concepts: OkfConcept[], pattern: string, limit = 50): RetrievalHit[] {
  return okfRegexSearch(concepts, { pattern, limit });
}

