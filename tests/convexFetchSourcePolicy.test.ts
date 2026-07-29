import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSourceRealMock = vi.hoisted(() => vi.fn());
vi.mock("../src/nodeagent/skills/search/fetchSource", () => ({
  fetchSourceReal: fetchSourceRealMock,
}));

import { fetchSourceForConvex } from "../convex/convexRoomTools";
import { TrustedSourceReceiptRegistry } from "../src/nodeagent/core/evidenceReceipt";

describe("Convex fetch_source boundary", () => {
  beforeEach(() => {
    fetchSourceRealMock.mockReset();
  });

  it("delegates to the one shared Node-runtime network boundary", async () => {
    fetchSourceRealMock.mockResolvedValue({
      ok: true,
      title: "Public source",
      snippet: "Evidence text",
      url: "https://public.example/source",
      provenance: "network_fetch",
    });

    await expect(fetchSourceForConvex("https://public.example/source")).resolves.toMatchObject({
      ok: true,
      title: "Public source",
    });
    expect(fetchSourceRealMock).toHaveBeenCalledExactlyOnceWith(
      "https://public.example/source",
    );
  });

  it("preserves honest failures from the shared boundary without fallback success", async () => {
    fetchSourceRealMock.mockResolvedValue({ ok: false, error: "http_429" });

    await expect(fetchSourceForConvex("https://public.example/rate-limited")).resolves.toEqual({
      ok: false,
      error: "http_429",
    });
  });

  it("registers exact fetched bytes in the caller's slice registry without adding receipt fields to the model result", async () => {
    const now = 1_785_288_000_000;
    const source = {
      ok: true as const,
      title: "Public source",
      snippet: "Evidence text",
      url: "https://public.example/source",
      provenance: "network_fetch" as const,
    };
    fetchSourceRealMock.mockImplementation(async (
      _url: string,
      onTrustedCapture: (capture: {
        source: typeof source;
        exactBytes: Uint8Array;
        verifiedAt: number;
      }) => Promise<boolean>,
    ) => {
      const recorded = await onTrustedCapture({
        source,
        exactBytes: new TextEncoder().encode("<main>Evidence text</main>"),
        verifiedAt: now,
      });
      return recorded ? source : { ok: false, error: "receipt_registration_failed" };
    });
    const receipts = new TrustedSourceReceiptRegistry({ now: () => now });

    const result = await fetchSourceForConvex(source.url, receipts);

    expect(result).toEqual(source);
    expect(result).not.toHaveProperty("contentDigest");
    expect(result).not.toHaveProperty("verifiedAt");
    expect(receipts.resolve({
      id: "evidence:public",
      kind: "source",
      label: source.title,
      url: source.url,
      snippet: source.snippet,
    })).toMatchObject({
      contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      verifiedAt: now,
    });
  });
});
