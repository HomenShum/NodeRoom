import { createHash } from "node:crypto";

const INLINE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
const SHA256_TOKEN_PATTERN = /^'sha256-[A-Za-z0-9+/]+=*'$/u;
const CSP_HASH_SOURCE_PATTERN = /^'sha[^']*-/iu;
const JAVASCRIPT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

function normalizeHtmlScriptText(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

function parseAttributes(value: string): Map<string, string | null> {
  const attributes = new Map<string, string | null>();
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /[\t\n\f\r /]/u.test(value[cursor] ?? "")) cursor += 1;
    if (cursor >= value.length) break;

    const nameStart = cursor;
    while (cursor < value.length && !/[\t\n\f\r />=]/u.test(value[cursor] ?? "")) cursor += 1;
    const name = value.slice(nameStart, cursor).toLowerCase();
    if (!name) {
      cursor += 1;
      continue;
    }

    while (cursor < value.length && /[\t\n\f\r ]/u.test(value[cursor] ?? "")) cursor += 1;
    let attributeValue: string | null = null;
    if (value[cursor] === "=") {
      cursor += 1;
      while (cursor < value.length && /[\t\n\f\r ]/u.test(value[cursor] ?? "")) cursor += 1;
      const quote = value[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < value.length && value[cursor] !== quote) cursor += 1;
        attributeValue = value.slice(valueStart, cursor);
        if (value[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < value.length && !/[\t\n\f\r >]/u.test(value[cursor] ?? "")) cursor += 1;
        attributeValue = value.slice(valueStart, cursor);
      }
    }
    if (!attributes.has(name)) attributes.set(name, attributeValue);
  }
  return attributes;
}

function isCspControlledInlineScript(attributes: Map<string, string | null>): boolean {
  const rawType = attributes.get("type");
  if (rawType === undefined || rawType === null || rawType.trim() === "") return true;
  const type = rawType.trim().toLowerCase();
  if (type === "module" || type === "importmap" || type === "speculationrules") return true;
  return JAVASCRIPT_MIME_TYPES.has(type.split(";", 1)[0]?.trim() ?? "");
}

export function inlineScriptHashTokens(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT_PATTERN)]
    .map((match) => ({
      attributes: parseAttributes(match[1] ?? ""),
      content: match[2] ?? "",
    }))
    .filter(({ attributes }) => !attributes.has("src") && isCspControlledInlineScript(attributes))
    .map((match) => (
      `'sha256-${createHash("sha256")
        .update(normalizeHtmlScriptText(match.content))
        .digest("base64")}'`
    ));
}

export function auditInlineScriptCsp(input: Readonly<{
  htmlByFile: Readonly<Record<string, string>>;
  scriptSrcTokens: readonly string[];
}>): {
  configuredHashes: string[];
  expectedHashes: string[];
  findings: string[];
} {
  const expectedByHash = new Map<string, string[]>();
  for (const [file, html] of Object.entries(input.htmlByFile)) {
    for (const hash of inlineScriptHashTokens(html)) {
      const files = expectedByHash.get(hash) ?? [];
      if (!files.includes(file)) files.push(file);
      expectedByHash.set(hash, files);
    }
  }

  const expectedHashes = [...expectedByHash.keys()].sort();
  const configuredHashes = [...new Set(
    input.scriptSrcTokens.filter((token) => SHA256_TOKEN_PATTERN.test(token)),
  )].sort();
  const unsupportedHashSources = [...new Set(
    input.scriptSrcTokens.filter(
      (token) => CSP_HASH_SOURCE_PATTERN.test(token) && !SHA256_TOKEN_PATTERN.test(token),
    ),
  )].sort();
  const configuredSet = new Set(configuredHashes);
  const expectedSet = new Set(expectedHashes);
  const findings: string[] = [];

  for (const token of unsupportedHashSources) {
    findings.push(`CSP script-src contains unsupported or malformed hash source ${token}; use exact sha256 allowances`);
  }
  for (const hash of expectedHashes) {
    if (!configuredSet.has(hash)) {
      findings.push(`CSP script-src is missing ${hash} for ${expectedByHash.get(hash)?.sort().join(", ")}`);
    }
  }
  for (const hash of configuredHashes) {
    if (!expectedSet.has(hash)) {
      findings.push(`CSP script-src contains stale inline-script hash ${hash}`);
    }
  }

  return {
    configuredHashes,
    expectedHashes,
    findings,
  };
}
