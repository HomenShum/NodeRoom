import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

describe("product-memory Playwright runner", () => {
  it("refuses a foreign HTTP server when its owned preview cannot bind", async () => {
    const foreignServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("foreign preview");
    });
    await new Promise<void>((resolve, reject) => {
      foreignServer.once("error", reject);
      foreignServer.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = foreignServer.address();
      if (!address || typeof address === "string") throw new Error("foreign_server_address_missing");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const result = spawnSync(process.execPath, ["scripts/run-product-memory-playwright.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PLAYWRIGHT_PORT: String(address.port),
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_REUSE_SERVER: "0",
          PRODUCT_MEMORY_SERVER: "preview",
          PRODUCT_MEMORY_SKIP_BUILD: "1",
        },
        timeout: 20_000,
        windowsHide: true,
      });
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain("product_memory_server_exited");
      expect(output).not.toContain("Running 29 tests");
    } finally {
      await new Promise<void>((resolve) => foreignServer.close(() => resolve()));
    }
  }, 30_000);
});
