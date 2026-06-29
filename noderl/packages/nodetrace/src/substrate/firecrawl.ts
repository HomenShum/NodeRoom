/**
 * Firecrawl substrate — screenshot + clean markdown in one REST call (no SDK, no browser to drive).
 * Non-interactive: the loop skips act() and goes straight to observe+extract. Firecrawl returns no
 * per-element coordinates, so locate() is null → these steps carry a screenshot but no highlight box.
 * Use this for "screenshot the source page" fast/cheap; use Browserbase when you need the exact box.
 * Reads FIRECRAWL_API_KEY from the environment.
 */
import type { BrowserSubstrate, ObserveTarget, PageHandle } from "../types";
import { CAPTURE_LIMITS } from "../guards";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";

interface FirecrawlResponse {
  success?: boolean;
  data?: { markdown?: string; screenshot?: string; metadata?: { title?: string } };
}

export function firecrawlSubstrate(opts: { apiKey?: string } = {}): BrowserSubstrate {
  const apiKey = (opts.apiKey ?? process.env.FIRECRAWL_API_KEY)?.trim(); // trim stray \r from env
  return {
    name: "firecrawl",
    capabilities: { interactive: false },
    async open(url, signal) {
      if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");
      const res = await fetch(FIRECRAWL_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url, formats: ["markdown", "screenshot"], onlyMainContent: true }),
        signal,
      });
      if (!res.ok) throw new Error(`firecrawl http ${res.status}`);
      const json = (await res.json()) as FirecrawlResponse;
      if (!json.success || !json.data) throw new Error("firecrawl scrape returned no data");
      const data = json.data;
      let png = new Uint8Array();
      if (data.screenshot) {
        const shotRes = await fetch(data.screenshot, { signal });
        if (shotRes.ok) {
          const buf = await shotRes.arrayBuffer();
          png = buf.byteLength <= CAPTURE_LIMITS.MAX_SCREENSHOT_BYTES ? new Uint8Array(buf) : new Uint8Array(buf, 0, CAPTURE_LIMITS.MAX_SCREENSHOT_BYTES);
        }
      }
      const a11y = data.markdown ?? "";
      const title = data.metadata?.title ?? new URL(url).hostname;
      const page: PageHandle = {
        async representation() { return { url, title, a11y }; },
        async screenshot() { return { png, width: 0, height: 0 }; },
        async locate(_t: ObserveTarget) { return null; }, // no element coordinates from a scrape
        async act() { /* non-interactive */ },
        async close() { /* nothing to close */ },
      };
      return page;
    },
  };
}
