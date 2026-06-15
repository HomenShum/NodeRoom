import type { OkfConcept } from "../../okf/types";
import { rankOkfConcepts } from "../ranking/hybridRanker";
import type { OkfConceptFilter, RetrievalHit } from "../types";
import { filterOkfConcepts } from "./okfFilters";

export function okfFullTextSearch(concepts: OkfConcept[], args: { query: string; limit?: number } & OkfConceptFilter): RetrievalHit[] {
  const { limit, ...filter } = args;
  return rankOkfConcepts(filterOkfConcepts(concepts, filter), args.query).slice(0, limit ?? 10);
}
