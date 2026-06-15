import type { OkfConcept } from "../../okf/types";
import type { RetrievalHit } from "../types";
import { okfFullTextSearch } from "../okf/okfFullTextSearch";

export function fullTextIndexSearch(concepts: OkfConcept[], query: string, limit = 10): RetrievalHit[] {
  return okfFullTextSearch(concepts, { query, limit });
}

