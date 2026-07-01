/**
 * Proofloop Cockpit WebSocket server.
 *
 * Tails .proofloop/runs/<runId>/cockpit-events.jsonl and pushes every event line to
 * connected WebSocket clients in real time.  This lets an external dashboard
 * (or a second browser tab) watch gates/signals live without being inside the
 * Playwright page.
 *
 * Usage:
 *   node proofloop/cockpit/server.mjs <runId>
 *   node proofloop/cockpit/server.mjs            # auto-picks latest run
 *
 * Env:
 *   PROOFLOOP_COCKPIT_PORT  default 4041
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";

const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, ".proofloop", "runs");
const PORT = Number(process.env.PROOFLOOP_COCKPIT_PORT ?? 4041);

function latestRunId() {
  if (!existsSync(RUNS_DIR)) return undefined;
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (!dirs.length) return undefined;
  return dirs
    .map((d) => ({ name: d.name, mtime: statSync(join(RUNS_DIR, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;
}

function eventsPath(runId) {
  const runDir = join(RUNS_DIR, runId);
  const canonical = join(runDir, "cockpit-events.jsonl");
  const legacy = join(runDir, "events.jsonl");
  return existsSync(canonical) || !existsSync(legacy) ? canonical : legacy;
}

function sendExistingEvents(ws, filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    ws.send(line);
  }
}

function start() {
  const runId = process.argv[2] ?? latestRunId();
  if (!runId) {
    console.error("cockpit-server: no runId provided and no runs found in .proofloop/runs/");
    process.exit(1);
  }

  const filePath = eventsPath(runId);
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ runId, eventsPath: filePath, clients: wss.clients.size }));
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log(`[cockpit] client connected (${wss.clients.size} total)`);
    sendExistingEvents(ws, filePath);
    ws.on("close", () => console.log(`[cockpit] client disconnected (${wss.clients.size} remaining)`));
    ws.on("error", () => {});
  });

  let lastSize = existsSync(filePath) ? statSync(filePath).size : 0;
  let pollTimer;

  function pollFile() {
    if (!existsSync(filePath)) return;
    const size = statSync(filePath).size;
    if (size <= lastSize) return;
    const fd = readFileSync(filePath);
    const newData = fd.subarray(lastSize).toString("utf8");
    lastSize = size;
    for (const line of newData.split("\n").filter(Boolean)) {
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(line);
      }
    }
  }

  pollTimer = setInterval(pollFile, 500);

  server.listen(PORT, () => {
    console.log(`cockpit-server: runId=${runId}`);
    console.log(`cockpit-server: events=${filePath}`);
    console.log(`cockpit-server: ws://localhost:${PORT}`);
    console.log(`cockpit-server: http://localhost:${PORT} (status)`);
  });

  const shutdown = () => {
    clearInterval(pollTimer);
    wss.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
