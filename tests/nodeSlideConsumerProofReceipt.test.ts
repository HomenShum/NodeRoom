import { describe, expect, it } from "vitest";
import {
  assertNodeSlideConsumerProofReceiptV3,
  NODESLIDE_CONSUMER_PROOF_SCHEMA_VERSION,
} from "../scripts/nodeslide-consumer-proof-receipt";

function validReceipt(): Record<string, unknown> {
  return {
    schemaVersion: NODESLIDE_CONSUMER_PROOF_SCHEMA_VERSION,
    lifecycle: {
      nodeAgent: {
        sameRepositoryRereadPreservedEdit: true,
        portableSnapshotRoundTrip: true,
      },
    },
    scope: {
      inMemoryReceiptLedger: true,
      sameRepositoryReread: true,
      portableSnapshotRoundTrip: true,
      durableReceiptPersistence: false,
      packageReload: false,
    },
  };
}

describe("NodeSlide consumer proof receipt v3", () => {
  it("accepts the narrowed same-repository and snapshot vocabulary", () => {
    expect(() =>
      assertNodeSlideConsumerProofReceiptV3(validReceipt()),
    ).not.toThrow();
  });

  it("requires the v3 schema and explicit durable-boundary false flags", () => {
    const wrongSchema = validReceipt();
    wrongSchema.schemaVersion = "noderoom.nodeslide-consumer-proof/v2";
    expect(() => assertNodeSlideConsumerProofReceiptV3(wrongSchema)).toThrow(
      /schemaVersion must be "noderoom\.nodeslide-consumer-proof\/v3"/u,
    );

    const durableReceipt = validReceipt();
    (
      durableReceipt.scope as Record<string, unknown>
    ).durableReceiptPersistence = true;
    expect(() => assertNodeSlideConsumerProofReceiptV3(durableReceipt)).toThrow(
      /durableReceiptPersistence must be false/u,
    );

    const packageReload = validReceipt();
    (packageReload.scope as Record<string, unknown>).packageReload = true;
    expect(() => assertNodeSlideConsumerProofReceiptV3(packageReload)).toThrow(
      /packageReload must be false/u,
    );
  });

  it("rejects the legacy reload and generic receipt-ledger fields", () => {
    const legacyLifecycle = validReceipt();
    const lifecycle = legacyLifecycle.lifecycle as Record<string, unknown>;
    (lifecycle.nodeAgent as Record<string, unknown>).reloadPreservedEdit = true;
    expect(() =>
      assertNodeSlideConsumerProofReceiptV3(legacyLifecycle),
    ).toThrow(/reloadPreservedEdit is a legacy field/u);

    const legacyScope = validReceipt();
    (legacyScope.scope as Record<string, unknown>).reload = true;
    expect(() => assertNodeSlideConsumerProofReceiptV3(legacyScope)).toThrow(
      /scope\.reload is a legacy field/u,
    );

    const genericReceiptClaim = validReceipt();
    (genericReceiptClaim.scope as Record<string, unknown>).receipts = true;
    expect(() =>
      assertNodeSlideConsumerProofReceiptV3(genericReceiptClaim),
    ).toThrow(/scope\.receipts is a legacy field/u);
  });
});
