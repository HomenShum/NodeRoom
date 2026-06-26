import { describe, expect, it } from "vitest";
import { fetchSourceForConvex } from "../convex/convexRoomTools";

describe("Convex fetch_source target policy", () => {
  it("keeps the Convex runtime fetch on HTTPS", async () => {
    await expect(fetchSourceForConvex("http://example.com")).resolves.toMatchObject({
      ok: false,
      error: "https_required",
    });
  });

  it("blocks direct private, loopback, and metadata targets before fetch", async () => {
    await expect(fetchSourceForConvex("https://127.0.0.1/")).resolves.toMatchObject({
      ok: false,
      error: "blocked_private_or_reserved_ip",
    });
    await expect(fetchSourceForConvex("https://localhost/")).resolves.toMatchObject({
      ok: false,
      error: "blocked_private_or_metadata_host",
    });
    await expect(fetchSourceForConvex("https://169.254.169.254/latest/meta-data/")).resolves.toMatchObject({
      ok: false,
      error: "blocked_private_or_metadata_host",
    });
  });

  it("follows safe HTTPS redirects without dropping the SSRF guard", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (href === "https://example.com/start") {
          return new Response("", {
            status: 302,
            headers: { location: "https://example.org/final" },
          });
        }
        return new Response("<html><title>Redirected</title><body>Final source text.</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }) as typeof fetch;

      await expect(fetchSourceForConvex("https://example.com/start")).resolves.toMatchObject({
        ok: true,
        title: "Redirected",
        url: "https://example.org/final",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks redirects that land on private or metadata hosts", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("", {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      })) as typeof fetch;

      await expect(fetchSourceForConvex("https://example.com/start")).resolves.toMatchObject({
        ok: false,
        error: "blocked_private_or_reserved_ip",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats protected source responses as non-redirection guidance instead of red tool failures", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;

      await expect(fetchSourceForConvex("https://query1.finance.yahoo.com/v7/finance/download/MSFT"))
        .resolves.toMatchObject({
          ok: true,
          title: "query1.finance.yahoo.com",
          snippet: expect.stringContaining("Use capture_source"),
        });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
