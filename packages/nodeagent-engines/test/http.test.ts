/**
 * HTTP API scenarios. Persona: the NodeRoom workspace UI (and a hostile web
 * page) talking to the loopback worker. Engines are scripted fakes injected
 * through createWorker({ adapters }) — test-only, never on the product path.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { FileContent, FileEntry, HealthResponse, ProjectRecord, RunRecord } from "../src/api.js";
import type { Capability, EngineAdapter, EngineHost, EngineId, EngineRunOutcome, NodeAgentEvent, RunSpec } from "../src/contract.js";
import { emptyUsage } from "../src/contract.js";
import { createEngineRegistry, ENGINE_FACTORIES } from "../src/registry.js";
import { createWorker, type Worker } from "../src/server/index.js";

function fakeAdapter(id: EngineId, script: (spec: RunSpec, host: EngineHost) => Promise<EngineRunOutcome>, missing: string[] = []): EngineAdapter {
  const caps = ["start", "stream", "interrupt", "resume", "subagents", "childEventIdentity", "compaction", "toolSearch", "skillLoad", "skillRefresh", "goals", "permissions", "usage", "costUsd"] as Capability[];
  return {
    descriptor: () => ({
      id,
      label: `fake ${id}`,
      sdk: { name: "fake", version: "0.0.0" },
      defaultModel: "fake-model",
      models: ["fake-model"],
      capabilities: Object.fromEntries(caps.map((c) => [c, { status: "UNTESTED", note: "test fake" }])) as never,
    }),
    availability: async () => ({ ok: missing.length === 0, missing }),
    start: (spec, host) => ({ done: script(spec, host), interrupt: async () => {} }),
  };
}

const root = mkdtempSync(path.join(tmpdir(), "nodeagent-http-"));
let worker: Worker;
let base: string;
let project: ProjectRecord;
let release!: () => void;
let gate = new Promise<void>((r) => (release = r));

before(async () => {
  const fx = path.join(root, "fixtures", "t1");
  mkdirSync(path.join(fx, "secret"), { recursive: true });
  mkdirSync(path.join(fx, "data"), { recursive: true });
  writeFileSync(path.join(fx, "template.json"), JSON.stringify({ id: "t1", title: "Cleaning", description: "d", restrictedGlobs: ["secret/**"], checks: {} }));
  writeFileSync(path.join(fx, "secret", "key.txt"), "nope");
  writeFileSync(path.join(fx, "data", "raw.csv"), "a,b\n1,2\n");
  writeFileSync(path.join(fx, "data", "big.txt"), "x".repeat(600 * 1024));
  const claude = fakeAdapter("claude-agent-sdk", async (spec, host) => {
    host.emit({ type: "run.started", engine: "claude-agent-sdk", model: spec.model, sdkVersion: "0", cwd: spec.workspaceDir, tools: [], skills: [] });
    host.emit({ type: "message.delta", text: "Reading raw.csv" });
    await gate;
    host.emit({ type: "message.delta", text: " and cleaning it." });
    host.emit({ type: "message", role: "assistant", text: "Reading raw.csv and cleaning it." });
    return { status: "completed", finalText: "Cleaned.", usage: emptyUsage() };
  });
  const codex = fakeAdapter("codex-app-server", async () => ({ status: "completed", finalText: "", usage: emptyUsage() }), ["OPENAI_API_KEY is not set"]);
  worker = await createWorker({ home: path.join(root, "home"), envFiles: [], port: 0, adapters: [claude, codex], fixturesDir: path.join(root, "fixtures"), heartbeatMs: 40, log: () => {} });
  base = worker.url;
});

after(async () => {
  release();
  await worker?.close();
  rmSync(root, { recursive: true, force: true });
});

async function call<T = unknown>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

interface SseClient {
  status: Promise<number>;
  events: NodeAgentEvent[];
  comments: string[];
  close(): void;
  until(pred: (c: SseClient) => boolean, ms?: number): Promise<void>;
}

function openSse(p: string, headers: Record<string, string> = {}): SseClient {
  const c: SseClient = {
    events: [],
    comments: [],
    status: Promise.resolve(0),
    close: () => {},
    async until(pred, ms = 4000) {
      const t0 = Date.now();
      while (!pred(c)) {
        if (Date.now() - t0 > ms) throw new Error(`SSE condition not met; got seqs ${c.events.map((e) => e.seq).join(",")}`);
        await new Promise((r) => setTimeout(r, 15));
      }
    },
  };
  c.status = new Promise((resolve, reject) => {
    const req = http.get(`${base}${p}`, { headers }, (res) => {
      resolve(res.statusCode ?? 0);
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith(":")) c.comments.push(block.slice(1).trim());
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          const id = block.split("\n").find((l) => l.startsWith("id: "));
          if (data) {
            const ev = JSON.parse(data.slice(6)) as NodeAgentEvent;
            assert.equal(Number(id?.slice(4)), ev.seq, "SSE id is the event seq");
            c.events.push(ev);
          }
        }
      });
      res.on("error", () => {});
    });
    req.on("error", reject);
    c.close = () => req.destroy();
  });
  return c;
}

test("UI creates a project, browses files, and cannot read restricted or escaping paths", async () => {
  const created = await call<ProjectRecord>("POST", "/api/projects", { template: "t1", title: "Dana" });
  assert.equal(created.status, 201);
  project = created.body;
  const files = await call<FileEntry[]>("GET", `/api/projects/${project.id}/files`);
  assert.equal(files.status, 200);
  assert.ok(files.body.some((f) => f.path === "data/raw.csv" && /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.ok(!files.body.some((f) => f.path.startsWith("secret/")), "restricted files are not listed");
  assert.ok(!files.body.some((f) => f.path === "template.json"), "template.json is not copied");
  const ok = await call<FileContent>("GET", `/api/projects/${project.id}/file?path=data/raw.csv`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.text, "a,b\n1,2\n");
  const big = await call<FileContent>("GET", `/api/projects/${project.id}/file?path=data/big.txt`);
  assert.equal(big.body.truncated, true);
  assert.equal(big.body.text.length, 512 * 1024);
  assert.equal((await call("GET", `/api/projects/${project.id}/file?path=..%5C..%5Csecret`)).status, 403);
  assert.equal((await call("GET", `/api/projects/${project.id}/file?path=secret/key.txt`)).status, 403);
  assert.equal((await call("GET", `/api/projects/${project.id}/file?path=data/none.csv`)).status, 404);
  assert.equal((await call("GET", `/api/projects/${project.id}/skills`)).status, 200);
  assert.equal((await call("POST", "/api/projects", { template: "nope" })).status, 400);
  assert.equal((await call("GET", "/api/projects/missing/files")).status, 404);
});

test("health reports engines and templates; tools lists the Node catalog", async () => {
  const h = await call<HealthResponse>("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const codex = h.body.engines.find((e) => e.descriptor.id === "codex-app-server")!;
  assert.deepEqual(codex.availability, { ok: false, missing: ["OPENAI_API_KEY is not set"] });
  assert.deepEqual(h.body.templates.map((t) => t.id), ["t1"]);
  const tools = await call<Array<{ name: string }>>("GET", "/api/tools");
  assert.equal(tools.status, 200);
  assert.ok(tools.body.length > 0);
});

test("SSE replays after Last-Event-ID, then delivers live events without gaps or duplicates", async () => {
  const created = await call<RunRecord>("POST", "/api/runs", { projectId: project.id, engine: "claude-agent-sdk", prompt: "Clean data/raw.csv" });
  assert.equal(created.status, 201);
  const runId = created.body.id;
  // Persisted before 201: the record is readable immediately.
  assert.equal((await call<RunRecord>("GET", `/api/runs/${runId}`)).status, 200);
  for (let i = 0; i < 200; i++) {
    const page = await call<NodeAgentEvent[]>("GET", `/api/runs/${runId}/events.json`);
    if (page.body.length >= 3) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  const resumed = openSse(`/api/runs/${runId}/events`, { "last-event-id": "2" });
  assert.equal(await resumed.status, 200);
  const full = openSse(`/api/runs/${runId}/events?after=0`);
  await resumed.until((c) => c.events.length >= 1);
  assert.equal(resumed.events[0].seq, 3, "replay starts after Last-Event-ID");
  release();
  await resumed.until((c) => c.events.some((e) => e.type === "run.completed"));
  await full.until((c) => c.events.some((e) => e.type === "run.completed"));
  const seqs = resumed.events.map((e) => e.seq);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 3));
  const stored = (await call<NodeAgentEvent[]>("GET", `/api/runs/${runId}/events.json?after=0&limit=1000`)).body;
  assert.deepEqual(full.events.map((e) => e.seq), stored.map((e) => e.seq));
  await resumed.until((c) => c.comments.includes("heartbeat"), 2000);
  const page = await call<NodeAgentEvent[]>("GET", `/api/runs/${runId}/events.json?after=1&limit=2`);
  assert.deepEqual(page.body.map((e) => e.seq), [2, 3]);
  assert.equal((await call("GET", `/api/runs/${runId}/events.json?after=-1`)).status, 400);
  resumed.close();
  full.close();
  // Finished run: message is refused with a non-2xx and a reason; verify has no verifier here.
  const msg = await call<{ accepted: boolean; reason?: string; error?: string }>("POST", `/api/runs/${runId}/message`, { text: "more" });
  assert.equal(msg.status, 409);
  assert.equal(msg.body.accepted, false);
  assert.ok(msg.body.error);
  assert.equal((await call("POST", `/api/runs/${runId}/verify`)).status, 409);
  assert.equal((await call("POST", `/api/runs/${runId}/interrupt`)).status, 409);
  assert.equal((await call("POST", `/api/runs/${runId}/resume`, {})).status, 409, "fake engine reported no native session id");
  gate = new Promise<void>((r) => (release = r));
});

test("setup gaps and bad input are honest non-2xx responses", async () => {
  const r412 = await call<{ error: string }>("POST", "/api/runs", { projectId: project.id, engine: "codex-app-server", prompt: "x" });
  assert.equal(r412.status, 412);
  assert.match(r412.body.error, /Setup required for codex-app-server: OPENAI_API_KEY is not set/);
  assert.equal((await call("POST", "/api/runs", { projectId: project.id, engine: "nope", prompt: "x" })).status, 400);
  assert.equal((await call("POST", "/api/runs", { projectId: "missing", engine: "claude-agent-sdk", prompt: "x" })).status, 404);
  assert.equal((await call("POST", "/api/runs", "{not json")).status, 400);
  assert.equal((await call("POST", "/api/runs", JSON.stringify({ prompt: "x".repeat(1024 * 1024 + 10) }))).status, 413);
  assert.equal((await call("GET", "/api/runs/run-missing")).status, 404);
  assert.equal((await call("GET", "/api/nothing")).status, 404);
  assert.equal((await call("DELETE", "/api/runs")).status, 404);
  assert.equal((await call("GET", "/api/runs/%E0%A4%A/events.json")).status, 400);
});

test("a hostile origin or rebinding Host is rejected; localhost origins are allowed", async () => {
  const evil = await call<{ error: string }>("POST", "/api/projects", { template: "t1" }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.match(evil.body.error, /Origin/);
  const dev = await call("GET", "/api/projects", undefined, { origin: "http://localhost:5173" });
  assert.equal(dev.status, 200);
  const rebind = await new Promise<number>((resolve, reject) => {
    const req = http.get(`${base}/api/projects`, { headers: { host: "attacker.example:4317" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
  });
  assert.equal(rebind, 403);
});

test("burst: at most 64 SSE clients; the 65th gets 503, and slots free on close", async () => {
  const runs = await call<RunRecord[]>("GET", `/api/runs?projectId=${project.id}`);
  const runId = runs.body[0].id;
  const clients: SseClient[] = [];
  for (let i = 0; i < 64; i++) clients.push(openSse(`/api/runs/${runId}/events`));
  const statuses = await Promise.all(clients.map((c) => c.status));
  assert.ok(statuses.every((s) => s === 200));
  const extra = openSse(`/api/runs/${runId}/events`);
  assert.equal(await extra.status, 503);
  extra.close();
  for (const c of clients) c.close();
  let status = 0;
  for (let i = 0; i < 100 && status !== 200; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const again = openSse(`/api/runs/${runId}/events`);
    status = await again.status;
    again.close();
  }
  assert.equal(status, 200);
});

test("registry: an engine module that fails to import is reported, not fatal", async () => {
  const saved = { ...ENGINE_FACTORIES };
  try {
    for (const id of Object.keys(ENGINE_FACTORIES) as EngineId[]) ENGINE_FACTORIES[id] = async () => fakeAdapter(id, async () => ({ status: "completed", finalText: "", usage: emptyUsage() }));
    ENGINE_FACTORIES["google-adk"] = async () => {
      throw new Error("Cannot find package '@google/adk'");
    };
    const health = await createEngineRegistry().health({});
    const adk = health.find((h) => h.descriptor.id === "google-adk")!;
    assert.deepEqual(adk.availability, { ok: false, missing: ["engine module failed to load: Cannot find package '@google/adk'"] });
    assert.equal(health.filter((h) => h.availability.ok).length, 4);
  } finally {
    Object.assign(ENGINE_FACTORIES, saved);
  }
});
