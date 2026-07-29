import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CellEvidence } from "../src/engine/types";
import {
  TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES,
  TrustedSourceReceiptRegistry,
} from "../src/nodeagent/core/evidenceReceipt";

function source(index: number) {
  return {
    url: `https://source-${index}.example/evidence`,
    title: `Source ${index}`,
    snippet: `Exact bounded source snippet ${index}`,
    provenance: "network_fetch" as const,
  };
}

function evidenceFor(value: ReturnType<typeof source>): CellEvidence {
  return {
    id: `evidence:${value.title}`,
    kind: "source",
    label: value.title,
    url: value.url,
    source: value.url,
    snippet: value.snippet,
  };
}

describe("same-runtime trusted source receipt registry", () => {
  it("binds the exact adapter bytes and presentation without exposing receipt material in SourceResult", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({ now: () => now });
    const fetched = source(1);
    const bytes = new TextEncoder().encode("<html>immutable source bytes</html>");

    expect(await registry.recordFetchedSource({
      source: fetched,
      exactBytes: bytes,
      verifiedAt: now,
    })).toBe(true);

    expect(registry.resolve(evidenceFor(fetched))).toEqual({
      contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      verifiedAt: now,
    });
    expect(fetched).not.toHaveProperty("contentDigest");
    expect(fetched).not.toHaveProperty("verifiedAt");
  });

  it("rejects forged receipt fields and every incomplete or mismatched presentation", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({ now: () => now });
    const fetched = source(2);
    await registry.recordFetchedSource({
      source: fetched,
      exactBytes: new TextEncoder().encode("trusted bytes"),
      verifiedAt: now,
    });
    const exact = evidenceFor(fetched);

    expect(registry.resolve({
      ...exact,
      contentDigest: `sha256:${"f".repeat(64)}`,
      verifiedAt: now + 999_999,
      receiptDigest: "model-forged",
    })).toEqual(registry.resolve(exact));
    expect(registry.resolve({ ...exact, snippet: undefined })).toBeUndefined();
    expect(registry.resolve({ ...exact, snippet: `${exact.snippet} changed` })).toBeUndefined();
    expect(registry.resolve({ ...exact, label: "Changed title" })).toBeUndefined();
    expect(registry.resolve({ ...exact, url: "https://other.example/evidence", source: undefined })).toBeUndefined();
    expect(registry.resolve({ ...exact, source: "https://other.example/evidence" })).toBeUndefined();
  });

  it("rejects empty captures and credential-bearing source presentations", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({ now: () => now });

    await expect(registry.recordFetchedSource({
      source: source(3),
      exactBytes: new Uint8Array(),
      verifiedAt: now,
    })).resolves.toBe(false);
    await expect(registry.recordFetchedSource({
      source: {
        ...source(4),
        url: "https://user:secret@source-4.example/evidence",
      },
      exactBytes: new TextEncoder().encode("bounded bytes"),
      verifiedAt: now,
    })).resolves.toBe(false);
    await expect(registry.recordFetchedSource({
      source: {
        ...source(5),
        provenance: "synthetic_fixture",
      } as never,
      exactBytes: new TextEncoder().encode("synthetic bytes"),
      verifiedAt: now,
    })).resolves.toBe(false);
    expect(registry.size).toBe(0);
  });

  it("rejects a raw-bounded Unicode URL when canonical percent-encoding exceeds the registry key bound", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({ now: () => now });
    const rawBoundedButCanonicalOversized = `https://example.com/${"é".repeat(400)}`;
    expect(rawBoundedButCanonicalOversized.length).toBeLessThan(2_048);
    expect(new URL(rawBoundedButCanonicalOversized).toString().length).toBeGreaterThan(2_048);

    await expect(registry.recordFetchedSource({
      source: {
        ...source(8),
        url: rawBoundedButCanonicalOversized,
      },
      exactBytes: new TextEncoder().encode("bounded source bytes"),
      verifiedAt: now,
    })).resolves.toBe(false);
    expect(registry.size).toBe(0);
  });

  it("rejects a capture already older than the registry TTL instead of renewing stale evidence", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({
      maxAgeMs: 1_000,
      now: () => now,
    });

    await expect(registry.recordFetchedSource({
      source: source(6),
      exactBytes: new TextEncoder().encode("stale source bytes"),
      verifiedAt: now - 1_001,
    })).resolves.toBe(false);
    await expect(registry.recordFetchedSource({
      source: source(7),
      exactBytes: new TextEncoder().encode("edge-expired source bytes"),
      verifiedAt: now - 1_000,
    })).resolves.toBe(false);
    expect(registry.size).toBe(0);
    expect(registry.resolve(evidenceFor(source(6)))).toBeUndefined();
    expect(registry.resolve(evidenceFor(source(7)))).toBeUndefined();
  });

  it("evicts deterministically under burst and sustained waves and never exceeds its hard bound", async () => {
    const now = 1_785_288_000_000;
    const registry = new TrustedSourceReceiptRegistry({
      maxEntries: 8,
      now: () => now,
    });

    for (let wave = 0; wave < 4; wave += 1) {
      await Promise.all(
        Array.from({ length: 16 }, async (_, offset) => {
          const index = wave * 16 + offset;
          const fetched = source(index);
          await registry.recordFetchedSource({
            source: fetched,
            exactBytes: new TextEncoder().encode(`wave=${wave};source=${index}`),
            verifiedAt: now,
          });
        }),
      );
      expect(registry.size).toBeLessThanOrEqual(8);
    }

    for (let index = 100; index < 108; index += 1) {
      const fetched = source(index);
      await registry.recordFetchedSource({
        source: fetched,
        exactBytes: new TextEncoder().encode(`sustained=${index}`),
        verifiedAt: now,
      });
    }
    expect(registry.resolve(evidenceFor(source(0)))).toBeUndefined();
    expect(registry.resolve(evidenceFor(source(100)))).toBeDefined();
    expect(registry.resolve(evidenceFor(source(107)))).toBeDefined();

    const hardBounded = new TrustedSourceReceiptRegistry({
      maxEntries: TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES * 10,
      now: () => now,
    });
    await Promise.all(
      Array.from({ length: TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES + 32 }, async (_, index) => {
        const fetched = source(index);
        await hardBounded.recordFetchedSource({
          source: fetched,
          exactBytes: new TextEncoder().encode(`hard-bound=${index}`),
          verifiedAt: now,
        });
      }),
    );
    expect(hardBounded.size).toBe(TRUSTED_SOURCE_RECEIPT_MAX_ENTRIES);
  });

  it("expires receipts and fails closed across runtime slices", async () => {
    let now = 1_785_288_000_000;
    const firstSlice = new TrustedSourceReceiptRegistry({
      maxAgeMs: 100,
      now: () => now,
    });
    const secondSlice = new TrustedSourceReceiptRegistry({
      maxAgeMs: 100,
      now: () => now,
    });
    const fetched = source(9);
    await firstSlice.recordFetchedSource({
      source: fetched,
      exactBytes: new TextEncoder().encode("slice-one bytes"),
      verifiedAt: now,
    });

    expect(firstSlice.resolve(evidenceFor(fetched))).toBeDefined();
    expect(secondSlice.resolve(evidenceFor(fetched))).toBeUndefined();

    now += 101;
    expect(firstSlice.resolve(evidenceFor(fetched))).toBeUndefined();
    expect(firstSlice.size).toBe(0);
  });
});
