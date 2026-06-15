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
});
