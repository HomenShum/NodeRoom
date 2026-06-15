import type { OkfConcept } from "../../okf/types";
import { okfGlob } from "../okf/okfPathGlob";

export function pathGlobIndexSearch(concepts: OkfConcept[], pattern: string, limit = 50): OkfConcept[] {
  return okfGlob(concepts, pattern, limit);
}

