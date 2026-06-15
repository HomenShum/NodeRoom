import { parseOkfConcept } from "./concept";
import { isReservedOkfFile } from "./validators";
import type { OkfBundleFile, OkfConcept } from "./types";

export function readOkfBundle(files: OkfBundleFile[]): OkfConcept[] {
  return files
    .filter((file) => file.path.endsWith(".md") && !isReservedOkfFile(file.path))
    .map((file) => parseOkfConcept(file.path, file.content));
}

