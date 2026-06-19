export function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function auditRecordHash(record: unknown, previousHash = ""): Promise<string> {
  return sha256Hex(stableJson({ previousHash, record }));
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const nested = input[key];
      if (typeof nested === "function" || typeof nested === "symbol") continue;
      output[key] = normalizeForStableJson(nested);
    }
    return output;
  }
  return String(value);
}
