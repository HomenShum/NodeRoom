const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

export function redactTraceText(value: string, replacement = "[redacted]"): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, replacement), value);
}

export function stableTraceJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (typeof input === "string") return redactTraceText(input);
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => normalize(item));
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function stableTraceHash(value: unknown): string {
  const text = stableTraceJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
