import { parseOkfConcept } from "./concept";
import type { OkfBundleFile, OkfConcept } from "./types";

const RESERVED_FILENAMES = new Set(["index.md", "log.md"]);

export interface OkfValidationIssue {
  path: string;
  code: string;
  message: string;
}

export function isReservedOkfFile(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  return !!name && RESERVED_FILENAMES.has(name);
}

export function validateOkfConcept(concept: OkfConcept): OkfValidationIssue[] {
  const issues: OkfValidationIssue[] = [];
  if (isReservedOkfFile(concept.path)) {
    issues.push({ path: concept.path, code: "reserved_concept_path", message: "index.md and log.md are reserved OKF filenames." });
  }
  if (!concept.frontmatter.type || typeof concept.frontmatter.type !== "string") {
    issues.push({ path: concept.path, code: "missing_type", message: "Every OKF concept requires a non-empty type field." });
  }
  return issues;
}

export function validateOkfBundleFiles(files: OkfBundleFile[]): OkfValidationIssue[] {
  const issues: OkfValidationIssue[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".md") || isReservedOkfFile(file.path)) continue;
    try {
      issues.push(...validateOkfConcept(parseOkfConcept(file.path, file.content)));
    } catch (error) {
      issues.push({ path: file.path, code: "parse_error", message: error instanceof Error ? error.message : "Could not parse OKF concept." });
    }
  }
  return issues;
}

