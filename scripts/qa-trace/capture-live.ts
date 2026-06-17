/**
 * capture-live.ts — runnable worker for the live-capture pipeline. Drives a REAL page via the
 * env-selected substrate (Browserbase if its keys are set → interactive + EXACT boxes, else Firecrawl)
 * with our own reasoning loop.
 *
 * Two sinks:
 *  - DEFAULT → writes a Trace bundle (screenshots to /public/qa-trace/live, boxes preserved).
 *  - CONVEX  → if CAPTURE_WORKER_TOKEN + CAPTURE_ROOM_ID + (CAPTURE_CONVEX_URL|VITE_CONVEX_URL) are set,
 *    uploads screenshots to Convex storage and persists a captureRecord (boxes kept) so the Browserbase
 *    capture renders reactively in that room's Trace tab — this is the "exact-box SEC capture in-app" path.
 *
 *   ANTHROPIC_API_KEY=… BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… \
 *   CAPTURE_WORKER_TOKEN=… CAPTURE_ROOM_ID=<roomId> VITE_CONVEX_URL=… \
 *     npx tsx scripts/qa-trace/capture-live.ts "https://www.sec.gov/…" "find FY revenue"
 *
 * With no capture keys it prints the remediation and exits non-zero (honest — no fake output).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { captureSource } from "../../src/nodeagent/capture/captureSource";

const url = process.argv[2];
const goal = process.argv.slice(3).join(" ") || "extract the key figures";
if (!url) { console.error("usage: tsx scripts/qa-trace/capture-live.ts <url> <goal...>"); process.exit(2); }

const r = await captureSource({ url, goal });
if (!r.ok) { console.error(`capture failed: ${r.error} — ${r.steps[0]?.detail ?? ""}`); process.exit(1); }

const convexUrl = process.env.CAPTURE_CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const token = process.env.CAPTURE_WORKER_TOKEN;
const roomId = process.env.CAPTURE_ROOM_ID;

if (convexUrl && token && roomId) {
  // ── Convex sink: upload screenshots → storage ids, persist a captureRecord (renders with boxes) ──
  const client = new ConvexHttpClient(convexUrl);
  const steps: Array<Record<string, unknown>> = [];
  for (const s of r.steps) {
    let screenshotId: string | undefined;
    if (s.screenshotPng && s.screenshotPng.byteLength) {
      const uploadUrl = (await client.mutation(api.captures.workerUploadUrl, { token })) as string;
      const res = await fetch(uploadUrl, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.from(s.screenshotPng) });
      if (!res.ok) throw new Error(`upload http ${res.status}`);
      screenshotId = ((await res.json()) as { storageId: string }).storageId;
    }
    const step: Record<string, unknown> = { phase: s.phase, label: s.label, status: s.status };
    if (s.detail !== undefined) step.detail = s.detail;
    if (s.box) step.box = s.box;
    if (screenshotId) step.screenshotId = screenshotId;
    steps.push(step);
  }
  await client.mutation(api.captures.ingest, {
    token, roomId: roomId as never, url: r.url, goal, title: r.title, ok: r.ok, error: r.error,
    ts: Date.now(), steps: steps as never, data: r.data as never,
  });
  console.log(`persisted ${steps.length} steps to room ${roomId} (Convex) — renders in the Trace tab`);
} else {
  // ── Bundle sink (default) ──
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
}
