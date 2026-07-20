type JsonRecord = Record<string, unknown>;

export const NODESLIDE_CONSUMER_PROOF_SCHEMA_VERSION =
  "noderoom.nodeslide-consumer-proof/v3" as const;

function fail(message: string): never {
  throw new Error(
    `NodeSlide consumer proof receipt v3 contract failed: ${message}`,
  );
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function requireValue(
  record: JsonRecord,
  key: string,
  expected: unknown,
  path: string,
): void {
  if (record[key] !== expected) {
    fail(`${path}.${key} must be ${JSON.stringify(expected)}.`);
  }
}

function rejectLegacyKey(record: JsonRecord, key: string, path: string): void {
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    fail(`${path}.${key} is a legacy field and must be absent.`);
  }
}

/**
 * Pins the honest v3 vocabulary at runtime before a receipt is written or
 * printed. The proof exercises same-instance memory reads; it does not exercise
 * durable receipt persistence or a package reload.
 */
export function assertNodeSlideConsumerProofReceiptV3(receipt: unknown): void {
  const root = requireRecord(receipt, "receipt");
  requireValue(
    root,
    "schemaVersion",
    NODESLIDE_CONSUMER_PROOF_SCHEMA_VERSION,
    "receipt",
  );

  const lifecycle = requireRecord(root.lifecycle, "receipt.lifecycle");
  const nodeAgent = requireRecord(
    lifecycle.nodeAgent,
    "receipt.lifecycle.nodeAgent",
  );
  requireValue(
    nodeAgent,
    "sameRepositoryRereadPreservedEdit",
    true,
    "receipt.lifecycle.nodeAgent",
  );
  requireValue(
    nodeAgent,
    "portableSnapshotRoundTrip",
    true,
    "receipt.lifecycle.nodeAgent",
  );
  rejectLegacyKey(
    nodeAgent,
    "reloadPreservedEdit",
    "receipt.lifecycle.nodeAgent",
  );

  const scope = requireRecord(root.scope, "receipt.scope");
  requireValue(scope, "inMemoryReceiptLedger", true, "receipt.scope");
  requireValue(scope, "sameRepositoryReread", true, "receipt.scope");
  requireValue(scope, "portableSnapshotRoundTrip", true, "receipt.scope");
  requireValue(scope, "durableReceiptPersistence", false, "receipt.scope");
  requireValue(scope, "packageReload", false, "receipt.scope");
  rejectLegacyKey(scope, "receipts", "receipt.scope");
  rejectLegacyKey(scope, "reload", "receipt.scope");
}
