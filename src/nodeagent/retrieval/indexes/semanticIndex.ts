import type { OkfConcept } from "../../okf/types";
import type { RetrievalHit } from "../types";
import { okfSemanticSearch } from "../okf/okfSemanticSearch";

export function semanticIndexSearch(concepts: OkfConcept[], query: string, limit = 10): RetrievalHit[] {
  return okfSemanticSearch(concepts, { query, limit });
}

