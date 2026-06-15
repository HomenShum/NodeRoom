import type { OkfConcept } from "../../okf/types";
import type { OkfConceptFilter } from "../types";
import { filterOkfConcepts } from "../okf/okfFilters";

export function metadataIndexSearch(concepts: OkfConcept[], filter: OkfConceptFilter): OkfConcept[] {
  return filterOkfConcepts(concepts, filter);
}

