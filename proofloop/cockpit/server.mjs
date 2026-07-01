#!/usr/bin/env node
/**
 * Proofloop cockpit server.
 *
 * Keeps the original WebSocket tailer for live event dashboards and also serves
 * a compact local proof viewer for .proofloop/runs/<runId>.
 *
 * Usage:
 *   node proofloop/cockpit/server.mjs <runId>
 *   node proofloop/cockpit/server.mjs .proofloop/runs/latest
 *   node proofloop/cockpit/server.mjs
 *
 * Env:
 *   PROOFLOOP_COCKPIT_PORT  default 4041
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";

const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, ".proofloop", "runs");
const PORT = Number(process.env.PROOFLOOP_COCKPIT_PORT ?? 4041);

const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
]);

function latestRunId() {
  if (!existsSync(RUNS_DIR)) return undefined;
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (!dirs.length) return undefined;
  return dirs
    .map((dir) => ({ name: dir.name, mtime: statSync(join(RUNS_DIR, dir.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;
}

function resolveRunRoot(arg) {
  if (arg) {
    const candidate = resolve(ROOT, arg);
    if (existsSync(candidate) || arg.includes("/") || arg.includes("\\")) return candidate;
    return join(RUNS_DIR, arg);
  }
  const latest = latestRunId();
  return latest ? join(RUNS_DIR, latest) : join(RUNS_DIR, "latest");
}

const runRoot = resolveRunRoot(process.argv[2]);
const runId = relative(RUNS_DIR, runRoot) || "latest";
mkdirSync(runRoot, { recursive: true });

function eventsPath() {
  const legacy = join(runRoot, "events.jsonl");
  if (existsSync(legacy)) return legacy;
  return join(runRoot, "cockpit-events.jsonl");
}

function sendExistingEvents(ws, filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) ws.send(line);
}

function readJson(name) {
  const path = join(runRoot, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readText(name) {
  const path = join(runRoot, name);
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.replace(/^\/file\//, ""));
  const target = resolve(runRoot, decoded);
  const rel = relative(runRoot, target);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || (resolve(runRoot) === target && decoded !== "")) return null;
  return target;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(payload);
}

function parseRecentEvents() {
  return readText(existsSync(join(runRoot, "events.jsonl")) ? "events.jsonl" : "cockpit-events.jsonl")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-50)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "parse_error", line };
      }
    });
}

function runSummary() {
  return {
    runId,
    root: runRoot,
    eventsPath: eventsPath(),
    clients: wss.clients.size,
    scorecard: readText("scorecard.md"),
    liveUserContract: readJson("live-user-contract.json"),
    verifierReceipt: readJson("verifier-receipt.json"),
    modelComparison: readJson("model-comparison.json"),
    costLedger: readJson("cost-ledger.json"),
    nodeEval: readJson("node-eval.json"),
    events: parseRecentEvents(),
  };
}

function html() {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proof Loop Cockpit</title>
<style>
body{margin:0;font:14px/1.4 system-ui,Segoe UI,sans-serif;background:#f6f7f9;color:#111827}
main{max-width:1120px;margin:0 auto;padding:24px}
section{background:#fff;border:1px solid #d8dde6;border-radius:8px;padding:16px;margin:0 0 16px}
h1{font-size:24px;margin:0 0 12px}h2{font-size:16px;margin:0 0 8px}
pre{white-space:pre-wrap;background:#111827;color:#f9fafb;border-radius:6px;padding:12px;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.pass{color:#0f766e}.fail{color:#b91c1c}a{color:#1d4ed8}
</style>
<main>
  <h1>Proof Loop Cockpit</h1>
  <section><h2>Run</h2><div id="run">Loading...</div></section>
  <section><h2>Gates</h2><div class="grid" id="gates"></div></section>
  <section><h2>Cost / Policy</h2><pre id="model"></pre></section>
  <section><h2>Recent Events</h2><pre id="events"></pre></section>
  <section><h2>Proof Files</h2>
    <p><a href="/file/trace-storybook.html">Trace Storybook</a> - <a href="/file/clips/final-proximitty-demo.mp4">Final clip</a> - <a href="/file/videos/final-proximitty-demo.mp4">Final video</a></p>
  </section>
</main>
<script>
async function refresh(){
  const data = await fetch('/api/run').then((response) => response.json());
  const status = data.verifierReceipt?.passed ? 'PASS' : 'CHECK';
  document.getElementById('run').textContent = status + ' - ' + (data.liveUserContract?.runId || data.runId) + ' - ' + data.root;
  const gates = data.liveUserContract?.gates || {};
  document.getElementById('gates').innerHTML = Object.entries(gates).map(([key,value]) =>
    '<div class="' + (value ? 'pass' : 'fail') + '">' + key + ': ' + value + '</div>'
  ).join('');
  document.getElementById('model').textContent = JSON.stringify({
    winner: data.modelComparison?.winner,
    score: data.verifierReceipt?.score,
    cost: data.costLedger?.totalCostUsd,
    scaffold: data.modelComparison?.policies?.find((policy) => !policy.passed)?.recommendedScaffoldChange
  }, null, 2);
  document.getElementById('events').textContent = JSON.stringify(data.events || [], null, 2);
}
refresh();
setInterval(refresh, 5000);
</script>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  if (url.pathname === "/") return send(res, 200, html(), "text/html; charset=utf-8");
  if (url.pathname === "/api/run" || url.pathname === "/status") return send(res, 200, runSummary(), "application/json; charset=utf-8");
  if (url.pathname.startsWith("/file/")) {
    const target = safePath(url.pathname);
    if (!target || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, "not found");
    return send(res, 200, readFileSync(target), mime.get(extname(target)) ?? "application/octet-stream");
  }
  return send(res, 404, "not found");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  console.log(`[cockpit] client connected (${wss.clients.size} total)`);
  sendExistingEvents(ws, eventsPath());
  ws.on("close", () => console.log(`[cockpit] client disconnected (${wss.clients.size} remaining)`));
  ws.on("error", () => {});
});

let lastPath = eventsPath();
let lastSize = existsSync(lastPath) ? statSync(lastPath).size : 0;
const pollTimer = setInterval(() => {
  const filePath = eventsPath();
  if (filePath !== lastPath) {
    lastPath = filePath;
    lastSize = existsSync(filePath) ? statSync(filePath).size : 0;
    return;
  }
  if (!existsSync(filePath)) return;
  const size = statSync(filePath).size;
  if (size <= lastSize) return;
  const buffer = readFileSync(filePath);
  const newData = buffer.subarray(lastSize).toString("utf8");
  lastSize = size;
  for (const line of newData.split("\n").filter(Boolean)) {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(line);
    }
  }
}, 500);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cockpit-server: runId=${runId}`);
  console.log(`cockpit-server: events=${eventsPath()}`);
  console.log(`cockpit-server: ws://127.0.0.1:${PORT}`);
  console.log(`cockpit-server: http://127.0.0.1:${PORT}`);
});

const shutdown = () => {
  clearInterval(pollTimer);
  wss.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
