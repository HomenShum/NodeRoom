import type { OkfConcept } from "../../okf/types";
import { okfBacklinks, okfNeighbors } from "../okf/okfGraph";

export function graphBacklinks(concepts: OkfConcept[], conceptId: string, depth = 1): OkfConcept[] {
  return okfBacklinks(concepts, conceptId, depth);
}

export function graphNeighbors(concepts: OkfConcept[], conceptId: string, depth = 1): OkfConcept[] {
  return okfNeighbors(concepts, conceptId, depth, true);
}

