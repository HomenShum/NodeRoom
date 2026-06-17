/**
 * capture-live.ts — LOCAL producer for the live-capture pipeline. Drives a REAL page via the
 * env-selected substrate (Browserbase if its keys are set → interactive + EXACT boxes, else Firecrawl)
 * with our own reasoning loop, and writes a Trace bundle (screenshots → /public/qa-trace/live, boxes
 * preserved) that the Trace tab renders.
 *
 * This is a dev/demo tool you run locally (where Playwright + Browserbase work): the PROD capture path
 * is the in-Convex Firecrawl action (captures:capture) + the SEC data-API lane (sec:facts) — both
 * room-member-authed, no worker, no token.
 *
 *   ANTHROPIC_API_KEY=… BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… \
 *     npx tsx scripts/qa-trace/capture-live.ts "https://www.sec.gov/…" "find FY revenue"
 *
 * With no capture keys it prints the remediation and exits non-zero (honest — no fake bundle).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSource } from "../../src/nodeagent/capture/captureSource";

const url = process.argv[2];
const goal = process.argv.slice(3).join(" ") || "extract the key figures";
if (!url) { console.error("usage: tsx scripts/qa-trace/capture-live.ts <url> <goal...>"); process.exit(2); }

const r = await captureSource({ url, goal });
if (!r.ok) { console.error(`capture failed: ${r.error} — ${r.steps[0]?.detail ?? ""}`); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pubDir = resolve(root, "public/qa-trace/live");
const bundleOut = resolve(root, "src/ui/panels/qaTraceBundles/live-capture.json");
mkdirSync(pubDir, { recursive: true });
const steps = r.steps.map((s, i) => {
  const out: Record<string, unknown> = { idx: i + 1, group: s.phase, label: s.label, status: s.status, detail: s.detail };
  if (s.screenshotPng && s.screenshotPng.byteLength) {
    const file = `step-${i + 1}.png`;
    writeFileSync(resolve(pubDir, file), Buffer.from(s.screenshotPng));
    out.attachments = [{ kind: "screenshot", url: `/qa-trace/live/${file}`, ...(s.box ? { box: s.box } : {}) }];
  }
  return out;
});
const record = {
  id: "live-capture", kind: "agent", title: `Live capture · ${r.title ?? new URL(url).hostname}`,
  subtitle: goal, ts: new Date().toISOString(), source: { tool: "capture-live" }, steps, raw: { data: r.data, url },
};
writeFileSync(bundleOut, JSON.stringify(record, null, 2));
console.log(`wrote ${steps.length} steps + ${steps.filter((s) => s.attachments).length} screenshots -> ${bundleOut}`);
