import type { OkfFrontmatter } from "./types";

type YamlValue = string | number | boolean | string[] | Record<string, unknown> | undefined;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseScalar(value: string): YamlValue {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => stripQuotes(part.trim())).filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(numeric)) return numeric;
  return stripQuotes(trimmed);
}

export function parseYamlFrontmatter(block: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let nestedKey: string | null = null;
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, rawKey, rawValue] = match;
    const key = rawKey.trim();
    if (indent === 0) {
      if (!rawValue.trim()) {
        root[key] = {};
        nestedKey = key;
      } else {
        root[key] = parseScalar(rawValue);
        nestedKey = null;
      }
      continue;
    }
    if (nestedKey && typeof root[nestedKey] === "object" && root[nestedKey] !== null && !Array.isArray(root[nestedKey])) {
      (root[nestedKey] as Record<string, unknown>)[key] = parseScalar(rawValue);
    }
  }
  return root;
}

function quoteIfNeeded(value: string): string {
  return /[:#\[\]{}]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

function serializeValue(value: YamlValue): string {
  if (Array.isArray(value)) return `[${value.map(quoteIfNeeded).join(", ")}]`;
  if (typeof value === "string") return quoteIfNeeded(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function serializeYamlFrontmatter(frontmatter: OkfFrontmatter): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = Object.entries(value as Record<string, YamlValue>).filter(([, nestedValue]) => nestedValue !== undefined);
      if (!nested.length) continue;
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of nested) lines.push(`  ${nestedKey}: ${serializeValue(nestedValue)}`);
      continue;
    }
    lines.push(`${key}: ${serializeValue(value as YamlValue)}`);
  }
  return lines.join("\n");
}

export function splitFrontmatterDocument(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) throw new Error("okf_frontmatter_missing");
  const end = raw.indexOf("\n---", 3);
  if (end < 0) throw new Error("okf_frontmatter_unclosed");
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(raw.indexOf("\n", end + 1) + 1).replace(/^\r?\n/, "");
  return { frontmatter: parseYamlFrontmatter(yaml), body };
}

