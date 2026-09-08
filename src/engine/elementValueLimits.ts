/**
 * Convex production documents and nested values must stay below 1 MiB. JSON byte
 * length is only an approximation of Convex's encoding, so retain ~25% headroom
 * for document fields, indexes, and encoding overhead instead of targeting 1 MiB.
 */
export const MAX_ELEMENT_VALUE_BYTES = 750_000;
export const MAX_ELEMENT_BATCH_BYTES = 5_000_000;
export const MAX_ELEMENT_BATCH_ITEMS = 512;
export const MAX_DRAFT_DOCUMENT_BYTES = 750_000;
export const MAX_DRAFT_NOTE_BYTES = 8_192;
export const MAX_ELEMENT_VALUE_DEPTH = 12;

function assertCanonicalJson(
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("value_not_serializable");
    return;
  }
  if (typeof value !== "object" || depth > MAX_ELEMENT_VALUE_DEPTH) {
    throw new Error("value_not_serializable");
  }

  const object = value as object;
  if (ancestors.has(object)) throw new Error("value_not_serializable");
  const prototype = Object.getPrototypeOf(object);
  const isArray = Array.isArray(object);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new Error("value_not_serializable");
  }

  ancestors.add(object);
  try {
    const children = isArray ? object : Object.values(object as Record<string, unknown>);
    for (const child of children) assertCanonicalJson(child, depth + 1, ancestors);
  } finally {
    ancestors.delete(object);
  }
}

function jsonBytes(value: unknown): number {
  assertCanonicalJson(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("value_not_serializable");
  }
  if (encoded === undefined) throw new Error("value_not_serializable");
  return new TextEncoder().encode(encoded).byteLength;
}

export function elementValueLimitViolation(
  value: unknown,
  kind: "set" | "create" | "delete",
): "value_too_large" | "value_not_serializable" | null {
  if (kind === "delete") return null;
  try {
    return jsonBytes(value) > MAX_ELEMENT_VALUE_BYTES ? "value_too_large" : null;
  } catch {
    return "value_not_serializable";
  }
}

export function assertElementValueWithinLimit(
  value: unknown,
  kind: "set" | "create" | "delete",
): void {
  const violation = elementValueLimitViolation(value, kind);
  if (violation) throw new Error(violation);
}

export function assertElementValueBatchWithinLimit(
  items: readonly unknown[],
): void {
  if (items.length > MAX_ELEMENT_BATCH_ITEMS) throw new Error("element_batch_too_large");
  if (jsonBytes(items) > MAX_ELEMENT_BATCH_BYTES) throw new Error("element_batch_too_large");
}

/** Bounds the actual persisted draft payload, including the previously omitted note. */
export function assertElementDraftWithinLimit(
  items: readonly unknown[],
  note: string,
): void {
  if (items.length > MAX_ELEMENT_BATCH_ITEMS) throw new Error("element_batch_too_large");
  if (new TextEncoder().encode(note).byteLength > MAX_DRAFT_NOTE_BYTES) throw new Error("draft_note_too_large");
  if (jsonBytes({ ops: items, note }) > MAX_DRAFT_DOCUMENT_BYTES) throw new Error("draft_document_too_large");
}
